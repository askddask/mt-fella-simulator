// Mt. Fella Simulator — tricks.js
// Ollie point tracking, 360 spin logic (ease-in/ease-out), switch-stance state.
// Does NOT own position/velocity — communicates results back via state flags.

window.Tricks = (() => {

  // ─── Spin constants ───────────────────────────────────────────────────────
  const SPIN_MAX_RATE     = (Math.PI * 2) / 1.3;  // full 360 in 1.3s at peak speed
  const SPIN_EASE_IN      = 3.5;   // rate ramp-up (rad/s² equivalent)
  const SPIN_EASE_OUT     = 4.0;   // rate ramp-down on release
  const SPIN_STOP_THRESH  = 0.05;  // rad/s — stop spinning below this

  // Landing tolerance: within ±30° of forward = clean landing, gets 360 points
  // (0° = forward, 180° = backward)
  const LANDING_TOLERANCE = (30 / 180) * Math.PI;  // 30 degrees in radians

  // Ollie minimum charge for point award
  const OLLIE_MIN_CHARGE  = 0.15;
  const OLLIE_MIN_AIRTIME = 0.25;  // seconds (must match physics.js constant)

  const state = {
    // Spin
    spinning:      false,
    spinDirection: 0,     // -1 = left, +1 = right
    spinRate:      0,     // current rad/s
    spinAccum:     0,     // total radians spun this air session (absolute)
    spin360Complete: false,

    // Ollie
    ollieActive:   false,
    olliePoints:   0,    // points awarded this trick (0 until landing)

    // 360
    spin360Points: 0,

    // Landing state
    landedClean:   false,
    landedSwitch:  false,  // landed backward → switch stance
    crashOnLanding: false, // landed on mogul uphill face

    // Switch stance (mirrored from physics for scoring convenience)
    inSwitch:      false,

    // This tick's awarded points (reset each tick; scoring.js accumulates)
    pointsThisTick: 0,

    // Accumulated rotation visible to render (for drawing the mid-air skier spin)
    visualRotation: 0,
  };

  let wasAirborne = false;

  function init() { reset(); }

  function reset() {
    state.spinning      = false;
    state.spinDirection = 0;
    state.spinRate      = 0;
    state.spinAccum     = 0;
    state.spin360Complete = false;
    state.ollieActive   = false;
    state.olliePoints   = 0;
    state.spin360Points = 0;
    state.landedClean   = false;
    state.landedSwitch  = false;
    state.crashOnLanding = false;
    state.inSwitch      = false;
    state.pointsThisTick = 0;
    state.visualRotation = 0;
    wasAirborne = false;
  }

  function update(dt, inputState, physState) {
    state.pointsThisTick = 0;
    state.landedClean    = false;
    state.crashOnLanding = false;

    const nowAirborne = physState.airborne;

    // ── Takeoff ─────────────────────────────────────────────────────────
    if (!wasAirborne && nowAirborne) {
      state.ollieActive    = physState.ollieJumpCharge >= OLLIE_MIN_CHARGE;
      state.spinAccum      = 0;
      state.spin360Complete = false;
      state.visualRotation = 0;
      state.spinning       = false;
      state.spinRate       = 0;
    }

    // ── Mid-air spin ─────────────────────────────────────────────────────
    if (nowAirborne) {
      const wantLeft  = inputState.spinLeft;
      const wantRight = inputState.spinRight;

      if ((wantLeft || wantRight) && !state.spin360Complete) {
        const wantDir = wantLeft ? -1 : 1;

        if (!state.spinning || state.spinDirection !== wantDir) {
          state.spinning      = true;
          state.spinDirection = wantDir;
          // Don't reset spinRate if already spinning same direction
          if (state.spinDirection !== wantDir) state.spinRate = 0;
        }

        // Ease in: ramp up to max rate
        state.spinRate = Math.min(state.spinRate + SPIN_EASE_IN * dt, SPIN_MAX_RATE);
      } else if (state.spinning) {
        // Ease out on release
        state.spinRate = Math.max(0, state.spinRate - SPIN_EASE_OUT * dt);
        if (state.spinRate < SPIN_STOP_THRESH) {
          state.spinning = false;
          state.spinRate  = 0;
        }
      }

      if (state.spinning || state.spinRate > 0) {
        const delta = state.spinDirection * state.spinRate * dt;
        state.spinAccum      += Math.abs(delta);
        state.visualRotation += delta;

        // Check for full 360 completion
        if (!state.spin360Complete && state.spinAccum >= Math.PI * 2) {
          state.spin360Complete = true;
        }
      }
    }

    // ── Landing ──────────────────────────────────────────────────────────
    if (wasAirborne && !nowAirborne) {
      const airTime = physState.airTime;

      // Check uphill face crash
      if (window.Terrain.isLandingOnUphillFace(physState.x, physState.y)) {
        state.crashOnLanding = true;
        window.Physics.crash();
      } else {
        // Award ollie points
        if (state.ollieActive && airTime >= OLLIE_MIN_AIRTIME) {
          state.pointsThisTick += 100;
        }

        // Award 360 points if complete and landed facing forward-ish
        if (state.spin360Complete) {
          // Normalize visual rotation to 0–2π, then check how close to full multiple
          const rot = state.visualRotation;
          const fullRotations = rot / (Math.PI * 2);
          const remainder = Math.abs(rot % (Math.PI * 2));
          // remainder near 0 or 2π = facing forward
          const facingForward = remainder < LANDING_TOLERANCE || remainder > (Math.PI * 2 - LANDING_TOLERANCE);

          if (facingForward) {
            state.pointsThisTick += 360;
            state.landedClean = true;
            // Restore switch to false (landed forward)
            physState.switchStance = false;
            physState.skiAngle = physState.skiAngle % (Math.PI * 2);
            // Snap ski angle back toward 0 (forward)
            physState.skiAngle *= 0.1;
          } else {
            // Partial or over-rotated: switch stance or continue in whatever direction
            const forwardOrBack = remainder > Math.PI * 0.5 && remainder < Math.PI * 1.5;
            state.landedSwitch = forwardOrBack;
            physState.switchStance = forwardOrBack;
            // Set ski angle to reflect actual facing direction from spin
            physState.skiAngle = state.visualRotation % (Math.PI * 2);
            if (physState.skiAngle > Math.PI)  physState.skiAngle -= Math.PI * 2;
            if (physState.skiAngle < -Math.PI) physState.skiAngle += Math.PI * 2;
          }
        } else if (state.spinAccum > 0) {
          // Partial spin — no points, apply facing direction
          physState.skiAngle = state.visualRotation % (Math.PI * 2);
          if (physState.skiAngle > Math.PI)  physState.skiAngle -= Math.PI * 2;
          if (physState.skiAngle < -Math.PI) physState.skiAngle += Math.PI * 2;
          physState.switchStance = Math.abs(physState.skiAngle) > Math.PI * 0.5;
        }

        state.landedClean = !state.landedSwitch && !state.crashOnLanding;
      }

      // Reset air session state
      state.spinning    = false;
      state.spinRate    = 0;
      state.ollieActive = false;
    }

    state.inSwitch = physState.switchStance;
    wasAirborne    = nowAirborne;
  }

  return { init, reset, update, state };
})();
