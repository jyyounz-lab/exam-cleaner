import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeMask, drawMasks, validQuad, initialEdit, changeHistory, sauvola, colorCandidate } from '../src/core.ts';
const image = (w = 20, h = 20) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(255) });
test('保留區與排除區在膨脹後仍完全不被清除', () => {
  const img = image(), ai = { handwriting: new Float32Array(400).fill(.99), print: new Float32Array(400) };
  const edit = initialEdit(); edit.strokes = [{ tool: 'protect', radius: .12, points: [{ x: .5, y: .5 }] }, { tool: 'restore', radius: .08, points: [{ x: .25, y: .25 }] }];
  const raw = drawMasks(edit.strokes, 20, 20), result = composeMask(img, edit, ai);
  assert.ok(result.count > 200); for (let i = 0; i < 400; i++) if (raw.keep[i] || raw.reject[i]) assert.equal(result.mask[i], 0);
});
test('框選只限制處理範圍，沒有候選時不擦整塊', () => {
  const img = image(), edit = initialEdit(); edit.region = { x: .25, y: .25, w: .5, h: .5 };
  assert.equal(composeMask(img, edit).count, 0);
  const ai = { handwriting: new Float32Array(400).fill(.95), print: new Float32Array(400) };
  const result = composeMask(img, edit, ai); assert.ok(result.count > 0); assert.equal(result.mask[0], 0); assert.equal(result.mask[210], 255);
});
test('印刷保護可以阻止AI誤刪，人工保留即使關閉印刷保護仍有效', () => {
  const ai = { handwriting: new Float32Array(400).fill(.9), print: new Float32Array(400).fill(.8) };
  const edit = initialEdit(); assert.equal(composeMask(image(), edit, ai).count, 0);
  edit.protectPrint = false; assert.equal(composeMask(image(), edit, ai).count, 400);
  edit.strokes = [{ tool: 'protect', radius: 2, points: [{ x: .5, y: .5 }] }]; assert.equal(composeMask(image(), edit, ai).count, 0);
});
test('筆刷：還原扣除AI候選，補擦可重新加入，取消保留不破壞其他層', () => {
  const p = { x: .5, y: .5 }, strokes = [{ tool: 'restore' as const, radius: .1, points: [p] }, { tool: 'erase' as const, radius: .1, points: [p] }, { tool: 'protect' as const, radius: .1, points: [p] }, { tool: 'unprotect' as const, radius: .1, points: [p] }];
  const result = drawMasks(strokes, 20, 20); assert.equal(result.erase[210], 1); assert.equal(result.reject[210], 0); assert.equal(result.keep[210], 0);
});
test('色彩輔助不把黑字或白紙當紅藍筆', () => {
  assert.equal(colorCandidate(20, 20, 20, 'both'), false); assert.equal(colorCandidate(255, 255, 255, 'both'), false);
  assert.equal(colorCandidate(170, 40, 30, 'red'), true); assert.equal(colorCandidate(35, 65, 180, 'blue'), true);
  assert.equal(colorCandidate(170, 40, 30, 'none'), false);
});
test('遮罩尺寸驗證阻止錯誤座標被套用', () => { assert.throws(() => composeMask(image(), initialEdit(), { handwriting: new Float32Array(4), print: new Float32Array(4) }), /尺寸/); });
test('研究模型預設保留黑灰題目，只有明確答案選區才能納入中性墨色AI候選', () => {
  const img = image(); for (let i = 0; i < img.data.length; i += 4) img.data[i] = img.data[i+1] = img.data[i+2] = 70;
  const ai = { handwriting: new Float32Array(400).fill(.99), print: new Float32Array(400) }, edit = initialEdit();
  assert.equal(composeMask(img, edit, ai).count, 0); edit.allowNeutralInk = true; assert.equal(composeMask(img, edit, ai).count, 0);
  edit.region = { x: .25, y: .25, w: .5, h: .5 }; const result = composeMask(img, edit, ai); assert.ok(result.count > 0); assert.equal(result.mask[0], 0);
  edit.allowNeutralInk = false; edit.region = null; edit.strokes = [{ tool: 'erase', radius: .1, points: [{x:.5,y:.5}] }]; assert.ok(composeMask(img, edit, ai).count > 0);
});
test('四角只接受順序正確、凸形且面積足夠的紙張', () => {
  assert.equal(validQuad([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]), true);
  assert.equal(validQuad([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 0 }, { x: 0, y: 1 }]), false);
  assert.equal(validQuad([{ x: NaN, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]), false);
});
test('復原與重做涵蓋門檻及人工操作，新修改清除重做分支', () => {
  let h = { past: [] as ReturnType<typeof initialEdit>[], present: initialEdit(), future: [] as ReturnType<typeof initialEdit>[] };
  h = changeHistory(h, { ...h.present, threshold: .9 }); h = changeHistory(h, { ...h.present, color: 'red' });
  h = changeHistory(h, 'undo'); assert.equal(h.present.color, 'none'); h = changeHistory(h, 'undo'); assert.equal(h.present.threshold, .8);
  h = changeHistory(h, 'redo'); assert.equal(h.present.threshold, .9); h = changeHistory(h, { ...h.present, color: 'blue' }); assert.equal(h.future.length, 0);
});
test('Sauvola浮點R=1.0與獨立直接計算一致，白紙不產生墨色', () => {
  const img = image(21, 19); for (let y = 3; y < 17; y++) for (let x = 4; x < 17; x++) if ((x + y) % 3) for (let c = 0; c < 3; c++) img.data[(y * 21 + x) * 4 + c] = 40;
  const output = sauvola(img), reflect = (i: number, n: number): number => i < 0 ? reflect(-i, n) : i >= n ? reflect(2 * n - i - 2, n) : i;
  for (let y = 0; y < 19; y++) for (let x = 0; x < 21; x++) { let sum = 0, sq = 0; for (let dy = -7; dy <= 7; dy++) for (let dx = -7; dx <= 7; dx++) { const i = (reflect(y + dy, 19) * 21 + reflect(x + dx, 21)) * 4; const value = img.data[i] / 255; sum += value; sq += value * value; } const mean = sum / 225, sd = Math.sqrt(Math.max(0, sq / 225 - mean * mean)); assert.equal(output[y * 21 + x], Number(img.data[(y * 21 + x) * 4] / 255 < mean * (1 + .2 * (sd - 1)))); }
  assert.equal(sauvola(image()).some(Boolean), false);
});
