import { chromium } from 'playwright';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {}), headless: true });
const page = await browser.newPage(), errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  for(const hintVersion of [1,2,3]) {
    await page.goto(process.env.APP_URL || 'http://127.0.0.1:4174/');
    const before = await page.evaluate(async hintVersion => {
      const canvas = document.createElement('canvas'); canvas.width = 300; canvas.height = 420;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 300, 420);
      ctx.fillStyle = '#222'; ctx.font = '20px Arial'; ctx.fillText('12 + 18 =', 20, 60);
      ctx.fillRect(170, 100, 7, 50);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      const original = new File([blob], 'legacy-fixture.png', { type: 'image/png' });
      const edit = { threshold: .8, color: 'none', protectPrint: true, allowNeutralInk: false, autoAnswers: true, repair: 'texture', grow: true, region: null, strokes: [{ tool: 'protect', radius: .03, points: [{ x: .4, y: .5 }] }] };
      if(hintVersion>=2){edit.inkType='black';edit.strokes.push({tool:'text',source:{x:.1,y:.1,w:2/300,h:2/420},target:{x:.5,y:.5},sample:{width:2,height:2,data:new Uint8ClampedArray(16).fill(180)}});}
      const history = { past: [{ ...edit, threshold: .7 }], present: edit, future: [{ ...edit, threshold: .9 }] };
      const n = 300 * 420, hints = { version: hintVersion, answerRegions: 0 };
      for (const key of ['confidence', 'colorInk', 'answerInk', 'structure', 'lineRepair']) hints[key] = new Uint8Array(n);
      if(hintVersion>=2)for(const key of ['handInk','boldInk','printInk','picture'])hints[key]=new Uint8Array(n);
      const draft = { version: 1, original, work: blob, history, ai: { handwriting: new Float32Array(n).fill(.95), print: new Float32Array(n), hints, elapsed: 20, tiles: 1 }, savedAt: Date.now() };
      const db = await new Promise((resolve, reject) => { const r = indexedDB.open('practice-again', 1); r.onupgradeneeded = () => r.result.createObjectStore('drafts'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      await new Promise((resolve, reject) => { const tx = db.transaction('drafts', 'readwrite'); tx.objectStore('drafts').put(draft, 'current'); tx.oncomplete = resolve; tx.onabort = tx.onerror = () => reject(tx.error); }); db.close();
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await original.arrayBuffer()))).map(v => v.toString(16).padStart(2, '0')).join('');
      return { history, digest };
    },hintVersion);
    await page.reload(); await page.getByRole('button', { name: /繼續編輯/ }).click();
    await page.getByText('已恢復此裝置的編輯進度。', { exact: true }).waitFor();
    await page.getByRole('button', { name: '儲存進度', exact: true }).click();
    await page.getByText(/編輯進度已儲存在此瀏覽器/).waitFor();
    const after = await page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => { const r = indexedDB.open('practice-again', 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      const draft = await new Promise((resolve, reject) => { const r = db.transaction('drafts').objectStore('drafts').get('current'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); db.close();
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await draft.original.arrayBuffer()))).map(v => v.toString(16).padStart(2, '0')).join('');
      return { history: draft.history, digest, version: draft.ai.hints.version, lengths: Object.fromEntries(['handInk', 'boldInk', 'printInk', 'picture'].map(key => [key, draft.ai.hints[key]?.length])) };
    });
    assert.equal(after.version, 3);
    assert.deepEqual(after.lengths, { handInk: 126000, boldInk: 126000, printInk: 126000, picture: 126000 });
    const expected = { past: before.history.past.map(e => ({ inkType: 'auto', ...e })), present: { inkType: 'auto', ...before.history.present }, future: before.history.future.map(e => ({ inkType: 'auto', ...e })) };
    assert.deepEqual(after.history, expected); assert.equal(after.digest, before.digest); assert.deepEqual(errors, []);
    console.log(`PASS: hints v${hintVersion} → v3, original and full history preserved`);
    if(hintVersion===3){
      await page.locator('#ink-type').selectOption('workbook');
      await page.getByText('AI 清除與修復完成',{exact:true}).waitFor({timeout:180000});
      await page.getByRole('button',{name:'儲存進度',exact:true}).click();await page.getByText(/編輯進度已儲存在此瀏覽器/).waitFor();
      const upgraded=await page.evaluate(async()=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('practice-again',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});const d=await new Promise((resolve,reject)=>{const r=db.transaction('drafts').objectStore('drafts').get('current');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});db.close();const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await d.original.arrayBuffer()))).map(v=>v.toString(16).padStart(2,'0')).join('');return{digest,mode:d.history.present.inkType,strokes:d.history.present.strokes,version:d.ai.workbook?.version,modelRevision:d.ai.workbook?.modelRevision,length:d.ai.workbook?.confidence.length};});
      assert.equal(upgraded.digest,before.digest);assert.equal(upgraded.mode,'workbook');assert.equal(upgraded.version,1);assert.equal(upgraded.modelRevision,2);assert.equal(upgraded.length,126000);assert.deepEqual(upgraded.strokes,before.history.present.strokes);
      console.log('PASS: v0.5 draft switches to trained workbook model by reanalysis, original and manual edits preserved');
      await page.evaluate(async()=>{
        const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('practice-again',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
        const d=await new Promise((resolve,reject)=>{const r=db.transaction('drafts').objectStore('drafts').get('current');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
        delete d.ai.workbook.modelRevision;d.ai.workbook.confidence.fill(255);
        await new Promise((resolve,reject)=>{const tx=db.transaction('drafts','readwrite');tx.objectStore('drafts').put(d,'current');tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});db.close();
      });
      await page.reload();await page.getByRole('button',{name:/繼續編輯/}).click();
      await page.getByText('AI 清除與修復完成',{exact:true}).waitFor({timeout:180000});
      await page.getByRole('button',{name:'儲存進度',exact:true}).click();await page.getByText(/編輯進度已儲存在此瀏覽器/).waitFor();
      const refreshed=await page.evaluate(async()=>{
        const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('practice-again',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
        const d=await new Promise((resolve,reject)=>{const r=db.transaction('drafts').objectStore('drafts').get('current');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});db.close();
        const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await d.original.arrayBuffer()))).map(v=>v.toString(16).padStart(2,'0')).join('');
        return {revision:d.ai.workbook.modelRevision,digest,strokes:d.history.present.strokes,threshold:d.history.present.threshold,allSelected:d.ai.workbook.confidence.every(v=>v===255)};
      });
      assert.equal(refreshed.revision,2);assert.equal(refreshed.digest,before.digest);assert.deepEqual(refreshed.strokes,before.history.present.strokes);assert.equal(refreshed.threshold,.9);assert.equal(refreshed.allSelected,false);
      console.log('PASS: v0.6.0 workbook draft recomputes new model hints without losing original, settings or manual edits');
    }
  }
  const report = { success: true, version: JSON.parse(await readFile('package.json','utf8')).version, date: '2026-11-03', kind: 'synthetic_draft_migration', checks: ['v1 and v2 hints rebuilt to v3; existing v3 retained', 'original bytes preserved', 'past, present, future, manual protection and sampled text snapshots preserved', 'new ink mode defaulted for all history entries', 'v0.5 draft can reanalyse with workbook model while keeping original and manual edits', 'v0.6.0 workbook hints automatically refresh with model revision 2; original, settings and manual edits preserved', 'no page errors'] };
  await mkdir('test-results', { recursive: true }); await writeFile('test-results/migration-qa.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
