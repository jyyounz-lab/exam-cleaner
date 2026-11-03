import { inkFeatures, inkFeatureNames } from './inkFeatures.ts';
type Pixels = {width:number;height:number;data:Uint8ClampedArray};
export type WorkbookHints = {version:1;confidence:Uint8Array;keep:Uint8Array;lines:Uint8Array;crossings:Uint8Array};
type TreeNode = [number,number,number,number,number];
export type WorkbookModel = {version:1;featureNames:string[];bias:number;trees:TreeNode[][]};

export function validateWorkbookModel(value:unknown):WorkbookModel {
  const m=value as WorkbookModel;
  if(!m||m.version!==1||JSON.stringify(m.featureNames)!==JSON.stringify(inkFeatureNames)||!Number.isFinite(m.bias)||!Array.isArray(m.trees)||!m.trees.length||m.trees.length>200)throw new Error('課本補強模型格式不符，請重新下載。');
  for(const tree of m.trees){
    if(!Array.isArray(tree)||!tree.length||tree.length>1024)throw new Error('課本補強模型樹狀資料不符。');
    for(let i=0;i<tree.length;i++){
      const node=tree[i];
      if(!Array.isArray(node)||node.length!==5||node.some(v=>!Number.isFinite(v)))throw new Error('課本補強模型包含無效數值。');
      const [feature,,left,right]=node;
      if(!Number.isInteger(feature)||feature < -2||feature>=inkFeatureNames.length||feature>=0&&(!Number.isInteger(left)||!Number.isInteger(right)||left<=i||right<=i||left>=tree.length||right>=tree.length))throw new Error('課本補強模型節點不符。');
    }
  }
  return m;
}

export function workbookScore(features:number[],model:WorkbookModel):number {
  let value=model.bias;
  for(const tree of model.trees){
    let i=0;
    while(tree[i][0]>=0){const [f,t,left,right]=tree[i];i=Math.fround(features[f])<=t?left:right;}
    value+=tree[i][4];
  }
  return 1/(1+Math.exp(-value));
}

function checkboxFrames(w:number,h:number,contrast:Float32Array):Uint8Array {
  const frames=new Uint8Array(w*h),scale=Math.min(w,h)/1108,min=Math.max(9,Math.round(15*scale)),max=Math.max(min+2,Math.round(60*scale));
  const ink=(x:number,y:number)=>x>=0&&x<w&&y>=0&&y<h&&contrast[y*w+x]>=7;
  const near=(x:number,y:number)=>ink(x,y)||ink(x-1,y)||ink(x+1,y)||ink(x,y-1)||ink(x,y+1);
  for(const slope of [0,-.08,.08])for(let row=0;row<h;row++)for(let x=0;x<w;){
    const yAt=(xx:number)=>Math.round(row+xx*slope);
    if(!ink(x,yAt(x))){x++;continue;}
    const start=x;let last=x,gap=0;
    while(x<w&&gap<=1){if(ink(x,yAt(x))){last=x;gap=0;}else gap++;x++;}
    const length=last-start+1;if(length<min||length>max)continue;
    for(const sign of [-1,1])for(let height=Math.max(min,Math.round(length*.7));height<=Math.min(max,Math.round(length*1.4));height++){
      const offset=height*sign;
      if(!near(start,yAt(start)+offset)||!near(last,yAt(last)+offset))continue;
      let opposite=0,left=0,right=0;
      for(let xx=start;xx<=last;xx++)opposite+=Number(near(xx,yAt(xx)+offset));
      if(opposite/length<.88)continue;
      for(let dy=0;dy<=height;dy++){left+=Number(near(start,yAt(start)+dy*sign));right+=Number(near(last,yAt(last)+dy*sign));}
      if(Math.min(left,right)/(height+1)<.88)continue;
      const mark=(xx:number,yy:number)=>{for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){const a=xx+dx,b=yy+dy;if(ink(a,b))frames[b*w+a]=1;}};
      for(let xx=start;xx<=last;xx++){mark(xx,yAt(xx));mark(xx,yAt(xx)+offset);}
      for(let dy=0;dy<=height;dy++){mark(start,yAt(start)+dy*sign);mark(last,yAt(last)+dy*sign);}
      break;
    }
  }
  return frames;
}

export function analyseWorkbook(image:Pixels, prediction:{handwriting:Float32Array;print:Float32Array}, binary:Uint8Array, model:WorkbookModel):WorkbookHints {
  const {width:w,height:h}=image,n=w*h,{components,queue,contrast,lines}=inkFeatures(image,prediction,binary);
  const confidence=new Uint8Array(n),keep=new Uint8Array(n),frames=checkboxFrames(w,h,contrast),crossings=new Uint8Array(n);
  const scores=components.map(c=>workbookScore(c.features,model));
  const printed=components.filter((c,i)=>scores[i]<.1&&c.features[5]>35&&c.features[2]>=8);
  for(let index=0;index<components.length;index++){
    const c=components[index],score=scores[index],f=c.features;
    // shortcut: sparse workbook labels do not establish tiny punctuation accuracy; leave isolated dots for review.
    if(f[2]<5||c.end-c.start<12)continue;
    // Dense line drawings (nets, grids) require contextual recognition beyond this small classifier.
    if(f[1]>70&&f[2]>70&&f[3]>.1)continue;
    let left=0,right=0;
    for(const other of printed){
      if(other===c)continue;const height=c.box[3]-c.box[1],oh=other.box[3]-other.box[1];
      if(oh<height*.65||oh>height*1.8||Math.abs(other.box[3]-c.box[3])>height*.4)continue;
      const gap=Math.max(other.box[0]-c.box[2],c.box[0]-other.box[2]);
      if(gap<0||gap>height*3)continue;
      if(other.box[0]<c.box[0])left++;else right++;
    }
    if(left&&right&&left+right>=3)continue;
    for(let q=c.start;q<c.end;q++)confidence[queue[q]]=Math.round(score*255);
  }
  for(let y=4;y<h-4;y++)for(let x=0;x<w;x++){
    const i=y*w+x;if(!lines[i]||frames[i])continue;
    let above=0,below=0;
    for(let d=2;d<=4;d++)for(let dx=-1;dx<=1;dx++){const xx=x+dx;if(xx<0||xx>=w)continue;above=Math.max(above,confidence[(y-d)*w+xx]);below=Math.max(below,confidence[(y+d)*w+xx]);}
    const score=Math.min(above,below);
    if(score>=230){crossings[i]=1;confidence[i]=score;}
  }
  for(let i=0;i<n;i++){if(frames[i])confidence[i]=0;keep[i]=Number(frames[i]||lines[i]&&!crossings[i]||contrast[i]>=7&&confidence[i]<128);}
  // Protect the antialiased edges of retained print and coloured guidelines.
  const centers=keep.slice();
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++)if(centers[y*w+x])for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
    const j=(y+dy)*w+x+dx;if(contrast[j]>2&&confidence[j]<128)keep[j]=1;
  }
  return {version:1,confidence,keep,lines,crossings};
}
