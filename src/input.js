// Mt. Fella Simulator — input.js
// Translates raw keyboard state into abstract inputs consumed by physics/tricks.
// Physics never reads keydown events directly.

window.Input = (() => {
  const keys = {};

  // Abstract input state published each tick
  const state = {
    weightLeft:    false,   // Left Arrow held
    weightRight:   false,   // Right Arrow held
    polePlant:     false,   // Shift held
    ollieCharging: false,   // Space held
    ollieRelease:  false,   // Space just released (single-tick true)
    spinLeft:      false,   // Left Arrow while airborne (handled in tricks.js)
    spinRight:     false,   // Right Arrow while airborne
    anyInput:      false,   // any directional input ever given (used for "wait for first input" at start)
  };

  let spaceWasDown = false;

  function init() {
    window.addEventListener('keydown', e => {
      keys[e.code] = true;
      // Prevent arrow keys / space from scrolling the page
      if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Space'].includes(e.code)) {
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', e => { keys[e.code] = false; });
  }

  function update() {
    const spaceDown = !!keys['Space'];

    state.weightLeft    = !!keys['ArrowLeft'];
    state.weightRight   = !!keys['ArrowRight'];
    state.polePlant     = !!keys['ShiftLeft'] || !!keys['ShiftRight'];
    state.ollieCharging = spaceDown;
    state.ollieRelease  = spaceWasDown && !spaceDown;   // single-tick pulse
    state.spinLeft      = !!keys['ArrowLeft'];
    state.spinRight     = !!keys['ArrowRight'];

    if (state.weightLeft || state.weightRight) state.anyInput = true;

    spaceWasDown = spaceDown;
  }

  function reset() {
    state.anyInput = false;
    spaceWasDown   = false;
  }

  return { init, update, reset, state };
})();
