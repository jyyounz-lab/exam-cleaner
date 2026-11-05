import type { InkHints } from './refine';
import type { WorkbookHints } from './workbook';
export type RegionTarget = 'none' | 'pencil' | 'red' | 'blue' | 'both';
type Pixels = {width:number;height:number;data:Uint8ClampedArray};
type Prediction = {handwriting:Float32Array;print:Float32Array;hints?:InkHints;workbook?:WorkbookHints};

// shortcut: same-color print still needs small selections or manual protection until semantic region detection is available.
// Explicit local selections use paper-relative ink, independent of the whole-page classifier's confidence floor.
export function targetedRegionMask(image:Pixels,box:{x:number;y:number;w:number;h:number},target:Exclude<RegionTarget,'none'>,settings:{threshold:number;protectPrint:boolean;grow:boolean},keep:Uint8Array,ai?:Prediction|null) {
  const {width:w,height:h,data}=image,n=w*h;
  if(data.length!==n*4||keep.length!==n||ai&&(ai.print.length!==n||ai.handwriting.length!==n))throw new Error('框選分析尺寸與底圖不符。');
  const cell=Math.max(12,Math.round(Math.min(w,h)*24/1108)),cols=Math.ceil(w/cell),rows=Math.ceil(h/cell),paper=new Map<number,number[]>();
  const background=(cx:number,cy:number)=>{
    const key=cy*cols+cx;let value=paper.get(key);if(value)return value;
    const samples:number[]=[];
    for(let y=cy*cell;y<Math.min(h,(cy+1)*cell);y+=2)for(let x=cx*cell;x<Math.min(w,(cx+1)*cell);x+=2)samples.push((y*w+x)*4);
    samples.sort((a,b)=>data[a]+data[a+1]+data[a+2]-data[b]-data[b+1]-data[b+2]);
    const from=Math.floor(samples.length*.75),to=Math.max(from+1,Math.ceil(samples.length*.95));value=[0,0,0];
    for(let k=from;k<to;k++)for(let c=0;c<3;c++)value[c]+=data[samples[k]+c]/(to-from);
    paper.set(key,value);return value;
  };
  const radius=Math.max(3,Math.round(Math.min(w,h)*6/1108)),left=Math.max(0,box.x-radius),top=Math.max(0,box.y-radius),right=Math.min(w,box.x+box.w+radius),bottom=Math.min(h,box.y+box.h+radius),stride=right-left+1;
  const integral=new Float64Array(stride*(bottom-top+1));
  for(let y=top;y<bottom;y++){let row=0;for(let x=left;x<right;x++){const p=(y*w+x)*4;row+=(data[p]+data[p+1]+data[p+2])/3;integral[(y-top+1)*stride+x-left+1]=integral[(y-top)*stride+x-left+1]+row;}}
  const size=box.w*box.h,ink=new Uint8Array(size),blocked=new Uint8Array(size),dark=new Uint8Array(size);
  const strict=Math.max(0,Math.min(1,(settings.threshold-.5)/.48)),minimum=3+strict*5,colorMinimum=5+strict*5;
  for(let y=0;y<box.h;y++)for(let x=0;x<box.w;x++){
    const xx=box.x+x,yy=box.y+y,i=yy*w+xx,j=y*box.w+x,p=i*4;
    const gx=Math.max(0,Math.min(cols-1,xx/cell-.5)),gy=Math.max(0,Math.min(rows-1,yy/cell-.5)),x0=Math.floor(gx),y0=Math.floor(gy),fx=gx-x0,fy=gy-y0;
    const a=background(x0,y0),b=background(Math.min(cols-1,x0+1),y0),c=background(x0,Math.min(rows-1,y0+1)),d=background(Math.min(cols-1,x0+1),Math.min(rows-1,y0+1));
    const rgb=[0,1,2].map(k=>255*data[p+k]/Math.max(40,(a[k]*(1-fx)+b[k]*fx)*(1-fy)+(c[k]*(1-fx)+d[k]*fx)*fy));
    const strength=255-(rgb[0]+rgb[1]+rgb[2])/3,red=Math.min(rgb[0]-rgb[1],rgb[0]-rgb[2]),blue=Math.min(rgb[2]-rgb[0],rgb[2]-rgb[1]);
    const ax=Math.max(left,xx-radius)-left,ay=Math.max(top,yy-radius)-top,bx=Math.min(right,xx+radius+1)-left,by=Math.min(bottom,yy+radius+1)-top;
    const contrast=(integral[by*stride+bx]-integral[ay*stride+bx]-integral[by*stride+ax]+integral[ay*stride+ax])/((bx-ax)*(by-ay))-(data[p]+data[p+1]+data[p+2])/3;
    const neutral=Math.max(...rgb)-Math.min(...rgb)<18;
    const redHue=rgb[0]-rgb[1]>=(rgb[0]-rgb[2])*.45,blueHue=rgb[2]-rgb[1]>=(rgb[2]-rgb[0])*.4;
    const matchesColor=target==='red'?redHue&&red>0:target==='blue'?blueHue&&blue>0:redHue&&red>0||blueHue&&blue>0;
    const selected=target==='pencil'?neutral&&strength<105:target==='red'?redHue&&red>=colorMinimum:target==='blue'?blueHue&&blue>=colorMinimum:redHue&&red>=colorMinimum||blueHue&&blue>=colorMinimum;
    ink[j]=Number(strength>=minimum&&contrast>=minimum&&selected);
    dark[j]=Number(strength>110&&(target==='pencil'||neutral));
    const printed=!!ai&&(ai.print[i]>.85&&ai.handwriting[i]<.2||!!ai.hints?.picture?.[i]);
    const line=!!ai?.workbook?.lines[i]&&!ai.workbook.crossings[i]||!!ai?.hints?.structure[i]&&!ai.hints.lineRepair?.[i];
    // Growth must also respect other ink colors, including yellow and green printed borders.
    blocked[j]=Number(!!keep[i]||!!line||!neutral&&(target==='pencil'||!matchesColor)||settings.protectPrint&&printed);
  }
  // Keep the antialiased rim of dark printed glyphs out of local selections.
  if(settings.protectPrint)for(let y=0;y<box.h;y++)for(let x=0;x<box.w;x++)if(dark[y*box.w+x]){
    for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){const xx=x+dx,yy=y+dy;if(xx>=0&&xx<box.w&&yy>=0&&yy<box.h)blocked[yy*box.w+xx]=1;}
  }
  const mask=new Uint8Array(size),seen=new Uint8Array(size),queue=new Int32Array(size);
  for(let seed=0;seed<size;seed++){
    if(seen[seed]||!ink[seed]||blocked[seed])continue;
    let head=0,tail=1;queue[0]=seed;seen[seed]=1;
    while(head<tail){const i=queue[head++],x=i%box.w,y=Math.floor(i/box.w);for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      const xx=x+dx,yy=y+dy,j=yy*box.w+xx;if(xx>=0&&xx<box.w&&yy>=0&&yy<box.h&&!seen[j]&&ink[j]&&!blocked[j]){seen[j]=1;queue[tail++]=j;}
    }}
    if(tail>=3)for(let k=0;k<tail;k++)mask[queue[k]]=255;
  }
  if(settings.grow)for(let step=0;step<2;step++){
    const previous=mask.slice();for(let y=0;y<box.h;y++)for(let x=0;x<box.w;x++){
      const i=y*box.w+x;if(previous[i]||blocked[i])continue;
      for(let dy=-1;dy<=1&&!mask[i];dy++)for(let dx=-1;dx<=1;dx++){const xx=x+dx,yy=y+dy;if(xx>=0&&xx<box.w&&yy>=0&&yy<box.h&&previous[yy*box.w+xx]){mask[i]=255;break;}}
    }
  }
  return mask;
}
