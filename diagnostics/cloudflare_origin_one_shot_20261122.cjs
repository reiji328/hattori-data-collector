'use strict';
// Single owner-authorized ordinary DMM view for limited HTTP 403 attribution.
// No IP/VPN/UA overrides, proxy, login, challenge handling, retries, scraping or raw HTML retention.
// The exact official DMM store link is the ONLY programmatic top-level navigation.
const {chromium}=require('playwright');
const fs=require('node:fs');
const DMM='https://p-town.dmm.com/shops/osaka/7713/jackpot';
const HALL_ORIGIN='https://www.pscube.jp';
const HALL_PREFIX='/dedamajyoho-P-townDMMpachi/c762502/';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function isHallDocument(response){
  try{
    const u=new URL(response.url());
    return u.origin===HALL_ORIGIN&&u.pathname.startsWith(HALL_PREFIX)&&
      response.request().resourceType()==='document';
  }catch{return false}
}
function markers(body){
  const s=String(body||'').slice(0,65536);
  return {
    mentions_pscube_500:/500\s*[-–]\s*内部サーバエラー.{0,500}P.sCUBE/i.test(s)||
      (/500\s*[-–]\s*内部サーバエラー/i.test(s)&&/P.sCUBE|ピーズキューブ/i.test(s)),
    mentions_maintenance:/メンテナンス|アクセス集中|復旧/i.test(s),
    cloudflare_branded:/Cloudflare\s+Ray\s+ID|Attention Required!.*Cloudflare|Cloudflare\s*(?:Error|Access Denied)/is.test(s),
    cloudflare_error_1020:/Error\s*1020|Access\s+denied\s*Error\s*1020/i.test(s),
    browser_challenge:/Just a moment|Checking your browser|verify you are human|cf-chl-/i.test(s)
  };
}
function classify(status,headers,flags){
  if(status===403){
    if(flags.cloudflare_error_1020)return 'CF_ERROR_1020_BODY';
    if(flags.browser_challenge)return 'CHALLENGE_PAGE_SIGNATURE';
    if((headers['cf-mitigated']||'').toLowerCase()==='challenge')return 'CF_MITIGATED_CHALLENGE';
    if(flags.cloudflare_branded)return 'CF_BRANDED_403_UNVERIFIED_RULE';
    if(flags.mentions_pscube_500)return 'PSCUBE_BRANDED_500_BODY_WITH_HTTP403_ORIGIN_UNCONFIRMED';
    return 'HTTP403_ORIGIN_UNDETERMINED';
  }
  if([401,429].includes(status))return 'HTTP_RESTRICTED';
  if(status>=500)return 'HTTP_5XX';
  if(status===200)return 'HALL_DOCUMENT_200';
  return 'UNVERIFIED_HTTP_STATUS';
}
function offlineSelfTest(){
  const h={'server':'cloudflare','cf-ray':'sampleid'};
  const f=markers('<title>500 - 内部サーバエラー - P\u0027sCUBE（ピーズキューブ）</title>');
  if(!f.mentions_pscube_500||classify(403,h,f)!=='PSCUBE_BRANDED_500_BODY_WITH_HTTP403_ORIGIN_UNCONFIRMED')throw Error('offline classification test failed');
  if(classify(403,{},markers('<h1>Error 1020: Access denied</h1>'))!=='CF_ERROR_1020_BODY')throw Error('1020 class failed');
  if(classify(200,{},markers('OK'))!=='HALL_DOCUMENT_200')throw Error('200 class failed');
  console.log('OFFLINE_CLASSIFICATION_PASS 3');
}
async function main(){
  offlineSelfTest();
  if(process.env.ONLY_OFFLINE==='1')return;
  if(process.env.GITHUB_ACTIONS!=='true'||
     process.env.GITHUB_RUN_ATTEMPT!=='1'||
     process.env.GITHUB_REF!=='refs/heads/experiment/20261122-cloudflare-origin-one-shot'){
    console.error('STOP: Unauthorized run scope');process.exitCode=2;return;
  }
  const m={
    schema:'pscube_http403_attribution_one_shot_20261122',
    scope:'DMM legitimate normal page one top-level visit; no retries',
    started_at:new Date().toISOString(),
    dmm_status:null,
    hall_document_seen:false,
    hall_status:null,
    hall_path:null,
    response_received:false,
    header_flags:null,
    body_inspection:null,
    body_read_status:'NOT_ATTEMPTED',
    classification:'NOT_ATTEMPTED',
    retries:0,
    api_or_unit_requests_initiated:0,
    browser_closed:false
  };
  let browser;let resolver;let captured=false;
  const hallPromise=new Promise(resolve=>{resolver=resolve});
  try{
    browser=await chromium.launch({headless:false,channel:'chrome'});
    m.chrome_version=browser.version();
    const context=await browser.newContext({
      locale:'ja-JP',timezoneId:'Asia/Tokyo',viewport:{width:430,height:960}
    });
    context.on('response',response=>{
      if(captured||!isHallDocument(response))return;
      captured=true;
      resolver(response);
    });
    const page=await context.newPage();
    const nav=await page.goto(DMM,{waitUntil:'domcontentloaded',timeout:45000});
    m.dmm_status=nav?.status()??null;
    if(m.dmm_status!==200){m.classification='DMM_DOCUMENT_NOT_200';return}
    const response=await Promise.race([hallPromise,wait(12500).then(()=>null)]);
    if(!response){m.classification='NO_HALL_DOCUMENT_OBSERVED';return}
    m.hall_document_seen=true;
    m.hall_status=response.status();
    const u=new URL(response.url());
    m.hall_path=u.origin+u.pathname; // No query string
    m.response_received=true;
    let headers={};
    try{headers=await response.allHeaders()}catch{try{headers=response.headers()}catch{}}
    const s=String(headers.server||'').toLowerCase();
    m.header_flags={
      cf_ray_present:Boolean(headers['cf-ray']),
      cf_mitigated:String(headers['cf-mitigated']||'').toLowerCase()==='challenge',
      server_cloudflare:s.includes('cloudflare'),
      server_other:s.length>0&&!s.includes('cloudflare'),
      content_type_html:String(headers['content-type']||'').toLowerCase().includes('text/html'),
      cf_cache_status_present:Boolean(headers['cf-cache-status']),
      www_authenticate_present:Boolean(headers['www-authenticate'])
    };
    let bodyText='';
    try{
      const body=await Promise.race([response.body(),wait(3500).then(()=>null)]);
      if(body){
        m.body_read_status='AVAILABLE';
        bodyText=body.toString('utf8').slice(0,65536);
      }else{m.body_read_status='TIMEOUT_OR_EMPTY'}
    }catch{m.body_read_status='RESPONSE_BODY_UNAVAILABLE'}
    m.body_inspection=markers(bodyText);
    m.classification=classify(m.hall_status,headers,m.body_inspection);
  }catch(e){m.classification='BROWSER_OR_NAVIGATION_ERROR';m.error_type=e?.name||'Error'}
  finally{
    if(browser)try{await browser.close();m.browser_closed=true}catch{m.classification='BROWSER_CLOSE_FAILED'}
    m.finished_at=new Date().toISOString();
    fs.mkdirSync('evidence',{recursive:true});
    fs.writeFileSync('evidence/http403_attribution.json',JSON.stringify(m,null,2));
    // Only derived metadata, no body, headers, cookies, credential values, or Ray IDs.
    console.log('HTTP403_ATTRIBUTION '+JSON.stringify(m));
    if(m.classification!=='HALL_DOCUMENT_200')process.exitCode=2;
  }
}
main().catch(e=>{console.error('STOP: '+(e?.name||'Error'));process.exitCode=2});
