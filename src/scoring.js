// Mt. Fella Simulator — scoring.js
// Live score: speed average + pole-plant quality + trick points.
// High score persists via localStorage.

window.Scoring = (() => {

  // Score formula (documented here, not scattered):
  //   liveScore   = trickPoints + speedScore
  //   speedScore  = avgSpeedMps * 8              (at 10 m/s avg → 80 pts; grows with speed)
  //   trickPoints = accumulated pole plant (20) + ollie (100) + 360 (360) points
  // High score = max liveScore across runs (localStorage key: 'mtfella_hiscore')

  const LS_KEY = 'mtfella_hiscore';
  const POLE_PLANT_POINTS = 20; // per correct (Shift then weight-shift within 0.2s) pole plant

  const state = {
    trickPoints:       0,
    correctPolePlants: 0,
    totalPolePlants:   0,
    avgSpeedMps:       0,
    liveScore:         0,
    highScore:         0,
    runTime:           0,    // seconds since run started

    // Reserved for future v2 switch-distance points (not awarded in v1)
    switchDistancePoints: 0,
    switchDistanceM:      0,

    // Per-tick feedback
    lastTrickLabel:    '',
    lastTrickTimer:    0,    // how long to show the label
  };

  // Internal speed accumulator
  let speedSamples = 0;
  let speedSum     = 0;

  function init() {
    state.highScore = parseInt(localStorage.getItem(LS_KEY) || '0', 10);
    reset();
  }

  function reset() {
    state.trickPoints       = 0;
    state.correctPolePlants = 0;
    state.totalPolePlants   = 0;
    state.avgSpeedMps       = 0;
    state.liveScore         = 0;
    state.runTime           = 0;
    state.switchDistancePoints = 0;
    state.switchDistanceM      = 0;
    state.lastTrickLabel    = '';
    state.lastTrickTimer    = 0;
    speedSamples = 0;
    speedSum     = 0;
  }

  function update(dt, physState, tricksState, inputState) {
    if (!physState.started || physState.crashed) return;

    state.runTime += dt;

    // Speed sample (only when moving)
    const spd = Math.sqrt(physState.vx * physState.vx + physState.vy * physState.vy);
    if (spd > 0.5) {
      speedSum += spd;
      speedSamples++;
      state.avgSpeedMps = speedSum / speedSamples;
    }

    // Switch distance (reserved, not awarded in v1)
    if (physState.switchStance && !physState.airborne) {
      state.switchDistanceM += spd * dt;
    }

    // Pole plant tracking (event-based: Shift arms it, weight shift within
    // the timing window confirms it — see physics.js polePlantAttempted/Succeeded)
    if (physState.polePlantAttempted) {
      state.totalPolePlants++;
    }
    if (physState.polePlantSucceeded) {
      state.correctPolePlants++;
      state.trickPoints += POLE_PLANT_POINTS;
      state.lastTrickLabel = `Pole Plant! +${POLE_PLANT_POINTS}`;
      state.lastTrickTimer = 1.2;
    }

    // Trick points from tricks.js
    if (tricksState.pointsThisTick > 0) {
      state.trickPoints += tricksState.pointsThisTick;

      // Build label for HUD display
      if (tricksState.spin360Complete && tricksState.landedClean) {
        state.lastTrickLabel = '360! +360';
      } else if (tricksState.pointsThisTick >= 100) {
        state.lastTrickLabel = 'Ollie! +100';
      }
      state.lastTrickTimer = 1.8;  // show for 1.8 seconds
    }

    if (state.lastTrickTimer > 0) state.lastTrickTimer -= dt;

    // Live score calculation
    const speedScore = state.avgSpeedMps * 8;
    state.liveScore  = Math.round(state.trickPoints + speedScore);

    // High score update
    if (state.liveScore > state.highScore) {
      state.highScore = state.liveScore;
      try { localStorage.setItem(LS_KEY, String(state.highScore)); } catch (e) {}
    }
  }

  return { init, reset, update, state };
})();
