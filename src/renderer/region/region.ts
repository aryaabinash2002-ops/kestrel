/**
 * Region-selection overlay: shows the frozen screenshot, lets the user drag a rectangle.
 * Enter/Space = whole screen, Esc = cancel.
 */
interface RegionInit {
  imageDataUrl: string;
  width: number;
  height: number;
  displayId: number;
}
declare global {
  interface Window {
    kestrelRegion: {
      onInit(listener: (init: RegionInit) => void): () => void;
      select(rect: { x: number; y: number; width: number; height: number; displayId: number } | null): void;
    };
  }
}

const root = document.body;
root.style.cssText = 'margin:0;overflow:hidden;cursor:crosshair;user-select:none;background:#000';
const img = document.createElement('div');
img.style.cssText = 'position:fixed;inset:0;background-size:100% 100%;background-repeat:no-repeat;';
const dim = document.createElement('div');
dim.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);';
const sel = document.createElement('div');
sel.style.cssText = 'position:fixed;display:none;border:1.5px solid #f5a524;box-shadow:0 0 0 9999px rgba(0,0,0,0.45);background:transparent;';
const hint = document.createElement('div');
hint.textContent = 'Drag to select the problem · Enter = whole screen · Esc = cancel';
hint.style.cssText =
  'position:fixed;left:50%;top:24px;transform:translateX(-50%);padding:8px 14px;border-radius:999px;background:rgba(15,17,23,.92);color:#e6e8ee;font:13px -apple-system,system-ui,sans-serif;border:1px solid #2a2f3a;pointer-events:none;';
root.append(img, dim, sel, hint);

let displayId = 0;
let start: { x: number; y: number } | null = null;

window.kestrelRegion.onInit((init) => {
  displayId = init.displayId;
  img.style.backgroundImage = `url(${init.imageDataUrl})`;
});

function rectFrom(a: { x: number; y: number }, b: { x: number; y: number }) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

window.addEventListener('mousedown', (e) => {
  start = { x: e.clientX, y: e.clientY };
  dim.style.display = 'none';
  sel.style.display = 'block';
  Object.assign(sel.style, { left: `${e.clientX}px`, top: `${e.clientY}px`, width: '0px', height: '0px' });
});
window.addEventListener('mousemove', (e) => {
  if (!start) return;
  const r = rectFrom(start, { x: e.clientX, y: e.clientY });
  Object.assign(sel.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px` });
});
window.addEventListener('mouseup', (e) => {
  if (!start) return;
  const r = rectFrom(start, { x: e.clientX, y: e.clientY });
  start = null;
  if (r.width < 8 || r.height < 8) {
    // Treat a click as "whole screen".
    window.kestrelRegion.select({ x: 0, y: 0, width: window.innerWidth, height: window.innerHeight, displayId });
    return;
  }
  window.kestrelRegion.select({ ...r, displayId });
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.kestrelRegion.select(null);
  if (e.key === 'Enter' || e.key === ' ') window.kestrelRegion.select({ x: 0, y: 0, width: window.innerWidth, height: window.innerHeight, displayId });
});
export {};
