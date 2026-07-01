// Mt. Fella Simulator — main.js
// Owns the rAF loop and fixed-timestep physics dispatch.

// ─── Fixed timestep constants ───────────────────────────────────────────────
const PHYSICS_STEP = 1 / 60;   // 60 Hz physics regardless of render rate
const MAX_CATCHUP   = 5;        // max physics ticks per frame (prevents spiral of death)

let accumulator  = 0;
let lastTime     = null;

// Module references (assigned after DOM ready)
let input, physics, terrain, tricks, scoring, render, ui;

function tick(timestamp) {
  requestAnimationFrame(tick);

  if (lastTime === null) { lastTime = timestamp; }
  let dt = (timestamp - lastTime) / 1000;
  lastTime = timestamp;

  // Clamp dt to avoid huge catchup bursts after tab-blur
  if (dt > 0.25) dt = 0.25;
  accumulator += dt;

  let steps = 0;
  while (accumulator >= PHYSICS_STEP && steps < MAX_CATCHUP) {
    input.update();
    physics.update(PHYSICS_STEP, input.state, terrain);
    tricks.update(PHYSICS_STEP, input.state, physics.state);
    scoring.update(PHYSICS_STEP, physics.state, tricks.state, input.state);
    terrain.updateForSkier(physics.state);
    accumulator -= PHYSICS_STEP;
    steps++;
  }

  render.draw(timestamp, physics.state, terrain, tricks.state, scoring.state, ui.currentScreen);
}

window.addEventListener('DOMContentLoaded', () => {
  const canvas    = document.getElementById('game-canvas');
  const hudCanvas = document.getElementById('hud-canvas');

  // Import order matters — modules assigned to window globals by their files
  input   = window.Input;
  physics = window.Physics;
  terrain = window.Terrain;
  tricks  = window.Tricks;
  scoring = window.Scoring;
  render  = window.Render;
  ui      = window.UI;

  // Wire ui callbacks
  ui.onStartGame = () => {
    physics.reset();
    tricks.reset();
    scoring.reset();
    terrain.reset();
    render.resetCamera();
  };

  ui.init();
  terrain.init();
  render.init(canvas, hudCanvas, terrain);
  physics.init();
  input.init();
  tricks.init();
  scoring.init();

  requestAnimationFrame(tick);
});
