'use strict';
// Local-only A/B: defaults, changed UA, and a loopback-only HTTP proxy.
// No real website, external-IP lookup, external VPN, DNS lookup of public hosts,
// paid provider, authentication bypass, credential access, or scraping.
const assert = require('node:assert/strict');
const http = require('node:http');
const { chromium } = require('playwright');
const UA_TEST = 'CUBE_NOTE_LOCAL_UA_TEST/1.0';
const HTML = '<!doctype html><html lang="ja"><body>local-only</body></html>';
const listen = server => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const close = server => new Promise(resolve => server.close(resolve));
async function main() {
  const originRequests = [], proxyRequests = [];
  const origin = http.createServer((req,res)=>{
    if(req.url!=='/probe'||req.method!=='GET'){res.writeHead(404);res.end();return}
    originRequests.push({ua:req.headers['user-agent']||null,lang:req.headers['accept-language']||null});
    res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});
    res.end(HTML);
  });
  // This proxy is a local dummy: it NEVER forwards traffic.
  const proxy = http.createServer((req,res)=>{
    if(req.url!=='http://test-probe.invalid/probe'||req.method!=='GET'){
      res.writeHead(403);res.end('LOCAL_PROXY_REFUSED');return
    }
    proxyRequests.push({ua:req.headers['user-agent']||null,
      lang:req.headers['accept-language']||null,
      raw_request_target:req.url,
      local_socket:req.socket.remoteAddress==='127.0.0.1'});
    res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});
    res.end(HTML);
  });
  let browser;let originOpen=false,proxyOpen=false;
  try {
    await listen(origin);originOpen=true;
    await listen(proxy);proxyOpen=true;
    const originUrl='http://127.0.0.1:'+origin.address().port+'/probe';
    const proxyUrl='http://127.0.0.1:'+proxy.address().port;
    browser=await chromium.launch({headless:true});
    const baseContext={locale:'ja-JP',timezoneId:'Asia/Tokyo'};
    // Baseline: original Chromium UA. Browser requests are explicitly loopback-limited.
    const base=await browser.newContext(baseContext);
    await base.route('**/*',route=>route.request().url()===originUrl?route.continue():route.abort());
    const basePage=await base.newPage();
    const baseResponse=await basePage.goto(originUrl,{waitUntil:'domcontentloaded',timeout:15000});
    assert.equal(baseResponse?.status(),200);
    const baseNavUa=await basePage.evaluate(()=>navigator.userAgent);
    const baseWire=originRequests[0];
    assert(baseWire?.ua.includes('HeadlessChrome/'), 'baseline should disclose headless Chromium');
    assert.equal(baseWire.ua,baseNavUa);
    assert.equal(baseWire.lang,'ja-JP');
    await base.close();

    // UA change: deliberate diagnostic string, not a forged Safari/Chrome user agent.
    const changed=await browser.newContext({...baseContext,userAgent:UA_TEST});
    await changed.route('**/*',route=>route.request().url()===originUrl?route.continue():route.abort());
    const changedPage=await changed.newPage();
    const changedResponse=await changedPage.goto(originUrl,{waitUntil:'domcontentloaded',timeout:15000});
    assert.equal(changedResponse?.status(),200);
    const changedNavUa=await changedPage.evaluate(()=>navigator.userAgent);
    const changedWire=originRequests[1];
    assert.equal(changedNavUa,UA_TEST);
    assert.equal(changedWire?.ua,UA_TEST);
    assert.equal(changedWire.lang,'ja-JP');
    await changed.close();

    // Proxy change: route a *reserved .invalid* host through a local, non-forwarding proxy.
    // Not a real VPN, not an external IP change, and not a request to that domain.
    const routed=await browser.newContext({...baseContext,proxy:{server:proxyUrl}});
    await routed.route('**/*',route=>route.request().url()==='http://test-probe.invalid/probe'?route.continue():route.abort());
    const routedPage=await routed.newPage();
    const routedResponse=await routedPage.goto('http://test-probe.invalid/probe',{waitUntil:'domcontentloaded',timeout:15000});
    assert.equal(routedResponse?.status(),200);
    const proxyWire=proxyRequests[0];
    assert.equal(proxyWire?.raw_request_target,'http://test-probe.invalid/probe');
    assert.equal(proxyWire.local_socket,true);
    assert.equal(proxyWire.lang,'ja-JP');
    await routed.close();

    assert.equal(originRequests.length,2);
    assert.equal(proxyRequests.length,1);
    console.log('UA_PROXY_LOCAL_AB_RESULT '+JSON.stringify({
      status:'PASS', test_environment:'github_hosted_loopback_only',
      browser_version:browser.version(),external_target_requests:0,
      default:{headless_token_present:true,user_agent:baseWire.ua,language:baseWire.lang},
      overridden_ua:{target:UA_TEST,wire_matches:true,navigator_matches:true},
      loopback_proxy:{route_matches:true,uses_local_proxy_only:true,external_ip_changed:false,vpn_connected:false},
      cases:3,origin_requests:originRequests.length,proxy_requests:proxyRequests.length
    }));
  } finally {
    if(browser)await browser.close().catch(()=>{});
    if(proxyOpen)await close(proxy);
    if(originOpen)await close(origin);
  }
}
main().catch(e=>{console.error('UA_PROXY_LOCAL_AB_FAIL '+(e?.name||'Error')+': '+(e?.message||''));process.exitCode=1});
