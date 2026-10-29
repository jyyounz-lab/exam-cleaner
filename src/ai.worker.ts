import * as ort from 'onnxruntime-web/wasm';
import wasmModuleUrl from '../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs?url';
import wasmBinaryUrl from '../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url';
import { sauvola } from './core';
ort.env.wasm.wasmPaths = { mjs: wasmModuleUrl, wasm: wasmBinaryUrl };
ort.env.wasm.numThreads = 1;
let session: ort.InferenceSession | undefined;
function positions(length: number) { const out = [0]; while (out.at(-1)! + 256 < length) out.push(Math.min(out.at(-1)! + 246, length - 256)); return out; }
self.onmessage = async ({ data: image }: MessageEvent<ImageData>) => {
  try {
    const progress = (percent: number, message: string) => self.postMessage({ type: 'progress', percent, message });
    if (!session) {
      progress(2, '正在載入本機模型與推論引擎…');
      const response = await fetch('/models/phti-fcnn.onnx');
      if (!response.ok) throw new Error('模型尚未下載完成，請連線後重試。');
      const model = await response.arrayBuffer();
      session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    }
    progress(8, '正在分析紙張與墨色…');
    const binary = sauvola(image), { width: w, height: h } = image, n = w * h;
    const handwriting = new Float32Array(n), print = new Float32Array(n), weights = new Float32Array(n);
    const xs = positions(w), ys = positions(h), total = xs.length * ys.length;
    let done = 0; const start = performance.now();
    for (const y of ys) for (const x of xs) {
      const input = new Float32Array(3 * 256 * 256); let sum = 0;
      for (let yy = 0; yy < 256; yy++) for (let xx = 0; xx < 256; xx++) { const i = yy * 256 + xx; const value = x + xx < w && y + yy < h ? binary[(y + yy) * w + x + xx] : 0; input[i] = value; sum += value; }
      const mean = sum / 65536, sd = Math.sqrt(mean * (1 - mean)) || 1;
      for (let i = 0; i < 65536; i++) { const v = (input[i] - mean) / sd; input[i] = v; input[i + 65536] = v; input[i + 131072] = v; }
      const tensor = new ort.Tensor('float32', input, [1, 3, 256, 256]);
      const results = await session.run({ image: tensor }); const output = results.probabilities;
      if (!output || output.dims.join(',') !== '1,3,256,256') throw new Error('模型輸出格式不符，請重新下載模型。');
      const values = output.data as Float32Array;
      for (let yy = 0; yy < Math.min(256, h - y); yy++) for (let xx = 0; xx < Math.min(256, w - x); xx++) {
        const src = yy * 256 + xx, dst = (y + yy) * w + x + xx;
        const weight = Math.min(1, (Math.min(xx, yy, 255 - xx, 255 - yy) + 1) / 6);
        print[dst] += values[src] * weight; handwriting[dst] += values[src + 65536] * weight; weights[dst] += weight;
      }
      tensor.dispose(); for (const t of Object.values(results)) t.dispose();
      done++; progress(8 + Math.round(done / total * 91), `AI 分析中：${done}／${total} 個區塊`);
    }
    for (let i = 0; i < n; i++) { handwriting[i] /= weights[i] || 1; print[i] /= weights[i] || 1; }
    self.postMessage({ type: 'result', handwriting, print, elapsed: performance.now() - start, tiles: total }, [handwriting.buffer, print.buffer]);
  } catch (error) { self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) }); }
};
