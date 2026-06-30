// Mt. Fella Simulator — terrain.js
// Tutorial trail definition, tree placement, mogul layout, collision detection.

window.Terrain = (() => {

  // ─── Trail geometry ──────────────────────────────────────────────────────
  // Trail runs straight down (world +Y). Width in meters.
  // Trail is long enough that a clean run at ~8 m/s takes >40 seconds → 350m minimum.
  const TRAIL_LENGTH     = 420;   // meters
  const TRAIL_WIDTH      = 60;    // meters (plenty of room to experiment — 10s of drift to trees at full speed)
  const TRAIL_HALF       = TRAIL_WIDTH / 2;

  // The trail centerline is always at x = 0 for this straight tutorial trail.

  // ─── Trees ───────────────────────────────────────────────────────────────
  // Trees placed along both edges with some random scatter.
  // Seeded procedurally so they're consistent across resets.
  const trees = [];

  function buildTrees() {
    trees.length = 0;
    // Simple deterministic pseudo-random using LCG so no Math.random()
    let seed = 12345;
    const rand = () => { seed = (seed * 1664525 + 1013904223) & 0xffffffff; return (seed >>> 0) / 0xffffffff; };

    const spacing = 8;  // meters between tree clusters
    for (let y = 20; y < TRAIL_LENGTH; y += spacing) {
      // Left edge trees (negative x, beyond -TRAIL_HALF)
      for (let i = 0; i < 2; i++) {
        trees.push({
          x: -(TRAIL_HALF + 2 + rand() * 18),
          y: y + rand() * spacing * 0.8,
          radius: 1.5 + rand() * 1.5,
          type: rand() > 0.3 ? 'pine' : 'bare',
        });
      }
      // Right edge trees
      for (let i = 0; i < 2; i++) {
        trees.push({
          x: TRAIL_HALF + 2 + rand() * 18,
          y: y + rand() * spacing * 0.8,
          radius: 1.5 + rand() * 1.5,
          type: rand() > 0.3 ? 'pine' : 'bare',
        });
      }
    }
  }

  // ─── Moguls ──────────────────────────────────────────────────────────────
  // Mogul: { x, y, radius, height }
  // height = peak elevation above flat terrain (meters)
  // Isolated moguls and one cluster requiring pole plant weaving
  const moguls = [
    // Isolated moguls (for ollie practice)
    { x:  5, y:  80, radius: 4.5, height: 1.2 },
    { x: -8, y: 130, radius: 4.0, height: 1.0 },
    { x:  3, y: 190, radius: 5.0, height: 1.4 },

    // Mogul cluster — requires pole-plant weaving (y: 250-310)
    { x: -6, y: 250, radius: 3.5, height: 1.1 },
    { x:  6, y: 265, radius: 3.5, height: 1.1 },
    { x: -5, y: 280, radius: 3.5, height: 1.1 },
    { x:  7, y: 295, radius: 3.5, height: 1.1 },
    { x: -4, y: 310, radius: 3.5, height: 1.1 },

    // Isolated mogul near bottom for last trick attempt
    { x:  0, y: 360, radius: 5.5, height: 1.5 },
  ];

  // ─── Camera state ────────────────────────────────────────────────────────
  const camera = {
    x: 0,    // world X the camera is centered on
    y: 0,    // world Y the camera is centered on
    smoothX: 0,
    smoothY: 0,
  };
  const CAM_LEAD     = 12;    // meters ahead of skier the camera looks
  const CAM_SMOOTH   = 0.12;  // lerp factor per physics tick (higher = snappier)

  // ─── Public state ─────────────────────────────────────────────────────────
  // terrainZ at skier position, set each tick in updateForSkier
  let currentTerrainZ = 0;

  function init() {
    buildTrees();
  }

  function reset() {
    camera.x       = 0;
    camera.y       = 0;
    camera.smoothX = 0;
    camera.smoothY = 0;
    currentTerrainZ = 0;
  }

  // Returns mogul elevation at world position (x, y) — smooth hill shape
  function getTerrainZ(x, y) {
    let z = 0;
    for (const m of moguls) {
      const dx = x - m.x;
      const dy = y - m.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < m.radius) {
        // Smooth cosine hill
        const t = dist / m.radius;
        z = Math.max(z, m.height * 0.5 * (1 + Math.cos(Math.PI * t)));
      }
    }
    return z;
  }

  // Returns true if position (x, y) is outside trail boundaries (in tree zone)
  function isInTree(x, y) {
    if (y < 0 || y > TRAIL_LENGTH) return false;
    return Math.abs(x) > TRAIL_HALF;
  }

  // Returns mogul face normal Y component at (x, y) — negative means uphill face
  // Used for crash-on-uphill-face detection when landing
  function getMogulFaceNormalY(x, y) {
    // Find the mogul the skier is currently on
    for (const m of moguls) {
      const dx = x - m.x;
      const dy = y - m.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < m.radius && dist > 0.1) {
        // dy < 0 means skier is on the uphill (north) face of the mogul
        // Uphill face normal points "backward up the slope" → negative dy side
        return dy / dist;  // negative = uphill face, positive = downhill face
      }
    }
    return 1; // flat terrain, no crash
  }

  // Returns true if the skier is landing on a mogul's uphill face
  function isLandingOnUphillFace(x, y) {
    const normalY = getMogulFaceNormalY(x, y);
    return normalY < -0.3;  // threshold: uphill face if normal points significantly uphill
  }

  // Called each physics tick to update camera and feed terrainZ to physics state
  function updateCamera(physState) {
    // Camera target: slightly ahead of skier in direction of travel
    const targetX = physState.x;
    const targetY = physState.y + CAM_LEAD;

    camera.smoothX += (targetX - camera.smoothX) * CAM_SMOOTH;
    camera.smoothY += (targetY - camera.smoothY) * CAM_SMOOTH;
    camera.x = camera.smoothX;
    camera.y = camera.smoothY;

    // Update terrain Z for physics
    currentTerrainZ = getTerrainZ(physState.x, physState.y);
    physState.terrainZ = currentTerrainZ;

    // Tree collision check
    if (isInTree(physState.x, physState.y) && physState.started && !physState.crashed) {
      window.Physics.crash();
    }

    // End-of-trail check — reset when skier reaches bottom
    if (physState.y > TRAIL_LENGTH && physState.started && !physState.crashed) {
      // Treat like a crash (just resets to top) — could show "nice run!" later
      window.Physics.crash();
    }
  }

  // World → screen transform (called by render.js)
  function worldToScreen(wx, wy, canvas) {
    const scale = window.Physics.WORLD_SCALE;
    const cx = canvas.width  / 2;
    const cy = canvas.height * 0.45;   // skier appears ~45% down screen
    return {
      x: cx + (wx - camera.x) * scale,
      y: cy + (wy - camera.y) * scale,
    };
  }

  return {
    init, reset, updateCamera,
    getTerrainZ, isInTree, isLandingOnUphillFace,
    worldToScreen,
    trees, moguls,
    TRAIL_WIDTH, TRAIL_HALF, TRAIL_LENGTH,
    camera,
  };
})();
