import { useEffect, useRef, useState } from 'react';
import { canvasFor } from './images';
import type { Point, Rect, BrushStroke, Tool } from './core';

type Props = { image: ImageData; mask: Uint8Array; keep: Uint8Array; view: string; tool: Tool; brush: number; zoom: number; crop: boolean; quad: Point[]; region: Rect | null; sample: Rect | null; disabled: boolean; onZoom: (z: number) => void; onQuad: (q: Point[]) => void; onStroke: (s: BrushStroke) => void; onRegion: (r: Rect) => void; onSample: (r: Rect) => void; onPatch: (p: Point) => void };
export default function Stage(p: Props) {
  const board = useRef<HTMLDivElement>(null), base = useRef<HTMLCanvasElement>(null), overlay = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ kind: 'corner' | 'stroke' | 'region' | 'pan' | 'patch'; corner?: number; points: Point[]; quad?: Point[]; startX: number; startY: number; scrollX: number; scrollY: number } | null>(null);
  const [fit, setFit] = useState(600);
  const fingers = useRef(new Map<number, { x: number; y: number }>()), pinch = useRef<{ distance: number; zoom: number; current: number } | null>(null);
  useEffect(() => { const el = board.current!; const r = new ResizeObserver(() => setFit(Math.min(720, Math.max(180, el.clientWidth - 48)))); r.observe(el); return () => r.disconnect(); }, []);
  function drawOverlay(q = p.quad) {
    const c = overlay.current; if (!c) return; const ctx = c.getContext('2d')!; ctx.clearRect(0, 0, c.width, c.height);
    if (!p.crop && p.view === 'mask') {
      const data = ctx.createImageData(c.width, c.height);
      for (let i = 0; i < p.mask.length; i++) { if (p.mask[i]) { data.data.set([223, 78, 65, 115], i * 4); } if (p.keep[i]) data.data.set([20, 137, 97, 155], i * 4); }
      ctx.putImageData(data, 0, 0);
    }
    if (p.crop) {
      ctx.fillStyle = '#0c302740'; ctx.fillRect(0, 0, c.width, c.height); ctx.globalCompositeOperation = 'destination-out'; ctx.beginPath(); q.forEach((pt, i) => i ? ctx.lineTo(pt.x * c.width, pt.y * c.height) : ctx.moveTo(pt.x * c.width, pt.y * c.height)); ctx.closePath(); ctx.fill(); ctx.globalCompositeOperation = 'source-over'; ctx.strokeStyle = '#258b66'; ctx.lineWidth = c.width / 250; ctx.stroke();
      for (const pt of q) { ctx.beginPath(); ctx.arc(Math.max(c.width * 0.008, Math.min(c.width * 0.992, pt.x * c.width)), Math.max(c.width * 0.008, Math.min(c.height - c.width * 0.008, pt.y * c.height)), c.width / 65, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.stroke(); }
    }
    if (!p.crop && p.region) { const r = p.region; ctx.strokeStyle = '#4761c2'; ctx.lineWidth = c.width / 300; ctx.setLineDash([c.width / 80, c.width / 130]); ctx.strokeRect(r.x * c.width, r.y * c.height, r.w * c.width, r.h * c.height); ctx.setLineDash([]); }
  }
  useEffect(() => { const c = base.current!; c.width = p.image.width; c.height = p.image.height; c.getContext('2d')!.drawImage(canvasFor(p.image), 0, 0); overlay.current!.width = c.width; overlay.current!.height = c.height; drawOverlay(); }, [p.image, p.mask, p.keep, p.view, p.crop, p.quad, p.region]);
  const point = (e: React.PointerEvent): Point => { const r = overlay.current!.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) }; };
  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    if (p.disabled || e.button !== 0) return;
    fingers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (fingers.current.size === 2) { const [a, b] = [...fingers.current.values()]; pinch.current = { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), zoom: p.zoom, current: p.zoom }; drag.current = null; drawOverlay(); e.currentTarget.setPointerCapture(e.pointerId); return; }
    const at = point(e), common = { points: [at], startX: e.clientX, startY: e.clientY, scrollX: board.current!.scrollLeft, scrollY: board.current!.scrollTop };
    if (p.crop) { const nearest = p.quad.map((v, i) => ({ i, d: Math.hypot(v.x - at.x, (v.y - at.y) * p.image.height / p.image.width) })).sort((a, b) => a.d - b.d)[0]; if (nearest.d > 0.09) return; drag.current = { ...common, kind: 'corner', corner: nearest.i, quad: p.quad.map(v => ({ ...v })) }; }
    else drag.current = { ...common, kind: p.tool === 'sample' ? 'region' : p.tool === 'text' && p.sample && p.view === 'result' ? 'patch' : p.tool === 'text' || p.view === 'base' || p.tool === 'pan' ? 'pan' : p.tool === 'region' ? 'region' : 'stroke' };
    e.currentTarget.setPointerCapture(e.pointerId);
    if (drag.current.kind === 'stroke') drawDraft(at, at);
  }
  function drawDraft(a: Point, b: Point) { const c = overlay.current!, ctx = c.getContext('2d')!; ctx.strokeStyle = p.tool === 'protect' ? '#168e66aa' : p.tool === 'unprotect' || p.tool === 'restore' ? '#4a79ddaa' : '#e04c44aa'; ctx.lineWidth = p.brush * c.width / 1000; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(a.x * c.width, a.y * c.height); ctx.lineTo(b.x * c.width + 0.01, b.y * c.height); ctx.stroke(); }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (fingers.current.has(e.pointerId)) fingers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && fingers.current.size >= 2) { const [a, b] = [...fingers.current.values()]; const q = pinch.current; q.current = Math.max(100, Math.min(800, Math.round(q.zoom * Math.hypot(a.x - b.x, a.y - b.y) / q.distance))); overlay.current!.parentElement!.style.width = `${fit * q.current / 100}px`; return; }
    const d = drag.current, at = point(e);
    if (!d) { if (p.tool === 'text' && p.sample && p.view === 'result') { drawOverlay(); const c = overlay.current!, ctx = c.getContext('2d')!; ctx.strokeStyle = '#4761c2'; ctx.lineWidth = c.width / 500; ctx.strokeRect((at.x-p.sample.w/2)*c.width,(at.y-p.sample.h/2)*c.height,p.sample.w*c.width,p.sample.h*c.height); } return; }
    if (d.kind === 'corner') { d.quad![d.corner!] = at; drawOverlay(d.quad); }
    if (d.kind === 'stroke') { drawDraft(d.points.at(-1)!, at); d.points.push(at); }
    if (d.kind === 'region') { drawOverlay(); const a = d.points[0], c = overlay.current!, ctx = c.getContext('2d')!; ctx.strokeStyle = '#4761c2'; ctx.lineWidth = c.width / 300; ctx.strokeRect(a.x * c.width, a.y * c.height, (at.x - a.x) * c.width, (at.y - a.y) * c.height); d.points[1] = at; }
    if (d.kind === 'pan') { board.current!.scrollLeft = d.scrollX - e.clientX + d.startX; board.current!.scrollTop = d.scrollY - e.clientY + d.startY; }
  }
  function end(e: React.PointerEvent<HTMLCanvasElement>, cancel = false) {
    fingers.current.delete(e.pointerId);
    if (pinch.current) { p.onZoom(pinch.current.current); pinch.current = null; drag.current = null; if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); return; }
    const d = drag.current; if (!d) return; drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (!cancel) { if (d.kind === 'corner') p.onQuad(d.quad!); if (d.kind === 'patch') p.onPatch(point(e)); if (d.kind === 'stroke') p.onStroke({ tool: p.tool as BrushStroke['tool'], radius: p.brush / 2000, points: d.points }); if (d.kind === 'region' && d.points[1]) { const [a, b] = d.points; if (Math.abs(a.x - b.x) > 0.005 && Math.abs(a.y - b.y) > 0.005) { const rect = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) }; if (p.tool === 'sample') p.onSample(rect); else p.onRegion(rect); } } }
    drawOverlay();
  }
  return <div className="board" ref={board}><div className="paper-stage" style={{ width: fit * p.zoom / 100, aspectRatio: `${p.image.width}/${p.image.height}` }}>
    <canvas ref={base} aria-label="考卷預覽" />
    <canvas ref={overlay} className={`overlay ${p.tool}`} aria-label={p.crop ? '拖曳四個角落校正紙張' : '考卷遮罩編輯區'} onPointerDown={down} onPointerMove={move} onPointerUp={e => end(e)} onPointerCancel={e => end(e, true)} />
  </div></div>;
}
