'use strict';
// One authorized navigation to DMM's public Hattori hall page.
// Only click visibly observed UI controls. No direct/guessed P's CUBE URL, retries,
// proxy/UA/IP changes, authentication circumvention, or raw page/data retention.
const fs=require('node:fs');
const assert=require('node:assert/strict');
const ENTRY='https://p-town.dmm.com/shops/osaka/7713/jackpot';
const DMM='https://p-town.dmm.com';
const HALL='https://www.pscube.jp';
const PREFIX='/dedamajyoho-P-townDMMpachi/c762502/';
function parsed(v){try{return new URL(v)}catch{return null}}
function isDMM(v){const u=parsed(v);return u?.origin===DMM&&u.pathname.startsWith('/shops/osaka/7713/')}
function isHall(v){const u=parsed(v);return u?.origin===HALL&&u.pathname.startsWith(PREFIX)}
function pathOnly(v){const u=parsed(v);return u&&(isDMM(v)||isHall(v))?u.origin+u.pathname:'other'}
function classify(status){if([401,403,429].includes(status))return 'HTTP_RESTRICTED';if(status>=500)return 'HTTP_5XX';if(status===200)return 'HTTP_200';return 'HTTP_UNVERIFIED'}
function blocked(text){return /500\s*[-–]\s*内部サーバ|access denied|forbidden|captcha|verify you are human|認証が必要|アクセス拒否|接続が拒否されました|このページは表示できません/i.test(text||'')}
function norm(s){return String(s||'').normalize('NFKC').replace(/\s+/g,'')}
function choose(items){const a=items.filter(x=>x.visible===true&&norm(x.label).includes('パチンコデータ'));return a.length===1?{ok:true,index:a[0].index,href:a[0].href}:{ok:false,reason:a.length?'AMBIGUOUS_DATA_CONTROLS':'DATA_CONTROL_NOT_FOUND'}}
function offlineTests(){
 assert.equal(isDMM(ENTRY),true);
 assert.equal(isHall('https://www.pscube.jp/dedamajyoho-P-townDMMpachi/c762502/'),true);
 assert.equal(isHall('https://other.invalid/dedamajyoho-P-townDMMpachi/c762502/'),false);
 assert.equal(classify(403),'HTTP_RESTRICTED');
 assert.equal(classify(500),'HTTP_5XX');
 assert.equal(classify(200),'HTTP_200');
 assert.equal(blocked('500 - 内部サーバエラー - P’s CUBE'),true);
 assert.equal(choose([{index:2,label:'パチンコデータ',visible:true,href:'#'}]).index,2);
 assert.equal(choose([{index:2,label:'パチンコデータ',visible:true},{index:3,label:'パチンコデータ',visible:true}]).reason,'AMBIGUOUS_DATA_CONTROLS');
 assert.equal(pathOnly('https://www.pscube.jp/dedamajyoho-P-townDMMpachi/c762502/?token=hidden'),'https://www.pscube.jp/dedamajyoho-P-townDMMpachi/c762502/');
 return 10;
}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
 const testCount=offlineTests();
 if(process.env.DIAGNOSTIC_OFFLINE==='1'){console.log('OFFLINE_PREFLIGHT_PASS '+testCount);return}
 // This particular live authorization was consumed by the initial run.
 if(process.env.GITHUB_RUN_ID!=='44962916748'){console.error('STOP: RUN_ALREADY_USED');process.exitCode=2;return}
 const {chromium}=require('playwright');
 fs.mkdirSync('evidence',{recursive:true});
 const m={version:'dmm-ui-one-shot-20261122-v1',start_utc:new Date().toISOString(),entry:ENTRY,stage:'start',status:'started',verdict:null,dmm_document_status:null,pscube_document_statuses:[],pscube_api_responses:0,ui_click_count:0,scroll_count:0,important_failures:[],browser_closed:false,raw_data_saved:false,retries:0};
 let browser,context,page,fatal=null,hallFrame=null;
 const stop=c=>{fatal=fatal||c};
 const record=(u,status,kind)=>{if(m.important_failures.length<10)m.important_failures.push({path:pathOnly(u),status,kind})};
 try{
  browser=await chromium.launch({headless:true});
  context=await browser.newContext({locale:'ja-JP',timezoneId:'Asia/Tokyo',viewport:{width:430,height:960}});
  context.on('response',response=>{
   try{
    const u=response.url(),status=response.status(),type=response.request().resourceType();
    if(isHall(u)){
     if(type==='document'&&m.pscube_document_statuses.length<8)m.pscube_document_statuses.push({path:pathOnly(u),status});
     if(['xhr','fetch'].includes(type))m.pscube_api_responses++;
     if([401,403,429].includes(status)||status>=500){record(u,status,type);stop('PSCUBE_'+classify(status))}
    }else if(isDMM(u)&&type==='document'&&[401,403,429].includes(status)){
     record(u,status,'document');stop('DMM_'+classify(status))
    }
   }catch{stop('RESPONSE_INSPECTION_FAILED')}
  });
  context.on('requestfailed',request=>{try{if(isHall(request.url())&&['document','xhr','fetch'].includes(request.resourceType())){record(request.url(),null,request.resourceType());stop('PSCUBE_NETWORK_ERROR')}}catch{stop('REQUEST_INSPECTION_FAILED')}});
  page=await context.newPage();
  m.stage='dmm_document';
  const resp=await page.goto(ENTRY,{waitUntil:'domcontentloaded',timeout:45000});
  m.dmm_document_status=resp?.status()??null;
  if(m.dmm_document_status!==200)stop('DMM_'+classify(m.dmm_document_status));
  if(fatal)throw Error(fatal);
  const mainText=await page.locator('body').innerText({timeout:6000});
  if(blocked(mainText))stop('DMM_ERROR_PAGE');
  if(!/服部会館/.test(mainText))stop('DMM_STORE_NOT_VERIFIED');
  if(fatal)throw Error(fatal);
  m.stage='dmm_ui_discovery';
  const deadline=Date.now()+24000;let clicked=false,scrolled=false;
  while(Date.now()<deadline){
   if(fatal)throw Error(fatal);
   const frames=context.pages().flatMap(p=>p.frames());
   const hall=frames.filter(f=>isHall(f.url()));
   if(hall.length>1){stop('MULTIPLE_HALL_FRAMES');throw Error(fatal)}
   if(hall.length===1){
    hallFrame=hall[0];m.stage='hall_document_observed';
    let text='';try{text=await hallFrame.locator('body').innerText({timeout:1800})}catch{}
    if(fatal)throw Error(fatal);
    if(blocked(text)){stop('HALL_ERROR_PAGE');throw Error(fatal)}
    if(/パチンコデータ|スロットデータ|機種名で探す/.test(text)){m.status='confirmed';m.verdict='HALL_UI_REACHED';break}
   }
   if(!clicked){
    const all=[];
    for(const f of frames.filter(f=>isDMM(f.url()))){
     const items=await f.locator('a,button,[role="button"],input[type="button"]').evaluateAll(els=>els.map((el,index)=>{
       const r=el.getBoundingClientRect(),s=window.getComputedStyle(el);
       return {index,label:el.getAttribute('aria-label')||el.innerText||el.getAttribute('alt')||el.value||'',href:el.tagName==='A'?el.href:null,visible:r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'}
     })).catch(()=>[]);
     const chosen=choose(items);
     if(chosen.ok)all.push({frame:f,chosen});
     else if(chosen.reason==='AMBIGUOUS_DATA_CONTROLS'){stop('AMBIGUOUS_DMM_CONTROLS');throw Error(fatal)}
    }
    if(all.length>1){stop('MULTIPLE_DMM_DATA_CONTROLS');throw Error(fatal)}
    if(all.length===1){
     const {frame,chosen}=all[0];
     if(chosen.href){
      const u=parsed(chosen.href);
      if(!u||![DMM,HALL].includes(u.origin)||(u.origin===HALL&&!isHall(chosen.href))){stop('UNEXPECTED_CONTROL_TARGET');throw Error(fatal)}
     }
     m.stage='visible_pachinko_data_control';
     await frame.locator('a,button,[role="button"],input[type="button"]').nth(chosen.index).click({timeout:9000});
     m.ui_click_count++;clicked=true;m.stage='ui_control_clicked';await wait(700);continue;
    }
   }
   if(!scrolled){
    const found=[];
    for(const f of frames.filter(f=>isDMM(f.url()))){
     const items=await f.locator('iframe').evaluateAll(els=>els.map((el,index)=>({index,src:el.getAttribute('src')||el.getAttribute('data-src')||'',width:el.getBoundingClientRect().width}))).catch(()=>[]);
     for(const it of items)if(it.src.includes('pscube.jp')&&it.width>0)found.push({f,index:it.index});
    }
    if(found.length===1){await found[0].f.locator('iframe').nth(found[0].index).scrollIntoViewIfNeeded({timeout:5000});m.scroll_count++;scrolled=true;await wait(500);continue}
    if(found.length>1){stop('MULTIPLE_HALL_IFRAMES');throw Error(fatal)}
   }
   await wait(500);
  }
  if(m.status!=='confirmed'){stop(hallFrame?'HALL_CONTENT_UNVERIFIED':'DMM_UI_NO_HALL_REACHED');throw Error(fatal)}
 }catch(e){m.status='stopped';m.verdict=fatal||'UNEXPECTED_BROWSER_ERROR'}
 finally{
  if(browser){try{await browser.close();m.browser_closed=true}catch{m.status='stopped';m.verdict='BROWSER_CLOSE_FAILED'}}
  m.end_utc=new Date().toISOString();
  fs.writeFileSync('evidence/manifest.json',JSON.stringify(m,null,2));
  console.log('DMM_UI_ONESHOT_RESULT '+JSON.stringify({status:m.status,verdict:m.verdict,stage:m.stage,dmm_document_status:m.dmm_document_status,pscube_document_statuses:m.pscube_document_statuses,pscube_api_responses:m.pscube_api_responses,ui_click_count:m.ui_click_count,scroll_count:m.scroll_count,browser_closed:m.browser_closed,retries:m.retries}));
  if(m.status!=='confirmed')process.exitCode=2;
 }
}
if(require.main===module)main().catch(e=>{console.error('STOP: setup error',e?.name||'Error');process.exitCode=2});
module.exports={offlineTests,isDMM,isHall,pathOnly,classify,blocked,choose};
