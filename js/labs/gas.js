import { makeCanvas, loop, slider, buttons, pointer, text, hint, fmt, clamp, C } from '../ui.js';

// --- units ---------------------------------------------------------------
// Simulation: 2D box 100 units wide, particle mass 1, k = 1, so the mean KE per
// particle is ½m⟨v²⟩ = T_sim and the (2D) ideal-gas law reads P·A = N·T_sim.
// Display: each dot stands for D real molecules so the numbers look like a lab
// bottle (≈100 kPa at 300 K in 2 L with 100 dots). P·V = N·D·k_B·T holds exactly.
const KB = 1.380649e-23, M_N2 = 4.65e-26;
const W = 100, HMIN = 20, HMAX = 100;
const TS = 20;                                    // T_sim per kelvin
const VSCALE = 0.002 / (W * HMAX);                // m³ per unit²  (full box = 2.0 L)
const D = 1e5 * 0.002 / (100 * KB * 300);         // molecules per dot
const PSCALE = D * KB / TS / VSCALE;              // Pa per sim-pressure unit
const VREAL = Math.sqrt(KB / M_N2 / TS);          // m/s per sim speed unit (N₂)
const SIG = 0.5;                                  // collision diameter (small → nearly ideal)
const NB = 30, VMAX = 1500;
const SETTLE = 4.5;                               // s to let the averaged pressure settle                       // histogram bins, m/s range

const gauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());

