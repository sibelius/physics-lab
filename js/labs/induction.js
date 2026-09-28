import { makeCanvas, loop, slider, select, buttons, checkbox, arrow, text, hint, pointer, fmt, clamp, C } from '../ui.js';

// --- physical model (SI units). Coil axis = x, coil centre at the origin.
const MU0 = 4e-7 * Math.PI;
const R = 0.03;        // coil radius 3 cm
const LC = 0.08;       // coil length 8 cm
const ELL = 0.08;      // magnet length 8 cm
const HW = 0.009;      // magnet half-thickness 0.9 cm
const KS = 12;         // sample loops along the coil
const RTOT = 20;       // circuit resistance (coil + bulb), Ω
const MMAG = 0.1;      // magnet mass 0.1 kg (spring mode)
const WS = 2 * Math.PI / 1.2; // spring natural angular frequency (T = 1.2 s)
const GEN_D = 0.1;     // generator: rotor centre 10 cm left of the coil centre
const LIT = 0.4;       // bulb "lit" threshold, V

// Bar magnet = pair of poles ±p at its ends (p = m/ℓ). For a pole at axial offset z from a loop,
// the on-axis flux is exact: Φ = (μ0·p/2)·[G(z_N) − G(z_S)], G(z) = z/√(z²+R²). Off-axis we fade it smoothly.
function G(z, rho) { const r2 = rho * rho; return z / Math.sqrt(z * z + R * R + r2) * R / Math.sqrt(R * R + r2); }
function fluxPerTurn(mx, my, th, m) {
  const p = m / ELL, ux = Math.cos(th) * ELL / 2, uy = Math.sin(th) * ELL / 2;
  const nx = mx + ux, ny = my + uy, sx = mx - ux, sy = my - uy;
  let sum = 0;
  for (let k = 0; k < KS; k++) { const xl = -LC / 2 + LC * (k + 0.5) / KS; sum += G(nx - xl, ny) - G(sx - xl, sy); }
  return MU0 * p / 2 * sum / KS;
}

