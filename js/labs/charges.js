import { makeCanvas, loop, slider, select, buttons, checkbox, arrow, text, hint, pointer, fmt, clamp, C } from '../ui.js';

// Physics constants and scale
const K = 8.99e9;          // Coulomb constant, N·m²/C²
const PX = 0.01;           // 1 px = 1 cm = 0.01 m
const QT = 5e-9;           // test charge +5 nC
const MT = 1e-4;           // test charge mass 0.1 g
const SOFT = 0.06 ** 2;    // softening (m²) so the test charge never feels an infinite force
const HIT_R = 12;          // px: test charge crashes into a source charge

// Levels: positions are fractions of the canvas (so they survive resizes)
const LEVELS = {
  l1: { name: 'Level 1 · Curve ball', start: [0.05, 0.55], goal: [0.86, 0.2], gr: 36, max: 3, walls: [], fixed: [], tip: 'Bend the path up into the ring.' },
  l2: { name: 'Level 2 · The wall', start: [0.05, 0.5], goal: [0.88, 0.5], gr: 34, max: 4, walls: [[0.43, 0.2, 0.05, 0.6]], fixed: [], tip: 'Go around the wall, then come back to the ring.' },
  l3: { name: 'Level 3 · U-turn', start: [0.05, 0.8], goal: [0.13, 0.2], gr: 36, max: 5, walls: [[0, 0.46, 0.44, 0.05], [0.72, 0.08, 0.04, 0.3]], fixed: [[0.6, 0.66, -2]], tip: 'Turn all the way around — mind the −2 μC trap.' },
};

