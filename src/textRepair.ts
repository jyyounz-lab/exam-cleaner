import type { Rect, Point, Stroke } from './core';

type Pixels = { width: number; height: number; data: Uint8ClampedArray };
export type TextPatch = { tool: 'text'; source: Rect; target: Point; sample?: Pixels };
export function patchBounds(patch: TextPatch, width: number, height: number) {
  const sx = Math.max(0, Math.min(width - 1, Math.round(patch.source.x * width)));
  const sy = Math.max(0, Math.min(height - 1, Math.round(patch.source.y * height)));
  const w = Math.max(1, Math.min(width - sx, Math.round(patch.source.w * width)));
  const h = Math.max(1, Math.min(height - sy, Math.round(patch.source.h * height)));
  return { sx, sy, w, h, x: Math.round(patch.target.x * width - w / 2), y: Math.round(patch.target.y * height - h / 2) };
}

function paperColor(image: Pixels, x: number, y: number, w: number, h: number) {
  const samples: number[] = [], { width, height, data } = image;
  const step = Math.max(1, Math.floor(Math.sqrt(w * h / 4096)));
  for (let yy = Math.max(0, y); yy < Math.min(height, y + h); yy += step) for (let xx = Math.max(0, x); xx < Math.min(width, x + w); xx += step) samples.push((yy * width + xx) * 4);
  samples.sort((a, b) => data[a] + data[a + 1] + data[a + 2] - data[b] - data[b + 1] - data[b + 2]);
  const from = Math.floor(samples.length * .65), to = Math.max(from + 1, Math.ceil(samples.length * .9));
  const color = [0, 0, 0];
  for (let i = from; i < to; i++) for (let c = 0; c < 3; c++) color[c] += data[samples[i] + c] / (to - from);
  return color;
}

export function sampleText(image: Pixels, source: Rect): Pixels {
  const b = patchBounds({ tool: 'text', source, target: { x: 0, y: 0 } }, image.width, image.height), data = new Uint8ClampedArray(b.w * b.h * 4);
  for (let y = 0; y < b.h; y++) data.set(image.data.subarray(((b.sy+y)*image.width+b.sx)*4,((b.sy+y)*image.width+b.sx+b.w)*4),y*b.w*4);
  return { width: b.w, height: b.h, data };
}

// A snapshot of the confirmed sample prevents later edits from silently changing its letters.
export function applyTextPatches(original: Pixels, cleaned: Pixels, strokes: Stroke[], owners?: Int32Array, keep?: Uint8Array): Pixels {
  if (!owners) return cleaned;
  const { width, height } = original, data = cleaned.data.slice();
  for (let s = 0; s < strokes.length; s++) {
    const stroke = strokes[s]; if (stroke.tool !== 'text') continue;
    const b = patchBounds(stroke, width, height);
    if (b.x >= width || b.y >= height || b.x + b.w <= 0 || b.y + b.h <= 0) continue;
    const source = stroke.sample || sampleText(original, stroke.source);
    if (source.width !== b.w || source.height !== b.h || source.data.length !== b.w * b.h * 4) throw new Error('文字取樣尺寸不符，請重新框選完整文字。');
    const sourcePaper = paperColor(source, 0, 0, b.w, b.h), targetPaper = paperColor(cleaned, b.x, b.y, b.w, b.h);
    for (let y = Math.max(0, b.y); y < Math.min(height, b.y + b.h); y++) for (let x = Math.max(0, b.x); x < Math.min(width, b.x + b.w); x++) {
      const i = y * width + x; if (owners[i] !== s + 1 || keep?.[i]) continue;
      const src = ((y - b.y) * b.w + x - b.x) * 4;
      const blend = Math.min(1, (x - b.x + 1) / 3, (b.x + b.w - x) / 3, (y - b.y + 1) / 3, (b.y + b.h - y) / 3);
      for (let c = 0; c < 3; c++) data[i * 4 + c] = source.data[src + c] * targetPaper[c] / Math.max(1, sourcePaper[c]) * blend + cleaned.data[i * 4 + c] * (1 - blend);
      data[i * 4 + 3] = source.data[src + 3];
    }
  }
  return { width, height, data };
}