export default {
  title: "Magnet & Coil (Faraday's law)",
  icon: '🧲',
  blurb: 'Push a bar magnet through a coil and watch the needle swing, the bulb glow and the EMF graph trace out.',
  theory: `
    <p>Magnetic flux measures how much magnetic field passes through a loop of wire:</p>
    <div class="eq">Φ = ∫ B·dA  &nbsp; (in webers, Wb)</div>
    <p><b>Faraday's law</b> says a <em>changing</em> flux produces a voltage (EMF) in a coil of N turns:</p>
    <div class="eq">ε = −N · dΦ/dt</div>
    <p>The minus sign is <b>Lenz's law</b>: the induced current always pushes back against the change that caused it. Push the N pole in and the coil makes its own N pole facing the magnet to repel it. Pull it out and the current reverses.</p>
    <p>If the magnet stays still, nothing changes, so there's no EMF, even when the magnet sits deep inside the coil. Spin the magnet at a steady rate and the flux goes up and down like a sine wave. That gives an alternating current:</p>
    <div class="eq">ε(t) ≈ N·Φ₀·ω·sin(ωt)</div>
    <p>Here the coil has radius 3 cm and length 8 cm, the circuit resistance is R = 20 Ω, and I = ε/R. The magnet is modelled as two magnetic poles at its ends. The flux is exact along the coil's axis and fades off to the side.</p>`,
  challenges: [
    { id: 'both', text: 'Make the needle swing <b>both ways</b>: push the magnet in, then pull it out within 3 s (Lenz!)', xp: 20 },
    { id: 'still', text: 'Hold the magnet <b>still inside</b> the coil for 2 s. Flux is large, but what does the needle read?', xp: 15 },
    { id: 'bulb', text: `Light the bulb: reach |ε| ≥ ${LIT} V by moving the magnet (hand or spring mode)`, xp: 30 },
    { id: 'gen', text: 'Generator mode: produce a peak EMF above <b>5 V</b>', xp: 35 },
    { id: 'turns', text: 'Keep everything else the same and double the number of turns N. By what factor does the EMF change?', xp: 20, check: v => Math.abs(v - 2) < 0.05, placeholder: 'factor' },
    { id: 'predict', text: 'Predict: the flux through each turn of a 100-turn coil rises steadily from 0 to 2 mWb in 0.1 s. What is |ε|? (V)', xp: 30, check: v => Math.abs(v - 2) < 0.05, placeholder: 'volts' },
  ],
  mount(ctx) {
    const s = makeCanvas(ctx.stage);
    const hintEl = hint(ctx.stage, 'Drag the magnet through the coil · faster = more EMF · Flip reverses the poles');

    let N = 800, mDip = 10, rpm = 600, range = 0.5, mode = 'hand', showLines = true;
    const mag = { x: -0.16, y: 0, th: 0, v: 0 };      // metres, radians (th = 0: N pole points +x, toward the coil)
    const tgt = { x: mag.x, y: mag.y };
    let flip = null, dragging = false, grab = { dx: 0, dy: 0 }, wasInside = false;

    select(ctx.controls, {
      label: 'Mode', value: mode,
      options: [['hand', '✋ Hand: drag the magnet'], ['spring', '🌀 Auto-oscillate on a spring'], ['gen', '⚙️ Generator: spinning magnet']],
      onChange: v => setMode(v),
    });
    slider(ctx.controls, { label: 'Turns N', min: 50, max: 2000, step: 50, value: N, onInput: v => (N = v) });
    slider(ctx.controls, { label: 'Magnet strength (dipole moment m)', min: 1, max: 20, step: 0.5, value: mDip, unit: 'A·m²', fmt: v => v.toFixed(1), onInput: v => (mDip = v) });
    slider(ctx.controls, { label: 'Generator speed', min: 0, max: 3000, step: 50, value: rpm, unit: 'RPM', onInput: v => (rpm = v) });
    select(ctx.controls, {
      label: 'Galvanometer range', value: String(range),
      options: [['0.1', '±0.1 V (sensitive)'], ['0.5', '±0.5 V'], ['2', '±2 V'], ['10', '±10 V']], onChange: v => (range = +v),
    });
    buttons(ctx.controls, [
      { label: '🔄 Flip magnet', onClick: () => { if (!flip) flip = { from: mag.th, t: 0 }; } },
      { label: 'Reset', onClick: () => setMode(mode) },
    ]);
    checkbox(ctx.controls, { label: 'Show magnet field lines', value: showLines, onChange: v => (showLines = v) });

    // --- layout (recomputed every frame from s.w / s.h)
    let sc = 1, cx = 0, cy = 0;
    const layout = () => { sc = Math.min(s.w / 0.52, s.h / 0.36); cx = s.w * 0.5; cy = s.h * 0.3; };
    const X = (x) => cx + x * sc, Y = (y) => cy + y * sc;
    const toM = (p) => ({ x: (p.x - cx) / sc, y: (p.y - cy) / sc });

    function setMode(v) {
      mode = v; flip = null; mag.v = 0;
      if (v === 'gen') { mag.x = tgt.x = -GEN_D; mag.y = tgt.y = 0; hintEl.textContent = 'The magnet spins next to the coil: turn up the RPM, turns and strength'; }
      else if (v === 'spring') { mag.x = tgt.x = -0.12; mag.y = tgt.y = 0; mag.th = Math.round(mag.th / Math.PI) * Math.PI; hintEl.textContent = 'Drag the magnet sideways to stretch the spring, then let go'; }
      else { mag.x = tgt.x = -0.16; mag.y = tgt.y = 0; mag.th = Math.round(mag.th / Math.PI) * Math.PI; hintEl.textContent = 'Drag the magnet through the coil · faster = more EMF · Flip reverses the poles'; }
      wasInside = false; buf.length = 0; peakWin = 0; prevLam = null;
    }

    // coil-wall collision for the dragged magnet (can go through the bore, not through the wire)
    function constrain(tx, ty) {
      tx = clamp(tx, -0.25, 0.25); ty = clamp(ty, -0.14, 0.14);
      const overlap = Math.abs(tx) < LC / 2 + ELL / 2, inLim = R - HW - 0.002, outLim = R + HW + 0.004;
      const curOverlap = Math.abs(mag.x) < LC / 2 + ELL / 2;
      if (overlap) {
        if (wasInside) ty = clamp(ty, -inLim, inLim);
        else if (Math.abs(ty) < outLim && !(!curOverlap && Math.abs(ty) <= inLim)) ty = Math.sign(ty || mag.y || 1) * outLim;
      }
      wasInside = overlap && Math.abs(ty) <= inLim;
      return { x: tx, y: ty };
    }

    const inMagnet = (p) => {
      const q = toM(p), dx = q.x - mag.x, dy = q.y - mag.y, c = Math.cos(mag.th), sn = Math.sin(mag.th);
      return Math.abs(dx * c + dy * sn) < ELL / 2 + 0.006 && Math.abs(-dx * sn + dy * c) < HW + 0.008;
    };
    const offPointer = pointer(s.cv, {
      down(p) {
        if (!inMagnet(p)) return;
        if (mode === 'gen') return ctx.toast('In generator mode the magnet is on a spinning axle', 'info');
        const q = toM(p); dragging = true; grab = { dx: mag.x - q.x, dy: mag.y - q.y }; s.cv.style.cursor = 'grabbing';
      },
      move(p) {
        if (!dragging) { s.cv.style.cursor = inMagnet(p) && mode !== 'gen' ? 'grab' : 'default'; return; }
        const q = toM(p);
        if (mode === 'spring') { tgt.x = clamp(q.x + grab.dx, -0.18, 0.18); tgt.y = 0; }
        else { const c = constrain(q.x + grab.dx, q.y + grab.dy); tgt.x = c.x; tgt.y = c.y; }
      },
      up() { if (dragging && mode === 'spring') mag.v = 0; dragging = false; s.cv.style.cursor = 'default'; },
    });

    // --- simulation state
    let simT = 0, emf = 0, prevLam = null, lam = 0, needle = 0, needleV = 0, glow = 0, peakWin = 0;
    let lastPos = -99, lastNeg = -99, stillT = 0, phase = 0, genAngle = 0;
    const buf = []; let lastPush = -1;
    const windowLen = () => (mode === 'gen' && rpm > 0 ? clamp(3 / (rpm / 60), 0.03, 4) : 4);
    const lamAt = (x, y, th) => N * fluxPerTurn(x, y, th, mDip);

    const stop = loop((dt) => {
      layout();
      const sub = mode === 'gen' ? 64 : 16, h = dt / sub;
      let peakFrame = 0;
      for (let i = 0; i < sub; i++) {
        // flip animation (magnet rotates 180° in 0.4 s)
        if (flip && mode !== 'gen') {
          flip.t += h; const u = clamp(flip.t / 0.4, 0, 1), e = u * u * (3 - 2 * u);
          mag.th = flip.from + Math.PI * e; if (u >= 1) flip = null;
        }
        if (mode === 'hand') {
          const k = 1 - Math.exp(-h / 0.03);
          mag.x += (tgt.x - mag.x) * k; mag.y += (tgt.y - mag.y) * k;
        } else if (mode === 'spring') {
          mag.y = 0;
          if (dragging) { const k = 1 - Math.exp(-h / 0.03); const nx = mag.x + (tgt.x - mag.x) * k; mag.v = (nx - mag.x) / h; mag.x = nx; }
          else {
            // spring + light air damping + magnetic braking (Lenz): F = −(dΛ/dx)²·v/R
            const d = 1e-4, dL = (lamAt(mag.x + d, 0, mag.th) - lamAt(mag.x - d, 0, mag.th)) / (2 * d);
            const a = -WS * WS * mag.x - 0.15 * mag.v - dL * dL * mag.v / RTOT / MMAG;
            mag.v += a * h; mag.x += mag.v * h;
          }
        } else {
          if (flip) { genAngle += Math.PI; flip = null; }
          mag.x = -GEN_D; mag.y = 0;
          genAngle += (rpm / 60) * 2 * Math.PI * h; mag.th = genAngle;
        }
        lam = lamAt(mag.x, mag.y, mag.th);
        const raw = prevLam === null ? 0 : -(lam - prevLam) / h;
        prevLam = lam;
        emf = mode === 'hand' ? emf + (raw - emf) * (1 - Math.exp(-h / 0.015)) : raw;
        simT += h;
        if (simT - lastPush >= windowLen() / 450) { buf.push([simT, emf]); lastPush = simT; }
        peakFrame = Math.max(peakFrame, Math.abs(emf));
        glow = Math.max(glow * Math.exp(-h / 0.08), clamp((Math.abs(emf) - 0.05) / 0.6, 0, 1));
      }
      while (buf.length && buf[0][0] < simT - windowLen()) buf.shift();
      peakWin = buf.reduce((m, [, e]) => Math.max(m, Math.abs(e)), 0);

      // needle: damped 2nd-order meter following 50°·tanh(ε/range)
      const target = 50 * Math.tanh(emf / range);
      needleV += (220 * (target - needle) - 18 * needleV) * dt; needle += needleV * dt; needle = clamp(needle, -58, 58);
      phase += clamp(emf / RTOT * 6000, -500, 500) * dt;

      // --- challenge logic
      if (emf > 0.03) lastPos = simT;
      if (emf < -0.03) lastNeg = simT;
      if (!ctx.isDone('both') && lastPos > 0 && lastNeg > 0 && Math.abs(lastPos - lastNeg) < 3 && mode !== 'gen') {
        ctx.complete('both'); ctx.toast('Lenz: going in and coming out give opposite currents', 'info');
      }
      if (!ctx.isDone('bulb') && peakFrame >= LIT && mode !== 'gen') ctx.complete('bulb');
      if (!ctx.isDone('gen') && mode === 'gen' && peakFrame > 5) ctx.complete('gen');
      const inside = Math.abs(mag.x) < LC / 2 && Math.abs(mag.y) < R;
      if (mode === 'hand' && inside && Math.abs(emf) < 0.002 && !flip) stillT += dt; else stillT = 0;
      if (!ctx.isDone('still') && stillT >= 2) { ctx.complete('still'); ctx.toast('Big flux, but it isn\'t changing, so ε = 0', 'info'); }

      draw(peakFrame);
    });

    // --- drawing
    function fieldLines(g) {
      const c = Math.cos(mag.th), sn = Math.sin(mag.th);
      const Np = { x: X(mag.x + c * ELL / 2), y: Y(mag.y + sn * ELL / 2) }, Sp = { x: X(mag.x - c * ELL / 2), y: Y(mag.y - sn * ELL / 2) };
      const B = (x, y) => {
        const ax = x - Np.x, ay = y - Np.y, bx = x - Sp.x, by = y - Sp.y;
        const ra = Math.hypot(ax, ay) ** 3 + 1e-6, rb = Math.hypot(bx, by) ** 3 + 1e-6;
        return [ax / ra - bx / rb, ay / ra - by / rb];
      };
      g.strokeStyle = 'rgba(255,204,77,.28)'; g.lineWidth = 1.2;
      const n = 16;
      for (let k = 0; k < n; k++) {
        const a = mag.th + (k / (n - 1) - 0.5) * Math.PI * 1.5;
        let x = Np.x + Math.cos(a) * 5, y = Np.y + Math.sin(a) * 5;
        g.beginPath(); g.moveTo(x, y);
        let mid = null;
        for (let st = 0; st < 420; st++) {
          const [fx, fy] = B(x, y), m = Math.hypot(fx, fy) || 1;
          x += 4 * fx / m; y += 4 * fy / m; g.lineTo(x, y);
          if (st === 40) mid = [x, y, Math.atan2(fy, fx)];
          if (Math.hypot(x - Sp.x, y - Sp.y) < 6 || x < -40 || y < -40 || x > s.w + 40 || y > s.h + 40) break;
        }
        g.stroke();
        if (mid) {
          g.save(); g.translate(mid[0], mid[1]); g.rotate(mid[2]); g.fillStyle = 'rgba(255,204,77,.5)';
          g.beginPath(); g.moveTo(4, 0); g.lineTo(-3, -3.5); g.lineTo(-3, 3.5); g.fill(); g.restore();
        }
      }
    }

    function drawMagnet(g) {
      g.save(); g.translate(X(mag.x), Y(mag.y)); g.rotate(mag.th);
      const L2 = ELL / 2 * sc, W2 = HW * sc;
      g.shadowColor = 'rgba(0,0,0,.5)'; g.shadowBlur = 10;
      g.fillStyle = '#e0454f'; g.fillRect(0, -W2, L2, 2 * W2);
      g.fillStyle = '#3d7fe0'; g.fillRect(-L2, -W2, L2, 2 * W2);
      g.shadowBlur = 0;
      g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(-L2, -W2, 2 * L2, W2 * 0.5);
      g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 1; g.strokeRect(-L2, -W2, 2 * L2, 2 * W2);
      g.fillStyle = '#fff'; g.font = `800 ${Math.max(11, W2 * 1.2)}px Inter, system-ui`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.save(); g.translate(L2 * 0.55, 0); g.rotate(-mag.th); g.fillText('N', 0, 1); g.restore();
      g.save(); g.translate(-L2 * 0.55, 0); g.rotate(-mag.th); g.fillText('S', 0, 1); g.restore();
      g.restore();
    }

    function wirePath() {
      const { w, h } = s, gX = w * 0.14, gY = h * 0.8, bX = w * 0.36, bY = h * 0.79, rg = gaugeR();
      const yA = h * 0.6, yC = h * 0.65;
      return [
        [X(-LC / 2) + 3, Y(R) - 2], [X(-LC / 2) + 3, yA], [gX, yA], [gX, gY - rg * 0.62],
        [gX + rg * 0.9, gY - rg * 0.62], [gX + rg * 0.9, gY + rg * 0.35], [bX - 12, gY + rg * 0.35], [bX - 12, bY + 26],
        [bX + 12, bY + 26], [bX + 30, bY + 26], [bX + 30, yC], [X(LC / 2) - 3, yC], [X(LC / 2) - 3, Y(R) - 2],
      ];
    }
    const gaugeR = () => Math.min(s.w * 0.11, s.h * 0.15);

    function drawWires(g) {
      const P = wirePath();
      g.strokeStyle = '#8a6a3e'; g.lineWidth = 3; g.lineJoin = 'round';
      g.beginPath(); P.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
      // moving charge carriers (speed ∝ current)
      let total = 0; const segs = [];
      for (let i = 1; i < P.length; i++) { const l = Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); segs.push(l); total += l; }
      const I = Math.abs(emf / RTOT);
      g.fillStyle = `rgba(255,230,140,${clamp(0.25 + I * 40, 0.25, 1)})`;
      const gap = 22, off = ((phase % gap) + gap) % gap;
      for (let d = off; d < total; d += gap) {
        let rem = d, i = 0; while (i < segs.length && rem > segs[i]) { rem -= segs[i]; i++; }
        if (i >= segs.length) break;
        const t = rem / segs[i], x = P[i][0] + (P[i + 1][0] - P[i][0]) * t, y = P[i][1] + (P[i + 1][1] - P[i][1]) * t;
        g.beginPath(); g.arc(x, y, 2.2, 0, Math.PI * 2); g.fill();
      }
    }

    function drawCoil(g, part) {
      const nd = clamp(Math.round(N / 60), 6, 32), rx = R * sc * 0.28, ry = R * sc;
      for (let i = 0; i < nd; i++) {
        const x = X(-LC / 2 + LC * (i + 0.5) / nd);
        g.beginPath();
        if (part === 'back') { g.strokeStyle = '#6b4424'; g.lineWidth = 2.5; g.ellipse(x, cy, rx, ry, 0, -Math.PI / 2, Math.PI / 2); }
        else { g.strokeStyle = '#d9934a'; g.lineWidth = 3; g.ellipse(x, cy, rx, ry, 0, Math.PI / 2, Math.PI * 1.5); }
        g.stroke();
      }
      if (part === 'front') {
        // induced current direction on the near side of the loops
        const a = clamp(Math.abs(emf) / (range * 0.3), 0, 1);
        if (a > 0.05) {
          const dir = emf > 0 ? 1 : -1;
          for (let i = 1; i < nd; i += 3) {
            const x = X(-LC / 2 + LC * (i + 0.5) / nd) - rx;
            arrow(g, x, cy - dir * 9, x, cy + dir * 9, `rgba(255,240,170,${a})`, 2);
          }
          // induced poles (Lenz): positive ε ⇒ induced B points +x ⇒ N at the right end
          const nRight = emf > 0;
          g.globalAlpha = a;
          text(g, nRight ? 'S' : 'N', X(-LC / 2) - rx - 16, cy + 5, { color: nRight ? '#6aa5ff' : '#ff6b7a', size: 16, weight: 900, align: 'center' });
          text(g, nRight ? 'N' : 'S', X(LC / 2) + rx + 12, cy + 5, { color: nRight ? '#ff6b7a' : '#6aa5ff', size: 16, weight: 900, align: 'center' });
          g.globalAlpha = 1;
        }
        text(g, `N = ${N} turns`, X(0), Y(R) + 20, { color: C.muted, size: 12, weight: 600, align: 'center' });
      }
    }

    function drawGauge(g) {
      const gX = s.w * 0.14, gY = s.h * 0.8, rg = gaugeR();
      g.fillStyle = '#1d2740'; g.strokeStyle = '#3a4768'; g.lineWidth = 2;
      roundRect(g, gX - rg, gY - rg * 0.95, rg * 2, rg * 1.35, 12); g.fill(); g.stroke();
      g.fillStyle = '#f2ecdc'; g.beginPath(); g.arc(gX, gY + rg * 0.2, rg * 0.92, Math.PI * 1.17, Math.PI * 1.83); g.lineTo(gX, gY + rg * 0.2); g.fill();
      const toAng = (deg) => -Math.PI / 2 + deg * Math.PI / 180;
      const ticks = [0, 0.25, 0.5, 1, 2].flatMap(v => (v ? [v, -v] : [0]));
      for (const v of ticks) {
        const d = 50 * Math.tanh(v), a = toAng(d), r1 = rg * 0.78, r2 = rg * 0.9;
        g.strokeStyle = '#333'; g.lineWidth = v === 0 ? 2 : 1.2; g.beginPath();
        g.moveTo(gX + Math.cos(a) * r1, gY + rg * 0.2 + Math.sin(a) * r1); g.lineTo(gX + Math.cos(a) * r2, gY + rg * 0.2 + Math.sin(a) * r2); g.stroke();
        if (Math.abs(v) === 1 || v === 0) {
          const lab = v === 0 ? '0' : `${v > 0 ? '+' : '−'}${+(Math.abs(v) * range).toPrecision(2)}`;
          text(g, lab, gX + Math.cos(a) * rg * 0.64, gY + rg * 0.2 + Math.sin(a) * rg * 0.64 + 4, { color: '#333', size: 10, weight: 700, align: 'center' });
        }
      }
      const a = toAng(needle);
      g.strokeStyle = '#d62f3d'; g.lineWidth = 2.2; g.beginPath(); g.moveTo(gX, gY + rg * 0.2); g.lineTo(gX + Math.cos(a) * rg * 0.88, gY + rg * 0.2 + Math.sin(a) * rg * 0.88); g.stroke();
      g.fillStyle = '#222'; g.beginPath(); g.arc(gX, gY + rg * 0.2, 5, 0, Math.PI * 2); g.fill();
      text(g, `GALVANOMETER  (V)`, gX, gY + rg * 0.33, { color: C.muted, size: 10, weight: 700, align: 'center' });
    }

    function drawBulb(g) {
      const bX = s.w * 0.36, bY = s.h * 0.79, rb = 20;
      if (glow > 0.01) {
        const gr = g.createRadialGradient(bX, bY, 2, bX, bY, rb * (2 + 3 * glow));
        gr.addColorStop(0, `rgba(255,236,150,${0.85 * glow})`); gr.addColorStop(1, 'rgba(255,200,80,0)');
        g.fillStyle = gr; g.beginPath(); g.arc(bX, bY, rb * (2 + 3 * glow), 0, Math.PI * 2); g.fill();
      }
      g.fillStyle = `rgba(${200 + 55 * glow},${210 + 40 * glow},${230 - 90 * glow},${0.25 + 0.6 * glow})`;
      g.strokeStyle = 'rgba(220,230,250,.7)'; g.lineWidth = 1.5;
      g.beginPath(); g.arc(bX, bY, rb, Math.PI * 0.8, Math.PI * 2.2); g.lineTo(bX + 9, bY + 22); g.lineTo(bX - 9, bY + 22); g.closePath(); g.fill(); g.stroke();
      g.strokeStyle = glow > 0.05 ? '#fff4c0' : '#8a7d6a'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(bX - 6, bY + 18); g.lineTo(bX - 5, bY); for (let k = 0; k < 5; k++) g.lineTo(bX - 4 + k * 2, bY + (k % 2 ? -4 : 0)); g.lineTo(bX + 5, bY); g.lineTo(bX + 6, bY + 18); g.stroke();
      g.fillStyle = '#9aa3b5'; g.fillRect(bX - 10, bY + 22, 20, 8);
      text(g, Math.abs(emf) >= LIT ? 'LIT! 💡' : `lights at ${LIT} V`, bX, bY - rb - 10, { color: Math.abs(emf) >= LIT ? C.gold : C.muted, size: 11, weight: 700, align: 'center' });
    }

    function drawGraph(g) {
      const gx = Math.max(s.w * 0.62, X(LC / 2) + 40), gy = s.h * 0.62, gw = s.w - gx - 14, gh = s.h - gy - 14;
      g.fillStyle = 'rgba(14,20,34,.85)'; g.strokeStyle = C.grid2; g.lineWidth = 1; roundRect(g, gx, gy, gw, gh, 10); g.fill(); g.stroke();
      const px = gx + 40, pw = gw - 50, py = gy + 22, ph = gh - 40, mid = py + ph / 2;
      const ymax = Math.max(0.05, niceUp(peakWin * 1.15));
      text(g, 'EMF ε(t)', gx + 10, gy + 15, { size: 12, weight: 700 });
      text(g, `window ${windowLen() < 1 ? fmt(windowLen() * 1000, 0) + ' ms' : fmt(windowLen(), 1) + ' s'}`, gx + gw - 10, gy + 15, { size: 11, color: C.muted, align: 'right' });
      g.strokeStyle = C.grid2; g.beginPath(); g.moveTo(px, mid); g.lineTo(px + pw, mid); g.moveTo(px, py); g.lineTo(px, py + ph); g.stroke();
      text(g, `+${sig(ymax)} V`, px - 4, py + 4, { size: 10, color: C.muted, align: 'right' });
      text(g, `−${sig(ymax)} V`, px - 4, py + ph, { size: 10, color: C.muted, align: 'right' });
      text(g, '0', px - 4, mid + 4, { size: 10, color: C.muted, align: 'right' });
      if (LIT < ymax) {
        g.strokeStyle = 'rgba(255,204,77,.35)'; g.setLineDash([4, 4]); g.beginPath();
        const yl = ph / 2 * LIT / ymax; g.moveTo(px, mid - yl); g.lineTo(px + pw, mid - yl); g.moveTo(px, mid + yl); g.lineTo(px + pw, mid + yl); g.stroke(); g.setLineDash([]);
      }
      if (buf.length > 1) {
        const t0 = simT - windowLen(), W = windowLen();
        g.save(); g.beginPath(); g.rect(px, py, pw, ph); g.clip();
        g.fillStyle = 'rgba(90,209,255,.12)'; g.beginPath(); g.moveTo(px + (buf[0][0] - t0) / W * pw, mid);
        for (const [t, e] of buf) g.lineTo(px + (t - t0) / W * pw, mid - e / ymax * ph / 2);
        g.lineTo(px + (buf[buf.length - 1][0] - t0) / W * pw, mid); g.fill();
        g.strokeStyle = C.accent; g.lineWidth = 2; g.beginPath();
        buf.forEach(([t, e], i) => { const x = px + (t - t0) / W * pw, y = mid - e / ymax * ph / 2; i ? g.lineTo(x, y) : g.moveTo(x, y); });
        g.stroke(); g.restore();
      }
    }

    function drawSpring(g) {
      const x0 = 14, x1 = X(mag.x - Math.cos(mag.th) * ELL / 2 * Math.sign(Math.cos(mag.th) || 1)), y = cy;
      g.fillStyle = '#39445f'; g.fillRect(4, y - 30, 10, 60);
      g.strokeStyle = '#c9d1e3'; g.lineWidth = 2; g.beginPath(); g.moveTo(x0, y);
      const coils = 16;
      for (let i = 1; i < coils * 2; i++) g.lineTo(x0 + (x1 - x0) * i / (coils * 2), y + (i % 2 ? -10 : 10));
      g.lineTo(x1, y); g.stroke();
    }

    function draw(peakFrame) {
      const { g, w, h } = s;
      g.fillStyle = C.bg; g.fillRect(0, 0, w, h);
      g.strokeStyle = C.grid; g.lineWidth = 1; g.beginPath();
      const step = 0.02 * sc;
      for (let x = cx % step; x < w; x += step) { g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, h * 0.56); }
      for (let y = cy % step; y < h * 0.56; y += step) { g.moveTo(0, y + 0.5); g.lineTo(w, y + 0.5); }
      g.stroke();
      // coil axis
      g.strokeStyle = 'rgba(255,255,255,.08)'; g.setLineDash([6, 6]); g.beginPath(); g.moveTo(0, cy); g.lineTo(w, cy); g.stroke(); g.setLineDash([]);

      if (showLines) fieldLines(g);
      drawWires(g);
      if (mode === 'spring') drawSpring(g);
      if (mode === 'gen') {
        g.strokeStyle = 'rgba(255,255,255,.12)'; g.lineWidth = 1.5; g.beginPath(); g.arc(X(mag.x), Y(mag.y), ELL / 2 * sc + 6, 0, Math.PI * 2); g.stroke();
      }
      // bobbin tube
      g.fillStyle = 'rgba(160,180,220,.07)'; g.fillRect(X(-LC / 2), Y(-R), LC * sc, 2 * R * sc);
      const magnetInside = Math.abs(mag.y) < R && Math.abs(mag.x) < LC / 2 + ELL / 2;
      drawCoil(g, 'back');
      if (magnetInside) { drawMagnet(g); drawCoil(g, 'front'); } else { drawCoil(g, 'front'); drawMagnet(g); }
      if (mode === 'gen') { g.fillStyle = '#c9d1e3'; g.beginPath(); g.arc(X(mag.x), Y(mag.y), 4, 0, Math.PI * 2); g.fill(); }

      // magnet velocity arrow
      if (mode !== 'gen') {
        const vx = mode === 'spring' ? mag.v : (tgt.x - mag.x) / 0.03, vy = mode === 'spring' ? 0 : (tgt.y - mag.y) / 0.03;
        if (Math.hypot(vx, vy) > 0.05) arrow(g, X(mag.x), Y(mag.y) - HW * sc - 10, X(mag.x) + vx * 60, Y(mag.y) - HW * sc - 10 + vy * 60, C.accent, 2, 'v');
      }
      // still-hold progress ring
      if (stillT > 0.1 && !ctx.isDone('still')) {
        g.strokeStyle = C.good; g.lineWidth = 4; g.beginPath();
        g.arc(X(mag.x), Y(mag.y), ELL / 2 * sc + 14, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(stillT / 2, 0, 1)); g.stroke();
        text(g, `holding still… ε = ${fmt(emf, 3)} V`, X(mag.x), Y(mag.y) - ELL / 2 * sc - 20, { color: C.good, size: 12, weight: 700, align: 'center' });
      }

      drawGauge(g); drawBulb(g); drawGraph(g);
      // scale bar (2 cm)
      g.fillStyle = C.ink; g.fillRect(14, h * 0.56 - 12, 0.05 * sc, 3);
      text(g, '5 cm', 14, h * 0.56 - 18, { size: 11, color: C.muted, weight: 600 });

      const flux = lam / N;
      ctx.readout.set({
        'Magnet centre x': mode === 'gen' ? `${fmt(-GEN_D * 100, 1)} cm (spinning)` : `${fmt(mag.x * 100, 1)} cm`,
        'Flux per turn Φ': fmtWb(flux),
        'Flux linkage NΦ': fmtWb(lam),
        'EMF ε = −N·dΦ/dt': `${fmtV(emf)}`,
        'Current I = ε/R': `${fmt(emf / RTOT * 1000, 1)} mA`,
        'Peak |ε| (graph window)': fmtV(peakWin),
        'Frequency': mode === 'gen' ? `${fmt(rpm / 60, 1)} Hz` : mode === 'spring' ? `${fmt(1 / 1.2, 2)} Hz (spring)` : '—',
        'Bulb': Math.abs(emf) >= LIT ? '💡 lit' : glow > 0.05 ? 'glowing' : 'off',
      });
    }

    return { destroy() { stop(); offPointer(); s.destroy(); } };
  },
};

function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function niceUp(v) { const p = 10 ** Math.floor(Math.log10(v)), n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; }
function sig(v) { return +v.toPrecision(2) + ''; }
function fmtV(v) { const a = Math.abs(v); return a < 1 ? `${fmt(v * 1000, a < 0.01 ? 2 : 0)} mV` : `${fmt(v, 2)} V`; }
function fmtWb(v) { const a = Math.abs(v); return a < 1e-3 ? `${fmt(v * 1e6, 1)} μWb` : `${fmt(v * 1e3, 2)} mWb`; }
