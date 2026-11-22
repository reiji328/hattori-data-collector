'use strict';
// CUBE NOTE 2026-11-22: LOCAL LOOPBACK ONLY.
// Compare Playwright's standard headless-shell, new headless Chromium, headed
// Chromium, and (if installed) headed Google Chrome. No target-site requests.
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawnSync } = require('node:child_process');
const { chromium } = require('playwright');

const listen = server => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const close = server => new Promise(resolve => server.close(resolve));

function executableAvailable(bin) {
  const r = spawnSync('sh', ['-c', 'command -v '+bin], {encoding:'utf8'});
  return r.status === 0 && Boolean(r.stdout.trim());
}

async function main() {
  const observed = [];
  const server = http.createServer((req, res) => {
    if(req.method !== 'GET' || req.url !== '/probe') {
      res.writeHead(404); res.end('not found'); return;
    }
    observed.push({
      ua: req.headers['user-agent'] || null,
      accept_language: req.headers['accept-language'] || null,
      client_hints: req.headers['sec-ch-ua'] || null
    });
    res.writeHead(200, {'Content-Type':'text/html; charset=utf-8',
      'Cache-Control':'no-store'});
    res.end('<!doctype html><html><head><title>LOCAL ONLY</title></head><body>LOCAL TEST</body></html>');
  });
  let open = false;
  const results = [];
  try {
    await listen(server); open = true;
    const target='http://127.0.0.1:'+server.address().port+'/probe';
    const installedChrome = executableAvailable('google-chrome') ||
      executableAvailable('google-chrome-stable');
    const modes = [
      {name:'default_headless_shell', options:{headless:true}},
      {name:'new_headless_chromium', options:{headless:true,channel:'chromium'}},
      {name:'headed_chromium_xvfb', options:{headless:false}},
      {name:'headed_google_chrome_xvfb', options:{headless:false,channel:'chrome'},
        optional:!installedChrome}
    ];
    for(const mode of modes) {
      if(mode.optional) {
        results.push({name:mode.name,status:'SKIP_NOT_INSTALLED'});
        continue;
      }
      let browser, context;
      try {
        browser = await chromium.launch(mode.options);
        context = await browser.newContext({
          locale:'ja-JP',timezoneId:'Asia/Tokyo',
          viewport:{width:430,height:960}
        });
        // No page can navigate or fetch a non-loopback resource.
        await context.route('**/*', route => {
          return route.request().url() === target
            ? route.continue()
            : route.abort('blockedbyclient');
        });
        const page = await context.newPage();
        const nav = await page.goto(target, {waitUntil:'domcontentloaded', timeout:15000});
        assert.equal(nav?.status(),200);
        const js = await page.evaluate(() => ({
          ua: navigator.userAgent,
          language: navigator.language,
          webdriver: navigator.webdriver,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
        }));
        const record=observed[observed.length-1];
        assert.equal(js.ua,record?.ua);
        assert.equal(record.accept_language,'ja-JP');
        assert.equal(js.language,'ja-JP');
        assert.equal(js.timezone,'Asia/Tokyo');
        results.push({
          name:mode.name,status:'PASS',browser_version:browser.version(),
          user_agent_wire:record.ua,accept_language:record.accept_language,
          sec_ch_ua:record.client_hints,webdriver:js.webdriver,
          headless_token_present:/HeadlessChrome/i.test(record.ua)
        });
      } catch(err) {
        results.push({name:mode.name,status:'FAIL',
          error_type:err?.name||'Error',
          error_code:err?.code||null});
      } finally {
        if(context)await context.close().catch(()=>{});
        if(browser)await browser.close().catch(()=>{});
      }
    }
    const tested=results.filter(x=>x.status==='PASS');
    const failed=results.filter(x=>x.status==='FAIL');
    const expectedRequests=tested.length;
    assert.equal(observed.length,expectedRequests,
      'one request only per successful local case');
    console.log('BROWSER_MODES_LOCAL_RESULT '+JSON.stringify({
      browser_profiles:'all are local CI browsers (not Nagi Chrome)',
      target_kind:'127.0.0.1_only',actual_pscube_requests:0,
      user_agent_overrides:0,proxy_switches:0,chrome_installed:installedChrome,
      expected_cases:4,passed:tested.length,failed:failed.length,
      skipped:results.filter(x=>x.status.startsWith('SKIP')).length,
      results
    }));
    if(failed.length || tested.length<3) process.exitCode=2;
  } finally {
    if(open)await close(server);
  }
}
main().catch(err=>{
  console.error('BROWSER_MODES_LOCAL_FATAL '+(err?.name||'Error'));
  process.exitCode=2;
});
