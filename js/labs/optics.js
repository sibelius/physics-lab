import { makeCanvas, loop, slider, select, buttons, checkbox, arrow, text, hint, pointer, fmt, clamp, C } from '../ui.js';

const WW = 100, WH = 62.5;          // bench size in cm
const MYSTERY_F = 24;               // secret focal length of the ❓ lens (cm)
const D2R = Math.PI / 180, R2D = 180 / Math.PI;

const TOOLS = {
  mirror: { label: '🪞 Mirror', make: () => ({ type: 'mirror', len: 12, ang: 45 }) },
  block: { label: '🧊 Glass block', make: () => ({ type: 'block', w: 14, h: 9, ang: 0, n: 1.5 }) },
  prism: { label: '🔺 Prism 60°', make: () => ({ type: 'prism', size: 14, ang: 0, n: 1.5 }) },
  rprism: { label: '◤ Right-angle prism', make: () => ({ type: 'rprism', size: 12, ang: 0, n: 1.5 }) },
  convex: { label: '🔍 Convex lens', make: () => ({ type: 'lens', len: 14, ang: 90, f: 15 }) },
  concave: { label: '⌛ Concave lens', make: () => ({ type: 'lens', len: 14, ang: 90, f: -15 }) },
  mystery: { label: '❓ Mystery lens', make: () => ({ type: 'lens', len: 16, ang: 90, f: MYSTERY_F, mystery: true }) },
  target: { label: '🎯 Target', make: () => ({ type: 'target', r: 2.5 }) },
};
const NAMES = { mirror: 'Flat mirror', block: 'Glass block', prism: 'Prism (60°)', rprism: 'Right-angle prism', target: 'Target' };

const LEVELS = [
  {
    name: 'Level 1 · Over the wall', text: 'The wall is in the way. Aim the laser (drag the ◯ handle) and place <b>one mirror</b> to bounce the beam onto the target.',
    laser: { x: 8, y: 50, ang: 0, move: false, rot: true }, walls: [[50, 24, 50, 62.5]], targets: [{ x: 86, y: 12 }], tools: { mirror: 1 },
  },
  {
    name: 'Level 2 · Periscope', text: 'The laser is bolted down. Build a <b>periscope</b> with two mirrors to get over both walls.',
    laser: { x: 6, y: 52, ang: 0, move: false, rot: false }, walls: [[55, 20, 55, 62.5], [30, 0, 30, 34]], targets: [{ x: 90, y: 10 }], tools: { mirror: 2 },
  },
  {
    name: 'Level 3 · No mirrors allowed', text: 'Only a right-angle glass prism. Turn the beam 90° using <b>total internal reflection</b> at its long face.',
    laser: { x: 6, y: 48, ang: 0, move: false, rot: false }, walls: [[74, 14, 74, 62.5], [20, 30, 50, 30]], targets: [{ x: 62, y: 8 }], tools: { rprism: 1 },
  },
  {
    name: 'Level 4 · Through the pinhole', text: 'A wide parallel beam must pass through a 3 cm gap. Use a <b>convex lens</b> to focus it — all 7 rays must hit the target.',
    laser: { x: 6, y: 31, ang: 0, move: false, rot: false, beam: true }, walls: [[62, 0, 62, 29.5], [62, 32.5, 62, 62.5]], targets: [{ x: 72, y: 31, need: 7 }], tools: { convex: 1 },
  },
];