export default {
  title: 'Electric Field Playground',
  icon: '⚡',
  blurb: 'Place and drag point charges, see the field and potential, then steer a test charge into the goal.',
  theory: `
    <p>Every point charge creates an electric field around it. It points <b>away</b> from positive charges and <b>toward</b> negative ones, and gets weaker with the square of the distance (Coulomb's law):</p>
    <div class="eq">E = k·|q| / r²  &nbsp; (k = 8.99×10⁹ N·m²/C²)</div>
    <p>When there are several charges, you add their fields as vectors (superposition). The electric potential is a scalar, so you just add the numbers:</p>
    <div class="eq">V = Σ k·qᵢ / rᵢ</div>
    <p>Put a charge q in a field and it feels a force <b>F = q·E</b>. Two point charges push or pull on each other with</p>
    <div class="eq">F = k·q₁·q₂ / r²</div>
    <p>Field lines start on + charges and end on − charges. They always cross the equipotential lines at right angles. In this lab <b>1 px = 1 cm</b>. The test charge is +5 nC with a mass of 0.1 g, and there's no gravity.</p>`,
  challenges: [
    { id: 'dipole', text: 'Build a <b>dipole</b>: one + and one − charge of equal size', xp: 15 },
    { id: 'l1', text: 'Game: guide the test charge into the ring on <b>Level 1</b>', xp: 25 },
    { id: 'l2', text: 'Game: beat <b>Level 2</b> (get around the wall)', xp: 35 },
    { id: 'zero', text: 'Put two <b>equal like charges</b> on the board and drag the probe to a spot between them where <b>E ≈ 0</b>', xp: 30 },
    { id: 'force', text: 'Two charges of 1 μC each sit 10 cm apart. What force does each one feel? (N)', xp: 30, check: v => Math.abs(v - 0.899) < 0.02, placeholder: 'newtons' },
    { id: 'pot', text: 'Predict the potential V at 50 cm from a single +2 μC charge, then check it with the probe (kV)', xp: 30, check: v => Math.abs(v - 35.96) < 0.8, placeholder: 'kV' },
  ],
  mount(ctx) {
    const s = makeCanvas(ctx.stage);
    hint(ctx.stage, 'Drag charges · click or drag anywhere to move the probe · double-click a charge to remove it · Space = launch');

    let mode = 'sandbox', mag = 1, speed = 1.5;
    let showVec = true, showLines = true, showPot = false;
    const charges = [];            // {x, y, q (μC), fixed?}
    const probe = { x: 0, y: 0, placed: false };
    let test = null, trails = [], banner = null, selected = null, attempts = 0;

    // --- controls
    select(ctx.controls, {
      label: 'Mode', value: mode,
      options: [['sandbox', 'Sandbox (free play)'], ...Object.entries(LEVELS).map(([k, L]) => [k, `🎮 ${L.name}`])],
      onChange: v => setMode(v),
    });
    const sq = slider(ctx.controls, {
      label: 'Charge size |q|', min: 0.5, max: 5, step: 0.5, value: mag, unit: 'μC', fmt: v => v.toFixed(1),
      onInput: v => { mag = v; if (selected && !selected.fixed) selected.q = Math.sign(selected.q) * v; relabel(); },
    });
    const [bPos, bNeg] = buttons(ctx.controls, [
      { label: '', onClick: () => addCharge(+1) },
      { label: '', onClick: () => addCharge(-1) },
      { label: '🧹 Clear', onClick: () => { clearPlayer(); } },
    ]);
    const relabel = () => { bPos.textContent = `＋ add +${mag.toFixed(1)} μC`; bNeg.textContent = `− add −${mag.toFixed(1)} μC`; };
    relabel();
    slider(ctx.controls, { label: 'Launch speed', min: 0.5, max: 3, step: 0.1, value: speed, unit: 'm/s', fmt: v => v.toFixed(1), onInput: v => (speed = v) });
    buttons(ctx.controls, [{ label: '🚀 Launch test charge', primary: true, onClick: launch }, { label: 'Reset shot', onClick: () => { test = null; trails = []; } }]);
    checkbox(ctx.controls, { label: 'Field vectors (arrow grid)', value: showVec, onChange: v => (showVec = v) });
    checkbox(ctx.controls, { label: 'Field lines', value: showLines, onChange: v => (showLines = v) });
    checkbox(ctx.controls, { label: 'Potential map + equipotentials', value: showPot, onChange: v => (showPot = v) });

    const onKey = (e) => {
      if (e.code === 'Space' && !['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) { e.preventDefault(); launch(); }
    };
    addEventListener('keydown', onKey);

    const L = () => LEVELS[mode];
    const P = (fx, fy) => ({ x: fx * s.w, y: fy * s.h });
    const all = () => charges.concat(fixedCharges());
    function fixedCharges() {
      if (!L()) return [];
      return L().fixed.map(([fx, fy, q]) => ({ x: fx * s.w, y: fy * s.h, q, fixed: true }));
    }
    function walls() { return L() ? L().walls.map(([x, y, w, h]) => ({ x: x * s.w, y: y * s.h, w: w * s.w, h: h * s.h })) : []; }
    function startPt() { return L() ? P(...L().start) : P(0.04, 0.5); }
    function goal() { return L() ? { ...P(...L().goal), r: L().gr } : null; }

    function setMode(v) {
      mode = v; clearPlayer(); attempts = 0;
      if (L()) { ctx.toast(`${L().name}: ${L().tip} (max ${L().max} charges)`, 'info'); }
    }
    function clearPlayer() { charges.length = 0; selected = null; test = null; trails = []; }

    function addCharge(sign) {
      if (test && !test.done) return ctx.toast('Wait for the test charge to finish', 'info');
      if (L() && charges.length >= L().max) return ctx.toast(`Max ${L().max} charges on this level`, 'warn');
      // pick a free spot near the centre
      let best = null;
      for (let i = 0; i < 30; i++) {
        const x = s.w * (0.3 + Math.random() * 0.4), y = s.h * (0.25 + Math.random() * 0.5);
        const d = Math.min(1e9, ...all().map(c => Math.hypot(c.x - x, c.y - y)), ...walls().map(w => inRect(x, y, w, 20) ? 0 : 1e9));
        if (!best || d > best.d) best = { x, y, d };
      }
      const c = { x: best.x, y: best.y, q: sign * mag };
      charges.push(c); selected = c;
    }

    // --- field math (SI units, positions in px)
    function field(x, y, soft = 0) {
      let ex = 0, ey = 0, v = 0;
      for (const c of all()) {
        const dx = (x - c.x) * PX, dy = (y - c.y) * PX, r2 = dx * dx + dy * dy + soft, r = Math.sqrt(r2);
        const kq = K * c.q * 1e-6, e = kq / r2;
        ex += e * dx / r; ey += e * dy / r; v += kq / r;
      }
      return { ex, ey, v, m: Math.hypot(ex, ey) };
    }

    // --- pointer interaction
    let drag = null;
    const hitCharge = (p) => {
      let best = null, bd = 20;
      for (const c of charges) { const d = Math.hypot(c.x - p.x, c.y - p.y); if (d < bd) { bd = d; best = c; } }
      return best;
    };
    const offPointer = pointer(s.cv, {
      down(p) {
        const c = hitCharge(p);
        if (c) {
          if (test && !test.done) { ctx.toast('Charges are locked while the test charge flies', 'info'); return; }
          drag = { c, dx: c.x - p.x, dy: c.y - p.y }; selected = c; sq.input.value = Math.abs(c.q); sq.input.dispatchEvent(new Event('input'));
        } else { drag = { probe: true }; probe.x = p.x; probe.y = p.y; probe.placed = true; }
      },
      move(p) {
        if (!drag) { s.cv.style.cursor = hitCharge(p) ? 'grab' : 'crosshair'; return; }
        if (drag.probe) { probe.x = clamp(p.x, 0, s.w); probe.y = clamp(p.y, 0, s.h); }
        else { drag.c.x = clamp(p.x + drag.dx, 10, s.w - 10); drag.c.y = clamp(p.y + drag.dy, 10, s.h - 10); }
      },
      up() { drag = null; },
    });
    const onDbl = (e) => {
      const r = s.cv.getBoundingClientRect(), c = hitCharge({ x: e.clientX - r.left, y: e.clientY - r.top });
      if (c && !(test && !test.done)) { charges.splice(charges.indexOf(c), 1); if (selected === c) selected = null; }
    };
    s.cv.addEventListener('dblclick', onDbl);

    // --- test charge
    function launch() {
      const st = startPt();
      test = { x: st.x, y: st.y, vx: speed / PX, vy: 0, t: 0, path: [[st.x, st.y]], done: false, fx: 0, fy: 0 };
      attempts++;
    }
    function stepTest(T, h) {
      const f = field(T.x, T.y, SOFT);
      const ax = QT * f.ex / MT / PX, ay = QT * f.ey / MT / PX; // px/s²
      T.vx += ax * h; T.vy += ay * h; T.x += T.vx * h; T.y += T.vy * h; T.t += h;
      T.fx = QT * f.ex; T.fy = QT * f.ey;
    }
    function checkTest(T) {
      const G = goal();
      if (G && Math.hypot(T.x - G.x, T.y - G.y) < G.r - 4) return 'goal';
      for (const w of walls()) if (inRect(T.x, T.y, w, 4)) return 'wall';
      for (const c of all()) if (Math.hypot(c.x - T.x, c.y - T.y) < HIT_R) return 'zap';
      if (T.x < -20 || T.y < -20 || T.x > s.w + 20 || T.y > s.h + 20) return 'out';
      if (T.t > 25) return 'time';
      return null;
    }
    function finish(res) {
      test.done = true; trails.push({ path: test.path, ok: res === 'goal' }); if (trails.length > 5) trails.shift();
      const msgs = { wall: 'Crashed into a wall 💥', zap: 'Zapped by a charge ⚡', out: 'Flew off the board', time: 'Out of time ⏱' };
      if (res === 'goal') {
        banner = { text: 'GOAL!', color: C.good, t: 0 };
        if (mode === 'l1' || mode === 'l2') ctx.complete(mode);
        else ctx.toast(`🏆 ${L().name} cleared in ${attempts} shot${attempts > 1 ? 's' : ''}!`);
        if (mode !== 'l3') ctx.toast(`🎯 Goal in ${fmt(test.t, 1)} s after ${attempts} shot${attempts > 1 ? 's' : ''}`);
      } else {
        banner = { text: msgs[res], color: C.bad, t: 0 };
        if (mode !== 'sandbox') ctx.toast(msgs[res] + ' — move your charges and try again', 'info');
      }
    }

    // --- cached layers
    let potKey = '', potCanvas = document.createElement('canvas');
    let linesKey = '', linesCache = [];
    const keyOf = () => all().map(c => `${c.x | 0},${c.y | 0},${c.q}`).join(';') + `|${s.w | 0}x${s.h | 0}`;

    let contours = [];
    function buildPotential() {
      const cell = 4, cols = Math.ceil(s.w / cell) + 1, rows = Math.ceil(s.h / cell) + 1;
      potCanvas.width = cols; potCanvas.height = rows;
      const pg = potCanvas.getContext('2d'), img = pg.createImageData(cols, rows), d = img.data;
      const V0 = 2000, A = new Float32Array(cols * rows);
      const cs = all();
      // asinh-compressed potential sampled at grid nodes (x = i·cell)
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const x = i * cell, y = j * cell;
        let v = 0;
        for (const c of cs) { const r = Math.max(0.02, Math.hypot(x - c.x, y - c.y) * PX); v += K * c.q * 1e-6 / r; }
        const a = Math.asinh(v / V0), k = j * cols + i, t = Math.min(1, Math.abs(a) / 7) * 0.8;
        A[k] = a;
        const col = a > 0 ? [255, 107, 122] : [90, 170, 255];
        d[k * 4] = 21 + (col[0] - 21) * t; d[k * 4 + 1] = 29 + (col[1] - 29) * t; d[k * 4 + 2] = 48 + (col[2] - 48) * t; d[k * 4 + 3] = 255;
      }
      pg.putImageData(img, 0, 0);
      // equipotentials by marching squares (evenly spaced in asinh(V/V0))
      contours = [];
      if (!cs.length) return;
      const levels = []; for (let n = -9; n <= 9; n++) levels.push(n / 1.3);
      const segs = new Map(levels.map(l => [l, []]));
      for (let j = 0; j < rows - 1; j++) for (let i = 0; i < cols - 1; i++) {
        const k = j * cols + i, v00 = A[k], v10 = A[k + 1], v01 = A[k + cols], v11 = A[k + cols + 1];
        const lo = Math.min(v00, v10, v01, v11), hi = Math.max(v00, v10, v01, v11);
        if (hi - lo > 2.5) continue; // too close to a charge
        for (const L of levels) {
          if (L < lo || L > hi) continue;
          const pts = [], x0 = i * cell, y0 = j * cell;
          const e = (a, b, ax, ay, bx, by) => { if ((a < L) !== (b < L)) { const t = (L - a) / (b - a); pts.push(ax + (bx - ax) * t, ay + (by - ay) * t); } };
          e(v00, v10, x0, y0, x0 + cell, y0); e(v10, v11, x0 + cell, y0, x0 + cell, y0 + cell);
          e(v11, v01, x0 + cell, y0 + cell, x0, y0 + cell); e(v01, v00, x0, y0 + cell, x0, y0);
          if (pts.length >= 4) segs.get(L).push(pts.slice(0, 4));
          if (pts.length === 8) segs.get(L).push(pts.slice(4, 8));
        }
      }
      for (const [L, list] of segs) if (list.length) contours.push({ L, list });
    }

    function buildLines() {
      linesCache = [];
      const cs = all(), pos = cs.filter(c => c.q > 0), neg = cs.filter(c => c.q < 0);
      const seeds = pos.length ? pos : neg, dir = pos.length ? 1 : -1, sinks = pos.length ? neg : pos;
      for (const c of seeds) {
        const n = clamp(Math.round(10 * Math.abs(c.q)), 6, 40);
        for (let k = 0; k < n; k++) {
          const a = (k + 0.5) / n * Math.PI * 2;
          let x = c.x + Math.cos(a) * 9, y = c.y + Math.sin(a) * 9;
          const pts = [[x, y]];
          for (let st = 0; st < 900; st++) {
            // RK2 along unit field direction
            const f1 = field(x, y), m1 = f1.m || 1;
            const xm = x + dir * 2 * f1.ex / m1, ym = y + dir * 2 * f1.ey / m1;
            const f2 = field(xm, ym), m2 = f2.m || 1;
            x += dir * 4 * f2.ex / m2; y += dir * 4 * f2.ey / m2;
            pts.push([x, y]);
            if (x < -60 || y < -60 || x > s.w + 60 || y > s.h + 60) break;
            if (sinks.some(o => Math.hypot(o.x - x, o.y - y) < 8)) break;
            if (cs.some(o => o !== c && o.q * c.q > 0 && Math.hypot(o.x - x, o.y - y) < 6)) break;
          }
          linesCache.push({ pts, dir });
        }
      }
    }

    // --- challenge checks each frame
    let zeroHold = 0;
    function checkChallenges(dt) {
      const cs = all();
      if (!ctx.isDone('dipole')) {
        for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++)
          if (Math.abs(cs[i].q + cs[j].q) < 1e-9 && !cs[i].fixed && !cs[j].fixed) { ctx.complete('dipole'); i = j = 1e9; }
      }
      if (!ctx.isDone('zero') && probe.placed && !drag?.c) {
        let ok = false;
        for (let i = 0; i < cs.length && !ok; i++) for (let j = i + 1; j < cs.length && !ok; j++) {
          const a = cs[i], b = cs[j];
          if (Math.abs(a.q - b.q) > 1e-9) continue;
          const sep = Math.hypot(a.x - b.x, a.y - b.y);
          const da = Math.hypot(probe.x - a.x, probe.y - a.y), db = Math.hypot(probe.x - b.x, probe.y - b.y);
          if (da > sep || db > sep || sep < 30) continue;
          const f = field(probe.x, probe.y), single = K * Math.abs(a.q) * 1e-6 / (Math.min(da, db) * PX) ** 2;
          if (f.m < 0.15 * single) ok = true;
        }
        zeroHold = ok ? zeroHold + dt : 0;
        if (zeroHold > 0.4) { ctx.complete('zero'); ctx.toast('E = 0 here: the two fields cancel exactly'); }
      }
    }

    // --- main loop
    const stop = loop((dt) => {
      if (!probe.placed) { probe.x = s.w * 0.5; probe.y = s.h * 0.5; }
      if (test && !test.done) {
        const sub = 24, h = dt / sub;
        for (let i = 0; i < sub; i++) { stepTest(test, h); const r = checkTest(test); if (r) { finish(r); break; } }
        test.path.push([test.x, test.y]);
      }
      checkChallenges(dt);
      draw(dt);
    });

    function draw(dt) {
      const { g, w, h } = s, cs = all();
      // background / potential map
      const key = keyOf();
      if (showPot) {
        if (key !== potKey) { buildPotential(); potKey = key; }
        g.imageSmoothingEnabled = true; g.drawImage(potCanvas, -2, -2, potCanvas.width * 4, potCanvas.height * 4);
        for (const { L, list } of contours) {
          g.strokeStyle = L === 0 ? 'rgba(255,255,255,.55)' : 'rgba(235,240,250,.4)'; g.lineWidth = 1.2;
          if (L === 0) g.setLineDash([5, 4]);
          g.beginPath(); for (const [a, b, c2, d2] of list) { g.moveTo(a, b); g.lineTo(c2, d2); } g.stroke(); g.setLineDash([]);
        }
      } else {
        g.fillStyle = C.bg; g.fillRect(0, 0, w, h);
        g.strokeStyle = C.grid; g.lineWidth = 1; g.beginPath();
        for (let x = 0; x < w; x += 50) { g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, h); }
        for (let y = 0; y < h; y += 50) { g.moveTo(0, y + 0.5); g.lineTo(w, y + 0.5); }
        g.stroke();
      }

      // vector grid
      if (showVec && cs.length) {
        const sp = 30;
        for (let y = sp / 2; y < h; y += sp) for (let x = sp / 2; x < w; x += sp) {
          if (cs.some(c => Math.hypot(c.x - x, c.y - y) < 16)) continue;
          const f = field(x, y); if (!f.m) continue;
          const t = clamp((Math.log10(f.m) - 2.5) / 3.5, 0, 1), len = 7 + 15 * t;
          const ux = f.ex / f.m, uy = f.ey / f.m;
          const hue = 205 - 160 * t;
          arrow(g, x - ux * len / 2, y - uy * len / 2, x + ux * len / 2, y + uy * len / 2, `hsla(${hue},90%,65%,${0.18 + 0.72 * t})`, 1.4);
        }
      }

      // field lines
      if (showLines && cs.length) {
        if (key !== linesKey) { buildLines(); linesKey = key; }
        g.strokeStyle = 'rgba(232,237,247,.38)'; g.lineWidth = 1.2;
        for (const ln of linesCache) {
          g.beginPath(); ln.pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
          const m = Math.min(ln.pts.length - 2, 28);
          if (m > 2) {
            const [x1, y1] = ln.pts[m], [x2, y2] = ln.pts[m + 1];
            const a = Math.atan2((y2 - y1) * ln.dir, (x2 - x1) * ln.dir);
            g.save(); g.translate(x1, y1); g.rotate(a); g.fillStyle = 'rgba(232,237,247,.6)';
            g.beginPath(); g.moveTo(4, 0); g.lineTo(-3, -3.5); g.lineTo(-3, 3.5); g.fill(); g.restore();
          }
        }
      }

      // level: walls, start pad, goal
      for (const wl of walls()) {
        g.fillStyle = '#39445f'; g.fillRect(wl.x, wl.y, wl.w, wl.h);
        g.save(); g.beginPath(); g.rect(wl.x, wl.y, wl.w, wl.h); g.clip(); g.strokeStyle = 'rgba(255,204,77,.35)'; g.lineWidth = 3;
        for (let k = -wl.h; k < wl.w + wl.h; k += 14) { g.beginPath(); g.moveTo(wl.x + k, wl.y); g.lineTo(wl.x + k - wl.h, wl.y + wl.h); g.stroke(); }
        g.restore(); g.strokeStyle = '#6b7896'; g.lineWidth = 1.5; g.strokeRect(wl.x, wl.y, wl.w, wl.h);
      }
      const st = startPt();
      g.fillStyle = 'rgba(255,204,77,.15)'; g.beginPath(); g.arc(st.x, st.y, 16, 0, Math.PI * 2); g.fill();
      arrow(g, st.x - 4, st.y, st.x + 26, st.y, 'rgba(255,204,77,.7)', 2);
      const G = goal();
      if (G) {
        const pulse = 1 + 0.06 * Math.sin(performance.now() / 250);
        g.strokeStyle = C.good; g.lineWidth = 4; g.beginPath(); g.arc(G.x, G.y, G.r * pulse, 0, Math.PI * 2); g.stroke();
        g.strokeStyle = 'rgba(91,227,138,.35)'; g.lineWidth = 2; g.beginPath(); g.arc(G.x, G.y, G.r * 0.55, 0, Math.PI * 2); g.stroke();
        text(g, 'GOAL', G.x, G.y + 4, { color: C.good, size: 11, weight: 800, align: 'center' });
        text(g, `${L().name}  ·  charges ${charges.length}/${L().max}  ·  shots ${attempts}`, w - 14, h - 14, { color: C.muted, size: 12, weight: 600, align: 'right' });
      }

      // preview (first 0.6 s) and old trails
      if (L() && !(test && !test.done)) {
        const T = { x: st.x, y: st.y, vx: speed / PX, vy: 0, t: 0 };
        g.fillStyle = 'rgba(255,204,77,.45)';
        for (let i = 0; i < 60; i++) { for (let k = 0; k < 4; k++) stepTest(T, 0.0025); if (i % 3 === 0) { g.beginPath(); g.arc(T.x, T.y, 1.6, 0, Math.PI * 2); g.fill(); } if (checkTest(T)) break; }
      }
      for (const tr of trails) {
        g.strokeStyle = tr.ok ? 'rgba(91,227,138,.6)' : 'rgba(255,255,255,.22)'; g.setLineDash([4, 5]); g.lineWidth = 2;
        g.beginPath(); tr.path.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); g.setLineDash([]);
      }

      // charges
      for (const c of cs) drawCharge(g, c, c === selected);

      // probe
      const pf = field(probe.x, probe.y);
      if (pf.m && cs.length) {
        const t = clamp((Math.log10(pf.m) - 2.5) / 3.5, 0, 1), len = 20 + 50 * t;
        arrow(g, probe.x, probe.y, probe.x + pf.ex / pf.m * len, probe.y + pf.ey / pf.m * len, C.gold, 2.5, 'E');
      }
      g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.beginPath(); g.arc(probe.x, probe.y, 8, 0, Math.PI * 2);
      g.moveTo(probe.x - 13, probe.y); g.lineTo(probe.x + 13, probe.y); g.moveTo(probe.x, probe.y - 13); g.lineTo(probe.x, probe.y + 13); g.stroke();
      const lx = probe.x + 16 + 150 > w ? probe.x - 166 : probe.x + 16, ly = probe.y + 22 + 40 > h ? probe.y - 60 : probe.y + 22;
      g.fillStyle = 'rgba(14,20,34,.82)'; g.fillRect(lx, ly, 150, 38);
      text(g, `|E| = ${sci(pf.m)} N/C`, lx + 8, ly + 15, { size: 12, weight: 600, color: C.gold });
      text(g, `V = ${siV(pf.v)}`, lx + 8, ly + 31, { size: 12, weight: 600 });
      if (zeroHold > 0) text(g, 'E ≈ 0 ✓', probe.x, probe.y - 18, { color: C.good, size: 13, weight: 800, align: 'center' });

      // test charge
      if (test) {
        g.strokeStyle = C.gold; g.lineWidth = 2.5; g.beginPath(); test.path.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
        if (!test.done) {
          const fm = Math.hypot(test.fx, test.fy);
          if (fm > 0) { const l = clamp(12 * Math.log10(1 + fm / 1e-5), 6, 60); arrow(g, test.x, test.y, test.x + test.fx / fm * l, test.y + test.fy / fm * l, C.bad, 2.2, 'F'); }
          arrow(g, test.x, test.y, test.x + test.vx * 0.12, test.y + test.vy * 0.12, C.accent, 2, 'v');
          const gl = g.createRadialGradient(test.x, test.y, 0, test.x, test.y, 14);
          gl.addColorStop(0, 'rgba(255,230,150,.9)'); gl.addColorStop(1, 'rgba(255,204,77,0)');
          g.fillStyle = gl; g.beginPath(); g.arc(test.x, test.y, 14, 0, Math.PI * 2); g.fill();
          g.fillStyle = '#fff'; g.beginPath(); g.arc(test.x, test.y, 5, 0, Math.PI * 2); g.fill();
        }
      }
      if (banner) {
        banner.t += dt;
        g.globalAlpha = clamp(1.6 - banner.t, 0, 1);
        text(g, banner.text, w / 2, h / 2, { color: banner.color, size: banner.text === 'GOAL!' ? 56 : 30, weight: 900, align: 'center', base: 'middle' });
        g.globalAlpha = 1; if (banner.t > 1.6) banner = null;
      }

      // scale bar
      g.fillStyle = C.ink; g.fillRect(14, h - 22, 100, 3); g.fillRect(14, h - 27, 2, 13); g.fillRect(112, h - 27, 2, 13);
      text(g, '1 m   (1 px = 1 cm)', 14, h - 30, { size: 11, color: C.muted, weight: 600 });

      // readout
      const net = cs.reduce((a, c) => a + c.q, 0);
      let near = Infinity; for (const c of cs) near = Math.min(near, Math.hypot(c.x - probe.x, c.y - probe.y));
      const ang = Math.atan2(-pf.ey, pf.ex) * 180 / Math.PI;
      ctx.readout.set({
        'Scale': '1 px = 1 cm',
        'Charges (net)': `${cs.length}  (${net > 0 ? '+' : ''}${fmt(net, 1)} μC)`,
        'Probe |E|': cs.length ? `${sci(pf.m)} N/C` : '—',
        'Probe E direction': cs.length && pf.m ? `${fmt(ang, 0)}°` : '—',
        'Probe V': cs.length ? siV(pf.v) : '—',
        'Probe → nearest q': isFinite(near) ? `${fmt(near, 1)} cm` : '—',
        'Test charge': '+5 nC, 0.1 g',
        'Test |v|': test ? `${fmt(Math.hypot(test.vx, test.vy) * PX, 2)} m/s` : '—',
        'Test |F| = q|E|': test ? `${sci(Math.hypot(test.fx, test.fy))} N` : '—',
        'Flight time': test ? `${fmt(test.t, 2)} s` : '—',
      });
    }

    return { destroy() { stop(); offPointer(); removeEventListener('keydown', onKey); s.cv.removeEventListener('dblclick', onDbl); s.destroy(); } };
  },
};

