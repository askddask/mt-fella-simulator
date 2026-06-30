// Mt. Fella Simulator — render.js
// Draws the full frame: background/trail, moguls, trees, skier, HUD, overlays.
// Called once per rAF tick by main.js; no state mutation here.

window.Render = (() => {
  let ctx    = null;
  let canvas = null;

  function init(c) {
    canvas = c;
    ctx    = c.getContext('2d');
  }

  function draw(timestamp, physState, terrain, tricksState, scoringState, currentScreen) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (currentScreen === 'title') {
      drawTitle();
      return;
    }

    drawBackground(terrain, physState);
    drawMoguls(terrain, physState);
    drawTrees(terrain);
    drawSkier(physState, tricksState, terrain);
    drawHUD(physState, scoringState);

    if (physState.crashed)       drawCrashOverlay();
    else if (!physState.started) drawReadyOverlay();
  }

  // ── Title screen ──────────────────────────────────────────────────────────

  function drawTitle() {
    ctx.fillStyle = '#0d2a4a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Mountain silhouette
    ctx.fillStyle = '#1a3d6e';
    ctx.beginPath();
    ctx.moveTo(0, 330);
    ctx.lineTo(120, 165); ctx.lineTo(240, 260);
    ctx.lineTo(400,  55); ctx.lineTo(540, 195);
    ctx.lineTo(660, 125); ctx.lineTo(800, 240);
    ctx.lineTo(800, 330);
    ctx.closePath();
    ctx.fill();

    // Snow cap on tallest peak
    ctx.fillStyle = '#ddeeff';
    ctx.beginPath();
    ctx.moveTo(378, 55); ctx.lineTo(400, 35); ctx.lineTo(422, 55);
    ctx.lineTo(412, 90); ctx.lineTo(388, 90);
    ctx.closePath();
    ctx.fill();

    // Snow ground
    ctx.fillStyle = '#d8eef8';
    ctx.fillRect(0, 330, canvas.width, canvas.height - 330);

    // Title
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font      = 'bold 54px monospace';
    ctx.fillText('MT. FELLA', canvas.width / 2, 205);
    ctx.font      = '22px monospace';
    ctx.fillStyle = '#88ccee';
    ctx.fillText('S I M U L A T O R', canvas.width / 2, 248);

    // Controls panel
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(145, 362, 510, 116);
    ctx.font      = '14px monospace';
    ctx.fillStyle = '#ccddff';
    ctx.fillText('← →         weight shift / carve turns', canvas.width / 2, 388);
    ctx.fillText('SHIFT        pole plant (bonus at edge transfer)', canvas.width / 2, 410);
    ctx.fillText('SPACE        hold to charge ollie, release to pop', canvas.width / 2, 432);
    ctx.fillText('← → in air  spin 360 for bonus points', canvas.width / 2, 454);

    ctx.fillStyle = '#ffee44';
    ctx.font      = 'bold 18px monospace';
    ctx.fillText('Press ← or → to start', canvas.width / 2, 510);
  }

  // ── Background + trail ────────────────────────────────────────────────────

  function drawBackground(terrain, physState) {
    // Snow covers the whole canvas; forest panels paint over the off-trail areas.
    ctx.fillStyle = '#eef6ff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const leftEdge  = terrain.worldToScreen(-terrain.TRAIL_HALF, physState.y, canvas).x;
    const rightEdge = terrain.worldToScreen( terrain.TRAIL_HALF, physState.y, canvas).x;

    if (leftEdge > 0) {
      ctx.fillStyle = '#2a4a1e';
      ctx.fillRect(0, 0, leftEdge, canvas.height);
    }
    if (rightEdge < canvas.width) {
      ctx.fillStyle = '#2a4a1e';
      ctx.fillRect(rightEdge, 0, canvas.width - rightEdge, canvas.height);
    }

    // Trail edge lines
    ctx.strokeStyle = '#cce0f0';
    ctx.lineWidth   = 2;
    if (leftEdge > 0 && leftEdge < canvas.width) {
      ctx.beginPath(); ctx.moveTo(leftEdge, 0); ctx.lineTo(leftEdge, canvas.height); ctx.stroke();
    }
    if (rightEdge > 0 && rightEdge < canvas.width) {
      ctx.beginPath(); ctx.moveTo(rightEdge, 0); ctx.lineTo(rightEdge, canvas.height); ctx.stroke();
    }

    // Subtle centre fall-line dashes
    const cx = terrain.worldToScreen(0, physState.y, canvas).x;
    ctx.strokeStyle = 'rgba(180,210,240,0.4)';
    ctx.lineWidth   = 1;
    ctx.setLineDash([20, 20]);
    ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, canvas.height); ctx.stroke();
    ctx.setLineDash([]);
  }

  // ── Moguls ────────────────────────────────────────────────────────────────

  function drawMoguls(terrain, physState) {
    const scale = window.Physics.WORLD_SCALE;
    for (const m of terrain.moguls) {
      const sc = terrain.worldToScreen(m.x, m.y, canvas);
      const r  = m.radius * scale;
      if (sc.x < -r || sc.x > canvas.width + r || sc.y < -r || sc.y > canvas.height + r) continue;

      // Drop shadow
      ctx.fillStyle = 'rgba(80,120,180,0.2)';
      ctx.beginPath();
      ctx.ellipse(sc.x + r * 0.12, sc.y + r * 0.08, r * 0.9, r * 0.48, 0, 0, Math.PI * 2);
      ctx.fill();

      // Bump with highlight
      const grad = ctx.createRadialGradient(sc.x - r * 0.25, sc.y - r * 0.25, r * 0.05, sc.x, sc.y, r);
      grad.addColorStop(0,   '#ffffff');
      grad.addColorStop(0.6, '#d8eeff');
      grad.addColorStop(1,   '#aaccdd');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(sc.x, sc.y, r, r * 0.52, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ── Trees ─────────────────────────────────────────────────────────────────

  function drawTrees(terrain) {
    const scale = window.Physics.WORLD_SCALE;
    for (const tree of terrain.trees) {
      const sc = terrain.worldToScreen(tree.x, tree.y, canvas);
      const r  = tree.radius * scale;
      if (sc.x < -r * 3 || sc.x > canvas.width + r * 3) continue;
      if (sc.y < -r * 5 || sc.y > canvas.height + r * 2) continue;

      if (tree.type === 'pine') drawPine(sc.x, sc.y, r);
      else                      drawBare(sc.x, sc.y, r);
    }
  }

  function drawPine(x, y, r) {
    // Trunk
    ctx.fillStyle = '#4a2e10';
    ctx.fillRect(x - r * 0.13, y, r * 0.26, r * 0.55);

    // Three tiers bottom → top; alternating shades give a layered look
    for (let i = 0; i < 3; i++) {
      const tierBase = y - r * 0.72 * i;
      const tierW    = r * (1.12 - i * 0.24);
      const tierH    = r * 0.92;

      ctx.fillStyle = i % 2 === 0 ? '#1e5c28' : '#246630';
      ctx.beginPath();
      ctx.moveTo(x, tierBase - tierH);
      ctx.lineTo(x - tierW, tierBase + r * 0.04);
      ctx.lineTo(x + tierW, tierBase + r * 0.04);
      ctx.closePath();
      ctx.fill();

      // Snow on each tier peak
      ctx.fillStyle = '#ddeeff';
      ctx.beginPath();
      ctx.moveTo(x,             tierBase - tierH);
      ctx.lineTo(x - tierW * 0.38, tierBase - tierH * 0.5);
      ctx.lineTo(x + tierW * 0.38, tierBase - tierH * 0.5);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawBare(x, y, r) {
    ctx.strokeStyle = '#5c3a1e';
    ctx.lineWidth   = Math.max(1.5, r * 0.18);
    ctx.beginPath();
    ctx.moveTo(x, y); ctx.lineTo(x, y - r * 2.5);
    ctx.stroke();

    ctx.lineWidth = Math.max(1, r * 0.1);
    for (let i = 0; i < 4; i++) {
      const by = y - r * (0.7 + i * 0.5);
      const bw = r * (0.85 - i * 0.16);
      ctx.beginPath();
      ctx.moveTo(x, by); ctx.lineTo(x - bw, by + bw * 0.4);
      ctx.moveTo(x, by); ctx.lineTo(x + bw, by + bw * 0.4);
      ctx.stroke();
    }
  }

  // ── Skier ─────────────────────────────────────────────────────────────────

  function drawSkier(physState, tricksState, terrain) {
    const sc = terrain.worldToScreen(physState.x, physState.y, canvas);
    physState.screenX = sc.x;
    physState.screenY = sc.y;

    const airLift = physState.z * window.Physics.WORLD_SCALE;

    ctx.save();
    ctx.translate(sc.x, sc.y - airLift);

    if (physState.airborne) {
      ctx.rotate(tricksState.visualRotation);
    } else {
      ctx.rotate(physState.skiAngle * 0.25);
    }

    // Ground shadow (fades as skier rises)
    if (airLift < canvas.height) {
      const shadowAlpha = Math.max(0, 0.2 - airLift * 0.003);
      if (shadowAlpha > 0) {
        ctx.fillStyle = `rgba(60,100,160,${shadowAlpha})`;
        ctx.beginPath();
        ctx.ellipse(0, (5 + airLift) - airLift, 13, 4, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Skis
    ctx.fillStyle = physState.switchStance ? '#ff7733' : '#1133cc';
    ctx.fillRect(-15, 2, 30, 4);

    // Body / suit
    ctx.fillStyle = physState.crashed ? '#cc1100' : '#2255ee';
    ctx.fillRect(-5, -18, 10, 18);

    // Head
    ctx.fillStyle = '#ffc898';
    ctx.beginPath(); ctx.arc(0, -23, 5, 0, Math.PI * 2); ctx.fill();

    // Helmet
    ctx.fillStyle = '#cc0000';
    ctx.beginPath(); ctx.arc(0, -23, 5, Math.PI, 0); ctx.fill();

    // Goggles
    ctx.fillStyle = '#ffdd00';
    ctx.fillRect(-4, -25, 8, 3);

    // Poles (on ground only)
    if (!physState.airborne) {
      ctx.strokeStyle = '#999999';
      ctx.lineWidth   = 1.5;
      ctx.beginPath();
      ctx.moveTo(-5, -10); ctx.lineTo(-18,  6);
      ctx.moveTo( 5, -10); ctx.lineTo( 18,  6);
      ctx.stroke();
      ctx.fillStyle = '#777777';
      ctx.beginPath();
      ctx.arc(-18, 6, 2, 0, Math.PI * 2);
      ctx.arc( 18, 6, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  // ── HUD ───────────────────────────────────────────────────────────────────

  function drawHUD(physState, scoringState) {
    const spd    = Math.sqrt(physState.vx * physState.vx + physState.vy * physState.vy);
    const spdKph = (spd * 3.6).toFixed(1);

    ctx.save();

    // Score panel
    ctx.fillStyle = 'rgba(0,10,30,0.52)';
    ctx.fillRect(10, 10, 185, 118);

    ctx.textAlign = 'left';
    ctx.font      = '14px monospace';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`SCORE  ${scoringState.liveScore}`,          20,  33);
    ctx.fillStyle = '#ffdd44';
    ctx.fillText(`BEST   ${scoringState.highScore}`,          20,  53);
    ctx.fillStyle = '#88ddff';
    ctx.fillText(`SPEED  ${spdKph} km/h`,                    20,  73);
    ctx.fillStyle = '#88ff88';
    ctx.fillText(`POLES  ${scoringState.correctPolePlants}/${scoringState.totalPolePlants}`, 20, 93);
    ctx.fillStyle = '#aaaaaa';
    ctx.fillText(`TIME   ${scoringState.runTime.toFixed(1)}s`, 20, 113);

    // Trick label popup
    if (scoringState.lastTrickTimer > 0) {
      const fade = Math.min(1, scoringState.lastTrickTimer / 0.5);
      ctx.globalAlpha = fade;
      ctx.textAlign   = 'center';
      ctx.font        = 'bold 30px monospace';
      ctx.fillStyle   = '#ffff44';
      ctx.shadowColor = '#ff8800';
      ctx.shadowBlur  = 8;
      ctx.fillText(scoringState.lastTrickLabel, canvas.width / 2, canvas.height * 0.38);
      ctx.shadowBlur  = 0;
      ctx.globalAlpha = 1;
    }

    // Ollie charge bar
    if (physState.ollieCharge > 0.02) {
      const bw    = 120;
      const bx    = canvas.width / 2 - bw / 2;
      const by    = canvas.height - 55;
      const pct   = physState.ollieCharge;
      const color = pct > 0.8 ? '#ff4444' : pct > 0.5 ? '#ffaa00' : '#44aaff';

      ctx.textAlign = 'center';
      ctx.font      = '12px monospace';
      ctx.fillStyle = '#cccccc';
      ctx.fillText('OLLIE', canvas.width / 2, by - 5);

      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(bx - 1, by - 1, bw + 2, 12);
      ctx.fillStyle = color;
      ctx.fillRect(bx, by, bw * pct, 10);
    }

    // Switch stance badge
    if (physState.switchStance) {
      ctx.textAlign = 'center';
      ctx.font      = 'bold 15px monospace';
      ctx.fillStyle = '#ff8833';
      ctx.fillText('SWITCH', canvas.width / 2, canvas.height - 18);
    }

    ctx.restore();
  }

  // ── Overlays ──────────────────────────────────────────────────────────────

  function drawCrashOverlay() {
    ctx.fillStyle = 'rgba(160,10,10,0.38)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font      = 'bold 44px monospace';
    ctx.fillText('WIPEOUT!', canvas.width / 2, canvas.height / 2 - 10);
    ctx.font      = '18px monospace';
    ctx.fillStyle = '#ffaaaa';
    ctx.fillText('Resetting to top…', canvas.width / 2, canvas.height / 2 + 36);
  }

  function drawReadyOverlay() {
    ctx.fillStyle = 'rgba(0,15,50,0.55)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font      = 'bold 32px monospace';
    ctx.fillText('READY', canvas.width / 2, canvas.height / 2 - 20);
    ctx.font      = '17px monospace';
    ctx.fillStyle = '#aaddff';
    ctx.fillText('Press ← or → to start skiing', canvas.width / 2, canvas.height / 2 + 22);
  }

  return { init, draw };
})();
