import { makeCanvas, loop, slider, select, buttons, checkbox, arrow, text, hint, pointer, fmt, clamp, C } from '../ui.js';

const TANK_W = 60;   // the tank is 60 cm wide; height follows the canvas aspect
const CELL = 4;      // field resolution in CSS px
const BT = 0.8;      // barrier thickness (cm)
const NM = 12;       // string modes simulated
const GAM = 0.7;     // string damping (1/s)
const F0 = 0.14;     // driver strength
const TAU = Math.PI * 2;

// colour look-up tables (256 entries, rgb)
function lut(stops) {
  const out = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255, seg = Math.min(stops.length - 2, Math.floor(t * (stops.length - 1)));
    const u = t * (stops.length - 1) - seg, a = stops[seg], b = stops[seg + 1];
    for (let c = 0; c < 3; c++) out[i * 3 + c] = a[c] + (b[c] - a[c]) * u;
  }
  return out;
}
const LUT_WAVE = lut([[6, 12, 40], [18, 50, 110], [40, 110, 175], [120, 205, 240], [235, 250, 255]]);
const LUT_AMP = lut([[6, 6, 18], [55, 25, 110], [150, 60, 190], [255, 150, 90], [255, 240, 170]]);
const sub = (n) => String(n).split('').map(d => '₀₁₂₃₄₅₆₇₈₉'[d]).join('');
const ORD = ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th', '11th', '12th'];

