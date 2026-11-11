import {inkFeatureNames} from './inkFeatures.ts';

export const pixelFeatureNames=[...inkFeatureNames,'pixelContrast','pixelGray','pixelChroma','pixelRed','pixelBlue','pixelHand','pixelPrint','nearContrastMax','nearContrastMean','nearDarkFraction'];

/** Local stroke evidence retains the surrounding component's shape and colour. */
export function pixelFeatures(i:number,f:number[],image:{width:number;height:number;data:Uint8ClampedArray},raw:{handwriting:Float32Array;print:Float32Array},contrast:Float32Array):number[]{
  const {width:w,height:h,data}=image,x=i%w,y=Math.floor(i/w),p=i*4,r=data[p],g=data[p+1],b=data[p+2];
  let max=0,sum=0,dark=0,count=0;
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
    const xx=x+dx,yy=y+dy;if(xx<0||xx>=w||yy<0||yy>=h)continue;
    const c=contrast[yy*w+xx];max=Math.max(max,c);sum+=c;dark+=Number(c>=90);count++;
  }
  return [...f,contrast[i],(r+g+b)/3,Math.max(r,g,b)-Math.min(r,g,b),r-(g+b)/2,b-(r+g)/2,raw.handwriting[i],raw.print[i],max,sum/count,dark/count];
}
