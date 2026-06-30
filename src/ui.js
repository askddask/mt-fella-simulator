// Mt. Fella Simulator — ui.js
// Owns the title → playing screen transition.
// After the first run, crashes auto-reset via physics.js; no re-entry through UI.

window.UI = (() => {
  let _currentScreen = 'title';
  let _onStartGame   = null;

  function init() {
    window.addEventListener('keydown', (e) => {
      if (_currentScreen === 'title' && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
        _currentScreen = 'playing';
        if (_onStartGame) _onStartGame();
      }
    });
  }

  return {
    init,
    get currentScreen() { return _currentScreen; },
    get onStartGame()   { return _onStartGame;    },
    set onStartGame(fn) { _onStartGame = fn;      },
  };
})();