export default {
  title: 'Ripple Tank & Interference',
  icon: '🌊',
  blurb: 'Make circular waves collide, squeeze a plane wave through slits and find the resonances of a string.',
  theory: `
    <p>A wave is a travelling oscillation. Its speed, frequency and wavelength are linked by</p>
    <div class="eq">v = f·λ &nbsp;&nbsp; k = 2π/λ, &nbsp; ω = 2πf</div>
    <p>A point source in a ripple tank makes circular waves whose height falls off as the energy spreads out:</p>
    <div class="eq">y(r, t) = A·sin(k·r − ω·t + φ) / √r</div>
    <p>When waves overlap they simply add (superposition). With two sources the path difference Δr = |r₁ − r₂| decides the result:</p>
    <div class="eq">Δr = m·λ → constructive &nbsp;&nbsp; Δr = (m + ½)·λ → destructive</div>
    <p>Through two slits separated by d, bright fringes appear on a distant screen at d·sinθ = m·λ, spaced by about</p>
    <div class="eq">Δy ≈ λ·L / d</div>
    <p>On a string fixed at both ends only whole numbers of half-wavelengths fit: L = n·λ/2. Driving it at one of these frequencies causes <b>resonance</b> and the amplitude grows:</p>
    <div class="eq">fₙ = n·v / (2L), &nbsp; n = 1, 2, 3 …</div>
    <p>Points that never move are <b>nodes</b>; points of maximum swing are <b>antinodes</b>.</p>`,
  challenges: [
    { id: 'destructive', text: 'With 2 sources or slits, drag the detector to a point of <b>destructive interference</b> (amplitude &lt; 10% of max)', xp: 25 },
    { id: 'antiphase', text: 'Set the phase difference to <b>180°</b> and show that the centre line (Δr = 0) becomes a node', xp: 30 },
    { id: 'fringes', text: 'Make the <b>double-slit</b> pattern show at least <b>5 bright fringes</b> on the screen', xp: 35 },
    { id: 'lambda', text: 'Sound in air: v = 340 m/s, f = 170 Hz. What is the wavelength λ? (m)', xp: 15, check: v => Math.abs(v - 2) < 0.02, placeholder: 'meters' },
    { id: 'third', text: 'String view: make the <b>3rd harmonic</b> (3 loops) resonate', xp: 30 },
    { id: 'predict', text: 'Predict: a string with L = 1.5 m and v = 6 m/s. Which driver frequency gives the <b>2nd harmonic</b>? (Hz) — then test it!', xp: 40, check: v => Math.abs(v - 4) < 0.1, placeholder: 'Hz' },
  ],
  mount(ctx) {
    const s = makeCanvas(ctx.stage);
    const hn = hint(ctx.stage, '');
    let view = 'tank';

    // ---------------- ripple tank state ----------------
    let f = 1.5, vw = 6, mode = '2', sep = 6, phase = 0, slitSep = 6, slitW = 1, showAmp = false, paused = false;
    let src = null, det = null, barX = 16, T = 0, dirty = true;
    let gw = 0, gh = 0, P = null, Q = null, off = document.createElement('canvas'), octx = off.getContext('2d'), img = null;
    let gain = 1, pa = 1, S = [], kk = 1, prof = new Float32Array(240), fringes = 0;
    const scope = new Float32Array(240); let scopeI = 0;

    // ---------------- string state ----------------
    let L = 1.5, vs = 6, fd = 1.5, slow = false, tS = 0;
    const a = new Float64Array(NM + 1), ad = new Float64Array(NM + 1);
    const NSAMP = 241, env = new Float32Array(NSAMP);

    // ---------------- controls ----------------
    const tabs = buttons(ctx.controls, [{ label: '🌊 Ripple tank', onClick: () => setView('tank') }, { label: '🎸 String', onClick: () => setView('string') }]);
    const tankBox = document.createElement('div'), strBox = document.createElement('div');
    ctx.controls.append(tankBox, strBox);
    select(tankBox, {
      label: 'Wave source', value: mode,
      options: [['1', '1 point source'], ['2', '2 point sources'], ['slit1', 'Plane wave → single slit'], ['slit2', 'Plane wave → double slit']],
      onChange: v => { mode = v; layoutCtl(); dirty = true; },
    });
    slider(tankBox, { label: 'Frequency f', min: 0.5, max: 4, step: 0.05, value: f, unit: 'Hz', fmt: v => v.toFixed(2), onInput: v => { f = v; dirty = true; } });
    slider(tankBox, { label: 'Wave speed v', min: 4, max: 16, step: 0.5, value: vw, unit: 'cm/s', onInput: v => { vw = v; dirty = true; } });
    const sSep = slider(tankBox, { label: 'Source separation d', min: 1, max: 20, step: 0.5, value: sep, unit: 'cm', onInput: v => { sep = v; placeSources(); dirty = true; } });
    const sPh = slider(tankBox, { label: 'Phase difference Δφ', min: 0, max: 360, step: 5, value: phase, unit: '°', onInput: v => { phase = v; dirty = true; } });
    const sSlit = slider(tankBox, { label: 'Slit separation d', min: 2, max: 16, step: 0.5, value: slitSep, unit: 'cm', onInput: v => { slitSep = v; dirty = true; } });
    const sW = slider(tankBox, { label: 'Slit width a', min: 0.5, max: 6, step: 0.25, value: slitW, unit: 'cm', onInput: v => { slitW = v; dirty = true; } });
    checkbox(tankBox, { label: 'Show amplitude map (time-averaged)', value: showAmp, onChange: v => (showAmp = v) });
    const [bPause] = buttons(tankBox, [
      { label: '⏸ Pause', onClick: () => { paused = !paused; bPause.textContent = paused ? '▶ Play' : '⏸ Pause'; } },
      { label: 'Reset positions', onClick: () => { src = null; det = null; barX = 16; dirty = true; } },
    ]);

    slider(strBox, { label: 'String length L', min: 0.5, max: 2.5, step: 0.05, value: L, unit: 'm', fmt: v => v.toFixed(2), onInput: v => (L = v) });
    slider(strBox, { label: 'Wave speed v', min: 2, max: 15, step: 0.5, value: vs, unit: 'm/s', onInput: v => (vs = v) });
    const sFd = slider(strBox, { label: 'Driver frequency f', min: 0.2, max: 20, step: 0.02, value: fd, unit: 'Hz', fmt: v => v.toFixed(2), onInput: v => (fd = v) });
    buttons(strBox, [
      { label: '◀ −0.02 Hz', onClick: () => sFd.set(Math.max(0.2, +(fd - 0.02).toFixed(2))) },
      { label: '+0.02 Hz ▶', onClick: () => sFd.set(Math.min(20, +(fd + 0.02).toFixed(2))) },
      { label: '🛑 Damp', onClick: () => { a.fill(0); ad.fill(0); env.fill(0); } },
    ]);
    checkbox(strBox, { label: 'Slow motion (¼ speed)', value: slow, onChange: v => (slow = v) });

    function layoutCtl() {
      sSep.el.style.display = sPh.el.style.display = mode === '2' ? '' : 'none';
      sSlit.el.style.display = mode === 'slit2' ? '' : 'none';
      sW.el.style.display = mode.startsWith('slit') ? '' : 'none';
    }
    function setView(v) {
      view = v;
      tabs[0].classList.toggle('on', v === 'tank'); tabs[1].classList.toggle('on', v === 'string');
      tankBox.style.display = v === 'tank' ? '' : 'none'; strBox.style.display = v === 'string' ? '' : 'none';
      hn.textContent = v === 'tank'
        ? 'Drag the sources, the barrier or the 🎯 detector · click anywhere to move the detector'
        : 'Drag on the resonance graph (bottom) to tune the driver · find the peaks!';
    }
    layoutCtl(); setView('tank');

    // ---------------- ripple tank physics ----------------
    const ppc = () => s.w / TANK_W;           // px per cm
    const tankH = () => s.h / ppc();          // tank height in cm
    const lam = () => vw / f;
    const slitCenters = () => {
      const H = tankH(), d = Math.max(slitSep, slitW + 0.5);
      return mode === 'slit1' ? [H / 2] : [H / 2 - d / 2, H / 2 + d / 2];
    };

    function ensure() {
      const H = tankH();
      if (!src) src = [{ x: 18, y: H / 2 - sep / 2 }, { x: 18, y: H / 2 + sep / 2 }];
      if (!det) det = { x: 44, y: H / 2 + 4 };
      for (const p of [...src, det]) { p.x = clamp(p.x, 0.5, TANK_W - 2.5); p.y = clamp(p.y, 0.5, H - 0.5); }
      barX = clamp(barX, 4, TANK_W - 16);
    }
    function placeSources() {
      if (!src) return;
      const mx = (src[0].x + src[1].x) / 2, my = (src[0].y + src[1].y) / 2;
      src[0] = { x: mx, y: my - sep / 2 }; src[1] = { x: mx, y: my + sep / 2 };
    }
    function activeSources() {
      const l = lam(), k = TAU / l;
      if (mode === '1') return [{ x: src[0].x, y: src[0].y, a: 1, ph: 0 }];
      if (mode === '2') return [{ x: src[0].x, y: src[0].y, a: 1, ph: 0 }, { x: src[1].x, y: src[1].y, a: 1, ph: phase * Math.PI / 180 }];
      // Huygens: each slit is a row of in-phase point sources on the barrier's far face
      const m = Math.max(2, Math.min(16, Math.ceil((3 * slitW) / l) + 1)), out = [];
      for (const c of slitCenters()) for (let q = 0; q < m; q++)
        out.push({ x: barX + BT, y: c - slitW / 2 + (slitW * (q + 0.5)) / m, a: Math.sqrt(l) / m * 1.6, ph: k * (barX + BT) });
      return out;
    }
    function sumAt(x, y) {
      let p = 0, q = 0, ref = 0;
      for (const o of S) {
        const dx = x - o.x, dy = y - o.y, r = Math.sqrt(dx * dx + dy * dy), amp = o.a / Math.sqrt(r + 0.3), th = kk * r + o.ph;
        p += amp * Math.sin(th); q += amp * Math.cos(th); ref += amp;
      }
      return [p, q, ref];
    }
    function probe(x, y) {
      if (mode.startsWith('slit') && x < barX + BT) return [pa * Math.sin(kk * x), pa * Math.cos(kk * x), pa];
      return sumAt(x, y);
    }
    function rebuild() {
      ensure();
      const cols = Math.max(1, Math.ceil(s.w / CELL)), rows = Math.max(1, Math.ceil(s.h / CELL));
      if (cols !== gw || rows !== gh) {
        gw = cols; gh = rows; P = new Float32Array(gw * gh); Q = new Float32Array(gw * gh);
        off.width = gw; off.height = gh; img = octx.createImageData(gw, gh);
      }
      const cm = CELL / ppc(), slit = mode.startsWith('slit'), xr = barX + BT;
      S = activeSources(); kk = TAU / lam();
      const amps = [];
      for (let j = 0; j < gh; j++) {
        const y = (j + 0.5) * cm;
        for (let i = 0; i < gw; i++) {
          const x = (i + 0.5) * cm, idx = j * gw + i;
          if (slit && x < xr) { P[idx] = Q[idx] = 0; continue; }
          const [p, q] = sumAt(x, y); P[idx] = p; Q[idx] = q;
          if ((idx % 17) === 0) amps.push(Math.sqrt(p * p + q * q));
        }
      }
      amps.sort((u, v) => u - v);
      gain = 0.85 / (amps[Math.floor(amps.length * 0.9)] || 1);
      pa = 0.7 / gain;
      if (slit) for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
        const x = (i + 0.5) * cm; if (x >= barX) break;
        P[j * gw + i] = pa * Math.sin(kk * x); Q[j * gw + i] = pa * Math.cos(kk * x);
      }
      // screen intensity profile at the right edge
      const H = tankH(), xs = TANK_W - 0.8; let mx = 0;
      for (let i = 0; i < prof.length; i++) { const [p, q] = probe(xs, (i + 0.5) / prof.length * H); prof[i] = p * p + q * q; mx = Math.max(mx, prof[i]); }
      fringes = countPeaks(prof, mx);
      dirty = false;
    }
    function countPeaks(arr, mx) {
      const kept = [];
      for (let i = 1; i < arr.length - 1; i++) {
        if (!(arr[i] > arr[i - 1] && arr[i] >= arr[i + 1] && arr[i] > 0.12 * mx)) continue;
        if (!kept.length) { kept.push(i); continue; }
        const lastI = kept[kept.length - 1]; let mn = Infinity;
        for (let j = lastI; j <= i; j++) mn = Math.min(mn, arr[j]);
        if (mn < 0.6 * Math.min(arr[lastI], arr[i])) kept.push(i);
        else if (arr[i] > arr[lastI]) kept[kept.length - 1] = i;
      }
      return kept.length;
    }

    // ---------------- string physics (modal: each harmonic is a driven damped oscillator) ----------------
    const wn = (n) => (n * Math.PI * vs) / L;
    function stepString(dt) {
      const h0 = slow ? dt * 0.25 : dt, w = TAU * fd;
      const nsub = Math.max(1, Math.ceil((h0 * wn(NM)) / 0.15)), h = h0 / nsub;
      for (let k = 0; k < nsub; k++) {
        tS += h; const F = F0 * w * Math.cos(w * tS);
        for (let n = 1; n <= NM; n++) { const o = wn(n); ad[n] += (F - 2 * GAM * ad[n] - o * o * a[n]) * h; a[n] += ad[n] * h; }
      }
    }
    const response = (ff) => { const w = TAU * ff; let A = 0; for (let n = 1; n <= NM; n++) { const o = wn(n); A += (F0 * w) / Math.sqrt((o * o - w * w) ** 2 + (2 * GAM * w) ** 2); } return A; };

    // ---------------- pointer ----------------
    let drag = null;
    const toCm = (p) => ({ x: p.x / ppc(), y: p.y / ppc() });
    const plotRect = () => ({ x: 70, y: s.h * 0.68, w: s.w - 120, h: s.h * 0.32 - 42 });
    const fMax = 20;
    function setFreqFromPlot(p) { const r = plotRect(); sFd.set(+clamp(((p.x - r.x) / r.w) * fMax, 0.2, fMax).toFixed(2)); }
    const unPtr = pointer(s.cv, {
      down(p) {
        if (view === 'string') { const r = plotRect(); if (p.y > r.y - 10) { drag = 'plot'; setFreqFromPlot(p); } return; }
        ensure();
        const w = toCm(p), R = 16 / ppc(), near = (q) => Math.hypot(q.x - w.x, q.y - w.y) < R;
        if (near(det)) drag = { o: det };
        else if (mode === '1' && near(src[0])) drag = { o: src[0], src: true };
        else if (mode === '2' && near(src[0])) drag = { o: src[0], src: true };
        else if (mode === '2' && near(src[1])) drag = { o: src[1], src: true };
        else if (mode.startsWith('slit') && Math.abs(w.x - (barX + BT / 2)) < R) drag = 'bar';
        else { det.x = w.x; det.y = w.y; drag = { o: det }; }
      },
      move(p) {
        if (!drag) {
          if (view === 'tank' && src && det) {
            const w = toCm(p), R = 16 / ppc(), near = (q) => Math.hypot(q.x - w.x, q.y - w.y) < R;
            const over = near(det) || (mode === '2' && (near(src[0]) || near(src[1]))) || (mode === '1' && near(src[0])) || (mode.startsWith('slit') && Math.abs(w.x - barX - BT / 2) < R);
            s.cv.style.cursor = over ? 'grab' : 'crosshair';
          } else s.cv.style.cursor = view === 'string' && p.y > plotRect().y - 10 ? 'ew-resize' : 'default';
          return;
        }
        if (drag === 'plot') return setFreqFromPlot(p);
        const w = toCm(p);
        if (drag === 'bar') { barX = w.x - BT / 2; dirty = true; }
        else { drag.o.x = w.x; drag.o.y = w.y; if (drag.src) dirty = true; }
        ensure();
      },
      up() { drag = null; },
    });
    s.onResize(() => { dirty = true; });

    // ---------------- main loop ----------------
    const stop = loop((dt) => {
      if (view === 'tank') { if (!paused) T += dt; drawTank(); }
      else { stepString(dt); drawString(dt); }
    });

    function drawTank() {
      if (!s.w || !s.h) return;
      if (dirty || !P) rebuild();
      const c = s.g, w = s.w, h = s.h, k = ppc(), l = lam(), H = tankH();
      const ct = Math.cos(TAU * f * T), st = Math.sin(TAU * f * T), d = img.data;
      for (let i = 0, n = gw * gh; i < n; i++) {
        let ci;
        if (showAmp) ci = Math.min(255, Math.sqrt(P[i] * P[i] + Q[i] * Q[i]) * gain * 190) | 0;
        else ci = ((Math.tanh((P[i] * ct - Q[i] * st) * gain * 1.2) + 1) * 127.5) | 0;
        const L3 = showAmp ? LUT_AMP : LUT_WAVE, o = i * 4, q = ci * 3;
        d[o] = L3[q]; d[o + 1] = L3[q + 1]; d[o + 2] = L3[q + 2]; d[o + 3] = 255;
      }
      octx.putImageData(img, 0, 0);
      c.imageSmoothingEnabled = true; c.drawImage(off, 0, 0, gw * CELL, gh * CELL);

      const slit = mode.startsWith('slit');
      if (slit) {
        const bx = barX * k, bw = BT * k;
        c.fillStyle = '#39445f'; let yPrev = 0;
        for (const cc of slitCenters()) { const y0 = (cc - slitW / 2) * k; c.fillRect(bx, yPrev, bw, y0 - yPrev); yPrev = (cc + slitW / 2) * k; }
        c.fillRect(bx, yPrev, bw, h - yPrev);
        c.strokeStyle = 'rgba(255,255,255,.35)'; c.lineWidth = 1; c.strokeRect(bx + 0.5, -1, bw, h + 2);
        c.fillStyle = 'rgba(10,14,26,.75)'; c.fillRect(8, h * 0.14 - 22, Math.min(bx - 12, l * k + 80), 34);
        arrow(c, 16, h * 0.14, 16 + l * k, h * 0.14, C.gold, 2.5, 'k (λ long)');
        text(c, '⇆ drag', bx + bw / 2, 64, { color: C.muted, size: 11, align: 'center' });
      } else {
        const list = mode === '1' ? [src[0]] : src;
        list.forEach((p, i) => {
          const r = 7 + 2 * Math.sin(TAU * f * T - (i ? phase * Math.PI / 180 : 0));
          c.fillStyle = 'rgba(255,204,77,.25)'; c.beginPath(); c.arc(p.x * k, p.y * k, r + 7, 0, TAU); c.fill();
          c.fillStyle = C.gold; c.beginPath(); c.arc(p.x * k, p.y * k, r, 0, TAU); c.fill();
          text(c, mode === '1' ? 'S' : `S${i + 1}`, p.x * k, p.y * k + 4, { color: '#1a1200', size: 11, weight: 800, align: 'center' });
        });
        // path lines to detector + λ-long arrows
        list.forEach((p) => {
          c.strokeStyle = 'rgba(255,255,255,.35)'; c.setLineDash([4, 5]); c.lineWidth = 1.2;
          c.beginPath(); c.moveTo(p.x * k, p.y * k); c.lineTo(det.x * k, det.y * k); c.stroke(); c.setLineDash([]);
          const dx = det.x - p.x, dy = det.y - p.y, r = Math.hypot(dx, dy) || 1, len = Math.min(l, r * 0.8);
          arrow(c, p.x * k, p.y * k, (p.x + (dx / r) * len) * k, (p.y + (dy / r) * len) * k, C.gold, 2, 'λ');
        });
        if (mode === '2') {
          // midpoint of sources and the centre line
          const mx = (src[0].x + src[1].x) / 2, my = (src[0].y + src[1].y) / 2, ex = src[1].y - src[0].y, ey = -(src[1].x - src[0].x), en = Math.hypot(ex, ey) || 1;
          c.strokeStyle = 'rgba(255,255,255,.12)'; c.setLineDash([2, 6]); c.beginPath();
          c.moveTo((mx - ex / en * 200) * k, (my - ey / en * 200) * k); c.lineTo((mx + ex / en * 200) * k, (my + ey / en * 200) * k); c.stroke(); c.setLineDash([]);
        }
      }

      // detector
      const [p, q, ref] = probe(det.x, det.y), amp = Math.hypot(p, q), ratio = ref > 0 ? amp / ref : 0;
      const inst = ref > 0 ? (p * ct - q * st) / ref : 0;
      if (!paused) { scope[scopeI] = inst; scopeI = (scopeI + 1) % scope.length; }
      const kind = mode === '1' ? 'Single source' : ratio > 0.9 ? 'Constructive' : ratio < 0.1 ? 'Destructive' : 'Partial';
      const kc = kind === 'Constructive' ? C.good : kind === 'Destructive' ? C.bad : C.ink;
      const dxp = det.x * k, dyp = det.y * k;
      c.strokeStyle = kc; c.lineWidth = 2.5; c.beginPath(); c.arc(dxp, dyp, 11, 0, TAU); c.stroke();
      c.beginPath(); c.moveTo(dxp - 16, dyp); c.lineTo(dxp - 6, dyp); c.moveTo(dxp + 6, dyp); c.lineTo(dxp + 16, dyp); c.moveTo(dxp, dyp - 16); c.lineTo(dxp, dyp - 6); c.moveTo(dxp, dyp + 6); c.lineTo(dxp, dyp + 16); c.stroke();
      // amplitude meter next to detector
      const mxp = Math.min(dxp + 20, w - 110), myp = Math.max(dyp - 30, 28);
      c.fillStyle = 'rgba(10,14,26,.75)'; c.fillRect(mxp, myp, 88, 34);
      c.fillStyle = C.grid2; c.fillRect(mxp + 6, myp + 20, 76, 7);
      c.fillStyle = kc; c.fillRect(mxp + 6, myp + 20, 76 * clamp(ratio, 0, 1), 7);
      text(c, `${Math.round(ratio * 100)}% · ${kind === 'Single source' ? 'amp' : kind}`, mxp + 6, myp + 14, { color: kc, size: 11, weight: 700 });

      // screen at the right edge
      const sx = w - 0.8 * k * 2.4, mxI = Math.max(...prof) || 1;
      c.fillStyle = 'rgba(8,10,20,.85)'; c.fillRect(sx - 60, 0, w - sx + 60, h);
      for (let i = 0; i < prof.length; i++) {
        const v = Math.sqrt(prof[i] / mxI), y0 = (i / prof.length) * h, y1 = ((i + 1) / prof.length) * h + 1;
        c.fillStyle = `rgba(255,${190 + 60 * v | 0},${90 + 120 * v | 0},${v})`; c.fillRect(sx, y0, w - sx, y1 - y0);
      }
      c.strokeStyle = C.gold; c.lineWidth = 1.5; c.beginPath();
      for (let i = 0; i < prof.length; i++) { const x = sx - 4 - (prof[i] / mxI) * 52, y = ((i + 0.5) / prof.length) * h; i ? c.lineTo(x, y) : c.moveTo(x, y); }
      c.stroke();
      text(c, 'SCREEN', sx - 30, 16, { color: C.muted, size: 10, weight: 700, align: 'center' });
      text(c, `${fringes} bright`, sx - 30, 30, { color: fringes >= 5 && mode === 'slit2' ? C.good : C.ink, size: 11, weight: 700, align: 'center' });

      // oscilloscope of the detector signal
      const ox = 12, oy = h - 92, ow = 200, oh = 80;
      c.fillStyle = 'rgba(10,14,26,.82)'; c.fillRect(ox, oy, ow, oh);
      c.strokeStyle = C.grid2; c.lineWidth = 1; c.beginPath(); c.moveTo(ox, oy + oh / 2); c.lineTo(ox + ow, oy + oh / 2); c.stroke();
      c.strokeStyle = kc; c.lineWidth = 2; c.beginPath();
      for (let i = 0; i < scope.length; i++) { const v = scope[(scopeI + i) % scope.length], x = ox + (i / (scope.length - 1)) * ow, y = oy + oh / 2 - v * (oh / 2 - 6); i ? c.lineTo(x, y) : c.moveTo(x, y); }
      c.stroke();
      text(c, 'Detector y(t)', ox + 6, oy + 13, { color: C.muted, size: 10.5, weight: 600 });
      // scale bar
      const sb = 10 * k, sbx = sx - 76 - sb; c.strokeStyle = C.ink; c.lineWidth = 2; c.beginPath(); c.moveTo(sbx, h - 16); c.lineTo(sbx + sb, h - 16); c.stroke();
      text(c, '10 cm', sbx + sb / 2, h - 22, { color: C.ink, size: 11, align: 'center', weight: 600 });

      // challenges
      if (mode !== '1' && ratio < 0.1 && ref > 0 && !(slit && det.x < barX + BT)) {
        if (!ctx.isDone('destructive')) { ctx.complete('destructive'); }
      }
      let r1 = 0, r2 = 0;
      if (mode === '2') {
        r1 = Math.hypot(det.x - src[0].x, det.y - src[0].y); r2 = Math.hypot(det.x - src[1].x, det.y - src[1].y);
        if (Math.abs(phase - 180) < 3 && Math.abs(r1 - r2) < 0.06 * l && ratio < 0.1) ctx.complete('antiphase');
      }
      if (mode === 'slit2' && fringes >= 5) ctx.complete('fringes');

      const ro = {
        'Frequency f': `${fmt(f)} Hz`, 'Wave speed v': `${fmt(vw, 1)} cm/s`, 'Wavelength λ = v/f': `${fmt(l)} cm`, 'Period T = 1/f': `${fmt(1 / f)} s`,
      };
      if (mode === '2') {
        Object.assign(ro, {
          'Source separation d': `${fmt(Math.hypot(src[1].x - src[0].x, src[1].y - src[0].y), 1)} cm`,
          'r₁ , r₂': `${fmt(r1, 1)} , ${fmt(r2, 1)} cm`, 'Path difference Δr': `${fmt(Math.abs(r1 - r2))} cm`,
          'Δr / λ': fmt(Math.abs(r1 - r2) / l), 'Phase difference Δφ': `${phase}°`,
        });
      }
      if (slit) {
        const Ls = TANK_W - 0.8 - barX - BT, dd = Math.max(slitSep, slitW + 0.5);
        Object.assign(ro, { 'Slit width a': `${fmt(slitW)} cm`, 'Slit → screen L': `${fmt(Ls, 1)} cm` });
        if (mode === 'slit2') Object.assign(ro, { 'Slit separation d': `${fmt(dd, 1)} cm`, 'Fringe spacing λL/d': `${fmt((l * Ls) / dd, 1)} cm` });
      }
      Object.assign(ro, { 'Detector amplitude': `${Math.round(ratio * 100)} % of max`, 'Interference': kind, 'Bright fringes on screen': `${fringes}` });
      ctx.readout.set(ro);
    }

    function drawString(dt) {
      const c = s.g, w = s.w, h = s.h;
      const gr = c.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#141b30'); gr.addColorStop(1, '#0f1526'); c.fillStyle = gr; c.fillRect(0, 0, w, h);
      const x0 = 80, x1 = w - 50, yc = h * 0.36, ys = (h * 0.17) / 0.1; // 10 cm → 17% of height
      // centre line & ruler
      c.strokeStyle = C.grid2; c.lineWidth = 1; c.setLineDash([3, 5]); c.beginPath(); c.moveTo(x0, yc); c.lineTo(x1, yc); c.stroke(); c.setLineDash([]);
      const ry = yc + h * 0.24;
      c.strokeStyle = C.muted; c.beginPath(); c.moveTo(x0, ry); c.lineTo(x1, ry); c.stroke();
      const stepM = L > 1.5 ? 0.5 : 0.25;
      for (let m = 0; m <= L + 1e-6; m += stepM) { const x = x0 + (m / L) * (x1 - x0); c.beginPath(); c.moveTo(x, ry - 5); c.lineTo(x, ry + 5); c.stroke(); text(c, `${fmt(m, 2)} m`, x, ry + 18, { color: C.muted, size: 11, align: 'center' }); }

      // energies & dominant mode
      let Et = 0, En = 0, nDom = 1;
      for (let n = 1; n <= NM; n++) { const o = wn(n), E = 0.5 * (ad[n] * ad[n] + o * o * a[n] * a[n]); Et += E; if (E > En) { En = E; nDom = n; } }
      const frac = Et > 0 ? En / Et : 0;
      // shape
      const ys_ = new Float32Array(NSAMP); let ymax = 0; const dec = Math.exp(-dt * 1.2);
      for (let i = 0; i < NSAMP; i++) {
        const u = i / (NSAMP - 1); let y = 0;
        for (let n = 1; n <= NM; n++) y += a[n] * Math.sin(n * Math.PI * u);
        ys_[i] = y; env[i] = Math.max(Math.abs(y), env[i] * dec); ymax = Math.max(ymax, env[i]);
      }
      const X = (i) => x0 + (i / (NSAMP - 1)) * (x1 - x0), Yp = (y) => yc - clamp(y * ys, -h * 0.3, h * 0.3);
      // envelope
      c.fillStyle = 'rgba(195,139,255,.16)'; c.beginPath();
      for (let i = 0; i < NSAMP; i++) i ? c.lineTo(X(i), Yp(env[i])) : c.moveTo(X(i), Yp(env[i]));
      for (let i = NSAMP - 1; i >= 0; i--) c.lineTo(X(i), Yp(-env[i]));
      c.fill();
      // string
      c.strokeStyle = C.gold; c.lineWidth = 3; c.lineJoin = 'round'; c.beginPath();
      for (let i = 0; i < NSAMP; i++) i ? c.lineTo(X(i), Yp(ys_[i])) : c.moveTo(X(i), Yp(ys_[i]));
      c.stroke();
      // clamps + driver
      const drv = Math.cos(TAU * fd * tS) * 5;
      c.fillStyle = '#50607e'; c.fillRect(x0 - 46, yc - 30 + drv, 34, 60); c.fillRect(x1 + 4, yc - 40, 16, 80);
      c.fillStyle = '#7b879f'; c.fillRect(x0 - 12, yc - 4, 12, 8);
      text(c, 'driver', x0 - 29, yc + 46, { color: C.muted, size: 11, align: 'center' });
      text(c, `${fmt(fd)} Hz`, x0 - 29, yc - 38, { color: C.accent, size: 11, weight: 700, align: 'center' });

      const resonant = frac > 0.85 && ymax > 0.06;
      if (resonant || (frac > 0.8 && ymax > 0.03)) {
        for (let j = 0; j <= nDom; j++) {
          const x = x0 + (j / nDom) * (x1 - x0);
          c.fillStyle = C.good; c.beginPath(); c.arc(x, yc, 5, 0, TAU); c.fill();
          text(c, 'N', x, yc + 20, { color: C.good, size: 11, weight: 700, align: 'center' });
        }
        for (let j = 0; j < nDom; j++) {
          const x = x0 + ((j + 0.5) / nDom) * (x1 - x0), A = Math.abs(env[Math.round(((j + 0.5) / nDom) * (NSAMP - 1))]);
          arrow(c, x, yc, x, Yp(A), C.purple, 2); arrow(c, x, yc, x, Yp(-A), C.purple, 2);
          text(c, 'A', x + 8, yc - 6, { color: C.purple, size: 11, weight: 700 });
        }
        if (resonant) {
          text(c, `RESONANCE · n = ${nDom} · ${ORD[nDom]} harmonic`, w / 2, 62, { color: C.good, size: 17, weight: 800, align: 'center' });
          text(c, `λ = 2L/n = ${fmt((2 * L) / nDom)} m`, w / 2, 82, { color: C.ink, size: 12, align: 'center' });
          if (nDom === 3) ctx.complete('third');
        }
      }

      // resonance curve
      const r = plotRect();
      c.fillStyle = 'rgba(10,14,26,.6)'; c.fillRect(r.x - 10, r.y - 16, r.w + 20, r.h + 36);
      const Aref = (F0 / (2 * GAM)) * 1.25;
      c.strokeStyle = C.grid2; c.lineWidth = 1; c.beginPath(); c.moveTo(r.x, r.y + r.h); c.lineTo(r.x + r.w, r.y + r.h); c.moveTo(r.x, r.y); c.lineTo(r.x, r.y + r.h); c.stroke();
      for (let ff = 0; ff <= fMax; ff += 2) text(c, `${ff}`, r.x + (ff / fMax) * r.w, r.y + r.h + 14, { color: C.muted, size: 10.5, align: 'center' });
      text(c, 'f (Hz)', r.x + r.w, r.y + r.h - 6, { color: C.muted, size: 11, align: 'right' });
      text(c, 'steady amplitude', r.x + 6, r.y - 4, { color: C.muted, size: 11 });
      const f1 = vs / (2 * L);
      for (let n = 1; n * f1 <= fMax && n <= NM; n++) {
        const x = r.x + ((n * f1) / fMax) * r.w;
        c.strokeStyle = 'rgba(91,227,138,.25)'; c.setLineDash([2, 4]); c.beginPath(); c.moveTo(x, r.y); c.lineTo(x, r.y + r.h); c.stroke(); c.setLineDash([]);
        if (n <= 8 || n % 2 === 0) text(c, 'f' + sub(n), x, r.y + 10, { color: C.good, size: 10.5, align: 'center', weight: 700 });
      }
      c.strokeStyle = C.purple; c.lineWidth = 2; c.beginPath();
      for (let i = 0; i <= 400; i++) { const ff = Math.max(0.05, (i / 400) * fMax), y = r.y + r.h - clamp(response(ff) / Aref, 0, 1) * r.h; i ? c.lineTo(r.x + (i / 400) * r.w, y) : c.moveTo(r.x, y); }
      c.stroke();
      const cx = r.x + (fd / fMax) * r.w;
      c.strokeStyle = C.accent; c.lineWidth = 2; c.beginPath(); c.moveTo(cx, r.y); c.lineTo(cx, r.y + r.h); c.stroke();
      c.fillStyle = C.gold; c.beginPath(); c.arc(cx, r.y + r.h - clamp(ymax / Aref, 0, 1) * r.h, 6, 0, TAU); c.fill();

      ctx.readout.set({
        'String length L': `${fmt(L)} m`, 'Wave speed v': `${fmt(vs, 1)} m/s`, 'Driver frequency f': `${fmt(fd)} Hz`,
        'Wavelength λ = v/f': `${fmt(vs / fd)} m`, 'Fundamental f₁ = v/2L': `${fmt(f1)} Hz`, 'f / f₁': fmt(fd / f1),
        'Amplitude (max)': `${fmt(ymax * 100, 1)} cm`, 'Mode': resonant ? `${ORD[nDom]} harmonic ✓` : 'off resonance',
      });
    }

    return { destroy() { stop(); unPtr(); s.destroy(); } };
  },
};
