import type { Point } from './core';
let worker: Worker | undefined, seq = 0;
const pending = new Map<number, { resolve: (image: ImageData) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
function stop(message: string) { worker?.terminate(); worker = undefined; for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error(message)); } pending.clear(); }
export function processImage(kind: 'clean' | 'rectify', image: ImageData, extra: { mask?: Uint8Array; quad?: Point[]; repair?: 'paper'|'texture'; structure?: Uint8Array; lineRepair?: Uint8Array }): Promise<ImageData> {
  if (!worker) {
    worker = new Worker('/cv.worker.v2.js');
    worker.onmessage = ({ data }) => { const p = pending.get(data.id); if (!p) return; pending.delete(data.id); clearTimeout(p.timer); if (data.error) p.reject(new Error(data.error)); else p.resolve(new ImageData(data.pixels, data.width, data.height)); };
    worker.onerror = () => stop('影像處理中斷，原圖仍保留。請重試或重新開啟頁面。');
  }
  const id = ++seq;
  return new Promise((resolve, reject) => { const timer = setTimeout(() => stop('影像處理逾時，請改用較小圖片後重試。'), 90000); pending.set(id, { resolve, reject, timer }); worker!.postMessage({ id, kind, image, ...extra }); });
}
