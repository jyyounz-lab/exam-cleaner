import { chromium } from 'playwright';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const appUrl = process.env.APP_URL || 'http://127.0.0.1:4174/';
const appLocation = new URL(appUrl), assetPaths = new Set();
const dir = 'test-results'; await mkdir(dir, { recursive: true });
const browser = await chromium.launch({ ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {}), headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, acceptDownloads: true });
const page = await context.newPage(), errors = [], sent = [], failed = [], checks = [];
page.on('request', request => { const url = new URL(request.url()); if (url.origin === appLocation.origin) assetPaths.add(url.pathname); });
page.on('pageerror', e => errors.push(e.message)); page.on('request', r => { if (!['GET', 'HEAD'].includes(r.method())) sent.push({ method: r.method(), url: r.url() }); }); page.on('response', r => { if (r.status() >= 400) failed.push({ status: r.status(), url: r.url() }); });
page.on('console', msg => { if (msg.type() === 'error') console.log('BROWSER:', msg.text().slice(0, 300)); });
try {
  await page.goto(appUrl, { waitUntil: 'networkidle' });
  for(const [width,height,outWidth,outHeight] of [[180,260,260,180],[2100,2800,2000,1500]]) {
    const importPage=await context.newPage();importPage.on('pageerror',e=>errors.push(e.message));await importPage.goto(appUrl);
    const bytes=await importPage.evaluate(async({width,height})=>{
      const c=document.createElement('canvas');c.width=width;c.height=height;const x=c.getContext('2d');
      x.fillStyle='white';x.fillRect(0,0,width,height);x.fillStyle='red';x.fillRect(0,0,width/4,height/4);
      const jpeg=new Uint8Array(await(await new Promise(r=>c.toBlob(r,'image/jpeg'))).arrayBuffer());
      const exif=new Uint8Array([255,225,0,34,69,120,105,102,0,0,73,73,42,0,8,0,0,0,1,0,18,1,3,0,1,0,0,0,6,0,0,0,0,0,0,0]);
      return [...jpeg.slice(0,2),...exif,...jpeg.slice(2)];
    },{width,height});
    await importPage.locator('input[type=file]').first().setInputFiles({name:'rotated-fixture.jpg',mimeType:'image/jpeg',buffer:Buffer.from(bytes)});
    await importPage.locator('.canvas-footer').getByText(`${outWidth} × ${outHeight} px`,{exact:false}).waitFor();
    const decoded=await importPage.evaluate(()=>{const c=document.querySelector('.paper-stage canvas');return {width:c.width,height:c.height,pixel:[...c.getContext('2d').getImageData(Math.floor(c.width*.9),Math.floor(c.height*.1),1,1).data]};});
    assert.equal(decoded.width,outWidth);assert.equal(decoded.height,outHeight);assert.ok(decoded.pixel[0]>230&&decoded.pixel[1]<25&&decoded.pixel[2]<25,'EXIF rotation must place the red corner at top right');
    await importPage.close();
  }
  checks.push('EXIF phone photos retain small native dimensions, rotate correctly and respect the 2000px working limit');
  if (process.env.PAGES_QA === '1') { assert.equal(await page.evaluate(() => crossOriginIsolated), false); checks.push('works without cross-origin isolation headers as on GitHub Pages'); }
  await page.screenshot({ path: `${dir}/home-desktop.png`, fullPage: true });
  for (const width of [320, 390, 768, 1440]) { await page.setViewportSize({ width, height: 1000 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `home overflow ${width}`); checks.push(`home responsive ${width}`); }
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.getByRole('button', { name: /先用示範考卷試試/ }).click(); await page.getByRole('button', { name: /完成校正，AI 清除與修復/ }).waitFor(); checks.push('demo imports');
  // Fixed synthetic pixels keep image-quality assertions independent of OS fonts.
  page.once('dialog', dialog => dialog.accept());
  await page.locator('input[type=file]').first().setInputFiles('tests/fixtures/browser-demo.png');
  await page.locator('.document-title span[title="browser-demo.png"]').waitFor();
  checks.push('fixed synthetic fixture imports for cross-platform image regression');
  const [original] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '下載原圖', exact: true }).click()]); await original.saveAs(`${dir}/original.png`); const originalHash = createHash('sha256').update(await readFile(`${dir}/original.png`)).digest('hex');
  assert.equal(originalHash, '652c39695ce1ba10a074ea8bbc60658cc01b7dedbfee1176f15a9cdd867887c0');
  await page.getByRole('button', { name: /完成校正，AI 清除與修復/ }).click(); console.log('Started actual OpenCV calibration and ONNX browser WASM inference');
  await page.getByText('AI 清除與修復完成', { exact: true }).waitFor({ timeout: 180000 });
  await page.getByRole('button', { name: '確認匯出', exact: true }).waitFor({ state: 'visible' }); await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(b => b.textContent === '確認匯出')?.disabled, { timeout: 90000 });
  checks.push('actual ONNX WASM inference and OpenCV inpainting');
  await page.locator('#ink-type').selectOption('black');
  assert.equal(await page.locator('#repair').inputValue(), 'texture');
  await page.locator('#ink-type').selectOption('auto'); await page.locator('#repair').selectOption('paper');
  await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(b => b.textContent === '確認匯出')?.disabled, { timeout: 90000 });
  checks.push('coarse black mode switches locally and recommends texture repair');
  await page.getByRole('button', { name: '校正底圖', exact: true }).click();
  const neutralBefore = await page.evaluate(() => { const c = document.querySelector('.paper-stage canvas'); window.neutralCheck = c.getContext('2d').getImageData(0, 0, c.width, c.height); return true; });
  await page.getByRole('button', { name: '清除預覽', exact: true }).click();
  const neutralCheck = await page.evaluate(() => { const a = window.neutralCheck.data, c = document.querySelector('.paper-stage canvas'), b = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let kept = 0, changed = 0; for (let i = 0; i < a.length; i += 4) if (Math.max(a[i],a[i+1],a[i+2])-Math.min(a[i],a[i+1],a[i+2])<26 && Math.max(a[i],a[i+1],a[i+2])<180) { kept++; if ([0,1,2,3].some(k => a[i+k]!==b[i+k])) changed++; } return {kept,changed}; });
  assert.ok(neutralBefore && neutralCheck.kept > 0); assert.equal(neutralCheck.changed, 0); checks.push('default AI preview preserves dark printed text on the demonstration'); console.log('NEUTRAL PROTECTION', neutralCheck);
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
  async function titleStroke(name) { await page.getByRole('button',{name,exact:true}).click(); await page.locator('#brush').press('Home'); for(let n=1;n<20;n++) await page.locator('#brush').press('ArrowRight'); const b=await canvas.boundingBox(); await page.mouse.move(b.x+b.width*.09,b.y+b.height*.07);await page.mouse.down();await page.mouse.move(b.x+b.width*.32,b.y+b.height*.07,{steps:8});await page.mouse.up();await page.getByRole('button',{name:'清除預覽',exact:true}).click();await page.waitForFunction(()=>![...document.querySelectorAll('button')].find(b=>b.textContent==='確認匯出')?.disabled,null,{timeout:90000}); }
  async function titleDelta(){return page.evaluate(()=>{const base=window.qaPixels.base,c=document.querySelector('.paper-stage canvas'),now=c.getContext('2d').getImageData(0,0,c.width,c.height);let changed=0;for(let y=Math.floor(c.height*.05);y<c.height*.1;y++)for(let x=Math.floor(c.width*.08);x<c.width*.33;x++){const p=(y*c.width+x)*4;if([0,1,2].some(k=>base.data[p+k]!==now.data[p+k]))changed++;}return changed;});}
  await titleStroke('補擦');assert.ok(await titleDelta()>0,'manual erase must respond even where AI marked print');await titleStroke('還原題目');assert.equal(await titleDelta(),0,'restoring print must recover the untouched base pixels exactly');checks.push('manual correction responds and Restore question recovers accidentally erased printed text exactly');
  await page.getByRole('button', { name: '1. 框選完整的相同字', exact: true }).click();
  const sampleBox=await canvas.boundingBox();
  await page.mouse.move(sampleBox.x+sampleBox.width*.09,sampleBox.y+sampleBox.height*.05);await page.mouse.down();await page.mouse.move(sampleBox.x+sampleBox.width*.32,sampleBox.y+sampleBox.height*.10,{steps:8});await page.mouse.up();
  await page.getByLabel('取樣內容（請確認文字及圈線）').waitFor();
  assert.equal(await page.getByRole('button',{name:'清除預覽',exact:true}).getAttribute('aria-pressed'),'true');
  const patchBox=await canvas.boundingBox();await page.mouse.click(patchBox.x+patchBox.width*.67,patchBox.y+patchBox.height*.12);
  await page.waitForFunction(()=>![...document.querySelectorAll('button')].find(b=>b.textContent==='確認匯出')?.disabled,null,{timeout:90000});
  const patchPixels=await page.evaluate(()=>{const c=document.querySelector('.paper-stage canvas');return c.toDataURL();});
  await page.getByRole('button',{name:'復原',exact:true}).click();await page.waitForFunction(()=>![...document.querySelectorAll('button')].find(b=>b.textContent==='確認匯出')?.disabled,null,{timeout:90000});
  assert.notEqual(await page.evaluate(()=>document.querySelector('.paper-stage canvas').toDataURL()),patchPixels);
  await page.getByRole('button',{name:'重做',exact:true}).click();await page.waitForFunction(()=>![...document.querySelectorAll('button')].find(b=>b.textContent==='確認匯出')?.disabled,null,{timeout:90000});
  assert.equal(await page.evaluate(()=>document.querySelector('.paper-stage canvas').toDataURL()),patchPixels);
  await page.getByRole('button',{name:'儲存進度',exact:true}).click();await page.getByText(/編輯進度已儲存在此瀏覽器/).waitFor();
  await page.waitForFunction(()=>![...document.querySelectorAll('button')].find(b=>b.textContent==='儲存進度')?.disabled); checks.push('same-letter sampling, target placement, paper matching and pixel-exact undo/redo');
  const cdp = await context.newCDPSession(page); await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
  const touchBox = await canvas.boundingBox(), cx = touchBox.x + Math.min(touchBox.width / 2, 260), cy = touchBox.y + 170;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{x:cx-35,y:cy,id:1},{x:cx+35,y:cy,id:2}] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{x:cx-70,y:cy,id:1},{x:cx+70,y:cy,id:2}] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForFunction(() => document.querySelector('.zoom-label').textContent !== '100%'); checks.push('two-finger touch zoom'); await page.getByRole('button', { name: '縮放重設為100%' }).click(); await cdp.detach();
  // Confirmation resets before opening; a delayed render must not clear a user's new check.
  for(let attempt=0;attempt<3;attempt++) {
    await page.getByRole('button',{name:'確認匯出',exact:true}).click();
    assert.equal(await page.getByLabel('我已檢查題目與清除範圍').isChecked(),false);
    await page.getByLabel('我已檢查題目與清除範圍').check();
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.equal(await page.getByLabel('我已檢查題目與清除範圍').isChecked(),true);
    assert.equal(await page.getByRole('button',{name:'下載 A4 PDF',exact:true}).isDisabled(),false);
    await page.getByRole('button',{name:'關閉視窗',exact:true}).click();
  }
  checks.push('reopened export resets confirmation once and preserves immediate user confirmation');
  await page.getByRole('button', { name: '確認匯出', exact: true }).click(); assert.ok(await page.getByRole('button', { name: '下載 JPG', exact: true }).isDisabled());
  await page.getByLabel('我已檢查題目與清除範圍').check(); const [jpgDownload] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '下載 JPG', exact: true }).click()]); await jpgDownload.saveAs(`${dir}/cleaned.jpg`); checks.push('explicit export confirmation and JPG');
  const jpgPixels=await readFile(`${dir}/cleaned.jpg`);
  const exportError=await page.evaluate(async ({png,jpg})=>{const decode=async blob=>{const b=await createImageBitmap(blob),c=document.createElement('canvas');c.width=b.width;c.height=b.height;c.getContext('2d').drawImage(b,0,0);b.close();return c.getContext('2d').getImageData(0,0,c.width,c.height);};const ref=await decode(await (await fetch(png)).blob()),out=await decode(new Blob([new Uint8Array(jpg)],{type:'image/jpeg'}));let error=0,n=0;for(let y=Math.floor(ref.height*.095);y<ref.height*.145;y++)for(let x=Math.floor(ref.width*.555);x<ref.width*.785;x++)for(let c=0;c<3;c++){const i=(y*ref.width+x)*4+c;error+=Math.abs(ref.data[i]-out.data[i]);n++;}return error/n;},{png:patchPixels,jpg:[...jpgPixels]});
  assert.ok(exportError<8,`sampled text must be included in JPEG, mean error ${exportError}`); checks.push('JPEG contains the sampled text repair with expected compression tolerance');
  await page.getByRole('button', { name: '確認匯出', exact: true }).click(); await page.getByLabel('我已檢查題目與清除範圍').check(); const [pdfDownload] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '下載 A4 PDF', exact: true }).click()]); await pdfDownload.saveAs(`${dir}/cleaned.pdf`); assert.ok((await readFile(`${dir}/cleaned.pdf`)).subarray(0, 4).toString() === '%PDF'); checks.push('valid PDF output');
  const [secondDownload] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '下載原圖', exact: true }).click()]); await secondDownload.saveAs(`${dir}/original-after.png`); assert.equal(createHash('sha256').update(await readFile(`${dir}/original-after.png`)).digest('hex'), originalHash); checks.push('original bytes remain identical after all editing and exports');
  page.on('dialog', d => d.accept()); await page.reload({ waitUntil: 'networkidle' }); await page.getByRole('button', { name: /繼續編輯/ }).click(); await page.locator('.mask-summary').waitFor(); await page.waitForFunction(()=>![...document.querySelectorAll('button')].find(b=>b.textContent==='確認匯出')?.disabled,null,{timeout:90000}); assert.equal(await page.evaluate(()=>document.querySelector('.paper-stage canvas').toDataURL()),patchPixels); checks.push('restore saved session including sampled text repair');
  await page.screenshot({ path: `${dir}/editor-restored.png`, fullPage: true });
  await page.getByText('工具與 AI 已可離線使用', { exact: true }).waitFor({ timeout: 60000 });
  if (process.env.PAGES_QA === '1') { const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope); assert.equal(scope, appUrl); for (const path of assetPaths) assert.ok(path.startsWith(appLocation.pathname), `Asset escaped site path: ${path}`); checks.push('model, WASM, image worker and service worker stay within Pages project path'); }
  await context.setOffline(true); await page.reload({ waitUntil: 'networkidle' }); await page.getByRole('button', { name: /先用示範考卷試試/ }).click(); await page.getByRole('button', { name: /完成校正，AI 清除與修復/ }).click(); await page.getByText('AI 清除與修復完成', { exact: true }).waitFor({ timeout: 180000 }); checks.push('offline reload and fresh AI inference with cached model and WASM'); await context.setOffline(false);
  const fallbackContext = await browser.newContext({ serviceWorkers: 'block' }); const fallbackPage = await fallbackContext.newPage(); await fallbackPage.route('**/models/phti-fcnn.onnx', route => route.fulfill({ status: 503, body: 'model unavailable for test' })); await fallbackPage.goto(appUrl); await fallbackPage.getByRole('button', { name: /先用示範考卷試試/ }).click(); await fallbackPage.getByRole('button', { name: /完成校正，AI 清除與修復/ }).click(); await fallbackPage.getByText('AI 暫時無法使用', { exact: true }).waitFor({ timeout: 60000 }); await fallbackPage.getByRole('button', { name: '直接手動精修', exact: true }).click(); assert.ok(await fallbackPage.getByRole('button', { name: '補擦', exact: true }).isEnabled()); checks.push('AI download failure clearly reported with working manual fallback'); await fallbackContext.close();
  assert.equal(errors.length, 0, JSON.stringify(errors)); assert.equal(sent.length, 0, JSON.stringify(sent)); assert.equal(failed.length, 0, JSON.stringify(failed)); checks.push('no page errors, HTTP failures, or photo upload requests');
  console.log(JSON.stringify({ success: true, checks, errors, sent, failed, originalHash }, null, 2)); await writeFile(`${dir}/browser-qa.json`, JSON.stringify({ success: true, checks, errors, sent, failed, originalHash }, null, 2));
} catch (error) { console.error('QA FAILURE', error); console.log('STATE', (await page.locator('body').innerText()).slice(-6000)); await page.screenshot({ path: `${dir}/failure.png`, fullPage: true }); await writeFile(`${dir}/browser-qa.json`, JSON.stringify({ success: false, checks, errors, sent, failed, error: String(error) }, null, 2)); process.exitCode = 1; }
finally { await browser.close(); }
