import { mkdir, copyFile, readdir, stat, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const dev = process.argv.includes('--dev');
const root = path.resolve(dev ? 'public' : 'dist');
await mkdir(path.join(root, 'vendor'), { recursive: true });
await copyFile('node_modules/@techstark/opencv-js/dist/opencv.js', path.join(root, 'vendor/opencv.js'));
if (!dev) {
  let licenses = '再練一張 — third-party software licenses\n\n';
  for (const pkg of ['react', 'react-dom', 'scheduler', 'onnxruntime-web', 'onnxruntime-common', '@techstark/opencv-js', '@phosphor-icons/react', 'pdf-lib', '@pdf-lib/standard-fonts', '@pdf-lib/upng', 'pako', 'tslib', 'flatbuffers', 'protobufjs', 'long']) {
    const pkgDir = path.join('node_modules', pkg);
    try { for (const name of await readdir(pkgDir)) if (/^(license|licence|notice|third[-_ ]?party)/i.test(name) && (await stat(path.join(pkgDir, name))).isFile()) licenses += `\n===== ${pkg} / ${name} =====\n` + await readFile(path.join(pkgDir, name), 'utf8'); } catch { /* Optional transitive packages vary by locked release. */ }
  }
  licenses += '\n===== PHTI FCNN / MIT =====\n' + await readFile('public/models/PHTI-LICENSE.txt', 'utf8');
  await writeFile(path.join(root, 'THIRD_PARTY_LICENSES.txt'), licenses);
  async function check(dir) { for (const entry of await readdir(dir, { withFileTypes: true })) { const p = path.join(dir, entry.name); if (entry.isDirectory()) await check(p); else if ((await stat(p)).size > 25 * 1024 * 1024) throw new Error(`Cloudflare Pages 單檔超過 25 MiB: ${p}`); } }
  await check(root);
  const files = [];
  async function list(dir) { for (const entry of await readdir(dir, { withFileTypes: true })) { const p = path.join(dir, entry.name); if (entry.isDirectory()) await list(p); else if (entry.name !== 'sw.js' && entry.name !== '_headers') files.push('/' + path.relative(root, p).split(path.sep).join('/')); } }
  await list(root); files.sort();
  const digest = createHash('sha256'); for (const file of files) digest.update(await readFile(path.join(root, file.slice(1))));
  const version = 'practice-again-' + digest.digest('hex').slice(0, 12);
  await writeFile(path.join(root, 'sw.js'), `const CACHE=${JSON.stringify(version)}, FILES=${JSON.stringify(files)};
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES))));
self.addEventListener('activate',event=>event.waitUntil(Promise.all([caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('practice-again-')&&k!==CACHE).map(k=>caches.delete(k)))),self.clients.claim()])));
self.addEventListener('fetch',event=>{const r=event.request,u=new URL(r.url);if(r.method!=='GET'||u.origin!==self.location.origin)return;
if(r.mode==='navigate'){event.respondWith(fetch(r).catch(()=>caches.open(CACHE).then(c=>c.match('/index.html'))));return;}
if(FILES.includes(u.pathname))event.respondWith(caches.open(CACHE).then(async c=>{const saved=await c.match(u.pathname);return saved||fetch(r);}));});
`);
  console.log(`Offline bundle: ${version}, ${files.length} self-hosted files`);
}
console.log(`Self-hosted OpenCV and ONNX runtimes ready: ${root}`);
