import { makeCanvas, loop, slider, buttons, checkbox, pointer, arrow, text, hint, fmt, clamp, C } from '../ui.js';

const MU = 398600;          // GM of Earth (km³/s²)
const R = 6371;             // planet radius (km)
const MOON_R = 30000;       // orbit radius of the (scaled-down) moon (km)
const MOON_SIZE = 1400;     // moon radius drawn (km)
const CATCH = 2600;         // rendezvous distance (km)
const VS = 14;              // px per km/s for velocity arrows / aiming

function elements(x, y, vx, vy) {
  const r = Math.hypot(x, y), v2 = vx * vx + vy * vy, rv = x * vx + y * vy;
  const eps = v2 / 2 - MU / r, hz = x * vy - y * vx;
  const ex = ((v2 - MU / r) * x - rv * vx) / MU, ey = ((v2 - MU / r) * y - rv * vy) / MU;
  const e = Math.hypot(ex, ey), a = eps < 0 ? -MU / (2 * eps) : Infinity;
  const rp = (hz * hz / MU) / (1 + e), ra = e < 1 ? a * (1 + e) : Infinity;
  const T = e < 1 ? 2 * Math.PI * Math.sqrt(a ** 3 / MU) : Infinity;
  return { r, v: Math.sqrt(v2), eps, e, a, rp, ra, T, hz };
}
const acc = (x, y) => { const r2 = x * x + y * y, r = Math.sqrt(r2), k = -MU / (r2 * r); return [k * x, k * y]; };
// one velocity-Verlet step (symplectic, time-reversible)
function verlet(b, h) {
  let [ax, ay] = acc(b.x, b.y);
  b.vx += 0.5 * h * ax; b.vy += 0.5 * h * ay;
  b.x += h * b.vx; b.y += h * b.vy;
  [ax, ay] = acc(b.x, b.y);
  b.vx += 0.5 * h * ax; b.vy += 0.5 * h * ay;
}
const hStep = (r) => Math.min(20, 0.004 * Math.sqrt(r ** 3 / MU)); // fraction of the dynamical time

