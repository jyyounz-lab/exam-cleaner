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
      cv.inpaint(rgb, mask, cleaned, 5, cv.INPAINT_TELEA);
      if (request.repair !== 'texture') {
        // A robust paper estimate excludes thin ink instead of sampling its unmasked fringe.
        const closed = own(new cv.Mat()), background = own(new cv.Mat()), smooth = own(new cv.Mat());
        const kernel = own(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(31, 31)));
        cv.morphologyEx(rgb, closed, cv.MORPH_CLOSE, kernel);
        cv.medianBlur(closed, background, 15);
        cv.GaussianBlur(background, smooth, new cv.Size(0, 0), 3, 3, cv.BORDER_REPLICATE);
        for (let i = 0; i < request.mask.length; i++) if (request.mask[i]) {
          const p = i * 3, r = smooth.data[p], g = smooth.data[p + 1], b = smooth.data[p + 2];
          const high = Math.max(r, g, b), low = Math.min(r, g, b);
          if (low > 170 && high - low < 65) {
            cleaned.data[p] = r; cleaned.data[p + 1] = g; cleaned.data[p + 2] = b;
          }
        }
      }
      dst = own(new cv.Mat()); cv.cvtColor(cleaned, dst, cv.COLOR_RGB2RGBA);
      if (request.structure && request.lineRepair) for (let i=0;i<request.mask.length;i++) if(request.mask[i]&&request.structure[i]&&request.lineRepair[i]) {
        const x=i%image.width,y=Math.floor(i/image.width), samples=[[],[],[]], direction=request.structure[i];
        for(let d=1;d<=28;d++) for(const sign of [-1,1]) for(const axis of [1,2]) {
          if(!(direction&axis))continue;const xx=x+(axis===1?d*sign:0),yy=y+(axis===2?d*sign:0);
          if(xx<0||xx>=image.width||yy<0||yy>=image.height)continue;const j=yy*image.width+xx,p=j*4;
          if(request.mask[j]||!(request.structure[j]&axis))continue;
          const r=image.data[p],g=image.data[p+1],b=image.data[p+2];if(Math.max(r,g,b)>245||Math.max(r,g,b)-Math.min(r,g,b)>26)continue;
          samples[0].push(r);samples[1].push(g);samples[2].push(b);
        }
        if(samples[0].length>=3)for(let c=0;c<3;c++){samples[c].sort((a,b)=>a-b);dst.data[i*4+c]=samples[c][Math.floor(samples[c].length/2)];}
        else for(let c=0;c<4;c++)dst.data[i*4+c]=image.data[i*4+c];
      }
      // Restore protected pixels exactly; output may only change inside the confirmed mask.
      for (let i = 0; i < request.mask.length; i++) if (!request.mask[i]) for (let c = 0; c < 4; c++) dst.data[i * 4 + c] = image.data[i * 4 + c];
    } else throw new Error('未知的影像操作。');
    const pixels = new Uint8ClampedArray(dst.data);
    self.postMessage({ id: request.id, width: dst.cols, height: dst.rows, pixels }, [pixels.buffer]);
  } catch (error) { self.postMessage({ id: request.id, error: error.message || String(error) }); }
  finally { for (const mat of mats.reverse()) mat.delete(); }
};
