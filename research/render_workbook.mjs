import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const root=process.argv[2];if(!root)throw new Error('Pass private dataset directory');
const manifest=JSON.parse(await fs.readFile(path.join(root,'manifest.json'),'utf8'));
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{})});
const page=await browser.newPage(),errors=[],sent=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))sent.push(r.url());});
const reports=[];
try{
  await page.goto('http://127.0.0.1:4173/');
  for(const pair of manifest.pairs){
    const dir=path.join(root,pair.id),png=(await fs.readFile(path.join(dir,'original.png'))).toString('base64'),labels=(await fs.readFile(path.join(dir,'labels'))).toString('base64');
    const result=await page.evaluate(async({png,labels})=>{
      const {analyse}=await import('/src/ai.ts'),{composeMask,initialEdit}=await import('/src/core.ts'),{processImage}=await import('/src/processor.ts');
      const bytes=Uint8Array.from(atob(png),c=>c.charCodeAt(0)),bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'})),canvas=document.createElement('canvas');
      canvas.width=bitmap.width;canvas.height=bitmap.height;canvas.getContext('2d').drawImage(bitmap,0,0);bitmap.close();
      const input=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height),started=performance.now(),ai=await analyse(input,()=>{}).promise;
      const masks=composeMask(input,{...initialEdit(),inkType:'workbook',threshold:.9},ai);
      const output=await processImage('clean',input,{mask:masks.mask,repair:'texture',guides:ai.workbook.lines,guideRepair:masks.guideRepair});
      const baseline=composeMask(input,initialEdit(),ai),truth=Uint8Array.from(atob(labels),c=>c.charCodeAt(0));
      const metric=mask=>{let hand=0,selected=0,keep=0,damaged=0;for(let i=0;i<truth.length;i++){if(truth[i]===1){hand++;selected+=!!mask[i];}if(truth[i]===0){keep++;damaged+=!!mask[i];}}return{hand,selected,coverage:selected/Math.max(1,hand),keep,damaged,damageRate:damaged/Math.max(1,keep)};};
      let outside=0;for(let i=0;i<truth.length;i++)if(!masks.mask[i]&&[0,1,2,3].some(c=>input.data[i*4+c]!==output.data[i*4+c]))outside++;
      canvas.getContext('2d').putImageData(output,0,0);
      return{elapsedMs:Math.round(performance.now()-started),inferenceMs:Math.round(ai.elapsed),before:metric(baseline.mask),after:metric(masks.mask),outside,guideCrossingPixels:masks.guideRepair.reduce((a,b)=>a+b,0),png:canvas.toDataURL(),jpg:canvas.toDataURL('image/jpeg',.95)};
    },{png,labels});
    for(const type of ['png','jpg']){await fs.writeFile(path.join(dir,`browser-clean.${type}`),Buffer.from(result[type].split(',')[1],'base64'));delete result[type];}
    reports.push({page:pair.id,split:pair.split,...result});console.log(pair.id,JSON.stringify(result));
  }
  assert.equal(errors.length,0);assert.equal(sent.length,0);
  for(const r of reports){assert.equal(r.outside,0);assert.ok(r.after.coverage>r.before.coverage,`${r.page}: no improvement in labeled handwriting`);assert.ok(r.after.damageRate<.005,`${r.page}: labeled print damage above 0.5%`);assert.ok(r.after.damaged<r.before.damaged);}
  await fs.writeFile(path.join(root,'browser-report.json'),JSON.stringify({success:true,kind:'sparse-weak-labels-and-visual-review-not-general-accuracy',reports,errors,sent},null,2));
}finally{await browser.close();}