export default {
  title: 'Orbit Designer',
  icon: '🛰️',
  blurb: 'Fling a satellite from a launch tower and design circles, ellipses and escape trajectories.',
  theory: `
    <p>Newton’s law of gravitation pulls the satellite toward the planet’s centre:</p>
    <div class="eq">a = −GM·r / |r|³</div>
    <p>An orbit is falling forever while moving sideways fast enough to keep missing the ground. Gravity supplies exactly the centripetal acceleration of a circle when</p>
    <div class="eq">v_circ = √(GM / r)</div>
    <p>Slower (or tilted) launches give <b>ellipses</b> with eccentricity e &gt; 0. With total energy ε = ½v² − GM/r ≥ 0 the satellite is unbound and never returns:</p>
    <div class="eq">v_esc = √(2GM / r)</div>
    <p>Kepler’s third law gives the period from the semi-major axis a:</p>
    <div class="eq">T = 2π·√(a³ / GM)</div>
    <p>Here GM = 3.986×10⁵ km³/s² and R = 6371 km (Earth). Time runs faster than reality — watch the warp factor. The moon is scaled down and its gravity is ignored.</p>`,
  challenges: [
    { id: 'circle', text: 'Achieve a near-<b>circular</b> orbit: e &lt; 0.1 for a full revolution', xp: 30 },
    { id: 'ellipse', text: 'Fly a full <b>elliptical</b> orbit (e ≥ 0.3) without crashing', xp: 25 },
    { id: 'escape', text: '<b>Escape</b> the planet’s gravity for good (ε ≥ 0)', xp: 25 },
    { id: 'moon', text: 'Rendezvous with the <b>moon</b> (fly inside its gold ring)', xp: 50 },
    { id: 'ratio', text: 'Compare the readouts: escape speed is how many times the circular speed?', xp: 30, check: v => Math.abs(v - Math.SQRT2) < 0.02, placeholder: 'ratio' },
    { id: 'period', text: 'Measure: period of a circular orbit at 2000 km altitude? (minutes)', xp: 40, check: v => Math.abs(v - 127.0) < 4, placeholder: 'min' },
  ],
  mount(ctx) {
    const s = makeCanvas(ctx.stage);
    hint(ctx.stage, 'Drag from the satellite to aim — arrow = launch velocity · release to launch · scroll to zoom');
    let alt = 2000, speed = 6.9, dir = 0, warp = 800, guides = true, zoom = 1;
    slider(ctx.controls, { label: 'Launch altitude', min: 300, max: 15000, step: 100, value: alt, unit: 'km', onInput: v => { alt = v; if (mode !== 'fly') ready(); } });
    const sSpeed = slider(ctx.controls, { label: 'Launch speed', min: 0, max: 14, step: 0.05, value: speed, unit: 'km/s', fmt: v => v.toFixed(2), onInput: v => (speed = v) });
    const sDir = slider(ctx.controls, { label: 'Direction (above horizontal)', min: -180, max: 180, step: 1, value: dir, unit: '°', onInput: v => (dir = v) });
    slider(ctx.controls, { label: 'Time warp', min: 100, max: 4000, step: 50, value: warp, unit: '×', onInput: v => (warp = v) });
    checkbox(ctx.controls, { label: 'Show circular / escape speed guides', value: guides, onChange: v => (guides = v) });
    buttons(ctx.controls, [
      { label: '🚀 Launch', primary: true, onClick: () => launch() },
      { label: 'Reset', onClick: () => ready() },
      { label: 'Clear trails', onClick: () => (old.length = 0) },
    ]);

    let mode = 'ready', sat, trail = [], old = [], tMission = 0, tGlobal = 0, sweep = 0, lastAng = 0, revT0 = 0, revs = 0;
    let measuredT = null, maxE = 0, boom = null, aiming = false, msg = null;
    const r0 = () => R + alt;
    function ready() {
      if (trail.length > 2) { old.push(trail); if (old.length > 4) old.shift(); }
      trail = []; mode = 'ready'; sat = { x: 0, y: r0(), vx: 0, vy: 0 }; tMission = 0; msg = null;
    }
    function launch() {
      if (mode === 'fly') ready();
      const a = dir * Math.PI / 180;
      sat = { x: 0, y: r0(), vx: speed * Math.cos(a), vy: speed * Math.sin(a) };
      if (speed < 0.05) return ctx.toast('Give it some speed first!', 'info');
      trail = [[sat.x, sat.y]]; mode = 'fly'; tMission = 0; sweep = 0; lastAng = Math.atan2(sat.y, sat.x); revT0 = 0; revs = 0;
      maxE = elements(sat.x, sat.y, sat.vx, sat.vy).e; measuredT = null;
    }
    ready();

    // view
    const view = () => { const k = Math.min(s.w, s.h) / 2 / (MOON_R * 1.15) * zoom; return { k, cx: s.w / 2, cy: s.h / 2 }; };
    const toS = (x, y) => { const { k, cx, cy } = view(); return [cx + x * k, cy - y * k]; };
    const onWheel = (e) => { e.preventDefault(); zoom = clamp(zoom * Math.exp(-e.deltaY * 0.0015), 0.4, 5); };
    s.cv.addEventListener('wheel', onWheel, { passive: false });

    const offP = pointer(s.cv, {
      down(p) {
        if (mode !== 'ready') ready();
        aiming = true; aim(p);
      },
      move(p) { if (aiming) aim(p); },
      up() { if (aiming) { aiming = false; launch(); } },
    });
    function aim(p) {
      const [px, py] = toS(0, r0());
      const vx = (p.x - px) / VS, vy = -(p.y - py) / VS;
      sSpeed.set(clamp(Math.round(Math.hypot(vx, vy) * 20) / 20, 0, 14));
      sDir.set(Math.round(Math.atan2(vy, vx) * 180 / Math.PI));
    }
    const onKey = (e) => {
      if (e.code !== 'Space' || ['INPUT', 'SELECT', 'BUTTON'].includes(document.activeElement.tagName)) return;
      e.preventDefault(); mode === 'ready' ? launch() : ready();
    };
    addEventListener('keydown', onKey);

    const moonPos = (t) => { const w = Math.sqrt(MU / MOON_R ** 3), a = 0.8 + w * t; return [MOON_R * Math.cos(a), MOON_R * Math.sin(a)]; };

    function end(kind, text2) { mode = kind; msg = text2; }

    const stop = loop((dt) => {
      const simDt = dt * warp;
      tGlobal += simDt;
      if (mode === 'fly') {
        let left = simDt;
        while (left > 0 && mode === 'fly') {
          const r = Math.hypot(sat.x, sat.y), h = Math.min(left, hStep(r));
          verlet(sat, h); left -= h; tMission += h;
          const rn = Math.hypot(sat.x, sat.y);
          if (rn < R) { boom = { x: sat.x * R / rn, y: sat.y * R / rn, t: 0 }; end('crash', '💥 Crashed into the planet!'); ctx.toast('💥 Crash! Launch faster or more sideways.', 'warn'); break; }
          const ang = Math.atan2(sat.y, sat.x); let d = ang - lastAng;
          if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI;
          sweep += d; lastAng = ang;
          const el = elements(sat.x, sat.y, sat.vx, sat.vy); maxE = Math.max(maxE, el.e);
          if (Math.abs(sweep) >= 2 * Math.PI * (revs + 1)) {
            revs++; measuredT = tMission - revT0; revT0 = tMission;
            if (maxE < 0.1) { ctx.complete('circle'); if (revs === 1) ctx.toast(`🟢 Circular orbit! e = ${fmt(el.e, 3)}, T = ${fmt(measuredT / 60, 1)} min`); }
            else if (el.e >= 0.3 && el.e < 1) { ctx.complete('ellipse'); if (revs === 1) ctx.toast(`🥚 Elliptical orbit! e = ${fmt(el.e, 2)}, T = ${fmt(measuredT / 60, 1)} min`); }
            else if (revs === 1) ctx.toast(`Full orbit: e = ${fmt(el.e, 2)}, T = ${fmt(measuredT / 60, 1)} min`, 'info');
            maxE = el.e;
          }
          const [mx, my] = moonPos(tGlobal - left);
          if (Math.hypot(sat.x - mx, sat.y - my) < CATCH) { ctx.complete('moon'); ctx.toast('🌕 Moon rendezvous!'); end('moon', '🌕 Rendezvous with the moon!'); break; }
          if (el.eps >= 0 && rn > MOON_R * 1.6) { ctx.complete('escape'); ctx.toast(`🚀 Escaped! Speed at infinity ≈ ${fmt(Math.sqrt(2 * el.eps), 2)} km/s`); end('escaped', '🚀 Escaped — it never comes back'); break; }
          if (rn > MOON_R * 6) { end('lost', 'Lost in deep space'); break; }
        }
        const lp = trail[trail.length - 1], [a, b] = toS(sat.x, sat.y), [c0, c1] = toS(lp[0], lp[1]);
        if (Math.hypot(a - c0, b - c1) > 1.5) { trail.push([sat.x, sat.y]); if (trail.length > 5000) trail.shift(); }
        if (mode !== 'fly') trail.push([sat.x, sat.y]);
      }
      if (boom) { boom.t += dt; if (boom.t > 1.2) boom = null; }
      draw();
    });

    function preview() {
      const a = dir * Math.PI / 180, b = { x: 0, y: r0(), vx: speed * Math.cos(a), vy: speed * Math.sin(a) };
      const el = elements(b.x, b.y, b.vx, b.vy), tMax = el.e < 1 ? el.T * 1.02 : 3e5;
      const pts = [[b.x, b.y]]; let t = 0;
      for (let i = 0; i < 6000 && t < tMax; i++) {
        const r = Math.hypot(b.x, b.y), h = hStep(r) * 2.5; verlet(b, h); t += h;
        const rn = Math.hypot(b.x, b.y); pts.push([b.x, b.y]);
        if (rn < R || rn > MOON_R * 3) break;
      }
      return { pts, el };
    }

    function draw() {
      const { g: c, w, h } = s, { k } = view();
      c.fillStyle = '#070b16'; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 140; i++) { const x = (i * 197.3) % w, y = (i * 83.7 + (i % 7) * 31) % h; c.fillStyle = `rgba(255,255,255,${0.15 + (i % 5) * 0.12})`; c.fillRect(x, y, i % 9 === 0 ? 2 : 1.2, i % 9 === 0 ? 2 : 1.2); }
      const [cx, cy] = toS(0, 0);
      // moon orbit (target ring) + moon
      c.strokeStyle = 'rgba(255,255,255,.12)'; c.setLineDash([3, 7]); c.lineWidth = 1; c.beginPath(); c.arc(cx, cy, MOON_R * k, 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
      const [mx, my] = moonPos(tGlobal), [msx, msy] = toS(mx, my);
      const mg = c.createRadialGradient(msx - 4, msy - 4, 1, msx, msy, MOON_SIZE * k); mg.addColorStop(0, '#e6e6ea'); mg.addColorStop(1, '#7c7f8c');
      c.fillStyle = mg; c.beginPath(); c.arc(msx, msy, Math.max(4, MOON_SIZE * k), 0, Math.PI * 2); c.fill();
      c.strokeStyle = C.gold; c.setLineDash([5, 5]); c.lineWidth = 1.5; c.beginPath(); c.arc(msx, msy, CATCH * k, 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
      text(c, 'Moon', msx, msy - CATCH * k - 6, { color: C.gold, size: 11, weight: 700, align: 'center' });
      // planet
      const atm = c.createRadialGradient(cx, cy, R * k * 0.95, cx, cy, R * k * 1.25); atm.addColorStop(0, 'rgba(90,209,255,.35)'); atm.addColorStop(1, 'rgba(90,209,255,0)');
      c.fillStyle = atm; c.beginPath(); c.arc(cx, cy, R * k * 1.25, 0, Math.PI * 2); c.fill();
      const pg = c.createRadialGradient(cx - R * k * 0.35, cy - R * k * 0.35, R * k * 0.1, cx, cy, R * k); pg.addColorStop(0, '#4fa3ff'); pg.addColorStop(0.7, '#1f5fb8'); pg.addColorStop(1, '#123a75');
      c.fillStyle = pg; c.beginPath(); c.arc(cx, cy, R * k, 0, Math.PI * 2); c.fill();
      c.fillStyle = 'rgba(91,227,138,.55)';
      [[0.3, -0.2, 0.35], [-0.4, 0.3, 0.28], [0.1, 0.5, 0.2]].forEach(([a, b, r]) => { c.beginPath(); c.ellipse(cx + a * R * k, cy + b * R * k, r * R * k, r * R * k * 0.6, a, 0, Math.PI * 2); c.fill(); });
      // launch tower
      const [px, py] = toS(0, r0()), [bx, by] = toS(0, R);
      c.strokeStyle = '#8a95ad'; c.lineWidth = 2; c.beginPath(); c.moveTo(bx, by); c.lineTo(px, py + 4); c.stroke();
      // old trails
      old.forEach((t, i) => { c.strokeStyle = `rgba(255,255,255,${0.08 + i * 0.04})`; c.lineWidth = 1.2; path(c, t); c.stroke(); });
      // current trail
      if (trail.length > 1) { c.strokeStyle = mode === 'crash' ? C.bad : C.gold; c.lineWidth = 2; path(c, trail); c.stroke(); }
      let pv = null;
      if (mode === 'ready') {
        pv = preview();
        c.strokeStyle = 'rgba(255,204,77,.55)'; c.setLineDash([6, 6]); c.lineWidth = 1.6; path(c, pv.pts); c.stroke(); c.setLineDash([]);
        if (guides) {
          const vc = Math.sqrt(MU / r0()), ve = Math.SQRT2 * vc;
          c.lineWidth = 1.2; c.setLineDash([2, 5]);
          c.strokeStyle = 'rgba(91,227,138,.75)'; c.beginPath(); c.arc(px, py, vc * VS, 0, Math.PI * 2); c.stroke();
          c.strokeStyle = 'rgba(255,107,122,.75)'; c.beginPath(); c.arc(px, py, ve * VS, 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
          text(c, `v_circ ${fmt(vc, 2)} km/s`, px + vc * VS * 0.72 + 4, py - vc * VS * 0.72, { color: C.good, size: 10.5, weight: 600 });
          text(c, `v_esc ${fmt(ve, 2)} km/s`, px + ve * VS * 0.72 + 4, py - ve * VS * 0.72, { color: C.bad, size: 10.5, weight: 600 });
        }
        const a = dir * Math.PI / 180;
        arrow(c, px, py, px + speed * Math.cos(a) * VS, py - speed * Math.sin(a) * VS, C.accent, 3, `${fmt(speed, 2)} km/s`);
      }
      // satellite + vectors
      const [sx, sy] = toS(sat.x, sat.y);
      if (mode === 'fly') {
        arrow(c, sx, sy, sx + sat.vx * VS, sy - sat.vy * VS, C.accent, 2.5, 'v');
        const [ax, ay] = acc(sat.x, sat.y), am = Math.hypot(ax, ay), gl = clamp(am * 7000, 12, 70);
        arrow(c, sx, sy, sx + ax / am * gl, sy - ay / am * gl, C.bad, 2.5, 'g');
      }
      if (mode !== 'crash') {
        const ang = mode === 'fly' ? Math.atan2(-sat.vy, sat.vx) : -dir * Math.PI / 180;
        c.save(); c.translate(sx, sy); c.rotate(ang);
        c.fillStyle = '#5ad1ff'; c.fillRect(-2, -11, 4, 7); c.fillRect(-2, 4, 4, 7);
        c.fillStyle = '#e8edf7'; c.fillRect(-5, -4, 10, 8); c.restore();
      }
      if (boom) {
        const [bx2, by2] = toS(boom.x, boom.y), r = 6 + boom.t * 40;
        c.fillStyle = `rgba(255,138,91,${Math.max(0, 1 - boom.t)})`; c.beginPath(); c.arc(bx2, by2, r, 0, Math.PI * 2); c.fill();
      }
      if (msg) text(c, msg, w / 2, h - 22, { color: C.gold, size: 15, weight: 800, align: 'center' });
      text(c, `Mission time ${clock(tMission)}   ·   warp ${warp}×`, w - 14, 22, { color: C.muted, size: 12, align: 'right' });

      // readouts
      if (mode === 'ready') {
        const el = pv.el, vc = Math.sqrt(MU / r0());
        ctx.readout.set({
          'Launch altitude': `${fmt(alt, 0)} km`,
          'Launch speed v': `${fmt(speed, 2)} km/s`,
          'Circular speed √(GM/r)': `${fmt(vc, 2)} km/s`,
          'Escape speed √(2GM/r)': `${fmt(vc * Math.SQRT2, 2)} km/s`,
          'Predicted eccentricity e': el.e < 1 ? fmt(el.e, 3) : `${fmt(el.e, 2)} (unbound)`,
          'Predicted periapsis alt.': el.rp < R ? 'underground 💥' : `${fmt(el.rp - R, 0)} km`,
          'Predicted apoapsis alt.': el.e < 1 ? `${fmt(el.ra - R, 0)} km` : '∞',
          'Kepler period 2π√(a³/GM)': el.e < 1 ? `${fmt(el.T / 60, 1)} min` : '—',
          'Last measured period': measuredT ? `${fmt(measuredT / 60, 1)} min` : '—',
        });
      } else {
        const el = elements(sat.x, sat.y, sat.vx, sat.vy);
        ctx.readout.set({
          'Altitude': `${fmt(Math.max(0, el.r - R), 0)} km`,
          'Speed |v|': `${fmt(el.v, 2)} km/s`,
          'Circular speed √(GM/r)': `${fmt(Math.sqrt(MU / el.r), 2)} km/s`,
          'Escape speed √(2GM/r)': `${fmt(Math.sqrt(2 * MU / el.r), 2)} km/s`,
          'Gravity |a| = GM/r²': `${fmt(MU / el.r ** 2 * 1000, 2)} m/s²`,
          'Energy ε = ½v² − GM/r': `${fmt(el.eps, 2)} MJ/kg`,
          'Eccentricity e': fmt(el.e, 3),
          'Orbits completed': `${revs}`,
          'Measured period': measuredT ? `${fmt(measuredT / 60, 1)} min` : 'fly a full orbit…',
          'Kepler period 2π√(a³/GM)': el.e < 1 ? `${fmt(el.T / 60, 1)} min` : '— (unbound)',
        });
      }
    }
    function path(c, pts) { c.beginPath(); pts.forEach(([x, y], i) => { const [a, b] = toS(x, y); i ? c.lineTo(a, b) : c.moveTo(a, b); }); }

    return { destroy() { stop(); offP(); removeEventListener('keydown', onKey); s.cv.removeEventListener('wheel', onWheel); s.destroy(); } };
  },
};

function clock(t) { const hh = Math.floor(t / 3600), mm = Math.floor((t % 3600) / 60); return `${hh} h ${String(mm).padStart(2, '0')} min`; }
