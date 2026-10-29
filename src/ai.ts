import type { InkHints } from './refine';
export type AiResult = { handwriting: Float32Array; print: Float32Array; hints?: InkHints; elapsed: number; tiles: number };
let active: Worker | undefined;
export function analyse(image: ImageData, progress: (percent: number, message: string) => void): { promise: Promise<AiResult>; cancel: () => void } {
  active?.terminate(); const worker = new Worker(new URL('./ai.worker.ts', import.meta.url), { type: 'module' }); active = worker;
  let rejectTask: (error: Error) => void;
  const cleanup = () => { clearTimeout(timer); worker.terminate(); if (active === worker) active = undefined; };
  const timer = setTimeout(() => { cleanup(); rejectTask(new Error('AI 分析逾時，請改用較小的圖片，或切換半自動／手動工具。')); }, 180000);
  const promise = new Promise<AiResult>((resolve, reject) => {
    rejectTask = reject;
    worker.onmessage = ({ data }) => { if (data.type === 'progress') progress(data.percent, data.message); if (data.type === 'result') { cleanup(); resolve(data); } if (data.type === 'error') { cleanup(); reject(new Error(data.message)); } };
    worker.onerror = () => { cleanup(); reject(new Error('AI 引擎無法啟動。請使用新版瀏覽器重試，或選擇半自動／手動工具。')); };
    worker.postMessage(image);
  });
  return { promise, cancel: () => { cleanup(); rejectTask(new Error('已停止分析，原圖與人工修正仍保留。')); } };
}
