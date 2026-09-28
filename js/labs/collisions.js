import { makeCanvas, loop, slider, buttons, checkbox, pointer, arrow, text, hint, fmt, clamp, C } from '../ui.js';

const L = 10;                              // track length (m)
const cartW = (m) => 0.45 + 0.1 * m;       // cart length grows with mass (m)
const VS = 22;                             // px per m/s for velocity arrows

export default {
  title: 'Collision Track',
  icon: '🚃',
  blurb: 'Smash two air-track carts together: momentum always survives, kinetic energy sometimes does not.',
  theory: `
    <p>On a frictionless air track no outside force acts along the track, so the <b>total momentum</b> is the same before and after any collision:</p>
    <div class="eq">m₁v₁ + m₂v₂ = m₁v₁′ + m₂v₂′</div>
    <p>How bouncy the crash is comes from the <b>coefficient of restitution</b> e — the ratio of separation speed to approach speed:</p>
    <div class="eq">v₂′ − v₁′ = e·(v₁ − v₂)</div>
    <p>Combining both gives the outcome:</p>
    <div class="eq">v₁′ = [m₁v₁ + m₂v₂ + m₂e(v₂ − v₁)] / (m₁ + m₂)</div>
    <p>e = 1 is <b>elastic</b> (kinetic energy K = ½mv² is conserved). e = 0 is <b>perfectly inelastic</b>: the carts stick and move together at v′ = (m₁v₁ + m₂v₂)/(m₁ + m₂), losing the most energy allowed by momentum conservation.</p>`,
  challenges: [
    { id: 'stop', text: 'Newton’s cradle: with <b>e = 1</b> and <b>equal masses</b>, make cart 1 stop dead after hitting cart 2', xp: 25 },
    { id: 'bounce', text: 'Make a light cart <b>bounce back</b> off a cart at least 3× heavier', xp: 20 },
    { id: 'half', text: 'Lose <b>at least 50%</b> of the kinetic energy in one collision', xp: 25 },
    { id: 'head', text: 'Head-on crash: both carts moving toward each other end up <b>completely at rest</b>', xp: 40 },
    { id: 'sticky', text: 'Predict: m₁ = 2 kg at 3 m/s hits m₂ = 1 kg at rest and they <b>stick</b>. Final velocity? (m/s)', xp: 30, check: v => Math.abs(v - 2) < 0.05, placeholder: 'm/s' },
    { id: 'elastic', text: 'Predict: m₁ = 1 kg at 4 m/s hits m₂ = 3 kg at rest, <b>elastic</b>. Velocity of cart 1 afterwards? (m/s, + = right)', xp: 45, check: v => Math.abs(v + 2) < 0.06, placeholder: 'm/s' },
  ],
  mount(ctx) {
    const s = makeCanvas(ctx.stage);
    hint(ctx.stage, 'Drag a cart to place it · drag the ● arrow knob to set its velocity · Space or “Launch” to run');
    const st = { m1: 2, m2: 2, v1: 3, v2: 0, e: 1, x1: 2.4, x2: 6.2 };
    let slow = false;
    const f1 = (v) => v.toFixed(1), f2 = (v) => v.toFixed(2);
    const S = {
      m1: slider(ctx.controls, { label: 'Mass m₁ (blue cart)', min: 0.5, max: 5, step: 0.1, value: st.m1, unit: 'kg', fmt: f1, onInput: v => { st.m1 = v; fitCarts(); reset(); } }),
      m2: slider(ctx.controls, { label: 'Mass m₂ (orange cart)', min: 0.5, max: 5, step: 0.1, value: st.m2, unit: 'kg', fmt: f1, onInput: v => { st.m2 = v; fitCarts(); reset(); } }),
      v1: slider(ctx.controls, { label: 'Initial velocity v₁', min: -5, max: 5, step: 0.1, value: st.v1, unit: 'm/s', fmt: f1, onInput: v => { st.v1 = v; reset(); } }),
      v2: slider(ctx.controls, { label: 'Initial velocity v₂', min: -5, max: 5, step: 0.1, value: st.v2, unit: 'm/s', fmt: f1, onInput: v => { st.v2 = v; reset(); } }),
      e: slider(ctx.controls, { label: 'Elasticity e', min: 0, max: 1, step: 0.05, value: st.e, fmt: v => f2(v) + (v === 0 ? ' sticky' : v === 1 ? ' elastic' : ''), onInput: v => { st.e = v; reset(); } }),
    };
    checkbox(ctx.controls, { label: 'Slow motion (¼ speed)', value: slow, onChange: v => (slow = v) });
    buttons(ctx.controls, [
      { label: '🚀 Launch', primary: true, onClick: () => launch() },
      { label: 'Reset', onClick: () => reset() },
      { label: 'Swap carts’ masses', onClick: () => { const a = st.m1; S.m1.set(st.m2); S.m2.set(a); } },
    ]);

    let mode = 'setup', c1, c2, hit, flash = null, tRun = 0, scaleP = 1, scaleK = 1, K0 = 0, P0 = 0;

    function outcome(u1, u2) {
      const { m1, m2, e } = st, M = m1 + m2, P = m1 * u1 + m2 * u2;
      return [(P + m2 * e * (u2 - u1)) / M, (P + m1 * e * (u1 - u2)) / M];
    }
    function fitCarts() { // keep carts on the track and apart when masses change
      const w1 = cartW(st.m1), w2 = cartW(st.m2);
      st.x1 = clamp(st.x1, w1 / 2, L - w2 - w1 / 2 - 0.1);
      st.x2 = clamp(st.x2, st.x1 + (w1 + w2) / 2 + 0.1, L - w2 / 2);
    }
    function reset() {
      mode = 'setup'; hit = null; flash = null; tRun = 0;
      c1 = { x: st.x1, v: st.v1 }; c2 = { x: st.x2, v: st.v2 };
      const { m1, m2 } = st, [a, b] = outcome(st.v1, st.v2);
      P0 = m1 * st.v1 + m2 * st.v2; K0 = 0.5 * m1 * st.v1 ** 2 + 0.5 * m2 * st.v2 ** 2;
      scaleP = Math.max(1, Math.abs(m1 * st.v1), Math.abs(m2 * st.v2), Math.abs(P0), Math.abs(m1 * a), Math.abs(m2 * b)) * 1.1;
      scaleK = Math.max(0.5, K0) * 1.08;
    }
    function launch() {
      if (mode !== 'setup') reset();
      if (Math.abs(st.v1) < 1e-9 && Math.abs(st.v2) < 1e-9) return ctx.toast('Give at least one cart a velocity first', 'info');
      mode = 'run';
    }
    reset();

    const onKey = (e) => {
      if (e.code !== 'Space' || ['INPUT', 'SELECT', 'BUTTON'].includes(document.activeElement.tagName)) return;
      e.preventDefault(); mode === 'setup' ? launch() : reset();
    };
    addEventListener('keydown', onKey);

    function collide() {
      const u1 = c1.v, u2 = c2.v, { m1, m2, e } = st;
      [c1.v, c2.v] = outcome(u1, u2);
      const Kb = 0.5 * m1 * u1 * u1 + 0.5 * m2 * u2 * u2, Ka = 0.5 * m1 * c1.v ** 2 + 0.5 * m2 * c2.v ** 2;
      const lost = Kb > 1e-9 ? 1 - Ka / Kb : 0;
      hit = { u1, u2, v1: c1.v, v2: c2.v, Kb, Ka, lost, sticky: e === 0 };
      flash = { x: c1.x + cartW(m1) / 2, t: 0 };
      // challenges
      if (e >= 0.99 && Math.abs(m1 - m2) < 0.051 && Math.abs(u1) > 0.3 && Math.abs(c1.v) < 0.05) ctx.complete('stop');
      if (m2 >= 3 * m1 - 1e-9 && u1 > 0.3 && c1.v < -0.1) ctx.complete('bounce');
      if (m1 >= 3 * m2 - 1e-9 && u2 < -0.3 && c2.v > 0.1) ctx.complete('bounce');
      if (lost >= 0.495) ctx.complete('half');
      if (u1 > 0.3 && u2 < -0.3 && Math.abs(c1.v) < 0.05 && Math.abs(c2.v) < 0.05) ctx.complete('head');
      if (Math.abs(c1.v) < 0.05 && Math.abs(c2.v) < 0.05) ctx.toast('💥 Dead stop! All kinetic energy became heat & sound', 'info');
      else ctx.toast(`Collision! ${fmt(lost * 100, 0)}% of kinetic energy lost`, lost > 0.01 ? 'info' : '');
    }

    function step(h) {
      const w1 = cartW(st.m1), w2 = cartW(st.m2);
      c1.x += c1.v * h; c2.x += c2.v * h; tRun += h;
      const gap = (c2.x - c1.x) - (w1 + w2) / 2;
      if (gap <= 0) {
        const M = st.m1 + st.m2; c1.x += gap * st.m2 / M; c2.x -= gap * st.m1 / M;
        if (c1.v > c2.v + 1e-9) collide();
      }
      if (c1.x - w1 / 2 <= 0 || c2.x + w2 / 2 >= L || tRun > 15 || (hit && Math.abs(c1.v) < 0.02 && Math.abs(c2.v) < 0.02 && tRun > 1)) {
        c1.x = clamp(c1.x, w1 / 2, L); c2.x = clamp(c2.x, 0, L - w2 / 2);
        mode = 'done';
        if (!hit) ctx.toast('No collision — cart 1 must be faster than cart 2 to catch it', 'warn');
      }
    }

    // ------- direct manipulation -------
    let drag = null;
    const lay = () => { // track on top, bar charts below; everything derived from the stage size
      const x0 = 40, ppm = (s.w - 80) / L, side = s.w > 720;
      const ph = clamp(side ? s.h - 330 : (s.h - 340) / 2, 90, 210), below = side ? ph : 2 * ph + 10;
      const ty = clamp(0.5 * (s.h - below - 100) + 70, 150, s.h - below - 110);
      return { x0, ppm, ty, ph, side, X: (x) => x0 + x * ppm };
    };
    const cartH = (m) => 30 + 5 * m;
    function knob(which) {
      const { X, ty } = lay(), m = which === 1 ? st.m1 : st.m2, x = which === 1 ? st.x1 : st.x2, v = which === 1 ? st.v1 : st.v2;
      return { x: X(x) + v * VS, y: ty - cartH(m) - 22 };
    }
    const offP = pointer(s.cv, {
      down(p) {
        if (mode !== 'setup') reset();
        const { X, ppm, ty } = lay();
        for (const k of [1, 2]) { const kb = knob(k); if (Math.hypot(p.x - kb.x, p.y - kb.y) < 16) { drag = { type: 'v', k }; return; } }
        for (const k of [1, 2]) {
          const m = k === 1 ? st.m1 : st.m2, x = k === 1 ? st.x1 : st.x2, hw = cartW(m) * ppm / 2;
          if (Math.abs(p.x - X(x)) < hw + 4 && p.y > ty - cartH(m) - 6 && p.y < ty + 12) { drag = { type: 'x', k, off: p.x - X(x) }; return; }
        }
      },
      move(p) {
        if (!drag) { s.cv.style.cursor = hover(p) ? 'grab' : 'default'; return; }
        const { x0, ppm } = lay();
        if (drag.type === 'v') {
          const cx = x0 + (drag.k === 1 ? st.x1 : st.x2) * ppm, v = clamp(Math.round((p.x - cx) / VS * 10) / 10, -5, 5);
          (drag.k === 1 ? S.v1 : S.v2).set(v);
        } else {
          const w1 = cartW(st.m1), w2 = cartW(st.m2), x = (p.x - drag.off - x0) / ppm;
          if (drag.k === 1) st.x1 = clamp(x, w1 / 2, st.x2 - (w1 + w2) / 2 - 0.05);
          else st.x2 = clamp(x, st.x1 + (w1 + w2) / 2 + 0.05, L - w2 / 2);
          reset();
        }
      },
      up() { drag = null; },
    });
    function hover(p) {
      if (mode !== 'setup') return false;
      return [1, 2].some(k => { const kb = knob(k); return Math.hypot(p.x - kb.x, p.y - kb.y) < 16; });
    }

    const stop = loop((dt) => {
      if (mode === 'run') { const T = dt * (slow ? 0.25 : 1), n = 10; for (let i = 0; i < n && mode === 'run'; i++) step(T / n); }
      if (flash) { flash.t += dt; if (flash.t > 0.8) flash = null; }
      draw();
    });

    function draw() {
      const { g: c, w, h } = s, { X, ppm, ty } = lay(), { m1, m2 } = st;
      const bg = c.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, '#162037'); bg.addColorStop(1, '#10172a');
      c.fillStyle = bg; c.fillRect(0, 0, w, h);
      // track + ruler
      c.fillStyle = '#56627e'; c.fillRect(X(0) - 8, ty, L * ppm + 16, 10);
      c.fillStyle = '#8a95ad'; c.fillRect(X(0) - 8, ty, L * ppm + 16, 3);
      for (const bx of [X(0) - 14, X(L) + 2]) { c.fillStyle = '#3a4560'; c.fillRect(bx, ty - 34, 12, 44); }
      c.fillStyle = 'rgba(255,255,255,.35)';
      for (let i = 0; i <= L * 2; i++) { const x = X(i / 2); c.fillRect(x, ty + 12, 1, i % 2 ? 5 : 9); if (i % 2 === 0) text(c, `${i / 2} m`, x, ty + 32, { color: C.muted, size: 10.5, align: 'center' }); }
      // air holes
      c.fillStyle = 'rgba(90,209,255,.18)';
      for (let x = X(0); x < X(L); x += 14) c.fillRect(x, ty + 4, 2, 2);

      // carts
      const drawCart = (cart, m, color, label, k) => {
        const cw = cartW(m) * ppm, ch = cartH(m), cx = X(cart.x);
        c.fillStyle = 'rgba(90,209,255,.10)'; c.fillRect(cx - cw / 2, ty - 5, cw, 5);
        c.fillStyle = color; roundRect(c, cx - cw / 2, ty - 5 - ch, cw, ch, 6); c.fill();
        c.fillStyle = 'rgba(0,0,0,.25)'; c.fillRect(cx - cw / 2, ty - 12, cw, 7);
        if (st.e === 0) { c.fillStyle = '#2b2b2b'; const bx = k === 1 ? cx + cw / 2 - 5 : cx - cw / 2; c.fillRect(bx, ty - 5 - ch + 6, 5, ch - 14); }
        else { c.strokeStyle = '#e5e9f2'; c.lineWidth = 2; c.beginPath(); const sx = k === 1 ? cx + cw / 2 : cx - cw / 2, d = k === 1 ? 1 : -1; c.moveTo(sx, ty - 12 - ch / 2); for (let i = 1; i <= 4; i++) c.lineTo(sx + d * i * 2.2, ty - 12 - ch / 2 + (i % 2 ? -5 : 5) * st.e); c.stroke(); }
        text(c, label, cx, ty - 5 - ch / 2 - 5, { color: '#04121c', size: 12.5, weight: 800, align: 'center', base: 'middle' });
        text(c, `${fmt(m, 1)} kg`, cx, ty - 5 - ch / 2 + 8, { color: '#04121c', size: 10.5, weight: 600, align: 'center', base: 'middle' });
        const ay = ty - ch - 22;
        if (Math.abs(cart.v) > 0.01) arrow(c, cx, ay, cx + cart.v * VS, ay, color, 3);
        const lift = k === 2 && Math.abs((X(c1.x) + c1.v * VS / 2) - (cx + cart.v * VS / 2)) < 75 ? 16 : 0;
        text(c, `${fmt(cart.v, 2)} m/s`, cx + cart.v * VS / 2, ay - 10 - lift, { color, size: 11.5, weight: 700, align: 'center' });
        if (mode === 'setup') {
          const kx = cx + cart.v * VS;
          c.fillStyle = '#fff'; c.strokeStyle = color; c.lineWidth = 3; c.beginPath(); c.arc(kx, ay, 7, 0, Math.PI * 2); c.fill(); c.stroke();
        }
      };
      drawCart(c1, m1, C.accent, 'm₁', 1); drawCart(c2, m2, C.orange, 'm₂', 2);
      if (flash) {
        const fx = X(flash.x), fy = ty - 30, r = 10 + flash.t * 70;
        c.strokeStyle = `rgba(255,204,77,${1 - flash.t / 0.8})`; c.lineWidth = 3;
        for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; c.beginPath(); c.moveTo(fx + Math.cos(a) * r * 0.5, fy + Math.sin(a) * r * 0.5); c.lineTo(fx + Math.cos(a) * r, fy + Math.sin(a) * r); c.stroke(); }
      }
      // status line
      const status = mode === 'setup' ? 'Ready — press Launch (Space)' : mode === 'run' ? (hit ? 'After the collision…' : 'Carts moving…') : 'Run over — press Space / Reset to set up again';
      text(c, status, w / 2, ty + 56, { color: mode === 'done' ? C.gold : C.muted, size: 13, weight: 600, align: 'center' });
      if (hit) text(c, `Before: v₁ = ${fmt(hit.u1, 2)}, v₂ = ${fmt(hit.u2, 2)} m/s   →   After: v₁′ = ${fmt(hit.v1, 2)}, v₂′ = ${fmt(hit.v2, 2)} m/s${hit.sticky ? '  (stuck together)' : ''}`, w / 2, ty + 78, { color: C.ink, size: 12.5, weight: 600, align: 'center' });

      // bar charts
      const p1 = m1 * c1.v, p2 = m2 * c2.v, K1 = 0.5 * m1 * c1.v ** 2, K2 = 0.5 * m2 * c2.v ** 2;
      const { ph, side } = lay(), top = ty + 100, pw = side ? (w - 60) / 2 : w - 40;
      const boxP = { x: 20, y: top, w: pw, h: ph }, boxK = side ? { x: 40 + pw, y: top, w: pw, h: ph } : { x: 20, y: top + ph + 10, w: pw, h: ph };
      if (ph > 70) {
        bars(c, boxP, 'Momentum p = m·v  (kg·m/s)', [['p₁', p1, C.accent], ['p₂', p2, C.orange], ['Σp', p1 + p2, C.ink]], scaleP, true, P0, 'initial Σp');
        const lost = K0 > 1e-9 ? 1 - (K1 + K2) / K0 : 0;
        bars(c, boxK, `Kinetic energy K = ½mv²  (J)${lost > 0.005 ? `   · lost ${fmt(lost * 100, 0)}%` : ''}`, [['K₁', K1, C.accent], ['K₂', K2, C.orange], ['ΣK', K1 + K2, C.gold]], scaleK, false, K0, 'initial ΣK');
      }

      ctx.readout.set({
        'v₁ / v₂': `${fmt(c1.v)} / ${fmt(c2.v)} m/s`,
        'p₁ / p₂': `${fmt(p1)} / ${fmt(p2)} kg·m/s`,
        'Total momentum Σp': `${fmt(p1 + p2)} kg·m/s`,
        'Total kinetic energy ΣK': `${fmt(K1 + K2)} J`,
        'Elasticity e': fmt(st.e, 2),
        'Last collision: KE lost': hit ? `${fmt(hit.lost * 100, 1)} %` : '—',
        'Last collision: v₁′ / v₂′': hit ? `${fmt(hit.v1)} / ${fmt(hit.v2)} m/s` : '—',
      });
    }

    return { destroy() { stop(); offP(); removeEventListener('keydown', onKey); s.destroy(); } };
  },
};

