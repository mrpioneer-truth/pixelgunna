'use strict';
// 플레이어 상태와 행동: 이동, 슬롯 전환, 사격 판정, 재장전, 회복, 줍기.
(function (root) {
  const ZR = (root.ZR = root.ZR || {});
  const U = ZR.U;
  const C = ZR.CONFIG;

  const SWITCH_DELAY = 0.18;
  const SEMI_BUFFER = 0.15;
  const KNOCK_DECAY = 5;
  const PICK_RANGE = 30;
  const REMOTE_LERP = 14;
  const TELEPORT_SNAP = 600;

  const emptyInput = () => ({ mx: 0, my: 0, ax: 0, ay: 0, fire: false, reload: false, slot: -1, heal: null, pickup: false, cycle: 0 });

  class Player {
    constructor(id, name, color, x, y, isBot = false) {
      Object.assign(this, { id, name, color, x, y, isBot });
      this.skin = 'default';
      this.skinTag = '';
      this.r = C.playerRadius;
      this.hp = C.maxHp;
      this.boost = 0;
      this.alive = true;
      this.angle = 0;
      this.slots = [null, null, { wid: 'fists' }, null];
      this.cur = 2;
      this.prevSlot = 2;
      this.ammo = { light: 0, heavy: 0, shell: 0, cell: 0, rocket: 0 };
      this.heals = { bandage: 0, medkit: 0, soda: 0, pills: 0 };
      this.throws = {};
      this.helmet = 0;
      this.vest = 0;
      this.pack = 0;
      this.scope = 1;
      this.fireCd = 0;
      this.semiQueue = 0;
      this.reloadT = 0;
      this.reloadDur = 0;
      this.action = null;
      this.spin = 0;
      this.charge = 0;
      this.beamOn = false;
      this.beamAcc = 0;
      this.beamSegs = null;
      this.swingT = 0;
      this.swingSide = 1;
      this.prevFire = false;
      this.burn = null;
      this.slow = null;
      this.kx = 0;
      this.ky = 0;
      this.hurtT = 0;
      this.kills = 0;
      this.dmgDealt = 0;
      this.rank = 0;
      this.lastHit = null;
      this.input = emptyInput();
      this.remote = false;
      this.target = null;
      this.team = null;
      this.underLink = null;
      this.linkCd = 0;
    }
    get slot() { return this.slots[this.cur]; }
    get wid() { return this.slot ? this.slot.wid : 'fists'; }
    get weapon() { return ZR.W[this.wid]; }
  }

  function update(world, p, dt) {
    if (!p.alive) return;
    const inp = p.input;
    const edge = inp.fire && !p.prevFire;
    p.prevFire = inp.fire;
    tickEffects(world, p, dt);
    if (!p.alive) return;
    if (inp.slot >= 0) switchSlot(p, inp.slot);
    if (inp.cycle) cycleSlot(p, inp.cycle);
    if (inp.heal) startHeal(p, inp.heal);
    if (inp.reload) startReload(p);
    updateAction(p, dt);
    updateReload(p, dt);
    p.angle = Math.atan2(inp.ay - p.y, inp.ax - p.x);
    handleFire(world, p, dt, edge);
    move(world, p, dt);
    autoPickup(world, p);
    if (inp.pickup) {
      // 사람은 가까운 무기를 고르고 봇은 목표로 정한 무기만 집는다.
      const it = typeof inp.pickup === 'string'
        ? world.loot.get(inp.pickup)
        : nearestLoot(world, p, true);
      if (it && U.dist2(p.x, p.y, it.x, it.y) < (p.r + PICK_RANGE + 10) ** 2) world.requestPickup(p, it);
      else if (inp.pickup === true) world.useLink(p);
    }
    inp.slot = -1;
    inp.heal = null;
    inp.reload = false;
    inp.pickup = false;
    inp.cycle = 0;
  }

  // 원격 플레이어: 받은 위치로 부드럽게 따라간다
  function updateRemote(world, p, dt) {
    if (!p.target) return;
    // 해치를 타고 순간이동한 경우에는 미끄러지지 않고 바로 옮긴다
    if (U.dist2(p.x, p.y, p.target.x, p.target.y) > TELEPORT_SNAP * TELEPORT_SNAP) {
      p.x = p.target.x;
      p.y = p.target.y;
    }
    const k = 1 - Math.exp(-REMOTE_LERP * dt);
    p.x += (p.target.x - p.x) * k;
    p.y += (p.target.y - p.y) * k;
    p.angle += U.angleDiff(p.angle, p.target.a) * k;
    if (p.swingT > 0) p.swingT -= dt;
    if (p.hurtT > 0) p.hurtT -= dt;
  }

  function tickEffects(world, p, dt) {
    p.fireCd = Math.max(0, p.fireCd - dt);
    p.semiQueue -= dt;
    if (p.hurtT > 0) p.hurtT -= dt;
    if (p.swingT > 0) p.swingT -= dt;
    if (p.burn) {
      const b = p.burn;
      b.t -= dt;
      if (b.t <= 0) p.burn = null;
      ZR.Combat.damage(world, p, b.dps * dt, b.src, b.wid, 'burn');
    }
    if (p.slow && (p.slow.t -= dt) <= 0) p.slow = null;
    if (p.boost > 0) {
      p.boost = Math.max(0, p.boost - 2 * dt);
      if (p.hp < C.maxHp) p.hp = Math.min(C.maxHp, p.hp + (p.boost > 50 ? 2.4 : 1.2) * dt);
    }
  }

  function canHold(p, i) {
    if (i < 0 || i > 3 || !p.slots[i]) return false;
    return i !== 3 || (p.throws[p.slots[3].wid] || 0) > 0;
  }

  function switchSlot(p, i) {
    if (i === p.cur || !canHold(p, i)) return;
    p.prevSlot = p.cur;
    p.cur = i;
    p.reloadT = 0;
    p.spin = 0;
    p.charge = 0;
    p.beamOn = false;
    p.fireCd = Math.max(p.fireCd, SWITCH_DELAY);
  }

  function cycleSlot(p, dir) {
    for (let k = 1; k <= 4; k++) {
      const i = (p.cur + dir * k + 8) % 4;
      if (canHold(p, i)) return switchSlot(p, i);
    }
    return undefined;
  }

  function startHeal(p, key) {
    const def = ZR.Items.HEALS[key];
    if (!def || p.action || !p.heals[key]) return;
    if (def.heal && p.hp >= def.cap) return;
    if (def.boost && p.boost >= 100) return;
    p.action = { key, t: 0, dur: def.dur };
    p.reloadT = 0;
  }

  function updateAction(p, dt) {
    if (!p.action) return;
    p.action.t += dt;
    if (p.action.t < p.action.dur) return;
    const key = p.action.key, def = ZR.Items.HEALS[key];
    p.action = null;
    if (!p.heals[key]) return;
    p.heals[key]--;
    if (def.heal) p.hp = Math.max(p.hp, Math.min(def.cap, p.hp + def.heal));
    if (def.boost) p.boost = Math.min(100, p.boost + def.boost);
  }

  function startReload(p) {
    const slot = p.slot, def = p.weapon;
    if (!slot || def.kind !== 'gun' || p.reloadT > 0) return;
    if (slot.mag >= def.mag || p.ammo[def.ammo] <= 0) return;
    p.reloadT = p.reloadDur = def.reload;
    p.action = null;
    p.charge = 0;
    ZR.Audio.play('reload', p.x, p.y);
  }

  function updateReload(p, dt) {
    if (p.reloadT <= 0) return;
    p.reloadT -= dt;
    if (p.reloadT > 0) return;
    p.reloadT = 0;
    const slot = p.slot, def = p.weapon;
    if (!slot || def.kind !== 'gun') return;
    const take = Math.min(def.mag - slot.mag, p.ammo[def.ammo]);
    slot.mag += take;
    p.ammo[def.ammo] -= take;
  }

  function handleFire(world, p, dt, edge) {
    const slot = p.slot;
    p.beamOn = false;
    if (!slot) return;
    const def = ZR.W[slot.wid];
    const inp = p.input;
    if (def.kind === 'melee') {
      if (inp.fire && p.fireCd <= 0 && !p.action) {
        p.fireCd = def.delay;
        p.swingT = 0.22;
        p.swingSide = -p.swingSide;
        world.emitMelee(p);
      }
      return;
    }
    if (def.kind === 'throw') {
      fireThrow(world, p, slot, edge);
      return;
    }
    fireGun(world, p, slot, def, dt, edge);
  }

  function fireThrow(world, p, slot, edge) {
    if (!edge || p.fireCd > 0 || p.action || !(p.throws[slot.wid] > 0)) return;
    p.throws[slot.wid]--;
    p.fireCd = 0.6;
    p.swingT = 0.25;
    world.emitThrow(p, slot.wid);
    if (p.throws[slot.wid] > 0) return;
    const other = Object.keys(p.throws).find((k) => p.throws[k] > 0);
    if (other) p.slots[3] = { wid: other };
    else {
      p.slots[3] = null;
      switchSlot(p, canHold(p, p.prevSlot) ? p.prevSlot : 2);
    }
  }

  function fireGun(world, p, slot, def, dt, edge) {
    const inp = p.input;
    if (edge) p.semiQueue = SEMI_BUFFER;
    const spinDown = () => { p.spin = Math.max(0, p.spin - dt / (def.spinUp || 1)); };
    if (p.reloadT > 0) return spinDown();
    if (slot.mag <= 0) {
      p.charge = 0;
      spinDown();
      if (inp.fire) startReload(p);
      return undefined;
    }
    if (p.action) {
      if (!edge) return undefined;
      p.action = null;
    }
    if (def.type === 'beam') {
      if (!inp.fire) return undefined;
      p.beamOn = true;
      p.beamAcc += def.ammoPerSec * dt;
      while (p.beamAcc >= 1 && slot.mag > 0) {
        slot.mag--;
        p.beamAcc--;
      }
      if (slot.mag <= 0) startReload(p);
      return undefined;
    }
    if (def.spinUp) {
      if (!inp.fire) return spinDown();
      p.spin = Math.min(1, p.spin + dt / def.spinUp);
      if (p.spin < 1) return undefined;
    }
    if (def.charge) {
      if (!inp.fire || p.fireCd > 0) {
        p.charge = 0;
        return undefined;
      }
      p.charge += dt;
      if (p.charge >= def.charge) {
        p.charge = 0;
        shoot(world, p, slot, def);
      }
      return undefined;
    }
    const want = def.auto ? inp.fire : p.semiQueue > 0;
    if (want && p.fireCd <= 0) {
      p.semiQueue = 0;
      shoot(world, p, slot, def);
    }
    return undefined;
  }

  function shoot(world, p, slot, def) {
    slot.mag--;
    p.fireCd = def.fireDelay;
    world.emitShot(p, slot.wid);
    if (slot.mag <= 0) startReload(p);
  }

  function speedOf(p) {
    const def = p.weapon;
    let sp = C.playerSpeed * (def ? def.moveMul : 1);
    if (p.slow) sp *= p.slow.mul;
    if (p.action) sp *= 0.55;
    if (p.boost >= 50) sp *= 1.08;
    if (def && def.spinUp && p.spin > 0) sp *= 0.85;
    if (p.charge > 0) sp *= 0.6;
    return sp;
  }

  function move(world, p, dt) {
    let { mx, my } = p.input;
    const len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }
    const sp = speedOf(p);
    const decay = Math.exp(-KNOCK_DECAY * dt);
    const nx = p.x + (mx * sp + p.kx) * dt;
    const ny = p.y + (my * sp + p.ky) * dt;
    p.kx *= decay;
    p.ky *= decay;
    const pos = world.resolveCircle(nx, ny, p.r);
    p.x = pos.x;
    p.y = pos.y;
  }

  // ---- 줍기 ----
  function canAutoPick(p, it) {
    const pack = p.pack;
    switch (it.type) {
      case 'ammo': return p.ammo[it.key] < ZR.Weapons.AMMO[it.key].max[pack];
      case 'heal': return p.heals[it.key] < ZR.Items.HEALS[it.key].max[pack];
      case 'armor': return it.level > p[it.key];
      case 'pack': return it.level > p.pack;
      case 'scope': return it.level > p.scope;
      case 'throw': return (p.throws[it.key] || 0) < ZR.Items.THROW_MAX[pack];
      case 'gun': return (!p.slots[0] || !p.slots[1]) && !p.slots.some((s) => s && s.wid === it.key);
      case 'melee': return p.slots[2].wid === 'fists';
      default: return false;
    }
  }

  function autoPickup(world, p) {
    const r = p.r + PICK_RANGE;
    for (const it of world.lootNear(p.x, p.y, r)) {
      if (U.dist2(p.x, p.y, it.x, it.y) > r * r) continue;
      if (canAutoPick(p, it)) world.requestPickup(p, it);
    }
  }

  function nearestLoot(world, p, manual) {
    const r = p.r + PICK_RANGE + 10;
    let best = null, bd = r * r;
    for (const it of world.lootNear(p.x, p.y, r)) {
      if (manual && it.type !== 'gun' && it.type !== 'melee') continue;
      const d = U.dist2(p.x, p.y, it.x, it.y);
      if (d < bd) {
        bd = d;
        best = it;
      }
    }
    return best;
  }

  // 아이템을 적용하고, 대신 바닥에 떨어뜨릴 아이템 목록을 돌려준다
  function applyPickup(p, it) {
    const pack = p.pack;
    const fillUp = (bag, key, count, max) => {
      const add = Math.max(0, Math.min(count, max - (bag[key] || 0)));
      bag[key] = (bag[key] || 0) + add;
      return count - add;
    };
    switch (it.type) {
      case 'gun': return pickGun(p, it.key);
      case 'melee': {
        const old = p.slots[2].wid;
        p.slots[2] = { wid: it.key };
        return old === 'fists' ? [] : [{ type: 'melee', key: old }];
      }
      case 'throw': {
        const left = fillUp(p.throws, it.key, it.count, ZR.Items.THROW_MAX[pack]);
        if (!p.slots[3] || !(p.throws[p.slots[3].wid] > 0)) p.slots[3] = { wid: it.key };
        return left > 0 ? [{ type: 'throw', key: it.key, count: left }] : [];
      }
      case 'ammo': {
        const left = fillUp(p.ammo, it.key, it.count, ZR.Weapons.AMMO[it.key].max[pack]);
        return left > 0 ? [{ type: 'ammo', key: it.key, count: left }] : [];
      }
      case 'heal': {
        const left = fillUp(p.heals, it.key, it.count, ZR.Items.HEALS[it.key].max[pack]);
        return left > 0 ? [{ type: 'heal', key: it.key, count: left }] : [];
      }
      case 'armor': {
        const old = p[it.key];
        p[it.key] = it.level;
        return old > 0 ? [{ type: 'armor', key: it.key, level: old }] : [];
      }
      case 'pack': {
        const old = p.pack;
        p.pack = it.level;
        return old > 0 ? [{ type: 'pack', key: 'pack', level: old }] : [];
      }
      case 'scope':
        p.scope = Math.max(p.scope, it.level);
        return [];
      default:
        return [];
    }
  }

  function pickGun(p, wid) {
    let idx = !p.slots[0] ? 0 : !p.slots[1] ? 1 : (p.cur <= 1 ? p.cur : 0);
    const dropped = [];
    const old = p.slots[idx];
    if (old) {
      const oldDef = ZR.W[old.wid];
      p.ammo[oldDef.ammo] += old.mag;
      dropped.push({ type: 'gun', key: old.wid });
    }
    p.slots[idx] = { wid, mag: ZR.W[wid].mag };
    if (p.cur > 1 || old) {
      p.cur = -1;
      switchSlot(p, idx);
    }
    return dropped;
  }

  function deathItems(p) {
    const items = [];
    for (const i of [0, 1]) if (p.slots[i]) items.push({ type: 'gun', key: p.slots[i].wid });
    if (p.slots[2].wid !== 'fists') items.push({ type: 'melee', key: p.slots[2].wid });
    for (const [key, n] of Object.entries(p.throws)) if (n > 0) items.push({ type: 'throw', key, count: n });
    for (const i of [0, 1]) if (p.slots[i]) p.ammo[ZR.W[p.slots[i].wid].ammo] += p.slots[i].mag;
    for (const [key, n] of Object.entries(p.ammo)) if (n > 0) items.push({ type: 'ammo', key, count: n });
    for (const [key, n] of Object.entries(p.heals)) if (n > 0) items.push({ type: 'heal', key, count: n });
    if (p.helmet) items.push({ type: 'armor', key: 'helmet', level: p.helmet });
    if (p.vest) items.push({ type: 'armor', key: 'vest', level: p.vest });
    if (p.pack) items.push({ type: 'pack', key: 'pack', level: p.pack });
    if (p.scope > 1) items.push({ type: 'scope', key: 'scope', level: p.scope });
    return items;
  }

  function giveGun(p, wid, slotIdx) {
    p.slots[slotIdx] = { wid, mag: ZR.W[wid].mag };
  }

  ZR.Player = Player;
  ZR.PlayerSys = Object.freeze({
    update, updateRemote, applyPickup, canAutoPick, nearestLoot, deathItems, startReload, switchSlot, giveGun, emptyInput,
  });
})(typeof window !== 'undefined' ? window : globalThis);
