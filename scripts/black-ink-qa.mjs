import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

// Same ONNX weights and input; compare the shipped 0.2.0 selection with the new selection.
const baseline = 'f3dcc218665e8d9b178d36baf6169afa7f1e0563';
await mkdir('test-results', { recursive: true });
for (const file of ['core', 'refine']) await writeFile(`test-results/v020-${file}.ts`, execFileSync('git', ['show', `${baseline}:src/${file}.ts`], { encoding: 'utf8' }));
const browser = await chromium.launch({ ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {}), headless: true });
const reports = [];
try {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:4173/');
  for (const fixture of [{ id: 'black-flat', scale: 1, shadow: false }, { id: 'black-shadow', scale: 1, shadow: true }, { id: 'black-large', scale: 1.5, shadow: false }]) {
    console.log(`Evaluating ${fixture.id}`);
    const report = await page.evaluate(async fixture => {
      const { analyse } = await import('/src/ai.ts'), core = await import('/src/core.ts'), old = await import('/test-results/v020-core.ts'), { refineInk: oldRefine } = await import('/test-results/v020-refine.ts'), { processImage } = await import('/src/processor.ts');
      const c = document.createElement('canvas'); c.width = 800 * fixture.scale; c.height = 1100 * fixture.scale;
      const ctx = c.getContext('2d'); ctx.scale(fixture.scale, fixture.scale);
      const gradient = ctx.createLinearGradient(0, 0, 800, 500); gradient.addColorStop(0, '#c8c6bf'); gradient.addColorStop(1, '#fffdf8');
      ctx.fillStyle = fixture.shadow ? gradient : '#fff'; ctx.fillRect(0, 0, 800, 1100);
      ctx.fillStyle = '#222'; ctx.font = 'bold 30px "Microsoft JhengHei"'; ctx.fillText('數學練習：請保留題目', 60, 80);
      ctx.font = '22px "Microsoft JhengHei"'; ctx.fillText('一、算算看，寫出計算過程。', 60, 160);
      ctx.font = '26px Arial'; ['1. 24 + 18 =', '2. 56 − 29 =', '3. 81 ÷ 9 =', '4. 7 × 8 ='].forEach((s, i) => ctx.fillText(s, 60, 280 + i * 140));
      ctx.font = '18px "Microsoft JhengHei"'; ctx.fillText('有 12 顆糖果，平均分給 3 個人，各得多少？', 60, 850);
      ctx.font = '18px Arial'; ctx.fillText('x + y = 20    3/4 − 1/2 = ?     (  )     10 cm', 60, 890);
      ctx.font = '14px "Microsoft JhengHei"'; ctx.fillText('合成開發測試：黑筆、灰色殘邊與無底線作答', 60, 1040);
      const clean = ctx.getImageData(0, 0, c.width, c.height), regions = [];
      function stroke(points, width = 3, color = '#222') { ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath(); points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke(); }
      function digits(x, y, color = '#222') { stroke([[x + 24, y], [x + 2, y + 31], [x + 36, y + 28]], 3, color); stroke([[x + 26, y + 2], [x + 24, y + 48]], 3, color); stroke([[x + 46, y + 9], [x + 51, y + 1], [x + 64, y - 1], [x + 73, y + 6], [x + 73, y + 15], [x + 45, y + 47], [x + 79, y + 43]], 3, color); }
      digits(330, 225); regions.push({ name: 'black_without_underline', box: [325, 220, 415, 280] });
      digits(330, 365, '#666'); regions.push({ name: 'gray_ink_without_underline', box: [325, 360, 415, 420] });
      stroke([[330, 515], [360, 512], [340, 560]], 3); regions.push({ name: 'isolated_black_digit', box: [325, 507, 365, 566] });
      // Different ink density within a single connected stroke exposes partial-stroke deletion.
      stroke([[330, 645], [360, 642], [340, 690]], 3, '#888'); stroke([[330, 645], [360, 642], [350, 666]], 3, '#222');
      regions.push({ name: 'mixed_density_stroke', box: [325, 637, 365, 696] });
      const input = ctx.getImageData(0, 0, c.width, c.height), ai = await analyse(input, () => {}).promise;
      const oldAi = { ...ai, hints: oldRefine(input, ai, core.sauvola(input)) };
      const oldMask = old.composeMask(input, old.initialEdit(), oldAi).mask, mask = core.composeMask(input, core.initialEdit(), ai).mask;
      const before = await processImage('clean', input, { mask: oldMask, repair: 'paper', structure: oldAi.hints.structure, lineRepair: oldAi.hints.lineRepair });
      const after = await processImage('clean', input, { mask, repair: 'paper', structure: ai.hints.structure, lineRepair: ai.hints.lineRepair });
      function metrics(result, mask, box = [0, 0, 800, 1100]) {
        const roi = box.map(v => Math.round(v * fixture.scale));
        let ink = 0, selected = 0, initialError = 0, error = 0, printed = 0, changedPrint = 0, outside = 0;
        for (let y = roi[1]; y < roi[3]; y++) for (let x = roi[0]; x < roi[2]; x++) {
          const i = y * c.width + x, p = i * 4, delta = [0, 1, 2].reduce((sum, k) => sum + Math.abs(input.data[p + k] - clean.data[p + k]), 0);
          const changed = [0, 1, 2, 3].some(k => input.data[p + k] !== result.data[p + k]);
          if (delta > 24) { ink++; selected += !!mask[i]; initialError += delta; error += [0, 1, 2].reduce((s, k) => s + Math.abs(result.data[p + k] - clean.data[p + k]), 0); }
          if (delta === 0 && Math.max(clean.data[p], clean.data[p + 1], clean.data[p + 2]) < 180) { printed++; changedPrint += changed; }
          if (!mask[i] && changed) outside++;
        }
        return { ink, selected, coverage: selected / Math.max(1, ink), inkErrorRemoved: 1 - error / Math.max(1, initialError), printed, changedPrint, changedOutside: outside };
      }
      const png = image => { const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height; canvas.getContext('2d').putImageData(image, 0, 0); return canvas.toDataURL(); };
      return { id: fixture.id, elapsed: ai.elapsed, before: metrics(before, oldMask), after: metrics(after, mask), regions: regions.map(r => ({ name: r.name, before: metrics(before, oldMask, r.box), after: metrics(after, mask, r.box) })), images: { input: png(input), before: png(before), after: png(after) } };
    }, fixture);
    for (const [key, data] of Object.entries(report.images)) await writeFile(`test-results/${fixture.id}-${key}.png`, Buffer.from(data.split(',')[1], 'base64'));
    delete report.images; reports.push(report); console.log(JSON.stringify(report));
  }
  await writeFile('test-results/black-ink-qa.json', JSON.stringify({ baseline, kind: 'synthetic_development_regression_not_real_exam_accuracy', cases: reports }, null, 2));
  for (const r of reports) {
    assert.ok(r.after.coverage >= .97, `${r.id}: incomplete black handwriting`);
    assert.ok(r.after.inkErrorRemoved >= .96, `${r.id}: residual ink`);
    assert.equal(r.after.changedPrint, 0, `${r.id}: printed content damaged`); assert.equal(r.after.changedOutside, 0);
    for (const region of r.regions) assert.ok(region.after.coverage >= .95, `${r.id}/${region.name}: partial stroke`);
  }
  console.log('PASS: black-ink regression, printed protection, and background repair.');
} finally { await browser.close(); }
