'use strict';
// 시작 화면: 프로필, 스킨 상점, 솔로/시험장/온라인 방, 무기 도감.
(function (root) {
  const ZR = (root.ZR = root.ZR || {});
  const $ = (id) => document.getElementById(id);
  const esc = (s) => ZR.HUD.esc(s);

  const SKINS = ['#f4c27a', '#e0a370', '#c98d5b', '#8d5a3b', '#f7d9b5', '#90caf9', '#b5e48c', '#f48fb1', '#ce93d8', '#ffcc80'];
  const STALE_MATCH_MS = 12 * 60 * 1000;
  const coinFormat = new Intl.NumberFormat('ko-KR');
  const shopCards = new Map();
  let pendingSkin = null;

  const L = { profile: null, room: null, lobby: null, enteredId: null, inGame: false, teamMode: 'solo' };
  const MODE_LABEL = { solo: '솔로', duo: '듀오', squad: '스쿼드' };

  function loadProfile() {
    try {
      const p = JSON.parse(localStorage.getItem('zr.profile') || 'null');
      if (p && typeof p.name === 'string' && SKINS.includes(p.color)) return p;
    } catch (err) {
      ZR.log('프로필 읽기 실패', err);
    }
    return { name: `플레이어${Math.floor(Math.random() * 900 + 100)}`, color: SKINS[0] };
  }

  function saveProfile() {
    const name = $('nameInput').value.trim().slice(0, 12) || '이름없음';
    L.profile = { ...L.profile, name };
    localStorage.setItem('zr.profile', JSON.stringify(L.profile));
    if (L.room) ZR.Net.updateProfile(L.profile);
    return L.profile;
  }

  function renderSkins() {
    for (const button of $('skins').querySelectorAll('button')) {
      const active = button.dataset.c === L.profile.color;
      button.classList.toggle('on', active);
      button.setAttribute('aria-pressed', active);
    }
  }

  function initSkins() {
    $('skins').innerHTML = SKINS.map((c) => `<button class="skin" data-c="${c}" style="background:${c}" aria-label="색 ${c}" type="button"></button>`).join('');
    for (const button of $('skins').querySelectorAll('button')) {
      button.onclick = () => {
        L.profile = { ...L.profile, color: button.dataset.c };
        saveProfile();
        renderSkins();
        refreshShop();
      };
    }
    renderSkins();
  }

  function initShop() {
    const dialog = $('shop');
    for (const skin of ZR.Cosmetics.catalog) {
      const card = document.createElement('li');
      card.className = 'shopItem';
      card.innerHTML = `<div class="shopArt" style="--skin-tint:${skin.tint}"><canvas width="168" height="144" aria-hidden="true"></canvas></div>
        <h3>${esc(skin.name)}</h3><p class="shopPrice">${skin.price ? `${coinFormat.format(skin.price)} 코인` : '무료'}</p>
        <button type="button"></button>`;
      const button = card.querySelector('button');
      const preview = card.querySelector('canvas');
      ZR.Cosmetics.preview(preview, skin.id, L.profile.color);
      shopCards.set(skin.id, { card, button, preview });
      button.onclick = () => shopAction(skin);
      $('shopItems').append(card);
    }
    $('btnShop').onclick = () => {
      $('shopStatus').textContent = '';
      refreshShop();
      dialog.showModal();
    };
    window.addEventListener('zr.walletchange', refreshShop);
    window.addEventListener('zr.wardrobechange', refreshShop);
    window.addEventListener('storage', (ev) => {
      if (ev.key === 'zr.wallet.v1' || ev.key === null || ev.key.startsWith('zr.wardrobe.')) refreshShop();
    });
    refreshShop();
  }

  function refreshShop() {
    const wallet = ZR.Economy.getWallet();
    const outfit = ZR.Wardrobe.getOutfit();
    const equipped = ZR.Cosmetics.get(outfit?.skin || wallet.equipped) || ZR.Cosmetics.get('default');
    $('equippedSkin').textContent = equipped.name;
    $('equippedTag').textContent = outfit?.tag || '';
    $('equippedTag').classList.toggle('hidden', !outfit);
    $('walletCoins').textContent = $('shopCoins').textContent = coinFormat.format(wallet.coins);
    ZR.Cosmetics.preview($('equippedPreview'), equipped.id, L.profile.color);
    ZR.Cosmetics.preview(shopCards.get('default').preview, 'default', L.profile.color);
    for (const skin of ZR.Cosmetics.catalog) {
      const { card, button } = shopCards.get(skin.id);
      const active = !outfit && skin.id === equipped.id;
      const owned = wallet.owned.includes(skin.id);
      const missing = skin.price - wallet.coins;
      const isPending = pendingSkin === skin.id;
      const action = active ? '장착 중' : owned ? '장착하기' : missing > 0 ? `${coinFormat.format(missing)} 코인 부족` : '구매하기';
      card.dataset.equipped = active;
      button.textContent = isPending ? '저장 중…' : action;
      button.setAttribute('aria-label', `${skin.name} ${button.textContent}`);
      button.setAttribute('aria-disabled', pendingSkin !== null || active || (!owned && missing > 0));
      button.classList.toggle('primary', !owned && missing <= 0);
    }
  }

  async function shopAction(skin) {
    const { button } = shopCards.get(skin.id);
    if (button.getAttribute('aria-disabled') === 'true') return;
    const owned = ZR.Economy.getWallet().owned.includes(skin.id);
    pendingSkin = skin.id;
    refreshShop();
    let ok = false;
    try {
      ok = await (owned ? ZR.Economy.equip(skin.id) : ZR.Economy.buy(skin.id));
      if (ok && owned && ZR.Wardrobe.getOutfit()) ok = ZR.Wardrobe.clearOutfit();
    } catch (error) {
      ZR.log('스킨 저장 실패', error);
    } finally {
      pendingSkin = null;
      refreshShop();
    }
    $('shopStatus').textContent = ok
      ? `${skin.name} ${owned ? '장착 완료' : '구매 완료'}`
      : '변경사항을 저장하지 못했습니다. 잔액을 확인하고 다시 시도해 주세요.';
  }

  function renderCodex() {
    const R = ZR.Weapons.RARITY;
    const kinds = { gun: '총', melee: '근접', throw: '투척' };
    const rows = Object.entries(ZR.W)
      .sort(([, a], [, b]) => R[a.rarity].rank - R[b.rarity].rank)
      .map(([, d]) => {
        let stat = '';
        if (d.kind === 'gun') stat = d.type === 'beam' ? `초당 ${d.dps * (d.beams || 1)}` : `${d.dmg || (d.fx.explode && d.fx.explode.dmg) || (d.fx.meteor && d.fx.meteor.dmg) || (d.fx.hole && `${d.fx.hole.dps}/s`)}${d.pellets > 1 ? `×${d.pellets}` : ''}`;
        else stat = `${d.dmg}`;
        const where = d.rarity === 'mythic' ? '보급 상자' : '';
        return `<tr><td style="color:${R[d.rarity].color}">${R[d.rarity].name}</td><td>${kinds[d.kind]}</td><td><b>${esc(d.name)}</b></td><td>${stat}</td><td>${esc(d.desc || '')} ${where ? `<em>${where}</em>` : ''}</td></tr>`;
      }).join('');
    $('codexBody').innerHTML = `<table><tr><th>등급</th><th>종류</th><th>이름</th><th>피해</th><th>특징</th></tr>${rows}</table>`;
  }

  function status(msg, bad) {
    $('netStatus').textContent = msg;
    $('netStatus').classList.toggle('bad', !!bad);
  }

  // ---- 온라인 ----
  async function goOnline() {
    if ($('btnOnline').disabled) return;
    const kind = new URLSearchParams(location.search).get('net') === 'local' ? 'local' : 'firebase';
    try {
      const code = ZR.Net.normalizeRoom($('roomInput').value.trim() || 'PUBLIC');
      saveProfile();
      if (L.room === code) {
        $('roomInput').value = code;
        status('온라인 연결됨');
        return;
      }
      if (L.room) leaveRoom();
      status('게임 서버에 연결 중…');
      $('btnOnline').disabled = true;
      await ZR.Net.connect(kind);
      const roomName = await ZR.Net.joinRoom(code, L.profile, onLobby);
      L.room = roomName;
      $('roomInput').value = roomName;
      $('teamPref').value = '0';
      $('roomPanel').classList.remove('hidden');
      $('roomTitle').textContent = `방 ${roomName}`;
      status(kind === 'local' ? '로컬 테스트 연결됨 (같은 브라우저의 다른 탭과 플레이)' : '온라인 연결됨');
    } catch (err) {
      ZR.log('온라인 연결 실패', err);
      const forbidden = /^permission.denied$/i.test(err.code || '');
      status(forbidden ? '게임 서버에서 방 입장을 허용하지 않습니다.' : err.message || '연결에 실패했습니다.', true);
    } finally {
      $('btnOnline').disabled = false;
    }
  }

  async function copyInvite() {
    if (!L.room) return;
    const url = new URL(location.href);
    url.searchParams.set('room', L.room);
    url.hash = '';
    try {
      await navigator.clipboard.writeText(url.href);
      $('inviteUrl').classList.add('hidden');
      $('inviteStatus').textContent = '초대 링크를 복사했습니다.';
    } catch (err) {
      const field = $('inviteUrl');
      field.value = url.href;
      field.classList.remove('hidden');
      field.focus();
      field.select();
      $('inviteStatus').textContent = '아래 링크를 복사해 친구에게 보내세요.';
    }
  }

  function matchLive(m, now) {
    return m && !m.ended && now - m.startAt < STALE_MATCH_MS;
  }

  function onLobby(s) {
    L.lobby = s;
    const live = matchLive(s.match, s.now);
    const badge = { lobby: '대기', play: '경기 중', spec: '관전' };
    $('roomPlayers').innerHTML = s.players.map((p) => `<li><span class="dot" style="background:${p.color}"></span>${esc(p.name)}${p.id === s.hostId ? ' 👑' : ''}${p.id === s.uid ? ' (나)' : ''} <small>${badge[p.st] || ''}${p.tm ? ` · ${p.tm}팀` : ''}</small></li>`).join('');
    const inRoster = live && s.match.roster && s.match.roster[s.uid];
    if (live && inRoster && L.enteredId !== s.match.id) {
      // 새 경기: 이전 경기를 보고 있었다면 나와서 바로 참가
      L.enteredId = s.match.id;
      if (L.inGame) ZR.Game.exit();
      enterGame(s.match, true);
      return;
    }
    const btn = $('btnStart');
    const info = $('roomInfo');
    $('roomFillWrap').classList.toggle('hidden', !s.isHost);
    if (live) {
      const joinable = ZR.Net.canJoin(s.match) && L.enteredId !== s.match.id;
      const botN = Array.isArray(s.match.bots) ? s.match.bots.length : 0;
      info.textContent = `${MODE_LABEL[s.match.mode] || '솔로'} 경기 진행 중 (사람 ${Object.keys(s.match.roster || {}).length}명${botN ? ` + 봇 ${botN}명` : ''})`;
      btn.textContent = joinable ? '지금 참가하기' : '관전하기';
      btn.disabled = L.inGame;
      btn.onclick = () => {
        L.enteredId = s.match.id;
        enterGame(s.match, joinable);
      };
    } else if (s.isHost) {
      const total = Number($('roomFill').value) || 0;
      const bots = Math.max(0, total - s.players.length);
      info.textContent = `방장입니다. [${MODE_LABEL[L.teamMode]}] 모드 · 사람 ${s.players.length}명${bots ? ` + 봇 ${bots}명` : ''}으로 시작합니다.`;
      btn.textContent = `${MODE_LABEL[L.teamMode]} 경기 시작`;
      btn.disabled = L.inGame;
      btn.onclick = () => ZR.Net.startMatch(L.teamMode, total).catch((err) => status(`시작 실패: ${err.message}`, true));
    } else {
      info.textContent = '방장이 경기를 시작하길 기다리는 중…';
      btn.textContent = '대기 중';
      btn.disabled = true;
    }
  }

  function enterGame(match, asPlayer) {
    L.inGame = true;
    if ($('shop').open) $('shop').close();
    ZR.WardrobeUI.close();
    ZR.Game.startOnline(L.profile, match, asPlayer);
  }

  function leaveRoom() {
    ZR.Net.leaveRoom();
    L.room = null;
    L.lobby = null;
    $('roomPanel').classList.add('hidden');
    $('inviteUrl').classList.add('hidden');
    $('inviteStatus').textContent = '';
    status('');
  }

  function onGameExit() {
    L.inGame = false;
    refreshShop();
    if (L.lobby && L.room) onLobby({ ...L.lobby, now: ZR.Net.serverNow() });
  }

  function init() {
    L.profile = loadProfile();
    $('nameInput').value = L.profile.name;
    $('nameInput').addEventListener('change', saveProfile);
    initSkins();
    initShop();
    ZR.WardrobeUI.init();
    renderCodex();
    ZR.Game.init(onGameExit);
    $('btnSolo').onclick = () => {
      ZR.Audio.unlock();
      ZR.Game.startSolo(saveProfile(), Number($('botCount').value) || ZR.CONFIG.soloBots, L.teamMode);
    };
    $('teamModes').querySelectorAll('button').forEach((b) => {
      b.onclick = () => setTeamMode(b.dataset.m);
    });
    setTeamMode(localStorage.getItem('zr.teamMode') || 'solo');
    const savedFill = localStorage.getItem('zr.roomFill');
    if (savedFill && [...$('roomFill').options].some((o) => o.value === savedFill)) $('roomFill').value = savedFill;
    $('roomFill').onchange = () => {
      localStorage.setItem('zr.roomFill', $('roomFill').value);
      if (L.lobby && L.room) onLobby({ ...L.lobby, now: ZR.Net.serverNow() });
    };
    $('teamPref').onchange = () => ZR.Net.setTeamPref(Number($('teamPref').value));
    $('btnRange').onclick = () => {
      ZR.Audio.unlock();
      ZR.Game.startRange(saveProfile());
    };
    $('onlineForm').onsubmit = (event) => {
      event.preventDefault();
      ZR.Audio.unlock();
      goOnline();
    };
    $('btnInvite').onclick = copyInvite;
    $('btnLeaveRoom').onclick = leaveRoom;
    $('btnCodex').onclick = () => $('codex').classList.toggle('hidden');
    $('btnMute').onclick = () => {
      const muted = ZR.Audio.toggleMute();
      $('btnMute').textContent = muted ? '🔇 소리 꺼짐' : '🔊 소리 켜짐';
    };
    const invitedRoom = new URLSearchParams(location.search).get('room');
    if (invitedRoom) {
      $('roomInput').value = invitedRoom;
      const unlockAudio = (event) => {
        if (!event.isTrusted) return;
        ZR.Audio.unlock();
        document.removeEventListener('click', unlockAudio, true);
        document.removeEventListener('keydown', unlockAudio, true);
      };
      document.addEventListener('click', unlockAudio, true);
      document.addEventListener('keydown', unlockAudio, true);
      goOnline();
    }
  }

  function setTeamMode(m) {
    L.teamMode = MODE_LABEL[m] ? m : 'solo';
    localStorage.setItem('zr.teamMode', L.teamMode);
    $('teamModes').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.m === L.teamMode));
    if (L.lobby && L.room) onLobby({ ...L.lobby, now: ZR.Net.serverNow() });
  }

  ZR.Lobby = { init };
  window.addEventListener('DOMContentLoaded', init);
})(typeof window !== 'undefined' ? window : globalThis);
