import { makeCanvas, loop, slider, buttons, hint, text, fmt, C } from '../ui.js';

// Grid circuit builder. Components live on edges between neighbouring grid nodes.
// Solved with nodal analysis (Kirchhoff's current law + Ohm's law).
const TOOLS = {
  wire: { name: 'Wire', icon: '〰️' },
  battery: { name: 'Battery', icon: '🔋', value: 9, unit: 'V', min: 1.5, max: 12, step: 0.5 },
  resistor: { name: 'Resistor', icon: '▭', value: 10, unit: 'Ω', min: 1, max: 100, step: 1 },
  bulb: { name: 'Bulb', icon: '💡' },
  switch: { name: 'Switch', icon: '⏻' },
  fan: { name: 'Motor fan', icon: '🌀' },
  ammeter: { name: 'Ammeter', icon: 'Ⓐ' },
  erase: { name: 'Eraser', icon: '🧽' },
};
const BULB_R = 12, BULB_P = 3, FAN_R = 6, R_INT = 0.2, G_WIRE = 1e3, G_OPEN = 1e-9;
const SAVE = 'physics-circuit-v1';

export default {
  title: 'Circuit Builder',
  icon: '🔌',
  blurb: 'Draw wires, batteries, bulbs and switches on a grid. Watch the current flow — and try not to blow a bulb.',
  theory: `
    <p><b>Ohm's law</b> links voltage, current and resistance:</p>
    <div class="eq">V = I · R</div>
    <p><b>Kirchhoff's current law</b>: the current flowing into a junction equals the current flowing out. <b>Voltage law</b>: the voltages around any closed loop add up to zero.</p>
    <p><b>Series</b> resistances add up: <span class="eq" style="display:inline-block">R = R₁ + R₂</span>. In <b>parallel</b> each branch gets the full voltage: <span class="eq" style="display:inline-block">1/R = 1/R₁ + 1/R₂</span></p>
    <div class="eq">P = V · I = I² · R</div>
    <p>Bulbs here are 12 Ω, rated 3 W (6 V). Push more than 3× the rated power through one and it burns out. Batteries have a small internal resistance (0.2 Ω), so a short circuit draws a huge current.</p>
    <p>The yellow dots show <i>conventional current</i>, flowing from + to −. Their speed shows how big the current is.</p>`,
  challenges: [
    { id: 'light', text: 'Light up a bulb 💡', xp: 20 },
    { id: 'switch', text: 'Build a circuit where a switch turns a bulb on and off', xp: 30 },
    { id: 'series', text: 'Light two bulbs in <b>series</b> from one battery', xp: 30 },
    { id: 'parallel', text: 'Light two bulbs in <b>parallel</b> from one battery (both at full brightness)', xp: 35 },
    { id: 'fan', text: 'Spin the motor fan', xp: 20 },
    { id: 'amps', text: 'Make exactly 0.25 A (±0.01 A) flow through an ammeter', xp: 40 },
    { id: 'ohm', text: 'Predict: a 9 V battery is connected across a single 18 Ω resistor. What current flows? (A, ignore internal resistance)', xp: 30, check: v => Math.abs(v - 0.5) < 0.01, placeholder: 'amps' },
    { id: 'blow', text: 'Oops! Burn out a bulb by overloading it', xp: 15 },
  ],
  mount(ctx) {
    const s = makeCanvas(ctx.stage);
    hint(ctx.stage, 'Drag between grid dots to place the selected part · click a part to select or toggle it · right-click to delete · drag the red/black probes onto dots');
    const SP = 64;
    let comps = new Map(); // key "x,y,h|v" -> comp
    let tool = 'wire', selected = null, dirty = true, edited = false, solved = { V: new Map(), short: false };
    let probes = { red: { x: null, y: null, px: 0, py: 0 }, black: { x: null, y: null, px: 0, py: 0 } };

    // ---------- UI ----------
    const pal = document.createElement('div'); pal.className = 'btns'; ctx.controls.appendChild(pal);
    const toolBtns = {};
    for (const [k, t] of Object.entries(TOOLS)) {
      const b = document.createElement('button'); b.className = 'btn'; b.textContent = `${t.icon} ${t.name}`;
      b.onclick = () => { tool = k; paintTools(); }; pal.appendChild(b); toolBtns[k] = b;
    }
    const paintTools = () => Object.entries(toolBtns).forEach(([k, b]) => b.classList.toggle('on', k === tool));
    paintTools();
    const selBox = document.createElement('div'); ctx.controls.appendChild(selBox);
    buttons(ctx.controls, [
      { label: '📐 Example circuit', onClick: () => loadExample() },
      { label: '🗑️ Clear all', onClick: () => { comps.clear(); selected = null; changed(); } },
    ]);

    function renderSel() {
      selBox.innerHTML = '';
      if (!selected) return;
      const c = selected, t = TOOLS[c.type];
      const h = document.createElement('div'); h.style.cssText = 'font-size:13px;margin:4px 0 8px;color:var(--muted)'; h.textContent = `Selected: ${t.name}`; selBox.appendChild(h);
      if (t.unit) slider(selBox, { label: t.name === 'Battery' ? 'Voltage' : 'Resistance', min: t.min, max: t.max, step: t.step, value: c.value, unit: t.unit, onInput: v => { c.value = v; edited = true; changed(); } });
      const acts = [];
      if (c.type === 'battery') acts.push({ label: '⇄ Flip direction', onClick: () => { c.flip = !c.flip; changed(); } });
      if (c.type === 'switch') acts.push({ label: c.closed ? 'Open switch' : 'Close switch', onClick: () => { toggle(c); renderSel(); } });
      if (c.type === 'bulb' && c.broken) acts.push({ label: '🔧 Replace bulb', onClick: () => { c.broken = false; changed(); renderSel(); } });
      acts.push({ label: '🗑️ Delete', onClick: () => { comps.delete(c.key); selected = null; changed(); renderSel(); } });
      buttons(selBox, acts);
    }

    // ---------- grid geometry ----------
    const cols = () => Math.max(4, Math.floor((s.w - 150) / SP));
    const rows = () => Math.max(3, Math.floor((s.h - 70) / SP));
    const ox = () => (s.w - cols() * SP) / 2 + 30, oy = () => (s.h - rows() * SP) / 2 + 12;
    const nodeXY = (x, y) => [ox() + x * SP, oy() + y * SP];
    const keyOf = (x, y, d) => `${x},${y},${d}`;
    const ends = (c) => c.d === 'h' ? [[c.x, c.y], [c.x + 1, c.y]] : [[c.x, c.y], [c.x, c.y + 1]];
    const nearestNode = (p) => {
      const x = Math.round((p.x - ox()) / SP), y = Math.round((p.y - oy()) / SP);
      if (x < 0 || y < 0 || x > cols() || y > rows()) return null;
      const [nx, ny] = nodeXY(x, y); return Math.hypot(nx - p.x, ny - p.y) < SP * 0.32 ? { x, y } : null;
    };
    const edgeAt = (p) => {
      let best = null, bd = 16;
      for (const c of comps.values()) {
        const [[ax, ay], [bx, by]] = ends(c).map(([x, y]) => nodeXY(x, y));
        const d = Math.hypot((ax + bx) / 2 - p.x, (ay + by) / 2 - p.y); if (d < bd) { bd = d; best = c; }
      }
      return best;
    };

    function place(a, b) {
      const dx = b.x - a.x, dy = b.y - a.y;
      if (Math.abs(dx) + Math.abs(dy) !== 1) return;
      const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), d = dx ? 'h' : 'v', key = keyOf(x, y, d);
      if (tool === 'erase') { comps.delete(key); changed(); return; }
      const t = TOOLS[tool];
      // battery + terminal is the end you dragged towards
      const flip = tool === 'battery' ? (dx < 0 || dy < 0) : false;
      const c = { key, x, y, d, type: tool, value: t.value, closed: tool !== 'switch' ? true : false, flip, broken: false, I: 0, phase: 0, spin: 0 };
      comps.set(key, c); selected = tool === 'wire' ? null : c; edited = true; renderSel(); changed();
    }
    function toggle(c) {
      const before = bulbStates();
      c.closed = !c.closed; edited = true; changed(); solve();
      const after = bulbStates();
      if ([...before.keys()].some(k => before.get(k) !== after.get(k))) ctx.complete('switch');
    }
    const bulbStates = () => new Map([...comps.values()].filter(c => c.type === 'bulb').map(c => [c.key, c.P > 0.3]));

    // ---------- pointer ----------
    let drag = null;
    const pos = (e) => { const r = s.cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const onDown = (e) => {
      const p = pos(e);
      if (e.button === 2) { const c = edgeAt(p); if (c) { comps.delete(c.key); if (selected === c) selected = null; renderSel(); changed(); } return; }
      for (const [k, pr] of Object.entries(probes)) if (Math.hypot(pr.px - p.x, pr.py - p.y) < 14) { drag = { probe: k }; s.cv.setPointerCapture(e.pointerId); return; }
      const n = nearestNode(p);
      if (n) { drag = { from: n, placedOne: false }; s.cv.setPointerCapture(e.pointerId); return; }
      const c = edgeAt(p);
      if (c) {
        if (tool === 'erase') { comps.delete(c.key); changed(); return; }
        if (c.type === 'switch') toggle(c);
        selected = c; renderSel();
      } else { selected = null; renderSel(); }
    };
    const onMove = (e) => {
      if (!drag) return; const p = pos(e);
      if (drag.probe) { const pr = probes[drag.probe]; pr.px = p.x; pr.py = p.y; const n = nearestNode(p); pr.x = n?.x ?? null; pr.y = n?.y ?? null; return; }
      const n = nearestNode(p);
      if (n && (n.x !== drag.from.x || n.y !== drag.from.y) && Math.abs(n.x - drag.from.x) + Math.abs(n.y - drag.from.y) === 1) {
        if (tool === 'wire' || tool === 'erase' || !drag.placedOne) { place(drag.from, n); drag.placedOne = true; }
        drag.from = n;
      }
      drag.cur = p;
    };
    const onUp = () => {
      if (drag?.probe) { const pr = probes[drag.probe]; if (pr.x !== null) [pr.px, pr.py] = nodeXY(pr.x, pr.y); }
      drag = null;
    };
    const noMenu = (e) => e.preventDefault();
    s.cv.addEventListener('pointerdown', onDown); s.cv.addEventListener('pointermove', onMove); s.cv.addEventListener('pointerup', onUp); s.cv.addEventListener('contextmenu', noMenu);

    // ---------- solver ----------
    function changed() { dirty = true; try { localStorage.setItem(SAVE, JSON.stringify([...comps.values()].map(({ x, y, d, type, value, closed, flip }) => ({ x, y, d, type, value, closed, flip })))); } catch { } }
    function conductance(c) {
      if (c.type === 'wire' || c.type === 'ammeter') return G_WIRE;
      if (c.type === 'switch') return c.closed ? G_WIRE : G_OPEN;
      if (c.type === 'resistor') return 1 / c.value;
      if (c.type === 'bulb') return c.broken ? G_OPEN : 1 / BULB_R;
      if (c.type === 'fan') return 1 / FAN_R;
      if (c.type === 'battery') return 1 / R_INT;
      return G_OPEN;
    }
    function solve() {
      dirty = false;
      const idx = new Map(), list = [...comps.values()];
      const id = (x, y) => { const k = x + ',' + y; if (!idx.has(k)) idx.set(k, idx.size); return idx.get(k); };
      const E = list.map(c => { const [[ax, ay], [bx, by]] = ends(c); return { c, a: id(ax, ay), b: id(bx, by), g: conductance(c) }; });
      const n = idx.size; if (!n) { solved = { V: new Map(), short: false }; return; }
      const G = Array.from({ length: n }, () => new Float64Array(n)), J = new Float64Array(n);
      for (let i = 0; i < n; i++) G[i][i] += 1e-9;
      G[0][0] += 1; // reference node
      for (const { c, a, b, g } of E) {
        G[a][a] += g; G[b][b] += g; G[a][b] -= g; G[b][a] -= g;
        if (c.type === 'battery') { // Norton equivalent, + terminal at b (or a if flipped)
          const [p, m] = c.flip ? [a, b] : [b, a], j = c.value / R_INT;
          J[p] += j; J[m] -= j;
        }
      }
      const V = gauss(G, J);
      let short = false;
      for (const { c, a, b, g } of E) {
        let I = (V[a] - V[b]) * g; // current a -> b
        if (c.type === 'battery') { const emf = c.flip ? -c.value : c.value; I = (emf - (V[b] - V[a])) / R_INT; }
        c.I = I; c.dV = V[a] - V[b];
        c.P = c.type === 'bulb' || c.type === 'fan' || c.type === 'resistor' ? I * I / g : 0;
        if (c.type === 'battery' && Math.abs(I) > 15) short = true;
      }
      solved = { V, idx, short };
      // bulbs burn out
      let blew = false;
      for (const c of list) if (c.type === 'bulb' && !c.broken && c.P > BULB_P * 3) { c.broken = true; blew = true; }
      if (blew) { ctx.toast('💥 Pop! A bulb burned out — too much power', 'warn'); ctx.complete('blow'); renderSel(); return solve(); }
      if (short) ctx.toast('⚠️ Short circuit! Huge current through the battery', 'warn');
      checkChallenges(list);
    }
    function checkChallenges(list) {
      if (!edited) return;
      const bulbs = list.filter(c => c.type === 'bulb' && !c.broken), bats = list.filter(c => c.type === 'battery');
      if (bulbs.some(b => b.P > 0.3)) ctx.complete('light');
      if (list.some(c => c.type === 'fan' && Math.abs(c.I) > 0.2)) ctx.complete('fan');
      if (list.some(c => c.type === 'ammeter' && Math.abs(Math.abs(c.I) - 0.25) <= 0.01)) ctx.complete('amps');
      if (bats.length === 1) {
        const Vb = Math.abs(bats[0].value), lit = bulbs.filter(b => b.P > 0.15);
        for (let i = 0; i < lit.length; i++) for (let j = i + 1; j < lit.length; j++) {
          const A = lit[i], B = lit[j], dA = Math.abs(A.dV), dB = Math.abs(B.dV);
          if (Math.abs(Math.abs(A.I) - Math.abs(B.I)) < 0.01 * Math.abs(A.I) + 1e-4 && Math.abs(dA + dB - Vb) < 0.15 * Vb && dA < 0.8 * Vb) ctx.complete('series');
          if (Math.abs(dA - Vb) < 0.12 * Vb && Math.abs(dB - Vb) < 0.12 * Vb) ctx.complete('parallel');
        }
      }
    }

    function loadExample() {
      comps.clear();
      const add = (x, y, d, type, extra = {}) => { const t = TOOLS[type]; comps.set(keyOf(x, y, d), { key: keyOf(x, y, d), x, y, d, type, value: t.value, closed: type !== 'switch', flip: false, broken: false, I: 0, phase: 0, spin: 0, ...extra }); };
      const x0 = 2, y0 = 1;
      add(x0, y0 + 1, 'v', 'battery', { value: 6, flip: true });
      add(x0, y0, 'h', 'wire'); add(x0 + 1, y0, 'h', 'switch', { closed: true }); add(x0 + 2, y0, 'h', 'wire');
      add(x0 + 3, y0, 'v', 'wire'); add(x0 + 3, y0 + 1, 'v', 'bulb');
      add(x0, y0, 'v', 'wire'); add(x0, y0 + 2, 'h', 'wire'); add(x0 + 1, y0 + 2, 'h', 'ammeter'); add(x0 + 2, y0 + 2, 'h', 'wire');
      selected = null; renderSel(); changed();
    }
    try { const saved = JSON.parse(localStorage.getItem(SAVE)); if (saved?.length) saved.forEach(o => comps.set(keyOf(o.x, o.y, o.d), { ...o, key: keyOf(o.x, o.y, o.d), broken: false, I: 0, phase: 0, spin: 0 })); else loadExample(); } catch { loadExample(); }
    s.onResize(() => { for (const pr of Object.values(probes)) if (pr.x !== null) [pr.px, pr.py] = nodeXY(pr.x, pr.y); });

    // ---------- draw ----------
    const stop = loop((dt, t) => {
      if (dirty) solve();
      const g = s.g, w = s.w, h = s.h;
      g.fillStyle = C.bg; g.fillRect(0, 0, w, h);
      // parked probes
      if (probes.red.x === null && !drag?.probe) { probes.red.px = w - 40; probes.red.py = h - 90; }
      if (probes.black.x === null && !drag?.probe) { probes.black.px = w - 40; probes.black.py = h - 50; }
      // dots
      g.fillStyle = '#34426a';
      for (let x = 0; x <= cols(); x++) for (let y = 0; y <= rows(); y++) { const [px, py] = nodeXY(x, y); g.beginPath(); g.arc(px, py, 2.5, 0, 7); g.fill(); }
      // components
      for (const c of comps.values()) drawComp(g, c, dt, t);
      // junction dots where 3+ parts meet
      const deg = new Map();
      for (const c of comps.values()) for (const [x, y] of ends(c)) deg.set(x + ',' + y, (deg.get(x + ',' + y) || 0) + 1);
      g.fillStyle = '#c9d1e3';
      for (const [k, d] of deg) if (d >= 3) { const [x, y] = k.split(',').map(Number), [px, py] = nodeXY(x, y); g.beginPath(); g.arc(px, py, 4, 0, 7); g.fill(); }
      // drag preview
      if (drag && drag.from && drag.cur && tool !== 'erase') { const [fx, fy] = nodeXY(drag.from.x, drag.from.y); g.strokeStyle = 'rgba(90,209,255,.5)'; g.setLineDash([5, 5]); g.lineWidth = 2; g.beginPath(); g.moveTo(fx, fy); g.lineTo(drag.cur.x, drag.cur.y); g.stroke(); g.setLineDash([]); }
      // probes
      let meter = '—';
      const Vat = (pr) => { if (pr.x === null || !solved.idx) return null; const i = solved.idx.get(pr.x + ',' + pr.y); return i === undefined ? null : solved.V[i]; };
      const vr = Vat(probes.red), vb = Vat(probes.black);
      if (vr !== null && vb !== null) meter = `${fmt(vr - vb)} V`;
      for (const [k, pr] of Object.entries(probes)) {
        g.strokeStyle = k === 'red' ? C.bad : '#9aa3b5'; g.lineWidth = 2; g.beginPath(); g.moveTo(pr.px, pr.py); g.quadraticCurveTo(pr.px + 30, pr.py + 40, w - 20, h - 20); g.stroke();
        g.fillStyle = k === 'red' ? C.bad : '#222a3d'; g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.beginPath(); g.arc(pr.px, pr.py, 9, 0, 7); g.fill(); g.stroke();
      }
      g.fillStyle = '#0b1020'; g.strokeStyle = C.gold; g.lineWidth = 2; g.fillRect(w - 150, h - 40, 120, 30); g.strokeRect(w - 150, h - 40, 120, 30);
      text(g, `🔎 ${meter}`, w - 90, h - 20, { color: C.gold, size: 14, weight: 700, align: 'center' });

      const list = [...comps.values()], bat = list.filter(c => c.type === 'battery');
      const sel = selected;
      ctx.readout.set({
        'Parts placed': list.length,
        'Batteries': bat.length ? bat.map(b => `${b.value} V`).join(', ') : '—',
        'Battery current': bat.length ? bat.map(b => `${fmt(Math.abs(b.I))} A`).join(', ') : '—',
        'Voltmeter (red − black)': meter,
        'Selected part': sel ? TOOLS[sel.type].name : '—',
        'Current through it': sel ? `${fmt(Math.abs(sel.I), 3)} A` : '—',
        'Voltage across it': sel ? `${fmt(Math.abs(sel.dV ?? 0))} V` : '—',
        'Power': sel && sel.P ? `${fmt(sel.P)} W` : '—',
        'Status': solved.short ? '⚠️ SHORT CIRCUIT' : 'OK',
      });
    });

    function drawComp(g, c, dt, t) {
      const [[ax, ay], [bx, by]] = ends(c).map(([x, y]) => nodeXY(x, y));
      const mx = (ax + bx) / 2, my = (ay + by) / 2, ang = Math.atan2(by - ay, bx - ax), L = SP;
      const I = c.I || 0, flowing = Math.abs(I) > 1e-3;
      g.save(); g.translate(mx, my); g.rotate(ang);
      const isSel = c === selected;
      const wireCol = solved.short && flowing ? '#ff6b7a' : '#8b97b3';
      g.strokeStyle = wireCol; g.lineWidth = 3; g.lineCap = 'round';
      const lead = (from, to) => { g.beginPath(); g.moveTo(from, 0); g.lineTo(to, 0); g.stroke(); };
      if (isSel) { g.fillStyle = 'rgba(90,209,255,.12)'; g.fillRect(-L / 2, -20, L, 40); }
      switch (c.type) {
        case 'wire': lead(-L / 2, L / 2); break;
        case 'battery': {
          lead(-L / 2, -6); lead(6, L / 2);
          const pRight = !c.flip; // + terminal at b (right in local coords)
          g.strokeStyle = C.ink; g.lineWidth = 3;
          const longX = pRight ? 6 : -6, shortX = -longX;
          g.beginPath(); g.moveTo(longX, -16); g.lineTo(longX, 16); g.stroke();
          g.lineWidth = 6; g.beginPath(); g.moveTo(shortX, -8); g.lineTo(shortX, 8); g.stroke();
          g.rotate(-ang);
          const [px, py] = [Math.cos(ang) * (pRight ? 18 : -18), Math.sin(ang) * (pRight ? 18 : -18)];
          text(g, '+', px - Math.sin(ang) * 16, py - 14 + Math.cos(ang) * 4, { color: C.bad, size: 16, weight: 800, align: 'center' });
          text(g, `${c.value} V`, -Math.sin(ang) * 26, Math.cos(ang) * 26 + 4, { color: C.gold, size: 12, weight: 700, align: 'center' });
          break;
        }
        case 'resistor': {
          lead(-L / 2, -16); lead(16, L / 2);
          g.strokeStyle = C.orange; g.lineWidth = 2.5; g.beginPath(); g.moveTo(-16, 0);
          for (let k = 0; k < 6; k++) g.lineTo(-16 + (k + 0.5) * (32 / 6), k % 2 ? 7 : -7);
          g.lineTo(16, 0); g.stroke();
          g.rotate(-ang); text(g, `${c.value} Ω`, -Math.sin(ang) * 20, Math.cos(ang) * 20 + 4, { color: C.orange, size: 11, weight: 700, align: 'center' });
          break;
        }
        case 'bulb': {
          lead(-L / 2, -12); lead(12, L / 2);
          const b = c.broken ? 0 : Math.min(1.4, Math.sqrt((c.P || 0) / BULB_P));
          if (b > 0.03) { const gr = g.createRadialGradient(0, 0, 2, 0, 0, 44 * b + 6); gr.addColorStop(0, `rgba(255,230,120,${0.9 * Math.min(1, b)})`); gr.addColorStop(1, 'rgba(255,200,60,0)'); g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 44 * b + 6, 0, 7); g.fill(); }
          g.fillStyle = c.broken ? '#3a3f4d' : `rgb(${80 + 175 * Math.min(1, b)},${80 + 150 * Math.min(1, b)},${90 + 40 * b})`;
          g.strokeStyle = '#d9deea'; g.lineWidth = 2; g.beginPath(); g.arc(0, 0, 12, 0, 7); g.fill(); g.stroke();
          g.strokeStyle = c.broken ? '#777' : '#6b4a12'; g.beginPath(); g.moveTo(-8, 0); g.lineTo(-3, -5); g.lineTo(3, 5); g.lineTo(8, 0); g.stroke();
          if (c.broken) { g.rotate(-ang); text(g, '💥', 0, -16, { size: 14, align: 'center' }); }
          break;
        }
        case 'switch': {
          lead(-L / 2, -12); lead(12, L / 2);
          g.fillStyle = C.ink; g.beginPath(); g.arc(-12, 0, 3.5, 0, 7); g.arc(12, 0, 3.5, 0, 7); g.fill();
          g.strokeStyle = c.closed ? C.good : C.bad; g.lineWidth = 3; g.beginPath(); g.moveTo(-12, 0);
          c.closed ? g.lineTo(12, 0) : g.lineTo(9, -14); g.stroke();
          break;
        }
        case 'fan': {
          lead(-L / 2, -14); lead(14, L / 2);
          c.spin += (c.I || 0) * dt * 6;
          g.strokeStyle = '#d9deea'; g.lineWidth = 2; g.fillStyle = '#243152'; g.beginPath(); g.arc(0, 0, 14, 0, 7); g.fill(); g.stroke();
          g.fillStyle = C.accent;
          for (let k = 0; k < 3; k++) { const a = c.spin + k * 2.094; g.beginPath(); g.ellipse(Math.cos(a) * 7, Math.sin(a) * 7, 7, 3, a, 0, 7); g.fill(); }
          break;
        }
        case 'ammeter': {
          lead(-L / 2, -13); lead(13, L / 2);
          g.fillStyle = '#10182c'; g.strokeStyle = C.gold; g.lineWidth = 2; g.beginPath(); g.arc(0, 0, 13, 0, 7); g.fill(); g.stroke();
          g.rotate(-ang); text(g, 'A', 0, 5, { color: C.gold, size: 13, weight: 800, align: 'center' });
          g.fillStyle = '#0b1020'; g.fillRect(-30, 16, 60, 18);
          text(g, `${fmt(Math.abs(I), 3)} A`, 0, 29, { color: C.gold, size: 11, weight: 700, align: 'center' });
          break;
        }
      }
      g.restore();
      // moving charges (conventional current a -> b)
      if (flowing && !(c.type === 'switch' && !c.closed)) {
        c.phase = (c.phase + I * dt * 60) % 16;
        g.fillStyle = C.gold;
        const len = Math.hypot(bx - ax, by - ay), ux = (bx - ax) / len, uy = (by - ay) / len;
        for (let d = ((c.phase % 16) + 16) % 16; d < len; d += 16) { g.beginPath(); g.arc(ax + ux * d, ay + uy * d, 2.3, 0, 7); g.fill(); }
      }
    }

    return { destroy() { stop(); s.cv.removeEventListener('contextmenu', noMenu); s.destroy(); } };
  },
};

function gauss(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-12;
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / d; if (!f) continue; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  const x = new Float64Array(n);
  for (let r = n - 1; r >= 0; r--) { let s = M[r][n]; for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]; x[r] = s / (M[r][r] || 1e-12); }
  return x;
}
