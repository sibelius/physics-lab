// App shell: lab catalogue, XP/progress, lab view.
import { readout } from './ui.js';

export const AREAS = {
  mech: { name: 'Mechanics', color: 'var(--mech)' },
  elec: { name: 'Electricity & Magnetism', color: 'var(--elec)' },
  wave: { name: 'Waves & Optics', color: 'var(--wave)' },
  thermo: { name: 'Thermodynamics', color: 'var(--thermo)' },
};

// Every lab lives in js/labs/<id>.js. Missing files show as "under construction".
const CATALOGUE = [
  ['projectile', 'mech'], ['incline', 'mech'], ['pendulum', 'mech'], ['collisions', 'mech'], ['spring', 'mech'], ['orbits', 'mech'],
  ['circuit', 'elec'], ['charges', 'elec'], ['induction', 'elec'],
  ['waves', 'wave'], ['optics', 'wave'],
  ['gas', 'thermo'],
];

const $ = (id) => document.getElementById(id);
const SAVE = 'physics-quest-v1';
let progress = {};
try { progress = JSON.parse(localStorage.getItem(SAVE)) || {}; } catch { progress = {}; }
const save = () => { try { localStorage.setItem(SAVE, JSON.stringify(progress)); } catch { } };

const labs = {};
let filter = 'all', current = null;

function totals() {
  let xp = 0, stars = 0;
  for (const lab of Object.values(labs)) {
    const done = progress[lab.id] || [];
    for (const c of lab.challenges) if (done.includes(c.id)) xp += c.xp;
    if (lab.challenges.length && done.length >= lab.challenges.length) stars++;
  }
  return { xp, stars };
}
function renderPlayer() {
  const { xp, stars } = totals();
  const lvl = Math.floor(xp / 150) + 1, into = xp % 150;
  $('lvl').textContent = `Lv ${lvl}`; $('xp').textContent = `${xp} XP`; $('stars').textContent = `⭐ ${stars}`;
  $('xpfill').style.width = `${(into / 150) * 100}%`;
}

export function toast(msg, kind = '') {
  const t = $('toast'); t.textContent = msg; t.className = 'show ' + kind;
  clearTimeout(toast.h); toast.h = setTimeout(() => (t.className = kind), 2600);
}

function renderAreas() {
  const opts = [['all', 'All labs'], ...Object.entries(AREAS).map(([k, a]) => [k, a.name])];
  $('areas').innerHTML = opts.map(([k, n]) => `<button data-k="${k}" class="${filter === k ? 'on' : ''}">${n}</button>`).join('');
  $('areas').querySelectorAll('button').forEach(b => (b.onclick = () => { filter = b.dataset.k; renderAreas(); renderCards(); }));
}

function renderCards() {
  $('cards').innerHTML = CATALOGUE.filter(([, a]) => filter === 'all' || filter === a).map(([id, area]) => {
    const lab = labs[id], c = AREAS[area].color;
    if (!lab) return `<div class="card soon" style="--c:${c}"><div class="icon">🛠️</div><h4>${id[0].toUpperCase() + id.slice(1)}</h4><p>Under construction…</p><div class="meta"><span>${AREAS[area].name}</span></div></div>`;
    const done = (progress[id] || []).length, tot = lab.challenges.length;
    const xp = lab.challenges.reduce((s, ch) => s + ch.xp, 0);
    return `<button class="card" data-id="${id}" style="--c:${c}"><div class="icon">${lab.icon}</div><h4>${lab.title}</h4><p>${lab.blurb}</p>
      <div class="meta"><span>${AREAS[area].name}</span><span>${done}/${tot} · <b>${xp} XP</b></span></div><div class="prog"><i style="width:${tot ? (done / tot) * 100 : 0}%"></i></div></button>`;
  }).join('');
  $('cards').querySelectorAll('.card[data-id]').forEach(b => (b.onclick = () => { location.hash = b.dataset.id; }));
}

function renderChallenges(lab) {
  const done = progress[lab.id] || [];
  const ul = $('challenges');
  ul.innerHTML = '';
  lab.challenges.forEach(ch => {
    const li = document.createElement('li');
    const ok = done.includes(ch.id);
    li.className = ok ? 'done' : '';
    li.innerHTML = `<span class="tick">${ok ? '✅' : '◻️'}</span><div style="flex:1">${ch.text}${ch.check && !ok ? `<div class="answer"><input placeholder="${ch.placeholder || 'answer'}" /><button class="btn">Check</button></div>` : ''}</div><span class="xp">+${ch.xp} XP</span>`;
    if (ch.check && !ok) {
      const inp = li.querySelector('input'), btn = li.querySelector('button');
      const go = () => {
        const v = parseFloat(inp.value.replace(',', '.'));
        if (Number.isNaN(v)) return toast('Type a number first', 'info');
        if (ch.check(v)) complete(lab, ch.id); else { toast('Not quite — measure again!', 'warn'); inp.select(); }
      };
      btn.onclick = go; inp.onkeydown = (e) => e.key === 'Enter' && go();
    }
    ul.appendChild(li);
  });
}

function complete(lab, id) {
  const done = (progress[lab.id] ||= []);
  if (done.includes(id)) return;
  done.push(id); save();
  const ch = lab.challenges.find(c => c.id === id);
  toast(`🎯 Challenge complete: +${ch?.xp ?? 0} XP`);
  if (done.length === lab.challenges.length) setTimeout(() => toast(`⭐ Lab mastered: ${lab.title}!`), 2700);
  renderChallenges(lab); renderPlayer();
}

function openLab(id) {
  const lab = labs[id]; if (!lab) return showHub();
  closeLab();
  $('hub').classList.add('hidden'); $('lab').classList.remove('hidden');
  $('lab-title').textContent = `${lab.icon} ${lab.title}`;
  $('lab-area').textContent = AREAS[lab.area].name;
  $('theory').innerHTML = lab.theory;
  ['stage', 'controls', 'readout'].forEach(k => ($(k).innerHTML = ''));
  renderChallenges(lab);
  const ctx = {
    stage: $('stage'), controls: $('controls'), readout: readout($('readout')),
    complete: (cid) => complete(lab, cid), isDone: (cid) => (progress[lab.id] || []).includes(cid), toast,
  };
  current = { lab, inst: lab.mount(ctx) };
  window.scrollTo(0, 0);
}
function closeLab() { if (current) { try { current.inst?.destroy?.(); } catch (e) { console.error(e); } current = null; } }
function showHub() { closeLab(); $('lab').classList.add('hidden'); $('hub').classList.remove('hidden'); renderCards(); renderPlayer(); }

$('back').onclick = () => { location.hash = ''; };
addEventListener('hashchange', route);
function route() { const id = location.hash.slice(1); if (id && labs[id]) openLab(id); else showHub(); }

async function boot() {
  renderAreas(); renderCards();
  await Promise.all(CATALOGUE.map(async ([id, area]) => {
    try { const m = await import(`./labs/${id}.js?v=${Date.now()}`); labs[id] = { ...m.default, id, area }; }
    catch (e) { if (!String(e).includes('Failed to fetch') && !String(e).includes('Importing a module script failed')) console.error(id, e); }
  }));
  renderPlayer(); route();
}
boot();
