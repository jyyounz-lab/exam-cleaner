import {inkFeatures} from './inkFeatures.ts';
import {pixelFeatures,pixelFeatureNames} from './pixelFeatures.ts';
import {finishWorkbookHints,validateWorkbookModel,workbookScore,ZHUYIN_MODEL_REVISION,type WorkbookModel} from './workbook.ts';
import {markDottedRules} from './dottedRules.ts';

export const validateZhuyinModel=(value:unknown)=>validateWorkbookModel(value,pixelFeatureNames);

export function analyseZhuyin(image:{width:number;height:number;data:Uint8ClampedArray},prediction:{handwriting:Float32Array;print:Float32Array},binary:Uint8Array,model:WorkbookModel){
  const {width:w,height:h}=image,{components,queue,contrast,lines}=inkFeatures(image,prediction,binary),confidence=new Uint8Array(w*h);
  for(const c of components){
    const f=c.features;
    if(f[2]<5||c.end-c.start<12)continue;
    // Keep broad coloured illustration regions; classify mixed thin strokes individually.
    if(f[1]>55&&f[2]>55&&f[3]>.14&&f[17]>.25&&f[9]>20&&f[9]>f[20]*1.4)continue;
    for(let q=c.start;q<c.end;q++){
      const i=queue[q], features=pixelFeatures(i,f,image,prediction,contrast);
      const score=Math.round(workbookScore(features,model)*255);
      // Reinforce near-threshold neutral pencil only when the segmentation
      // network also recognizes the pixel and the surrounding stroke.
      const supported = score >= 230 && prediction.handwriting[i] > .94 && prediction.print[i] < .12
        && f[12] > .4 && features[29] < Math.max(22,f[20]+6) && contrast[i] < 100;
      confidence[i]=supported ? Math.min(255,score+5) : score;
    }
  }
  markDottedRules(w,h,contrast,lines);
  return finishWorkbookHints(w,h,contrast,lines,confidence,model.revision??ZHUYIN_MODEL_REVISION,230);
}
