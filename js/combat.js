'use strict';
// 공격 시뮬레이션: 탄환·광선·레일·번개·박격포·블랙홀·유성·수류탄·근접·폭발·피해.
// 온라인에서는 모든 접속자가 같은 사격 이벤트를 각자 재생하고, 피해는 "맞은 사람 쪽"만 실제로 적용한다.
(function (root) {
  const ZR = (root.ZR = root.ZR || {});
  const U = ZR.U;

  const SPECIAL_NAMES = Object.freeze({ zone: '자기장', barrel: '폭발 드럼통', left: '접속 끊김' });
  const weaponName = (wid) => (ZR.W[wid] ? ZR.W[wid].name : SPECIAL_NAMES[wid] || '???');
  const muzzle = (x, y, a, def) => {
    const d = ZR.CONFIG.playerRadius + (def.barrel || 20);
    return { x: x + Math.cos(a) * d, y: y + Math.sin(a) * d };
  };

  // ---- 피해 ----
  function armorCut(target, kind) {
    if (kind === 'zone' || kind === 'burn' || kind === 'void') return 0;
    const A = ZR.Items.ARMOR;
    if (kind === 'explosion') return A.vest[target.vest] * 0.8;
    return A.helmet[target.helmet] + A.vest[target.vest];
  }

  function damage(world, target, amt, owner, wid, kind) {
    if (!target.alive || amt <= 0) return 0;
    const real = amt * (1 - armorCut(target, kind));
    const attacker = world.players.get(owner);
    if (owner === world.localId && target.id !== owner) world.damageText(target, real);
    if (attacker && attacker !== target && world.isAuth(attacker)) attacker.dmgDealt += real;
    if (!world.isAuth(target)) return real;
    target.hp -= real;
    target.hurtT = 0.12;
    target.lastHit = { owner, wid };
    if (target.hp <= 0) world.killPlayer(target, owner, wid);
    return real;
  }

  function hitPlayer(world, target, dmg, owner, wid, fx, kind) {
    if (!target.alive || !world.isFoe(owner, target)) return 0;
    const real = damage(world, target, dmg, owner, wid, kind);
    if (fx && world.isAuth(target) && target.alive) {
      if (fx.burn) target.burn = { dps: fx.burn.dps, t: fx.burn.dur, src: owner, wid };
      if (fx.slow) target.slow = { mul: fx.slow.mul, t: fx.slow.dur };
    }
    if (kind !== 'beam' || Math.random() < 0.2) sparks(world, target.x, target.y, '#c22', 4);
    return real;
  }

  function damageObs(world, o, dmg, owner) {
    if (o.dead || !Number.isFinite(o.hp)) return;
    o.hp -= dmg;
    o.hitT = 0.1;
    if (o.hp <= 0) world.destroyObstacle(o, owner, true);
  }

  function explode(world, x, y, r, dmg, owner, wid, opts = {}) {
    world.addFx({ kind: 'boom', x, y, r, t: 0, life: 0.35 + r / 500, color: opts.color || '#ffb347' });
    world.shake(x, y, r);
    const nade = ZR.W[wid]?.kind === 'throw' ? wid : null;
    ZR.Audio.play(r > 200 ? 'nuke' : 'boom', x, y, nade);
    for (const p of world.players.values()) {
      if (!p.alive || !world.isFoe(owner, p)) continue;
      const d = U.dist(x, y, p.x, p.y);
      if (d > r + p.r) continue;
      const f = 1 - U.clamp((d - p.r) / r, 0, 1) * 0.65;
      hitPlayer(world, p, dmg * f, owner, wid, opts.fx, 'explosion');
      if (opts.knock && world.isAuth(p)) {
        const a = Math.atan2(p.y - y, p.x - x);
        p.kx += Math.cos(a) * opts.knock * f;
        p.ky += Math.sin(a) * opts.knock * f;
      }
    }
    if (!world.ownsShot(owner)) return;
    for (const o of world.map.grid.query(x - r, y - r, x + r, y + r)) {
      const c = U.center(o);
      if (U.dist2(x, y, c.x, c.y) < r * r) damageObs(world, o, dmg * 1.5, owner);
    }
  }

  // ---- 광선 판정 ----
  function raycast(world, x1, y1, x2, y2, opts = {}) {
    let best = { t: 1, obs: null, player: null };
    if (!opts.ignoreWalls) {
      const near = world.map.grid.query(Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2));
      for (const o of near) {
        if (!o.blocks) continue;
        const t = obsHitT(o, x1, y1, x2, y2, 0);
        if (t >= 0 && t < best.t) best = { t, obs: o, player: null };
      }
    }
    if (opts.players !== false) {
      for (const p of world.players.values()) {
        if (!p.alive || !world.isFoe(opts.owner, p)) continue;
        const t = U.segCircle(x1, y1, x2, y2, p.x, p.y, p.r);
        if (t >= 0 && t < best.t) best = { t, obs: null, player: p };
      }
    }
    return { ...best, x: x1 + (x2 - x1) * best.t, y: y1 + (y2 - y1) * best.t };
  }

  function obsHitT(o, x1, y1, x2, y2, pad) {
    if (o.shape === 'circle') return U.segCircle(x1, y1, x2, y2, o.x, o.y, o.r + pad);
    const h = U.segRect(x1, y1, x2, y2, o.x - pad, o.y - pad, o.w + pad * 2, o.h + pad * 2);
    return h ? h.t : -1;
  }

  const hasLOS = (world, x1, y1, x2, y2) => !raycast(world, x1, y1, x2, y2, { players: false }).obs;

  // ---- 발사 ----
  function fire(world, ev) {
    const def = ZR.W[ev.w];
    if (!def || def.kind !== 'gun') return;
    const rng = U.rng(ev.s >>> 0);
    const m = muzzle(ev.x, ev.y, ev.a, def);
    ZR.Audio.play(def.sound, ev.x, ev.y, ev.w);
    world.addFx({ kind: 'flash', x: m.x, y: m.y, a: ev.a, t: 0, life: 0.06, color: def.color || '#ffd27a' });
    switch (def.type) {
      case 'rail': return rail(world, ev, def, m);
      case 'chain': return chain(world, ev, def, m);
      case 'lob': return lob(world, ev, def, m, rng);
      case 'meteor': return meteor(world, ev, def);
      default: return spawnBullets(world, ev, def, m, rng);
    }
  }

  function spawnBullets(world, ev, def, m, rng) {
    for (let i = 0; i < def.pellets; i++) {
      const a = ev.a + (rng.next() - 0.5) * def.spread;
      const sp = def.speed * (def.pellets > 1 || def.type === 'flame' ? rng.range(0.85, 1.1) : 1);
      world.projectiles.push({
        kind: def.type, owner: ev.o, wid: ev.w, x: m.x, y: m.y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: def.range / def.speed,
        dmg: def.dmg, r: def.size, fx: def.fx, bounce: def.fx.bounce || 0, hit: new Set(),
        color: def.color || ZR.Weapons.color(ev.w),
      });
    }
  }

  function clampTarget(ev, def, m) {
    const d = Math.min(def.range, U.dist(m.x, m.y, ev.tx, ev.ty));
    return { x: m.x + Math.cos(ev.a) * d, y: m.y + Math.sin(ev.a) * d };
  }

  function lob(world, ev, def, m, rng) {
    const t = clampTarget(ev, def, m);
    const dist = U.dist(m.x, m.y, t.x, t.y);
    world.projectiles.push({
      kind: 'lob', owner: ev.o, wid: ev.w, sx: m.x, sy: m.y, tx: t.x, ty: t.y, x: m.x, y: m.y,
      t: 0, dur: 0.45 + dist / 1100, fx: def.fx, seed: rng.int(1, 1e9), r: 9,
    });
  }

  function meteor(world, ev, def) {
    const t = clampTarget(ev, def, { x: ev.x, y: ev.y });
    const m = def.fx.meteor;
    world.fields.push({ kind: 'meteor', owner: ev.o, wid: ev.w, x: t.x, y: t.y, r: m.r, dmg: m.dmg, t: 0, dur: m.delay, burn: def.fx.burn });
  }

  function rail(world, ev, def, m) {
    const ex = m.x + Math.cos(ev.a) * def.range, ey = m.y + Math.sin(ev.a) * def.range;
    const end = def.fx.wallPierce ? { x: ex, y: ey } : raycast(world, m.x, m.y, ex, ey, { players: false });
    for (const p of world.players.values()) {
      if (!p.alive || !world.isFoe(ev.o, p)) continue;
      if (U.segCircle(m.x, m.y, end.x, end.y, p.x, p.y, p.r + 6) < 0) continue;
      hitPlayer(world, p, def.dmg, ev.o, ev.w, def.fx, 'bullet');
      if (def.fx.explode) explode(world, p.x, p.y, def.fx.explode.r, def.fx.explode.dmg, ev.o, ev.w, { color: def.color });
    }
    if (world.ownsShot(ev.o)) {
      const near = world.map.grid.query(Math.min(m.x, end.x), Math.min(m.y, end.y), Math.max(m.x, end.x), Math.max(m.y, end.y));
      for (const o of near) if (o.blocks && obsHitT(o, m.x, m.y, end.x, end.y, 0) >= 0) damageObs(world, o, def.dmg, ev.o);
    }
    if (def.fx.explode) explode(world, end.x, end.y, def.fx.explode.r, def.fx.explode.dmg, ev.o, ev.w, { color: def.color });
    world.addFx({ kind: 'rail', x: m.x, y: m.y, x2: end.x, y2: end.y, t: 0, life: 0.5, color: def.color });
    world.shake(m.x, m.y, 60);
  }

  function chain(world, ev, def, m) {
    const enemies = [...world.players.values()].filter((p) => p.alive && world.isFoe(ev.o, p));
    let first = null, bestD = Infinity;
    for (const p of enemies) {
      const d = U.dist(m.x, m.y, p.x, p.y);
      if (d > def.range || Math.abs(U.angleDiff(ev.a, U.angleTo(m.x, m.y, p.x, p.y))) > 0.4) continue;
      if (d < bestD && hasLOS(world, m.x, m.y, p.x, p.y)) {
        bestD = d;
        first = p;
      }
    }
    const points = [{ x: m.x, y: m.y }];
    if (!first) {
      const end = raycast(world, m.x, m.y, m.x + Math.cos(ev.a) * def.range, m.y + Math.sin(ev.a) * def.range, { players: false });
      points.push({ x: end.x, y: end.y });
    } else {
      const hit = new Set();
      let cur = first, dmg = def.dmg;
      for (let i = 0; i < def.fx.chain.n && cur; i++) {
        hit.add(cur.id);
        points.push({ x: cur.x, y: cur.y });
        hitPlayer(world, cur, dmg, ev.o, ev.w, null, 'bullet');
        dmg *= 0.85;
        const from = cur;
        cur = null;
        let nd = def.fx.chain.range;
        for (const p of enemies) {
          if (hit.has(p.id) || !p.alive) continue;
          const d = U.dist(from.x, from.y, p.x, p.y);
          if (d < nd && hasLOS(world, from.x, from.y, p.x, p.y)) {
            nd = d;
            cur = p;
          }
        }
      }
    }
    world.addFx({ kind: 'bolt', points, t: 0, life: 0.25, color: def.color });
  }

  // ---- 근접 ----
  function melee(world, ev) {
    const def = ZR.W[ev.w];
    if (!def || def.kind !== 'melee') return;
    const owner = world.players.get(ev.o);
    ZR.Audio.play('swing', ev.x, ev.y, ev.w);
    world.addFx({ kind: 'slash', x: ev.x, y: ev.y, a: ev.a, r: def.range + 22, arc: def.arc, t: 0, life: 0.18, color: def.color || '#fff' });
    if (def.dash && owner && world.isAuth(owner)) {
      owner.kx += Math.cos(ev.a) * def.dash * 5;
      owner.ky += Math.sin(ev.a) * def.dash * 5;
    }
    for (const p of world.players.values()) {
      if (!p.alive || !world.isFoe(ev.o, p)) continue;
      const d = U.dist(ev.x, ev.y, p.x, p.y) - p.r;
      if (d > def.range + 22 || Math.abs(U.angleDiff(ev.a, U.angleTo(ev.x, ev.y, p.x, p.y))) > def.arc / 2 + 0.2) continue;
      const real = hitPlayer(world, p, def.dmg, ev.o, ev.w, null, 'melee');
      if (def.lifesteal && owner && world.isAuth(owner)) owner.hp = Math.min(ZR.CONFIG.maxHp, owner.hp + real * def.lifesteal);
    }
    if (world.ownsShot(ev.o)) {
      const reach = def.range + 30;
      for (const o of world.map.grid.query(ev.x - reach, ev.y - reach, ev.x + reach, ev.y + reach)) {
        const c = U.center(o);
        const size = o.shape === 'circle' ? o.r : o.w / 2;
        if (U.dist(ev.x, ev.y, c.x, c.y) - size > reach) continue;
        if (Math.abs(U.angleDiff(ev.a, U.angleTo(ev.x, ev.y, c.x, c.y))) > def.arc / 2 + 0.4) continue;
        damageObs(world, o, def.dmg * 1.5, ev.o);
      }
    }
    if (def.shock) {
      const sx = ev.x + Math.cos(ev.a) * def.range * 0.7, sy = ev.y + Math.sin(ev.a) * def.range * 0.7;
      explode(world, sx, sy, def.shock.r, def.shock.dmg, ev.o, ev.w, { knock: def.shock.knock, color: def.color });
    }
  }

  // ---- 투척 ----
  function throwNade(world, ev) {
    const def = ZR.W[ev.w];
    if (!def || def.kind !== 'throw') return;
    const maxD = 620;
    const d = Math.min(maxD, U.dist(ev.x, ev.y, ev.tx, ev.ty));
    const a = U.angleTo(ev.x, ev.y, ev.tx, ev.ty);
    ZR.Audio.play('swing', ev.x, ev.y);
    world.projectiles.push({
      kind: 'nade', owner: ev.o, wid: ev.w, sx: ev.x, sy: ev.y,
      tx: ev.x + Math.cos(a) * d, ty: ev.y + Math.sin(a) * d, x: ev.x, y: ev.y,
      t: 0, flight: 0.3 + d / 1100, fuse: def.fuse, stuck: null, r: 8, color: def.color,
    });
  }

  function updateNade(world, pr, dt) {
    const def = ZR.W[pr.wid];
    pr.t += dt;
    if (pr.stuck) {
      const host = world.players.get(pr.stuck);
      if (host && host.alive) {
        pr.x = host.x;
        pr.y = host.y;
      }
    } else if (pr.t < pr.flight) {
      const k = pr.t / pr.flight;
      pr.x = U.lerp(pr.sx, pr.tx, k);
      pr.y = U.lerp(pr.sy, pr.ty, k);
      pr.h = Math.sin(k * Math.PI) * 40;
      if (def.sticky) {
        for (const p of world.players.values()) {
          if (p.alive && world.isFoe(pr.owner, p) && U.dist2(p.x, p.y, pr.x, pr.y) < (p.r + 10) ** 2) pr.stuck = p.id;
        }
      }
    } else {
      pr.h = 0;
    }
    if (pr.t >= pr.fuse) {
      pr.dead = true;
      if (pr.wid === 'nuke') world.addFx({ kind: 'nukeflash', x: pr.x, y: pr.y, t: 0, life: 0.9 });
      explode(world, pr.x, pr.y, def.r, def.dmg, pr.owner, pr.wid, { knock: def.knock, fx: def.fx, color: def.color });
    }
  }

  // ---- 투사체 갱신 ----
  function sweep(world, pr, x2, y2) {
    let best = null;
    const pad = pr.r * 0.5;
    const near = world.map.grid.query(Math.min(pr.x, x2) - pad, Math.min(pr.y, y2) - pad, Math.max(pr.x, x2) + pad, Math.max(pr.y, y2) + pad);
    for (const o of near) {
      if (!o.blocks) continue;
      const t = obsHitT(o, pr.x, pr.y, x2, y2, pad);
      if (t >= 0 && (!best || t < best.t)) best = { t, obs: o };
    }
    for (const p of world.players.values()) {
      if (!p.alive || !world.isFoe(pr.owner, p) || pr.hit.has(p.id)) continue;
      const t = U.segCircle(pr.x, pr.y, x2, y2, p.x, p.y, p.r + pr.r);
      if (t >= 0 && (!best || t < best.t)) best = { t, player: p };
    }
    return best;
  }

  function endProjectile(world, pr, x, y) {
    if (pr.kind === 'singularity') {
      const h = pr.fx.hole;
      world.fields.push({ kind: 'hole', owner: pr.owner, wid: pr.wid, x, y, r: h.r, dps: h.dps, pull: h.pull, t: 0, dur: h.dur });
      ZR.Audio.play('void', x, y);
      return;
    }
    if (pr.fx.explode) explode(world, x, y, pr.fx.explode.r, pr.fx.explode.dmg, pr.owner, pr.wid, { fx: pr.fx.burn ? { burn: pr.fx.burn } : null, color: pr.color });
    else sparks(world, x, y, '#ddd', 3);
  }

  function steer(world, pr, dt) {
    let target = null, bd = 520 * 520;
    const heading = Math.atan2(pr.vy, pr.vx);
    for (const p of world.players.values()) {
      if (!p.alive || !world.isFoe(pr.owner, p)) continue;
      const d = U.dist2(pr.x, pr.y, p.x, p.y);
      if (d < bd && Math.abs(U.angleDiff(heading, U.angleTo(pr.x, pr.y, p.x, p.y))) < 1.6) {
        bd = d;
        target = p;
      }
    }
    if (!target) return;
    const want = U.angleTo(pr.x, pr.y, target.x, target.y);
    const turn = U.clamp(U.angleDiff(heading, want), -pr.fx.homing * dt, pr.fx.homing * dt);
    const sp = Math.hypot(pr.vx, pr.vy);
    pr.vx = Math.cos(heading + turn) * sp;
    pr.vy = Math.sin(heading + turn) * sp;
  }

  function landLob(world, pr) {
    const e = pr.fx.explode;
    explode(world, pr.tx, pr.ty, e.r, e.dmg, pr.owner, pr.wid, { color: '#ff9f43' });
    const cl = pr.fx.cluster;
    if (!cl) return;
    const rng = U.rng(pr.seed);
    for (let i = 0; i < cl.n; i++) {
      const a = rng.range(0, U.TAU), d = rng.range(60, 150);
      world.projectiles.push({
        kind: 'lob', owner: pr.owner, wid: pr.wid, sx: pr.tx, sy: pr.ty, x: pr.tx, y: pr.ty,
        tx: pr.tx + Math.cos(a) * d, ty: pr.ty + Math.sin(a) * d, t: 0, dur: rng.range(0.35, 0.6),
        fx: { explode: { r: cl.r, dmg: cl.dmg } }, r: 5,
      });
    }
  }

  function stepBullet(world, pr, dt) {
    if (pr.kind === 'homing') steer(world, pr, dt);
    if (pr.kind === 'flame') {
      const drag = Math.max(0, 1 - 1.6 * dt);
      pr.vx *= drag;
      pr.vy *= drag;
      pr.r += 20 * dt;
    }
    const nx = pr.x + pr.vx * dt, ny = pr.y + pr.vy * dt;
    const hit = sweep(world, pr, nx, ny);
    if (!hit) {
      pr.x = nx;
      pr.y = ny;
    } else {
      const hx = pr.x + (nx - pr.x) * hit.t, hy = pr.y + (ny - pr.y) * hit.t;
      if (hit.player) onPlayerHit(world, pr, hit.player, hx, hy, nx, ny);
      else onObsHit(world, pr, hit.obs, hx, hy);
    }
    pr.life -= dt;
    if (!pr.dead && pr.life <= 0) {
      pr.dead = true;
      if (pr.kind !== 'flame') endProjectile(world, pr, pr.x, pr.y);
    }
  }

  function onPlayerHit(world, pr, p, hx, hy, nx, ny) {
    if (pr.kind !== 'singularity') hitPlayer(world, p, pr.dmg, pr.owner, pr.wid, pr.fx, 'bullet');
    if (pr.kind === 'flame') {
      pr.hit.add(p.id);
      pr.x = nx;
      pr.y = ny;
      return;
    }
    pr.dead = true;
    endProjectile(world, pr, hx, hy);
  }

  function onObsHit(world, pr, o, hx, hy) {
    if (world.ownsShot(pr.owner)) damageObs(world, o, pr.dmg * (pr.kind === 'flame' ? 0.4 : 1), pr.owner);
    if (pr.bounce > 0) {
      const n = obsNormal(o, hx, hy);
      const dot = pr.vx * n.x + pr.vy * n.y;
      pr.vx -= 2 * dot * n.x;
      pr.vy -= 2 * dot * n.y;
      pr.x = hx + n.x * 3;
      pr.y = hy + n.y * 3;
      pr.bounce--;
      pr.hit.clear();
      sparks(world, hx, hy, pr.color, 3);
      return;
    }
    pr.dead = true;
    endProjectile(world, pr, hx, hy);
  }

  function obsNormal(o, hx, hy) {
    if (o.shape === 'circle') {
      const d = U.dist(o.x, o.y, hx, hy) || 1;
      return { x: (hx - o.x) / d, y: (hy - o.y) / d };
    }
    const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
    const dx = (hx - cx) / (o.w / 2), dy = (hy - cy) / (o.h / 2);
    return Math.abs(dx) > Math.abs(dy) ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) };
  }

  function updateProjectiles(world, dt) {
    const keep = [];
    for (const pr of world.projectiles) {
      if (pr.kind === 'lob') {
        pr.t += dt;
        const k = Math.min(1, pr.t / pr.dur);
        pr.x = U.lerp(pr.sx, pr.tx, k);
        pr.y = U.lerp(pr.sy, pr.ty, k);
        pr.h = Math.sin(k * Math.PI) * 90;
        if (pr.t >= pr.dur) landLob(world, pr);
        else keep.push(pr);
        continue;
      }
      if (pr.kind === 'nade') updateNade(world, pr, dt);
      else stepBullet(world, pr, dt);
      if (!pr.dead) keep.push(pr);
    }
    world.projectiles = keep; // 순회 중 추가된 자탄도 for-of가 함께 처리해 keep에 들어간다
  }

  // ---- 장판 (블랙홀, 유성, 불바다) ----
  function updateFields(world, dt) {
    const keep = [];
    for (const f of world.fields) {
      f.t += dt;
      if (f.kind === 'hole') holeTick(world, f, dt);
      else if (f.kind === 'fire') fireTick(world, f);
      else if (f.kind === 'meteor' && f.t >= f.dur) {
        explode(world, f.x, f.y, f.r, f.dmg, f.owner, f.wid, { fx: f.burn ? { burn: f.burn } : null, color: '#ff5a1f', knock: 400 });
        if (f.burn) keep.push({ kind: 'fire', owner: f.owner, wid: f.wid, x: f.x, y: f.y, r: f.r * 0.6, burn: f.burn, t: 0, dur: 3 });
        continue;
      }
      if (f.t < f.dur) keep.push(f);
      else if (f.kind === 'hole') explode(world, f.x, f.y, f.r * 0.45, 35, f.owner, f.wid, { color: '#a26bff', knock: 600 });
    }
    world.fields = keep;
  }

  function holeTick(world, f, dt) {
    for (const p of world.players.values()) {
      if (!p.alive || !world.isFoe(f.owner, p)) continue;
      const d = U.dist(p.x, p.y, f.x, f.y);
      if (d > f.r) continue;
      if (world.isAuth(p)) {
        const k = f.pull * (1 - (d / f.r) * 0.5) * dt;
        const pos = world.resolveCircle(p.x + ((f.x - p.x) / (d || 1)) * Math.min(k, d), p.y + ((f.y - p.y) / (d || 1)) * Math.min(k, d), p.r);
        p.x = pos.x;
        p.y = pos.y;
      }
      damage(world, p, f.dps * dt, f.owner, f.wid, 'void');
    }
    for (const pr of world.projectiles) {
      if (pr.kind !== 'nade' && pr.kind !== 'lob' && U.dist2(pr.x, pr.y, f.x, f.y) < f.r * f.r) {
        pr.vx += (f.x - pr.x) * 4 * dt;
        pr.vy += (f.y - pr.y) * 4 * dt;
      }
    }
    if (world.ownsShot(f.owner)) {
      for (const o of world.map.grid.query(f.x - f.r * 0.5, f.y - f.r * 0.5, f.x + f.r * 0.5, f.y + f.r * 0.5)) damageObs(world, o, f.dps * dt * 2, f.owner);
    }
  }

  function fireTick(world, f) {
    for (const p of world.players.values()) {
      if (!p.alive || !world.isAuth(p) || !world.isFoe(f.owner, p)) continue;
      if (U.dist2(p.x, p.y, f.x, f.y) < (f.r + p.r) ** 2) p.burn = { dps: f.burn.dps, t: 1, src: f.owner, wid: f.wid };
    }
  }

  // ---- 지속 광선 ----
  function beamTick(world, p, dt) {
    const def = p.weapon;
    if (!p.alive || !p.beamOn || !def || def.type !== 'beam') {
      p.beamSegs = null;
      return;
    }
    const m = muzzle(p.x, p.y, p.angle, def);
    const n = def.beams || 1;
    const segs = [];
    for (let i = 0; i < n; i++) {
      const a = p.angle + (n > 1 ? (i - (n - 1) / 2) * def.beamSpread : 0);
      const ray = raycast(world, m.x, m.y, m.x + Math.cos(a) * def.range, m.y + Math.sin(a) * def.range, { owner: p.id });
      segs.push({ x1: m.x, y1: m.y, x2: ray.x, y2: ray.y });
      if (ray.player) hitPlayer(world, ray.player, def.dps * dt, p.id, p.wid, def.fx, 'beam');
      else if (ray.obs && world.ownsShot(p.id)) damageObs(world, ray.obs, def.dps * dt, p.id);
    }
    p.beamSegs = segs;
    p.beamSoundT = (p.beamSoundT || 0) - dt;
    if (p.beamSoundT <= 0) {
      p.beamSoundT = 0.12;
      ZR.Audio.play('beam', p.x, p.y, p.wid);
    }
  }

  function sparks(world, x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * U.TAU, s = 60 + Math.random() * 160;
      world.addFx({ kind: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0, life: 0.25 + Math.random() * 0.2, color });
    }
  }

  ZR.Combat = Object.freeze({
    fire, melee, throwNade, updateProjectiles, updateFields, beamTick, damage, hitPlayer, explode, damageObs, raycast, hasLOS, sparks, weaponName,
  });
})(typeof window !== 'undefined' ? window : globalThis);
