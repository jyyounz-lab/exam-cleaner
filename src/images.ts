import type { Point } from './core';

export const MAX_LONG_EDGE = 2000;
export async function readImage(file: File): Promise<ImageData> {
  if (file.size > 35 * 1024 * 1024) throw new Error('請選擇 35 MB 以內的 JPG 或 PNG 圖片。');
  const head = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer());
  const png = head[0] === 137 && head[1] === 80 && head[2] === 78 && head[3] === 71;
  const jpeg = head[0] === 255 && head[1] === 216;
  if (!png && !jpeg) throw new Error('目前支援 JPG、PNG。HEIC 請先在裝置上另存為 JPG。');
  let w = 0, h = 0;
  if (png && head.length >= 24) { const view = new DataView(head.buffer); w = view.getUint32(16); h = view.getUint32(20); }
  if (jpeg) { let p = 2; while (p + 9 < head.length) { if (head[p] !== 255) break; const marker = head[p + 1]; if (marker === 217 || marker === 218) break; const len = head[p + 2] * 256 + head[p + 3]; if (len < 2) break; if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) { h = head[p + 5] * 256 + head[p + 6]; w = head[p + 7] * 256 + head[p + 8]; break; } p += len + 2; } }
  if (!w || !h) throw new Error('無法讀取圖片尺寸，請重新另存為 JPG 或 PNG。');
  if (w * h > 64_000_000 || Math.min(w, h) < 120) throw new Error('請選擇 120 像素以上、6400 萬像素以內的圖片。');
  let bitmap: ImageBitmap | undefined;
  try {
    // EXIF can swap width/height; keep small photos at their native oriented resolution.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image', ...(w > MAX_LONG_EDGE ? { resizeWidth: MAX_LONG_EDGE } : {}), resizeQuality: 'high' });
    const scale = Math.min(1, MAX_LONG_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  } catch { throw new Error('此裝置無法開啟這張圖片，請改用較小的 JPG／PNG。'); }
  finally { bitmap?.close(); }
}
export function canvasFor(image: ImageData) { const c = document.createElement('canvas'); c.width = image.width; c.height = image.height; c.getContext('2d')!.putImageData(image, 0, 0); return c; }
export function blobFor(image: ImageData, type = 'image/png', quality = 0.94): Promise<Blob> { return new Promise((resolve, reject) => canvasFor(image).toBlob(b => b ? resolve(b) : reject(new Error('圖片匯出失敗，請降低解析度或重試。')), type, quality)); }
export function download(blob: Blob, name: string) { const u = URL.createObjectURL(blob), a = document.createElement('a'); a.href = u; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 30_000); }
export function rotate(image: ImageData, degrees: number) {
  const rad = degrees * Math.PI / 180, sin = Math.abs(Math.sin(rad)), cos = Math.abs(Math.cos(rad));
  const c = document.createElement('canvas'); c.width = Math.round(image.width * cos + image.height * sin); c.height = Math.round(image.height * cos + image.width * sin);
  const ctx = c.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.translate(c.width / 2, c.height / 2); ctx.rotate(rad); ctx.drawImage(canvasFor(image), -image.width / 2, -image.height / 2);
  return ctx.getImageData(0, 0, c.width, c.height);
}
export const fullQuad = (): Point[] => [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
export async function demoFile(): Promise<File> {
  const c = document.createElement('canvas'); c.width = 1200; c.height = 1660;
  const x = c.getContext('2d')!; x.fillStyle = '#fffefa'; x.fillRect(0, 0, c.width, c.height); x.fillStyle = '#222';
  x.font = 'bold 44px "Microsoft JhengHei", sans-serif'; x.fillText('數學小練習', 100, 130);
  x.font = '22px "Microsoft JhengHei", sans-serif'; x.fillText('三年級　　姓名：____________　　日期：____________', 100, 195);
  x.strokeStyle = '#444'; x.lineWidth = 2; x.beginPath(); x.moveTo(100, 235); x.lineTo(1100, 235); x.stroke();
  x.font = 'bold 28px "Microsoft JhengHei", sans-serif'; x.fillText('一、算算看，將答案填入空格。', 100, 310);
  x.font = '32px Arial'; ['1.   24 + 18 = ________', '2.   56 − 29 = ________', '3.   7 × 8 = ________', '4.   81 ÷ 9 = ________'].forEach((s, i) => x.fillText(s, 130, 405 + i * 155));
  x.fillStyle = '#23549c'; x.font = 'italic 56px "Comic Sans MS", cursive'; ['42', '27', '56', '9'].forEach((s, i) => { x.save(); x.translate(480, 398 + i * 155); x.rotate(-0.06); x.fillText(s, 0, 0); x.restore(); });
  x.strokeStyle = '#bf3b3d'; x.lineWidth = 5;
  for (let i = 0; i < 3; i++) { x.beginPath(); x.moveTo(850, 370 + i * 155); x.lineTo(872, 393 + i * 155); x.lineTo(920, 340 + i * 155); x.stroke(); }
  x.fillStyle = '#222'; x.font = 'bold 28px "Microsoft JhengHei", sans-serif'; x.fillText('二、應用題', 100, 1080);
  x.font = '26px "Microsoft JhengHei", sans-serif'; x.fillText('小安有 12 顆糖果，平均分給 3 位朋友，', 130, 1155); x.fillText('每位朋友可以拿到幾顆？', 130, 1200);
  x.font = '30px Arial'; x.fillText('12 ÷ 3 = ________', 130, 1310); x.fillStyle = '#23549c'; x.font = 'italic 56px "Comic Sans MS", cursive'; x.fillText('4', 375, 1302);
  x.fillStyle = '#777'; x.font = '18px "Microsoft JhengHei", sans-serif'; x.fillText('合成示範考卷・內容由本工具製作・供流程試用', 100, 1550);
  const blob = await new Promise<Blob>(r => c.toBlob(b => r(b!), 'image/png')); return new File([blob], '數學小練習_示範.png', { type: 'image/png' });
}