export default {
  title: 'Ideal Gas Box',
  icon: '🎈',
  blurb: 'Squeeze a piston, heat the gas and watch pressure emerge from billions of tiny collisions.',
  theory: `
    <p>Gas pressure is the average force per area from molecules bouncing off the walls. Each bounce delivers an impulse 2m·v⊥; add them all up over time and area:</p>
    <div class="eq">P = Σ(2m·v⊥) / (Δt · A)</div>
    <p>Temperature measures the average kinetic energy of the molecules. Together these give the <b>ideal-gas law</b>:</p>
    <div class="eq">P·V = N·k_B·T</div>
    <p>So P·V/(N·T) stays constant. Hold T fixed and halve V → P doubles (<b>Boyle</b>). Hold V fixed and double T → P doubles (<b>Gay-Lussac</b>). Combined:</p>
    <div class="eq">P₁V₁/T₁ = P₂V₂/T₂</div>
    <p>Molecular speeds follow the <b>Maxwell–Boltzmann</b> distribution; hotter gas shifts it to higher speeds. T must be in kelvin. Each dot here represents ≈4.8×10²⁰ N₂ molecules; the heater keeps the walls at the set temperature.</p>`,
  challenges: [
    { id: 'boyle', text: 'Boyle’s law: at constant T, <b>halve the volume</b> and see the pressure double', xp: 30 },
    { id: 'gay', text: 'Gay-Lussac: at constant V, <b>double the temperature</b> (K) and see P double', xp: 30 },
    { id: 'avo', text: '<b>Double the number of particles</b> at constant V and T — what happens to P?', xp: 20 },
    { id: 'target', text: 'Hit the <b>target pressure</b> (gold mark on the gauge) within 5% and hold it', xp: 35 },
    { id: 'predict', text: 'Predict: 100 kPa, 2.0 L, 300 K → squeezed to 0.8 L and heated to 450 K. New pressure? (kPa)', xp: 45, check: v => Math.abs(v - 375) < 4, placeholder: 'kPa' },
  ],
  mount(ctx) {
    const s = makeCanvas(ctx.stage);
    hint(ctx.stage, 'Drag the piston lid up/down to change volume · heater & particle sliders on the right');
    let Tset = 300, Hbox = HMAX, Htarget = HMAX, parts = [];
    let pEMA = 0, impulse = 0, lastChange = -99, now = 0, ref = null, target = 0, holdT = 0;
    const hist = new Float64Array(NB);

    const sT = slider(ctx.controls, { label: '🔥 Heater (wall temperature)', min: 50, max: 1000, step: 10, value: Tset, unit: 'K', onInput: v => { changed(); Tset = v; } });
    const sN = slider(ctx.controls, { label: 'Particles N', min: 20, max: 300, step: 10, value: 100, onInput: v => { changed(); setN(v); } });
    buttons(ctx.controls, [
      { label: '📌 Mark state', primary: true, onClick: () => mark(true) },
      { label: '🎯 New target', onClick: newTarget },
      { label: 'Reset', onClick: () => { sT.set(300); sN.set(100); Htarget = HMAX; ref = null; lastChange = now; } },
    ]);

    function spawn() { const sd = Math.sqrt(Tset * TS); return { x: SIG + Math.random() * (W - 2 * SIG), y: SIG + Math.random() * (Hbox - 2 * SIG), vx: sd * gauss(), vy: sd * gauss() }; }
    function setN(n) { while (parts.length < n) parts.push(spawn()); while (parts.length > n) parts.splice((Math.random() * parts.length) | 0, 1); }
    setN(100);
    const Tnow = () => { let k = 0; for (const p of parts) k += p.vx * p.vx + p.vy * p.vy; return 0.5 * k / parts.length / TS; };
    const Vnow = () => W * Hbox * VSCALE * 1000; // litres
    const Pideal = () => parts.length * D * KB * Tnow() / (Vnow() / 1000) / 1000; // kPa
    pEMA = Pideal();

    function state() { return { P: pEMA, V: Vnow(), T: Tnow(), N: parts.length }; }
    function mark(manual) { ref = state(); if (manual) ctx.toast(`📌 Marked: ${fmt(ref.P, 0)} kPa, ${fmt(ref.V, 2)} L, ${fmt(ref.T, 0)} K`, 'info'); }
    // auto-mark the settled state right before the player changes something
    function changed() { if (now - lastChange > SETTLE) mark(false); lastChange = now; }
    function newTarget() { const P = pEMA; do target = Math.round(40 + Math.random() * 360); while (Math.abs(target - P) / P < 0.25); holdT = 0; }
    newTarget();

    // --- layout & piston drag ---
    const lay = () => {
      const avail = s.h - 70, sc = Math.min((s.w * 0.56 - 40) / W, avail / HMAX), bx = 30, by = s.h - 30;
      return { sc, bx, by, rx: bx + W * sc + 30 };
    };
    let dragging = false, dragOff = 0;
    const offP = pointer(s.cv, {
      down(p) {
        const { sc, bx, by } = lay(), ly = by - Hbox * sc;
        if (p.x > bx - 10 && p.x < bx + W * sc + 10 && Math.abs(p.y - ly) < 22) { dragging = true; dragOff = p.y - ly; changed(); }
        else if (p.x > bx && p.x < bx + W * sc && p.y < ly) { dragging = true; dragOff = 0; changed(); Htarget = clamp(Math.round((by - p.y) / sc), HMIN, HMAX); }
      },
      move(p) {
        const { sc, bx, by } = lay(), ly = by - Hbox * sc;
        if (dragging) { Htarget = clamp(Math.round((by - p.y + dragOff) / sc), HMIN, HMAX); lastChange = now; }
        else s.cv.style.cursor = p.x > bx - 10 && p.x < bx + W * sc + 10 && Math.abs(p.y - ly) < 22 ? 'ns-resize' : 'default';
      },
      up() { dragging = false; },
    });

    function physics(dt) {
      const sub = 6, h = dt / sub;
      for (let k = 0; k < sub; k++) {
        const Hold = Hbox, dH = clamp(Htarget - Hbox, -120 * h, 120 * h); Hbox += dH;
        const u = (Hbox - Hold) / h; // piston velocity
        for (const p of parts) {
          p.x += p.vx * h; p.y += p.vy * h;
          if (p.x < 0) { p.x = -p.x; impulse += 2 * Math.abs(p.vx); p.vx = Math.abs(p.vx); }
          else if (p.x > W) { p.x = 2 * W - p.x; impulse += 2 * Math.abs(p.vx); p.vx = -Math.abs(p.vx); }
          if (p.y < 0) { p.y = -p.y; impulse += 2 * Math.abs(p.vy); p.vy = Math.abs(p.vy); }
          else if (p.y > Hbox) { // moving piston: reflect in the piston frame
            p.y = Math.max(0, 2 * Hbox - p.y);
            if (p.vy > u) { const nv = 2 * u - p.vy; impulse += Math.abs(p.vy - nv); p.vy = nv; }
          }
        }
        // hard-disk collisions (equal masses, elastic) → drives the Maxwell–Boltzmann distribution
        const n = parts.length, s2 = SIG * SIG;
        for (let i = 0; i < n; i++) {
          const a = parts[i];
          for (let j = i + 1; j < n; j++) {
            const b = parts[j], dx = b.x - a.x; if (dx > SIG || dx < -SIG) continue;
            const dy = b.y - a.y; if (dy > SIG || dy < -SIG) continue;
            const d2 = dx * dx + dy * dy; if (d2 > s2 || d2 === 0) continue;
            const dvx = b.vx - a.vx, dvy = b.vy - a.vy, dot = dvx * dx + dvy * dy;
            if (dot >= 0) continue;
            const f = dot / d2; a.vx += f * dx; a.vy += f * dy; b.vx -= f * dx; b.vy -= f * dy;
          }
        }
      }
      // heat bath / thermostat: relax toward the heater temperature
      const T = Tnow(), lam = Math.sqrt(clamp(1 + (Tset / T - 1) * Math.min(1, 4 * dt), 0.5, 2));
      for (const p of parts) { p.vx *= lam; p.vy *= lam; }
      // pressure from impulses, exponentially averaged (τ ≈ 1.2 s)
      const Pinst = impulse / (dt * 2 * (W + Hbox)) * PSCALE / 1000; impulse = 0;
      const a = 1 - Math.exp(-dt / 1.2); pEMA += (Pinst - pEMA) * a;
      // histogram (time-averaged)
      const tmp = new Float64Array(NB);
      for (const p of parts) { const v = Math.hypot(p.vx, p.vy) * VREAL, bi = Math.floor(v / VMAX * NB); if (bi < NB) tmp[bi]++; }
      for (let i = 0; i < NB; i++) hist[i] += (tmp[i] - hist[i]) * 0.05;
    }

    function checks(dt) {
      const st = state(), settled = now - lastChange > SETTLE && !dragging && Math.abs(Htarget - Hbox) < 0.01;
      if (settled && ref) {
        const rP = st.P / ref.P, rV = st.V / ref.V, rT = st.T / ref.T, rN = st.N / ref.N;
        const near = (x, t, tol) => Math.abs(x / t - 1) < tol;
        if (rN === 1 && near(rT, 1, 0.05) && near(rV, 0.5, 0.04) && near(rP, 2, 0.1)) win('boyle', 'Boyle: V halved → P doubled!');
        if (rN === 1 && near(rV, 1, 0.02) && near(rT, 2, 0.05) && near(rP, 2, 0.1)) win('gay', 'Gay-Lussac: T doubled → P doubled!');
        if (near(rN, 2, 0.05) && near(rV, 1, 0.02) && near(rT, 1, 0.05) && near(rP, 2, 0.1)) win('avo', 'Twice the particles → twice the pressure!');
      }
      if (Math.abs(st.P - target) / target < 0.05 && !dragging) { holdT += dt; if (holdT > 1.5) { win('target', `🎯 Target ${target} kPa reached!`); newTarget(); } }
      else holdT = 0;
    }
    function win(id, m) { if (!ctx.isDone(id)) { ctx.complete(id); setTimeout(() => ctx.toast(m, 'info'), 2700); } }

    const stop = loop((dt) => { now += dt; physics(dt); checks(dt); draw(); });

    function draw() {
      const { g: c, w, h } = s, { sc, bx, by, rx } = lay(), T = Tnow(), V = Vnow(), N = parts.length;
      c.fillStyle = '#121a2c'; c.fillRect(0, 0, w, h);
      const bw = W * sc, top = by - HMAX * sc, ly = by - Hbox * sc;
      // heater glow under the box
      const heat = clamp((Tset - 50) / 950, 0, 1);
      const hg = c.createLinearGradient(0, by, 0, by + 18); hg.addColorStop(0, `hsla(${220 - 220 * heat},90%,55%,.9)`); hg.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = hg; c.fillRect(bx - 6, by, bw + 12, 18);
      // box walls
      c.fillStyle = 'rgba(90,209,255,.04)'; c.fillRect(bx, ly, bw, by - ly);
      c.strokeStyle = '#7e8aa6'; c.lineWidth = 4; c.beginPath(); c.moveTo(bx - 2, top - 10); c.lineTo(bx - 2, by + 2); c.lineTo(bx + bw + 2, by + 2); c.lineTo(bx + bw + 2, top - 10); c.stroke();
      // volume marks
      for (let v = 0.4; v <= 2.001; v += 0.2) { const y = by - v / 0.02 * sc; c.fillStyle = 'rgba(255,255,255,.3)'; c.fillRect(bx + bw + 4, y, Math.abs(v - Math.round(v)) < 0.01 ? 10 : 6, 1); if (Math.abs(v * 5 - Math.round(v * 5)) < 0.01 && Math.round(v * 10) % 4 === 0) text(c, `${fmt(v, 1)} L`, bx + bw + 16, y + 4, { color: C.muted, size: 10 }); }
      if (ref) { const y = by - ref.V / 0.02 * sc; c.strokeStyle = 'rgba(255,204,77,.5)'; c.setLineDash([4, 4]); c.lineWidth = 1; c.beginPath(); c.moveTo(bx, y); c.lineTo(bx + bw, y); c.stroke(); c.setLineDash([]); text(c, '📌', bx - 22, y + 5, { size: 12 }); }
      // particles
      const r = Math.max(2, 0.55 * sc);
      for (const p of parts) {
        const v = Math.hypot(p.vx, p.vy) * VREAL, f = clamp(v / 1000, 0, 1);
        c.fillStyle = `hsl(${220 - 220 * f},85%,${55 + 10 * f}%)`;
        c.beginPath(); c.arc(bx + p.x * sc, by - p.y * sc, r, 0, Math.PI * 2); c.fill();
      }
      // piston
      c.fillStyle = dragging ? '#c9d3ea' : '#a6b1ca'; c.fillRect(bx, ly - 12, bw, 12);
      c.fillStyle = '#6c7892'; c.fillRect(bx + bw / 2 - 5, Math.min(top - 30, ly - 12) - 10, 10, ly - 12 - Math.min(top - 30, ly - 12) + 10);
      c.fillStyle = '#e8edf7'; for (let i = 0; i < 3; i++) c.fillRect(bx + bw / 2 - 12, ly - 9 + i * 3, 24, 1);
      text(c, `V = ${fmt(V, 2)} L`, bx + bw / 2, ly - 20, { color: C.ink, size: 12, weight: 700, align: 'center' });

      // right panel: gauge + histogram
      const pw = w - rx - 16;
      if (pw > 150) {
        const gr = Math.min(pw / 2 - 10, (h - 60) * 0.22, 95), gx = rx + pw / 2, gy = 26 + gr;
        const P = pEMA, pmax = [200, 500, 1000, 2000, 5000].find(m => Math.max(P, target) < m * 0.95) || 5000;
        const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25, ang = (x) => a0 + (a1 - a0) * clamp(x / pmax, 0, 1.02);
        c.fillStyle = '#1a2338'; c.beginPath(); c.arc(gx, gy, gr, 0, Math.PI * 2); c.fill();
        c.strokeStyle = '#2a3654'; c.lineWidth = 3; c.stroke();
        c.strokeStyle = C.accent; c.lineWidth = 8; c.beginPath(); c.arc(gx, gy, gr - 12, a0, ang(P)); c.stroke();
        for (let i = 0; i <= 10; i++) {
          const a = a0 + (a1 - a0) * i / 10;
          c.strokeStyle = 'rgba(255,255,255,.5)'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(gx + Math.cos(a) * (gr - 4), gy + Math.sin(a) * (gr - 4)); c.lineTo(gx + Math.cos(a) * (gr - 18), gy + Math.sin(a) * (gr - 18)); c.stroke();
          if (i % 2 === 0) text(c, `${pmax * i / 10}`, gx + Math.cos(a) * (gr - 30), gy + Math.sin(a) * (gr - 30) + 4, { color: C.muted, size: 9.5, align: 'center' });
        }
        const at = ang(target); c.fillStyle = C.gold; c.beginPath(); c.arc(gx + Math.cos(at) * (gr - 12), gy + Math.sin(at) * (gr - 12), 5, 0, Math.PI * 2); c.fill();
        const an = ang(P); c.strokeStyle = C.bad; c.lineWidth = 3; c.beginPath(); c.moveTo(gx, gy); c.lineTo(gx + Math.cos(an) * (gr - 16), gy + Math.sin(an) * (gr - 16)); c.stroke();
        c.fillStyle = '#e8edf7'; c.beginPath(); c.arc(gx, gy, 5, 0, Math.PI * 2); c.fill();
        text(c, `${fmt(P, 1)} kPa`, gx, gy + gr * 0.55, { color: C.ink, size: 15, weight: 800, align: 'center' });
        text(c, `target ${target} kPa`, gx, gy + gr + 18, { color: C.gold, size: 12, weight: 700, align: 'center' });
        if (holdT > 0) { c.strokeStyle = C.good; c.lineWidth = 4; c.beginPath(); c.arc(gx, gy, gr + 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * holdT / 1.5); c.stroke(); }

        // histogram
        const hx = rx, hy = gy + gr + 42, hw = pw, hh = Math.max(60, Math.min(170, h - hy - 110));
        c.fillStyle = 'rgba(26,35,56,.85)'; c.fillRect(hx, hy, hw, hh + 34);
        text(c, 'Speed distribution (m/s)', hx + 8, hy + 15, { color: C.muted, size: 11.5, weight: 700 });
        const x0 = hx + 8, y0 = hy + hh + 14, bwid = (hw - 16) / NB, dv = VMAX / NB;
        const s2 = KB * T / M_N2, fv = (v) => N * dv * (v / s2) * Math.exp(-v * v / (2 * s2));
        const peak = Math.max(4, fv(Math.sqrt(s2)) * 1.2, ...hist), ys = (hh - 24) / peak;
        for (let i = 0; i < NB; i++) { const f = clamp((i + 0.5) * dv / 1000, 0, 1); c.fillStyle = `hsl(${220 - 220 * f},80%,58%)`; c.fillRect(x0 + i * bwid + 1, y0 - hist[i] * ys, bwid - 2, hist[i] * ys); }
        c.strokeStyle = '#fff'; c.lineWidth = 1.8; c.beginPath();
        for (let i = 0; i <= 120; i++) { const v = VMAX * i / 120, y = y0 - fv(v) * ys; i ? c.lineTo(x0 + (v / VMAX) * (hw - 16), y) : c.moveTo(x0, y); } c.stroke();
        for (const v of [0, 500, 1000, 1500]) text(c, `${v}`, x0 + v / VMAX * (hw - 16), y0 + 13, { color: C.muted, size: 9.5, align: 'center' });
        text(c, '— Maxwell–Boltzmann', hx + hw - 8, hy + 15, { color: '#fff', size: 10, align: 'right' });

        // reference comparison
        const cy = hy + hh + 56;
        if (ref && cy + 40 < h) {
          const st = state();
          text(c, `📌 ${fmt(ref.P, 0)} kPa · ${fmt(ref.V, 2)} L · ${fmt(ref.T, 0)} K · N ${ref.N}`, hx, cy, { color: C.gold, size: 11.5, weight: 600 });
          text(c, `now ÷ 📌:  P ×${fmt(st.P / ref.P, 2)}   V ×${fmt(st.V / ref.V, 2)}   T ×${fmt(st.T / ref.T, 2)}   N ×${fmt(st.N / ref.N, 2)}`, hx, cy + 18, { color: C.ink, size: 11.5, weight: 600 });
          if (now - lastChange < SETTLE) text(c, 'settling…', hx, cy + 36, { color: C.muted, size: 11 });
        }
      }

      const vrms = Math.sqrt(2 * KB * T / M_N2);
      ctx.readout.set({
        'Pressure P (measured)': `${fmt(pEMA, 1)} kPa`,
        'Volume V': `${fmt(V, 2)} L`,
        'Temperature T': `${fmt(T, 0)} K`,
        'Particles N (dots)': `${N}`,
        'P·V / (N·T)': `${fmt(pEMA * V / (N * T), 4)} J/K`,
        'P·V / (N_molecules·k_B·T)': fmt(pEMA * V / (N * D * KB * T), 3),
        'Ideal-gas P = N·k_B·T/V': `${fmt(Pideal(), 1)} kPa`,
        'RMS speed v_rms': `${fmt(vrms, 0)} m/s`,
        'Target pressure': `${target} kPa`,
      });
    }

    return { destroy() { stop(); offP(); s.destroy(); } };
  },
};
