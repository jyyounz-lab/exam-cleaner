import {inkFeatures} from './inkFeatures.ts';
import {pixelFeatures,pixelFeatureNames} from './pixelFeatures.ts';
import {finishWorkbookHints,validateWorkbookModel,workbookScore,ZHUYIN_MODEL_REVISION,type WorkbookModel} from './workbook.ts';

export const validateZhuyinModel=(value:unknown)=>validateWorkbookModel(value,pixelFeatureNames);

export function analyseZhuyin(image:{width:number;height:number;data:Uint8ClampedArray},prediction:{handwriting:Float32Array;print:Float32Array},binary:Uint8Array,model:WorkbookModel){
  const {width:w,height:h}=image,{components,queue,contrast,lines}=inkFeatures(image,prediction,binary),confidence=new Uint8Array(w*h);
  for(const c of components){
    const f=c.features;
    if(f[2]<5||c.end-c.start<12)continue;
    // Keep broad coloured illustration regions; classify mixed thin strokes individually.
    if(f[1]>55&&f[2]>55&&f[3]>.14&&f[17]>.25&&f[9]>20&&f[9]>f[20]*1.4)continue;
    for(let q=c.start;q<c.end;q++){
      const i=queue[q];confidence[i]=Math.round(workbookScore(pixelFeatures(i,f,image,prediction,contrast),model)*255);
    }
  }
  // Ambiguous ink also blocks edge growth; lowering the threshold requires reviewing print protection.
  return finishWorkbookHints(w,h,contrast,lines,confidence,model.revision??ZHUYIN_MODEL_REVISION,230);
}
