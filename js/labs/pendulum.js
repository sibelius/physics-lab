import { makeCanvas, loop, slider, select, buttons, arrow, text, hint, pointer, fmt, clamp, C } from '../ui.js';

const PLANETS = { earth: ['Earth', 9.81], moon: ['Moon', 1.62], mars: ['Mars', 3.71], jupiter: ['Jupiter', 24.79], mystery: ['Mystery planet ❓', 6.2] };
const D2R = Math.PI / 180;

export default {
  title: 'Pendulum Clock',
  icon: '🕰️',
  blurb: 'Swing a pendulum on different planets, time its period and uncover the hidden gravity of a mystery world.',
  theory: `
    <p>The bob feels gravity and the string tension. Along the arc, the restoring force is −m·g·sinθ, giving the full (nonlinear) equation of motion:</p>
    <div class="eq">θ'' = −(g/L)·sinθ − γ·θ'</div>
    <p>For small swings sinθ ≈ θ, so the motion is simple harmonic with period</p>
    <div class="eq">T = 2π·√(L / g)</div>
    <p>The mass cancels out: heavy and light bobs swing together. Rearranging lets you <b>measure gravity</b>: g = 4π²·L / T².</p>
    <p>For big amplitudes the period grows: T ≈ T₀·(1 + θ₀²/16 + …) (θ₀ in radians). Energy sloshes between kinetic ½mv² and potential m·g·L(1 − cosθ).</p>`,
  challenges: [
    { id: 'sec', text: 'Build a “seconds pendulum”: measured period 2.00 ± 0.05 s on Earth (let it swing ≥ 3 times)', xp: 30 },
    { id: 'mass', text: 'Time it with m = 0.1 kg, then with m = 5 kg. What is T(5 kg) / T(0.1 kg)?', xp: 20, check: v => Math.abs(v - 1) < 0.03, placeholder: 'ratio' },
    { id: 'big', text: 'Release from more than 60° and measure a period at least 5% longer than 2π√(L/g)', xp: 30 },
    { id: 'moon', text: 'Predict: a 1.00 m pendulum on the Moon (g = 1.62 m/s²). Period? (s)', xp: 30, check: v => Math.abs(v - 4.937) < 0.08, placeholder: 'seconds' },
    { id: 'mystery', text: 'Detective work: measure g on the Mystery planet (m/s²)', xp: 45, check: v => Math.abs(v - 6.2) < 0.25, placeholder: 'm/s²' },
  ],
  mount(ctx) {
    const s = makeCanvas(ctx.stage);
    hint(ctx.stage, 'Drag the bob sideways and let go · the stopwatch counts swings automatically · Space = release from 10°');
    let len = 1.5, mass = 1, planet = 'earth', gamma = 0;
    slider(ctx.controls, { label: 'Length L', min: 0.1, max: 3, step: 0.001, value: len, unit: 'm', fmt: v => v.toFixed(3), onInput: v => { len = v; resetWatch(); } });
    slider(ctx.controls, { label: 'Bob mass m', min: 0.1, max: 5, step: 0.1, value: mass, unit: 'kg', fmt: v => v.toFixed(1), onInput: v => (mass = v) });
    select(ctx.controls, { label: 'Planet', value: planet, options: Object.entries(PLANETS).map(([k, [n, g]]) => [k, k === 'mystery' ? n : `${n} (g = ${g} m/s²)`]), onChange: v => { planet = v; resetWatch(); } });
    slider(ctx.controls, { label: 'Damping γ (air friction)', min: 0, max: 0.5, step: 0.01, value: gamma, unit: '1/s', fmt: v => v.toFixed(2), onInput: v => (gamma = v) });
    buttons(ctx.controls, [
      { label: '▶ Release from 10°', primary: true, onClick: () => release(10) },
      { label: 'Release from 70°', onClick: () => release(70) },
      { label: '■ Stop', onClick: () => { th = 0; om = 0; resetWatch(); } },
      { label: '⏱ Reset stopwatch', onClick: resetWatch },
    ]);

    let th = 0, om = 0, dragging = false, amp0 = 0, time = 0, trail = [];
    // stopwatch: counts upward zero-crossings of θ (one per full period)
    let firstCross = null, lastCross = null, n = 0, lastPeriod = null, maxAmp = 0, prevTh = 0;
    function resetWatch() { firstCross = lastCross = null; n = 0; lastPeriod = null; maxAmp = Math.abs(th); }
    function release(deg) { th = deg * D2R; om = 0; amp0 = deg; resetWatch(); }
    release(12);

    const g = () => PLANETS[planet][1];
    const hidden = () => planet === 'mystery';
    const T0 = () => 2 * Math.PI * Math.sqrt(len / g());

    const onKey = (e) => { if (e.code === 'Space' && document.activeElement.tagName !== 'INPUT') { e.preventDefault(); release(10); } };
    addEventListener('keydown', onKey);

    const lay = () => {
      const px = s.w * 0.42, py = 58;
      const sc = Math.min((s.h - py - 60) / len, (s.w * 0.42 - 40) / len);
      return { px, py, sc };
    };
    const bobPos = (Lo) => ({ x: Lo.px + Math.sin(th) * len * Lo.sc, y: Lo.py + Math.cos(th) * len * Lo.sc });
    const bobR = () => 10 + 6 * Math.cbrt(mass);

    const offPtr = pointer(s.cv, {
      down(p) { const Lo = lay(), b = bobPos(Lo); if (Math.hypot(p.x - b.x, p.y - b.y) < bobR() + 14) { dragging = true; drag(p); } },
      move(p) { if (dragging) drag(p); },
      up() { if (dragging) { dragging = false; om = 0; amp0 = Math.abs(th) / D2R; resetWatch(); } },
    });
    function drag(p) { const Lo = lay(); th = clamp(Math.atan2(p.x - Lo.px, p.y - Lo.py), -170 * D2R, 170 * D2R); om = 0; }

    const f = (a, w) => [w, -(g() / len) * Math.sin(a) - gamma * w];
    function rk4(h) {
      const [k1a, k1w] = f(th, om), [k2a, k2w] = f(th + k1a * h / 2, om + k1w * h / 2);
      const [k3a, k3w] = f(th + k2a * h / 2, om + k2w * h / 2), [k4a, k4w] = f(th + k3a * h, om + k3w * h);
      th += (k1a + 2 * k2a + 2 * k3a + k4a) * h / 6; om += (k1w + 2 * k2w + 2 * k3w + k4w) * h / 6;
    }

    const stop = loop((dt) => {
      if (!dragging) {
        const sub = 20, h = dt / sub;
        for (let i = 0; i < sub; i++) {
          prevTh = th; rk4(h); time += h;
          maxAmp = Math.max(maxAmp, Math.abs(th));
          if (prevTh < 0 && th >= 0 && om > 0 && maxAmp > 0.3 * D2R) {
            const tc = time - h * th / (th - prevTh); // interpolate crossing time
            if (firstCross == null) firstCross = tc;
            else { n++; lastPeriod = tc - lastCross; }
            lastCross = tc;
            if (n > 0) checkGoals();
          }
        }
      }
      const b = bobPos(lay());
      trail.push([b.x, b.y]); if (trail.length > 40) trail.shift();
      draw();
    });
    const measured = () => (n > 0 ? (lastCross - firstCross) / n : null);

    function checkGoals() {
      const Tm = measured();
      if (planet === 'earth' && n >= 3 && Math.abs(Tm - 2) <= 0.05) { if (!ctx.isDone('sec')) ctx.toast('🕰️ Tick-tock! A perfect seconds pendulum'); ctx.complete('sec'); }
      if (amp0 > 60 && n >= 1 && Tm / T0() >= 1.05) { if (!ctx.isDone('big')) ctx.toast(`Big swing: ${fmt((Tm / T0() - 1) * 100, 1)}% slower than the small-angle formula!`, 'info'); ctx.complete('big'); }
    }

    function draw() {
      const { g: c, w, h } = s, Lo = lay(), { px, py, sc } = Lo, b = bobPos(Lo), G = g(), R = bobR();
      const skies = { earth: ['#1b2c52', '#2d4c7c'], moon: ['#07080d', '#1a1c25'], mars: ['#3a1a14', '#6b3322'], jupiter: ['#2a1d10', '#5a3d1e'], mystery: ['#1d1233', '#3b2463'] };
      const gr = c.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, skies[planet][0]); gr.addColorStop(1, skies[planet][1]);
      c.fillStyle = gr; c.fillRect(0, 0, w, h);
      if (planet === 'moon' || planet === 'mystery') { c.fillStyle = 'rgba(255,255,255,.7)'; for (let i = 0; i < 50; i++) c.fillRect((i * 137) % w, (i * 71) % h, 1.5, 1.5); }
      // ceiling
      c.fillStyle = '#50607e'; c.fillRect(px - 90, py - 14, 180, 10);
      c.strokeStyle = 'rgba(255,255,255,.18)'; c.lineWidth = 1;
      for (let x = px - 90; x < px + 90; x += 10) { c.beginPath(); c.moveTo(x, py - 14); c.lineTo(x + 8, py - 24); c.stroke(); }
      // vertical reference + amplitude arc
      c.setLineDash([4, 6]); c.strokeStyle = 'rgba(255,255,255,.2)'; c.beginPath(); c.moveTo(px, py); c.lineTo(px, py + len * sc + R + 10); c.stroke(); c.setLineDash([]);
      if (maxAmp > 0.01) {
        c.strokeStyle = 'rgba(255,204,77,.25)'; c.lineWidth = 2; c.beginPath();
        c.arc(px, py, len * sc, Math.PI / 2 - maxAmp, Math.PI / 2 + maxAmp); c.stroke();
      }
      // angle arc
      if (Math.abs(th) > 0.02) {
        c.strokeStyle = C.gold; c.lineWidth = 1.5; c.beginPath();
        const a0 = Math.PI / 2, a1 = Math.PI / 2 - th; c.arc(px, py, 38, Math.min(a0, a1), Math.max(a0, a1)); c.stroke();
        text(c, `${fmt(th / D2R, 1)}°`, px + (th > 0 ? 10 : -10), py + 58, { color: C.gold, size: 12, weight: 700, align: th > 0 ? 'left' : 'right' });
      }
      // length ruler ticks along the string (every 10 cm)
      c.strokeStyle = '#c9d1e3'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(px, py); c.lineTo(b.x, b.y); c.stroke();
      const stepM = len > 1.5 ? 0.5 : 0.1;
      for (let d = stepM; d < len - 1e-6; d += stepM) {
        const x = px + Math.sin(th) * d * sc, y = py + Math.cos(th) * d * sc;
        c.fillStyle = 'rgba(255,255,255,.45)'; c.beginPath(); c.arc(x, y, 1.8, 0, Math.PI * 2); c.fill();
      }
      c.fillStyle = '#c9d1e3'; c.beginPath(); c.arc(px, py, 5, 0, Math.PI * 2); c.fill();
      // trail
      trail.forEach(([x, y], i) => { c.fillStyle = `rgba(90,209,255,${(i / trail.length) * 0.35})`; c.beginPath(); c.arc(x, y, R * 0.5 * (i / trail.length), 0, Math.PI * 2); c.fill(); });
      // forces & velocity
      const v = om * len, k = 55 / (mass * G), tension = mass * G * Math.cos(th) + mass * len * om * om;
      arrow(c, b.x, b.y, b.x, b.y + mass * G * k, C.bad, 2.5, 'mg');
      arrow(c, b.x, b.y, b.x - Math.sin(th) * tension * k, b.y - Math.cos(th) * tension * k, C.purple, 2.5, 'T');
      if (Math.abs(v) > 0.02) arrow(c, b.x, b.y, b.x + Math.cos(th) * v * 28, b.y - Math.sin(th) * v * 28, C.good, 2.5, 'v');
      // bob
      const bg = c.createRadialGradient(b.x - R * 0.35, b.y - R * 0.35, 2, b.x, b.y, R);
      bg.addColorStop(0, '#fff3c4'); bg.addColorStop(1, '#d9a21b');
      c.fillStyle = bg; c.beginPath(); c.arc(b.x, b.y, R, 0, Math.PI * 2); c.fill();
      c.strokeStyle = dragging ? '#fff' : 'rgba(0,0,0,.3)'; c.lineWidth = 2; c.stroke();
      text(c, `${fmt(mass, 1)} kg`, b.x, b.y + R + 16, { color: C.ink, size: 11, weight: 700, align: 'center' });
      text(c, `L = ${len.toFixed(3)} m`, px + 96, py - 2, { color: C.muted, size: 12 });

      // stopwatch panel
      const Tm = measured(), T0v = T0();
      const bx = w - 230, by = 16;
      c.fillStyle = 'rgba(14,20,34,.8)'; c.fillRect(bx, by, 214, 132); c.strokeStyle = C.grid2; c.strokeRect(bx + .5, by + .5, 214, 132);
      text(c, '⏱ STOPWATCH', bx + 12, by + 20, { color: C.muted, size: 11, weight: 700 });
      const running = firstCross != null ? time - firstCross : 0;
      text(c, `${fmt(running, 2)} s`, bx + 12, by + 52, { color: C.ink, size: 26, weight: 800 });
      text(c, `swings counted: ${n}`, bx + 12, by + 74, { color: C.ink, size: 12.5 });
      text(c, `measured T: ${Tm ? fmt(Tm, 3) + ' s' : '—'}`, bx + 12, by + 94, { color: C.gold, size: 12.5, weight: 700 });
      text(c, `2π√(L/g): ${hidden() ? '???' : fmt(T0v, 3) + ' s'}`, bx + 12, by + 114, { color: C.accent, size: 12.5, weight: 700 });

      // energy bars
      const KE = 0.5 * mass * v * v, PE = mass * G * len * (1 - Math.cos(th)), E = KE + PE;
      const ex = w - 150, ey = by + 160, eh = Math.min(200, h - ey - 50);
      const Emax = Math.max(E, 1e-6);
      text(c, 'ENERGY', ex, ey, { color: C.muted, size: 11, weight: 700 });
      [['KE', KE, C.good], ['PE', PE, C.accent], ['Total', E, C.gold]].forEach(([lab, val, col], i) => {
        const x = ex + i * 44, hh = (val / Emax) * eh;
        c.fillStyle = C.grid2; c.fillRect(x, ey + 10, 30, eh);
        c.fillStyle = col; c.fillRect(x, ey + 10 + eh - hh, 30, hh);
        text(c, lab, x + 15, ey + eh + 26, { color: C.ink, size: 11, weight: 600, align: 'center' });
        text(c, `${fmt(val, 2)} J`, x + 15, ey + eh + 40, { color: C.muted, size: 10, align: 'center' });
      });

      ctx.readout.set({
        'Gravity g': hidden() ? '??? m/s²' : `${G} m/s²`,
        'Angle θ': `${fmt(th / D2R, 1)}°`,
        'Release amplitude': `${fmt(amp0, 1)}°`,
        'Speed': `${fmt(Math.abs(v))} m/s`,
        'Tension': `${fmt(tension)} N`,
        'Swings counted': `${n}`,
        'Last single period': lastPeriod ? `${fmt(lastPeriod, 3)} s` : '—',
        'Average measured T': Tm ? `${fmt(Tm, 3)} s` : '—',
        'Theory T = 2π√(L/g)': hidden() ? '???' : `${fmt(T0v, 3)} s`,
        'Measured / theory': Tm && !hidden() ? `${fmt(Tm / T0v, 3)}×` : '—',
        'KE / PE': `${fmt(KE)} / ${fmt(PE)} J`,
      });
    }

    return { destroy() { stop(); offPtr(); removeEventListener('keydown', onKey); s.destroy(); } };
  },
};
