type Pixels = { width: number; height: number; data: Uint8ClampedArray };
type Prediction = { handwriting: Float32Array; print: Float32Array };
export const inkFeatureNames = ['area','width','height','density','aspect','contrastMean','contrastMax','contrastSd','grayMean','chromaMean','redMean','blueMean','handMean','printMean','handMax','handStrong','printStrong','solid','edge','contextInk','contextChroma','contextGray','binaryRatio','lineRatio','boxOtherInk','boxGray','boxChroma'];
export type InkComponent = { start: number; end: number; box: number[]; features: number[] };

/** The same feature extraction runs offline for training and in the browser. */
export function inkFeatures(image: Pixels, prediction: Prediction, binary: Uint8Array) {
  const { width:w, height:h, data } = image, n=w*h, stride=w+1;
  if(data.length!==n*4||binary.length!==n||prediction.handwriting.length!==n||prediction.print.length!==n)throw new Error('筆跡模型輸入尺寸不符。');
  const gray=new Float32Array(n),chroma=new Float32Array(n),integral=new Float64Array((w+1)*(h+1)),colorSum=new Float64Array(integral.length);
  for(let y=0;y<h;y++){let row=0,color=0;for(let x=0;x<w;x++){
    const i=y*w+x,p=i*4,r=data[p],g=data[p+1],b=data[p+2];gray[i]=(r+g+b)/3;chroma[i]=Math.max(r,g,b)-Math.min(r,g,b);
    row+=gray[i];color+=chroma[i];integral[(y+1)*stride+x+1]=integral[y*stride+x+1]+row;colorSum[(y+1)*stride+x+1]=colorSum[y*stride+x+1]+color;
  }}
  const sum=(table:Float64Array,x0:number,y0:number,x1:number,y1:number)=>table[y1*stride+x1]-table[y0*stride+x1]-table[y1*stride+x0]+table[y0*stride+x0];
  const contrast=new Float32Array(n),ink=new Uint8Array(n),lines=new Uint8Array(n),scale=Math.min(w,h)/1108;
  const radius=Math.max(7,Math.round(12*scale));
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=y*w+x,x0=Math.max(0,x-radius),y0=Math.max(0,y-radius),x1=Math.min(w,x+radius+1),y1=Math.min(h,y+radius+1);
    contrast[i]=Math.max(0,sum(integral,x0,y0,x1,y1)/((x1-x0)*(y1-y0))-gray[i]);
    ink[i]=Number(contrast[i]>=7);
  }
  // Separate long ruling lines before component classification, including slightly tilted lines.
  const minRun=Math.max(40,Math.round(55*scale));
  for(const slope of [-.08,-.04,.04,.08,0])for(let y0=-Math.ceil(w*.08);y0<h+Math.ceil(w*.08);y0++){
    let start=0,last=-1,gaps=0;
    for(let x=0;x<=w;x++){
      const y=Math.round(y0+x*slope),hit=x<w&&y>=0&&y<h&&ink[y*w+x];
      if(hit){if(last<0)start=x;last=x;gaps=0;}else if(++gaps>2||x===w){
        if(last-start+1>=minRun)for(let xx=start;xx<=last;xx++){const yy=Math.round(y0+xx*slope);if(yy>=0&&yy<h&&ink[yy*w+xx])lines[yy*w+xx]=Math.round(slope*25)+3;}
        last=-1;
      }
    }
  }
  const centers=lines.slice();
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++)if(centers[y*w+x])for(let dy=-1;dy<=1;dy++)if(ink[(y+dy)*w+x]&&!lines[(y+dy)*w+x])lines[(y+dy)*w+x]=centers[y*w+x];
  const inkSum=new Float64Array(integral.length);
  for(let y=0;y<h;y++){let row=0;for(let x=0;x<w;x++){row+=ink[y*w+x];inkSum[(y+1)*stride+x+1]=inkSum[y*stride+x+1]+row;}}
  const visited=new Uint8Array(n),queue=new Int32Array(n),components:InkComponent[]=[];
  let tail=0;
  for(let seed=0;seed<n;seed++){
    if(visited[seed]||!ink[seed]||lines[seed])continue;
    const start=tail;let head=start,x0=w,y0=h,x1=0,y1=0,cs=0,css=0,cm=0,gs=0,cc=0,rs=0,bs=0,hs=0,ps=0,hm=0,hstrong=0,pstrong=0,solid=0,edge=0,bin=0,line=0;
    visited[seed]=1;queue[tail++]=seed;
    while(head<tail){
      const i=queue[head++],x=i%w,y=Math.floor(i/w),p=i*4;
      x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);
      cs+=contrast[i];css+=contrast[i]**2;cm=Math.max(cm,contrast[i]);gs+=gray[i];cc+=chroma[i];rs+=data[p]-(data[p+1]+data[p+2])/2;bs+=data[p+2]-(data[p]+data[p+1])/2;
      hs+=prediction.handwriting[i];ps+=prediction.print[i];hm=Math.max(hm,prediction.handwriting[i]);hstrong+=Number(prediction.handwriting[i]>.8);pstrong+=Number(prediction.print[i]>.8);bin+=binary[i];
      let neighbors=0,nearLine=false;
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        const xx=x+dx,yy=y+dy;if(xx<0||xx>=w||yy<0||yy>=h)continue;const j=yy*w+xx;
        neighbors+=ink[j];nearLine ||= !!lines[j];
        if(!visited[j]&&ink[j]&&!lines[j]){visited[j]=1;queue[tail++]=j;}
      }
      solid+=Number(neighbors===9);edge+=Number(neighbors<6);line+=Number(nearLine);
    }
    const count=tail-start,cw=x1-x0+1,ch=y1-y0+1;
    if(count<6||cw<2||ch<2||count>n*.035)continue;
    const pad=Math.round(12*scale),ax=Math.max(0,x0-pad),ay=Math.max(0,y0-pad),bx=Math.min(w,x1+pad+1),by=Math.min(h,y1+pad+1),area=(bx-ax)*(by-ay);
    components.push({start,end:tail,box:[x0,y0,x1+1,y1+1],features:[Math.log1p(count/(scale*scale)),cw/scale,ch/scale,count/(cw*ch),cw/ch,cs/count,cm,Math.sqrt(Math.max(0,css/count-(cs/count)**2)),gs/count,cc/count,rs/count,bs/count,hs/count,ps/count,hm,hstrong/count,pstrong/count,solid/count,edge/count,sum(inkSum,ax,ay,bx,by)/area,sum(colorSum,ax,ay,bx,by)/area,sum(integral,ax,ay,bx,by)/area,bin/count,line/count,(sum(inkSum,x0,y0,x1+1,y1+1)-count)/(cw*ch),sum(integral,x0,y0,x1+1,y1+1)/(cw*ch),sum(colorSum,x0,y0,x1+1,y1+1)/(cw*ch)]});
  }
  return {components,queue,contrast,lines};
}
