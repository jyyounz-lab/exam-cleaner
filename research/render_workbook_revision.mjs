import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
const root=process.argv[2];if(!root)throw new Error('Pass the private augmented dataset');
const pipeline=createHash('sha256');
for(const file of ['src/ai.worker.ts','src/core.ts','src/workbook.ts','src/inkFeatures.ts','src/processor.ts','public/cv.worker.v4.js','public/models/workbook-ink-v2.json'])pipeline.update(await fs.readFile(file));
const pipelineHash=pipeline.digest('hex');
const pairs=JSON.parse(await fs.readFile(path.join(root,'manifest.json'),'utf8')).pairs.filter(p=>p.id.endsWith('-w1108')||p.sourcePage==='page21');
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{})});
const page=await browser.newPage(),errors=[],sent=[],reports=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))sent.push(r.url());});
try{
 await page.goto('http://127.0.0.1:4173/');
 for(const pair of pairs){
  const dir=path.join(root,pair.id),png=(await fs.readFile(path.join(dir,'original.png'))).toString('base64'),labels=(await fs.readFile(path.join(dir,'labels'))).toString('base64'),verified=(await fs.readFile(path.join(dir,'verified'))).toString('base64');
  const r=await page.evaluate(async({png,labels,verified})=>{
   const {analyse}=await import('/src/ai.ts'),{composeMask,initialEdit,sauvola}=await import('/src/core.ts'),{processImage}=await import('/src/processor.ts'),{analyseWorkbook,validateWorkbookModel}=await import('/src/workbook.ts');
   const decode=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0)),bitmap=await createImageBitmap(new Blob([decode(png)],{type:'image/png'})),c=document.createElement('canvas');c.width=bitmap.width;c.height=bitmap.height;c.getContext('2d').drawImage(bitmap,0,0);bitmap.close();
   const input=c.getContext('2d').getImageData(0,0,c.width,c.height),ai=await analyse(input,()=>{}).promise;
   const old=analyseWorkbook(input,ai,sauvola(input),validateWorkbookModel(await(await fetch('/models/workbook-ink.json')).json()));
   const edit={...initialEdit(),inkType:'workbook',threshold:.9},masks=composeMask(input,edit,ai),previous=composeMask(input,edit,{...ai,workbook:old});
   const truth=decode(labels),keep=decode(verified);
   const metric=mask=>{let hand=0,selected=0,printed=0,damaged=0,confirmed=0,confirmedDamaged=0;for(let i=0;i<truth.length;i++){if(truth[i]===1){hand++;selected+=!!mask[i];}if(truth[i]===0){printed++;damaged+=!!mask[i];}if(keep[i]===0){confirmed++;confirmedDamaged+=!!mask[i];}}return{hand,selected,printed,damaged,confirmed,confirmedDamaged};};
   const output=await processImage('clean',input,{mask:masks.mask,repair:'texture',guides:ai.workbook.lines,guideRepair:masks.guideRepair});
   let outside=0;for(let i=0;i<truth.length;i++)if(!masks.mask[i]&&[0,1,2,3].some(k=>input.data[i*4+k]!==output.data[i*4+k]))outside++;
   c.getContext('2d').putImageData(output,0,0);
   return {revision:ai.workbook.modelRevision,before:metric(previous.mask),after:metric(masks.mask),outside,png:c.toDataURL(),jpg:c.toDataURL('image/jpeg',.95)};
  },{png,labels,verified});
  for(const ext of ['png','jpg']){await fs.writeFile(path.join(dir,`browser-clean.${ext}`),Buffer.from(r[ext].split(',')[1],'base64'));delete r[ext];}
  assert.equal(r.revision,2);assert.equal(r.outside,0);assert.ok(r.after.damaged/r.after.printed<.005,`${pair.id}: excessive labeled print damage`);
  if(r.after.confirmed)assert.equal(r.after.confirmedDamaged,0,`${pair.id}: confirmed printed exemplars must survive`);
  if(pair.id==='page21-w1500')assert.ok(r.after.selected>r.before.selected,'reported large-image case must improve');
  const report={...pair,...r,pipelineHash};reports.push(report);
  await fs.writeFile(path.join(dir,'browser-case.json'),JSON.stringify(report,null,2));console.log(pair.id,JSON.stringify(r));
 }
 assert.deepEqual(errors,[]);assert.deepEqual(sent,[]);
 await fs.writeFile(path.join(root,'browser-report.json'),JSON.stringify({success:true,kind:'development-regression-on-sparse-labels-and-confirmed-exemplars-not-blind-accuracy',reports,errors,sent},null,2));
}finally{await browser.close();}
