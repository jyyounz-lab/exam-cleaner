import fs from 'node:fs';
import path from 'node:path';
import {inkFeatures,inkFeatureNames} from '../src/inkFeatures.ts';
const root=process.argv[2];if(!root)throw new Error('Pass the local augmented dataset');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8')),records=[];
const typed=(p,T)=>{const b=fs.readFileSync(p);return new T(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));};
for(const pair of manifest.pairs){
  const dir=path.join(root,pair.id),meta=JSON.parse(fs.readFileSync(path.join(dir,'meta.json'),'utf8'));
  const image={...meta,data:typed(path.join(dir,'rgba'),Uint8ClampedArray)},raw={handwriting:typed(path.join(dir,'hand'),Float32Array),print:typed(path.join(dir,'print'),Float32Array)};
  const {components,queue}=inkFeatures(image,raw,typed(path.join(dir,'binary'),Uint8Array));
  const labels=typed(path.join(dir,'labels'),Uint8Array),verified=typed(path.join(dir,'verified'),Uint8Array);
  for(let index=0;index<components.length;index++){
    const c=components[index],size=c.end-c.start;let pos=0,neg=0,confirmedKeep=0,confirmedHand=0;
    for(let q=c.start;q<c.end;q++){const i=queue[q];pos+=Number(labels[i]===1);neg+=Number(labels[i]===0);confirmedKeep+=Number(verified[i]===0);confirmedHand+=Number(verified[i]===1);}
    // Any meaningful confirmed exemplar overlap is a hard negative, never a positive.
    const confirmedMinimum=Math.max(3,Math.round(8*(Math.min(meta.width,meta.height)/1108)**2));
    const label=confirmedKeep>=confirmedMinimum&&confirmedKeep/size>.05?0:neg/size>.45&&pos/size<.05?0:pos/size>.45&&neg/size<.03?1:confirmedHand>=20&&confirmedHand/size>.2&&neg/size<.03?1:null;
    records.push({page:pair.id,sourcePage:pair.sourcePage,split:pair.split,index,label,size,box:c.box,features:c.features,confirmedKeep,confirmedHand});
  }
  fs.writeFileSync(path.join(dir,'components.json'),JSON.stringify(components));
}
for(const page of new Set(records.map(r=>r.sourcePage)))if(new Set(records.filter(r=>r.sourcePage===page).map(r=>r.split)).size!==1)throw new Error('Page variants leaked across splits');
fs.writeFileSync(path.join(root,'features.json'),JSON.stringify({names:inkFeatureNames,records}));
console.log(JSON.stringify({components:records.length,labeled:records.filter(r=>r.label!==null).length,confirmedKeep:records.filter(r=>r.label===0&&r.confirmedKeep>=12).length}));
