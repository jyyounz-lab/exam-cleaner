type Component = { pixels: number[]; x0: number; x1: number; y0: number; y1: number };
function components(mask: Uint8Array, w: number, h: number) {
  const visited = new Uint8Array(mask.length), result: Component[] = [];
  for (let seed = 0; seed < mask.length; seed++) {
    if (!mask[seed] || visited[seed]) continue;
    const c: Component = { pixels: [seed], x0: seed % w, x1: seed % w, y0: Math.floor(seed / w), y1: Math.floor(seed / w) };
    visited[seed] = 1;
    for (let k = 0; k < c.pixels.length; k++) {
      const i = c.pixels[k], x = i % w, y = Math.floor(i / w);
      c.x0 = Math.min(c.x0, x); c.x1 = Math.max(c.x1, x); c.y0 = Math.min(c.y0, y); c.y1 = Math.max(c.y1, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy, j = yy * w + xx;
        if (xx >= 0 && xx < w && yy >= 0 && yy < h && mask[j] && !visited[j]) { visited[j] = 1; c.pixels.push(j); }
      }
    }
    result.push(c);
  }
  return result;
}

// Contrast is relative to nearby paper; a shaded page must not become one dark component.
export function printLayout(w: number, h: number, strength: Uint8Array, color: Uint8Array, printed: Float32Array) {
  const n = w * h, hard = new Uint8Array(n), keep = new Uint8Array(n), answers = new Uint8Array(n);
  for (let i = 0; i < n; i++) hard[i] = Number(strength[i] >= 100 && !color[i]);
  const all = components(hard, w, h), maxGlyph = Math.max(24, Math.min(w, h) * .045);
  const glyphs = all.filter(c => c.pixels.length >= 2 && c.x1 - c.x0 < maxGlyph && c.y1 - c.y0 < maxGlyph);
  const anchors = glyphs.filter(c => c.pixels.reduce((s, i) => s + printed[i], 0) / c.pixels.length > .5);
  for (const c of glyphs) {
    const cw = c.x1 - c.x0 + 1, ch = c.y1 - c.y0 + 1;
    let vertical = 0, horizontal = 0;
    for (const a of anchors) {
      if (a === c) continue;
      const aw = a.x1 - a.x0 + 1, ah = a.y1 - a.y0 + 1;
      const xGap = Math.max(a.x0 - c.x1, c.x0 - a.x1), yGap = Math.max(a.y0 - c.y1, c.y0 - a.y1);
      if (yGap > 0 && yGap < Math.max(ch, ah) * 3 && Math.abs((a.x0 + a.x1 - c.x0 - c.x1) / 2) < Math.max(cw, aw) * .65 && aw / cw > .35 && aw / cw < 3) vertical++;
      if (xGap > 0 && xGap < Math.max(cw, aw) * 3 && Math.abs((a.y0 + a.y1 - c.y0 - c.y1) / 2) < Math.max(ch, ah) * .65 && ah / ch > .35 && ah / ch < 3) horizontal++;
    }
    if (vertical >= 2 || horizontal >= 2) for (const i of c.pixels) keep[i] = 1;
  }

  const arcs: (Component & { bend: number })[] = [];
  for (const c of glyphs) {
    const cw = c.x1 - c.x0 + 1, ch = c.y1 - c.y0 + 1;
    if (cw < 8 || ch < 3 || cw < ch * 1.8 || cw > ch * 6 || c.pixels.length / (cw * ch) > .7) continue;
    const sums = [0, 0, 0], counts = [0, 0, 0];
    for (const i of c.pixels) { const bin = Math.min(2, Math.floor((i % w - c.x0) * 3 / cw)); sums[bin] += Math.floor(i / w); counts[bin]++; }
    if (counts.some(c => !c)) continue;
    const bend = (sums[0] / counts[0] + sums[2] / counts[2]) / 2 - sums[1] / counts[1];
    if (Math.abs(bend) >= Math.max(.8, ch * .18)) arcs.push({ ...c, bend });
  }
  const brackets = arcs.filter(c => arcs.filter(a => a !== c && Math.sign(a.bend) === Math.sign(c.bend) && (a.x1-a.x0+1)/(c.x1-c.x0+1) > .7 && (a.x1-a.x0+1)/(c.x1-c.x0+1) < 1.4 && Math.hypot(a.x0-c.x0,a.y0-c.y0) < maxGlyph * 18).length >= 2);
  let pairs = 0;
  for (const c of brackets) {
    for (const i of c.pixels) keep[i] = 1;
    if (c.bend < 0) continue;
    const cw = c.x1 - c.x0 + 1;
    const bottom = brackets.filter(a => a.bend < 0 && a.y0 - c.y1 > cw && a.y0 - c.y1 < cw * 14 && Math.abs((a.x0+a.x1-c.x0-c.x1)/2) < cw * .65 && (a.x1-a.x0+1)/cw > .65 && (a.x1-a.x0+1)/cw < 1.5).sort((a,b) => a.y0-b.y0)[0];
    if (!bottom) continue;
    pairs++;
    for (let y=c.y1+2;y<bottom.y0-1;y++) for (let x=Math.max(0,Math.floor(Math.min(c.x0,bottom.x0)-cw*.35));x<Math.min(w,Math.ceil(Math.max(c.x1,bottom.x1)+cw*.35));x++) answers[y*w+x]=1;
  }

  // Erosion separates printed connection dots from the thin pencil lines touching them.
  const radius = Math.max(1, Math.round(Math.min(w,h)/550)), solid = new Uint8Array(n);
  for (let y=radius;y<h-radius;y++) for (let x=radius;x<w-radius;x++) {
    const i=y*w+x;if(!hard[i]) continue;
    let ok=true;
    for(let dy=-radius;dy<=radius&&ok;dy++)for(let dx=-radius;dx<=radius;dx++)if(dx*dx+dy*dy<=radius*radius&&!hard[(y+dy)*w+x+dx]){ok=false;break;}
    solid[i]=Number(ok);
  }
  // Tiny eroded fragments also occur along thin handwriting; require a solid two-dimensional core.
  const dots=components(solid,w,h).filter(c=>c.pixels.length>=Math.max(4,radius*radius*2)&&c.x1-c.x0>=radius&&c.y1-c.y0>=radius&&c.x1-c.x0<=radius*4&&c.y1-c.y0<=radius*4&&Math.abs((c.x1-c.x0)-(c.y1-c.y0))<=radius*2);
  const matchedDots=dots.filter(c=>dots.filter(a=>a!==c&&Math.abs((a.y0+a.y1-c.y0-c.y1)/2)<=radius*4&&Math.abs((a.x0+a.x1-c.x0-c.x1)/2)>radius*8&&Math.abs((a.x0+a.x1-c.x0-c.x1)/2)<maxGlyph*6).length>=2);
  for(const c of matchedDots) {
    for(let y=Math.max(0,c.y0-radius-2);y<=Math.min(h-1,c.y1+radius+2);y++)for(let x=Math.max(0,c.x0-radius-2);x<=Math.min(w-1,c.x1+radius+2);x++)if(strength[y*w+x]>12&&!color[y*w+x])keep[y*w+x]=1;
  }
  const centers=keep.slice();
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(centers[y*w+x])for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
    const xx=x+dx,yy=y+dy;if(xx>=0&&xx<w&&yy>=0&&yy<h&&strength[yy*w+xx]>5&&!color[yy*w+xx])keep[yy*w+xx]=1;
  }
  return {keep,answers,pairs};
}
