'use strict';
// 시드 기반 맵 생성: 지상(건물·나무·바위·덤불·상자·드럼통·전리품)과 비밀 지하 벙커.
// 같은 시드면 모든 접속자가 똑같은 맵을 만든다.
// 지하 벙커는 지상 지도(0~size) 오른쪽으로 gap만큼 떨어진 곳에 있어 지상 화면에는 보이지 않는다.
(function (root) {
  const ZR = (root.ZR = root.ZR || {});
  const U = ZR.U;

  const WALL = 18;
  const DOOR = 86;
  const CELL = 160;
  const BASE_SIZE = 3000;
  const BASE_COUNTS = Object.freeze({ buildings: 11, trees: 120, rocks: 70, bushes: 70, crates: 50, barrels: 30, loot: 150 });

  const KINDS = Object.freeze({
    tree: { solid: true, blocks: true, hp: 180 },
    rock: { solid: true, blocks: true, hp: 260 },
    bush: { solid: false, blocks: false, hp: 60 },
    crate: { solid: true, blocks: true, hp: 90 },
    barrel: { solid: true, blocks: true, hp: 40 },
    wall: { solid: true, blocks: true, hp: Infinity },
    pillar: { solid: true, blocks: true, hp: Infinity },
    airdrop: { solid: true, blocks: true, hp: 150 },
  });

  function makeObstacle(kind, shape, props) {
    const k = KINDS[kind];
    return { kind, shape, solid: k.solid, blocks: k.blocks, hp: k.hp, maxHp: k.hp, dead: false, ...props };
  }

  // 맵 크기에 맞춰 개수를 면적 비례로 늘린다
  function countsFor(size) {
    const k = (size / BASE_SIZE) ** 2;
    const out = {};
    for (const [key, n] of Object.entries(BASE_COUNTS)) out[key] = Math.round(n * k);
    return out;
  }

  function underRect(size) {
    const G = ZR.CONFIG.underground;
    return { x: size + G.gap, y: 200, w: G.w, h: G.h };
  }

  function generate(seed, size = ZR.CONFIG.worldSize) {
    const rng = U.rng(seed);
    const under = underRect(size);
    const grid = new U.Grid(Math.max(under.x + under.w, under.y + under.h) + 200, CELL);
    const obstacles = [];
    const buildings = [];
    let nextId = 0;
    const add = (o) => {
      const withId = { ...o, id: `o${nextId++}` };
      obstacles.push(withId);
      grid.insert(withId);
      return withId;
    };

    const insideBuilding = (x, y, pad) => buildings.some((b) =>
      x > b.x - pad && x < b.x + b.w + pad && y > b.y - pad && y < b.y + b.h + pad);

    const isFree = (x, y, r, pad = 14) => {
      if (insideBuilding(x, y, r + 40)) return false;
      const reach = r + pad + 60;
      return !grid.query(x - reach, y - reach, x + reach, y + reach).some((o) => (o.shape === 'circle'
        ? U.dist2(x, y, o.x, o.y) < (o.r + r + pad) ** 2
        : U.pushCircleRect(x, y, r + pad, o.x, o.y, o.w, o.h)));
    };

    const counts = countsFor(size);
    placeBuildings(rng, size, counts.buildings, buildings, add);

    const scatterKind = (count, make) => {
      let placed = 0;
      for (let tries = 0; placed < count && tries < count * 25; tries++) {
        const o = make();
        if (isFree(o.cx, o.cy, o.rad)) {
          add(o.obs);
          placed++;
        }
      }
    };
    const randPos = (m) => [rng.range(m, size - m), rng.range(m, size - m)];

    scatterKind(counts.trees, () => {
      const [x, y] = randPos(60);
      const canopy = rng.range(40, 58);
      return { cx: x, cy: y, rad: canopy * 0.5, obs: makeObstacle('tree', 'circle', { x, y, r: canopy * 0.42, canopy }) };
    });
    scatterKind(counts.rocks, () => {
      const [x, y] = randPos(60);
      const r = rng.range(30, 52);
      return { cx: x, cy: y, rad: r, obs: makeObstacle('rock', 'circle', { x, y, r, tint: rng.range(-12, 12) }) };
    });
    scatterKind(counts.crates, () => {
      const [x, y] = randPos(80);
      return { cx: x, cy: y, rad: 40, obs: makeObstacle('crate', 'rect', { x: x - 28, y: y - 28, w: 56, h: 56, lootSeed: rng.int(1, 1e9) }) };
    });
    scatterKind(counts.barrels, () => {
      const [x, y] = randPos(80);
      return { cx: x, cy: y, rad: 24, obs: makeObstacle('barrel', 'circle', { x, y, r: 22 }) };
    });
    scatterKind(counts.bushes, () => {
      const [x, y] = randPos(60);
      const r = rng.range(40, 56);
      return { cx: x, cy: y, rad: r * 0.6, obs: makeObstacle('bush', 'circle', { x, y, r }) };
    });

    const loot = [];
    buildings.forEach((b, i) => {
      for (let k = 0; k < 3; k++) {
        const x = rng.range(b.x + 60, b.x + b.w - 60);
        const y = rng.range(b.y + 60, b.y + b.h - 60);
        loot.push(...ZR.Items.roll(rng, rng.chance(0.3) ? 'crate' : 'ground', x, y, `b${i}_${k}`));
      }
    });
    for (let i = 0, placed = 0; placed < counts.loot && i < counts.loot * 20; i++) {
      const [x, y] = randPos(80);
      if (!isFree(x, y, 18, 6)) continue;
      loot.push(...ZR.Items.roll(rng, 'ground', x, y, `g${placed}`));
      placed++;
    }

    const links = placeHatches(rng, size, isFree);
    const bunker = makeUnderground(rng, under, add, links);
    loot.push(...bunker.loot);

    const byId = new Map(obstacles.map((o) => [o.id, o]));
    return { seed, size, obstacles, buildings, loot, grid, byId, under, links, rooms: bunker.rooms };
  }

  function placeBuildings(rng, size, count, buildings, add) {
    const palette = [['#6b5a49', '#8a5a3c'], ['#5b5f6b', '#3f6e8c'], ['#6a6250', '#7a3d3d'], ['#55604f', '#4f6b3a']];
    for (let tries = 0; buildings.length < count && tries < count * 40; tries++) {
      const w = rng.int(320, 480), h = rng.int(260, 380);
      const x = rng.int(150, size - 150 - w), y = rng.int(150, size - 150 - h);
      const clash = buildings.some((b) => x < b.x + b.w + 160 && x + w + 160 > b.x && y < b.y + b.h + 160 && y + h + 160 > b.y);
      if (clash) continue;
      const [floor, roof] = rng.pick(palette);
      const b = { id: `h${buildings.length}`, x, y, w, h, floor, roof };
      buildings.push(b);
      makeWalls(rng, b).forEach((wall) => add(makeObstacle('wall', 'rect', wall)));
      const crates = rng.int(1, 2);
      for (let c = 0; c < crates; c++) {
        const cx = rng.chance(0.5) ? x + WALL + 8 : x + w - WALL - 64;
        const cy = rng.chance(0.5) ? y + WALL + 8 : y + h - WALL - 64;
        add(makeObstacle('crate', 'rect', { x: cx, y: cy, w: 56, h: 56, lootSeed: rng.int(1, 1e9) }));
      }
    }
  }

  // 네 변 중 두 변에 문 틈을 낸다
  function makeWalls(rng, b) {
    const sides = ['top', 'bottom', 'left', 'right'];
    const doorA = rng.pick(sides);
    const doorB = rng.pick(sides.filter((s) => s !== doorA));
    const out = [];
    const span = (side, start, len, fixed, horizontal) => {
      const hasDoor = side === doorA || side === doorB;
      const pieces = [];
      if (!hasDoor) pieces.push([start, len]);
      else {
        const mid = start + len * rng.range(0.3, 0.7);
        pieces.push([start, mid - DOOR / 2 - start]);
        pieces.push([mid + DOOR / 2, start + len - (mid + DOOR / 2)]);
      }
      pieces.forEach(([s, l]) => out.push(horizontal
        ? { x: s, y: fixed, w: l, h: WALL }
        : { x: fixed, y: s, w: WALL, h: l }));
    };
    span('top', b.x, b.w, b.y, true);
    span('bottom', b.x, b.w, b.y + b.h - WALL, true);
    span('left', b.y + WALL, b.h - WALL * 2, b.x, false);
    span('right', b.y + WALL, b.h - WALL * 2, b.x + b.w - WALL, false);
    return out;
  }

  // 지상의 비밀 해치: 서로 멀리 떨어진 빈 땅에 둔다
  function placeHatches(rng, size, isFree) {
    const n = ZR.CONFIG.underground.links;
    const out = [];
    for (let tries = 0; out.length < n && tries < 2000; tries++) {
      const x = rng.range(300, size - 300), y = rng.range(300, size - 300);
      const far = out.every((h) => U.dist(h.hx, h.hy, x, y) > size * 0.3);
      if (far && isFree(x, y, 46)) out.push({ id: `hatch${out.length}`, hx: x, hy: y });
    }
    return out;
  }

  // 지하 벙커: cells×cells 방, 방 사이 벽에는 문이 있고 일부 벽은 통째로 뚫어 큰 홀을 만든다
  function makeUnderground(rng, R, add, links) {
    const G = ZR.CONFIG.underground;
    const T = 30;
    const cs = R.w / G.cells;
    const wall = (x, y, w, h) => add(makeObstacle('wall', 'rect', { x, y, w, h, under: true }));
    wall(R.x - T, R.y - T, R.w + T * 2, T);
    wall(R.x - T, R.y + R.h, R.w + T * 2, T);
    wall(R.x - T, R.y, T, R.h);
    wall(R.x + R.w, R.y, T, R.h);
    const door = 110;
    for (let c = 1; c < G.cells; c++) {
      for (let r = 0; r < G.cells; r++) {
        // 세로 벽 (열 c 왼쪽)
        if (!rng.chance(0.22)) {
          const x = R.x + c * cs - 10, y0 = R.y + r * cs, mid = y0 + cs * rng.range(0.3, 0.7);
          wall(x, y0, 20, mid - door / 2 - y0);
          wall(x, mid + door / 2, 20, y0 + cs - (mid + door / 2));
        }
        // 가로 벽 (행 c 위쪽)
        if (!rng.chance(0.22)) {
          const y = R.y + c * cs - 10, x0 = R.x + r * cs, mid = x0 + cs * rng.range(0.3, 0.7);
          wall(x0, y, mid - door / 2 - x0, 20);
          wall(mid + door / 2, y, x0 + cs - (mid + door / 2), 20);
        }
      }
    }
    // 출구(계단)는 네 모서리 방 가운데
    const corners = [[0, 0], [G.cells - 1, 0], [0, G.cells - 1], [G.cells - 1, G.cells - 1]];
    links.forEach((l, i) => {
      const [cx, cy] = corners[i % corners.length];
      l.sx = R.x + (cx + 0.5) * cs;
      l.sy = R.y + (cy + 0.5) * cs;
    });
    const loot = [];
    const rooms = [];
    for (let cy = 0; cy < G.cells; cy++) {
      for (let cx = 0; cx < G.cells; cx++) {
        const x0 = R.x + cx * cs, y0 = R.y + cy * cs;
        rooms.push({ x: x0, y: y0, w: cs, h: cs, tint: rng.int(0, 2) });
        const isExit = links.some((l) => l.sx > x0 && l.sx < x0 + cs && l.sy > y0 && l.sy < y0 + cs);
        if (!isExit && rng.chance(0.6)) {
          add(makeObstacle('pillar', 'circle', { x: x0 + cs * rng.range(0.3, 0.7), y: y0 + cs * rng.range(0.3, 0.7), r: 26, under: true }));
        }
        if (rng.chance(0.55)) {
          add(makeObstacle('crate', 'rect', { x: x0 + 40, y: y0 + cs - 100, w: 56, h: 56, lootSeed: rng.int(1, 1e9), under: true }));
        }
        const n = isExit ? 1 : 2;
        for (let k = 0; k < n; k++) {
          loot.push(...ZR.Items.roll(rng, 'secret', x0 + cs * rng.range(0.25, 0.75), y0 + cs * rng.range(0.25, 0.75), `u${cx}${cy}_${k}`));
        }
      }
    }
    return { loot, rooms };
  }

  function crateLoot(o) {
    const rng = U.rng(o.lootSeed);
    const c = U.center(o);
    const table = o.kind === 'airdrop' ? 'airdrop' : 'crate';
    return ZR.Items.roll(rng, table, c.x, c.y, `c${o.id}`, table === 'airdrop' ? 3 : 2);
  }

  function addObstacle(map, o) {
    map.obstacles.push(o);
    map.byId.set(o.id, o);
    map.grid.insert(o);
  }

  const isUnder = (map, x) => x > map.size + 200;

  // 막힌 곳이 아닌 지상의 무작위 지점 (rng: 시드 난수)
  function findSpawn(map, rng, zone) {
    const inBuilding = (x, y) => map.buildings.some((b) => x > b.x - 30 && x < b.x + b.w + 30 && y > b.y - 30 && y < b.y + b.h + 30);
    for (let i = 0; i < 400; i++) {
      const a = rng.range(0, U.TAU);
      const d = Math.sqrt(rng.next()) * (zone ? zone.r * 0.85 : map.size * 0.45);
      const x = (zone ? zone.x : map.size / 2) + Math.cos(a) * d;
      const y = (zone ? zone.y : map.size / 2) + Math.sin(a) * d;
      if (x < 60 || y < 60 || x > map.size - 60 || y > map.size - 60 || inBuilding(x, y)) continue;
      if (isClear(map, x, y, 40)) return { x, y };
    }
    return { x: map.size / 2, y: map.size / 2 };
  }

  function isClear(map, x, y, r) {
    const near = map.grid.query(x - r - 60, y - r - 60, x + r + 60, y + r + 60).filter((o) => o.solid);
    return !near.some((o) => (o.shape === 'circle'
      ? U.dist2(x, y, o.x, o.y) < (o.r + r) ** 2
      : U.pushCircleRect(x, y, r, o.x, o.y, o.w, o.h)));
  }

  // 주변의 막히지 않은 지점 (팀원을 옆에 붙여 출발시킬 때)
  function nearbyClear(map, x, y, rng) {
    for (let i = 0; i < 40; i++) {
      const a = rng.range(0, U.TAU), d = rng.range(50, 120);
      const px = U.clamp(x + Math.cos(a) * d, 60, map.size - 60), py = U.clamp(y + Math.sin(a) * d, 60, map.size - 60);
      if (isClear(map, px, py, 30)) return { x: px, y: py };
    }
    return { x, y };
  }

  ZR.MapGen = Object.freeze({ generate, crateLoot, addObstacle, findSpawn, nearbyClear, makeObstacle, isUnder, countsFor, WALL });
})(typeof window !== 'undefined' ? window : globalThis);
