import { chromium } from 'playwright';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const url=process.env.APP_URL||'http://127.0.0.1:4174/exam-cleaner/';
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{})});
const context=await browser.newContext({viewport:{width:1440,height:1200}}),page=await context.newPage(),errors=[],checks=[];
page.on('pageerror',e=>errors.push(e.message));
const button=name=>page.getByRole('button',{name,exact:true});
const ready=async()=>{await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));return page.waitForFunction(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent==='確認匯出');return b&&!b.disabled;},null,{timeout:90000});};
const pixels=()=>page.evaluate(async()=>{const c=document.querySelector('.paper-stage canvas'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;return [...new Uint8Array(await crypto.subtle.digest('SHA-256',d))].map(v=>v.toString(16).padStart(2,'0')).join('');});
async function drag(rect){
 const count=await page.locator('.region-list>div').count();
 const canvas=page.getByLabel('考卷遮罩編輯區');await canvas.scrollIntoViewIfNeeded();
 await page.locator('.board').evaluate(e=>e.scrollTop=0);
 const b=await canvas.boundingBox();await page.mouse.move(b.x+b.width*rect.x,b.y+b.height*rect.y);await page.mouse.down();await page.mouse.move(b.x+b.width*(rect.x+rect.w),b.y+b.height*(rect.y+rect.h),{steps:6});await page.mouse.up();await page.waitForFunction(count=>document.querySelectorAll('.region-list>div').length===count+1,count);await ready();
}
async function ink(){return page.evaluate(()=>{const c=document.querySelector('.paper-stage canvas'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;return [40,140,240].map(x=>[...d.slice((60*c.width+x)*4,(60*c.width+x)*4+3)]);});}
try{
 await page.goto(url,{waitUntil:'networkidle'});
 const originalHash=await page.evaluate(async()=>{
  const c=document.createElement('canvas');c.width=300;c.height=420;const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,300,420);ctx.fillStyle='#b42c27';for(const x of [40,140,240])ctx.fillRect(x-3,50,7,25);
  ctx.fillStyle='#222';ctx.font='18px Arial';ctx.fillText('Keep this printed question',20,180);
  const blob=await new Promise(resolve=>c.toBlob(resolve));const n=300*420,hints={version:3,answerRegions:0};
  for(const key of ['confidence','colorInk','answerInk','structure','lineRepair','handInk','boldInk','printInk','picture'])hints[key]=new Uint8Array(n);
  const handwriting=new Float32Array(n),print=new Float32Array(n);
  for(const cx of [40,140,240])for(let y=50;y<75;y++)for(let x=cx-3;x<cx+4;x++){const i=y*300+x;handwriting[i]=cx===40?.99:.65;hints.confidence[i]=cx===40?252:166;hints.colorInk[i]=1;}
  const edit={threshold:.8,inkType:'auto',color:'none',protectPrint:true,allowNeutralInk:false,autoAnswers:true,repair:'paper',grow:true,region:null,strokes:[]};
  const draft={version:1,original:new File([blob],'synthetic-regions.png',{type:'image/png'}),work:blob,history:{past:[],present:edit,future:[]},ai:{handwriting,print,hints,elapsed:1,tiles:1},savedAt:Date.now()};
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('practice-again',1);r.onupgradeneeded=()=>r.result.createObjectStore('drafts');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  await new Promise((resolve,reject)=>{const tx=db.transaction('drafts','readwrite');tx.objectStore('drafts').put(draft,'current');tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});db.close();
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join('');
 });
 await page.reload();await page.getByRole('button',{name:/繼續編輯/}).click();await ready();const base=await pixels();
 assert.deepEqual(await ink(),[[255,255,255],[180,44,39],[180,44,39]]);
 await button('需要調整，進入半自動').click();assert.equal(await button('清除預覽').getAttribute('aria-pressed'),'true');assert.equal(await pixels(),base);checks.push('enter semi-auto on unchanged AI-cleaned preview');
 await page.locator('#region-threshold').press('Home');await button('藍筆').click();assert.equal(await pixels(),base);await button('AI 候選').click();checks.push('next-box threshold and color settings preserve existing result');
 await drag({x:.42,y:.1,w:.1,h:.1});await page.getByText('已套用 1 個框選',{exact:true}).waitFor();const first=await pixels();assert.deepEqual(await ink(),[[255,255,255],[255,255,255],[180,44,39]]);
 await drag({x:.75,y:.1,w:.1,h:.1});await page.getByText('已套用 2 個框選',{exact:true}).waitFor();const both=await pixels();assert.deepEqual(await ink(),[[255,255,255],[255,255,255],[255,255,255]]);checks.push('two separate supplementary boxes accumulate without restoring earlier AI or local cleaning');
 await button('框選還原原圖').click();await drag({x:.1,y:.1,w:.1,h:.1});const restored=await pixels();assert.deepEqual(await ink(),[[180,44,39],[255,255,255],[255,255,255]]);checks.push('restore box returns original ink only in selected area');
 await button('復原').click();await ready();assert.equal(await pixels(),both);await button('重做').click();await ready();assert.equal(await pixels(),restored);checks.push('region undo and redo are pixel-exact');
 await button('移除第 1 個框選').click();await ready();assert.deepEqual(await ink(),[[180,44,39],[180,44,39],[255,255,255]]);await button('復原').click();await ready();assert.equal(await pixels(),restored);checks.push('remove one region while retaining the other regions; removal is undoable');
 await button('需要精修，進入手動').click();assert.equal(await button('清除預覽').getAttribute('aria-pressed'),'true');assert.equal(await pixels(),restored);checks.push('manual step retains accumulated cleaned preview');
 await button('儲存進度').click();await page.getByText(/編輯進度已儲存在此瀏覽器/).waitFor();
 const saved=await page.evaluate(async()=>{
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('practice-again',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});const d=await new Promise((resolve,reject)=>{const r=db.transaction('drafts').objectStore('drafts').get('current');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});db.close();
  return {originalHash:[...new Uint8Array(await crypto.subtle.digest('SHA-256',await d.original.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join(''),tools:d.history.present.strokes.map(s=>s.tool),typedMasks:d.history.present.strokes.filter(s=>s.tool==='region').every(s=>s.mask instanceof Uint8Array&&s.mask.some(Boolean)),region:d.history.present.region};
 });
 assert.equal(saved.originalHash,originalHash);assert.deepEqual(saved.tools,['region','region','restore-region']);assert.equal(saved.typedMasks,true);assert.equal(saved.region,null);checks.push('original bytes and independently captured region masks saved in IndexedDB');
 await page.reload();await page.getByRole('button',{name:/繼續編輯/}).click();await ready();assert.equal(await pixels(),restored);checks.push('reload restores all region operations and exact cleaned pixels');
 await page.getByText('工具與 AI 已可離線使用',{exact:true}).waitFor({timeout:90000});await context.setOffline(true);await page.reload();await page.getByRole('button',{name:/繼續編輯/}).click();await ready();assert.equal(await pixels(),restored);checks.push('offline reload restores regional edits');await context.setOffline(false);
 await button('需要調整，進入半自動').click();await page.getByText('已套用 3 個框選',{exact:true}).waitFor();
 for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}checks.push('multi-region controls fit 320, 390, 768 and 1440px layouts');
 // A second synthetic draft exercises faint ink rejected by both model confidence and the old saturation gate.
 await page.setViewportSize({width:1440,height:1200});
 await page.evaluate(async()=>{
  const c=document.createElement('canvas');c.width=300;c.height=420;const ctx=c.getContext('2d');ctx.fillStyle='rgb(224,216,199)';ctx.fillRect(0,0,300,420);
  ctx.fillStyle='rgb(195,188,173)';ctx.fillRect(35,50,2,22);ctx.fillStyle='rgb(215,188,174)';ctx.fillRect(50,50,2,22);
  for(let k=1;k<9;k++)ctx.fillRect(40+(k%3)*100,50+Math.floor(k/3)*80,2,22);
  ctx.fillStyle='rgb(190,188,199)';ctx.fillRect(240,290,2,22);ctx.fillStyle='#222';ctx.font='18px Arial';ctx.fillText('Printed question stays',20,360);
  const blob=await new Promise(resolve=>c.toBlob(resolve)),n=300*420,hints={version:3,answerRegions:0};
  for(const key of ['confidence','colorInk','answerInk','structure','lineRepair','handInk','boldInk','printInk','picture'])hints[key]=new Uint8Array(n);
  const workbook={version:1,modelRevision:2,confidence:new Uint8Array(n),keep:new Uint8Array(n).fill(1),lines:new Uint8Array(n),crossings:new Uint8Array(n)};
  const edit={threshold:.9,inkType:'workbook',color:'none',protectPrint:true,allowNeutralInk:false,autoAnswers:true,repair:'texture',grow:true,region:null,strokes:[]};
  const draft={version:1,original:new File([blob],'synthetic-faint-ink.png',{type:'image/png'}),work:blob,history:{past:[],present:edit,future:[]},ai:{handwriting:new Float32Array(n),print:new Float32Array(n),hints,workbook,elapsed:1,tiles:1},savedAt:Date.now()};
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('practice-again',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  await new Promise((resolve,reject)=>{const tx=db.transaction('drafts','readwrite');tx.objectStore('drafts').put(draft,'current');tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});db.close();
 });
 await page.reload();await page.getByRole('button',{name:/繼續編輯/}).click();await ready();await button('需要調整，進入半自動').click();
 await page.locator('#region-threshold').press('Home');await button('鉛筆').click();
 const assertPaper=(rgb,label='cleared pixel matches paper')=>assert.ok(rgb.every((v,i)=>Math.abs(v-[224,216,199][i])<=3),`${label}: ${rgb}`);
 const sample=async(x,y)=>page.evaluate(({x,y})=>{const c=document.querySelector('.paper-stage canvas');return [...c.getContext('2d').getImageData(x,y,1,1).data].slice(0,3);},{x,y});
 await drag({x:25/300,y:45/420,w:40/300,h:33/420});assertPaper(await sample(35,60));assert.deepEqual(await sample(50,60),[215,188,174]);const pencilOnly=await pixels();checks.push('explicit pencil removes low-confidence neutral ink on warm paper without removing nearby red');
 await button('紅筆').click();await button('重新套用第 1 個框選').click();await ready();const mixed=await pixels();assertPaper(await sample(35,60));assertPaper(await sample(50,60));assert.equal(await page.locator('.region-list>div').count(),1);checks.push('reapply adds red candidates to the same frame and preserves its earlier pencil cleanup');
 await button('藍筆').click();await button('重新套用第 1 個框選').click();await ready();assert.equal(await pixels(),mixed);checks.push('reapply with no new matching candidates keeps existing cleanup');
 await button('復原').click();await ready();assert.equal(await pixels(),mixed);await button('復原').click();await ready();assert.equal(await pixels(),pencilOnly);await button('重做').click();await ready();assert.equal(await pixels(),mixed);checks.push('reapply can be undone and redone without mutating earlier history');
 await button('紅筆').click();
 for(let k=1;k<9;k++){const x=40+(k%3)*100,y=50+Math.floor(k/3)*80;await drag({x:(x-8)/300,y:(y-5)/420,w:20/300,h:33/420});assertPaper(await sample(x,y+10),`faded red frame ${k+1}`);}
 assert.equal(await page.locator('.region-list>div').count(),9);assertPaper(await sample(35,60));checks.push('nine successive frames clear faded red including frames 7–9 while preserving the first frame');
 await button('藍筆').click();await drag({x:232/300,y:285/420,w:20/300,h:33/420});assertPaper(await sample(240,300));checks.push('explicit blue removes faded blue on warm paper');
 await button('框選還原原圖').click();await drag({x:25/300,y:45/420,w:40/300,h:33/420});const withRestore=await pixels();assert.deepEqual(await sample(35,60),[195,188,173]);assert.deepEqual(await sample(50,60),[215,188,174]);
 await button('框選補清除').click();await button('紅筆').click();await button('重新套用第 1 個框選').click();await ready();assert.equal(await pixels(),withRestore);checks.push('reapply keeps later restore-frame operation in control');
 await button('儲存進度').click();await page.getByText(/編輯進度已儲存在此瀏覽器/).waitFor();await page.reload();await page.getByRole('button',{name:/繼續編輯/}).click();await ready();assert.equal(await pixels(),withRestore);checks.push('faint-ink masks, cumulative reapply and later restoration survive saved-state reload');
 await button('需要調整，進入半自動').click();
 for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}checks.push('five ink targets and reapply buttons fit narrow and desktop screens');
 await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/regions-qa.png',fullPage:true});assert.deepEqual(errors,[]);
 const report={success:true,version:JSON.parse(await readFile('package.json','utf8')).version,checks,saved,errors};await writeFile('test-results/regions-qa.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(e){await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/regions-qa-failure.png',fullPage:true});console.log('CHECKS',checks);console.log('STATE',await page.locator('.region-count').innerText().catch(()=>''),await page.locator('.mask-summary').innerText().catch(()=>''));throw e;}finally{await browser.close();}
