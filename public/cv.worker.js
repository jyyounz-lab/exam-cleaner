let runtime;
async function load() {
  if (!runtime) runtime = (async () => {
    importScripts('/vendor/opencv.js');
    const cv = await self.cv;
    if (cv.Mat) return cv;
    await new Promise((resolve, reject) => { cv.onRuntimeInitialized = resolve; setTimeout(() => reject(new Error('影像引擎初始化逾時')), 30000); });
    return cv;
  })();
  return runtime;
}
self.onmessage = async ({ data: request }) => {
  const mats = [];
  try {
    const cv = await load(), image = request.image;
    const own = m => { mats.push(m); return m; };
    const src = own(cv.matFromImageData(image));
    let dst;
    if (request.kind === 'rectify') {
      const q = request.quad.map(p => ({ x: p.x * (image.width - 1), y: p.y * (image.height - 1) }));
      const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
      let w = 1 + Math.max(dist(q[0], q[1]), dist(q[2], q[3])), h = 1 + Math.max(dist(q[0], q[3]), dist(q[1], q[2]));
      const scale = Math.min(1, 2000 / Math.max(w, h)); w = Math.max(32, Math.round(w * scale)); h = Math.max(32, Math.round(h * scale));
      const from = own(cv.matFromArray(4, 1, cv.CV_32FC2, q.flatMap(p => [p.x, p.y])));
      const to = own(cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, w - 1, 0, w - 1, h - 1, 0, h - 1]));
      const transform = own(cv.getPerspectiveTransform(from, to)); dst = own(new cv.Mat());
      cv.warpPerspective(src, dst, transform, new cv.Size(w, h), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(255, 255, 255, 255));
    } else if (request.kind === 'clean') {
      if (typeof cv.inpaint !== 'function') throw new Error('此影像引擎缺少修補功能，請重新載入。');
      const rgb = own(new cv.Mat()), mask = own(cv.matFromArray(image.height, image.width, cv.CV_8UC1, request.mask));
      cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB); const cleaned = own(new cv.Mat());
      cv.inpaint(rgb, mask, cleaned, 3, cv.INPAINT_TELEA); dst = own(new cv.Mat()); cv.cvtColor(cleaned, dst, cv.COLOR_RGB2RGBA);
      // Restore protected pixels exactly; output may only change inside the confirmed mask.
      for (let i = 0; i < request.mask.length; i++) if (!request.mask[i]) for (let c = 0; c < 4; c++) dst.data[i * 4 + c] = image.data[i * 4 + c];
    } else throw new Error('未知的影像操作。');
    const pixels = new Uint8ClampedArray(dst.data);
    self.postMessage({ id: request.id, width: dst.cols, height: dst.rows, pixels }, [pixels.buffer]);
  } catch (error) { self.postMessage({ id: request.id, error: error.message || String(error) }); }
  finally { for (const mat of mats.reverse()) mat.delete(); }
};
