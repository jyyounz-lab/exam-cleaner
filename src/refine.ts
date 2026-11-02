import { printLayout } from './printLayout.ts';
type Pixels = { width: number; height: number; data: Uint8ClampedArray };
export type InkHints = { version: 3; confidence: Uint8Array; colorInk: Uint8Array; answerInk: Uint8Array; handInk: Uint8Array; boldInk: Uint8Array; printInk: Uint8Array; picture: Uint8Array; structure: Uint8Array; lineRepair: Uint8Array; answerRegions: number };

export function refineInk(image: Pixels, prediction: { handwriting: Float32Array; print: Float32Array }, binary: Uint8Array): InkHints {
  const { width: w, height: h, data } = image, n = w * h;
  const confidence = new Uint8Array(n), colorInk = new Uint8Array(n), answerInk = new Uint8Array(n), structure = new Uint8Array(n), bands = new Uint8Array(n);
  const handInk = new Uint8Array(n), boldInk = new Uint8Array(n), printInk = new Uint8Array(n), picture = new Uint8Array(n);
  // A single page-wide white balance joins shaded paper to ink on phone photos.
  const cell=48, cols=Math.ceil(w/cell), rowsCount=Math.ceil(h/cell), paper=new Float32Array(cols*rowsCount*3);
  for(let cy=0;cy<rowsCount;cy++)for(let cx=0;cx<cols;cx++){
    const samples: number[]=[];
    for(let y=cy*cell;y<Math.min(h,(cy+1)*cell);y+=3)for(let x=cx*cell;x<Math.min(w,(cx+1)*cell);x+=3)samples.push((y*w+x)*4);
    samples.sort((a,b)=>(data[a]+data[a+1]+data[a+2])-(data[b]+data[b+1]+data[b+2]));
    const from=Math.floor(samples.length*.75),to=Math.max(from+1,Math.ceil(samples.length*.95));
    for(let k=from;k<to;k++)for(let c=0;c<3;c++)paper[(cy*cols+cx)*3+c]+=data[samples[k]+c]/(to-from);
  }
  const strength = new Uint8Array(n), weakColor = new Uint8Array(n), strongColor = new Uint8Array(n), neutralDark = new Uint8Array(n), lineRepair = new Uint8Array(n), toned = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const r = data[i*4], g = data[i*4+1], b = data[i*4+2];
    const gx=Math.max(0,Math.min(cols-1,(i%w)/cell-.5)),gy=Math.max(0,Math.min(rowsCount-1,Math.floor(i/w)/cell-.5));
    const x0=Math.floor(gx),y0=Math.floor(gy),x1=Math.min(cols-1,x0+1),y1=Math.min(rowsCount-1,y0+1),fx=gx-x0,fy=gy-y0;
    const background=(c:number)=>(paper[(y0*cols+x0)*3+c]*(1-fx)+paper[(y0*cols+x1)*3+c]*fx)*(1-fy)+(paper[(y1*cols+x0)*3+c]*(1-fx)+paper[(y1*cols+x1)*3+c]*fx)*fy;
    const pr=background(0),pg=background(1),pb=background(2),contrast=Math.max(pr-r,pg-g,pb-b);
    const nr=255*r/Math.max(40,pr),ng=255*g/Math.max(40,pg),nb=255*b/Math.max(40,pb);
    const red = Math.min(nr-ng,nr-nb);
    const blue = Math.min(nb-nr,nb-ng);
    const chroma = Math.max(r,g,b)-Math.min(r,g,b);
    strength[i]=Math.max(0,Math.min(255,255-(nr+ng+nb)/3));
    toned[i]=Number((nr+ng+nb)/3<210);
    weakColor[i] = Number(contrast > 8 && Math.max(red, blue) > 4 && (chroma > 9 || Math.min(r,g,b) > 205));
    strongColor[i] = Number(contrast > 18 && Math.max(red, blue) > 16 && chroma > 18);
    neutralDark[i] = Number(chroma < 26 && Math.max(r,g,b) < 220);
  }
  // Broad midtone texture belongs to photographs/illustrations, not isolated ink on paper.
  for(let by=0;by<h;by+=16)for(let bx=0;bx<w;bx+=16){
    let texture=0,area=0;
    for(let y=by;y<Math.min(h,by+16);y++)for(let x=bx;x<Math.min(w,bx+16);x++){
      const i=y*w+x,gray=(data[i*4]+data[i*4+1]+data[i*4+2])/3;
      area++;if(!binary[i]&&toned[i]&&gray>35&&gray<200)texture++;
    }
    if(texture/area>.22)for(let y=Math.max(0,by-8);y<Math.min(h,by+24);y++)for(let x=Math.max(0,bx-8);x<Math.min(w,bx+24);x++)picture[y*w+x]=1;
  }
  const lines: { x0:number; x1:number; y:number }[] = [], minLine = Math.max(40, Math.round(w * .05));
  const maxLineWidth=Math.max(3,Math.round(Math.min(w,h)*.0025));
  function thinLine(start:number,end:number,fixed:number,vertical:boolean) {
    let thin=0,total=0;
    for(let p=start;p<end;p+=Math.max(1,Math.floor((end-start)/20))){
      let thickness=1;
      for(const sign of [-1,1])for(let d=1;d<=maxLineWidth+1;d++){
        const x=vertical?fixed+sign*d:p,y=vertical?p:fixed+sign*d;
        if(x<0||x>=w||y<0||y>=h||!binary[y*w+x])break;thickness++;
      }
      total++;if(thickness<=maxLineWidth)thin++;
    }
    return thin/total>=.7;
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w;) {
      if (!binary[y*w+x]) { x++; continue; }
      const start = x; while (x < w && binary[y*w+x]) x++;
      if (x - start < minLine || !thinLine(start,x,y,false)) continue;
      let dark=0;for(let xx=start;xx<x;xx++)dark+=neutralDark[y*w+xx];if(dark/(x-start)<.85)continue;
      for (let xx = start; xx < x; xx++) structure[y*w+xx] = 1;
      if (x-start <= w*.7 && !lines.some(l => Math.abs(l.y-y) <= 4 && Math.abs(l.x0-start) < 5 && Math.abs(l.x1-x) < 5)) lines.push({x0:start,x1:x,y});
    }
  }
  for (let x = 0; x < w; x++) for (let y = 0; y < h;) {
    if (!binary[y*w+x]) { y++; continue; } const start = y;
    while (y < h && binary[y*w+x]) y++;
    if (y-start >= Math.max(60, h*.045) && thinLine(start,y,x,true)) { let dark=0;for(let yy=start;yy<y;yy++)dark+=neutralDark[yy*w+x];if(dark/(y-start)>=.85)for (let yy = start; yy < y; yy++) structure[yy*w+x] |= 2; }
  }
  const lineCenters=structure.slice();
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const flag=lineCenters[y*w+x];if(!flag)continue;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const xx=x+dx,yy=y+dy;if(xx>=0&&xx<w&&yy>=0&&yy<h){const j=yy*w+xx;if(lineCenters[j]||neutralDark[j])structure[j]|=flag;}}}
  let answerRegions = 0;
  for (const line of lines) {
    let borders = 0;
    for (const end of [line.x0,line.x1-1]) for (let yy = Math.max(0,line.y-15); yy <= Math.min(h-1,line.y+15); yy++) for (let xx = Math.max(0,end-3); xx <= Math.min(w-1,end+3); xx++) if (structure[yy*w+xx] === 2) borders++;
    if (borders > 8) continue;
    const length = line.x1-line.x0, above = Math.max(22,Math.min(90,Math.round(length*.43)));
    for (let y = Math.max(0,line.y-above); y <= Math.min(h-1,line.y+12); y++) for (let x = Math.max(0,line.x0-2); x < Math.min(w,line.x1+Math.min(24,length*.12)); x++) bands[y*w+x] = 1;
    answerRegions++;
  }
  const layout = printLayout(w,h,strength,strongColor,prediction.print);
  printInk.set(layout.keep); answerRegions += layout.pairs;
  for(let i=0;i<n;i++) if(layout.answers[i]) bands[i]=1;
  const visited = new Uint8Array(n), queue = new Int32Array(n*2);
  const components: { start: number; end: number; x0: number; x1: number; y0: number; y1: number; colors: number; inAnswer: number; meanHand: number; meanPrint: number; maxHand: number; strongHand: number; colorLayer: boolean }[] = [];
  let tail = 0;
  // Keep neutral strokes separate from colour/lighting variation in the photograph.
  for(const connected of [binary,weakColor]) {
  visited.fill(0);
  for (let seed = 0; seed < n; seed++) {
    if (visited[seed] || structure[seed] || !connected[seed]) continue;
    const start = tail;
    let head = start, colors = 0, inAnswer = 0, sumHand = 0, sumPrint = 0, maxHand = 0, strongHand = 0;
    let x0=w,y0=h,x1=0,y1=0; queue[tail++]=seed; visited[seed]=1;
    while (head < tail) {
      const i=queue[head++], x=i%w, y=Math.floor(i/w); colors += strongColor[i]; inAnswer += bands[i];
      sumHand += prediction.handwriting[i]; sumPrint += prediction.print[i]; maxHand=Math.max(maxHand,prediction.handwriting[i]);
      strongHand += Number(prediction.handwriting[i] >= .8);
      x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);
      for (let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++) { const xx=x+dx,yy=y+dy;if(xx<0||xx>=w||yy<0||yy>=h)continue;const j=yy*w+xx;if(!visited[j]&&!structure[j]&&connected[j]){visited[j]=1;queue[tail++]=j;} }
    }
    const size = tail - start;
    components.push({ start, end: tail, x0, x1, y0, y1, colors, inAnswer, meanHand: sumHand/size, meanPrint: sumPrint/size, maxHand, strongHand, colorLayer: connected===weakColor });
  }
  }
  // Printed neighbours provide local context without treating every black pixel as print.
  const rows = new Map<number, typeof components>();
  for (const c of components) if (!c.colorLayer && c.y1-c.y0 >= 5 && (c.meanPrint > .3 && c.meanHand < .55 || c.meanHand < .2)) {
    const key = Math.floor((c.y0+c.y1)/16), row = rows.get(key) || []; row.push(c); rows.set(key, row);
  }
  for (const c of components) {
    const { start, end, x0, x1, y0, y1, colors, inAnswer, meanHand, meanPrint, maxHand, strongHand } = c;
    const size=end-start, cw=x1-x0+1, ch=y1-y0+1;
    const small = size >= 2 && size < Math.max(20000,n*.025) && cw < Math.max(120,w*.55) && ch < Math.max(120,h*.2);
    const colored = c.colorLayer && small && colors >= 1 && colors/size > .025 && (meanHand > .25 && strongHand/size > .08 && meanHand > meanPrint || inAnswer/size > .82 && meanPrint < .65);
    const answer = !c.colorLayer && small && inAnswer/size > .82 && maxHand > .72 && meanHand > .35 && meanHand > meanPrint;
    let aligned = 0;
    const center=(y0+y1)/2,tolerance = Math.max(4,ch*.6);
    for (let key=Math.floor((center-tolerance)/8);key<=Math.floor((center+tolerance)/8);key++) for (const other of rows.get(key) || []) {
      const oh=other.y1-other.y0+1, gap=Math.max(other.x0-x1,x0-other.x1);
      if (other!==c && Math.min(other.y1,y1)-Math.max(other.y0,y0)>=Math.min(ch,oh)*.5 && oh>=ch*.55 && oh<=ch*3 && gap>=0 && gap<Math.max(ch,oh)*3) aligned++;
    }
    const printed = !colored && (meanPrint >= .65 || aligned >= 2);
    let tonedPixels=0;
    if(small&&!c.colorLayer)for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)tonedPixels+=toned[y*w+x];
    // shortcut: the English model cannot resolve every Chinese/handwriting overlap; ambiguous strokes stay for review.
    const freeHand = !c.colorLayer && small && !answer && !printed && ch >= 7 && size >= 12 && (tonedPixels/(cw*ch)<.6 || ch>cw*3 && size/(cw*ch)>.8) && meanHand >= .55 && meanHand > meanPrint+.25 && maxHand > .88 && strongHand/size >= .35;
    if (printed&&!c.colorLayer) for(let q=start;q<end;q++) printInk[queue[q]]=1;
    if (!colored && !answer && !freeHand) continue;
    const score = Math.round(255 * (colored ? Math.max(.86,maxHand) : Math.max(.83,Math.min(maxHand,meanHand+.15))));
    for(let q=start;q<end;q++){const i=queue[q];confidence[i]=score;if(colored&&weakColor[i])colorInk[i]=1;if(answer)answerInk[i]=1;if(freeHand)handInk[i]=1;}
  }
  // Include faint fringes connected to accepted strokes, but keep structural lines separate.
  const strokeConfidence=confidence.slice();
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=y*w+x;if(confidence[i]||structure[i]||!weakColor[i])continue;let score=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)score=Math.max(score,strokeConfidence[(y+dy)*w+x+dx]);if(score){confidence[i]=score;colorInk[i]=1;}}
  const answerCenters=answerInk.slice();
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(answerCenters[y*w+x])for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){const xx=x+dx,yy=y+dy;if(xx>=0&&xx<w&&yy>=0&&yy<h){const j=yy*w+xx;if(!structure[j]&&!printInk[j]&&(!binary[j]||answerCenters[j]))answerInk[j]=1;}}
  const handCenters=handInk.slice();
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(handCenters[y*w+x])for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
    const xx=x+dx,yy=y+dy;if(xx<0||xx>=w||yy<0||yy>=h)continue;const j=yy*w+xx;
    // Grow only into the fringe of accepted strokes, never into another dark component.
    if(!structure[j]&&!printInk[j]&&(!binary[j]||handCenters[j]))handInk[j]=1;
  }
  for(let i=0;i<n;i++)if(structure[i]&&strongColor[i]){lineRepair[i]=1;confidence[i]=Math.max(confidence[i],230);colorInk[i]=1;}
  // Thick digital/marker strokes can be separated from thin printed letters inside a circle.
  const radius=Math.max(2,Math.round(Math.min(w,h)/550));
  for(let y=radius;y<h-radius;y++)for(let x=radius;x<w-radius;x++){
    const i=y*w+x;if(!handInk[i]&&!answerInk[i]||picture[i]||printInk[i])continue;
    let solid=true;
    for(let dy=-radius;dy<=radius&&solid;dy++)for(let dx=-radius;dx<=radius;dx++){
      if(dx*dx+dy*dy>radius*radius)continue;const p=((y+dy)*w+x+dx)*4;
      if((data[p]+data[p+1]+data[p+2])/3>=75){solid=false;break;}
    }
    if(solid)for(let dy=-radius-1;dy<=radius+1;dy++)for(let dx=-radius-1;dx<=radius+1;dx++){
      if(dx*dx+dy*dy>(radius+1)**2)continue;const xx=x+dx,yy=y+dy;if(xx>=0&&xx<w&&yy>=0&&yy<h)boldInk[yy*w+xx]=1;
    }
  }
  return {version:3,confidence,colorInk,answerInk,handInk,boldInk,printInk,picture,structure,lineRepair,answerRegions};
}
