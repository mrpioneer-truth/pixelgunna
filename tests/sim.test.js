'use strict';
// node --test tests/ : 맵 결정성, 무기 데이터 무결성, 봇 대전 전체 시뮬레이션
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

globalThis.window = undefined;
for (const f of ['config', 'util', 'weapons', 'items', 'map', 'zone', 'audio', 'player', 'combat', 'bots', 'world', 'net']) {
  require(path.join(__dirname, '..', 'js', `${f}.js`));
}
const ZR = globalThis.ZR;

test('같은 시드면 맵·전리품·자기장이 똑같다', () => {
  const a = ZR.MapGen.generate(12345), b = ZR.MapGen.generate(12345);
  assert.strictEqual(JSON.stringify(a.obstacles.map(({ _stamp, ...o }) => o)), JSON.stringify(b.obstacles.map(({ _stamp, ...o }) => o)));
  assert.deepStrictEqual(a.loot, b.loot);
  assert.deepStrictEqual(new ZR.Zone(9, 3000).state(123), new ZR.Zone(9, 3000).state(123));
  assert.ok(a.buildings.length >= 6, `건물 ${a.buildings.length}개`);
  assert.ok(a.loot.length > 150);
});

test('모든 전리품 id가 고유하고 Firebase 키로 쓸 수 있다', () => {
  const m = ZR.MapGen.generate(777);
  const ids = m.loot.map((i) => i.id);
  assert.strictEqual(new Set(ids).size, ids.length);
  ids.forEach((id) => assert.ok(!/[.#$\[\]/]/.test(id), id));
  const crate = m.obstacles.find((o) => o.kind === 'crate');
  ZR.MapGen.crateLoot(crate).forEach((it) => assert.ok(/^c/.test(it.id)));
});

test('무기 정의가 완전하다', () => {
  for (const [id, d] of Object.entries(ZR.W)) {
    assert.ok(d.name && d.rarity && ZR.Weapons.RARITY[d.rarity], id);
    if (d.kind === 'gun') {
      assert.ok(ZR.Weapons.AMMO[d.ammo], `${id} 탄약`);
      assert.ok(d.mag > 0 && d.range > 0, id);
      if (d.type !== 'beam') assert.ok(d.fireDelay > 0, `${id} fireDelay`);
    }
  }
  assert.ok(ZR.Weapons.byRarity('gun', 'mythic').length >= 3);
});

test('줍기: 총 교체 시 기존 총을 떨어뜨리고 탄창을 탄약으로 돌려준다', () => {
  const p = new ZR.Player('a', 'A', '#fff', 0, 0);
  ZR.PlayerSys.applyPickup(p, { type: 'gun', key: 'pistol' });
  ZR.PlayerSys.applyPickup(p, { type: 'gun', key: 'smg' });
  assert.strictEqual(p.slots[0].wid, 'pistol');
  assert.strictEqual(p.slots[1].wid, 'smg');
  const dropped = ZR.PlayerSys.applyPickup(p, { type: 'gun', key: 'nova' });
  assert.deepStrictEqual(dropped, [{ type: 'gun', key: 'pistol' }], '들고 있던 총(1번)을 교체');
  assert.strictEqual(p.ammo.light, 15);
  const left = ZR.PlayerSys.applyPickup(p, { type: 'ammo', key: 'rocket', count: 20 });
  assert.strictEqual(p.ammo.rocket, 8);
  assert.strictEqual(left[0].count, 12);
});

test('전리품 검색은 셀 사이 이동·줍기 후에도 항목과 기존 순서를 유지한다', () => {
  const world = new ZR.World({ seed: 33, mode: 'solo', localId: 'me' });
  const a = { id: 'test-a', type: 'gun', key: 'pistol', x: 975, y: 1000 };
  const b = { id: 'test-b', type: 'gun', key: 'smg', x: 945, y: 1000 };
  const near = (x) => world.lootNear(x, 1000, 32).filter((it) => it.id.startsWith('test-'));
  world.addLoot([a, b]);
  assert.deepStrictEqual(near(960), [a, b]);
  const moved = { ...a, x: 9200 };
  world.addLoot([moved]);
  assert.deepStrictEqual(near(960), [b]);
  assert.deepStrictEqual(near(9200), [moved]);
  world.addLoot([a]);
  assert.deepStrictEqual(near(960), [a, b]);
  world.markTaken(a.id);
  world.addLoot([a]);
  assert.deepStrictEqual(near(960), [b]);
});

test('봇은 가까운 약한 무기 대신 목표 무기를 약한 슬롯에 넣는다', () => {
  const world = new ZR.World({ seed: 11, mode: 'solo', localId: 'me' });
  world.map.obstacles.forEach((o) => { o.dead = true; });
  for (const id of world.loot.keys()) world.markTaken(id);
  ZR.Bots.spawnAll(world, 1);
  const bot = world.players.get('bot0');
  bot.x = 1000;
  bot.y = 1000;
  bot.brain.think = 0;
  ZR.PlayerSys.giveGun(bot, 'pistol', 0);
  ZR.PlayerSys.giveGun(bot, 'nova', 1);
  bot.cur = 1;
  world.addLoot([
    { id: 'weak', type: 'gun', key: 'shotgun', x: 1008, y: 1000 },
    { id: 'upgrade', type: 'gun', key: 'rail', x: 1028, y: 1000 },
  ]);
  for (let i = 0; i < 20; i++) world.update(1 / 60);
  assert.deepStrictEqual(bot.slots.slice(0, 2).map((s) => s.wid), ['rail', 'nova']);
  assert.ok(world.loot.has('weak'));
  assert.ok(!world.loot.has('upgrade'));
});

test('봇은 벽에 막혀 움직이지 못하면 해당 전리품을 잠시 건너뛴다', () => {
  const world = new ZR.World({ seed: 11, mode: 'solo', localId: 'me' });
  world.map.obstacles.forEach((o) => { o.dead = true; });
  for (const id of world.loot.keys()) world.markTaken(id);
  ZR.MapGen.addObstacle(world.map, ZR.MapGen.makeObstacle('wall', 'rect', {
    id: 'test-wall', x: 1040, y: 700, w: 20, h: 600,
  }));
  world.addLoot([{ id: 'blocked', type: 'gun', key: 'rail', x: 1120, y: 1000 }]);
  ZR.Bots.spawnAll(world, 1);
  const bot = world.players.get('bot0');
  bot.x = 1040 - bot.r;
  bot.y = 1000;
  bot.brain.think = 0;
  for (let i = 0; i < 45; i++) world.update(1 / 60);
  assert.strictEqual(bot.brain.blockedLoot, 'blocked');
  assert.ok(bot.brain.blockedLootUntil > world.time);
  assert.ok(bot.brain.goal?.loot?.id !== 'blocked');
});

test('솔로 봇 24명 대전이 오류 없이 끝까지 진행된다', () => {
  const world = new ZR.World({ seed: 4242, mode: 'solo', localId: 'me' });
  const me = world.addPlayer(new ZR.Player('me', 'me', '#fff', 1500, 1500));
  ZR.Bots.spawnAll(world, 24);
  const dt = 1 / 30;
  let shots = 0;
  const origFire = ZR.Combat.fire;
  let t = 0;
  for (; t < 420 && world.aliveCount() > 1; t += dt) {
    me.input.ax = me.x + 10;
    me.input.ay = me.y;
    world.update(dt);
    shots += world.projectiles.length > 0 ? 1 : 0;
  }
  for (const p of world.players.values()) {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), `${p.id} 위치`);
  }
  const kills = [...world.players.values()].reduce((s, p) => s + p.kills, 0);
  console.log(`  ${t.toFixed(0)}초 경과, 생존 ${world.aliveCount()}, 봇 킬 합계 ${kills}, 남은 전리품 ${world.loot.size}`);
  assert.ok(kills > 0, '봇들이 서로 싸워야 한다');
  assert.ok(world.aliveCount() <= 3, '자기장이 끝까지 줄어 생존자가 줄어야 한다');
  void origFire;
});

test('모든 총을 쏴도 오류가 없고 허수아비가 피해를 입는다', () => {
  for (const wid of ZR.Weapons.byKind('gun')) {
    const world = new ZR.World({ seed: 99, mode: 'range', localId: 'me' });
    world.map.obstacles.forEach((o) => { o.dead = true; });
    const me = world.addPlayer(new ZR.Player('me', 'me', '#fff', 1000, 1000));
    const dummy = world.addPlayer(new ZR.Player('d', 'd', '#fff', 1250, 1000, true));
    dummy.brain = { dummy: true };
    ZR.PlayerSys.giveGun(me, wid, 0);
    me.ammo[ZR.W[wid].ammo] = 999;
    me.input.slot = 0;
    me.input.ax = 1250;
    me.input.ay = 1000;
    me.input.fire = true;
    for (let i = 0; i < 120; i++) {
      if (i % 2 === 0) me.input.fire = true; else me.input.fire = ZR.W[wid].auto || ZR.W[wid].type === 'beam' || !!ZR.W[wid].charge || !!ZR.W[wid].spinUp;
      world.update(1 / 30);
    }
    assert.ok(dummy.hp < 100 || !dummy.alive || dummy.deathT !== undefined, `${wid}: 허수아비 체력 ${dummy.hp}`);
  }
});

test('맵이 커졌고 지하 벙커는 지상 지도 밖에 있다', () => {
  const m = ZR.MapGen.generate(31);
  assert.strictEqual(m.size, 5200);
  assert.strictEqual(m.links.length, 4);
  assert.ok(m.under.x > m.size + 2000, '지상 화면에 비치지 않을 만큼 떨어져 있어야 한다');
  for (const l of m.links) {
    assert.ok(l.hx < m.size && l.hy < m.size, '해치는 지상');
    assert.ok(ZR.MapGen.isUnder(m, l.sx), '계단은 지하');
  }
  const secretGuns = m.loot.filter((i) => i.id.startsWith('u') && i.type === 'gun');
  assert.ok(secretGuns.length >= 8);
  assert.ok(secretGuns.every((i) => ZR.Weapons.rank(i.key) >= 1), '지하에는 희귀 이상만');
});

test('해치로 내려가고 올라오며, 지하에선 해치 위치 기준으로 자기장 피해를 받는다', () => {
  const world = new ZR.World({ seed: 8, mode: 'solo', localId: 'me' });
  const l = world.map.links[2];
  const me = world.addPlayer(new ZR.Player('me', 'me', '#fff', l.hx, l.hy));
  assert.ok(world.useLink(me));
  assert.ok(world.isUnder(me.x));
  assert.strictEqual(me.underLink, 2);
  assert.deepStrictEqual(world.zonePoint(me), { x: l.hx, y: l.hy });
  me.x = l.sx;
  me.y = l.sy;
  world.time = 5;
  assert.ok(world.useLink(me));
  assert.ok(!world.isUnder(me.x));
  const bot = world.addPlayer(new ZR.Player('b', 'b', '#fff', l.hx, l.hy, true));
  assert.ok(!world.useLink(bot), '봇은 해치를 쓰지 않는다');
});

test('같은 팀은 서로 피해를 주지 않고, 총알도 통과한다', () => {
  const world = new ZR.World({ seed: 3, mode: 'solo', localId: 'me' });
  world.map.obstacles.forEach((o) => { o.dead = true; });
  const a = world.addPlayer(new ZR.Player('a', 'A', '#fff', 1000, 1000));
  const mate = world.addPlayer(new ZR.Player('m', 'M', '#fff', 1100, 1000));
  const foe = world.addPlayer(new ZR.Player('f', 'F', '#fff', 1250, 1000));
  a.team = 1; mate.team = 1; foe.team = 2;
  ZR.Combat.explode(world, 1100, 1000, 200, 80, 'a', 'nova', {});
  assert.strictEqual(mate.hp, 100);
  assert.ok(foe.hp < 100);
  const before = foe.hp;
  ZR.Combat.fire(world, { o: 'a', w: 'dmr', x: 1000, y: 1000, a: 0, tx: 1250, ty: 1000, s: 1 });
  for (let i = 0; i < 20; i++) ZR.Combat.updateProjectiles(world, 1 / 60);
  assert.strictEqual(mate.hp, 100, '팀원은 총알이 통과');
  assert.ok(foe.hp < before, '뒤의 적이 맞는다');
  assert.deepStrictEqual([...world.aliveTeams()].sort(), ['t1', 't2']);
});

test('온라인 팀 배정: 원하는 팀 우선, 나머지는 빈자리부터', () => {
  const ps = [{ id: 'a', tm: 2 }, { id: 'b', tm: 0 }, { id: 'c', tm: 2 }, { id: 'd', tm: 2 }, { id: 'e', tm: 0 }];
  const duo = ZR.Net.assignTeams(ps, 2);
  assert.deepStrictEqual(duo, { a: 2, c: 2, d: 1, b: 1, e: 3 });
  const solo = ZR.Net.assignTeams(ps, 1);
  assert.strictEqual(new Set(Object.values(solo)).size, 5);
});

test('스쿼드 봇 경기: 팀이 4명씩 묶이고 팀 단위로 끝난다', () => {
  const world = new ZR.World({ seed: 77, mode: 'solo', localId: 'me' });
  world.teamMode = 'squad';
  const pos = world.spawnPoint('me');
  const me = world.addPlayer(new ZR.Player('me', 'me', '#fff', pos.x, pos.y));
  me.team = 0;
  ZR.Bots.spawnAll(world, 23, 4, me);
  assert.strictEqual(world.teamCount(), 6);
  const mates = world.teammates(me);
  assert.strictEqual(mates.length, 3);
  mates.forEach((b) => assert.ok(ZR.U.dist(b.x, b.y, me.x, me.y) < 200, '팀원은 옆에서 출발'));
  let t = 0;
  for (; t < 700 && world.aliveTeams().size > 1; t += 1 / 30) {
    me.input.ax = me.x + 10;
    me.input.ay = me.y;
    world.update(1 / 30);
  }
  console.log(`  스쿼드 ${t.toFixed(0)}초, 남은 팀 ${world.aliveTeams().size}`);
  assert.ok(world.aliveTeams().size <= 1);
});

test('온라인 봇 채우기: 사람 팀 빈자리부터 채우고 남은 봇은 새 팀으로 묶는다', () => {
  // 듀오, 사람 3명(1팀 2명, 2팀 1명), 총 8명 → 2팀에 봇 1 + 봇 팀 3·4
  assert.deepStrictEqual(ZR.Net.planBots({ a: 1, b: 1, c: 2 }, 2, 8), [2, 3, 3, 4, 4]);
  // 솔로: 봇마다 자기 팀
  assert.deepStrictEqual(ZR.Net.planBots({ a: 1, b: 2 }, 1, 5), [3, 4, 5]);
  // 봇 없음 / 사람이 이미 총 인원 이상
  assert.deepStrictEqual(ZR.Net.planBots({ a: 1 }, 4, 0), []);
  assert.deepStrictEqual(ZR.Net.planBots({ a: 1, b: 2 }, 1, 2), []);
  // 스쿼드 1명 + 총 10명 → 우리 팀 봇 3 + 봇 팀(4,2)
  assert.deepStrictEqual(ZR.Net.planBots({ a: 1 }, 4, 10), [1, 1, 1, 2, 2, 2, 2, 3, 3]);
});

function hostWorld(events) {
  const world = new ZR.World({
    seed: 55, mode: 'online', localId: 'host',
    hooks: { onEvent: (ev) => events.push(ev), claim: () => Promise.resolve(true), onDrop: () => {}, onDestroy: () => {}, onDeath: (t) => events.push({ k: 'kill', v: t.id }) },
  });
  world.teamMode = 'duo';
  const base = world.teamBase(1);
  const me = world.addPlayer(new ZR.Player('host', 'H', '#fff', base.x, base.y));
  me.team = 1;
  return world;
}

test('방장 브라우저는 자기 봇을 직접 계산하고, 봇 공격을 이벤트로 보낸다', () => {
  const events = [];
  const world = hostWorld(events);
  const friend = world.addPlayer(new ZR.Player('u2', 'F', '#fff', 900, 900));
  friend.team = 2;
  friend.remote = true;
  ZR.Bots.spawnOnline(world, [1, 2, 3, 3, 4, 4, 5, 5], new Set([1, 2]));
  const mate = world.players.get('bot0');
  assert.strictEqual(mate.team, 1);
  assert.ok(ZR.U.dist(mate.x, mate.y, world.local.x, world.local.y) < 200, '우리 팀 봇은 내 옆에서 출발');
  assert.ok(world.isAuth(mate) && world.ownsShot('bot0'));
  assert.ok(!world.isAuth(friend), '친구는 친구 브라우저가 계산');
  for (let t = 0; t < 90; t += 1 / 30) world.update(1 / 30);
  const botShots = events.filter((e) => e.k !== 'kill' && String(e.o).startsWith('bot'));
  assert.ok(botShots.length > 0, `봇 공격 이벤트 ${botShots.length}개`);
  // 내 봇이 쏜 이벤트가 되돌아와도 다시 재생하지 않는다
  const before = world.projectiles.length;
  world.playRemoteAttack({ ...botShots[0], s: 1 });
  assert.strictEqual(world.projectiles.length, before);
});

test('킬 집계: 내 봇이 다른 사람을 잡으면 봇 킬이 오르고, 내 쪽에서 난 킬은 두 번 세지 않는다', () => {
  const world = hostWorld([]);
  ZR.Bots.spawnOnline(world, [3], new Set([1]));
  const bot = world.players.get('bot0');
  const friend = world.addPlayer(new ZR.Player('u2', 'F', '#fff', 900, 900));
  friend.team = 2;
  world.remoteKill({ by: 'bot0', v: 'u2', w: 'smg', r: 3 });
  assert.strictEqual(bot.kills, 1);
  assert.ok(!friend.alive);
  // 내가 내 봇을 잡은 경우: killPlayer에서 한 번 세고, 서버에서 되돌아온 킬 이벤트로는 다시 세지 않는다
  const me = world.local;
  world.killPlayer(bot, 'host', 'smg');
  assert.strictEqual(me.kills, 1);
  world.remoteKill({ by: 'host', v: 'bot0', w: 'smg', r: 2 });
  assert.strictEqual(me.kills, 1);
});
