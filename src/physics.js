// Mt. Fella Simulator — physics.js
// Weight-shift / edge-grip ski simulation.
// Velocity emerges from slope, gravity, and ski orientation — NOT from direct key steering.

window.Physics = (() => {

  // ─── Tuning constants (retune here after playtesting) ───────────────────
  const GRAVITY          = 9.8;    // m/s² base gravity
  // Slope steepness is no longer a constant — it's sampled per-tick from terrain.getLocalGrade()
  // so steeper patches accelerate the skier and flatter patches let them slow.

  // Edge grip: how strongly the ski arc force pushes velocity perpendicular to ski heading
  const EDGE_GRIP        = 2.8;    // higher = tighter carve arc, feels more responsive
  const EDGE_TURN_RATE   = 1.4;    // rad/s — how fast ski heading rotates when edge is engaged
  const FLAT_SKI_DRAG    = 0.55;   // friction deceleration (m/s²) when skis are across fall line
  const KINETIC_FRICTION = 0.08;   // base rolling/gliding friction always present
  const MAX_SPEED        = 22;     // m/s hard cap (~79 km/h) — keeps sim sane

  // Pole plant — two-part action: Shift arms it, then a weight shift (edge change)
  // must follow within POLE_TIMING_WINDOW seconds to count as correct.
  const POLE_SPEED_BONUS   = 1.4;  // m/s instant speed boost on correct pole plant
  const POLE_TIMING_WINDOW = 0.2;  // seconds allowed between pole plant and weight shift
  const POLE_PLANT_COOLDOWN = 0.25; // seconds before another pole plant can be armed

  // Ollie
  const OLLIE_CHARGE_RATE   = 1.0;  // charge units/s while Space held
  const OLLIE_MAX_CHARGE    = 1.0;  // cap (1 = fully charged)
  const OLLIE_SPEED_PENALTY = 1.8;  // m/s² deceleration while charging (capped effect)
  const OLLIE_MAX_PENALTY   = 0.8;  // max speed that can be bled off by charging
  const OLLIE_JUMP_SPEED    = 7.0;  // m/s vertical velocity at full charge
  const OLLIE_MIN_AIR_TIME  = 0.25; // seconds — minimum air to award trick points

  // World scale: 1 unit = 1 meter in world space; canvas pixels via camera transform
  const WORLD_SCALE = 40;          // pixels per meter

  // ─── Mutable skier state ─────────────────────────────────────────────────
  const state = {
    // World position (meters, Y increases downhill)
    x: 0,
    y: 0,

    // Velocity vector (m/s, world space)
    vx: 0,
    vy: 0,

    // Vertical (air) state
    vz: 0,          // vertical velocity (+ = upward)
    z:  0,          // height above terrain (0 = on snow)
    airborne: false,
    airTime:  0,

    // Ski orientation (radians, 0 = pointing straight down the fall line / +Y)
    skiAngle: 0,     // relative to fall line; positive = nose right of fall line

    // Which edge is loaded: -1 = left, 0 = flat, +1 = right
    edgeLoaded: 0,

    // Pole plant state (two-part: Shift arms it, weight shift within the window confirms it)
    polePlantCooldown: 0,      // seconds until another pole plant can be armed
    polePlantArmed:    false,  // true while waiting for the follow-up weight shift
    polePlantArmedTimer: 0,    // seconds since armed
    polePlantAttempted: false, // pulses true the tick a pole plant is armed (for scoring)
    polePlantSucceeded: false, // pulses true the tick the follow-up weight shift confirms it
    lastEdge:            0,    // previous frame edge for detecting weight transfer

    // Ollie charge
    ollieCharge:       0,
    olliePenaltyBled:  0,     // total speed already bled this charge session

    // Crash / reset
    crashed: false,
    crashTimer: 0,

    // Did game start (first directional input received)?
    started: false,

    // Switch stance (skis pointing backward relative to travel direction)
    switchStance: false,

    // Elevation above the terrain surface (set by terrain.js mogul shape)
    terrainZ: 0,

    // Cached screen position (set by camera/render)
    screenX: 0,
    screenY: 0,
  };

  // Internal: accumulated penalty bled this charge so it can be capped
  let chargeSpeedBled = 0;

  function init() { reset(); }

  function reset() {
    state.x = 0;
    state.y = 0;
    state.vx = 0;
    state.vy = 0;
    state.vz = 0;
    state.z  = 0;
    state.airborne = false;
    state.airTime  = 0;
    state.skiAngle = 0;
    state.edgeLoaded = 0;
    state.polePlantCooldown = 0;
    state.polePlantArmed = false;
    state.polePlantArmedTimer = 0;
    state.polePlantAttempted = false;
    state.polePlantSucceeded = false;
    state.lastEdge = 0;
    state.ollieCharge = 0;
    state.olliePenaltyBled = 0;
    state.crashed = false;
    state.crashTimer = 0;
    state.started = false;
    state.switchStance = false;
    state.terrainZ = 0;
    chargeSpeedBled = 0;
  }

  function update(dt, inputState, terrain) {
    // Crash cooldown: hold the reset state for a moment, then reset to top
    if (state.crashed) {
      state.crashTimer -= dt;
      if (state.crashTimer <= 0) {
        reset();
        terrain.reset();
        window.Render.resetCamera();
      }
      return;
    }

    // Wait for first directional input before simulating
    if (!state.started) {
      if (inputState.weightLeft || inputState.weightRight) {
        state.started = true;
      } else {
        return;
      }
    }

    // ── Edge loading ─────────────────────────────────────────────────────
    let newEdge = 0;
    if (inputState.weightLeft && !inputState.weightRight)       newEdge = -1;  // weight on left ski → right arc
    else if (inputState.weightRight && !inputState.weightLeft)  newEdge =  1;  // weight on right ski → left arc
    // Both or neither = flat ski

    // Weight shift = the loaded edge just changed (including from flat), one-tick pulse.
    const weightShifted = (newEdge !== state.lastEdge && newEdge !== 0);
    state.edgeLoaded = newEdge;

    // ── Pole plant (two-part action) ─────────────────────────────────────
    // Shift arms the pole plant; a weight shift within POLE_TIMING_WINDOW seconds
    // confirms it as "correct" (speed boost + points). Without the follow-through
    // in time, the pole plant expires with no bonus.
    state.polePlantAttempted = false;
    state.polePlantSucceeded = false;

    if (state.polePlantCooldown > 0) state.polePlantCooldown -= dt;

    if (inputState.polePlantJustPressed && state.polePlantCooldown <= 0 && !state.airborne) {
      state.polePlantArmed      = true;
      state.polePlantArmedTimer = 0;
      state.polePlantCooldown   = POLE_PLANT_COOLDOWN;
      state.polePlantAttempted  = true;
    }

    if (state.polePlantArmed) {
      if (weightShifted) {
        const spd = Math.sqrt(state.vx * state.vx + state.vy * state.vy);
        if (spd > 0.1) {
          const factor = (spd + POLE_SPEED_BONUS) / spd;
          state.vx *= factor;
          state.vy *= factor;
        }
        state.polePlantSucceeded = true;
        state.polePlantArmed     = false;
      } else {
        state.polePlantArmedTimer += dt;
        if (state.polePlantArmedTimer > POLE_TIMING_WINDOW) {
          state.polePlantArmed = false; // expired — no bonus
        }
      }
    }

    // ── Ollie charge & release ───────────────────────────────────────────
    if (!state.airborne) {
      if (inputState.ollieCharging) {
        state.ollieCharge = Math.min(state.ollieCharge + OLLIE_CHARGE_RATE * dt, OLLIE_MAX_CHARGE);

        // Speed penalty while charging (capped per-charge-session)
        if (chargeSpeedBled < OLLIE_MAX_PENALTY) {
          const spd = Math.sqrt(state.vx * state.vx + state.vy * state.vy);
          const bleed = Math.min(OLLIE_SPEED_PENALTY * dt, spd * 0.5, OLLIE_MAX_PENALTY - chargeSpeedBled);
          if (spd > 0.1) {
            const newSpd = spd - bleed;
            state.vx = state.vx / spd * newSpd;
            state.vy = state.vy / spd * newSpd;
          }
          chargeSpeedBled += bleed;
        }
      } else {
        if (!inputState.ollieRelease) {
          // Space not held and not just released: bleed charge away slowly if not used
          state.ollieCharge = Math.max(0, state.ollieCharge - 2.0 * dt);
          chargeSpeedBled = Math.max(0, chargeSpeedBled - 2.0 * dt);
        }
      }

      if (inputState.ollieRelease && state.ollieCharge > 0.05) {
        // Pop!
        state.vz = OLLIE_JUMP_SPEED * state.ollieCharge;
        state.airborne = true;
        state.airTime  = 0;
        state.ollieJumpCharge = state.ollieCharge; // store for tricks
        state.ollieCharge = 0;
        chargeSpeedBled   = 0;
      }
    }

    // ── Airborne physics ─────────────────────────────────────────────────
    if (state.airborne) {
      state.airTime += dt;
      state.vz -= GRAVITY * dt;
      state.z  += state.vz * dt;

      // Land when z reaches terrain surface
      const groundZ = state.terrainZ; // set by terrain.js each tick
      if (state.z <= groundZ) {
        state.z = groundZ;
        state.airborne = false;
        state.vz = 0;
        // Landing: tricks.js checks angle and awards points via its own update
        // physics just puts us back on ground
      }
      // Horizontal motion continues with existing vx/vy (no air drag for simplicity)
    }

    if (!state.airborne) {
      state.z = state.terrainZ;
    }

    // ── Ski heading rotation from edge grip ──────────────────────────────
    if (!state.airborne && state.edgeLoaded !== 0) {
      // Edge loaded → ski arc: rotate ski angle toward the carved direction
      // edgeLoaded -1 (left edge) → skis turn right (angle decreases from 0)
      // edgeLoaded +1 (right edge) → skis turn left (angle increases)
      // "turnDirection" for carve: left edge digs → skier arcs right → skiAngle goes toward negative
      const turnDir = -state.edgeLoaded;  // -1 → left edge → turn right → skiAngle negative direction...
      // Actually: left arrow = weight left ski = left edge = carve right = ski nose swings right
      // Let's define skiAngle as angle of travel direction from fall line (+Y)
      // positive skiAngle = facing right of fall line
      // Left edge → carve right → skiAngle increases (nose goes right)
      // Right edge → carve left → skiAngle decreases (nose goes left)

      // Speed factor: faster = stronger edge effect (up to a reasonable cap)
      const spd = Math.sqrt(state.vx * state.vx + state.vy * state.vy);
      const spdFactor = Math.min(spd / 5.0, 1.5);

      state.skiAngle += state.edgeLoaded * EDGE_TURN_RATE * spdFactor * dt;

      // Clamp ski angle to avoid full reversal in normal carving
      state.skiAngle = Math.max(-Math.PI * 0.7, Math.min(Math.PI * 0.7, state.skiAngle));
    }

    // ── Switch stance detection ──────────────────────────────────────────
    // If ski is pointing more than 90° from fall line (backward relative to travel), it's switch
    state.switchStance = Math.abs(state.skiAngle) > Math.PI * 0.5;

    // ── Velocity from slope gravity + edge grip ──────────────────────────
    if (!state.airborne) {
      // Fall-line gravity component: always pulls down the slope (+Y in world)
      // When skis are across the fall line, edge scrape (flat ski drag) resists this.
      // Local grade is sampled from the terrain's rolling undulation: steeper patches
      // accelerate, flatter/cresting patches let the skier slow.
      const localGrade = terrain.getLocalGrade(state.x, state.y);
      const slopeGravity = GRAVITY * localGrade;
      const fallLineAlignment = Math.cos(state.skiAngle); // 1 = straight downhill, 0 = perpendicular
      const slopeAccel = slopeGravity * fallLineAlignment;

      // Apply along ski heading direction
      const skiDirX = Math.sin(state.skiAngle);   // X component of ski facing direction
      const skiDirY = Math.cos(state.skiAngle);   // Y component (positive = downhill)

      state.vy += slopeAccel * dt;

      // Edge grip: pull lateral velocity toward zero (grip resists skidding sideways)
      // The carved arc: redirect velocity toward the ski's facing direction
      if (state.edgeLoaded !== 0) {
        const spd = Math.sqrt(state.vx * state.vx + state.vy * state.vy);
        if (spd > 0.01) {
          // Blend current velocity toward ski direction
          const targetVx = skiDirX * spd;
          const targetVy = skiDirY * spd;
          const blend = Math.min(EDGE_GRIP * dt, 1.0);
          state.vx += (targetVx - state.vx) * blend;
          state.vy += (targetVy - state.vy) * blend;
        }
      }

      // Flat ski drag: when skis are across the fall line, strong scraping deceleration
      if (state.edgeLoaded === 0) {
        const crossComponent = Math.abs(Math.sin(state.skiAngle));
        const dragDecel = FLAT_SKI_DRAG * crossComponent;
        const spd = Math.sqrt(state.vx * state.vx + state.vy * state.vy);
        if (spd > 0.01) {
          const newSpd = Math.max(0, spd - dragDecel * dt);
          state.vx = state.vx / spd * newSpd;
          state.vy = state.vy / spd * newSpd;
        }
      }

      // Base kinetic friction (always present)
      {
        const spd = Math.sqrt(state.vx * state.vx + state.vy * state.vy);
        if (spd > 0.01) {
          const newSpd = Math.max(0, spd - KINETIC_FRICTION * GRAVITY * dt);
          state.vx = state.vx / spd * newSpd;
          state.vy = state.vy / spd * newSpd;
        }
      }

      // Speed cap
      {
        const spd = Math.sqrt(state.vx * state.vx + state.vy * state.vy);
        if (spd > MAX_SPEED) {
          state.vx = state.vx / spd * MAX_SPEED;
          state.vy = state.vy / spd * MAX_SPEED;
        }
      }
    }

    // ── Integrate position ───────────────────────────────────────────────
    state.x += state.vx * dt;
    state.y += state.vy * dt;

    // ── Terrain collision (delegated to terrain.js via callback) ─────────
    // terrain.js sets state.terrainZ each tick before physics.update via terrain.updateForSkier
    // Tree / boundary collision: terrain checks and calls physics.crash() if needed
    state.lastEdge = state.edgeLoaded;
  }

  function crash() {
    if (state.crashed) return;
    state.crashed    = true;
    state.crashTimer = 1.5;  // 1.5 seconds of "crashed" display before reset
    state.vx = 0;
    state.vy = 0;
    state.vz = 0;
  }

  return { init, reset, update, crash, state, WORLD_SCALE };
})();
