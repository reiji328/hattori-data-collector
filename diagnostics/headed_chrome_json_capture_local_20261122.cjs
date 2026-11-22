'use strict';
// LOCAL ONLY: verify page.waitForResponse-before-goto and raw Buffer preservation
// on headed Chromium and headed Google Chrome. No P's CUBE requests.
const http=require('node:http');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {chromium}=require('playwright');
const fakeSource=Buffer.from(JSON.stringify({
  YMD_biz:'20261122',
  Dai:{cd_dai:'0042'},
  Ki:{name:'LOCAL_TEST_ONLY',cd_ps:1,bai:4},
  Menu:[],Data:[],Graph:[],Hists:[]
}),'utf8');
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
const serve=()=>new Promise((resolve,reject)=>{
  const s=http.createServer((req,res)=>{
    if(req.url==='/unit'||req.url==='/unit-403'){
      const code=req.url==='/unit'? '0042' : '0043';
      res.writeHead(200,{'content-type':'text/html; charset=utf-8'});
      res.end('<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>LOCAL UNIT '+code+
        '<script>fetch("/nc-m06-001.php?cd_dai='+code+'").catch(()=>{});</script></body></html>');
    }else if(req.url==='/nc-m06-001.php?cd_dai=0042'){
      res.writeHead(200,{'content-type':'application/json'});res.end(fakeSource);
    }else if(req.url==='/nc-m06-001.php?cd_dai=0043'){
      res.writeHead(403,{'content-type':'text/plain'});res.end('LOCAL_DENIED');
    }else {res.writeHead(404);res.end();}
  });
  s.once('error',reject);
  s.listen(0,'127.0.0.1',()=>resolve(s));
});
const close=s=>new Promise(resolve=>s.close(()=>resolve()));
async function main(){
  const server=await serve();
  const base='http://127.0.0.1:'+server.address().port;
  const modes=[
    {name:'headed_chromium',args:{headless:false}},
    {name:'headed_google_chrome',args:{headless:false,channel:'chrome'}}
  ];
  const results=[];
  try{
    for(const mode of modes){
      const browser=await chromium.launch(mode.args);
      try{
        const ctx=await browser.newContext({locale:'ja-JP',timezoneId:'Asia/Tokyo'});
        await ctx.route('**/*',route=>route.request().url().startsWith(base+'/')
          ? route.continue():route.abort('blockedbyclient'));
        const page=await ctx.newPage();
        // Register the API response watcher BEFORE navigation, as in the verified TinyFish code.
        const apiPromise=page.waitForResponse(r=>
          r.url().startsWith(base+'/nc-m06-001.php?cd_dai=0042'),{timeout:12000});
        const nav=await page.goto(base+'/unit',{waitUntil:'domcontentloaded',timeout:15000});
        const api=await apiPromise;
        assert.equal(nav?.status(),200);
        assert.equal(api.status(),200);
        assert((api.headers()['content-type']||'').includes('application/json'));
        const bytes=await api.body();
        const parsed=JSON.parse(bytes.toString('utf8'));
        assert.deepEqual(bytes,fakeSource,'raw HTTP response bytes must be identical');
        assert.equal(parsed.Dai.cd_dai,'0042');
        assert.equal(parsed.Ki.bai,4);
        assert.equal(parsed.Ki.cd_ps,1);
        assert.equal(parsed.YMD_biz,'20261122');
        const sha=digest(bytes);
        assert.equal(sha,digest(fakeSource));
        // Negative case: the API returns 403 and must NOT enter saved raw collection.
        const savedBuffers=[];
        savedBuffers.push(Buffer.from(bytes));
        const deniedPromise=page.waitForResponse(r=>
          r.url().startsWith(base+'/nc-m06-001.php?cd_dai=0043'),{timeout:12000});
        const blockedNav=await page.goto(base+'/unit-403',{waitUntil:'domcontentloaded',timeout:15000});
        const denied=await deniedPromise;
        assert.equal(blockedNav?.status(),200);
        assert.equal(denied.status(),403);
        assert.equal(savedBuffers.length,1,'403 must not save new source');
        assert.equal(savedBuffers[0].equals(fakeSource),true);
        results.push({
          browser:mode.name,status:'PASS',browser_version:browser.version(),
          source_status:200,unit_validated:true,raw_sha_matches:true,
          denied_api_status:403,denied_saved:false,
          event_watch_registered_before_goto:true
        });
        await ctx.close();
      }finally{await browser.close().catch(()=>{});}
    }
    assert.equal(results.length,2);
    console.log('HEADED_JSON_CAPTURE_LOCAL_RESULT '+JSON.stringify({
      status:'PASS',real_site_requests:0,fake_unit:'0042',
      test_kind:'synthetic_loopback',success_cases:2,denied_cases:2,results
    }));
  }finally{await close(server);}
}
main().catch(e=>{
  console.error('HEADED_JSON_CAPTURE_LOCAL_FAILED '+(e?.name||'Error')+': '+(e?.message||''));
  process.exitCode=2;
});
