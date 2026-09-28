// Shared helpers for every lab: canvas, controls, readouts, drawing.
export const C = {
  bg: '#151d30', grid: '#1f2a44', grid2: '#27345a', ink: '#e8edf7', muted: '#93a0bd',
  accent: '#5ad1ff', gold: '#ffcc4d', good: '#5be38a', bad: '#ff6b7a', purple: '#c38bff', orange: '#ff8a5b',
  pos: '#ff6b7a', neg: '#5ad1ff',
};

// Canvas that fills the stage, handles devicePixelRatio and resizes.
export function makeCanvas(stage) {
  const cv = document.createElement('canvas');
  stage.appendChild(cv);
  const g = cv.getContext('2d');
  const s = { cv, g, w: 0, h: 0, resizeFns: [] };
  const fit = () => {
    const r = stage.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
    s.w = r.width; s.h = r.height;
    cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    s.resizeFns.forEach(f => f(s.w, s.h));
  };
  const ro = new ResizeObserver(fit); ro.observe(stage); fit();
  s.onResize = (f) => s.resizeFns.push(f);
  s.destroy = () => { ro.disconnect(); cv.remove(); };
  return s;
}

export function loop(fn) {
  let last = performance.now(), id, alive = true;
  const step = (t) => { if (!alive) return; const dt = Math.min(0.05, (t - last) / 1000); last = t; fn(dt, t / 1000); id = requestAnimationFrame(step); };
  id = requestAnimationFrame(step);
  return () => { alive = false; cancelAnimationFrame(id); };
}

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };

export function slider(parent, { label, min, max, step = 1, value, unit = '', fmt, onInput }) {
  const wrap = el('div', 'ctl');
  const lab = el('label', '', `<span>${label}</span><b></b>`);
  const inp = el('input'); Object.assign(inp, { type: 'range', min, max, step, value });
  const b = lab.querySelector('b');
  const show = () => { const v = +inp.value; b.textContent = (fmt ? fmt(v) : v) + (unit ? ' ' + unit : ''); };
  inp.addEventListener('input', () => { show(); onInput?.(+inp.value); });
  wrap.append(lab, inp); parent.appendChild(wrap); show();
  return { get value() { return +inp.value; }, set(v) { inp.value = v; show(); onInput?.(+inp.value); }, input: inp, el: wrap };
}

export function select(parent, { label, options, value, onChange }) {
  const wrap = el('div', 'ctl');
  wrap.appendChild(el('label', '', `<span>${label}</span>`));
  const s = el('select');
  options.forEach(([v, t]) => { const o = el('option', '', t); o.value = v; s.appendChild(o); });
  s.value = value; s.addEventListener('change', () => onChange?.(s.value));
  wrap.appendChild(s); parent.appendChild(wrap);
  return { get value() { return s.value; }, set(v) { s.value = v; onChange?.(v); }, el: s };
}

export function buttons(parent, list) {
  const wrap = el('div', 'btns');
  const out = list.map(({ label, onClick, primary }) => { const b = el('button', 'btn' + (primary ? ' primary' : ''), label); b.onclick = onClick; wrap.appendChild(b); return b; });
  parent.appendChild(wrap); return out;
}

export function checkbox(parent, { label, value = false, onChange }) {
  const wrap = el('label', 'check');
  const i = el('input'); i.type = 'checkbox'; i.checked = value;
  i.addEventListener('change', () => onChange?.(i.checked));
  wrap.append(i, document.createTextNode(label)); parent.appendChild(wrap);
  return { get value() { return i.checked; }, set(v) { i.checked = v; onChange?.(v); } };
}

// Key/value measurement table. set({ 'Speed': '3.2 m/s', ... })
export function readout(root) {
  let last = '';
  return {
    set(obj) {
      const html = Object.entries(obj).map(([k, v]) => `<span class="k">${k}</span><span class="v">${v}</span>`).join('');
      if (html !== last) { root.innerHTML = html; last = html; }
    },
  };
}

export function hint(stage, text) { const h = el('div', 'hint', text); stage.appendChild(h); return h; }

// Pointer events in CSS pixels relative to the canvas.
export function pointer(cv, { down, move, up }) {
  const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const d = (e) => { cv.setPointerCapture(e.pointerId); down?.(pos(e), e); };
  const m = (e) => move?.(pos(e), e);
  const u = (e) => up?.(pos(e), e);
  cv.addEventListener('pointerdown', d); cv.addEventListener('pointermove', m); cv.addEventListener('pointerup', u);
  return () => { cv.removeEventListener('pointerdown', d); cv.removeEventListener('pointermove', m); cv.removeEventListener('pointerup', u); };
}

export function arrow(g, x1, y1, x2, y2, color = C.accent, width = 2.5, label) {
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
  if (len < 1) return;
  const ux = dx / len, uy = dy / len, hs = Math.min(10, len * 0.4);
  g.save(); g.strokeStyle = g.fillStyle = color; g.lineWidth = width; g.lineCap = 'round';
  g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2 - ux * hs * 0.8, y2 - uy * hs * 0.8); g.stroke();
  g.beginPath(); g.moveTo(x2, y2); g.lineTo(x2 - ux * hs - uy * hs * 0.5, y2 - uy * hs + ux * hs * 0.5); g.lineTo(x2 - ux * hs + uy * hs * 0.5, y2 - uy * hs - ux * hs * 0.5); g.closePath(); g.fill();
  if (label) { g.font = '600 12px Inter, system-ui'; g.fillText(label, x2 + 6, y2 - 6); }
  g.restore();
}

export function gridBg(g, w, h, step = 40, ox = 0, oy = 0) {
  g.fillStyle = C.bg; g.fillRect(0, 0, w, h);
  g.strokeStyle = C.grid; g.lineWidth = 1; g.beginPath();
  for (let x = ((ox % step) + step) % step; x < w; x += step) { g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, h); }
  for (let y = ((oy % step) + step) % step; y < h; y += step) { g.moveTo(0, y + 0.5); g.lineTo(w, y + 0.5); }
  g.stroke();
}

export function text(g, str, x, y, { color = C.ink, size = 13, weight = 500, align = 'left', base = 'alphabetic' } = {}) {
  g.save(); g.fillStyle = color; g.font = `${weight} ${size}px Inter, system-ui, sans-serif`; g.textAlign = align; g.textBaseline = base; g.fillText(str, x, y); g.restore();
}

export const fmt = (v, d = 2) => (Math.abs(v) < 1e-9 ? 0 : v).toFixed(d);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
