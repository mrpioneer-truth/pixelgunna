'use strict';
// 경기 한 판의 상태. 솔로(모두 이 브라우저가 계산)와 온라인(내 캐릭터만 계산) 공통.
(function (root) {
  const ZR = (root.ZR = root.ZR || {});
  const U = ZR.U;

  const FX_CAP = 700;
  const FEED_LIFE = 6;
  const TEXT_MERGE = 0.3;
  const SPAWN_GAP = 380;
  const LINK_RANGE = 52;
  const LOOT_CELL = 160;
  const lootCell = (x, y) => Math.floor(x / LOOT_CELL) + ',' + Math.floor(y / LOOT_CELL);

  class World {
    /**
     * @param {{seed:number, mode:'solo'|'online'|'range', localId:string, hooks?:object}} opts
     */
    constructor({ seed, mode, localId, hooks = {} }) {
      this.seed = seed >>> 0;
      this.mode = mode;
      this.localId = localId;
      this.hooks = hooks;
      this.map = ZR.MapGen.generate(this.seed);
      this.size = this.map.size;
      this.zone = new ZR.Zone(this.seed, this.size, mode === 'range');
      this.airdrops = this.zone.airdrops(this.seed);
      this.zoneState = this.zone.state(0);
      this.players = new Map();
      this.projectiles = [];
      this.fields = [];
      this.fx = [];
      this.texts = [];
      this.feed = [];
      this.loot = new Map();
      this.lootCells = new Map();
      this.lootOrder = 0;
      this.taken = new Set();
      this.addLoot(this.map.loot);
      this.destroyedIds = new Map();
      this.pending = new Set();
      this.time = 0;
      this.dropSeq = 0;
      this.shakeAmt = 0;
      this.ownedBots = new Set();
    }

    get local() { return this.players.get(this.localId) || null; }
    get online() { return this.mode === 'online'; }
    // 이 브라우저가 계산하는 캐릭터인가: 솔로는 전부, 온라인은 나 + 내가(방장) 돌리는 봇
    isAuth(p) { return !this.online || p.id === this.localId || this.ownedBots.has(p.id); }
    ownsShot(owner) { return !this.online || owner === this.localId || this.ownedBots.has(owner); }

    addPlayer(p) { this.players.set(p.id, p); return p; }
    aliveCount() { let n = 0; for (const p of this.players.values()) if (p.alive) n++; return n; }

    // 팀 출발 기준점: 다른 플레이어 위치와 무관하게 시드만으로 정해져 모든 접속자가 같은 값을 얻는다
    teamBase(team) {
      return ZR.MapGen.findSpawn(this.map, U.rng((this.seed ^ U.hashStr(`team${team}#0`)) >>> 0), null);
    }

    // 다른 플레이어와 떨어진 출발 지점 (같은 key면 같은 결과)
    spawnPoint(key) {
      let pos = null;
      for (let i = 0; i < 20; i++) {
        pos = ZR.MapGen.findSpawn(this.map, U.rng((this.seed ^ U.hashStr(`${key}#${i}`)) >>> 0), null);
        const crowded = [...this.players.values()].some((p) => U.dist2(p.x, p.y, pos.x, pos.y) < SPAWN_GAP * SPAWN_GAP);
        if (!crowded) return pos;
      }
      return pos;
    }

    resolveCircle(x, y, r) {
      let px = x, py = y;
      for (let iter = 0; iter < 2; iter++) {
        for (const o of this.map.grid.query(px - r - 4, py - r - 4, px + r + 4, py + r + 4)) {
          if (!o.solid) continue;
          const out = o.shape === 'circle'
            ? U.pushCircleCircle(px, py, r, o.x, o.y, o.r)
            : U.pushCircleRect(px, py, r, o.x, o.y, o.w, o.h);
          if (out) {
            px = out.x;
            py = out.y;
          }
        }
      }
      if (this.isUnder(px)) {
        const R = this.map.under;
        return { x: U.clamp(px, R.x + r, R.x + R.w - r), y: U.clamp(py, R.y + r, R.y + R.h - r) };
      }
      return { x: U.clamp(px, r, this.size - r), y: U.clamp(py, r, this.size - r) };
    }

    // ---- 지하 벙커 ----
    isUnder(x) { return ZR.MapGen.isUnder(this.map, x); }

    // 지하에 있으면 내려온 해치 위치 기준으로 자기장 피해를 판정한다
    zonePoint(p) {
      if (!this.isUnder(p.x)) return p;
      const link = this.map.links[p.underLink || 0];
      return link ? { x: link.hx, y: link.hy } : p;
    }

    nearLink(p) {
      const under = this.isUnder(p.x);
      for (let i = 0; i < this.map.links.length; i++) {
        const l = this.map.links[i];
        const x = under ? l.sx : l.hx, y = under ? l.sy : l.hy;
        if (U.dist2(p.x, p.y, x, y) < LINK_RANGE * LINK_RANGE) return { index: i, link: l, up: under };
      }
      return null;
    }

    useLink(p) {
      const near = this.nearLink(p);
      if (!near || p.isBot || (p.linkCd || 0) > this.time) return false;
      const { link, up, index } = near;
      const to = up ? { x: link.hx + 60, y: link.hy } : { x: link.sx + 60, y: link.sy };
      const pos = this.resolveCircle(to.x, to.y, p.r);
      p.x = pos.x;
      p.y = pos.y;
      p.kx = 0;
      p.ky = 0;
      p.underLink = up ? null : index;
      p.linkCd = this.time + 1;
      ZR.Audio.play('thump', p.x, p.y);
      if (p.id === this.localId && this.hooks.onBanner) {
        this.hooks.onBanner(up ? '지상으로 올라왔습니다' : '🔦 비밀 지하 벙커! 강한 무기가 숨겨져 있습니다. 자기장은 해치 위치 기준으로 들어옵니다', 3.5);
      }
      return true;
    }

    // ---- 팀 ----
    teamKey(p) { return p.team != null ? `t${p.team}` : p.id; }

    // owner가 쏜 공격이 p에게 피해를 주는가 (자기 자신·같은 팀 제외)
    isFoe(ownerId, p) {
      if (!p || p.id === ownerId) return false;
      const o = this.players.get(ownerId);
      return !(o && o.team != null && o.team === p.team);
    }

    aliveTeams() {
      const s = new Set();
      for (const p of this.players.values()) if (p.alive) s.add(this.teamKey(p));
      return s;
    }

    teamCount() {
      return new Set([...this.players.values()].map((p) => this.teamKey(p))).size;
    }

    teammates(p) {
      if (p.team == null) return [];
      return [...this.players.values()].filter((q) => q !== p && q.team === p.team);
    }

    update(dt) {
      this.time += dt;
      const z = (this.zoneState = this.zone.state(this.time));
      for (const p of this.players.values()) {
        if (!p.alive) continue;
        if (this.isAuth(p)) {
          if (p.isBot) ZR.Bots.update(this, p, dt);
          ZR.PlayerSys.update(this, p, dt);
          const zp = this.zonePoint(p);
          if (p.alive && z.dps > 0 && U.dist2(zp.x, zp.y, z.x, z.y) > z.r * z.r) {
            ZR.Combat.damage(this, p, z.dps * dt, 'zone', 'zone', 'zone');
          }
        } else {
          ZR.PlayerSys.updateRemote(this, p, dt);
        }
        ZR.Combat.beamTick(this, p, dt);
      }
      ZR.Combat.updateProjectiles(this, dt);
      ZR.Combat.updateFields(this, dt);
      this.updateAirdrops();
      this.tickVisuals(dt);
      ZR.Bots.recordPositions(this);
      if (this.mode === 'range') this.respawnDummies();
    }

    tickVisuals(dt) {
      for (const f of this.fx) {
        f.t += dt;
        if (f.vx) {
          f.x += f.vx * dt;
          f.y += f.vy * dt;
        }
      }
      this.fx = this.fx.filter((f) => f.t < f.life);
      for (const t of this.texts) t.t += dt;
      this.texts = this.texts.filter((t) => t.t < t.life);
      this.feed = this.feed.filter((f) => this.time - f.t < FEED_LIFE);
      for (const o of this.map.obstacles) if (o.hitT > 0) o.hitT -= dt;
      this.shakeAmt = Math.max(0, this.shakeAmt - dt * 40);
    }

    // ---- 발사 이벤트: 내가 쏘면 시뮬레이션 + (온라인이면) 전송 ----
    emitShot(p, wid) {
      const ev = { k: 'shot', o: p.id, w: wid, x: Math.round(p.x), y: Math.round(p.y), a: +p.angle.toFixed(3), tx: Math.round(p.input.ax), ty: Math.round(p.input.ay), s: U.randSeed() };
      ZR.Combat.fire(this, ev);
      if (this.online && this.isAuth(p) && this.hooks.onEvent) this.hooks.onEvent(ev);
    }

    emitMelee(p) {
      const ev = { k: 'melee', o: p.id, w: p.wid, x: Math.round(p.x), y: Math.round(p.y), a: +p.angle.toFixed(3) };
      ZR.Combat.melee(this, ev);
      if (this.online && this.isAuth(p) && this.hooks.onEvent) this.hooks.onEvent(ev);
    }

    emitThrow(p, wid) {
      const ev = { k: 'throw', o: p.id, w: wid, x: Math.round(p.x), y: Math.round(p.y), tx: Math.round(p.input.ax), ty: Math.round(p.input.ay) };
      ZR.Combat.throwNade(this, ev);
      if (this.online && this.isAuth(p) && this.hooks.onEvent) this.hooks.onEvent(ev);
    }

    // 다른 접속자의 공격 이벤트 재생
    playRemoteAttack(ev) {
      const p = this.players.get(ev.o);
      // 내가 계산한 캐릭터(나·내 봇)의 공격은 이미 재생했다
      if (ev.o === this.localId || (p && this.isAuth(p))) return;
      if (p) {
        if (ev.k === 'melee') p.swingT = 0.22;
        if (ev.k === 'throw') p.swingT = 0.25;
      }
      if (ev.k === 'shot') ZR.Combat.fire(this, ev);
      else if (ev.k === 'melee') ZR.Combat.melee(this, ev);
      else if (ev.k === 'throw') ZR.Combat.throwNade(this, ev);
    }

    // ---- 전리품 ----
    addLoot(items) {
      for (const it of items) {
        if (this.taken.has(it.id)) continue;
        const old = this.loot.get(it.id);
        const order = old ? this.removeFromLootCell(old) : this.lootOrder++;
        const key = lootCell(it.x, it.y);
        if (!this.lootCells.has(key)) this.lootCells.set(key, new Map());
        this.lootCells.get(key).set(it.id, { item: it, order });
        this.loot.set(it.id, it);
      }
    }

    removeFromLootCell(it) {
      const key = lootCell(it.x, it.y);
      const cell = this.lootCells.get(key);
      const { order } = cell.get(it.id);
      cell.delete(it.id);
      if (!cell.size) this.lootCells.delete(key);
      return order;
    }

    lootNear(x, y, r) {
      const minX = x - r, minY = y - r, maxX = x + r, maxY = y + r;
      const matches = [];
      for (let cy = Math.floor(minY / LOOT_CELL); cy <= Math.floor(maxY / LOOT_CELL); cy++) {
        for (let cx = Math.floor(minX / LOOT_CELL); cx <= Math.floor(maxX / LOOT_CELL); cx++) {
          const cell = this.lootCells.get(cx + ',' + cy);
          if (!cell) continue;
          for (const entry of cell.values()) {
            const it = entry.item;
            if (it.x >= minX && it.x <= maxX && it.y >= minY && it.y <= maxY) matches.push(entry);
          }
        }
      }
      // 같은 위치의 전리품에 기존 맵 순서대로 우선권을 준다.
      return matches.sort((a, b) => a.order - b.order).map((entry) => entry.item);
    }

    markTaken(id) {
      this.taken.add(id);
      const it = this.loot.get(id);
      if (it) this.removeFromLootCell(it);
      this.loot.delete(id);
    }

    requestPickup(p, item) {
      if (!this.loot.has(item.id) || this.pending.has(item.id)) return;
      if (!this.online) {
        this.markTaken(item.id);
        this.finishPickup(p, item);
        return;
      }
      this.pending.add(item.id);
      Promise.resolve(this.hooks.claim(item.id))
        .then((ok) => {
          this.pending.delete(item.id);
          if (!ok || !p.alive) return;
          this.markTaken(item.id);
          this.finishPickup(p, item);
        })
        .catch((err) => {
          this.pending.delete(item.id);
          ZR.log('줍기 실패', err);
        });
    }

    finishPickup(p, item) {
      const dropped = ZR.PlayerSys.applyPickup(p, item);
      this.spawnItems(dropped, p.x, p.y);
      if (p.id === this.localId) {
        ZR.Audio.play('pickup', p.x, p.y);
        this.addFx({ kind: 'label', x: p.x, y: p.y - 40, text: `+ ${ZR.Items.label(item)}`, color: ZR.Items.color(item), t: 0, life: 1.1 });
      }
    }

    spawnItems(items, x, y) {
      if (!items.length) return;
      if (this.online && this.hooks.onDrop) {
        this.hooks.onDrop(items, x, y);
        return;
      }
      this.addLoot(ZR.Items.scatter(items, x, y, `d${++this.dropSeq}`, Math.random()));
    }

    // ---- 장애물 ----
    destroyObstacle(o, owner, local) {
      if (o.dead) return;
      o.dead = true;
      const c = U.center(o);
      for (let i = 0; i < 8; i++) {
        const a = Math.random() * U.TAU, s = 80 + Math.random() * 180;
        this.addFx({ kind: 'chip', x: c.x, y: c.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0, life: 0.5, color: chipColor(o.kind) });
      }
      ZR.Audio.play('break', c.x, c.y);
      if (o.kind === 'crate' || o.kind === 'airdrop') this.addLoot(ZR.MapGen.crateLoot(o));
      if (o.kind === 'barrel') ZR.Combat.explode(this, o.x, o.y, 120, 60, owner, 'barrel', { knock: 500 });
      if (local && this.online && this.hooks.onDestroy) this.hooks.onDestroy(o.id, owner);
    }

    remoteDestroy(id, owner) {
      this.destroyedIds.set(id, owner);
      const o = this.map.byId.get(id);
      if (o) this.destroyObstacle(o, owner, false);
    }

    updateAirdrops() {
      for (const d of this.airdrops) {
        if (!d.announced && this.time >= d.t - 10) {
          d.announced = true;
          if (this.hooks.onBanner) this.hooks.onBanner('📦 보급 상자가 떨어지고 있습니다! (미니맵 확인)');
        }
        if (d.landed || this.time < d.t) continue;
        d.landed = true;
        const o = ZR.MapGen.makeObstacle('airdrop', 'rect', { id: d.id, x: d.x - 36, y: d.y - 36, w: 72, h: 72, lootSeed: d.lootSeed });
        ZR.MapGen.addObstacle(this.map, o);
        this.shake(d.x, d.y, 120);
        ZR.Audio.play('thump', d.x, d.y);
        if (this.destroyedIds.has(d.id)) this.destroyObstacle(o, this.destroyedIds.get(d.id), false);
      }
    }

    // ---- 사망 ----
    killPlayer(target, owner, wid) {
      if (!target.alive) return;
      target.alive = false;
      target.hp = 0;
      target.beamOn = false;
      target.rank = this.aliveCount() + 1;
      target.killedBy = owner;
      target.deathT = this.time;
      const attacker = this.players.get(owner);
      if (attacker && attacker !== target && this.isAuth(attacker)) attacker.kills++;
      this.pushFeed(owner, target.id, wid);
      for (let i = 0; i < 14; i++) ZR.Combat.sparks(this, target.x, target.y, '#a11', 1);
      if (this.isAuth(target)) {
        this.spawnItems(ZR.PlayerSys.deathItems(target), target.x, target.y);
        if (this.hooks.onDeath) this.hooks.onDeath(target, owner, wid);
      }
    }

    remoteKill(ev) {
      const target = this.players.get(ev.v);
      if (target && target.alive) {
        target.alive = false;
        target.rank = ev.r || this.aliveCount() + 1;
        target.killedBy = ev.by;
        target.deathT = this.time;
        this.pushFeed(ev.by, ev.v, ev.w);
      }
      // 내가 계산하는 공격자(나·내 봇)의 킬 수는 여기서 올린다. 피해자도 내 쪽이면 killPlayer에서 이미 셌다
      const killer = this.players.get(ev.by);
      const victimHere = target && this.isAuth(target);
      if (killer && ev.by !== ev.v && this.isAuth(killer) && !victimHere) killer.kills++;
    }

    pushFeed(killerId, victimId, wid) {
      const name = (id) => (this.players.get(id) ? this.players.get(id).name : id === 'zone' ? '자기장' : '???');
      const self = killerId === victimId || !this.players.get(killerId);
      this.feed.push({
        t: this.time, killer: self ? null : name(killerId), victim: name(victimId), weapon: ZR.Combat.weaponName(wid),
        mine: killerId === this.localId || victimId === this.localId,
      });
      if (this.feed.length > 6) this.feed.shift();
    }

    // ---- 연출 ----
    addFx(f) {
      if (this.fx.length < FX_CAP) this.fx.push(f);
    }

    damageText(target, amt) {
      const old = this.texts.find((t) => t.id === target.id && t.t < TEXT_MERGE);
      if (old) {
        old.amt += amt;
        old.x = target.x;
        old.y = target.y - 30;
        return;
      }
      this.texts.push({ id: target.id, x: target.x + (Math.random() - 0.5) * 20, y: target.y - 30, amt, t: 0, life: 0.9 });
    }

    shake(x, y, r) {
      const me = this.local;
      if (!me) return;
      const d = U.dist(x, y, me.x, me.y);
      this.shakeAmt = Math.max(this.shakeAmt, Math.max(0, 1 - d / (r * 5 + 200)) * Math.min(26, r / 7));
    }

    respawnDummies() {
      for (const p of this.players.values()) {
        if (!p.isBot || p.alive || this.time - p.deathT < 2) continue;
        p.alive = true;
        p.hp = ZR.CONFIG.maxHp;
        p.burn = null;
        p.slow = null;
        if (p.home) {
          p.x = p.home.x;
          p.y = p.home.y;
        }
      }
    }
  }

  function chipColor(kind) {
    return { tree: '#5b3', rock: '#999', crate: '#b8864b', barrel: '#c33', bush: '#4a3', airdrop: '#ddd' }[kind] || '#aaa';
  }

  ZR.World = World;
  // eslint-disable-next-line no-console
  ZR.log = (...args) => (typeof console !== 'undefined' ? console.warn('[오버차지]', ...args) : undefined);
})(typeof window !== 'undefined' ? window : globalThis);
