type Pixels = { width: number; height: number; data: Uint8ClampedArray };
export type InkHints = { version: 1; confidence: Uint8Array; colorInk: Uint8Array; answerInk: Uint8Array; structure: Uint8Array; lineRepair: Uint8Array; answerRegions: number };

export function refineInk(image: Pixels, prediction: { handwriting: Float32Array; print: Float32Array }, binary: Uint8Array): InkHints {
  const { width: w, height: h, data } = image, n = w * h;
  const confidence = new Uint8Array(n), colorInk = new Uint8Array(n), answerInk = new Uint8Array(n), structure = new Uint8Array(n), bands = new Uint8Array(n);
  const samples: number[][] = [[], [], []];
  const stride = Math.max(1, Math.floor(n / 12000));
  for (let i = 0; i < n; i += stride) if (Math.min(data[i*4], data[i*4+1], data[i*4+2]) > 180) for (let c = 0; c < 3; c++) samples[c].push(data[i*4+c]);
  const paper = samples.map(a => a.length ? a.sort((a,b) => a-b)[Math.floor(a.length * .75)] : 255);
  const weakColor = new Uint8Array(n), strongColor = new Uint8Array(n), neutralDark = new Uint8Array(n), lineRepair = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const r = data[i*4], g = data[i*4+1], b = data[i*4+2];
    const red = Math.min(r-g-paper[0]+paper[1], r-b-paper[0]+paper[2]);
    const blue = Math.min(b-r-paper[2]+paper[0], b-g-paper[2]+paper[1]);
    const chroma = Math.max(r,g,b)-Math.min(r,g,b);
    weakColor[i] = Number(Math.max(red, blue) > 3 && (chroma > 9 || Math.min(r,g,b) > 205));
    strongColor[i] = Number(Math.max(red, blue) > 12 && chroma > 18);
    neutralDark[i] = Number(chroma < 26 && Math.max(r,g,b) < 220);
  }
  const lines: { x0:number; x1:number; y:number }[] = [], minLine = Math.max(40, Math.round(w * .05));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w;) {
      if (!binary[y*w+x]) { x++; continue; }
      const start = x; while (x < w && binary[y*w+x]) x++;
      if (x - start < minLine) continue;
      let dark=0;for(let xx=start;xx<x;xx++)dark+=neutralDark[y*w+xx];if(dark/(x-start)<.85)continue;
      for (let xx = start; xx < x; xx++) structure[y*w+xx] = 1;
      if (x-start <= w*.7 && !lines.some(l => Math.abs(l.y-y) <= 4 && Math.abs(l.x0-start) < 5 && Math.abs(l.x1-x) < 5)) lines.push({x0:start,x1:x,y});
    }
  }
  for (let x = 0; x < w; x++) for (let y = 0; y < h;) {
    if (!binary[y*w+x]) { y++; continue; } const start = y;
    while (y < h && binary[y*w+x]) y++;
    if (y-start >= Math.max(60, h*.045)) { let dark=0;for(let yy=start;yy<y;yy++)dark+=neutralDark[yy*w+x];if(dark/(y-start)>=.85)for (let yy = start; yy < y; yy++) structure[yy*w+x] |= 2; }
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
  const visited = new Uint8Array(n), queue = new Int32Array(n);
  for (let seed = 0; seed < n; seed++) {
    if (visited[seed] || structure[seed] || !binary[seed] && !weakColor[seed]) continue;
    let head = 0, tail = 1, colors = 0, inAnswer = 0, sumHand = 0, sumPrint = 0, maxHand = 0;
    let x0=w,y0=h,x1=0,y1=0; queue[0]=seed; visited[seed]=1;
    while (head < tail) {
      const i=queue[head++], x=i%w, y=Math.floor(i/w); colors += strongColor[i]; inAnswer += bands[i];
      sumHand += prediction.handwriting[i]; sumPrint += prediction.print[i]; maxHand=Math.max(maxHand,prediction.handwriting[i]);
      x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);
      for (let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++) { const xx=x+dx,yy=y+dy;if(xx<0||xx>=w||yy<0||yy>=h)continue;const j=yy*w+xx;if(!visited[j]&&!structure[j]&&(binary[j]||weakColor[j])){visited[j]=1;queue[tail++]=j;} }
    }
    const meanHand=sumHand/tail, meanPrint=sumPrint/tail;
    const small = tail >= 2 && tail < Math.max(20000,n*.025) && x1-x0 < Math.max(120,w*.55) && y1-y0 < Math.max(120,h*.2);
    const colored = small && colors >= 1 && colors/tail > .025 && !(meanPrint > .8 && meanHand < .12);
    const answer = small && !colored && inAnswer/tail > .82 && maxHand > .72 && meanHand > .35 && meanHand > meanPrint;
    if (!colored && !answer) continue;
    const score = Math.round(255 * (colored ? Math.max(.86,maxHand) : Math.max(.83,maxHand)));
    for(let q=0;q<tail;q++){const i=queue[q];confidence[i]=score;if(colored&&weakColor[i])colorInk[i]=1;if(answer&&bands[i])answerInk[i]=1;}
  }
  // Include faint fringes connected to accepted strokes, but keep structural lines separate.
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=y*w+x;if(confidence[i]||structure[i]||!weakColor[i])continue;let score=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)score=Math.max(score,confidence[(y+dy)*w+x+dx]);if(score){confidence[i]=score;colorInk[i]=1;}}
  const answerCenters=answerInk.slice();
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(answerCenters[y*w+x])for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){const xx=x+dx,yy=y+dy;if(xx>=0&&xx<w&&yy>=0&&yy<h){const j=yy*w+xx;if(bands[j]&&!structure[j])answerInk[j]=1;}}
  for(let i=0;i<n;i++)if(structure[i]&&strongColor[i]){lineRepair[i]=1;confidence[i]=Math.max(confidence[i],230);colorInk[i]=1;}
  return {version:1,confidence,colorInk,answerInk,structure,lineRepair,answerRegions};
}
