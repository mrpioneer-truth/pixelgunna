'use strict';
// 온라인 방·경기 동기화.
// rooms/{room}/presence/{uid}  : 접속자 {n, c, st:'lobby'|'play'|'spec', t}
// rooms/{room}/match           : 현재 경기 {id, mode, seed, startAt, roster:{uid:팀}, bots:[봇별 팀], host, ended}
// rooms/{room}/m/{id}/p/{uid}  : 플레이어 상태(초당 15회). 봇(bot0…)은 방장이 계산해 초당 8회 묶어서 올린다
// rooms/{room}/m/{id}/e/{key}  : 사건(shot·melee·throw·drop·kill), t=서버시각(ms)
// rooms/{room}/m/{id}/tk/{lootId} : 아이템을 주운 uid (트랜잭션으로 선점)
// rooms/{room}/m/{id}/ds/{obsId}  : 부서진 장애물 → 부순 uid
(function (root) {
  const ZR = (root.ZR = root.ZR || {});
  const C = ZR.CONFIG;
  const ROOM_RE = /^[A-Za-z0-9_-]{1,16}$/;
  const MAX_TEAM_PREF = 8;
  const MAX_BOTS = 60;
  const BOT_STATE_GAP = 1 / 8;

  let store = null;
  let uid = '';
  let room = '';
  let roomSubs = [];
  let matchSubs = [];
  let lobbyState = { players: [], match: null };
  let onLobby = () => {};
  let match = null;
  let world = null;
  let sendT = 0;
  let botSendT = 0;

  const base = () => `rooms/${room}`;
  const mBase = () => `rooms/${room}/m/${match.id}`;
  const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
  const str = (v, max = 16) => (typeof v === 'string' ? v.slice(0, max) : '');
  const color = (v) => typeof v === 'string' && /^#[a-f0-9]{6}$/i.test(v) ? v : '#f4c27a';

  function getUid() {
    let id = sessionStorage.getItem('zr.uid');
    if (!id) {
      id = `u${ZR.U.uid()}`;
      sessionStorage.setItem('zr.uid', id);
    }
    return id;
  }

  async function connect(kind) {
    if (store && store.kind === kind) return store;
    store = kind === 'local' ? await ZR.Store.localStore() : await ZR.Store.firebaseStore();
    uid = getUid();
    return store;
  }

  // ---- 방 ----
  function normalizeRoom(roomCode) {
    if (typeof roomCode !== 'string' || !ROOM_RE.test(roomCode)) {
      throw new Error('방 코드는 영문·숫자·하이픈·밑줄로 1~16자까지 입력해 주세요.');
    }
    return roomCode.toUpperCase();
  }

  async function joinRoom(roomCode, profile, listener) {
    const nextRoom = normalizeRoom(roomCode);
    leaveRoom();
    room = nextRoom;
    const me = `${base()}/presence/${uid}`;
    try {
      await store.onDisconnectRemove(me);
      await store.set(me, { n: str(profile.name), c: color(profile.color), st: 'lobby', tm: 0, t: store.now() });
    } catch (err) {
      room = '';
      throw err;
    }
    onLobby = listener;
    roomSubs.push(store.on(`${base()}/presence`, 'value', (k, v) => {
      lobbyState = { ...lobbyState, players: parsePresence(v) };
      emitLobby();
    }));
    roomSubs.push(store.on(`${base()}/match`, 'value', (k, v) => {
      lobbyState = { ...lobbyState, match: v && v.id ? v : null };
      emitLobby();
    }));
    return room;
  }

  function parsePresence(v) {
    if (!v || typeof v !== 'object') return [];
    return Object.entries(v)
      .map(([id, p]) => ({ id, name: str(p && p.n) || '???', color: color(p && p.c), st: str(p && p.st, 8), tm: ZR.U.clamp(num(p && p.tm) | 0, 0, MAX_TEAM_PREF), t: num(p && p.t) }))
      .sort((a, b) => a.t - b.t);
  }

  function emitLobby() {
    const players = lobbyState.players;
    const hostId = players.length ? players[0].id : null;
    onLobby({ ...lobbyState, hostId, isHost: hostId === uid, uid, now: store.now(), room });
  }

  function setPresence(st) {
    if (room) store.update(`${base()}/presence/${uid}`, { st });
  }

  function updateProfile(profile) {
    if (room) {
      store.update(`${base()}/presence/${uid}`, { n: str(profile.name), c: color(profile.color) })
        .catch((err) => ZR.log('방 프로필 저장 실패', err));
    }
  }

  function leaveRoom() {
    roomSubs.forEach((off) => off());
    roomSubs = [];
    leaveMatch();
    if (room && store) store.remove(`${base()}/presence/${uid}`).catch((err) => ZR.log('방 나가기 저장 실패', err));
    room = '';
    lobbyState = { players: [], match: null };
  }

  // 방에 있는 모두를 팀에 배정한다. 원하는 팀(tm)을 고른 사람부터, 나머지는 빈자리를 앞에서부터 채운다
  function assignTeams(players, size) {
    const roster = {}, count = {};
    const put = (id, t) => {
      roster[id] = t;
      count[t] = (count[t] || 0) + 1;
    };
    if (size > 1) players.filter((p) => p.tm > 0).forEach((p) => { if ((count[p.tm] || 0) < size) put(p.id, p.tm); });
    let t = 1;
    players.filter((p) => !(p.id in roster)).forEach((p) => {
      while ((count[t] || 0) >= size) t++;
      put(p.id, t);
    });
    return roster;
  }

  function setTeamPref(tm) {
    if (room) store.update(`${base()}/presence/${uid}`, { tm: ZR.U.clamp(tm | 0, 0, MAX_TEAM_PREF) });
  }

  // 봇 배치 계획: 총 인원(total)이 될 때까지 봇을 넣는다.
  // 먼저 사람 팀의 빈자리를 채우고, 남는 봇은 새 팀(사람 팀 번호 다음부터)으로 묶는다. 결과[i] = i번째 봇의 팀
  function planBots(roster, size, total) {
    const count = {};
    Object.values(roster).forEach((t) => { count[t] = (count[t] || 0) + 1; });
    const humans = Object.keys(roster).length;
    const n = Math.max(0, Math.min(MAX_BOTS, total - humans));
    const teams = [];
    Object.keys(count).map(Number).sort((a, b) => a - b).forEach((t) => {
      while (teams.length < n && count[t] < size) {
        teams.push(t);
        count[t]++;
      }
    });
    let next = Math.max(0, ...Object.keys(count).map(Number)) + 1;
    while (teams.length < n) {
      for (let k = 0; k < size && teams.length < n; k++) teams.push(next);
      next++;
    }
    return teams;
  }

  function startMatch(mode = 'solo', total = 0) {
    const old = lobbyState.match;
    if (old && old.id) store.remove(`${base()}/m/${old.id}`);
    const size = C.teamSizes[mode] || 1;
    const players = lobbyState.players.some((p) => p.id === uid) ? lobbyState.players : [...lobbyState.players, { id: uid, tm: 0 }];
    const roster = assignTeams(players, size);
    const bots = planBots(roster, size, Number(total) || 0);
    const id = store.newKey(`${base()}/m`);
    return store.set(`${base()}/match`, { id, mode: C.teamSizes[mode] ? mode : 'solo', seed: ZR.U.randSeed(), startAt: store.now() + 4000, roster, bots, host: uid, ended: false });
  }

  // 경기가 아직 참가 가능한가
  function canJoin(m) {
    if (!m || m.ended) return false;
    return store.now() < m.startAt + C.lateJoinSec * 1000;
  }

  // ---- 경기 ----
  function enterMatch(m, w, asPlayer) {
    leaveMatch();
    match = m;
    world = w;
    setPresence(asPlayer ? 'play' : 'spec');
    if (asPlayer) store.onDisconnectRemove(`${mBase()}/p/${uid}`);
    // 방장의 봇: 방장 연결이 끊기면 봇도 함께 사라진다
    w.ownedBots.forEach((id) => store.onDisconnectRemove(`${mBase()}/p/${id}`));
    matchSubs.push(store.on(`${mBase()}/p`, 'child_added', onPlayerState));
    matchSubs.push(store.on(`${mBase()}/p`, 'child_changed', onPlayerState));
    matchSubs.push(store.on(`${mBase()}/p`, 'child_removed', (k) => onPlayerGone(k)));
    matchSubs.push(store.on(`${mBase()}/e`, 'child_added', onEvent));
    matchSubs.push(store.on(`${mBase()}/tk`, 'child_added', (k) => world && world.markTaken(k)));
    matchSubs.push(store.on(`${mBase()}/ds`, 'child_added', (k, v) => world && world.remoteDestroy(k, str(v, 24))));
    return {
      onEvent: (ev) => store.push(`${mBase()}/e`, { ...ev, t: store.now() }),
      claim: (id) => store.claim(`${mBase()}/tk/${id}`, uid),
      onDrop: (items, x, y) => {
        const key = store.newKey(`${mBase()}/e`);
        const placed = ZR.Items.scatter(items, x, y, key, Math.random());
        store.set(`${mBase()}/e/${key}`, { k: 'drop', items: placed, t: store.now() });
      },
      onDestroy: (id, owner) => store.set(`${mBase()}/ds/${id}`, owner),
      onDeath: (target, owner, wid) => {
        store.push(`${mBase()}/e`, { k: 'kill', by: owner, v: target.id, w: wid, r: target.rank, t: store.now() });
        sendState(target);
      },
    };
  }

  function onPlayerState(id, s) {
    if (!world || id === uid || !s) return;
    let p = world.players.get(id);
    if (p && world.isAuth(p)) return; // 내가 올린 내 봇 상태가 되돌아온 것
    if (!p) {
      p = new ZR.Player(id, str(s.n) || '???', color(s.c), num(s.x), num(s.y), !!s.bot);
      p.remote = true;
      world.addPlayer(p);
    }
    p.skin = ZR.Cosmetics.validate(s.sk);
    p.skinTag = p.skin === 'default' ? '' : ZR.Wardrobe.cleanTag(s.stg);
    p.target = { x: num(s.x, p.x), y: num(s.y, p.y), a: num(s.a) };
    p.hp = num(s.hp, 100);
    if (Number.isFinite(s.tm)) p.team = s.tm;
    p.helmet = num(s.h) | 0;
    p.vest = num(s.v) | 0;
    p.kills = num(s.k) | 0;
    p.spin = num(s.sp);
    p.charge = num(s.ch);
    p.action = s.hl ? { key: 'bandage', t: 0, dur: 1 } : null;
    holdWeapon(p, str(s.w));
    p.beamOn = !!s.b && p.alive;
    if (!s.al && p.alive) {
      p.alive = false;
      p.rank = world.aliveCount() + 1;
      p.deathT = world.time;
    }
  }

  function holdWeapon(p, wid) {
    const def = ZR.W[wid];
    if (!def || p.wid === wid) return;
    if (def.kind === 'gun') {
      p.slots[0] = { wid, mag: def.mag };
      p.cur = 0;
    } else if (def.kind === 'melee') {
      p.slots[2] = { wid };
      p.cur = 2;
    } else {
      p.slots[3] = { wid };
      p.throws[wid] = 1;
      p.cur = 3;
    }
  }

  function onPlayerGone(id) {
    if (!world || id === uid) return;
    const p = world.players.get(id);
    if (p && p.alive) {
      p.alive = false;
      p.rank = world.aliveCount() + 1;
      p.left = true;
      if (!p.isBot) world.pushFeed(null, id, 'left');
    }
  }

  function onEvent(key, ev) {
    if (!world || !ev || typeof ev.k !== 'string') return;
    if (ev.k === 'drop') {
      if (Array.isArray(ev.items)) world.addLoot(ev.items.filter(validItem));
      return;
    }
    if (ev.k === 'kill') {
      world.remoteKill({ by: str(ev.by, 24), v: str(ev.v, 24), w: str(ev.w, 16), r: num(ev.r) });
      return;
    }
    if (ev.o === uid || store.now() - num(ev.t) > C.shotEventMaxAgeMs) return;
    if (!ZR.W[ev.w] || !['shot', 'melee', 'throw'].includes(ev.k)) return;
    world.playRemoteAttack({ ...ev, x: num(ev.x), y: num(ev.y), a: num(ev.a), tx: num(ev.tx), ty: num(ev.ty), s: num(ev.s) >>> 0 });
  }

  function validItem(it) {
    return it && typeof it.id === 'string' && typeof it.type === 'string' && Number.isFinite(it.x) && Number.isFinite(it.y);
  }

  function stateOf(p) {
    return {
      n: p.name, c: p.color, x: Math.round(p.x), y: Math.round(p.y), a: +p.angle.toFixed(2), hp: Math.max(0, Math.round(p.hp)),
      al: p.alive ? 1 : 0, w: p.wid, b: p.beamOn ? 1 : 0, sp: +p.spin.toFixed(2), ch: +p.charge.toFixed(2),
      h: p.helmet, v: p.vest, k: p.kills, hl: p.action ? 1 : 0, tm: p.team,
      sk: p.skin && p.skin !== 'default' ? p.skin : null, stg: p.skinTag || null, bot: p.isBot ? 1 : null,
    };
  }

  // 나 또는 내 봇 한 명의 상태 (사망 직후 즉시 알릴 때)
  function sendState(p) {
    if (!match || !p) return;
    store.set(`${mBase()}/p/${p.id}`, stateOf(p));
  }

  // 살아 있는 내 봇들을 한 번에 올린다
  function sendBots() {
    const batch = {};
    for (const id of world.ownedBots) {
      const b = world.players.get(id);
      if (b && b.alive) batch[id] = stateOf(b);
    }
    if (Object.keys(batch).length) store.update(`${mBase()}/p`, batch);
  }

  function tick(dt, w) {
    if (!match || !w) return;
    const me = w.local;
    sendT -= dt;
    if (me && sendT <= 0) {
      sendT = C.netStateGap;
      sendState(me);
    }
    botSendT -= dt;
    if (w.ownedBots.size && botSendT <= 0) {
      botSendT = BOT_STATE_GAP;
      sendBots();
    }
  }

  function markEnded() {
    if (match && room) store.update(`${base()}/match`, { ended: true });
  }

  function leaveMatch() {
    matchSubs.forEach((off) => off());
    matchSubs = [];
    if (match && store) {
      store.remove(`${mBase()}/p/${uid}`).catch((err) => ZR.log('경기 나가기 저장 실패', err));
      if (world) world.ownedBots.forEach((id) => store.remove(`${mBase()}/p/${id}`).catch((err) => ZR.log('봇 정리 실패', err)));
    }
    if (room && match) setPresence('lobby');
    match = null;
    world = null;
  }

  ZR.Net = {
    connect, normalizeRoom, joinRoom, updateProfile, leaveRoom, startMatch, assignTeams, planBots, setTeamPref, canJoin, enterMatch, leaveMatch, tick, markEnded,
    get uid() { return uid; },
    get store() { return store; },
    serverNow: () => (store ? store.now() : Date.now()),
  };
})(typeof window !== 'undefined' ? window : globalThis);
