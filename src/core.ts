export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };
export type Tool = 'erase' | 'restore' | 'protect' | 'unprotect' | 'region' | 'pan' | 'sample' | 'text';
export type BrushStroke = { tool: Exclude<Tool, 'region' | 'pan' | 'sample' | 'text'>; radius: number; points: Point[] };
export type Stroke = BrushStroke | TextPatch;
export type Edit = { threshold: number; inkType: 'auto'|'black'; color: 'none' | 'red' | 'blue' | 'both'; protectPrint: boolean; allowNeutralInk: boolean; autoAnswers: boolean; repair: 'paper'|'texture'; grow: boolean; region: Rect | null; strokes: Stroke[] };
export const initialEdit = (): Edit => ({ threshold: 0.8, inkType: 'auto', color: 'none', protectPrint: true, allowNeutralInk: false, autoAnswers: true, repair: 'paper', grow: true, region: null, strokes: [] });
export type History = { past: Edit[]; present: Edit; future: Edit[] };
export function changeHistory(h: History, next: Edit | 'undo' | 'redo'): History {
  if (next === 'undo') return h.past.length ? { past: h.past.slice(0, -1), present: h.past.at(-1)!, future: [h.present, ...h.future] } : h;
  if (next === 'redo') return h.future.length ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) } : h;
  return { past: [...h.past, h.present].slice(-50), present: next, future: [] };
}
export function validQuad(q: Point[]): boolean {
  if (q.length !== 4 || q.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.y < 0 || p.x > 1 || p.y > 1)) return false;
  const crosses = q.map((p, i) => { const b = q[(i + 1) % 4], c = q[(i + 2) % 4]; return (b.x - p.x) * (c.y - b.y) - (b.y - p.y) * (c.x - b.x); });
  const area = Math.abs(q.reduce((s, p, i) => s + p.x * q[(i + 1) % 4].y - p.y * q[(i + 1) % 4].x, 0)) / 2;
  return crosses.every(c => c > 0.0001) && area > 0.025;
}
export function drawMasks(strokes: Stroke[], width: number, height: number) {
  const erase = new Uint8Array(width * height), reject = new Uint8Array(width * height), keep = new Uint8Array(width * height);
  const patches = strokes.some(s => s.tool === 'text') ? new Int32Array(width * height) : undefined;
  const paint = (p: Point, radius: number, tool: BrushStroke['tool']) => {
    const cx = p.x * width, cy = p.y * height, r = Math.max(0.75, radius * width), rr = r * r;
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(height - 1, Math.ceil(cy + r)); y++) {
      for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(width - 1, Math.ceil(cx + r)); x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 > rr) continue;
        const i = y * width + x;
        if (tool === 'erase') { erase[i] = 1; reject[i] = 0; }
        if (tool === 'restore') { erase[i] = 0; reject[i] = 1; }
        if (patches && (tool === 'erase' || tool === 'restore')) patches[i] = 0;
        if (tool === 'protect') keep[i] = 1;
        if (tool === 'unprotect') keep[i] = 0;
      }
    }
  };
  for (let s = 0; s < strokes.length; s++) {
    const stroke = strokes[s];
    if (stroke.tool === 'text') {
      const b = patchBounds(stroke, width, height);
      for (let y = Math.max(0, b.y); y < Math.min(height, b.y + b.h); y++) for (let x = Math.max(0, b.x); x < Math.min(width, b.x + b.w); x++) { const i = y * width + x; patches![i] = s + 1; erase[i] = 0; reject[i] = 0; }
      continue;
    }
    if (!stroke.points.length) continue;
    paint(stroke.points[0], stroke.radius, stroke.tool);
    for (let j = 1; j < stroke.points.length; j++) {
      const a = stroke.points[j - 1], b = stroke.points[j];
      const steps = Math.max(1, Math.ceil(Math.hypot((a.x - b.x) * width, (a.y - b.y) * height) / Math.max(1, stroke.radius * width * 0.6)));
      for (let k = 1; k <= steps; k++) paint({ x: a.x + (b.x - a.x) * k / steps, y: a.y + (b.y - a.y) * k / steps }, stroke.radius, stroke.tool);
    }
  }
  return { erase, reject, keep, patches };
}
export function colorCandidate(r: number, g: number, b: number, mode: Edit['color']): boolean {
  const red = r > g * 1.2 + 14 && r > b * 1.12 + 10 && Math.min(g, b) < 210;
  const blue = b > r * 1.15 + 12 && b > g * 1.08 + 8 && Math.min(r, g) < 210;
  return mode === 'red' ? red : mode === 'blue' ? blue : mode === 'both' && (red || blue);
}
export function composeMask(image: { width: number; height: number; data: Uint8ClampedArray }, edit: Edit, ai?: { handwriting: Float32Array; print: Float32Array; hints?: InkHints } | null) {
  const { width: w, height: h, data } = image, n = w * h;
  if (ai && (ai.handwriting.length !== n || ai.print.length !== n)) throw new Error('AI 遮罩尺寸與底圖不符，請重新分析。');
  const manual = drawMasks(edit.strokes, w, h), candidate = new Uint8Array(n), mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const black = edit.inkType !== 'black' || edit.allowNeutralInk && edit.region || ai?.hints?.boldInk?.[i];
    candidate[i] = Number(!!manual.erase[i] || black && !!ai && Math.max(ai.hints ? ai.hints.confidence[i]/255 : ai.handwriting[i], edit.allowNeutralInk && edit.region ? ai.handwriting[i] : 0) >= edit.threshold || colorCandidate(data[4 * i], data[4 * i + 1], data[4 * i + 2], edit.color));
  }
  let count = 0, protectedCount = 0;
  const blocked = new Uint8Array(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    const selected = candidate[i];
    const region = edit.region, allowed = !region || x / w >= region.x && x / w <= region.x + region.w && y / h >= region.y && y / h <= region.y + region.h;
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const neutralInk = Math.max(r, g, b) - Math.min(r, g, b) < 26 && Math.min(r, g, b) < 245;
    const supported = !!ai?.hints?.colorInk[i] || !!ai?.hints?.handInk?.[i] || !!edit.autoAnswers && !!ai?.hints?.answerInk[i];
    const protectNeutral = neutralInk && !(edit.allowNeutralInk && region) && !supported && !manual.erase[i];
    const protectedPixel = manual.keep[i] || protectNeutral || !!ai?.hints?.structure[i] && !ai?.hints?.lineRepair?.[i] && !manual.erase[i] || edit.protectPrint && ai && (ai.print[i] >= 0.65 && !supported || ai.hints?.printInk?.[i] || ai.hints?.picture?.[i] || edit.inkType==='black' && !ai.hints?.boldInk?.[i] && neutralInk && !(edit.allowNeutralInk&&region)) && !manual.erase[i];
    if (selected && protectedPixel) protectedCount++;
    blocked[i] = Number(!allowed || !!manual.reject[i] || !!protectedPixel);
    if (selected && !blocked[i]) mask[i] = 255;
  }
  // Only accepted pixels can grow; two one-pixel steps cannot jump a protected stroke.
  if (edit.grow) for (let step=0;step<2;step++) {
    const previous=mask.slice();
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const i=y*w+x;if(previous[i]||blocked[i])continue;
      for(let dy=-1;dy<=1&&!mask[i];dy++)for(let dx=-1;dx<=1;dx++){const xx=x+dx,yy=y+dy;if(xx>=0&&xx<w&&yy>=0&&yy<h&&previous[yy*w+xx]){mask[i]=255;break;}}
    }
  }
  for(let i=0;i<n;i++)if(mask[i])count++;
  return { mask, keep: manual.keep, patches: manual.patches, count, protectedCount };
}
export function resizeProbabilities(input: Float32Array, width: number, height: number, outW: number, outH: number) {
  const out = new Float32Array(outW * outH);
  for (let y = 0; y < outH; y++) for (let x = 0; x < outW; x++) out[y * outW + x] = input[Math.min(height - 1, Math.floor(y * height / outH)) * width + Math.min(width - 1, Math.floor(x * width / outW))];
  return out;
}
export function sauvola(image: { width: number; height: number; data: Uint8ClampedArray }) {
  const { width: w, height: h, data } = image, n = w * h, sumX = new Float32Array(n), sqX = new Float32Array(n), out = new Uint8Array(n), gray = new Float32Array(n);
  for (let i = 0; i < n; i++) gray[i] = (0.2125 * data[i * 4] + 0.7154 * data[i * 4 + 1] + 0.0721 * data[i * 4 + 2]) / 255;
  const reflect = (i: number, size: number): number => size <= 1 ? 0 : i < 0 ? reflect(-i, size) : i >= size ? reflect(size * 2 - i - 2, size) : i;
  for (let y = 0; y < h; y++) {
    let s = 0, ss = 0;
    for (let dx = -7; dx <= 7; dx++) { const v = gray[y * w + reflect(dx, w)]; s += v; ss += v * v; }
    for (let x = 0; x < w; x++) {
      const i = y * w + x; sumX[i] = s; sqX[i] = ss;
      const a = gray[y * w + reflect(x - 7, w)], b = gray[y * w + reflect(x + 8, w)]; s += b - a; ss += b * b - a * a;
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0, ss = 0;
    for (let dy = -7; dy <= 7; dy++) { s += sumX[reflect(dy, h) * w + x]; ss += sqX[reflect(dy, h) * w + x]; }
    for (let y = 0; y < h; y++) {
      const i = y * w + x, mean = s / 225, sd = Math.sqrt(Math.max(0, ss / 225 - mean * mean));
      out[i] = Number(gray[i] < mean * (1 + 0.2 * (sd - 1)));
      const a = reflect(y - 7, h) * w + x, b = reflect(y + 8, h) * w + x; s += sumX[b] - sumX[a]; ss += sqX[b] - sqX[a];
    }
  }
  return out;
}
import type { InkHints } from './refine';
import { patchBounds, type TextPatch } from './textRepair.ts';
