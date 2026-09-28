# Physics Quest Lab

Interactive physics experiments as a game: play with each simulation, complete challenges, earn XP and stars (progress is saved in the browser).

Run: `python3 -m http.server 5179` in this folder, then open http://localhost:5179

- **Mechanics**: projectile launcher, inclined plane & friction, pendulum, collisions (momentum), springs (Hooke's law), orbits
- **Electricity & Magnetism**: circuit builder (nodal analysis), electric field playground, magnet & coil (Faraday's law)
- **Waves & Optics**: ripple tank & standing waves, laser & lenses
- **Thermodynamics**: ideal gas box

Structure: `js/app.js` (hub, XP, challenge list), `js/ui.js` (shared canvas/controls helpers), `js/labs/<id>.js` (one module per experiment, see `projectile.js` as the reference).
