'use strict';
// LOCAL LOOPBACK AUDIT ONLY - no P's CUBE, DMM, external IP query, VPN, proxy, or UA changes.
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
async function run() {
  const received = [];
  const server = http.createServer((request, response) => {
    if (request.url !== '/probe') { response.writeHead(404); response.end(); return; }
    received.push({
      user_agent: request.headers['user-agent'] || null,
      accept_language: request.headers['accept-language'] || null,
      accept: request.headers['accept'] || null,
      method: request.method,
      path: request.url
    });
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control':'no-store' });
    response.end('<!doctype html><html lang="ja"><head><meta charset="utf-8"></head><body>LOCAL TEST ONLY</body></html>');
  });
  let browser;
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const port = server.address().port;
    browser = await chromium.launch({ headless: true });
    const cases = [
      { name: 'root_probe_20261122', opts: { locale: 'ja-JP', timezoneId: 'Asia/Tokyo' } },
      { name: 'dmm_ui_20261122', opts: { locale: 'ja-JP', timezoneId: 'Asia/Tokyo', viewport: { width: 430, height: 960 } } }
    ];
    const results = [];
    for (const item of cases) {
      const context = await browser.newContext(item.opts);
      try {
        // Prevent any unintended external requests from a page. Only loopback is allowed.
        await context.route('**/*', route => {
          const url = route.request().url();
          if (url.startsWith('http://127.0.0.1:' + port + '/')) return route.continue();
          return route.abort('blockedbyclient');
        });
        const page = await context.newPage();
        const nav = await page.goto('http://127.0.0.1:' + port + '/probe', { waitUntil: 'domcontentloaded', timeout: 12000 });
        assert.equal(nav?.status(), 200, 'local diagnostic must return 200');
        const js = await page.evaluate(() => ({
          navigator_user_agent: navigator.userAgent,
          navigator_language: navigator.language,
          navigator_languages: [...navigator.languages],
          navigator_webdriver: navigator.webdriver,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
        }));
        const wire = received[results.length];
        assert.equal(wire?.method, 'GET');
        assert.equal(wire?.path, '/probe');
        assert.equal(wire?.user_agent, js.navigator_user_agent);
        assert.equal(js.navigator_language, 'ja-JP');
        assert.equal(js.timezone, 'Asia/Tokyo');
        const cookies = await context.cookies();
        results.push({ name: item.name, http_request_headers: wire,
          js, cookie_count: cookies.length, fresh_context: true });
      } finally { await context.close(); }
    }
    assert.equal(received.length, 2, 'exactly two loopback requests are permitted');
    const envProxyNames = ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy'];
    const proxyNamePresence = Object.fromEntries(envProxyNames.map(k=>[k, Object.prototype.hasOwnProperty.call(process.env,k)&&Boolean(process.env[k])]));
    // Proxy values, credentials, outbound IP, raw environment variables never logged.
    console.log('LOCAL_BROWSER_HEADER_AUDIT '+JSON.stringify({
      test_kind:'loopback_only', external_site_requests:0, browser_version:browser.version(),
      settings: { headless:true, custom_user_agent:false, proxy_overrides:false, extensions:false },
      proxy_environment_flag_presence:proxyNamePresence, results, total_requests:received.length
    }));
  } finally {
    if (browser) await browser.close().catch(()=>{});
    await new Promise(resolve=>server.close(()=>resolve()));
  }
}
run().catch(e=>{console.error('LOCAL_HEADER_AUDIT_FAILED '+(e?.name||'Error')+': '+(e?.message||''));process.exitCode=1});
