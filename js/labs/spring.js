import { makeCanvas, loop, slider, buttons, checkbox, arrow, text, hint, pointer, fmt, clamp, C } from '../ui.js';

const G = 9.81, L0 = 0.25, YMAX = 0.8, MYSTERY_K = 18.4;
const WEIGHTS = [
  { m: 0.05, label: '50 g', h: 9, w: 36, col: '#8fe3a0' },
  { m: 0.1, label: '100 g', h: 13, w: 42, col: '#5ad1ff' },
  { m: 0.2, label: '200 g', h: 18, w: 48, col: '#ffcc4d' },
  { m: 0.5, label: '500 g', h: 28, w: 56, col: '#ff8a5b' },
];
const MAX_MASS = 2.5;

export default {
  title: "Springs & Hooke's Law",
  icon: '🪀',
  blurb: 'Hang weights, read the ruler and bounce masses to crack the secret stiffness of a mystery spring.',
  theory: `
    <p>A spring pulls back with a force proportional to how far it is stretched (Hooke’s law):</p>
    <div class="eq">F = −k·x</div>
    <p>A hanging mass comes to rest where the spring force balances the weight:</p>
    <div class="eq">k·x₀ = m·g &nbsp;⇒&nbsp; k = m·g / x₀</div>
    <p>Pull it below equilibrium and let go: the net force is always −k·(displacement), so it oscillates in simple harmonic motion with</p>
    <div class="eq">T = 2π·√(m / k)</div>
    <p>Gravity only shifts the equilibrium point — it does not change the period. Four times the mass → twice the period.</p>`,
  challenges: [
    { id: 'stretch', text: 'Hang weights so the spring rests stretched by exactly 10.0 cm (±0.3 cm)', xp: 20 },
    { id: 'period1', text: 'Make it bounce with a measured period of 1.00 ± 0.03 s (≥ 3 bounces)', xp: 30 },
    { id: 'predict', text: 'Predict: 200 g on a k = 20 N/m spring. Period? (s)', xp: 30, check: v => Math.abs(v - 0.628) < 0.02, placeholder: 'seconds' },
    { id: 'quad', text: 'Multiply the mass by 4 (same spring). The period is multiplied by…?', xp: 20, check: v => Math.abs(v - 2) < 0.05, placeholder: 'factor' },
    { id: 'mystery', text: 'Detective work: switch on the Mystery spring and find its k (N/m, within 5%)', xp: 45, check: v => Math.abs(v - MYSTERY_K) / MYSTERY_K < 0.05, placeholder: 'N/m' },
  ],
  mount(ctx) {
    const s = makeCanvas(ctx.stage);
    hint(ctx.stage, 'Drag weights from the shelf onto the hanger · drag the hanger down and let go · click a hung weight to take it off');
    let kUser = 20, mystery = false, damp = 0;
    const kS = slider(ctx.controls, { label: 'Spring constant k', min: 2, max: 100, step: 0.1, value: kUser, unit: 'N/m', fmt: v => v.toFixed(1), onInput: v => { kUser = v; settle(); } });
    checkbox(ctx.controls, { label: '❓ Mystery spring (hidden k)', value: mystery, onChange: v => { mystery = v; kS.input.disabled = v; kS.el.style.opacity = v ? 0.4 : 1; settle(); } });
    slider(ctx.controls, { label: 'Damping b', min: 0, max: 1, step: 0.01, value: damp, unit: 'kg/s', fmt: v => v.toFixed(2), onInput: v => (damp = v) });
    buttons(ctx.controls, [
      { label: '⬇ Pull 5 cm & release', primary: true, onClick: () => { if (mass() > 0) { y = Math.min(YMAX, yEq() + 0.05); v = 0; resetWatch(); } } },
      { label: '■ Settle', onClick: settle },
      { label: 'Remove all weights', onClick: () => { stack.length = 0; settle(); } },
    ]);

    const k = () => (mystery ? MYSTERY_K : kUser);
    let stack = [0, 1]; // indices into WEIGHTS; hanger itself is massless
    const mass = () => stack.reduce((a, i) => a + WEIGHTS[i].m, 0);
    const yEq = () => Math.min(YMAX, (mass() * G) / k());
    let y = 0, v = 0, time = 0, drag = null, hist = [], bottomed = false;
    // stopwatch: upward crossings of the equilibrium line
    let firstCross = null, lastCross = null, n = 0, side = 0, maxDev = 0;
    function resetWatch() { firstCross = lastCross = null; n = 0; side = 0; maxDev = 0; }
    function settle() { y = yEq(); v = 0; resetWatch(); }
    settle();

    const lay = () => {
      const top = 64, sx = Math.max(150, s.w * 0.26);
      const sc = (s.h - top - 175) / (L0 + YMAX + 0.05);
      return { top, sx, sc, hookY: (yy) => top + (L0 + yy) * sc, shelfX: s.w * 0.52, shelfY: 70 };
    };
    const shelfSlots = (Lo) => WEIGHTS.map((W, i) => ({ i, x: Lo.shelfX + 20 + i * 78, y: Lo.shelfY }));
    const stackRects = (Lo) => {
      const hy = Lo.hookY(y), baseY = hy + Math.max(64, stack.reduce((a, i) => a + WEIGHTS[i].h, 0) + 22); let yy = baseY; const out = [];
      stack.forEach((wi) => { const W = WEIGHTS[wi]; yy -= W.h; out.push({ wi, x: Lo.sx - W.w / 2, y: yy, w: W.w, h: W.h }); });
      return { out, baseY, hy };
    };

    const offPtr = pointer(s.cv, {
      down(p) {
        const Lo = lay();
        for (const sl of shelfSlots(Lo)) { const W = WEIGHTS[sl.i]; if (Math.abs(p.x - sl.x - W.w / 2) < W.w / 2 + 6 && p.y > sl.y - 6 && p.y < sl.y + W.h + 22) { drag = { type: 'weight', wi: sl.i, x: p.x, y: p.y }; return; } }
        const { out, baseY, hy } = stackRects(Lo);
        for (let j = out.length - 1; j >= 0; j--) { const r = out[j]; if (p.x > r.x - 4 && p.x < r.x + r.w + 4 && p.y > r.y - 2 && p.y < r.y + r.h + 2) { const wi = stack.splice(j, 1)[0]; drag = { type: 'weight', wi, x: p.x, y: p.y, fromStack: true }; settle(); return; } }
        if (Math.abs(p.x - Lo.sx) < 50 && p.y > hy - 30 && p.y < baseY + 14) { drag = { type: 'pull', off: p.y - hy }; resetWatch(); }
      },
      move(p) {
        if (!drag) return;
        if (drag.type === 'weight') { drag.x = p.x; drag.y = p.y; return; }
        const Lo = lay(); y = clamp((p.y - drag.off - Lo.top) / Lo.sc - L0, -0.1, YMAX); v = 0;
      },
      up(p) {
        if (!drag) return;
        const Lo = lay();
        if (drag.type === 'weight') {
          const { baseY, hy } = stackRects(Lo);
          if (Math.abs(p.x - Lo.sx) < 80 && p.y > hy - 60 && p.y < baseY + 50) {
            if (mass() + WEIGHTS[drag.wi].m > MAX_MASS + 1e-9) ctx.toast(`Max load is ${MAX_MASS} kg!`, 'warn');
            else { stack.push(drag.wi); settle(); }
          } else if (drag.fromStack) ctx.toast(`Removed ${WEIGHTS[drag.wi].label}`, 'info');
        } else if (mass() === 0) settle();
        drag = null;
      },
    });

    const stop = loop((dt) => {
      const m = mass(), kk = k(), ye = yEq();
      if (!drag || drag.type !== 'pull') {
        if (m === 0) { y += (0 - y) * Math.min(1, dt * 12); v = 0; }
        else {
          const sub = 20, h = dt / sub;
          for (let i = 0; i < sub; i++) {
            const a = G - (kk / m) * y - (damp / m) * v;
            v += a * h; y += v * h; time += h; // semi-implicit Euler (energy-stable)
            if (y > YMAX) { y = YMAX; if (v > 0) v = 0; if (!bottomed) { bottomed = true; ctx.toast('Clunk! The spring bottomed out — use a stiffer spring or less mass', 'warn'); } }
            const d = y - ye; maxDev = Math.max(maxDev, Math.abs(d));
            if (maxDev > 0.002) {
              if (d > 0.0005) side = 1;
              else if (d < -0.0005 && side === 1) { // moving up through equilibrium
                side = -1;
                if (firstCross == null) firstCross = time; else n++;
                lastCross = time;
                if (n >= 3) { const T = (lastCross - firstCross) / n; if (Math.abs(T - 1) <= 0.03) { if (!ctx.isDone('period1')) ctx.toast('🎵 One bounce per second — nice rhythm!'); ctx.complete('period1'); } }
              }
            }
          }
          if (y < YMAX - 0.01) bottomed = false;
        }
      } else time += dt;
      // static stretch goal
      if (!drag && m > 0 && Math.abs(v) < 0.005 && Math.abs(y - 0.1) <= 0.003 && Math.abs(y - ye) < 0.001 && y < YMAX - 1e-3) { if (!ctx.isDone('stretch')) ctx.toast('📏 Exactly 10 cm — Hooke approves!'); ctx.complete('stretch'); }
      hist.push([time, y]); while (hist.length && hist[0][0] < time - 8) hist.shift();
      draw();
    });

    function drawWeight(c, W, x, y0, alpha = 1) {
      c.save(); c.globalAlpha = alpha;
      const g = c.createLinearGradient(x, 0, x + W.w, 0); g.addColorStop(0, W.col); g.addColorStop(0.5, '#fff'); g.addColorStop(1, W.col);
      c.fillStyle = g; c.fillRect(x, y0, W.w, W.h); c.strokeStyle = 'rgba(0,0,0,.4)'; c.lineWidth = 1; c.strokeRect(x + .5, y0 + .5, W.w - 1, W.h - 1);
      c.fillStyle = '#1a2338'; c.fillRect(x + W.w / 2 - 2, y0, 4, W.h * 0.5); // slot
      if (W.h >= 13) text(c, W.label, x + W.w / 2, y0 + W.h / 2 + 4, { color: '#0e1422', size: 10, weight: 800, align: 'center' });
      c.restore();
    }

    function draw() {
      const { g: c, w, h } = s, Lo = lay(), { top, sx, sc } = Lo, m = mass(), kk = k(), ye = yEq();
      const gr = c.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#16213a'); gr.addColorStop(1, '#1d2b4a');
      c.fillStyle = gr; c.fillRect(0, 0, w, h);
      // support beam
      c.fillStyle = '#50607e'; c.fillRect(sx - 110, top - 16, 220, 14);
      c.fillStyle = '#7b879f'; c.fillRect(sx - 8, top - 4, 16, 6);
      // ruler: 0 at natural length
      const rx = sx - 110, r0 = Lo.hookY(0);
      c.fillStyle = '#e9d9a6'; c.fillRect(rx - 4, r0 - 12, 40, (YMAX + 0.03) * sc + 12);
      for (let cm = 0; cm <= YMAX * 100; cm++) {
        const yy = r0 + cm / 100 * sc, big = cm % 5 === 0;
        c.fillStyle = '#3a2f12'; c.fillRect(rx + 36 - (big ? 16 : 8), yy, big ? 16 : 8, 1);
        if (cm % 10 === 0) text(c, `${cm}`, rx + 2, yy + 4, { color: '#3a2f12', size: 10, weight: 700 });
      }
      text(c, 'cm', rx + 20, r0 - 3, { color: '#3a2f12', size: 9, weight: 700 });
      // equilibrium marker
      if (m > 0) {
        const ey = Lo.hookY(ye);
        c.setLineDash([5, 5]); c.strokeStyle = 'rgba(91,227,138,.6)'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(rx + 36, ey); c.lineTo(sx + 90, ey); c.stroke(); c.setLineDash([]);
        text(c, 'equilibrium', sx + 92, ey + 4, { color: C.good, size: 10.5 });
      }
      // spring coil
      const hy = Lo.hookY(y), coils = 18, amp = 16, y1 = top + 2, y2 = hy - 12;
      c.strokeStyle = '#c9d1e3'; c.lineWidth = 2.2; c.lineJoin = 'round'; c.beginPath(); c.moveTo(sx, y1); c.lineTo(sx, y1 + 8);
      for (let i = 0; i <= coils * 2; i++) { const t = i / (coils * 2), yy = y1 + 8 + t * (y2 - y1 - 16); c.lineTo(sx + (i === 0 || i === coils * 2 ? 0 : (i % 2 ? amp : -amp)), yy); }
      c.lineTo(sx, y2); c.lineTo(sx, hy); c.stroke();
      // pointer at hook onto ruler
      c.fillStyle = C.bad; c.beginPath(); c.moveTo(rx + 38, hy); c.lineTo(rx + 50, hy - 5); c.lineTo(rx + 50, hy + 5); c.closePath(); c.fill();
      c.strokeStyle = 'rgba(255,107,122,.5)'; c.lineWidth = 1; c.beginPath(); c.moveTo(rx + 50, hy); c.lineTo(sx - 12, hy); c.stroke();
      // hanger
      const { out, baseY } = stackRects(Lo);
      c.strokeStyle = '#e8edf7'; c.lineWidth = 2.5; c.beginPath(); c.arc(sx, hy + 6, 6, -Math.PI / 2, Math.PI * 0.9); c.stroke();
      c.fillStyle = '#aab4c8'; c.fillRect(sx - 2, hy + 10, 4, baseY - hy - 10);
      c.fillStyle = drag?.type === 'pull' ? '#fff' : '#aab4c8'; c.fillRect(sx - 30, baseY, 60, 6);
      out.forEach(r => drawWeight(c, WEIGHTS[r.wi], r.x, r.y));
      // force arrows
      if (m > 0) {
        const kN = 55 / Math.max(m * G, 0.3), Fs = kk * y;
        arrow(c, sx + 44, baseY - 10, sx + 44, baseY - 10 + m * G * kN, C.bad, 2.5, `mg ${fmt(m * G)} N`);
        if (Math.abs(Fs) > 0.01) arrow(c, sx + 44, hy + 6, sx + 44, hy + 6 - Fs * kN, C.accent, 2.5, `kx ${fmt(Fs)} N`);
      }
      if (Math.abs(v) > 0.02) arrow(c, sx - 44, baseY - 20, sx - 44, baseY - 20 + v * 60, C.good, 2.5, 'v');
      text(c, `x = ${fmt(y * 100, 1)} cm`, sx, baseY + 26, { color: C.ink, size: 13, weight: 800, align: 'center' });
      text(c, `m = ${fmt(m * 1000, 0)} g`, sx, baseY + 42, { color: C.muted, size: 12, align: 'center' });
      text(c, mystery ? 'k = ??? N/m' : `k = ${fmt(kk, 1)} N/m`, sx + 20, top + 30, { color: mystery ? C.purple : C.accent, size: 12, weight: 700 });

      // shelf
      c.fillStyle = 'rgba(14,20,34,.6)'; c.fillRect(Lo.shelfX, Lo.shelfY - 30, 330, 92);
      text(c, 'WEIGHT SHELF — drag onto the hanger', Lo.shelfX + 10, Lo.shelfY - 12, { color: C.muted, size: 11, weight: 700 });
      c.fillStyle = '#6b5436'; c.fillRect(Lo.shelfX + 8, Lo.shelfY + 34, 314, 6);
      shelfSlots(Lo).forEach(sl => { const W = WEIGHTS[sl.i]; drawWeight(c, W, sl.x, Lo.shelfY + 34 - W.h); text(c, W.label, sl.x + W.w / 2, Lo.shelfY + 56, { color: C.ink, size: 11, align: 'center' }); });
      if (drag?.type === 'weight') { const W = WEIGHTS[drag.wi]; drawWeight(c, W, drag.x - W.w / 2, drag.y - W.h / 2, 0.85); }

      // live graph x(t)
      const gx = Lo.shelfX, gw = Math.min(w - gx - 16, 460), gy0 = Lo.shelfY + 90, gh = Math.min(220, h - gy0 - 170);
      c.fillStyle = 'rgba(14,20,34,.6)'; c.fillRect(gx, gy0, gw, gh);
      c.strokeStyle = C.grid2; c.strokeRect(gx + .5, gy0 + .5, gw, gh);
      text(c, 'Extension x (cm) vs time — last 8 s', gx + 8, gy0 + 16, { color: C.muted, size: 11, weight: 700 });
      const lo = Math.max(0, ye - Math.max(0.02, maxDev) * 1.3), hi = ye + Math.max(0.02, maxDev) * 1.3;
      const Ym = (val) => gy0 + 24 + (1 - (val - lo) / (hi - lo)) * (gh - 34), Xm = (t) => gx + gw - (time - t) / 8 * gw;
      for (let t = Math.ceil(time - 8); t <= time; t++) { c.strokeStyle = 'rgba(255,255,255,.06)'; c.beginPath(); c.moveTo(Xm(t), gy0 + 22); c.lineTo(Xm(t), gy0 + gh); c.stroke(); }
      c.setLineDash([4, 4]); c.strokeStyle = 'rgba(91,227,138,.5)'; c.beginPath(); c.moveTo(gx, Ym(ye)); c.lineTo(gx + gw, Ym(ye)); c.stroke(); c.setLineDash([]);
      text(c, `${fmt(ye * 100, 1)}`, gx + 4, Ym(ye) - 4, { color: C.good, size: 10 });
      c.save(); c.beginPath(); c.rect(gx, gy0 + 20, gw, gh - 20); c.clip();
      c.strokeStyle = C.gold; c.lineWidth = 2; c.beginPath();
      hist.forEach(([t, yy], i) => (i ? c.lineTo(Xm(t), Ym(yy)) : c.moveTo(Xm(t), Ym(yy)))); c.stroke(); c.restore();
      text(c, `${fmt(hi * 100, 1)} cm`, gx + gw - 4, gy0 + 32, { color: C.muted, size: 10, align: 'right' });
      text(c, `${fmt(lo * 100, 1)} cm`, gx + gw - 4, gy0 + gh - 4, { color: C.muted, size: 10, align: 'right' });

      const Tm = n > 0 ? (lastCross - firstCross) / n : null, Tth = m > 0 ? 2 * Math.PI * Math.sqrt(m / kk) : null;
      ctx.readout.set({
        'Hanging mass m': `${fmt(m * 1000, 0)} g`,
        'Weight mg': `${fmt(m * G, 3)} N`,
        'Spring constant k': mystery ? '??? N/m' : `${fmt(kk, 1)} N/m`,
        'Extension x': `${fmt(y * 100, 2)} cm`,
        'Equilibrium x₀ = mg/k': mystery ? '??? cm' : `${fmt(ye * 100, 2)} cm`,
        'Spring force k·x': mystery ? '??? N' : `${fmt(kk * y, 3)} N`,
        'Velocity': `${fmt(v, 3)} m/s`,
        'Bounces counted': `${n}`,
        'Measured period': Tm ? `${fmt(Tm, 3)} s` : '—',
        'Theory T = 2π√(m/k)': mystery ? '???' : (Tth ? `${fmt(Tth, 3)} s` : '—'),
      });
    }

    return { destroy() { stop(); offPtr(); s.destroy(); } };
  },
};
