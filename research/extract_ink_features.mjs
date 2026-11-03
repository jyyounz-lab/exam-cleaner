import fs from 'node:fs';
import path from 'node:path';
import { inkFeatures, inkFeatureNames } from '../src/inkFeatures.ts';
import { refineInk } from '../src/refine.ts';
import { composeMask, initialEdit } from '../src/core.ts';

const root=process.argv[2];
if(!root)throw new Error('Pass the private dataset directory.');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
const annotations=JSON.parse(fs.readFileSync(path.join(root,'annotations.json'),'utf8'));
const records=[];
const typed=(file,Type)=>{const b=fs.readFileSync(file);return new Type(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));};
for(const pair of manifest.pairs){
  const dir=path.join(root,pair.id),meta=JSON.parse(fs.readFileSync(path.join(dir,'meta.json'),'utf8'));
  const image={...meta,data:typed(path.join(dir,'rgba'),Uint8ClampedArray)},n=meta.width*meta.height;
  const raw={handwriting:typed(path.join(dir,'hand'),Float32Array),print:typed(path.join(dir,'print'),Float32Array)},binary=typed(path.join(dir,'binary'),Uint8Array);
  const target=typed(path.join(dir,'target-contrast'),Float32Array),valid=typed(path.join(dir,'valid'),Uint8Array),source=typed(path.join(dir,'source-contrast'),Float32Array);
  const roi={};
  for(const name of ['hand','keep','solidKeep']){
    roi[name]=new Uint8Array(n);
    for(const [x0,y0,x1,y1] of annotations[pair.id][name])for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)roi[name][y*meta.width+x]=1;
  }
  const {components,queue,contrast,lines}=inkFeatures(image,raw,binary),labels=new Uint8Array(n).fill(255);
  for(let y=2;y<meta.height-2;y++)for(let x=2;x<meta.width-2;x++){
    const i=y*meta.width+x;if(!valid[i]||contrast[i]<9||lines[i])continue;
    let nearby=0;for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)nearby=Math.max(nearby,target[(y+dy)*meta.width+x+dx]);
    if(roi.keep[i]&&(nearby>source[i]*.4||roi.solidKeep[i])&&source[i]>20)labels[i]=0;
    else if(roi.hand[i]&&nearby<Math.max(9,source[i]*.3)&&source[i]>12)labels[i]=1;
  }
  let positive=0,negative=0;
  for(let index=0;index<components.length;index++){
    const c=components[index];let pos=0,neg=0;
    for(let q=c.start;q<c.end;q++){const i=queue[q];pos+=Number(labels[i]===1);neg+=Number(labels[i]===0);}
    const size=c.end-c.start;
    const label=neg/size>.45&&pos/size<.05?0:pos/size>.45&&neg/size<.03?1:null;
    if(label!==null){positive+=label;negative+=1-label;}
    records.push({page:pair.id,split:pair.split,index,label,positivePixels:pos,negativePixels:neg,size,box:c.box,features:c.features});
  }
  fs.writeFileSync(path.join(dir,'labels'),labels);fs.writeFileSync(path.join(dir,'candidates'),queue);fs.writeFileSync(path.join(dir,'contrast'),contrast);fs.writeFileSync(path.join(dir,'lines'),lines);
  fs.writeFileSync(path.join(dir,'components.json'),JSON.stringify(components));
  const hints=refineInk(image,raw,binary),baseline=composeMask(image,initialEdit(),{...raw,hints});
  fs.writeFileSync(path.join(dir,'baseline-mask'),baseline.mask);
  console.log(pair.id,JSON.stringify({components:components.length,positive,negative,baselineSelected:baseline.count}));
}
fs.writeFileSync(path.join(root,'features.json'),JSON.stringify({names:inkFeatureNames,records}));
