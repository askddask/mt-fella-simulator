// Mt. Fella Simulator — terrain.js
// Trail geometry, rolling grade variance, mogul fields, tree placement, collision detection.
// Pure world-space math — no rendering here. render.js consumes these functions to build the 3D scene.

window.Terrain = (() => {

  // ─── Trail geometry ──────────────────────────────────────────────────────
  const TRAIL_LENGTH  = 420;   // meters
  const TRAIL_WIDTH   = 60;    // meters
  const TRAIL_HALF    = TRAIL_WIDTH / 2;
  const FOREST_WIDTH   = 40;   // meters of forest rendered beyond each trail edge

  // ─── Base descending grade ───────────────────────────────────────────────
  // Average pitch of the whole run. Local grade varies around this via undulation().
  const BASE_SLOPE_ANGLE = 0.18;              // ~10°
  const BASE_GRADE       = Math.tan(BASE_SLOPE_ANGLE);

  // Absolute world elevation contributed by the steady downhill descent (y grows downhill).
  function baseElevation(y) { return -y * BASE_GRADE; }

  // ─── Rolling, organic undulation ─────────────────────────────────────────
  // Layered low-frequency waves — gentle rolling terrain, NOT a flat slope.
  // Steeper patches (where this pushes elevation down faster) accelerate the skier;
  // flatter/cresting patches (elevation rising relative to base) let them slow.
  function undulation(x, y) {
    return (
      Math.sin(y * 0.045 + x * 0.010 + 0.6) * 1.4 +
      Math.sin(y * 0.017 - x * 0.023 + 2.4) * 2.2 +
      Math.sin(x * 0.050 + y * 0.008 + 4.1) * 0.8
    );
  }

  function undulationGradY(x, y) {
    const e = 0.5;
    return (undulation(x, y + e) - undulation(x, y - e)) / (2 * e);
  }

  // Local downhill "grade" (~sin(theta) for these gentle angles) at (x, y).
  // Steeper terrain -> larger value -> more acceleration. Clamped well above the
  // base kinetic friction coefficient (0.08) so the skier never stalls dead.
  function getLocalGrade(x, y) {
    const grade = BASE_GRADE - undulationGradY(x, y);
    return Math.max(0.12, Math.min(0.5, grade));
  }

  // ─── Trees ───────────────────────────────────────────────────────────────
  const trees = [];

  function buildTrees() {
    trees.length = 0;
    let seed = 12345;
    const rand = () => { seed = (seed * 1664525 + 1013904223) & 0xffffffff; return (seed >>> 0) / 0xffffffff; };

    const spacing = 8;
    for (let y = 20; y < TRAIL_LENGTH; y += spacing) {
      for (let i = 0; i < 2; i++) {
        trees.push({
          x: -(TRAIL_HALF + 2 + rand() * 18),
          y: y + rand() * spacing * 0.8,
          radius: 1.5 + rand() * 1.5,
          type: rand() > 0.3 ? 'pine' : 'bare',
        });
      }
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

  // ─── Mogul fields ─────────────────────────────────────────────────────────
  // Tiny bumps packed into clustered fields with just enough gap to weave through
  // via pole-plant weight transfers. Each bump's uphill (near) face reads as a
  // launch ramp; landing back on that face = crash (see isLandingOnUphillFace).
  const MOGUL_FIELDS = [
    { yStart:  70, yEnd: 150 },
    { yStart: 190, yEnd: 270 },
    { yStart: 310, yEnd: 390 },
  ];

  // Grouped by field for fast rejection when querying terrain height.
  let mogulsByField = [];
  const moguls = []; // flat list, kept for render.js / debugging

  function buildMoguls() {
    moguls.length = 0;
    mogulsByField = [];
    let seed = 99991;
    const rand = () => { seed = (seed * 1664525 + 1013904223) & 0xffffffff; return (seed >>> 0) / 0xffffffff; };

    for (const field of MOGUL_FIELDS) {
      const bumps = [];
      for (let y = field.yStart; y < field.yEnd; y += 3.2) {
        for (let x = -TRAIL_HALF + 4; x <= TRAIL_HALF - 4; x += 3.6) {
          const bump = {
            x: x + (rand() - 0.5) * 1.4,
            y: y + (rand() - 0.5) * 1.4,
            radius: 1.3 + rand() * 0.5,   // ~1.3-1.8m — tiny, not the old 3.5-5.5m
            height: 0.35 + rand() * 0.25, // ~0.35-0.6m
          };
          bumps.push(bump);
          moguls.push(bump);
        }
      }
      mogulsByField.push({ yStart: field.yStart, yEnd: field.yEnd, bumps });
    }
  }

  function mogulHeight(x, y) {
    let z = 0;
    for (const field of mogulsByField) {
      if (y < field.yStart - 2.5 || y > field.yEnd + 2.5) continue;
      for (const m of field.bumps) {
        const dx = x - m.x, dy = y - m.y;
        const dist2 = dx * dx + dy * dy;
        const r2 = m.radius * m.radius;
        if (dist2 < r2) {
          const dist = Math.sqrt(dist2);
          const t = dist / m.radius;
          const h = m.height * 0.5 * (1 + Math.cos(Math.PI * t));
          if (h > z) z = h;
        }
      }
    }
    return z;
  }

  // Ground offset above the smooth base slope (undulation + mogul bumps).
  // This is what physics.js uses for the skier's resting height / air collision.
  function getTerrainZ(x, y) {
    return undulation(x, y) + mogulHeight(x, y);
  }

  // Absolute world elevation — used for rendering the terrain mesh, trees, etc.
  function getElevation(x, y) {
    return baseElevation(y) + getTerrainZ(x, y);
  }

  // Returns true if position (x, y) is outside trail boundaries (in tree zone)
  function isInTree(x, y) {
    if (y < 0 || y > TRAIL_LENGTH) return false;
    return Math.abs(x) > TRAIL_HALF;
  }

  // Returns the nearest mogul's face normal Y component at (x, y).
  // Negative = uphill (near/approach) face, positive = downhill (far/exit) face.
  function getMogulFaceNormalY(x, y) {
    for (const field of mogulsByField) {
      if (y < field.yStart - 3 || y > field.yEnd + 3) continue;
      for (const m of field.bumps) {
        const dx = x - m.x, dy = y - m.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < m.radius && dist > 0.1) {
          return dy / dist;
        }
      }
    }
    return 1; // flat terrain, no crash
  }

  // Returns true if the skier is landing on a mogul's uphill face (= crash).
  function isLandingOnUphillFace(x, y) {
    const normalY = getMogulFaceNormalY(x, y);
    return normalY < -0.3;
  }

  function init() {
    buildTrees();
    buildMoguls();
  }

  function reset() {
    // Trail geometry is static across runs — nothing to reset here.
  }

  // Called each physics tick: feeds terrainZ to physics state and checks
  // tree / end-of-trail collisions. (Camera is owned entirely by render.js.)
  function updateForSkier(physState) {
    physState.terrainZ = getTerrainZ(physState.x, physState.y);

    if (isInTree(physState.x, physState.y) && physState.started && !physState.crashed) {
      window.Physics.crash();
    }

    if (physState.y > TRAIL_LENGTH && physState.started && !physState.crashed) {
      window.Physics.crash();
    }
  }

  return {
    init, reset, updateForSkier,
    getTerrainZ, getElevation, baseElevation, getLocalGrade,
    isInTree, isLandingOnUphillFace,
    trees, moguls, MOGUL_FIELDS,
    TRAIL_WIDTH, TRAIL_HALF, TRAIL_LENGTH, FOREST_WIDTH,
  };
})();