function drawCharge(g, c, sel) {
  const r = 10 + 3.2 * Math.sqrt(Math.abs(c.q)), pos = c.q > 0;
  const gl = g.createRadialGradient(c.x - r * 0.3, c.y - r * 0.3, 1, c.x, c.y, r);
  gl.addColorStop(0, pos ? '#ffc2c9' : '#c8f0ff'); gl.addColorStop(1, pos ? C.pos : '#2f8fd6');
  g.save();
  g.shadowColor = pos ? 'rgba(255,107,122,.7)' : 'rgba(90,209,255,.7)'; g.shadowBlur = 14;
  g.fillStyle = gl; g.beginPath(); g.arc(c.x, c.y, r, 0, Math.PI * 2); g.fill(); g.restore();
  if (c.fixed) { g.strokeStyle = '#c9d1e3'; g.setLineDash([3, 3]); g.lineWidth = 2; g.beginPath(); g.arc(c.x, c.y, r + 5, 0, Math.PI * 2); g.stroke(); g.setLineDash([]); }
  if (sel) { g.strokeStyle = C.gold; g.lineWidth = 2; g.beginPath(); g.arc(c.x, c.y, r + 4, 0, Math.PI * 2); g.stroke(); }
  g.strokeStyle = '#0b1220'; g.lineWidth = 2.6; g.beginPath();
  g.moveTo(c.x - r * 0.45, c.y); g.lineTo(c.x + r * 0.45, c.y);
  if (pos) { g.moveTo(c.x, c.y - r * 0.45); g.lineTo(c.x, c.y + r * 0.45); }
  g.stroke();
  text(g, `${pos ? '+' : '−'}${Math.abs(c.q).toFixed(1)} μC${c.fixed ? ' 🔒' : ''}`, c.x, c.y + r + 14, { size: 11, weight: 700, align: 'center', color: C.ink });
}

function inRect(x, y, r, pad = 0) { return x > r.x - pad && x < r.x + r.w + pad && y > r.y - pad && y < r.y + r.h + pad; }

const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
function sci(v) {
  const a = Math.abs(v);
  if (a === 0) return '0';
  if (a >= 0.01 && a < 999.5) return v.toPrecision(3);
  const e = Math.floor(Math.log10(a)), m = v / 10 ** e;
  return `${m.toFixed(2)}×10${String(e).split('').map(ch => SUP[ch]).join('')}`;
}
function siV(v) {
  const a = Math.abs(v);
  if (a >= 1e6) return `${fmt(v / 1e6, 2)} MV`;
  if (a >= 1e3) return `${fmt(v / 1e3, 1)} kV`;
  return `${fmt(v, 0)} V`;
}