export default {
  title: 'Laser & Lenses',
  icon: '🔦',
  blurb: 'Bend a laser with mirrors, glass, prisms and lenses to solve light puzzles.',
  theory: `
    <p>Light travels in straight lines until it meets a surface. Angles are always measured from the <b>normal</b> (the line perpendicular to the surface).</p>
    <p><b>Reflection:</b> the angle of reflection equals the angle of incidence.</p>
    <div class="eq">θᵣ = θ₁</div>
    <p><b>Refraction:</b> entering a slower medium (higher refractive index n = c/v) the ray bends towards the normal — Snell's law:</p>
    <div class="eq">n₁·sinθ₁ = n₂·sinθ₂</div>
    <p>Going from glass into air, sinθ₂ would exceed 1 beyond the <b>critical angle</b>; then all light is reflected — <b>total internal reflection</b>:</p>
    <div class="eq">sinθc = n₂ / n₁</div>
    <p>Some light is always reflected at a boundary (Fresnel reflection, ≈4% for glass at normal incidence) — shown here as faint rays.</p>
    <p><b>Thin lens:</b> a ray hitting the lens at height y is bent so its slope changes by −y/f. Parallel rays meet at the focal point, a distance f behind a converging lens (f &gt; 0). A diverging lens has f &lt; 0. Optical power P = 1/f (in dioptres, f in metres).</p>`,
  challenges: [
    { id: 'level1', text: 'Complete <b>Level 1</b> · Over the wall', xp: 20 },
    { id: 'level2', text: 'Complete <b>Level 2</b> · Periscope', xp: 25 },
    { id: 'level3', text: 'Complete <b>Level 3</b> · No mirrors allowed', xp: 35 },
    { id: 'tir', text: 'Achieve <b>total internal reflection</b> inside a piece of glass', xp: 25 },
    { id: 'critical', text: 'What is the critical angle for glass (n = 1.5) to air? (degrees)', xp: 30, check: v => Math.abs(v - 41.8) < 0.5, placeholder: 'degrees' },
    { id: 'mystery', text: 'Sandbox: add the <b>❓ Mystery lens</b>, switch on beam mode and <b>measure its focal length</b> (cm) — hover the focus to read the distance', xp: 45, check: v => Math.abs(v - MYSTERY_F) < 1.5, placeholder: 'cm' },
  ],
  mount(ctx) {
    const s = makeCanvas(ctx.stage);
    hint(ctx.stage, 'Drag objects to move · drag the ◯ handle (or scroll) to rotate · Del removes · grid = 5 cm');

    let mode = 'sandbox', laser, walls = [], elems = [], sel = null, beam = false, won = false, uid = 1, cursor = null;
    let last = { first: null, lit: 0, nt: 0 };

    // ---------------- controls ----------------
    select(ctx.controls, {
      label: 'Mode', value: mode,
      options: [['sandbox', '🧪 Sandbox'], ...LEVELS.map((l, i) => [String(i), l.name])],
      onChange: v => load(v),
    });
    const info = document.createElement('div'); info.style.cssText = 'font-size:13px;line-height:1.4;color:#cdd5e6;margin:0 0 8px';
    const toolBox = document.createElement('div'); toolBox.className = 'btns';
    ctx.controls.append(info, toolBox);
    const beamCb = checkbox(ctx.controls, { label: 'Beam mode (7 parallel rays)', value: beam, onChange: v => (beam = v) });
    const laserSl = slider(ctx.controls, { label: 'Laser direction', min: -180, max: 180, step: 0.5, value: 0, unit: '°', onInput: v => { if (laser && laser.rot) laser.ang = -v; } });
    buttons(ctx.controls, [
      { label: '↺ Reset', onClick: () => load(mode) },
      { label: 'Next level ▶', onClick: () => { const n = mode === 'sandbox' ? 0 : (+mode + 1) % LEVELS.length; modeSel.value = String(n); load(String(n)); } },
    ]);
    const modeSel = ctx.controls.querySelector('select');
    const selBox = document.createElement('div'); ctx.controls.appendChild(selBox);
    let angSl = null;

    function load(m) {
      mode = m; won = false; sel = null; elems = [];
      if (m === 'sandbox') {
        laser = { x: 10, y: 31, ang: 0, move: true, rot: true };
        walls = [];
        elems.push({ ...TOOLS.block.make(), id: uid++, x: 42, y: 31, ang: 20, fixed: false });
        elems.push({ ...TOOLS.prism.make(), id: uid++, x: 74, y: 22, ang: 0, fixed: false });
        info.innerHTML = 'Free play: place anything, change n and f, explore. Try a 🎯 target too!';
        beamCb.set(false);
      } else {
        const L = LEVELS[+m];
        laser = { ...L.laser };
        walls = L.walls.map(w => [...w]);
        L.targets.forEach(t => elems.push({ type: 'target', r: 2.5, need: 1, ...t, id: uid++, fixed: true }));
        info.innerHTML = `<b>${L.name}</b><br>${L.text}`;
        beamCb.set(!!L.laser.beam);
      }
      laserSl.input.disabled = !laser.rot; laserSl.set(-laser.ang);
      renderTools(); renderSel();
    }
    const toolsFor = () => (mode === 'sandbox' ? Object.fromEntries(Object.keys(TOOLS).map(k => [k, Infinity])) : LEVELS[+mode].tools);
    const kindOf = (e) => (e.type === 'lens' ? (e.mystery ? 'mystery' : e.f > 0 ? 'convex' : 'concave') : e.type);
    function renderTools() {
      toolBox.innerHTML = '';
      for (const [k, max] of Object.entries(toolsFor())) {
        const used = elems.filter(e => !e.fixed && kindOf(e) === k).length, left = max - used;
        const b = document.createElement('button'); b.className = 'btn';
        b.textContent = `＋ ${TOOLS[k].label}${Number.isFinite(max) ? ` ×${left}` : ''}`;
        b.disabled = left <= 0; if (left <= 0) b.style.opacity = '.45';
        b.onclick = () => add(k); toolBox.appendChild(b);
      }
    }
    function add(k) {
      const n = elems.filter(e => !e.fixed).length;
      const [px, py] = [[50, 31], [58, 24], [42, 38], [58, 38], [42, 24]][n % 5];
      const e = { ...TOOLS[k].make(), id: uid++, x: px, y: py, fixed: false };
      elems.push(e); sel = e; renderTools(); renderSel();
    }
    function remove(e) { elems = elems.filter(x => x !== e); if (sel === e) sel = null; renderTools(); renderSel(); }
    function renderSel() {
      selBox.innerHTML = ''; angSl = null;
      if (!sel) return;
      const e = sel, name = e.type === 'lens' ? (e.mystery ? 'Mystery lens ❓' : e.f > 0 ? 'Convex lens' : 'Concave lens') : NAMES[e.type];
      const h = document.createElement('div'); h.innerHTML = `<b style="color:var(--accent2)">Selected: ${name}</b>`; h.style.cssText = 'font-size:13px;margin:4px 0 8px'; selBox.appendChild(h);
      if (e.type !== 'target') angSl = slider(selBox, { label: 'Rotation', min: 0, max: 360, step: 0.5, value: e.ang, unit: '°', onInput: v => (e.ang = v) });
      if ('n' in e) slider(selBox, { label: 'Refractive index n', min: 1, max: 2.5, step: 0.01, value: e.n, fmt: v => v.toFixed(2), onInput: v => (e.n = v) });
      if (e.type === 'lens' && !e.mystery) slider(selBox, e.f > 0
        ? { label: 'Focal length f', min: 5, max: 40, step: 0.5, value: e.f, unit: 'cm', onInput: v => (e.f = v) }
        : { label: 'Focal length f', min: -40, max: -5, step: 0.5, value: e.f, unit: 'cm', onInput: v => (e.f = v) });
      if (!e.fixed) buttons(selBox, [{ label: '🗑 Remove', onClick: () => remove(e) }]);
    }
    load('sandbox');

    // ---------------- geometry ----------------
    function poly(e) {
      let pts;
      if (e.type === 'block') pts = [[-e.w / 2, -e.h / 2], [e.w / 2, -e.h / 2], [e.w / 2, e.h / 2], [-e.w / 2, e.h / 2]];
      else if (e.type === 'prism') { const a = e.size; pts = [[0, -a / Math.sqrt(3)], [a / 2, a / (2 * Math.sqrt(3))], [-a / 2, a / (2 * Math.sqrt(3))]]; }
      else { const a = e.size; pts = [[-a / 3, -a / 3], [2 * a / 3, -a / 3], [-a / 3, 2 * a / 3]]; } // right angle at top-left, centroid at origin
      const c = Math.cos(e.ang * D2R), sn = Math.sin(e.ang * D2R);
      return pts.map(([x, y]) => [e.x + x * c - y * sn, e.y + x * sn + y * c]);
    }
    function segEnds(e) { const c = Math.cos(e.ang * D2R), sn = Math.sin(e.ang * D2R), h = e.len / 2; return [e.x - c * h, e.y - sn * h, e.x + c * h, e.y + sn * h]; }
    const extent = (e) => (e.type === 'block' ? Math.max(e.w, e.h) / 2 : e.type === 'prism' || e.type === 'rprism' ? e.size * 0.62 : e.type === 'target' ? e.r : e.len / 2);
    const handlePos = (e) => { const r = extent(e) + 3; return [e.x + Math.cos(e.ang * D2R) * r, e.y + Math.sin(e.ang * D2R) * r]; };
    const laserDir = () => [Math.cos(laser.ang * D2R), Math.sin(laser.ang * D2R)];
    const aimHandle = () => { const [dx, dy] = laserDir(); return [laser.x + dx * 8, laser.y + dy * 8]; };

    function surfaces() {
      const out = [];
      for (const w of walls) out.push({ kind: 'wall', a: [w[0], w[1]], b: [w[2], w[3]] });
      for (const e of elems) {
        if (e.type === 'mirror') { const [x1, y1, x2, y2] = segEnds(e); out.push({ kind: 'mirror', a: [x1, y1], b: [x2, y2], e }); }
        else if (e.type === 'lens') { const [x1, y1, x2, y2] = segEnds(e); out.push({ kind: 'lens', a: [x1, y1], b: [x2, y2], e }); }
        else if (e.type !== 'target') {
          const P = poly(e), cx = P.reduce((s, p) => s + p[0], 0) / P.length, cy = P.reduce((s, p) => s + p[1], 0) / P.length;
          for (let i = 0; i < P.length; i++) {
            const a = P[i], b = P[(i + 1) % P.length], ex = b[0] - a[0], ey = b[1] - a[1], l = Math.hypot(ex, ey);
            let nx = ey / l, ny = -ex / l;
            if (((a[0] + b[0]) / 2 - cx) * nx + ((a[1] + b[1]) / 2 - cy) * ny < 0) { nx = -nx; ny = -ny; }
            out.push({ kind: 'glass', a, b, e, nx, ny });
          }
        }
      }
      return out;
    }
    function raySeg(px, py, dx, dy, a, b) {
      const ex = b[0] - a[0], ey = b[1] - a[1], den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-12) return Infinity;
      const wx = a[0] - px, wy = a[1] - py, t = (wx * ey - wy * ex) / den, u = (wx * dy - wy * dx) / den;
      return u < 0 || u > 1 || t <= 1e-4 ? Infinity : t;
    }
    function rayCircle(px, py, dx, dy, cx, cy, r) {
      const fx = px - cx, fy = py - cy, b = fx * dx + fy * dy, c = fx * fx + fy * fy - r * r, disc = b * b - c;
      if (disc < 0) return Infinity; const sq = Math.sqrt(disc), t1 = -b - sq, t2 = -b + sq;
      return t1 > 1e-4 ? t1 : t2 > 1e-4 ? t2 : Infinity;
    }
    const fresnel = (n1, n2, ci, ct) => { const rs = ((n1 * ci - n2 * ct) / (n1 * ci + n2 * ct)) ** 2, rp = ((n1 * ct - n2 * ci) / (n1 * ct + n2 * ci)) ** 2; return (rs + rp) / 2; };

    function trace() {
      const surf = surfaces(), targets = elems.filter(e => e.type === 'target');
      targets.forEach(t => (t.hits = 0));
      const [dx, dy] = laserDir(), segs = [], stack = [];
      if (beam) for (let i = 0; i < 7; i++) { const o = (i - 3) * 1.3; stack.push({ x: laser.x - dy * o, y: laser.y + dx * o, dx, dy, I: 1, d: 0, pri: i === 3, thin: true }); }
      else stack.push({ x: laser.x, y: laser.y, dx, dy, I: 1, d: 0, pri: true });
      let first = null, tir = false, n = 0;
      while (stack.length && n++ < 700) {
        const r = stack.pop();
        let best = Infinity, hit = null;
        for (const sf of surf) { const t = raySeg(r.x, r.y, r.dx, r.dy, sf.a, sf.b); if (t < best) { best = t; hit = sf; } }
        for (const tg of targets) { const t = rayCircle(r.x, r.y, r.dx, r.dy, tg.x, tg.y, tg.r); if (t < best) { best = t; hit = { kind: 'target', e: tg }; } }
        if (!hit) { segs.push([r.x, r.y, r.x + r.dx * 400, r.y + r.dy * 400, r.I, r.thin]); continue; }
        const hx = r.x + r.dx * best, hy = r.y + r.dy * best;
        segs.push([r.x, r.y, hx, hy, r.I, r.thin]);
        if (r.d > 40) continue;
        const push = (ndx, ndy, I, pri) => { const l = Math.hypot(ndx, ndy); ndx /= l; ndy /= l; stack.push({ x: hx + ndx * 1e-3, y: hy + ndy * 1e-3, dx: ndx, dy: ndy, I, d: r.d + 1, pri, thin: r.thin }); };
        if (hit.kind === 'target') { if (r.I > 0.15) hit.e.hits++; continue; }
        if (hit.kind === 'wall') continue;
        if (hit.kind === 'mirror') {
          const ex = hit.b[0] - hit.a[0], ey = hit.b[1] - hit.a[1], l = Math.hypot(ex, ey); let nx = ey / l, ny = -ex / l;
          let ci = -(r.dx * nx + r.dy * ny); if (ci < 0) { nx = -nx; ny = -ny; ci = -ci; }
          const rx = r.dx + 2 * ci * nx, ry = r.dy + 2 * ci * ny;
          if (r.pri && !first) first = { kind: 'mirror', x: hx, y: hy, nx, ny, th1: Math.acos(clamp(ci, -1, 1)), th2: Math.acos(clamp(ci, -1, 1)), din: [r.dx, r.dy], dout: [rx, ry] };
          push(rx, ry, r.I * 0.96, r.pri); continue;
        }
        if (hit.kind === 'lens') {
          const e = hit.e, ux = Math.cos(e.ang * D2R), uy = Math.sin(e.ang * D2R), ax = -uy, ay = ux; // u along lens, a = optical axis
          const y = (hx - e.x) * ux + (hy - e.y) * uy, da = r.dx * ax + r.dy * ay, du = r.dx * ux + r.dy * uy, sg = da >= 0 ? 1 : -1;
          const m = du / Math.max(Math.abs(da), 1e-6) - y / e.f;
          push(sg * ax + m * ux, sg * ay + m * uy, r.I * 0.97, r.pri); continue;
        }
        // glass boundary
        const e = hit.e; let nx = hit.nx, ny = hit.ny, ci = -(r.dx * nx + r.dy * ny), n1, n2;
        if (ci > 0) { n1 = 1; n2 = e.n; } else { n1 = e.n; n2 = 1; nx = -nx; ny = -ny; ci = -ci; }
        const eta = n1 / n2, s2 = eta * eta * (1 - ci * ci), rx = r.dx + 2 * ci * nx, ry = r.dy + 2 * ci * ny;
        if (s2 > 1) {
          if (r.pri && r.I > 0.3) tir = true;
          if (r.pri && !first) first = { kind: 'tir', x: hx, y: hy, nx, ny, n1, n2, th1: Math.acos(ci), th2: null, din: [r.dx, r.dy], dout: [rx, ry] };
          push(rx, ry, r.I, r.pri); continue;
        }
        const ct = Math.sqrt(1 - s2), R = fresnel(n1, n2, ci, ct);
        const tx = eta * r.dx + (eta * ci - ct) * nx, ty = eta * r.dy + (eta * ci - ct) * ny;
        if (r.pri && !first) first = { kind: 'refr', x: hx, y: hy, nx, ny, n1, n2, th1: Math.acos(ci), th2: Math.acos(ct), din: [r.dx, r.dy], dout: [tx, ty] };
        push(tx, ty, r.I * (1 - R), r.pri);
        if (r.I * R > 0.012) push(rx, ry, r.I * R, false);
      }
      return { segs, first, tir, targets };
    }

    // ---------------- view transform ----------------
    const sc = () => Math.min(s.w / WW, s.h / WH);
    const ox = () => (s.w - WW * sc()) / 2, oy = () => (s.h - WH * sc()) / 2;
    const X = (x) => ox() + x * sc(), Y = (y) => oy() + y * sc();
    const toW = (p) => ({ x: (p.x - ox()) / sc(), y: (p.y - oy()) / sc() });

    function hitElem(w) {
      for (let i = elems.length - 1; i >= 0; i--) {
        const e = elems[i];
        if (e.type === 'target') { if (Math.hypot(w.x - e.x, w.y - e.y) < e.r + 1) return e; continue; }
        if (e.type === 'mirror' || e.type === 'lens') {
          const [x1, y1, x2, y2] = segEnds(e), ex = x2 - x1, ey = y2 - y1, t = clamp(((w.x - x1) * ex + (w.y - y1) * ey) / (ex * ex + ey * ey), 0, 1);
          if (Math.hypot(w.x - x1 - ex * t, w.y - y1 - ey * t) < 1.8) return e; continue;
        }
        if (inside(poly(e), w.x, w.y)) return e;
      }
      return null;
    }
    function inside(P, x, y) { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, yi] = P[i], [xj, yj] = P[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; }
    const movable = (e) => !e.fixed || mode === 'sandbox';

    let drag = null;
    const unPtr = pointer(s.cv, {
      down(p) {
        const w = toW(p), near = (q, r = 1.8) => Math.hypot(w.x - q[0], w.y - q[1]) < r;
        if (laser.rot && near(aimHandle(), 2.2)) { drag = { kind: 'aim' }; return; }
        if (sel && sel.type !== 'target' && movable(sel) && near(handlePos(sel), 2)) { drag = { kind: 'rot', e: sel }; return; }
        const e = hitElem(w);
        if (e) { if (sel !== e) { sel = e; renderSel(); } if (movable(e)) drag = { kind: 'move', e, dx: e.x - w.x, dy: e.y - w.y }; return; }
        if (laser.move && Math.hypot(w.x - laser.x + laserDir()[0] * 4, w.y - laser.y + laserDir()[1] * 4) < 4.5) { drag = { kind: 'laser', dx: laser.x - w.x, dy: laser.y - w.y }; return; }
        if (sel) { sel = null; renderSel(); }
      },
      move(p) {
        const w = toW(p); cursor = w;
        if (!drag) return;
        if (drag.kind === 'aim') { laser.ang = Math.atan2(w.y - laser.y, w.x - laser.x) * R2D; syncLaser(); }
        else if (drag.kind === 'rot') { drag.e.ang = ((Math.atan2(w.y - drag.e.y, w.x - drag.e.x) * R2D) % 360 + 360) % 360; angSl?.set(Math.round(drag.e.ang * 2) / 2); }
        else if (drag.kind === 'move') { drag.e.x = clamp(w.x + drag.dx, 0, WW); drag.e.y = clamp(w.y + drag.dy, 0, WH); }
        else if (drag.kind === 'laser') { laser.x = clamp(w.x + drag.dx, 1, WW - 1); laser.y = clamp(w.y + drag.dy, 1, WH - 1); }
      },
      up() { drag = null; },
    });
    const onLeave = () => (cursor = null); s.cv.addEventListener('pointerleave', onLeave);
    function syncLaser() { let a = -laser.ang; a = ((a + 180) % 360 + 360) % 360 - 180; laserSl.input.value = a; laserSl.input.dispatchEvent(new Event('input')); }
    const onWheel = (ev) => {
      if (!sel || sel.type === 'target' || !movable(sel)) return;
      ev.preventDefault(); const st = ev.shiftKey ? 0.5 : 3;
      sel.ang = ((sel.ang + Math.sign(ev.deltaY) * st) % 360 + 360) % 360; angSl?.set(sel.ang);
    };
    s.cv.addEventListener('wheel', onWheel, { passive: false });
    const onKey = (ev) => {
      if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) return;
      if ((ev.key === 'Delete' || ev.key === 'Backspace') && sel && !sel.fixed) { ev.preventDefault(); remove(sel); }
      if ((ev.key === 'q' || ev.key === 'e') && sel && sel.type !== 'target' && movable(sel)) { sel.ang = ((sel.ang + (ev.key === 'e' ? 1 : -1)) % 360 + 360) % 360; angSl?.set(sel.ang); }
    };
    addEventListener('keydown', onKey);

    // ---------------- loop ----------------
    let t0 = 0;
    const stop = loop((dt) => {
      t0 += dt;
      const res = trace();
      const need = (t) => (t.need || 1);
      const lit = res.targets.filter(t => t.hits >= need(t)).length;
      if (res.tir) ctx.complete('tir');
      if (mode !== 'sandbox' && !drag && res.targets.length && lit === res.targets.length && !won) {
        won = true; const id = `level${+mode + 1}`;
        if (+mode < 3) ctx.complete(id);
        ctx.toast(+mode === 3 ? '🏆 Level 4 cleared — you are a master of light!' : `🎯 ${LEVELS[+mode].name} cleared!`);
      }
      last = { first: res.first, lit, nt: res.targets.length };
      draw(res);
    });

    function draw(res) {
      const c = s.g, w = s.w, h = s.h, k = sc();
      c.fillStyle = '#0b1020'; c.fillRect(0, 0, w, h);
      c.fillStyle = C.bg; c.fillRect(X(0), Y(0), WW * k, WH * k);
      c.strokeStyle = C.grid; c.lineWidth = 1; c.beginPath();
      for (let x = 0; x <= WW; x += 5) { c.moveTo(X(x) + 0.5, Y(0)); c.lineTo(X(x) + 0.5, Y(WH)); }
      for (let y = 0; y <= WH; y += 5) { c.moveTo(X(0), Y(y) + 0.5); c.lineTo(X(WW), Y(y) + 0.5); }
      c.stroke();

      // walls
      for (const wl of walls) {
        c.strokeStyle = '#59647f'; c.lineWidth = Math.max(5, 1.2 * k); c.lineCap = 'butt';
        c.beginPath(); c.moveTo(X(wl[0]), Y(wl[1])); c.lineTo(X(wl[2]), Y(wl[3])); c.stroke();
        c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 2; c.setLineDash([4, 6]); c.beginPath(); c.moveTo(X(wl[0]), Y(wl[1])); c.lineTo(X(wl[2]), Y(wl[3])); c.stroke(); c.setLineDash([]);
      }
      // glass & optics (under the rays)
      for (const e of elems) drawElem(c, e, k);

      // rays
      c.save(); c.globalCompositeOperation = 'lighter'; c.lineCap = 'round';
      for (const [x1, y1, x2, y2, I, thin] of res.segs) {
        c.strokeStyle = `rgba(255,40,60,${0.18 * I})`; c.lineWidth = thin ? 4 : 7; c.beginPath(); c.moveTo(X(x1), Y(y1)); c.lineTo(X(x2), Y(y2)); c.stroke();
        c.strokeStyle = `rgba(255,${120 + 80 * I | 0},${120 + 60 * I | 0},${Math.min(1, 0.15 + I)})`; c.lineWidth = thin ? 1.3 : 2; c.beginPath(); c.moveTo(X(x1), Y(y1)); c.lineTo(X(x2), Y(y2)); c.stroke();
      }
      c.restore();

      // targets on top
      for (const e of elems) if (e.type === 'target') drawTarget(c, e, k);

      // first-interface annotation: normal + angles
      const f = res.first;
      if (f) {
        const px = X(f.x), py = Y(f.y), L = 5 * k;
        c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = 1.2; c.setLineDash([4, 4]);
        c.beginPath(); c.moveTo(px - f.nx * L, py - f.ny * L); c.lineTo(px + f.nx * L, py + f.ny * L); c.stroke(); c.setLineDash([]);
        arrow(c, px, py, px + f.nx * L * 0.8, py + f.ny * L * 0.8, C.muted, 1.5, 'N');
        const ang = (vx, vy) => Math.atan2(vy, vx);
        // incidence angle: between −din (pointing back to source) and normal (which faces the incoming side)
        arc(c, px, py, 3.5 * k, ang(f.nx, f.ny), ang(-f.din[0], -f.din[1]), C.gold, `θ₁ ${fmt(f.th1 * R2D, 1)}°`);
        if (f.kind === 'refr') arc(c, px, py, 3.5 * k, ang(-f.nx, -f.ny), ang(f.dout[0], f.dout[1]), C.accent, `θ₂ ${fmt(f.th2 * R2D, 1)}°`);
        else arc(c, px, py, 2.2 * k, ang(f.nx, f.ny), ang(f.dout[0], f.dout[1]), C.good, `θᵣ ${fmt(f.th1 * R2D, 1)}°`);
        if (f.kind === 'tir') text(c, 'TOTAL INTERNAL REFLECTION', px, py - 4 * k, { color: C.gold, size: 12, weight: 800, align: 'center' });
      }

      // laser
      const [ldx, ldy] = laserDir();
      c.save(); c.translate(X(laser.x), Y(laser.y)); c.rotate(laser.ang * D2R);
      c.fillStyle = '#c9d1e3'; roundRect(c, -8.5 * k, -1.7 * k, 8.5 * k, 3.4 * k, 4); c.fill();
      c.fillStyle = '#50607e'; c.fillRect(-8.5 * k, -1.7 * k, 2 * k, 3.4 * k);
      c.fillStyle = '#ff3b4e'; c.beginPath(); c.arc(-0.2 * k, 0, 0.7 * k, 0, Math.PI * 2); c.fill();
      if (beam) { c.fillStyle = 'rgba(255,80,90,.4)'; c.fillRect(-0.6 * k, -4.2 * k, 0.8 * k, 8.4 * k); }
      if (!laser.move) { c.fillStyle = '#7b879f'; c.beginPath(); c.arc(-5 * k, 0, 0.6 * k, 0, Math.PI * 2); c.fill(); }
      c.restore();
      if (laser.rot) {
        const [hx, hy] = aimHandle();
        c.strokeStyle = C.gold; c.lineWidth = 2; c.beginPath(); c.arc(X(hx), Y(hy), 1.4 * k, 0, Math.PI * 2); c.stroke();
        arrow(c, X(laser.x), Y(laser.y), X(laser.x + ldx * 6.4), Y(laser.y + ldy * 6.4), C.gold, 1.5);
      }

      // selection
      if (sel) {
        c.strokeStyle = 'rgba(255,204,77,.7)'; c.setLineDash([5, 5]); c.lineWidth = 1.5; c.beginPath(); c.arc(X(sel.x), Y(sel.y), (extent(sel) + 1.2) * k, 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
        if (sel.type !== 'target' && movable(sel)) {
          const [hx, hy] = handlePos(sel);
          c.strokeStyle = C.gold; c.lineWidth = 1.5; c.beginPath(); c.moveTo(X(sel.x), Y(sel.y)); c.lineTo(X(hx), Y(hy)); c.stroke();
          c.fillStyle = C.bg; c.beginPath(); c.arc(X(hx), Y(hy), 1.1 * k, 0, Math.PI * 2); c.fill(); c.stroke();
          text(c, '⟳', X(hx), Y(hy) + 4, { color: C.gold, size: 12, weight: 800, align: 'center' });
        }
      }
      // level banner
      if (mode !== 'sandbox') {
        text(c, LEVELS[+mode].name, X(1.5), Y(WH) - 10, { color: C.muted, size: 12, weight: 700 });
        if (won) {
          c.fillStyle = 'rgba(10,30,20,.8)'; roundRect(c, w / 2 - 170, 46, 340, 44, 10); c.fill();
          text(c, '✅ LEVEL COMPLETE — press “Next level ▶”', w / 2, 74, { color: C.good, size: 15, weight: 800, align: 'center' });
        }
      }
      // cursor ruler to selected element
      if (cursor && sel && !drag) {
        c.strokeStyle = 'rgba(90,209,255,.6)'; c.setLineDash([3, 4]); c.lineWidth = 1; c.beginPath(); c.moveTo(X(sel.x), Y(sel.y)); c.lineTo(X(cursor.x), Y(cursor.y)); c.stroke(); c.setLineDash([]);
        text(c, `${fmt(Math.hypot(cursor.x - sel.x, cursor.y - sel.y), 1)} cm`, X(cursor.x) + 10, Y(cursor.y) - 8, { color: C.accent, size: 12, weight: 700 });
      }

      // readouts
      const ro = { 'Laser direction': `${fmt(((-laser.ang + 180) % 360 + 360) % 360 - 180, 1)}°`, 'Rays': beam ? '7 (parallel beam)' : '1' };
      if (f) {
        const med = (n) => (n === 1 ? 'air' : `glass (n=${fmt(n)})`);
        if (f.kind === 'mirror') Object.assign(ro, { 'First interface': 'mirror', 'Incidence θ₁': `${fmt(f.th1 * R2D, 1)}°`, 'Reflection θᵣ': `${fmt(f.th1 * R2D, 1)}°` });
        else {
          Object.assign(ro, { 'First interface': `${med(f.n1)} → ${med(f.n2)}`, 'Incidence θ₁': `${fmt(f.th1 * R2D, 1)}°` });
          if (f.kind === 'refr') Object.assign(ro, { 'Refraction θ₂': `${fmt(f.th2 * R2D, 1)}°`, 'n₁·sinθ₁': fmt(f.n1 * Math.sin(f.th1), 3), 'n₂·sinθ₂': fmt(f.n2 * Math.sin(f.th2), 3) });
          else ro['Refraction θ₂'] = 'none — TIR!';
          ro['Critical angle θc'] = !ctx.isDone('critical') ? 'solve the challenge 🔒' : f.n1 > f.n2 ? `${fmt(Math.asin(f.n2 / f.n1) * R2D, 1)}°` : '— (n₁ < n₂)';
        }
      } else ro['First interface'] = '—';
      if (res.targets.length) ro['Targets lit'] = `${last.lit} / ${res.targets.length}`;
      ro['Cursor (x, y)'] = cursor ? `${fmt(cursor.x, 1)}, ${fmt(cursor.y, 1)} cm` : '—';
      if (sel) ro['Cursor ↔ selected'] = cursor ? `${fmt(Math.hypot(cursor.x - sel.x, cursor.y - sel.y), 1)} cm` : '—';
      if (sel && sel.type === 'lens') ro['Lens power P = 1/f'] = sel.mystery ? '? D' : `${fmt(100 / sel.f, 2)} D`;
      ctx.readout.set(ro);
    }

    function drawElem(c, e, k) {
      if (e.type === 'target') return;
      if (e.type === 'mirror') {
        const [x1, y1, x2, y2] = segEnds(e);
        c.lineCap = 'round'; c.strokeStyle = '#6f7fa3'; c.lineWidth = 0.9 * k + 3; c.beginPath(); c.moveTo(X(x1), Y(y1)); c.lineTo(X(x2), Y(y2)); c.stroke();
        c.strokeStyle = '#e8f4ff'; c.lineWidth = 2.5; c.beginPath(); c.moveTo(X(x1), Y(y1)); c.lineTo(X(x2), Y(y2)); c.stroke();
        return;
      }
      if (e.type === 'lens') {
        const ux = Math.cos(e.ang * D2R), uy = Math.sin(e.ang * D2R), ax = -uy, ay = ux, N = 24, hl = e.len / 2;
        const thick = (u) => (e.f > 0 ? 0.3 + 1.6 * (1 - (u / hl) ** 2) : 0.4 + 1.3 * (u / hl) ** 2);
        c.beginPath();
        for (let i = 0; i <= N; i++) { const u = -hl + (2 * hl * i) / N, t = thick(u); c.lineTo(X(e.x + ux * u + ax * t), Y(e.y + uy * u + ay * t)); }
        for (let i = N; i >= 0; i--) { const u = -hl + (2 * hl * i) / N, t = thick(u); c.lineTo(X(e.x + ux * u - ax * t), Y(e.y + uy * u - ay * t)); }
        c.closePath();
        c.fillStyle = e.mystery ? 'rgba(195,139,255,.35)' : 'rgba(120,200,255,.25)'; c.fill();
        c.strokeStyle = e.mystery ? C.purple : 'rgba(170,225,255,.9)'; c.lineWidth = 1.5; c.stroke();
        // axis + focal points
        if (!e.mystery) {
          c.fillStyle = 'rgba(255,204,77,.8)';
          for (const sg of [-1, 1]) { c.beginPath(); c.arc(X(e.x + ax * e.f * sg), Y(e.y + ay * e.f * sg), 2.5, 0, Math.PI * 2); c.fill(); }
          text(c, `f = ${fmt(e.f, 1)} cm`, X(e.x - ux * (hl + 1.5)), Y(e.y - uy * (hl + 1.5)) - 4, { color: C.muted, size: 11, align: 'center' });
        } else text(c, '?', X(e.x), Y(e.y) + 6, { color: '#fff', size: 18, weight: 800, align: 'center' });
        return;
      }
      const P = poly(e);
      c.beginPath(); P.forEach(([x, y], i) => (i ? c.lineTo(X(x), Y(y)) : c.moveTo(X(x), Y(y)))); c.closePath();
      c.fillStyle = `rgba(120,200,255,${0.1 + (e.n - 1) * 0.16})`; c.fill();
      c.strokeStyle = 'rgba(170,225,255,.85)'; c.lineWidth = 1.5; c.stroke();
      text(c, `n=${fmt(e.n)}`, X(e.x), Y(e.y) + 4, { color: 'rgba(232,237,247,.8)', size: 11, weight: 700, align: 'center' });
    }
    function drawTarget(c, e, k) {
      const lit = e.hits >= (e.need || 1), px = X(e.x), py = Y(e.y), r = e.r * k;
      if (lit) { const gl = c.createRadialGradient(px, py, 0, px, py, r * 3); gl.addColorStop(0, 'rgba(91,227,138,.7)'); gl.addColorStop(1, 'rgba(91,227,138,0)'); c.fillStyle = gl; c.beginPath(); c.arc(px, py, r * 3, 0, Math.PI * 2); c.fill(); }
      [[1, lit ? C.good : C.bad], [0.66, '#fff'], [0.33, lit ? C.good : C.bad]].forEach(([f, col]) => { c.fillStyle = col; c.beginPath(); c.arc(px, py, r * f, 0, Math.PI * 2); c.fill(); });
      if ((e.need || 1) > 1) text(c, `${Math.min(e.hits, e.need)}/${e.need} rays`, px, py + r + 14, { color: lit ? C.good : C.ink, size: 11, weight: 700, align: 'center' });
    }
    function arc(c, x, y, r, a0, a1, col, label) {
      let d = a1 - a0; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      c.strokeStyle = col; c.lineWidth = 2; c.beginPath(); c.arc(x, y, r, a0, a0 + d, d < 0); c.stroke();
      const am = a0 + d / 2, lx = x + Math.cos(am) * (r + 26), ly = y + Math.sin(am) * (r + 18);
      c.font = '700 11.5px Inter, system-ui, sans-serif'; const tw = c.measureText(label).width;
      c.fillStyle = 'rgba(10,14,26,.8)'; c.fillRect(lx - tw / 2 - 4, ly - 9, tw + 8, 17);
      text(c, label, lx, ly + 4, { color: col, size: 11.5, weight: 700, align: 'center' });
    }
    function roundRect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }

    return { destroy() { stop(); unPtr(); removeEventListener('keydown', onKey); s.cv.removeEventListener('wheel', onWheel); s.cv.removeEventListener('pointerleave', onLeave); s.destroy(); } };
  },
};
