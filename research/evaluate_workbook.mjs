import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { analyseWorkbook, validateWorkbookModel, workbookScore } from '../src/workbook.ts';
import { composeMask, initialEdit } from '../src/core.ts';

const root=process.argv[2];if(!root)throw new Error('Pass private dataset directory');
const model=validateWorkbookModel(JSON.parse(fs.readFileSync('public/models/workbook-ink.json','utf8')));
const typed=(f,T)=>{const b=fs.readFileSync(f);return new T(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));};
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8')),reports=[];
for(const pair of manifest.pairs){
  const dir=path.join(root,pair.id),meta=JSON.parse(fs.readFileSync(path.join(dir,'meta.json'),'utf8'));
  const image={...meta,data:typed(path.join(dir,'rgba'),Uint8ClampedArray)},raw={handwriting:typed(path.join(dir,'hand'),Float32Array),print:typed(path.join(dir,'print'),Float32Array)},binary=typed(path.join(dir,'binary'),Uint8Array),labels=typed(path.join(dir,'labels'),Uint8Array);
  const before=typed(path.join(dir,'baseline-mask'),Uint8Array);
  const comps=JSON.parse(fs.readFileSync(path.join(dir,'components.json'),'utf8')),scores=typed(path.join(dir,'learned-scores'),Float32Array);
  for(let i=0;i<comps.length;i++)assert.ok(Math.abs(workbookScore(comps[i].features,model)-scores[i])<1e-6);
  const start=performance.now(),workbook=analyseWorkbook(image,raw,binary,model);
  const metric=mask=>{let hand=0,selected=0,keep=0,damaged=0;for(let i=0;i<labels.length;i++){if(labels[i]===1){hand++;selected+=!!mask[i];}if(labels[i]===0){keep++;damaged+=!!mask[i];}}return{annotatedHandwritingPixels:hand,selectedHandwritingPixels:selected,handwritingCoverage:selected/Math.max(1,hand),annotatedKeepPixels:keep,changedKeepPixels:damaged,keepDamageRate:damaged/Math.max(1,keep)};};
  const report={page:pair.id,split:pair.split,featureInferenceMs:Math.round(performance.now()-start),before:metric(before),after:[]};
  for(const threshold of [.8,.9]){
    const masks=composeMask(image,{...initialEdit(),inkType:'workbook',threshold},{...raw,workbook});
    fs.writeFileSync(path.join(dir,`workbook-mask-${threshold}`),masks.mask);
    report.after.push({threshold,...metric(masks.mask),selectedPixels:masks.count});
  }
  reports.push(report);console.log(JSON.stringify(report));
}
fs.writeFileSync(path.join(root,'pipeline-report.json'),JSON.stringify({kind:'sparse-reviewed-weak-label-pixels-not-whole-page-accuracy',reports},null,2));
