import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {}), headless: true });
const page = await browser.newPage(), errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(process.env.APP_URL || 'http://127.0.0.1:4174/');
  const before = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 300; canvas.height = 420;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 300, 420);
    ctx.fillStyle = '#222'; ctx.font = '20px Arial'; ctx.fillText('12 + 18 =', 20, 60);
    ctx.fillRect(170, 100, 7, 50);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const original = new File([blob], 'legacy-fixture.png', { type: 'image/png' });
    const edit = { threshold: .8, color: 'none', protectPrint: true, allowNeutralInk: false, autoAnswers: true, repair: 'texture', grow: true, region: null, strokes: [{ tool: 'protect', radius: .03, points: [{ x: .4, y: .5 }] }] };
    const history = { past: [{ ...edit, threshold: .7 }], present: edit, future: [{ ...edit, threshold: .9 }] };
    const n = 300 * 420, hints = { version: 1, answerRegions: 0 };
    for (const key of ['confidence', 'colorInk', 'answerInk', 'structure', 'lineRepair']) hints[key] = new Uint8Array(n);
    const draft = { version: 1, original, work: blob, history, ai: { handwriting: new Float32Array(n).fill(.95), print: new Float32Array(n), hints, elapsed: 20, tiles: 1 }, savedAt: Date.now() };
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('practice-again', 1); r.onupgradeneeded = () => r.result.createObjectStore('drafts'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    await new Promise((resolve, reject) => { const tx = db.transaction('drafts', 'readwrite'); tx.objectStore('drafts').put(draft, 'current'); tx.oncomplete = resolve; tx.onabort = tx.onerror = () => reject(tx.error); }); db.close();
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await original.arrayBuffer()))).map(v => v.toString(16).padStart(2, '0')).join('');
    return { history, digest };
  });
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
  assert.equal(after.version, 2);
  assert.deepEqual(after.lengths, { handInk: 126000, boldInk: 126000, printInk: 126000, picture: 126000 });
  const expected = { past: before.history.past.map(e => ({ ...e, inkType: 'auto' })), present: { ...before.history.present, inkType: 'auto' }, future: before.history.future.map(e => ({ ...e, inkType: 'auto' })) };
  assert.deepEqual(after.history, expected); assert.equal(after.digest, before.digest); assert.deepEqual(errors, []);
  const report = { success: true, version: '0.3.0', date: '2026-10-30', kind: 'synthetic_draft_migration', checks: ['v1 hints rebuilt to v2 without re-running model', 'original bytes preserved', 'past, present, future and manual protection preserved', 'new ink mode defaulted for all history entries', 'no page errors'] };
  await mkdir('test-results', { recursive: true }); await writeFile('test-results/migration-qa.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
