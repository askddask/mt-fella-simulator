// Mt. Fella Simulator — scoring.js
// Live score: speed average + pole-plant quality + trick points.
// High score persists via localStorage.

window.Scoring = (() => {

  // Score formula (documented here, not scattered):
  //   liveScore = trickPoints + speedScore + poleScore
  //   speedScore  = avgSpeedMps * 8          (at 10 m/s avg → 80 pts; grows with speed)
  //   poleScore   = correctPolePlants * 25   (25 pts per clean pole plant)
  //   trickPoints = accumulated ollie (100) + 360 (360) points
  // High score = max liveScore across runs (localStorage key: 'mtfella_hiscore')

  const LS_KEY = 'mtfella_hiscore';

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

    // Pole plant tracking
    if (inputState.polePlant && physState.lastPolePlantTime === 0) {
      state.totalPolePlants++;
      if (physState.lastPolePlantCorrect) {
        state.correctPolePlants++;
      }
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
    const poleScore  = state.correctPolePlants * 25;
    state.liveScore  = Math.round(state.trickPoints + speedScore + poleScore);

    // High score update
    if (state.liveScore > state.highScore) {
      state.highScore = state.liveScore;
      try { localStorage.setItem(LS_KEY, String(state.highScore)); } catch (e) {}
    }
  }

  return { init, reset, update, state };
})();
