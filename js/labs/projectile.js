import { makeCanvas, loop, slider, select, buttons, checkbox, arrow, text, hint, fmt, C } from '../ui.js';

const PLANETS = { earth: ['Earth', 9.81], moon: ['Moon', 1.62], mars: ['Mars', 3.71], jupiter: ['Jupiter', 24.79] };

export default {
  title: 'Projectile Launcher',
  icon: '🎯',
  blurb: 'Fire a cannon on Earth, the Moon or Jupiter. Tune angle and speed to hit targets.',
  theory: `
    <p>Once launched, the only force is gravity (plus drag if you turn on air). Horizontal and vertical motion are independent:</p>
    <div class="eq">x(t) = v₀·cosθ·t</div>
    <div class="eq">y(t) = v₀·sinθ·t − ½·g·t²</div>
    <p>On flat ground the range is</p>
    <div class="eq">R = v₀²·sin(2θ) / g</div>
    <p>sin(2θ) is largest when 2θ = 90°. Complementary angles (30° and 60°) land in the same spot. With air drag the best angle drops below that.</p>`,
  challenges: [
    { id: 'hit', text: 'Hit the target 🎯', xp: 20 },
    { id: 'streak', text: 'Hit 3 targets in a row without missing', xp: 40 },
    { id: 'moon', text: 'Hit a target on the Moon', xp: 25 },
    { id: 'jupiter', text: 'Hit a target on Jupiter', xp: 25 },
    { id: 'best', text: 'With no air: which launch angle gives the <b>longest range</b>? (degrees)', xp: 30, check: v => Math.abs(v - 45) < 0.6, placeholder: 'degrees' },
    { id: 'predict', text: 'Predict: on Earth, v₀ = 20 m/s at 30°, no air. How far does it land? (m)', xp: 40, check: v => Math.abs(v - 35.3) < 0.8, placeholder: 'meters' },
  ],
  mount(ctx) {
    const s = makeCanvas(ctx.stage);
    hint(ctx.stage, 'Space or “Fire!” to launch · drag the cannon mouth to aim');
    let angle = 45, speed = 22, planet = 'earth', air = false;
    const sa = slider(ctx.controls, { label: 'Launch angle θ', min: 5, max: 85, step: 1, value: angle, unit: '°', onInput: v => (angle = v) });
    const sv = slider(ctx.controls, { label: 'Launch speed v₀', min: 5, max: 60, step: 0.5, value: speed, unit: 'm/s', onInput: v => (speed = v) });
    select(ctx.controls, { label: 'Planet', value: planet, options: Object.entries(PLANETS).map(([k, [n, g]]) => [k, `${n} (g = ${g} m/s²)`]), onChange: v => { planet = v; newTarget(); } });
    checkbox(ctx.controls, { label: 'Air resistance (drag)', value: air, onChange: v => (air = v) });
    buttons(ctx.controls, [{ label: '🔥 Fire!', primary: true, onClick: fire }, { label: 'New target', onClick: newTarget }, { label: 'Clear trails', onClick: () => (trails.length = 0) }]);

    let ball = null, trails = [], target = 0, streak = 0, view = 60, boom = null;
    const g = () => PLANETS[planet][1];
    function newTarget() {
      const maxR = (45 ** 2) / g();
      target = Math.round(Math.max(8, Math.min(maxR * 0.9, 12 + Math.random() * maxR * 0.7)));
      view = Math.max(40, target * 1.35);
    }
    newTarget();

    function fire() {
      const th = angle * Math.PI / 180;
      ball = { x: 0, y: 0.8, vx: speed * Math.cos(th), vy: speed * Math.sin(th), t: 0, maxY: 0.8, path: [] };
    }
    const onKey = (e) => { if (e.code === 'Space' && document.activeElement.tagName !== 'INPUT') { e.preventDefault(); fire(); } };
    addEventListener('keydown', onKey);

    // drag to aim
    let aiming = false;
    const toWorld = (p) => ({ x: (p.x - ox()) / scale(), y: (oy() - p.y) / scale() });
    const ox = () => 50, oy = () => s.h - 50, scale = () => Math.min((s.w - 90) / view, (s.h - 90) / (view * 0.55));
    s.cv.addEventListener('pointerdown', (e) => { aiming = true; aim(e); });
    s.cv.addEventListener('pointermove', (e) => aiming && aim(e));
    addEventListener('pointerup', () => (aiming = false));
    function aim(e) {
      const r = s.cv.getBoundingClientRect(), w = toWorld({ x: e.clientX - r.left, y: e.clientY - r.top });
      const a = Math.atan2(w.y - 0.8, w.x) * 180 / Math.PI;
      sa.set(Math.round(Math.max(5, Math.min(85, a))));
    }

    const stop = loop((dt) => {
      const G = g();
      if (ball) {
        const sub = 8;
        for (let i = 0; i < sub; i++) {
          const h = dt / sub;
          let ax = 0, ay = -G;
          if (air) { const v = Math.hypot(ball.vx, ball.vy), k = 0.012; ax -= k * v * ball.vx; ay -= k * v * ball.vy; }
          ball.vx += ax * h; ball.vy += ay * h; ball.x += ball.vx * h; ball.y += ball.vy * h; ball.t += h;
          ball.maxY = Math.max(ball.maxY, ball.y);
          if (ball.y <= 0) { ball.y = 0; land(); break; }
        }
        if (ball) { ball.path.push([ball.x, ball.y]); view = Math.max(view, ball.x * 1.1, ball.maxY * 2); }
      }
      draw();
    });

    function land() {
      const hit = Math.abs(ball.x - target) < 1.6;
      trails.push({ path: ball.path, hit }); if (trails.length > 6) trails.shift();
      last = { range: ball.x, time: ball.t, maxY: ball.maxY - 0.8 };
      boom = { x: ball.x, t: 0, hit };
      if (hit) {
        streak++;
        ctx.complete('hit');
        if (streak >= 3) ctx.complete('streak');
        if (planet === 'moon') ctx.complete('moon');
        if (planet === 'jupiter') ctx.complete('jupiter');
        ctx.toast(`💥 Direct hit! Streak: ${streak}`);
        setTimeout(newTarget, 900);
      } else { streak = 0; ctx.toast(`Missed by ${fmt(Math.abs(ball.x - target), 1)} m`, 'info'); }
      ball = null;
    }
    let last = null;

    function draw() {
      const { g: c, w, h } = s, sc = scale(), X = (x) => ox() + x * sc, Y = (y) => oy() - y * sc;
      // sky gradient per planet
      const skies = { earth: ['#1b2c52', '#2d4c7c'], moon: ['#07080d', '#15171f'], mars: ['#3a1a14', '#6b3322'], jupiter: ['#2a1d10', '#5a3d1e'] };
      const gr = c.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, skies[planet][0]); gr.addColorStop(1, skies[planet][1]);
      c.fillStyle = gr; c.fillRect(0, 0, w, h);
      if (planet === 'moon') { c.fillStyle = '#fff'; for (let i = 0; i < 60; i++) c.fillRect((i * 137) % w, (i * 71) % (h * 0.7), 1.5, 1.5); }
      // grid in meters
      const step = niceStep(view / 8);
      c.strokeStyle = 'rgba(255,255,255,.07)'; c.lineWidth = 1; c.beginPath();
      for (let x = 0; X(x) < w; x += step) { c.moveTo(X(x), 0); c.lineTo(X(x), Y(0)); }
      for (let y = 0; Y(y) > 0; y += step) { c.moveTo(ox(), Y(y)); c.lineTo(w, Y(y)); }
      c.stroke();
      for (let x = 0; X(x) < w; x += step) text(c, `${x} m`, X(x), Y(0) + 18, { color: C.muted, size: 11, align: 'center' });
      // ground
      const ground = { earth: '#2f6b3a', moon: '#8b8d96', mars: '#a2512f', jupiter: '#b07c45' }[planet];
      c.fillStyle = ground; c.fillRect(0, Y(0), w, h - Y(0));
      // target
      c.fillStyle = C.bad; c.fillRect(X(target) - 1.6 * sc, Y(0) - 6, 3.2 * sc, 6);
      c.fillStyle = '#fff'; c.fillRect(X(target) - 1.5, Y(0) - 34, 3, 34);
      c.fillStyle = C.bad; c.beginPath(); c.moveTo(X(target) + 1.5, Y(0) - 34); c.lineTo(X(target) + 22, Y(0) - 27); c.lineTo(X(target) + 1.5, Y(0) - 20); c.fill();
      text(c, `${target} m`, X(target), Y(0) - 40, { color: C.ink, size: 12, weight: 700, align: 'center' });
      // trails
      for (const t of trails) {
        c.strokeStyle = t.hit ? 'rgba(91,227,138,.55)' : 'rgba(255,255,255,.28)'; c.setLineDash([4, 5]); c.lineWidth = 2; c.beginPath();
        t.path.forEach(([x, y], i) => (i ? c.lineTo(X(x), Y(y)) : c.moveTo(X(x), Y(y)))); c.stroke(); c.setLineDash([]);
      }
      // predicted path preview (no air), faint
      const th = angle * Math.PI / 180, G = g();
      c.strokeStyle = 'rgba(255,204,77,.22)'; c.lineWidth = 1.5; c.beginPath();
      for (let t = 0; t < 60; t += 0.02) { const x = speed * Math.cos(th) * t, y = 0.8 + speed * Math.sin(th) * t - 0.5 * G * t * t; if (y < 0) break; if (t > 0.35 * (speed / G)) break; t ? c.lineTo(X(x), Y(y)) : c.moveTo(X(x), Y(y)); }
      c.stroke();
      // cannon
      c.save(); c.translate(X(0), Y(0.8)); c.rotate(-th);
      c.fillStyle = '#c9d1e3'; c.fillRect(0, -7, 42, 14); c.fillStyle = '#7b879f'; c.fillRect(34, -9, 10, 18); c.restore();
      c.fillStyle = '#50607e'; c.beginPath(); c.arc(X(0), Y(0.8), 13, 0, Math.PI * 2); c.fill();
      // ball + vectors
      if (ball) {
        c.strokeStyle = C.gold; c.lineWidth = 2.5; c.beginPath(); ball.path.forEach(([x, y], i) => (i ? c.lineTo(X(x), Y(y)) : c.moveTo(X(x), Y(y)))); c.stroke();
        const bx = X(ball.x), by = Y(ball.y);
        const vs = 2.2;
        arrow(c, bx, by, bx + ball.vx * vs, by, C.accent, 2, 'vₓ');
        arrow(c, bx, by, bx, by - ball.vy * vs, C.good, 2, 'vᵧ');
        arrow(c, bx, by, bx, by + G * vs * 1.2, C.bad, 2, 'g');
        c.fillStyle = '#fff'; c.beginPath(); c.arc(bx, by, 6, 0, Math.PI * 2); c.fill();
      }
      if (boom) {
        boom.t += 1 / 60; const r = boom.t * 120;
        c.strokeStyle = boom.hit ? `rgba(91,227,138,${1 - boom.t})` : `rgba(255,255,255,${0.6 - boom.t})`; c.lineWidth = 3;
        c.beginPath(); c.arc(X(boom.x), Y(0), r, Math.PI, 0); c.stroke(); if (boom.t > 1) boom = null;
      }
      const v = ball ? Math.hypot(ball.vx, ball.vy) : 0;
      ctx.readout.set({
        'Gravity g': `${G} m/s²`,
        'vₓ = v₀·cosθ': `${fmt(speed * Math.cos(th))} m/s`,
        'vᵧ₀ = v₀·sinθ': `${fmt(speed * Math.sin(th))} m/s`,
        'Speed now': ball ? `${fmt(v)} m/s` : '—',
        'Height now': ball ? `${fmt(ball.y - 0.8)} m` : '—',
        'Last range': last ? `${fmt(last.range)} m` : '—',
        'Last flight time': last ? `${fmt(last.time)} s` : '—',
        'Last max height': last ? `${fmt(last.maxY)} m` : '—',
        'Streak': `${streak} 🔥`,
      });
    }
    return { destroy() { stop(); removeEventListener('keydown', onKey); s.destroy(); } };
  },
};

function niceStep(x) { const p = 10 ** Math.floor(Math.log10(x)), n = x / p; return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * p; }
