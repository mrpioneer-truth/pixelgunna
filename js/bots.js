'use strict';
// 솔로 모드 봇 AI: 줍기 → 교전 → 자기장 회피 → 회복. 판단은 0.2초마다, 행동은 매 프레임.
(function (root) {
  const ZR = (root.ZR = root.ZR || {});
  const U = ZR.U;

  const NAMES = ['번개곰', '깡통로봇', '야생고양이', '김치전사', '레이저펭귄', '칼바람', '은둔고수', '불꽃여우', '로켓토끼', '폭주기관차',
    '그림자', '모래폭풍', '얼음공주', '철벽수비', '돌격대장', '저격수K', '떠돌이', '초코칩', '미스터리', '번쩍이',
    '사냥꾼', '흑기사', '천둥새', '노바맨', '블랙홀', '스나이퍼J', '야간근무', '마라맛', '고양이손', '피자배달'];
  const COLORS = ['#f4c27a', '#e0a370', '#c98d5b', '#f7d9b5', '#8d5a3b', '#b5e48c', '#90caf9', '#f48fb1', '#ce93d8', '#ffcc80'];
  const SIGHT = 680;
  const THINK_GAP = 0.2;
  const FOLLOW_NEAR = 220;
  const FOLLOW_FAR = 600;
  const LOOT_RANGE = 650;

  // n명의 봇을 만든다. teamSize>1이면 사람(leader, 팀 0)의 빈자리를 먼저 채우고 나머지는 봇끼리 팀을 이룬다
  function spawnAll(world, n, teamSize = 1, leader = null) {
    const rng = U.rng((world.seed ^ 0xb075) >>> 0);
    const anchors = new Map();
    if (leader) anchors.set(leader.team, leader);
    for (let i = 0; i < n; i++) {
      const slot = i + (leader ? 1 : 0);
      const team = teamSize > 1 ? Math.floor(slot / teamSize) : (leader ? slot : i + 1);
      const anchor = teamSize > 1 ? anchors.get(team) : null;
      const pos = anchor ? ZR.MapGen.nearbyClear(world.map, anchor.x, anchor.y, rng) : world.spawnPoint(`bot${i}`);
      const name = NAMES[i % NAMES.length] + (i >= NAMES.length ? `${Math.floor(i / NAMES.length) + 1}` : '');
      const bot = new ZR.Player(`bot${i}`, name, rng.pick(COLORS), pos.x, pos.y, true);
      bot.team = team;
      bot.brain = { think: rng.range(0, THINK_GAP), enemy: null, goal: null, strafe: rng.chance(0.5) ? 1 : -1, strafeT: 0, stuckT: 0, lastX: pos.x, lastY: pos.y, unstickT: 0, unstickA: 0, sightT: 0, toggle: false, aimErr: rng.range(0.05, 0.14) };
      world.addPlayer(bot);
      if (!anchors.has(team)) anchors.set(team, bot);
    }
  }

  // 같은 팀의 사람(살아 있고 같은 층)이 멀어지면 따라간다
  function leaderOf(world, bot) {
    if (bot.team == null) return null;
    for (const p of world.players.values()) {
      if (p !== bot && !p.isBot && p.alive && p.team === bot.team && world.isUnder(p.x) === world.isUnder(bot.x)) return p;
    }
    return null;
  }

  function gunReady(p, i) {
    const s = p.slots[i];
    if (!s) return false;
    const def = ZR.W[s.wid];
    return s.mag > 0 || p.ammo[def.ammo] > 0;
  }

  function bestGunSlot(p) {
    let best = -1, rank = -1;
    for (const i of [0, 1]) {
      if (gunReady(p, i) && ZR.Weapons.rank(p.slots[i].wid) > rank) {
        rank = ZR.Weapons.rank(p.slots[i].wid);
        best = i;
      }
    }
    return best;
  }

  function weakestGunSlot(p) {
    if (!p.slots[0]) return 0;
    if (!p.slots[1]) return 1;
    return ZR.Weapons.rank(p.slots[0].wid) <= ZR.Weapons.rank(p.slots[1].wid) ? 0 : 1;
  }

  function wantsLoot(p, it) {
    if (it.type === 'gun') {
      if (p.slots[0]?.wid === it.key || p.slots[1]?.wid === it.key) return false;
      const slot = p.slots[weakestGunSlot(p)];
      return !slot || ZR.Weapons.rank(it.key) > ZR.Weapons.rank(slot.wid);
    }
    if (it.type === 'ammo') return p.slots.some((s, i) => i < 2 && s && ZR.W[s.wid].ammo === it.key) && ZR.PlayerSys.canAutoPick(p, it);
    if (it.type === 'melee') return ZR.Weapons.rank(it.key) > ZR.Weapons.rank(p.slots[2].wid);
    return ZR.PlayerSys.canAutoPick(p, it);
  }

  function findEnemy(world, bot) {
    let best = null, bd = SIGHT * SIGHT;
    for (const p of world.players.values()) {
      if (!p.alive || !world.isFoe(bot.id, p)) continue;
      const d = U.dist2(bot.x, bot.y, p.x, p.y);
      if (d < bd && ZR.Combat.hasLOS(world, bot.x, bot.y, p.x, p.y)) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  function findLoot(world, bot) {
    let best = null, bd = LOOT_RANGE * LOOT_RANGE;
    // 총기는 거리 제곱에 0.5 가중치를 주므로 더 먼 셀까지 포함한다.
    const radius = LOOT_RANGE * Math.SQRT2;
    for (const it of world.lootNear(bot.x, bot.y, radius)) {
      if (it.id === bot.brain.blockedLoot && world.time < bot.brain.blockedLootUntil) continue;
      const d = U.dist2(bot.x, bot.y, it.x, it.y) * (it.type === 'gun' ? 0.5 : 1);
      if (d < bd && wantsLoot(bot, it)) {
        bd = d;
        best = it;
      }
    }
    return best;
  }

  function decide(world, bot, b) {
    const z = world.zoneState;
    const prevEnemy = b.enemy;
    b.enemy = findEnemy(world, bot);
    if (b.enemy && b.enemy !== prevEnemy) b.sightT = 0.35;
    b.goal = null;
    const outNext = U.dist(bot.x, bot.y, z.tx, z.ty) > z.tr * 0.85;
    if ((outNext && z.remain < 25) || U.dist(bot.x, bot.y, z.x, z.y) > z.r * 0.92) {
      b.goal = { x: z.tx, y: z.ty, zone: true };
      return;
    }
    if (!b.enemy) {
      if (bot.hp < 70 && !bot.action) {
        const key = bot.hp < 40 && bot.heals.medkit ? 'medkit' : bot.heals.bandage && bot.hp < 75 ? 'bandage' : bot.heals.soda ? 'soda' : null;
        if (key) bot.input.heal = key;
      }
      const gs = bestGunSlot(bot);
      if (gs >= 0 && bot.slots[gs].mag < ZR.W[bot.slots[gs].wid].mag) bot.input.reload = gs === bot.cur;
      const lead = leaderOf(world, bot);
      const leadD = lead ? U.dist(bot.x, bot.y, lead.x, lead.y) : 0;
      const it = leadD > FOLLOW_FAR ? null : findLoot(world, bot);
      if (it && (!lead || U.dist(it.x, it.y, lead.x, lead.y) < FOLLOW_FAR)) b.goal = { x: it.x, y: it.y, loot: it };
      else if (lead && leadD > FOLLOW_NEAR) b.goal = { x: lead.x, y: lead.y };
      else if (!b.wander || U.dist(bot.x, bot.y, b.wander.x, b.wander.y) < 80) {
        const a = Math.random() * U.TAU, d = Math.random() * z.tr * 0.7;
        b.wander = { x: z.tx + Math.cos(a) * d, y: z.ty + Math.sin(a) * d };
      }
      if (!b.goal) b.goal = b.wander;
    }
  }

  function act(world, bot, b, dt) {
    const inp = bot.input;
    inp.fire = false;
    inp.mx = 0;
    inp.my = 0;
    const e = b.enemy && b.enemy.alive ? b.enemy : null;
    if (b.goal?.loot && !world.loot.has(b.goal.loot.id)) b.goal = null;
    if (e && !(b.goal && b.goal.zone)) fight(world, bot, b, e, dt);
    else if (b.goal) {
      const a = U.angleTo(bot.x, bot.y, b.goal.x, b.goal.y);
      inp.mx = Math.cos(a);
      inp.my = Math.sin(a);
      inp.ax = bot.x + inp.mx * 100;
      inp.ay = bot.y + inp.my * 100;
      const it = b.goal.loot;
      if (it && (it.type === 'gun' || it.type === 'melee')
        && U.dist2(bot.x, bot.y, it.x, it.y) < (bot.r + 20) ** 2 && wantsLoot(bot, it)) {
        if (it.type === 'gun' && bot.slots[0] && bot.slots[1]) inp.slot = weakestGunSlot(bot);
        inp.pickup = it.id;
      }
      if (e) aimAt(bot, b, e);
    }
    unstick(world, bot, b, dt);
  }

  function aimAt(bot, b, e) {
    const d = U.dist(bot.x, bot.y, e.x, e.y);
    const lead = d / 1600;
    const err = (Math.random() - 0.5) * 2 * b.aimErr * (0.5 + d / SIGHT);
    const a = U.angleTo(bot.x, bot.y, e.x + (e.x - (e.lastX ?? e.x)) * lead * 60, e.y + (e.y - (e.lastY ?? e.y)) * lead * 60) + err;
    bot.input.ax = bot.x + Math.cos(a) * d;
    bot.input.ay = bot.y + Math.sin(a) * d;
  }

  function fight(world, bot, b, e, dt) {
    const inp = bot.input;
    const gs = bestGunSlot(bot);
    const want = gs >= 0 ? gs : 2;
    if (bot.cur !== want) inp.slot = want;
    const def = ZR.W[bot.slots[want].wid];
    const d = U.dist(bot.x, bot.y, e.x, e.y);
    aimAt(bot, b, e);
    b.sightT -= dt;
    const range = def.kind === 'melee' ? def.range + 30 : Math.min(def.range * 0.85, 650);
    if (b.sightT <= 0 && d < range + 20 && bot.cur === want) {
      const hold = def.auto || def.type === 'beam' || def.spinUp || def.charge || def.kind === 'melee';
      b.toggle = !b.toggle;
      inp.fire = hold ? true : b.toggle;
    }
    if (bot.slots[want].mag === 0) inp.reload = true;
    const toE = U.angleTo(bot.x, bot.y, e.x, e.y);
    b.strafeT -= dt;
    if (b.strafeT <= 0) {
      b.strafeT = 0.6 + Math.random() * 1.2;
      b.strafe = -b.strafe;
    }
    const ideal = def.kind === 'melee' ? 0 : Math.min(range * 0.55, 380);
    const approach = d > ideal + 60 ? 1 : d < ideal - 60 ? -0.8 : 0;
    const side = toE + (Math.PI / 2) * b.strafe;
    inp.mx = Math.cos(toE) * approach + Math.cos(side) * 0.8;
    inp.my = Math.sin(toE) * approach + Math.sin(side) * 0.8;
    if (bot.hp < 30 && def.kind === 'melee') {
      inp.mx = -Math.cos(toE);
      inp.my = -Math.sin(toE);
    }
  }

  function unstick(world, bot, b, dt) {
    const inp = bot.input;
    if (b.unstickT > 0) {
      b.unstickT -= dt;
      inp.mx = Math.cos(b.unstickA);
      inp.my = Math.sin(b.unstickA);
      return;
    }
    const moving = Math.hypot(inp.mx, inp.my) > 0.3;
    const moved = U.dist(bot.x, bot.y, b.lastX, b.lastY);
    b.stuckT = moving && moved < 40 * dt ? b.stuckT + dt : 0;
    b.lastX = bot.x;
    b.lastY = bot.y;
    if (b.stuckT > 0.5) {
      b.stuckT = 0;
      // 같은 벽을 향해 다시 걸어가지 않도록 막힌 전리품은 잠시 건너뛴다.
      if (b.goal?.loot) {
        b.blockedLoot = b.goal.loot.id;
        b.blockedLootUntil = world.time + 3;
        b.goal = null;
      }
      b.unstickT = 0.5;
      b.unstickA = Math.atan2(inp.my, inp.mx) + (Math.random() < 0.5 ? 1 : -1) * (Math.PI / 2 + Math.random());
    }
  }

  function update(world, bot, dt) {
    const b = bot.brain;
    if (!b) return;
    if (b.dummy) {
      bot.input.mx = 0;
      bot.input.my = 0;
      bot.input.fire = false;
      return;
    }
    b.think -= dt;
    if (b.think <= 0) {
      b.think = THINK_GAP + Math.random() * 0.1;
      decide(world, bot, b);
    }
    act(world, bot, b, dt);
  }

  // 위치 기록(조준 예측용)은 모든 플레이어에 대해 프레임 끝에 남긴다
  function recordPositions(world) {
    for (const p of world.players.values()) {
      p.lastX = p.x;
      p.lastY = p.y;
    }
  }

  ZR.Bots = Object.freeze({ spawnAll, update, recordPositions, NAMES, COLORS });
})(typeof window !== 'undefined' ? window : globalThis);
