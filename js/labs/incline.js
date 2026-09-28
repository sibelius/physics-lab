import { makeCanvas, loop, slider, buttons, checkbox, arrow, text, hint, pointer, fmt, clamp, C } from '../ui.js';

const G = 9.81, L = 5, FLOOR = 7, BS = 0.6; // ramp length, floor length, block size (m)
const D2R = Math.PI / 180;

export default {
  title: 'Inclined Plane & Friction',
  icon: '🧊',
  blurb: 'Tilt a ramp, tune friction and push a block — find out exactly when it slips and where it stops.',
  theory: `
    <p>Split the weight <b>mg</b> into a part along the ramp and a part into the ramp:</p>
    <div class="eq">F∥ = m·g·sinθ &nbsp;&nbsp; F⊥ = m·g·cosθ = N</div>
    <p>Static friction can hold the block up to a maximum of</p>
    <div class="eq">f<sub>s,max</sub> = μs·N</div>
    <p>So the block stays put while m·g·sinθ ≤ μs·m·g·cosθ, i.e. while tanθ ≤ μs. The mass cancels!</p>
    <p>Once sliding, kinetic friction f = μk·N acts against the motion:</p>
    <div class="eq">a = g·(sinθ − μk·cosθ)</div>
    <p>From rest, the time to slide a distance d is t = √(2d/a). On the flat floor the block decelerates at μk·g and stops after v²/(2·μk·g).</p>`,
  challenges: [
    { id: 'slide', text: 'Beat static friction: make the block start sliding on its own', xp: 15 },
    { id: 'crit', text: 'Set μs = 0.50. At what ramp angle does the block <b>just</b> start to slip? (degrees)', xp: 30, check: v => Math.abs(v - 26.57) < 0.7, placeholder: 'degrees' },
    { id: 'fast', text: 'Speed run: slide from the top to the bottom of the ramp in under 1.50 s', xp: 20 },
    { id: 'frict', text: 'Predict: frictionless ramp at 30°. What is the block’s acceleration? (m/s²)', xp: 30, check: v => Math.abs(v - 4.905) < 0.1, placeholder: 'm/s²' },
    { id: 'zone', text: 'Make the block slide down and come to rest inside the green target zone', xp: 35 },
    { id: 'hold', text: 'A 2 kg block on a frictionless 40° ramp: what push force holds it still? (N) — test it with the push slider!', xp: 40, check: v => Math.abs(v - 12.61) < 0.3, placeholder: 'newtons' },
  ],
  mount(ctx) {
    const s = makeCanvas(ctx.stage);
    hint(ctx.stage, 'Drag the block along the ramp · drag the ◉ handle at the top to tilt · Space = reset to top');
    let theta = 20, mass = 2, mus = 0.5, muk = 0.3, push = 0;
    const sTh = slider(ctx.controls, { label: 'Ramp angle θ', min: 0, max: 60, step: 0.1, value: theta, unit: '°', fmt: v => v.toFixed(1), onInput: v => (theta = v) });
    slider(ctx.controls, { label: 'Mass m', min: 0.5, max: 10, step: 0.1, value: mass, unit: 'kg', fmt: v => v.toFixed(1), onInput: v => (mass = v) });
    const sMs = slider(ctx.controls, { label: 'Static friction μs', min: 0, max: 1, step: 0.01, value: mus, fmt: v => v.toFixed(2), onInput: v => { mus = v; if (muk > v) sMk.set(v); } });
    const sMk = slider(ctx.controls, { label: 'Kinetic friction μk', min: 0, max: 1, step: 0.01, value: muk, fmt: v => v.toFixed(2), onInput: v => { muk = v; if (mus < v) sMs.set(v); } });
    const sF = slider(ctx.controls, { label: 'Push force F (+ = up the ramp)', min: -30, max: 30, step: 0.01, value: push, unit: 'N', fmt: v => v.toFixed(2), onInput: v => (push = v) });
    checkbox(ctx.controls, { label: 'Show weight components', value: true, onChange: v => (showComp = v) });
    buttons(ctx.controls, [
      { label: '⤒ Reset to top', primary: true, onClick: reset },
      { label: 'Push = 0', onClick: () => sF.set(0) },
      { label: 'Frictionless', onClick: () => { sMk.set(0); sMs.set(0); } },
      { label: 'New target', onClick: newZone },
    ]);
    let showComp = true;

    // state: phase 'ramp' (s = distance down the slope from the top) or 'floor' (x = distance from ramp foot)
    let phase = 'ramp', pos = 0, v = 0, t = 0, timing = false, lastBottom = null, fr = 0, acc = 0, stopped = true;
    let zone = 3, dragging = null, flash = null, stopMsg = null, grip = 0;
    function newZone() { zone = Math.round((1.3 + Math.random() * 4.4) * 10) / 10; }
    newZone();
    function reset() { phase = 'ramp'; pos = 0; v = 0; t = 0; timing = false; stopped = true; stopMsg = null; }

    const onKey = (e) => { if (e.code === 'Space' && document.activeElement.tagName !== 'INPUT') { e.preventDefault(); reset(); } };
    addEventListener('keydown', onKey);

    // layout (CSS px), recomputed each frame
    const lay = () => {
      const sc = Math.min((s.w - 80) / (L + FLOOR + 0.3), (s.h - 170) / (L * Math.sin(60 * D2R) + 0.6));
      const footX = 40 + L * sc, gy = s.h - 70, th = theta * D2R;
      return { sc, footX, gy, th, topX: footX - L * Math.cos(th) * sc, topY: gy - L * Math.sin(th) * sc, ux: Math.cos(th), uy: Math.sin(th), nx: Math.sin(th), ny: -Math.cos(th) };
    };
    const blockCenter = (Lo) => phase === 'ramp'
      ? { x: Lo.topX + Lo.ux * pos * Lo.sc + Lo.nx * BS / 2 * Lo.sc, y: Lo.topY + Lo.uy * pos * Lo.sc + Lo.ny * BS / 2 * Lo.sc, rot: Lo.th }
      : { x: Lo.footX + pos * Lo.sc, y: Lo.gy - BS / 2 * Lo.sc, rot: 0 };

    const offPtr = pointer(s.cv, {
      down(p) {
        const Lo = lay(), b = blockCenter(Lo);
        if (Math.hypot(p.x - Lo.topX, p.y - Lo.topY) < 18) dragging = 'angle';
        else if (Math.hypot(p.x - b.x, p.y - b.y) < BS * Lo.sc * 0.9 + 6) { dragging = 'block'; timing = false; stopMsg = null; }
        move(p);
      },
      move(p) { move(p); },
      up() { if (dragging === 'block') { v = 0; stopped = true; } dragging = null; },
    });
    function move(p) {
      if (!dragging) return;
      const Lo = lay();
      if (dragging === 'angle') { sTh.set(Math.round(clamp(Math.atan2(Lo.gy - p.y, Lo.footX - p.x) / D2R, 0, 60) * 10) / 10); return; }
      if (p.x > Lo.footX + 4) { phase = 'floor'; pos = clamp((p.x - Lo.footX) / Lo.sc, 0, FLOOR - BS / 2); }
      else { phase = 'ramp'; pos = clamp(((p.x - Lo.topX) * Lo.ux + (p.y - Lo.topY) * Lo.uy) / Lo.sc, 0, L); }
      v = 0;
    }

    function step(h) {
      const th = theta * D2R;
      if (phase === 'ramp') {
        const N = mass * G * Math.cos(th), Fd = mass * G * Math.sin(th) - push; // net applied force down the slope
        if (v === 0) {
          grip = mus * N > 1e-9 ? Math.abs(Fd) / (mus * N) : (Math.abs(Fd) > 0.01 ? 2 : 0);
          if (Math.abs(Fd) <= mus * N + 0.01 || (pos <= 0 && Fd < 0)) { fr = -Fd; acc = 0; if (pos <= 0 && Fd < 0) fr = 0; }
          else {
            const dir = Math.sign(Fd); fr = -dir * muk * N; acc = (Fd + fr) / mass; v = acc * h;
            if (stopped && !dragging) { ctx.complete('slide'); if (pos < 0.02) { timing = true; t = 0; } }
            stopped = false; stopMsg = null;
          }
        } else {
          grip = 0;
          fr = -Math.sign(v) * muk * N; acc = (Fd + fr) / mass;
          const nv = v + acc * h;
          if (Math.sign(nv) !== Math.sign(v)) { v = 0; if (!stopped) onStop(); } else v = nv;
        }
        pos += v * h;
        if (pos < 0) { pos = 0; v = 0; stopped = true; }
        if (pos >= L) {
          if (timing) {
            lastBottom = t; timing = false;
            if (lastBottom < 1.5) { ctx.complete('fast'); flash = { txt: `⚡ ${fmt(lastBottom)} s — speed run!`, t: 0, c: C.good }; }
            else flash = { txt: `Bottom in ${fmt(lastBottom)} s`, t: 0, c: C.accent };
          }
          phase = 'floor'; pos = 0;
        }
      } else {
        const N = mass * G; grip = 0;
        if (v !== 0) {
          fr = -Math.sign(v) * muk * N; acc = fr / mass;
          const nv = v + acc * h;
          if (Math.sign(nv) !== Math.sign(v)) { v = 0; onStop(); } else v = nv;
          pos += v * h;
          if (pos >= FLOOR - BS / 2) { pos = FLOOR - BS / 2; v = 0; onStop(true); }
          if (pos < 0) { pos = 0; v = 0; }
        } else { fr = 0; acc = 0; }
      }
      if (timing) t += h;
    }
    function onStop(crash) {
      stopped = true; acc = 0;
      if (phase === 'floor') {
        const hit = !crash && Math.abs(pos - zone) <= 0.4;
        if (crash) { stopMsg = { txt: '💥 Crashed into the wall!', c: C.bad }; ctx.toast('Crashed into the wall — more friction or push back!', 'warn'); }
        else if (hit) { stopMsg = { txt: '🎯 In the zone!', c: C.good }; ctx.complete('zone'); ctx.toast(`🎯 Stopped at ${fmt(pos)} m — right in the zone!`); setTimeout(newZone, 1500); }
        else { stopMsg = { txt: `Stopped at ${fmt(pos)} m (${pos < zone ? 'short' : 'long'} by ${fmt(Math.abs(pos - zone))} m)`, c: C.gold }; }
      } else stopMsg = { txt: 'Friction stopped it on the ramp', c: C.gold };
    }

    const stop = loop((dt) => {
      if (!dragging) { const n = 10; for (let i = 0; i < n; i++) step(dt / n); }
      else { fr = 0; acc = 0; grip = 0; }
      draw(dt);
    });

    function draw(dt) {
      const { g: c, w, h } = s, Lo = lay(), { sc, footX, gy, th } = Lo;
      const gr = c.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#16213a'); gr.addColorStop(1, '#1d2b4a');
      c.fillStyle = gr; c.fillRect(0, 0, w, h);
      // floor + ruler
      c.fillStyle = '#2b3a5e'; c.fillRect(0, gy, w, h - gy);
      c.fillStyle = '#34466f'; c.fillRect(0, gy, w, 3);
      for (let m = 0; m <= FLOOR; m++) {
        const x = footX + m * sc;
        c.fillStyle = C.muted; c.fillRect(x, gy + 3, 1, 8);
        text(c, `${m} m`, x, gy + 24, { color: C.muted, size: 11, align: 'center' });
      }
      // target zone
      const zx = footX + (zone - 0.4) * sc;
      c.fillStyle = 'rgba(91,227,138,.18)'; c.fillRect(zx, gy - 70, 0.8 * sc, 70);
      c.fillStyle = C.good; c.fillRect(zx, gy - 3, 0.8 * sc, 4);
      text(c, `target ${fmt(zone, 1)} m`, zx + 0.4 * sc, gy - 76, { color: C.good, size: 11, weight: 700, align: 'center' });
      // wall
      const wx = footX + FLOOR * sc;
      c.fillStyle = '#5b3440'; c.fillRect(wx, gy - 90, 12, 90);
      for (let y = gy - 90; y < gy; y += 12) { c.strokeStyle = 'rgba(255,255,255,.12)'; c.beginPath(); c.moveTo(wx, y); c.lineTo(wx + 12, y + 12); c.stroke(); }
      // ramp wedge
      c.fillStyle = '#3c5488'; c.beginPath(); c.moveTo(Lo.topX, Lo.topY); c.lineTo(footX, gy); c.lineTo(Lo.topX, gy); c.closePath(); c.fill();
      c.strokeStyle = '#8fb3ff'; c.lineWidth = 3; c.beginPath(); c.moveTo(Lo.topX, Lo.topY); c.lineTo(footX, gy); c.stroke();
      // distance ticks along ramp
      for (let d = 1; d < L; d++) { const x = Lo.topX + Lo.ux * d * sc, y = Lo.topY + Lo.uy * d * sc; c.fillStyle = 'rgba(255,255,255,.35)'; c.beginPath(); c.arc(x, y, 2, 0, Math.PI * 2); c.fill(); }
      // angle arc
      if (theta > 0.5) {
        c.strokeStyle = C.gold; c.lineWidth = 1.5; c.beginPath(); c.arc(footX, gy, 46, Math.PI, Math.PI + th); c.stroke();
        text(c, `θ = ${theta.toFixed(1)}°`, footX - 58 - 10, gy - 12 - Math.sin(th / 2) * 20, { color: C.gold, size: 12, weight: 700, align: 'right' });
      }
      // stopper at top + angle handle
      c.fillStyle = '#8fb3ff'; c.save(); c.translate(Lo.topX, Lo.topY); c.rotate(th); c.fillRect(-6, -BS * sc * 0.5, 6, BS * sc * 0.5); c.restore();
      c.strokeStyle = C.gold; c.lineWidth = 2; c.fillStyle = dragging === 'angle' ? C.gold : 'rgba(255,204,77,.25)';
      c.beginPath(); c.arc(Lo.topX, Lo.topY, 9, 0, Math.PI * 2); c.fill(); c.stroke();

      // block
      const b = blockCenter(Lo), half = BS / 2 * sc;
      c.save(); c.translate(b.x, b.y); c.rotate(b.rot);
      const bg = c.createLinearGradient(0, -half, 0, half); bg.addColorStop(0, '#ffb38a'); bg.addColorStop(1, '#e0703f');
      c.fillStyle = bg; c.fillRect(-half, -half, 2 * half, 2 * half);
      c.strokeStyle = dragging === 'block' ? '#fff' : 'rgba(0,0,0,.35)'; c.lineWidth = 2; c.strokeRect(-half, -half, 2 * half, 2 * half);
      text(c, `${fmt(mass, 1)} kg`, 0, 4, { color: '#2a1206', size: 11, weight: 800, align: 'center' });
      c.restore();

      // in-scene forces (compact) + zoomed free-body diagram panel
      const onRamp = phase === 'ramp', ang = onRamp ? th : 0;
      const ux = Math.cos(ang), uy = Math.sin(ang), nx = Math.sin(ang), ny = -Math.cos(ang);
      const W = mass * G, N = W * Math.cos(ang);
      {
        const k = 55 / W, cx = b.x - nx * half, cy = b.y - ny * half;
        arrow(c, b.x, b.y, b.x, b.y + W * k, C.bad, 2.5);
        arrow(c, cx, cy, cx + nx * N * k, cy + ny * N * k, C.accent, 2.5);
        if (Math.abs(fr) > 0.01) arrow(c, cx, cy, cx + ux * fr * k, cy + uy * fr * k, C.good, 2.5);
        if (onRamp && Math.abs(push) > 0.05) { const px = b.x + ux * half * Math.sign(push), py = b.y + uy * half * Math.sign(push); arrow(c, px + ux * push * k, py + uy * push * k, px, py, C.purple, 2.5); }
      }
      {
        const P = Math.min(300, Math.max(200, (h - 170) * 0.55)), fx = 20, fy = 48, ocx = fx + P / 2, ocy = fy + P / 2 + 6;
        c.fillStyle = 'rgba(14,20,34,.72)'; c.fillRect(fx, fy, P, P); c.strokeStyle = C.grid2; c.lineWidth = 1; c.strokeRect(fx + .5, fy + .5, P, P);
        text(c, 'FREE-BODY DIAGRAM', fx + 10, fy + 18, { color: C.muted, size: 11, weight: 700 });
        const k = (P * 0.36) / Math.max(W, Math.abs(push) + 1e-9, 1e-9);
        // tilted axes
        c.setLineDash([3, 5]); c.strokeStyle = 'rgba(255,255,255,.18)'; c.beginPath();
        c.moveTo(ocx - ux * P * 0.45, ocy - uy * P * 0.45); c.lineTo(ocx + ux * P * 0.45, ocy + uy * P * 0.45);
        c.moveTo(ocx - nx * P * 0.45, ocy - ny * P * 0.45); c.lineTo(ocx + nx * P * 0.45, ocy + ny * P * 0.45); c.stroke(); c.setLineDash([]);
        c.save(); c.translate(ocx, ocy); c.rotate(ang); c.fillStyle = '#e0703f'; c.fillRect(-11, -11, 22, 22); c.restore();
        if (showComp && onRamp && theta > 0.5) {
          const par = W * Math.sin(ang), perp = W * Math.cos(ang), ex = ocx + ux * par * k, ey = ocy + uy * par * k;
          c.setLineDash([2, 3]); c.strokeStyle = 'rgba(255,107,122,.5)'; c.beginPath(); c.moveTo(ex, ey); c.lineTo(ocx, ocy + W * k); c.lineTo(ocx - nx * perp * k, ocy - ny * perp * k); c.stroke(); c.setLineDash([]);
          arrow(c, ocx, ocy, ex, ey, 'rgba(255,140,150,.85)', 2, `mg·sinθ ${fmt(par, 1)}`);
          arrow(c, ocx, ocy, ocx - nx * perp * k, ocy - ny * perp * k, 'rgba(255,140,150,.85)', 2, `mg·cosθ ${fmt(perp, 1)}`);
        }
        arrow(c, ocx, ocy, ocx, ocy + W * k, C.bad, 3, `mg ${fmt(W, 1)} N`);
        arrow(c, ocx, ocy, ocx + nx * N * k, ocy + ny * N * k, C.accent, 3, `N ${fmt(N, 1)} N`);
        if (Math.abs(fr) > 0.01) arrow(c, ocx, ocy, ocx + ux * fr * k, ocy + uy * fr * k, C.good, 3, `f ${fmt(Math.abs(fr), 1)} N`);
        if (onRamp && Math.abs(push) > 0.05) arrow(c, ocx, ocy, ocx - ux * push * k, ocy - uy * push * k, C.purple, 3, `F ${fmt(Math.abs(push), 1)} N`);
        const net = stopped ? 0 : mass * acc;
        text(c, `ΣF along ramp = ${fmt(net, 2)} N`, fx + 10, fy + P - 10, { color: C.ink, size: 11.5, weight: 600 });
      }
      if (Math.abs(v) > 0.02) {
        const vx = b.x + nx * (half + 16), vy = b.y + ny * (half + 16);
        arrow(c, vx, vy, vx + ux * v * 14, vy + uy * v * 14, C.gold, 2.5, `v = ${fmt(Math.abs(v))} m/s`);
      }

      // grip meter (static friction usage)
      const gx = w - 200, gyy = 44;
      c.fillStyle = 'rgba(14,20,34,.75)'; c.fillRect(gx - 10, gyy - 22, 190, 58);
      text(c, 'Static grip used  (F∥ / μs·N)', gx, gyy - 6, { color: C.muted, size: 11 });
      c.fillStyle = C.grid2; c.fillRect(gx, gyy, 170, 12);
      const gv = stopped && onRamp ? clamp(grip, 0, 1) : (onRamp && !stopped ? 1 : 0);
      c.fillStyle = gv < 0.75 ? C.good : gv < 0.98 ? C.gold : C.bad; c.fillRect(gx, gyy, 170 * gv, 12);
      text(c, stopped ? (onRamp ? `${Math.round(clamp(grip, 0, 9.99) * 100)}% — ${grip <= 1 ? 'holding' : 'slipping'}` : 'on the floor') : 'SLIDING (kinetic friction)', gx, gyy + 28, { color: C.ink, size: 11.5, weight: 700 });

      // status banners
      if (stopMsg) text(c, stopMsg.txt, w / 2, 40, { color: stopMsg.c, size: 16, weight: 800, align: 'center' });
      if (flash) { flash.t += dt; text(c, flash.txt, w / 2, 66, { color: flash.c, size: 15, weight: 700, align: 'center' }); if (flash.t > 2.5) flash = null; }
      if (timing) text(c, `⏱ ${fmt(t)} s`, w / 2, 92, { color: C.ink, size: 20, weight: 800, align: 'center' });

      const Wpar = mass * G * Math.sin(th), Nr = mass * G * Math.cos(th);
      const aTheory = G * (Math.sin(th) - muk * Math.cos(th)) - push / mass;
      ctx.readout.set({
        'Weight mg': `${fmt(mass * G, 1)} N`,
        'mg·sinθ (along ramp)': `${fmt(Wpar)} N`,
        'Normal N = mg·cosθ': `${fmt(Nr)} N`,
        'Max static μs·N': `${fmt(mus * Nr)} N`,
        'Friction now': `${fmt(Math.abs(fr))} N ${Math.abs(fr) > 0.01 ? (stopped ? '(static)' : '(kinetic)') : ''}`,
        'Sliding a = g(sinθ−μk·cosθ)−F/m': `${fmt(aTheory)} m/s²`,
        'Acceleration now': `${fmt(stopped ? 0 : acc)} m/s²`,
        'Velocity': `${fmt(Math.abs(v))} m/s`,
        'Position': phase === 'ramp' ? `${fmt(pos)} m down ramp` : `${fmt(pos)} m on floor`,
        'Time': timing ? `${fmt(t)} s` : '—',
        'Last time to bottom': lastBottom != null ? `${fmt(lastBottom)} s` : '—',
      });
    }

    return { destroy() { stop(); offPtr(); removeEventListener('keydown', onKey); s.destroy(); } };
  },
};
