import fs from 'node:fs';
import {inkFeatures} from '../src/inkFeatures.ts';
import {pixelFeatures,pixelFeatureNames as pixelNames} from '../src/pixelFeatures.ts';
import path from 'node:path';
const [root,out]=process.argv.slice(2);
if(!root||!out||path.resolve(root)===path.resolve(out))throw new Error('Pass separate private source and output datasets');
fs.mkdirSync(out,{recursive:true});
const typed=(p,T)=>{const b=fs.readFileSync(p);return new T(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));};
const manifest=JSON.parse(fs.readFileSync(`${root}/manifest.json`,'utf8')),records=[],features=[],labels=[],weights=[];
let state=20261109;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
for(const pair of manifest.pairs){
 const dir=pair.directory,meta=JSON.parse(fs.readFileSync(`${dir}/meta.json`)),image={...meta,data:typed(`${dir}/rgba`,Uint8ClampedArray)},raw={handwriting:typed(`${dir}/hand`,Float32Array),print:typed(`${dir}/print`,Float32Array)},truth=typed(`${dir}/labels`,Uint8Array),verified=typed(`${dir}/verified`,Uint8Array),{components,queue,contrast}=inkFeatures(image,raw,typed(`${dir}/binary`,Uint8Array));
 const candidates=[[],[]];for(let c=0;c<components.length;c++)for(let q=components[c].start;q<components[c].end;q++){const i=queue[q];if(truth[i]<2)candidates[truth[i]].push([i,c]);}
 const start=labels.length;
 for(let cls=0;cls<2;cls++){
  const list=candidates[cls];for(let n=list.length-1;n>0;n--){const j=Math.floor(random()*(n+1));[list[n],list[j]]=[list[j],list[n]];}
  for(const [i,c] of list.slice(0,cls?1600:2400)){features.push(...pixelFeatures(i,components[c].features,image,raw,contrast));labels.push(cls);weights.push(verified[i]===0?12:1);}
 }
 // Mine retained print touching handwriting, from training pages only.
 if(pair.split==='train'){
  const hard=[];
  for(let c=0;c<components.length;c++){
   let pos=0,neg=0;for(let q=components[c].start;q<components[c].end;q++){pos+=truth[queue[q]]===1;neg+=truth[queue[q]]===0;}
   if(pos<12||neg<8)continue;
   for(let q=components[c].start;q<components[c].end;q++)if(truth[queue[q]]===0)hard.push([queue[q],c]);
  }
  const stride=Math.max(1,Math.ceil(hard.length/1600));
  for(let k=0;k<hard.length;k+=stride){const [i,c]=hard[k];features.push(...pixelFeatures(i,components[c].features,image,raw,contrast));labels.push(0);weights.push(4);}
 }
 records.push({...pair,start,end:labels.length});console.log(pair.id,labels.length-start);
}
fs.writeFileSync(`${out}/features.f32`,new Float32Array(features));fs.writeFileSync(`${out}/labels.u8`,new Uint8Array(labels));fs.writeFileSync(`${out}/weights.f32`,new Float32Array(weights));fs.writeFileSync(`${out}/manifest.json`,JSON.stringify({names:pixelNames,pairs:records},null,2));