function roundRect(c, x, y, w, h, r) {
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}

// Horizontal bar chart. signed → zero in the middle.
function bars(c, b, title, rows, scale, signed, ref, refLabel) {
  c.fillStyle = 'rgba(26,35,56,.85)'; roundRect(c, b.x, b.y, b.w, b.h, 10); c.fill();
  c.strokeStyle = '#2a3654'; c.lineWidth = 1; c.stroke();
  text(c, title, b.x + 12, b.y + 20, { color: C.muted, size: 12, weight: 700 });
  const lx = b.x + 44, rw = b.w - 64, zx = signed ? lx + rw / 2 : lx, half = signed ? rw / 2 : rw;
  const rowH = Math.min(44, (b.h - 58) / rows.length);
  c.strokeStyle = 'rgba(255,255,255,.25)'; c.beginPath(); c.moveTo(zx + 0.5, b.y + 30); c.lineTo(zx + 0.5, b.y + 34 + rowH * rows.length); c.stroke();
  rows.forEach(([name, v, col], i) => {
    const y = b.y + 34 + i * rowH, bh = rowH * 0.62, len = clamp(v / scale, -1, 1) * half;
    text(c, name, b.x + 14, y + bh / 2, { color: col, size: 13, weight: 700, base: 'middle' });
    c.fillStyle = col; c.globalAlpha = 0.85; c.fillRect(Math.min(zx, zx + len), y, Math.abs(len), bh); c.globalAlpha = 1;
    const tx = zx + len + (len >= 0 ? 6 : -6);
    text(c, fmt(v, 2), tx, y + bh / 2, { color: C.ink, size: 11.5, weight: 600, align: len >= 0 ? 'left' : 'right', base: 'middle' });
  });
  const rx = zx + clamp(ref / scale, -1, 1) * half;
  c.strokeStyle = C.good; c.setLineDash([4, 4]); c.lineWidth = 1.5; c.beginPath(); c.moveTo(rx, b.y + 30); c.lineTo(rx, b.y + 36 + rowH * rows.length); c.stroke(); c.setLineDash([]);
  text(c, refLabel, rx, b.y + 40 + rowH * rows.length, { color: C.good, size: 10, align: 'center', base: 'top' });
}
