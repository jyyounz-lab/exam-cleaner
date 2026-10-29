import { chromium } from 'playwright';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const dir = 'test-results'; await mkdir(dir, { recursive: true });
const browser = await chromium.launch({ ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {}), headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, acceptDownloads: true });
const page = await context.newPage(), errors = [], sent = [], failed = [], checks = [];
page.on('pageerror', e => errors.push(e.message)); page.on('request', r => { if (!['GET', 'HEAD'].includes(r.method())) sent.push({ method: r.method(), url: r.url() }); }); page.on('response', r => { if (r.status() >= 400) failed.push({ status: r.status(), url: r.url() }); });
page.on('console', msg => { if (msg.type() === 'error') console.log('BROWSER:', msg.text().slice(0, 300)); });
try {
  await page.goto(process.env.APP_URL || 'http://127.0.0.1:4174/', { waitUntil: 'networkidle' });
  await page.screenshot({ path: `${dir}/home-desktop.png`, fullPage: true });
  for (const width of [320, 390, 768, 1440]) { await page.setViewportSize({ width, height: 1000 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `home overflow ${width}`); checks.push(`home responsive ${width}`); }
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.getByRole('button', { name: /先用示範考卷試試/ }).click(); await page.getByRole('button', { name: /完成校正，開始 AI 分析/ }).waitFor(); checks.push('demo imports');
  const originalDownload = page.waitForEvent('download'); await page.getByRole('button', { name: '下載原圖', exact: true }).click(); const original = await originalDownload; await original.saveAs(`${dir}/original.png`); const originalHash = createHash('sha256').update(await readFile(`${dir}/original.png`)).digest('hex');
  await page.getByRole('button', { name: /完成校正，開始 AI 分析/ }).click(); console.log('Started actual OpenCV calibration and ONNX browser WASM inference');
  await page.getByText('AI 分析已完成', { exact: true }).waitFor({ timeout: 180000 });
  await page.getByRole('button', { name: '確認匯出', exact: true }).waitFor({ state: 'visible' }); await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(b => b.textContent === '確認匯出')?.disabled, { timeout: 90000 });
  checks.push('actual ONNX WASM inference and OpenCV inpainting');
  const neutralBefore = await page.evaluate(() => { const c = document.querySelector('.paper-stage canvas'); window.neutralCheck = c.getContext('2d').getImageData(0, 0, c.width, c.height); return true; });
  await page.getByRole('button', { name: '清除預覽', exact: true }).click();
  const neutralCheck = await page.evaluate(() => { const a = window.neutralCheck.data, c = document.querySelector('.paper-stage canvas'), b = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let kept = 0, changed = 0; for (let i = 0; i < a.length; i += 4) if (Math.max(a[i],a[i+1],a[i+2])-Math.min(a[i],a[i+1],a[i+2])<26 && Math.min(a[i],a[i+1],a[i+2])<245) { kept++; if ([0,1,2,3].some(k => a[i+k]!==b[i+k])) changed++; } return {kept,changed}; });
  assert.ok(neutralBefore && neutralCheck.kept > 0); assert.equal(neutralCheck.changed, 0); checks.push('default AI preview preserves every black/gray ink pixel'); console.log('NEUTRAL PROTECTION', neutralCheck);
  await page.getByRole('button', { name: '待清除遮罩', exact: true }).click();
  console.log('AI RESULT:', await page.locator('.ai-state').innerText(), 'MASK:', await page.locator('.mask-summary').innerText());
  await page.screenshot({ path: `${dir}/editor-ai.png`, fullPage: true });
  for (const width of [320, 390, 768, 1440]) { await page.setViewportSize({ width, height: 1000 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `editor overflow ${width}`); checks.push(`editor responsive ${width}`); }
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.locator('.step-nav button').nth(2).click(); await page.getByRole('button', { name: '藍筆', exact: true }).click();
  await page.locator('.step-nav button').nth(3).click(); await page.getByRole('button', { name: '保留', exact: true }).click();
  const canvas = page.getByLabel('考卷遮罩編輯區'); const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width * .42, box.y + box.height * .24); await page.mouse.down(); await page.mouse.move(box.x + box.width * .52, box.y + box.height * .24, { steps: 6 }); await page.mouse.up();
  await page.getByRole('button', { name: '復原', exact: true }).click(); await page.getByRole('button', { name: '重做', exact: true }).click(); checks.push('semi-auto color, manual protect, undo and redo');
  await page.getByRole('button', { name: '儲存進度', exact: true }).click(); await page.getByText(/編輯進度已儲存在此瀏覽器/).waitFor(); checks.push('IndexedDB save');
  await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(b => b.textContent === '確認匯出')?.disabled, { timeout: 90000 });
  await page.evaluate(() => { const canvases = document.querySelectorAll('.paper-stage canvas'); window.qaPixels = { base: canvases[0].getContext('2d').getImageData(0, 0, canvases[0].width, canvases[0].height), overlay: canvases[1].getContext('2d').getImageData(0, 0, canvases[1].width, canvases[1].height) }; });
  await page.getByRole('button', { name: '清除預覽', exact: true }).click();
  const pixelCheck = await page.evaluate(() => { const before = window.qaPixels, c = document.querySelector('.paper-stage canvas'), after = c.getContext('2d').getImageData(0, 0, c.width, c.height); let protectedPixels = 0, changedProtected = 0, changedOutside = 0, changed = 0; for (let i = 0; i < after.data.length; i += 4) { const different = [0,1,2,3].some(k => before.base.data[i+k] !== after.data[i+k]); if (different) changed++; const green = before.overlay.data[i+1] > before.overlay.data[i] && before.overlay.data[i+3] > 0; if (green) { protectedPixels++; if (different) changedProtected++; } if (!before.overlay.data[i+3] && different) changedOutside++; } return { protectedPixels, changedProtected, changedOutside, changed }; });
  assert.ok(pixelCheck.protectedPixels > 0); assert.equal(pixelCheck.changedProtected, 0); assert.equal(pixelCheck.changedOutside, 0); assert.ok(pixelCheck.changed > 0); console.log('PIXEL CHECK', pixelCheck); checks.push('actual inpainting preserves all manual keep pixels and all pixels outside final mask');
  const cdp = await context.newCDPSession(page); await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
  const touchBox = await canvas.boundingBox(), cx = touchBox.x + Math.min(touchBox.width / 2, 260), cy = touchBox.y + 170;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{x:cx-35,y:cy,id:1},{x:cx+35,y:cy,id:2}] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{x:cx-70,y:cy,id:1},{x:cx+70,y:cy,id:2}] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForFunction(() => document.querySelector('.zoom-label').textContent !== '100%'); checks.push('two-finger touch zoom'); await page.getByRole('button', { name: '縮放重設為100%' }).click(); await cdp.detach();
  await page.getByRole('button', { name: '確認匯出', exact: true }).click(); assert.ok(await page.getByRole('button', { name: '下載 JPG', exact: true }).isDisabled());
  await page.getByLabel('我已檢查題目與清除範圍').check(); const jpgDownload = page.waitForEvent('download'); await page.getByRole('button', { name: '下載 JPG', exact: true }).click(); await (await jpgDownload).saveAs(`${dir}/cleaned.jpg`); checks.push('explicit export confirmation and JPG');
  await page.getByRole('button', { name: '確認匯出', exact: true }).click(); await page.getByLabel('我已檢查題目與清除範圍').check(); const pdfDownload = page.waitForEvent('download'); await page.getByRole('button', { name: '下載 A4 PDF', exact: true }).click(); await (await pdfDownload).saveAs(`${dir}/cleaned.pdf`); assert.ok((await readFile(`${dir}/cleaned.pdf`)).subarray(0, 4).toString() === '%PDF'); checks.push('valid PDF output');
  const secondDownload = page.waitForEvent('download'); await page.getByRole('button', { name: '下載原圖', exact: true }).click(); await (await secondDownload).saveAs(`${dir}/original-after.png`); assert.equal(createHash('sha256').update(await readFile(`${dir}/original-after.png`)).digest('hex'), originalHash); checks.push('original bytes remain identical after all editing and exports');
  page.on('dialog', d => d.accept()); await page.reload({ waitUntil: 'networkidle' }); await page.getByRole('button', { name: /繼續編輯/ }).click(); await page.locator('.mask-summary').waitFor(); checks.push('restore saved session');
  await page.screenshot({ path: `${dir}/editor-restored.png`, fullPage: true });
  await page.getByText('工具與 AI 已可離線使用', { exact: true }).waitFor({ timeout: 60000 });
  await context.setOffline(true); await page.reload({ waitUntil: 'networkidle' }); await page.getByRole('button', { name: /先用示範考卷試試/ }).click(); await page.getByRole('button', { name: /完成校正，開始 AI 分析/ }).click(); await page.getByText('AI 分析已完成', { exact: true }).waitFor({ timeout: 180000 }); checks.push('offline reload and fresh AI inference with cached model and WASM'); await context.setOffline(false);
  const fallbackContext = await browser.newContext({ serviceWorkers: 'block' }); const fallbackPage = await fallbackContext.newPage(); await fallbackPage.route('**/models/phti-fcnn.onnx', route => route.fulfill({ status: 503, body: 'model unavailable for test' })); await fallbackPage.goto(process.env.APP_URL || 'http://127.0.0.1:4174/'); await fallbackPage.getByRole('button', { name: /先用示範考卷試試/ }).click(); await fallbackPage.getByRole('button', { name: /完成校正，開始 AI 分析/ }).click(); await fallbackPage.getByText('AI 暫時無法使用', { exact: true }).waitFor({ timeout: 60000 }); await fallbackPage.getByRole('button', { name: '直接手動精修', exact: true }).click(); assert.ok(await fallbackPage.getByRole('button', { name: '補擦', exact: true }).isEnabled()); checks.push('AI download failure clearly reported with working manual fallback'); await fallbackContext.close();
  assert.equal(errors.length, 0, JSON.stringify(errors)); assert.equal(sent.length, 0, JSON.stringify(sent)); assert.equal(failed.length, 0, JSON.stringify(failed)); checks.push('no page errors, HTTP failures, or photo upload requests');
  console.log(JSON.stringify({ success: true, checks, errors, sent, failed, originalHash }, null, 2)); await writeFile(`${dir}/browser-qa.json`, JSON.stringify({ success: true, checks, errors, sent, failed, originalHash }, null, 2));
} catch (error) { console.error('QA FAILURE', error); console.log('STATE', (await page.locator('body').innerText()).slice(-6000)); await page.screenshot({ path: `${dir}/failure.png`, fullPage: true }); await writeFile(`${dir}/browser-qa.json`, JSON.stringify({ success: false, checks, errors, sent, failed, error: String(error) }, null, 2)); process.exitCode = 1; }
finally { await browser.close(); }
