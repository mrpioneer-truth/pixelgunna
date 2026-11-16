'use strict';
// 게임 루프와 모드 시작: 솔로(봇), 무기 시험장, 온라인. 카메라·입력·관전·종료 판정.
(function (root) {
  const ZR = (root.ZR = root.ZR || {});
  const U = ZR.U;
  const I = () => ZR.Input;

  const MAX_DT = 0.05;
  const HIDDEN_TICK_MS = 100;
  const RAF_STALL_MS = 250;
  const SLOT_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4'];
  const HEAL_KEYS = { Digit7: 'bandage', Digit8: 'medkit', Digit9: 'soda', Digit0: 'pills' };

  const G = {
    world: null,
    mode: null,
    cam: { x: 0, y: 0, scale: 1 },
    raf: 0,
    lastTs: 0,
    ended: false,
    deathShown: false,
    rewardId: null,
    specIdx: 0,
    onExit: null,
    netMatch: null,
    paused: false,
  };

  function init(onExit) {
    G.onExit = onExit;
    const cv = document.getElementById('cv');
    ZR.Render.init(cv);
    ZR.Input.init(cv);
    ZR.HUD.init();
    document.getElementById('escResume').onclick = () => setPaused(false);
    document.getElementById('escLeave').onclick = () => exit();
  }

  function newProfilePlayer(world, profile, id) {
    const pos = world.spawnPoint(id);
    return profilePlayer(profile, id, pos);
  }

  function profilePlayer(profile, id, pos) {
    const player = new ZR.Player(id, profile.name, profile.color, pos.x, pos.y);
    const outfit = ZR.Wardrobe.getOutfit();
    player.skin = outfit ? outfit.skin : ZR.Economy.getWallet().equipped;
    player.skinTag = outfit ? outfit.tag : '';
    return player;
  }

  const giveStarter = (me) => {
    ZR.PlayerSys.giveGun(me, 'pistol', 0);
    me.ammo.light = 30;
    me.cur = 0;
  };

  // teamMode: 'solo' | 'duo' | 'squad'
  function startSolo(profile, bots, teamMode = 'solo') {
    const teamSize = ZR.CONFIG.teamSizes[teamMode] || 1;
    const world = new ZR.World({ seed: U.randSeed(), mode: 'solo', localId: 'me', hooks: { onBanner: (t, d) => ZR.HUD.banner(t, d || 4) } });
    world.teamMode = teamMode;
    const me = world.addPlayer(newProfilePlayer(world, profile, 'me'));
    me.team = 0;
    giveStarter(me);
    ZR.Bots.spawnAll(world, bots, teamSize, me);
    begin(world, 'solo');
    G.lastSolo = { profile, bots, teamMode };
    const label = { solo: '솔로', duo: '듀오', squad: '스쿼드' }[teamMode];
    ZR.HUD.banner(teamSize > 1
      ? `${label}: 봇 팀원 ${teamSize - 1}명과 함께! 마지막 팀이 되세요 (팀원은 초록 이름)`
      : `봇 ${bots}명과 배틀로얄! 마지막 1명이 되세요`, 5);
  }

  function startRange(profile) {
    const world = new ZR.World({ seed: U.randSeed(), mode: 'range', localId: 'me' });
    const me = world.addPlayer(newProfilePlayer(world, profile, 'me'));
    me.pack = 3;
    me.scope = 2;
    clearArea(world, me.x, me.y, 520);
    layOutArsenal(world, me);
    for (let i = 0; i < 5; i++) {
      const a = -0.6 + i * 0.3;
      const x = me.x + Math.cos(a) * 380, y = me.y + Math.sin(a) * 380;
      const d = world.addPlayer(new ZR.Player(`dummy${i}`, `허수아비 ${i + 1}`, '#d9b38c', x, y, true));
      d.brain = { dummy: true };
      d.home = { x, y };
      d.vest = i % 4;
      d.helmet = i % 4;
    }
    begin(world, 'range');
    ZR.HUD.banner('무기 시험장: 모든 무기가 바닥에 있어요. F로 줍고 허수아비에게 쏴 보세요 (탄약 무한)', 6);
  }

  function clearArea(world, x, y, r) {
    const near = (b) => U.dist(x, y, b.x + b.w / 2, b.y + b.h / 2) < r + Math.max(b.w, b.h) / 2;
    const removed = world.map.buildings.filter(near);
    const inRemoved = (c) => removed.some((b) => c.x >= b.x && c.x <= b.x + b.w && c.y >= b.y && c.y <= b.y + b.h);
    for (const o of world.map.obstacles) {
      const c = U.center(o);
      if (U.dist(x, y, c.x, c.y) < r || inRemoved(c)) o.dead = true;
    }
    world.map.buildings = world.map.buildings.filter((b) => !near(b));
  }

  function layOutArsenal(world, me) {
    const all = [...ZR.Weapons.byKind('gun'), ...ZR.Weapons.byKind('melee').filter((w) => w !== 'fists'), ...ZR.Weapons.byKind('throw')];
    const cols = 8;
    const items = all.map((wid, i) => {
      const def = ZR.W[wid];
      const type = def.kind === 'throw' ? 'throw' : def.kind;
      const col = i % cols, row = Math.floor(i / cols);
      return { id: `ars${i}`, type, key: wid, count: type === 'throw' ? 12 : undefined, x: me.x - 300 + col * 60, y: me.y - 200 - row * 60 };
    });
    world.addLoot(items);
  }

  function startOnline(profile, match, asPlayer) {
    let hooks = {};
    const world = new ZR.World({
      seed: match.seed, mode: 'online', localId: ZR.Net.uid,
      hooks: { onBanner: (t, d) => ZR.HUD.banner(t, d || 4), onEvent: (ev) => hooks.onEvent(ev), claim: (id) => hooks.claim(id), onDrop: (a, x, y) => hooks.onDrop(a, x, y), onDestroy: (id, o) => hooks.onDestroy(id, o), onDeath: (t, o, w) => hooks.onDeath(t, o, w) },
    });
    world.time = (ZR.Net.serverNow() - match.startAt) / 1000;
    world.teamMode = match.mode || 'solo';
    if (asPlayer) {
      const uid = ZR.Net.uid;
      const rosterTeam = Number(match.roster && match.roster[uid]);
      // 명단에 없는 늦은 참가자는 혼자 팀
      const team = rosterTeam > 0 ? rosterTeam : 1000 + (U.hashStr(uid) % 100000);
      let pos = world.spawnPoint(uid);
      if (world.teamMode !== 'solo' && rosterTeam > 0) {
        const base = world.teamBase(team);
        pos = ZR.MapGen.nearbyClear(world.map, base.x, base.y, U.rng(U.hashStr(uid)));
      }
      const me = world.addPlayer(profilePlayer(profile, uid, pos));
      me.team = team;
      giveStarter(me);
    }
    // 봇은 경기를 시작한 방장 브라우저가 계산한다
    const botTeams = Array.isArray(match.bots) ? match.bots.map(Number).filter((t) => t > 0) : [];
    if (match.host === ZR.Net.uid && botTeams.length) {
      ZR.Bots.spawnOnline(world, botTeams, new Set(Object.values(match.roster || {}).map(Number)));
    }
    hooks = ZR.Net.enterMatch(match, world, asPlayer);
    G.netMatch = match;
    begin(world, 'online');
    const humans = Object.keys(match.roster || {}).length;
    if (world.time < 0) ZR.HUD.banner(`곧 시작합니다… 사람 ${humans}명${botTeams.length ? ` + 봇 ${botTeams.length}명` : ''}`, 3.5);
    else if (!asPlayer) ZR.HUD.banner('진행 중인 경기를 관전합니다', 3);
  }

  function begin(world, mode) {
    stopLoop();
    G.world = world;
    G.mode = mode;
    G.rewardId = mode === 'solo' ? `${Date.now()}-${U.uid()}`
      : mode === 'online' ? `${G.netMatch.id}-${G.netMatch.seed}-${G.netMatch.startAt}` : null;
    G.ended = false;
    G.deathShown = false;
    G.teamSpecShown = false;
    G.markedEnd = false;
    G.specIdx = 0;
    const me = world.local;
    if (me) {
      G.cam.x = me.x;
      G.cam.y = me.y;
    }
    ZR.HUD.hideResult();
    ZR.HUD.show(true);
    I().setEnabled(true);
    document.getElementById('menu').classList.add('hidden');
    G.lastTs = performance.now();
    G.raf = requestAnimationFrame(frame);
  }

  function stopLoop() {
    if (G.raf) cancelAnimationFrame(G.raf);
    G.raf = 0;
  }

  function exit() {
    stopLoop();
    setPaused(false);
    if (G.mode === 'online') ZR.Net.leaveMatch();
    G.world = null;
    G.netMatch = null;
    ZR.HUD.show(false);
    ZR.HUD.hideResult();
    ZR.HUD.toggleBigmap(false);
    ZR.HUD.board(null, false);
    ZR.HUD.spectating(null);
    I().setEnabled(false);
    document.getElementById('menu').classList.remove('hidden');
    if (G.onExit) G.onExit();
  }

  function setPaused(v) {
    G.paused = v;
    document.getElementById('escMenu').classList.toggle('hidden', !v);
  }

  // ---- 프레임 ----
  function frame(ts) {
    G.raf = requestAnimationFrame(frame);
    G.lastRaf = performance.now();
    step(ts, true);
  }

  // 탭이 가려지면 requestAnimationFrame이 멈추므로, 온라인 경기는 10Hz로 계속 계산·전송한다
  setInterval(() => {
    const stalled = performance.now() - (G.lastRaf || 0) > RAF_STALL_MS;
    if (stalled && G.world && G.world.online) step(performance.now(), false);
  }, HIDDEN_TICK_MS);

  function step(ts, draw) {
    let dt = Math.min(MAX_DT, Math.max(0, (ts - G.lastTs) / 1000));
    G.lastTs = ts;
    const world = G.world;
    if (!world) return;
    if (world.online && G.netMatch) {
      // 경기 시간은 서버 시계를 따른다 (자기장·보급이 모두에게 같게)
      const target = (ZR.Net.serverNow() - G.netMatch.startAt) / 1000;
      dt = U.clamp(target - world.time, 0, MAX_DT * 2);
      world.time = target - dt;
    }
    try {
      globalKeys(world);
      const waiting = world.online && world.time < 0;
      if (waiting) world.time += dt;
      else if (!G.paused || world.online) {
        readLocalInput(world);
        world.update(dt);
      }
      if (G.mode === 'range') refillRange(world);
      if (world.online) ZR.Net.tick(dt, world);
      checkEnd(world);
      if (!draw) return;
      const focus = cameraFocus(world);
      updateCamera(world, focus, dt);
      ZR.Audio.setListener(G.cam.x, G.cam.y);
      ZR.Render.draw(world, G.cam);
      ZR.HUD.update(world, world.local, focus, dt);
      if (waiting) ZR.HUD.banner(`시작까지 ${Math.ceil(-world.time)}초`, 0.3);
    } catch (err) {
      ZR.log('프레임 오류', err);
    }
    I().consume();
  }

  function globalKeys(world) {
    if (I().hit('Escape')) setPaused(!G.paused);
    if (I().hit('KeyM')) ZR.HUD.toggleBigmap(document.getElementById('bigmap').classList.contains('hidden'));
    ZR.HUD.board(world, I().down('Tab'));
    const me = world.local;
    if (!me || !me.alive) {
      if (I().hit('ArrowRight') || I().hit('KeyD')) G.specIdx++;
      if (I().hit('ArrowLeft') || I().hit('KeyA')) G.specIdx--;
    }
  }

  function readLocalInput(world) {
    const me = world.local;
    if (!me || !me.alive) return;
    const inp = me.input;
    const K = I();
    if (G.paused) {
      Object.assign(inp, ZR.PlayerSys.emptyInput(), { ax: inp.ax, ay: inp.ay });
      return;
    }
    inp.mx = (K.down('KeyD') || K.down('ArrowRight') ? 1 : 0) - (K.down('KeyA') || K.down('ArrowLeft') ? 1 : 0);
    inp.my = (K.down('KeyS') || K.down('ArrowDown') ? 1 : 0) - (K.down('KeyW') || K.down('ArrowUp') ? 1 : 0);
    const { w, h } = ZR.Render.viewSize();
    inp.ax = G.cam.x + (K.state.mouse.x - w / 2) / G.cam.scale;
    inp.ay = G.cam.y + (K.state.mouse.y - h / 2) / G.cam.scale;
    inp.fire = K.state.mouse.down || K.down('Space');
    SLOT_KEYS.forEach((code, i) => { if (K.hit(code)) inp.slot = i; });
    if (K.hit('KeyQ')) inp.slot = me.prevSlot;
    if (K.hit('KeyR')) inp.reload = true;
    if (K.hit('KeyF') || K.hit('KeyE')) inp.pickup = true;
    for (const [code, key] of Object.entries(HEAL_KEYS)) if (K.hit(code)) inp.heal = key;
    if (K.state.wheel) inp.cycle = K.state.wheel > 0 ? 1 : -1;
  }

  function refillRange(world) {
    const me = world.local;
    if (!me) return;
    for (const k of Object.keys(me.ammo)) me.ammo[k] = ZR.Weapons.AMMO[k].max[3];
    me.hp = Math.max(me.hp, 1);
    if (!me.alive) {
      me.alive = true;
      me.hp = ZR.CONFIG.maxHp;
    }
  }

  function cameraFocus(world) {
    const me = world.local;
    if (me && me.alive) return me;
    const everyone = [...world.players.values()].filter((p) => p.alive);
    // 팀원이 살아 있으면 팀원만 관전한다
    const mates = me ? everyone.filter((p) => p.team != null && p.team === me.team) : [];
    const alive = mates.length ? mates : everyone;
    if (!alive.length) return me || { x: world.size / 2, y: world.size / 2, scope: 1 };
    if (me && !G.specPicked && !mates.length) {
      const killer = world.players.get(me.killedBy);
      G.specPicked = true;
      if (killer && killer.alive) G.specIdx = alive.indexOf(killer);
    }
    const p = alive[((G.specIdx % alive.length) + alive.length) % alive.length];
    ZR.HUD.spectating(p.name);
    return p;
  }

  function updateCamera(world, focus, dt) {
    const k = 1 - Math.exp(-10 * dt);
    G.cam.x += (focus.x - G.cam.x) * k;
    G.cam.y += (focus.y - G.cam.y) * k;
    const { w, h } = ZR.Render.viewSize();
    const scope = (world.local && world.local.alive ? world.local.scope : focus.scope) || 1;
    const want = Math.sqrt(w * h) / (ZR.Items.SCOPE_VIEW[scope] * 1.05);
    G.cam.scale += (want - G.cam.scale) * (1 - Math.exp(-4 * dt));
  }

  // ---- 종료 판정 ----
  // 팀 단위 판정: 살아 있는 팀이 하나 남으면 그 팀 승리. 솔로는 1인 1팀
  function checkEnd(world) {
    if (world.online) markOnlineEnd(world);
    if (G.mode === 'range' || G.ended) return;
    const me = world.local;
    const teams = world.aliveTeams();
    const totalTeams = world.teamCount();
    const started = !world.online || world.time > 3;
    const teamGame = world.teamMode && world.teamMode !== 'solo';
    const myTeamAlive = me && teams.has(world.teamKey(me));
    if (me && myTeamAlive && teams.size === 1 && totalTeams > 1 && started) {
      G.ended = true;
      me.rank = 1;
      if (world.online) ZR.Net.markEnded();
      showResult(world, me, teamGame ? '🏆 우리 팀 승리!' : '🏆 최후의 1인! 승리!', true);
      return;
    }
    if (me && !me.alive && myTeamAlive && !G.teamSpecShown) {
      G.teamSpecShown = true;
      ZR.HUD.banner(`쓰러졌습니다 (${killerText(world, me)}) · 살아 있는 팀원을 관전합니다`, 4);
      return;
    }
    if (me && !me.alive && !myTeamAlive && !G.deathShown) {
      G.deathShown = true;
      G.specPicked = false;
      me.rank = Math.max(teams.size + 1, Math.min(totalTeams, 2));
      showResult(world, me, teamGame ? `팀 전멸 - ${killerText(world, me)}` : `탈락 - ${killerText(world, me)}`);
      return;
    }
    if (!me && world.online && teams.size <= 1 && totalTeams > 1 && started) {
      G.ended = true;
      ZR.Net.markEnded();
      const winners = [...world.players.values()].filter((p) => p.alive).map((p) => p.name);
      ZR.HUD.banner(winners.length ? `🏆 ${winners.join(', ')} 승리!` : '경기 종료', 6);
    }
  }

  // 마지막 한 팀만 남았거나 사람이 모두 탈락하면 방 경기를 끝냄으로 표시한다 (봇끼리 남아 있어도 다음 경기를 시작할 수 있게)
  function markOnlineEnd(world) {
    if (G.markedEnd || world.time < 3) return;
    const humanAlive = [...world.players.values()].some((p) => p.alive && !p.isBot);
    if (world.aliveTeams().size <= 1 || !humanAlive) {
      G.markedEnd = true;
      ZR.Net.markEnded();
    }
  }

  function killerText(world, me) {
    const k = world.players.get(me.killedBy);
    if (k && k !== me) return `${k.name}에게 처치됨`;
    return me.killedBy === 'zone' ? '자기장에 쓰러짐' : '쓰러짐';
  }

  function showResult(world, me, title, won = false) {
    const buttons = [];
    if (!me.alive) buttons.push({ label: '관전하기', onClick: () => ZR.HUD.hideResult() });
    if (G.mode === 'solo' && G.lastSolo) {
      const again = G.lastSolo;
      buttons.push({ label: '다시 하기', primary: true, onClick: () => { exit(); startSolo(again.profile, again.bots, again.teamMode); } });
    }
    if (won) buttons.push({ label: '공용 옷장 열기', onClick: () => { exit(); ZR.WardrobeUI.open(); } });
    buttons.push({ label: '로비로', primary: G.mode !== 'solo', onClick: exit });
    const total = world.teamCount();
    const eligible = total > 1;
    const hostBots = world.online && world.ownedBots.size > 0 && [...world.ownedBots].some((id) => world.players.get(id)?.alive);
    const sub = !world.online ? ''
      : hostBots ? 'Tab 순위표 · 봇은 방장 화면에서 움직입니다. 친구들이 끝날 때까지 "관전하기"로 남아 주세요'
        : 'Tab 순위표 · 다른 참가자의 경기는 계속됩니다';
    ZR.HUD.result({
      title, rank: me.rank || 1, total, kills: me.kills, dmg: me.dmgDealt,
      sub: eligible ? '코인 정산 중…' : sub,
      wardrobeCode: won ? ZR.Wardrobe.CODE : '',
    }, buttons);
    if (!eligible) return;
    ZR.Economy.recordMatch({ id: G.rewardId, mode: G.mode, rank: me.rank || 1, total, kills: me.kills, won })
      .then((earned) => {
        if (G.world !== world) return;
        const reward = earned === null ? '코인 정산에 실패했습니다'
          : earned === 0 ? '이미 정산한 경기입니다' : `+${earned} 코인 획득`;
        ZR.HUD.resultNote([reward, sub].filter(Boolean).join(' · '));
      });
  }

  ZR.Game = { init, startSolo, startRange, startOnline, exit, get world() { return G.world; } };
})(typeof window !== 'undefined' ? window : globalThis);
