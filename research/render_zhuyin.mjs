import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const root=process.argv[2];if(!root)throw new Error('Pass the private combined dataset');
const origin=process.env.DEV_URL||'http://127.0.0.1:4175';
const pairs=JSON.parse(await fs.readFile(path.join(root,'manifest.json'),'utf8')).pairs.filter(p=>p.id.startsWith('zh')&&!p.id.endsWith('-w900')&&!p.id.endsWith('-w1500'));
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{})});
const page=await browser.newPage(),reports=[],errors=[],sent=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))sent.push(r.url());});
try{
  await page.goto(origin);
  for(const pair of pairs){
    const d=pair.directory,png=(await fs.readFile(path.join(d,'original.png'))).toString('base64'),labels=(await fs.readFile(path.join(d,'labels'))).toString('base64');
    const r=await page.evaluate(async({png,labels})=>{
      const {analyse}=await import('/src/ai.ts'),{composeMask,initialEdit,sauvola}=await import('/src/core.ts'),{processImage}=await import('/src/processor.ts'),{analyseWorkbook,validateWorkbookModel}=await import('/src/workbook.ts');
      const decode=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
      const bitmap=await createImageBitmap(new Blob([decode(png)],{type:'image/png'})),c=document.createElement('canvas');c.width=bitmap.width;c.height=bitmap.height;c.getContext('2d').drawImage(bitmap,0,0);bitmap.close();
      const input=c.getContext('2d').getImageData(0,0,c.width,c.height),ai=await analyse(input,()=>{},true).promise;
      const old=analyseWorkbook(input,ai,sauvola(input),validateWorkbookModel(await(await fetch('/models/workbook-ink-v2.json')).json()));
      const masks=composeMask(input,{...initialEdit(),inkType:'zhuyin',threshold:.96},ai),previous=composeMask(input,{...initialEdit(),inkType:'workbook',threshold:.9},{...ai,workbook:old}),truth=decode(labels);
      const metric=mask=>{let hand=0,selected=0,keep=0,damaged=0;for(let i=0;i<truth.length;i++){if(truth[i]===1){hand++;selected+=!!mask[i];}if(truth[i]===0){keep++;damaged+=!!mask[i];}}return{hand,selected,keep,damaged};};
      const output=await processImage('clean',input,{mask:masks.mask,repair:'texture',guides:ai.workbook.lines,guideRepair:masks.guideRepair});
      let outside=0;for(let i=0;i<truth.length;i++)if(!masks.mask[i]&&[0,1,2,3].some(k=>input.data[i*4+k]!==output.data[i*4+k]))outside++;
      c.getContext('2d').putImageData(output,0,0);
      return{revision:ai.workbook.modelRevision,elapsed:ai.elapsed,before:metric(previous.mask),after:metric(masks.mask),outside,png:c.toDataURL(),jpg:c.toDataURL('image/jpeg',.95)};
    },{png,labels});
    for(const ext of ['png','jpg']){await fs.writeFile(path.join(d,`final-browser.${ext}`),Buffer.from(r[ext].split(',')[1],'base64'));delete r[ext];}
    assert.equal(r.revision,3);assert.equal(r.outside,0);assert.ok(r.after.damaged/r.after.keep<.005,`${pair.id}: retained ink regression`);
    assert.ok(r.after.selected>=r.before.selected,`${pair.id}: handwriting coverage regression`);
    assert.ok(r.after.damaged<=r.before.damaged,`${pair.id}: printed ink selection regression`);
    reports.push({...pair,...r});console.log(pair.id,JSON.stringify(r));
  }
  assert.deepEqual(errors,[]);assert.deepEqual(sent,[]);
  await fs.writeFile(path.join(root,'zhuyin-browser-report.json'),JSON.stringify({success:true,kind:'development regression on sparse registered labels; not blind or whole-page accuracy',reports,errors,sent},null,2));
}finally{await browser.close();}
