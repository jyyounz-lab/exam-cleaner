import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const base = process.env.BASE_PATH || '/';
const html = await readFile('dist/index.html', 'utf8');
for (const [, url] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  assert.ok(url.startsWith(base), `Asset outside site: ${url}`);
  assert.ok((await stat(`dist/${url.slice(base.length)}`)).isFile());
}
const manifest = JSON.parse(await readFile('dist/manifest.webmanifest', 'utf8'));
assert.equal(manifest.start_url, './');
assert.equal(manifest.scope, './');
assert.equal(manifest.icons[0].src, './favicon.svg');
const metadata = JSON.parse(await readFile('dist/models/metadata.json', 'utf8'));
assert.equal(createHash('sha256').update(await readFile(`dist/models/${metadata.file}`)).digest('hex'), metadata.sha256);

const events = {}, stored = [], removed = [];
let cacheName, pending, offlineUrl;
const sandbox = {
  URL,
  self: { location: { origin: 'https://example.test' }, clients: { claim() {} }, addEventListener(name, handler) { events[name] = handler; } },
  caches: {
    async open(name) { cacheName = name; return { async addAll(files) { stored.push(...files); }, async match(url) { offlineUrl = url; return { offline: true }; } }; },
    async keys() { return [cacheName, cacheName.replace(/[^-]+$/, 'previous'), 'other-app-cache', 'practice-again-other-scope-old']; },
    async delete(name) { removed.push(name); },
  },
  async fetch() { throw new Error('Offline'); },
};
vm.runInNewContext(await readFile('dist/sw.js', 'utf8'), sandbox);
events.install({ waitUntil(p) { pending = p; } }); await pending;
assert.ok(stored.length > 10);
for (const file of stored) {
  assert.ok(file.startsWith(base), `Cache outside site: ${file}`);
  assert.ok((await stat(`dist/${file.slice(base.length)}`)).isFile());
}
assert.ok(stored.includes(`${base}models/phti-fcnn.onnx`));
assert.ok(stored.includes(`${base}vendor/opencv.js`));
assert.ok(stored.some(file => file.endsWith('.wasm')));
events.activate({ waitUntil(p) { pending = p; } }); await pending;
assert.deepEqual(removed, [cacheName.replace(/[^-]+$/, 'previous')]);
events.fetch({ request: { url: `https://example.test${base}`, method: 'GET', mode: 'navigate' }, respondWith(p) { pending = p; } });
assert.equal((await pending).offline, true);
assert.equal(offlineUrl, `${base}index.html`);
console.log(`Build verified: ${base}, ${stored.length} cached files, unchanged AI model, scoped cache cleanup and offline fallback.`);
