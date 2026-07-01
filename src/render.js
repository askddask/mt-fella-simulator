// Mt. Fella Simulator — render.js
// Three.js 3D scene (terrain mesh, trees, skier) + a 2D HUD overlay canvas for
// text/score/title/overlays. Called once per rAF tick by main.js; no gameplay
// state mutation here beyond the visual mesh/camera transforms.

window.Render = (() => {
  let hudCanvas = null;
  let hudCtx    = null;
  let glCanvas  = null;

  let renderer, scene, camera;
  let skierGroup, tiltRig, skierParts;
  let terrainRef = null;

  // Smoothed camera follow target (world space: x, absolute elevation, y)
  const camSmooth = { x: 0, y: 0, z: 0, ready: false };
  const CAM_SMOOTH_FACTOR = 0.14;
  const CAM_HEIGHT     = 3.4;   // meters above the skier
  const CAM_BACK       = 6.5;   // meters behind (upslope of) the skier
  const CAM_LOOKAHEAD  = 22;    // meters ahead (downslope) the camera looks
  const CAM_LOOK_DROP  = 2.5;   // meters below skier height the look target aims

  // Smoothed edge tilt for the skier rig (avoids a hard snap between -1/0/1)
  let visualEdgeTilt = 0;

  // Pole "dig in" dip animation — must match physics.js POLE_PLANT_VISUAL_DURATION
  const POLE_PLANT_VISUAL_DURATION = 0.3;
  const POLE_BASE_ROT_X = 0.5;
  const POLE_BASE_Y     = 0.55;
  const POLE_DIP_ROT_X  = 0.7;
  const POLE_DIP_Y      = 0.32;

  // World-space (x, y-downhill, elevation) -> Three.js (X, Y-up, Z)
  function worldToThree(x, y, elevation, out) {
    out.set(x, elevation, -y);
    return out;
  }

  function resetCamera() {
    camSmooth.ready = false;
  }

  function init(canvas, hud, terrain) {
    glCanvas  = canvas;
    hudCanvas = hud;
    hudCtx    = hud.getContext('2d');
    terrainRef = terrain;

    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(canvas.width, canvas.height, false);

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xbfe3ff);
    scene.fog = new THREE.Fog(0xbfe3ff, 50, 260);

    camera = new THREE.PerspectiveCamera(62, canvas.width / canvas.height, 0.1, 1000);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x667788, 1.3);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff4e0, 0.35);
    sun.position.set(-40, 80, -40);
    scene.add(sun);

    buildTerrainMesh(terrain);
    buildTrees(terrain);
    buildSkier();
  }

  // ── Terrain mesh ──────────────────────────────────────────────────────────

  function buildAxisSamples(min, max, coarseStep, denseRanges, denseStep) {
    const set = new Set();
    const round = v => Math.round(v * 100) / 100;
    for (let v = min; v <= max + 1e-6; v += coarseStep) set.add(round(v));
    for (const [a, b] of denseRanges) {
      for (let v = a; v <= b + 1e-6; v += denseStep) set.add(round(v));
    }
    set.add(round(min));
    set.add(round(max));
    return Array.from(set).sort((p, q) => p - q);
  }

  function buildTerrainMesh(terrain) {
    const halfW  = terrain.TRAIL_HALF + terrain.FOREST_WIDTH;
    const xs = buildAxisSamples(-halfW, halfW, 3, [[-terrain.TRAIL_HALF - 2, terrain.TRAIL_HALF + 2]], 1.1);
    const ys = buildAxisSamples(-10, terrain.TRAIL_LENGTH + 20, 5,
      terrain.MOGUL_FIELDS.map(f => [f.yStart - 6, f.yEnd + 6]), 0.8);

    const cols = xs.length;
    const rows = ys.length;

    const positions = new Float32Array(cols * rows * 3);
    const colors    = new Float32Array(cols * rows * 3);

    const snow  = new THREE.Color(0xeaf4ff);
    const forest = new THREE.Color(0x35502a);
    const edgeLine = new THREE.Color(0xb9d6ea);

    let idx = 0;
    for (let j = 0; j < rows; j++) {
      const y = ys[j];
      for (let i = 0; i < cols; i++) {
        const x = xs[i];
        const elev = terrain.getElevation(x, y);
        positions[idx * 3 + 0] = x;
        positions[idx * 3 + 1] = elev;
        positions[idx * 3 + 2] = -y;

        let c;
        const distFromEdge = Math.abs(Math.abs(x) - terrain.TRAIL_HALF);
        if (Math.abs(x) <= terrain.TRAIL_HALF) {
          c = distFromEdge < 1.2 ? edgeLine : snow;
        } else {
          c = forest;
        }
        colors[idx * 3 + 0] = c.r;
        colors[idx * 3 + 1] = c.g;
        colors[idx * 3 + 2] = c.b;
        idx++;
      }
    }

    const indices = [];
    for (let j = 0; j < rows - 1; j++) {
      for (let i = 0; i < cols - 1; i++) {
        const a = j * cols + i;
        const b = a + 1;
        const c = a + cols;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0.0 });
    const mesh = new THREE.Mesh(geo, mat);
    scene.add(mesh);
  }

  // ── Trees ─────────────────────────────────────────────────────────────────

  function buildTrees(terrain) {
    const pineFoliageMat = new THREE.MeshStandardMaterial({ color: 0x1e5c28, roughness: 1 });
    const bareMat        = new THREE.MeshStandardMaterial({ color: 0x5c3a1e, roughness: 1 });
    const trunkMat       = new THREE.MeshStandardMaterial({ color: 0x4a2e10, roughness: 1 });
    const coneGeo   = new THREE.ConeGeometry(1, 1, 8);
    const trunkGeo  = new THREE.CylinderGeometry(0.12, 0.15, 1, 6);
    const bareGeo   = new THREE.CylinderGeometry(0.06, 0.1, 1, 6);

    for (const tree of terrain.trees) {
      const elev = terrain.getElevation(tree.x, tree.y);
      const group = new THREE.Group();
      group.position.set(tree.x, elev, -tree.y);

      if (tree.type === 'pine') {
        const trunk = new THREE.Mesh(trunkGeo, trunkMat);
        trunk.scale.set(1, tree.radius * 0.6, 1);
        trunk.position.y = tree.radius * 0.3;
        group.add(trunk);

        for (let i = 0; i < 3; i++) {
          const h = tree.radius * (1.3 - i * 0.28);
          const w = tree.radius * (0.95 - i * 0.2);
          const tier = new THREE.Mesh(coneGeo, pineFoliageMat);
          tier.scale.set(w, h, w);
          tier.position.y = tree.radius * 0.6 + i * tree.radius * 0.55 + h * 0.5;
          group.add(tier);
        }
      } else {
        const trunk = new THREE.Mesh(bareGeo, bareMat);
        trunk.scale.set(1, tree.radius * 2.2, 1);
        trunk.position.y = tree.radius * 1.1;
        group.add(trunk);
      }

      scene.add(group);
    }
  }

  // ── Skier ─────────────────────────────────────────────────────────────────

  function buildSkier() {
    skierGroup = new THREE.Group();
    tiltRig = new THREE.Group();
    skierGroup.add(tiltRig);

    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2255ee });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.85, 0.32), bodyMat);
    body.position.y = 0.85;
    tiltRig.add(body);

    const headMat = new THREE.MeshStandardMaterial({ color: 0xffc898 });
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 12), headMat);
    head.position.y = 1.45;
    tiltRig.add(head);

    const helmetMat = new THREE.MeshStandardMaterial({ color: 0xcc0000 });
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.21, 12, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), helmetMat);
    helmet.position.y = 1.47;
    tiltRig.add(helmet);

    const skiMat = new THREE.MeshStandardMaterial({ color: 0x1133cc });
    const skiGeo = new THREE.BoxGeometry(0.12, 0.05, 1.7);
    const skiLeft = new THREE.Mesh(skiGeo, skiMat.clone());
    skiLeft.position.set(-0.16, 0.05, 0.15);
    tiltRig.add(skiLeft);
    const skiRight = new THREE.Mesh(skiGeo, skiMat.clone());
    skiRight.position.set(0.16, 0.05, 0.15);
    tiltRig.add(skiRight);

    const poleMat = new THREE.MeshStandardMaterial({ color: 0x999999 });
    const poleGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.9, 6);
    const poleLeft = new THREE.Mesh(poleGeo, poleMat);
    poleLeft.position.set(-0.35, 0.55, 0.05);
    poleLeft.rotation.x = 0.5;
    tiltRig.add(poleLeft);
    const poleRight = new THREE.Mesh(poleGeo, poleMat.clone());
    poleRight.position.set(0.35, 0.55, 0.05);
    poleRight.rotation.x = 0.5;
    tiltRig.add(poleRight);

    skierParts = { body, skiLeft, skiRight, poleLeft, poleRight };
    scene.add(skierGroup);
  }

  function updateSkier(physState, tricksState) {
    const elevation = terrainRef.baseElevation(physState.y) + physState.z;
    skierGroup.position.set(physState.x, elevation, -physState.y);

    const heading = physState.airborne ? tricksState.visualRotation : physState.skiAngle;
    skierGroup.rotation.y = -heading;

    const targetTilt = -physState.edgeLoaded * 0.4;
    visualEdgeTilt += (targetTilt - visualEdgeTilt) * 0.25;
    tiltRig.rotation.z = visualEdgeTilt;
    tiltRig.rotation.x = physState.airborne ? 0 : -0.12;

    skierParts.body.material.color.set(physState.crashed ? 0xcc1100 : 0x2255ee);
    const skiColor = physState.switchStance ? 0xff7733 : 0x1133cc;
    skierParts.skiLeft.material.color.set(skiColor);
    skierParts.skiRight.material.color.set(skiColor);

    const polesVisible = !physState.airborne;
    skierParts.poleLeft.visible  = polesVisible;
    skierParts.poleRight.visible = polesVisible;

    // Pole plant "dig in": the downhill/leading pole jerks down toward the snow
    // briefly, showing which pole is being planted.
    const dipT = physState.polePlantVisualTimer;
    const dipAmt = dipT > 0 ? Math.sin(Math.PI * (1 - dipT / POLE_PLANT_VISUAL_DURATION)) : 0;
    const leftDip  = physState.polePlantVisualSide === -1 ? dipAmt : 0;
    const rightDip = physState.polePlantVisualSide ===  1 ? dipAmt : 0;

    skierParts.poleLeft.rotation.x  = POLE_BASE_ROT_X + leftDip  * POLE_DIP_ROT_X;
    skierParts.poleLeft.position.y  = POLE_BASE_Y     - leftDip  * POLE_DIP_Y;
    skierParts.poleRight.rotation.x = POLE_BASE_ROT_X + rightDip * POLE_DIP_ROT_X;
    skierParts.poleRight.position.y = POLE_BASE_Y     - rightDip * POLE_DIP_Y;
  }

  // ── Camera ────────────────────────────────────────────────────────────────

  function updateCamera(physState) {
    const elevation = terrainRef.baseElevation(physState.y) + physState.z;
    const targetX = physState.x;
    const targetY = elevation;
    const targetZ = -physState.y;

    if (!camSmooth.ready) {
      camSmooth.x = targetX; camSmooth.y = targetY; camSmooth.z = targetZ;
      camSmooth.ready = true;
    } else {
      camSmooth.x += (targetX - camSmooth.x) * CAM_SMOOTH_FACTOR;
      camSmooth.y += (targetY - camSmooth.y) * CAM_SMOOTH_FACTOR;
      camSmooth.z += (targetZ - camSmooth.z) * CAM_SMOOTH_FACTOR;
    }

    camera.position.set(camSmooth.x, camSmooth.y + CAM_HEIGHT, camSmooth.z + CAM_BACK);
    camera.lookAt(camSmooth.x, camSmooth.y - CAM_LOOK_DROP, camSmooth.z - CAM_LOOKAHEAD);
  }

  // ── Frame ─────────────────────────────────────────────────────────────────

  function draw(timestamp, physState, terrain, tricksState, scoringState, currentScreen) {
    hudCtx.clearRect(0, 0, hudCanvas.width, hudCanvas.height);

    if (currentScreen === 'title') {
      glCanvas.style.visibility = 'hidden';
      drawTitle();
      return;
    }
    glCanvas.style.visibility = 'visible';

    updateSkier(physState, tricksState);
    updateCamera(physState);
    renderer.render(scene, camera);

    drawHUD(physState, scoringState);

    if (physState.crashed)       drawCrashOverlay();
    else if (!physState.started) drawReadyOverlay();
  }

  // ── Title screen (2D HUD canvas) ────────────────────────────────────────

  function drawTitle() {
    const ctx = hudCtx;
    const canvas = hudCanvas;
    ctx.fillStyle = '#0d2a4a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#1a3d6e';
    ctx.beginPath();
    ctx.moveTo(0, 330);
    ctx.lineTo(120, 165); ctx.lineTo(240, 260);
    ctx.lineTo(400,  55); ctx.lineTo(540, 195);
    ctx.lineTo(660, 125); ctx.lineTo(800, 240);
    ctx.lineTo(800, 330);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#ddeeff';
    ctx.beginPath();
    ctx.moveTo(378, 55); ctx.lineTo(400, 35); ctx.lineTo(422, 55);
    ctx.lineTo(412, 90); ctx.lineTo(388, 90);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#d8eef8';
    ctx.fillRect(0, 330, canvas.width, canvas.height - 330);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font      = 'bold 54px monospace';
    ctx.fillText('MT. FELLA', canvas.width / 2, 205);
    ctx.font      = '22px monospace';
    ctx.fillStyle = '#88ccee';
    ctx.fillText('S I M U L A T O R', canvas.width / 2, 248);

    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(145, 362, 510, 116);
    ctx.font      = '14px monospace';
    ctx.fillStyle = '#ccddff';
    ctx.fillText('← →         weight shift / carve turns', canvas.width / 2, 388);
    ctx.fillText('SHIFT        pole plant, then ← → within 0.2s = boost', canvas.width / 2, 410);
    ctx.fillText('SPACE        hold to charge ollie, release to pop', canvas.width / 2, 432);
    ctx.fillText('← → in air  spin 360 for bonus points', canvas.width / 2, 454);

    ctx.fillStyle = '#ffee44';
    ctx.font      = 'bold 18px monospace';
    ctx.fillText('Press ← or → to start', canvas.width / 2, 510);
  }

  // ── HUD ───────────────────────────────────────────────────────────────────

  function drawHUD(physState, scoringState) {
    const ctx = hudCtx;
    const canvas = hudCanvas;
    const spd    = Math.sqrt(physState.vx * physState.vx + physState.vy * physState.vy);
    const spdKph = (spd * 3.6).toFixed(1);

    ctx.save();

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
    const ctx = hudCtx;
    const canvas = hudCanvas;
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
    const ctx = hudCtx;
    const canvas = hudCanvas;
    ctx.fillStyle = 'rgba(0,15,50,0.3)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font      = 'bold 32px monospace';
    ctx.fillText('READY', canvas.width / 2, canvas.height / 2 - 20);
    ctx.font      = '17px monospace';
    ctx.fillStyle = '#aaddff';
    ctx.fillText('Press ← or → to start skiing', canvas.width / 2, canvas.height / 2 + 22);
  }

  return { init, draw, resetCamera };
})();
