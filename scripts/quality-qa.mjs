import { chromium } from 'playwright';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {}), headless: true });
const page = await browser.newPage(); page.on('console', m => { if (m.type() === 'error') console.log('BROWSER ERROR', m.text()); });
await mkdir('test-results', { recursive: true });
const baselineCommit='c94ea035d1c1eaed601c3db211b610810cd9f1bb';
await writeFile('test-results/baseline-core.ts',execFileSync('git',['show',`${baselineCommit}:src/core.ts`],{encoding:'utf8'}));
try {
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
  const fixtures = JSON.parse(await readFile('tests/fixtures/quality-fixtures.json', 'utf8')).fixtures;
  const reports = [];
  for (const fixture of fixtures) {
    console.log(`Evaluating ${fixture.id}: actual ONNX + selection + paper restoration`);
    const result = await page.evaluate(async fixture => {
      const { analyse } = await import('/src/ai.ts'), core = await import('/src/core.ts'), old = await import('/test-results/baseline-core.ts'), { processImage } = await import('/src/processor.ts');
      const read = async path => { const blob = await (await fetch('/'+path)).blob(), bitmap = await createImageBitmap(blob), c = document.createElement('canvas'); c.width=bitmap.width;c.height=bitmap.height;const ctx=c.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();return ctx.getImageData(0,0,c.width,c.height); };
      const input=await read(fixture.marked), clean=await read(fixture.clean), ink=await read(fixture.inkMask), printed=await read(fixture.printMask);
      const ai = await analyse(input,()=>{}).promise;
      const beforeMask = old.composeMask(input,old.initialEdit(),ai).mask, afterMask=core.composeMask(input,core.initialEdit(),ai).mask;
      const before = await new Promise((resolve,reject)=>{const worker=new Worker('/cv.worker.js');worker.onmessage=e=>{worker.terminate();e.data.error?reject(new Error(e.data.error)):resolve(new ImageData(e.data.pixels,e.data.width,e.data.height));};worker.onerror=reject;worker.postMessage({id:1,kind:'clean',image:input,mask:beforeMask});});
      const after=await processImage('clean',input,{mask:afterMask,repair:'paper',structure:ai.hints?.structure,lineRepair:ai.hints?.lineRepair});
      function metrics(result,mask,roi=[0,0,input.width,input.height]) {
        let initialError=0,error=0,inkPixels=0,covered=0,printPixels=0,changedPrint=0,outside=0;
        for(let y=roi[1];y<roi[3];y++)for(let x=roi[0];x<roi[2];x++){const i=y*input.width+x,p=i*4;const diff=[0,1,2].reduce((s,c)=>s+Math.abs(result.data[p+c]-clean.data[p+c]),0), changed=[0,1,2,3].some(c=>result.data[p+c]!==input.data[p+c]);
          if(ink.data[p]>16&&printed.data[p]<8){initialError += [0,1,2].reduce((s,c)=>s+Math.abs(input.data[p+c]-clean.data[p+c]),0);error+=diff;inkPixels++;if(mask[i])covered++;}
          if(printed.data[p]>32&&ink.data[p]===0){printPixels++;if(changed)changedPrint++;}if(!mask[i]&&changed)outside++;
        }
        return {inkPixels,selectedInk:covered,coverage:covered/Math.max(1,inkPixels),inkErrorRemoved:1-error/Math.max(1,initialError),printPixels,changedPrint,pixelsChangedOutsideMask:outside};
      }
      const png = image => {const c=document.createElement('canvas');c.width=image.width;c.height=image.height;c.getContext('2d').putImageData(image,0,0);return c.toDataURL('image/png');};
      return {id:fixture.id,regions:ai.hints?.answerRegions,elapsed:ai.elapsed,before:metrics(before,beforeMask),after:metrics(after,afterMask),perRegion:fixture.regions.map(r=>({name:r.name,before:metrics(before,beforeMask,r.roi),after:metrics(after,afterMask,r.roi)})),images:{before:png(before),after:png(after)}};
    }, fixture);
    for (const [key,data] of Object.entries(result.images)) await writeFile(`test-results/quality-${fixture.id}-${key}.png`, Buffer.from(data.split(',')[1],'base64'));
    delete result.images; reports.push(result); console.log(JSON.stringify(result,null,2));
  }
  await writeFile('test-results/quality-qa.json',JSON.stringify(reports,null,2));
  const lineCheck=await page.evaluate(async()=>{
    const {refineInk}=await import('/src/refine.ts'),{sauvola,composeMask,initialEdit}=await import('/src/core.ts'),{processImage}=await import('/src/processor.ts');
    const c=document.createElement('canvas');c.width=400;c.height=300;const x=c.getContext('2d');x.fillStyle='#fffdf8';x.fillRect(0,0,400,300);x.strokeStyle='#333333';x.lineWidth=2;x.beginPath();x.moveTo(40,180);x.lineTo(350,180);x.stroke();const clean=x.getImageData(0,0,400,300);
    x.strokeStyle='#1c50bd';x.lineWidth=4;x.beginPath();x.moveTo(180,120);x.lineTo(180,215);x.stroke();const image=x.getImageData(0,0,400,300),raw={handwriting:new Float32Array(120000).fill(.99),print:new Float32Array(120000)},hints=refineInk(image,raw,sauvola(image)),masks=composeMask(image,initialEdit(),{...raw,hints});
    const result=await processImage('clean',image,{mask:masks.mask,repair:'paper',structure:hints.structure,lineRepair:hints.lineRepair});let restored=0,damaged=0;
    for(let yy=179;yy<=180;yy++)for(let xx=40;xx<350;xx++){const p=(yy*400+xx)*4;const differs=[0,1,2].some(k=>result.data[p+k]!==clean.data[p+k]);if(differs)damaged++;if(hints.lineRepair[yy*400+xx]&&masks.mask[yy*400+xx])restored++;}
    return{restoredCrossingPixels:restored,incorrectLinePixels:damaged};
  });
  assert.ok(lineCheck.restoredCrossingPixels>0);assert.equal(lineCheck.incorrectLinePixels,0);await writeFile('test-results/line-repair-qa.json',JSON.stringify(lineCheck,null,2));console.log('LINE REPAIR',lineCheck);
  for(const r of reports){assert.ok(r.after.inkErrorRemoved>=.97,`${r.id}: background restoration below regression target`);assert.ok(r.after.coverage>=.98,`${r.id}: incomplete handwriting mask`);assert.equal(r.after.changedPrint,0,`${r.id}: printed content damaged`);assert.equal(r.after.pixelsChangedOutsideMask,0);for(const region of r.perRegion)assert.ok(region.after.inkErrorRemoved>=.95,`${r.id}/${region.name}: residual handwriting`);}
  console.log('PASS: both synthetic regression fixtures restore paper, remove ink, and preserve printed content.');
} finally { await browser.close(); }
