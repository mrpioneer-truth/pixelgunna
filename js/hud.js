'use strict';
// 화면 위 DOM 정보창: 체력, 슬롯, 탄약, 회복템, 킬로그, 미니맵, 안내, 결과 화면, 순위표.
(function (root) {
  const ZR = (root.ZR = root.ZR || {});
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let el = {};
  const last = {};
  let bannerT = 0;
  let textT = 0;
  const TEXT_GAP = 0.08;

  function init() {
    el = {
      hud: $('hud'), alive: $('aliveN'), kills: $('killN'), zone: $('zoneMsg'), minimap: $('minimap'), feed: $('feed'),
      prompt: $('prompt'), progress: $('progress'), progressFill: $('progressFill'), progressText: $('progressText'),
      banner: $('banner'), hpFill: $('hpFill'), hpText: $('hpText'), boostFill: $('boostFill'), slots: $('slots'),
      mag: $('magN'), reserve: $('resN'), heals: $('heals'), gear: $('gear'), ammoInv: $('ammoInv'),
      team: $('team'), bigmap: $('bigmap'), bigmapCv: $('bigmapCv'), board: $('board'), spectate: $('spectate'), weaponName: $('weaponName'),
    };
  }

  const show = (v) => el.hud.classList.toggle('hidden', !v);

  function setHTML(key, node, html) {
    if (last[key] === html) return;
    last[key] = html;
    node.innerHTML = html;
  }

  function banner(text, dur = 3) {
    el.banner.textContent = text;
    el.banner.classList.add('on');
    bannerT = dur;
  }

  function update(world, me, focus, dt) {
    bannerT -= dt;
    if (bannerT <= 0) el.banner.classList.remove('on');
    const mm = el.minimap.getContext('2d');
    ZR.Render.drawMinimap(mm, world, el.minimap.width, focus, false);
    if (!el.bigmap.classList.contains('hidden')) ZR.Render.drawMinimap(el.bigmapCv.getContext('2d'), world, el.bigmapCv.width, focus, true);
    textT -= dt;
    if (textT > 0) return;
    textT = TEXT_GAP;
    el.alive.textContent = world.aliveCount();
    el.kills.textContent = me ? me.kills : 0;
    zoneText(world);
    feed(world);
    if (me) playerPanel(world, me);
  }

  function zoneText(world) {
    const z = world.zoneState;
    if (z.phase < 0) {
      el.zone.textContent = '시험장 · 자기장 없음';
      return;
    }
    const s = Math.ceil(z.remain);
    const me = world.local;
    const under = me && me.alive && world.isUnder(me.x) ? ' · 🔦 지하' : '';
    el.zone.textContent = (z.phase >= 7 ? '⚠ 최종 자기장' : z.shrinking ? `⚠ 자기장 축소 중 ${s}s` : `자기장 축소까지 ${s}s`) + under;
    el.zone.classList.toggle('warn', z.shrinking);
  }

  function feed(world) {
    const html = world.feed.map((f) => `<div class="feedrow${f.mine ? ' mine' : ''}">${f.killer ? `<b>${esc(f.killer)}</b> ` : ''}<span class="w">[${esc(f.weapon)}]</span> <b>${esc(f.victim)}</b></div>`).join('');
    setHTML('feed', el.feed, html);
  }

  function playerPanel(world, me) {
    const hpPct = Math.max(0, me.hp) / ZR.CONFIG.maxHp;
    el.hpFill.style.width = `${hpPct * 100}%`;
    el.hpFill.style.background = hpPct > 0.6 ? '#e8e8e8' : hpPct > 0.3 ? '#ffcc4d' : '#ff4d4d';
    el.hpText.textContent = Math.ceil(Math.max(0, me.hp));
    el.boostFill.style.width = `${me.boost}%`;
    slots(me);
    ammo(me);
    heals(me);
    gear(me);
    progress(me);
    prompt(world, me);
    teamPanel(world, me);
  }

  function teamPanel(world, me) {
    const mates = world.teammates(me);
    const html = mates.map((p) => {
      const hp = p.alive ? Math.max(0, Math.round(p.hp)) : 0;
      const where = p.alive && world.isUnder(p.x) !== world.isUnder(me.x) ? (world.isUnder(p.x) ? ' · 지하' : ' · 지상') : '';
      return `<div class="mate${p.alive ? '' : ' dead'}"><span>${esc(p.name)}${where}</span><div class="mbar"><i style="width:${hp}%"></i></div></div>`;
    }).join('');
    setHTML('team', el.team, html);
  }

  function slots(me) {
    const names = ['1', '2', '3', '4'];
    const html = me.slots.map((s, i) => {
      if (!s) return `<div class="slot empty"><i>${names[i]}</i></div>`;
      const def = ZR.W[s.wid];
      const extra = i === 3 ? ` x${me.throws[s.wid] || 0}` : def.kind === 'gun' ? ` <small>${s.mag}/${def.mag}</small>` : '';
      return `<div class="slot${i === me.cur ? ' on' : ''}" style="--c:${ZR.Weapons.color(s.wid)}"><i>${names[i]}</i>${esc(def.name)}${extra}</div>`;
    }).join('');
    setHTML('slots', el.slots, html);
    const def = me.weapon;
    el.weaponName.textContent = def ? `${def.name} · ${ZR.Weapons.RARITY[def.rarity].name}${def.desc ? ` · ${def.desc}` : ''}` : '';
    el.weaponName.style.color = def ? ZR.Weapons.color(me.wid) : '#fff';
  }

  function ammo(me) {
    const def = me.weapon;
    if (def && def.kind === 'gun') {
      el.mag.textContent = me.slot.mag;
      el.reserve.textContent = me.ammo[def.ammo];
      el.mag.parentElement.style.visibility = 'visible';
    } else {
      el.mag.parentElement.style.visibility = 'hidden';
    }
    const A = ZR.Weapons.AMMO;
    const html = Object.keys(A).map((k) => `<div style="color:${A[k].color}" class="${me.ammo[k] ? '' : 'dim'}">${A[k].name} <b>${me.ammo[k]}</b></div>`).join('');
    setHTML('ammoInv', el.ammoInv, html);
  }

  function heals(me) {
    const H = ZR.Items.HEALS;
    const html = Object.keys(H).map((k) => `<div class="heal${me.heals[k] ? '' : ' dim'}"><i>${H[k].key}</i>${H[k].name} <b>${me.heals[k]}</b></div>`).join('');
    setHTML('heals', el.heals, html);
  }

  function gear(me) {
    const html = `<span>헬멧 ${me.helmet || '-'}</span><span>조끼 ${me.vest || '-'}</span><span>가방 ${me.pack || '-'}</span><span>${me.scope}x</span>`;
    setHTML('gear', el.gear, html);
  }

  function progress(me) {
    let k = 0, text = '';
    if (me.action) {
      k = me.action.t / me.action.dur;
      text = `${ZR.Items.HEALS[me.action.key].name} 사용 중`;
    } else if (me.reloadT > 0) {
      k = 1 - me.reloadT / me.reloadDur;
      text = '재장전';
    }
    el.progress.classList.toggle('hidden', !text);
    el.progressFill.style.width = `${k * 100}%`;
    el.progressText.textContent = text;
  }

  function prompt(world, me) {
    const it = me.alive ? ZR.PlayerSys.nearestLoot(world, me, false) : null;
    const link = me.alive && !it ? world.nearLink(me) : null;
    if (link) {
      el.prompt.classList.remove('hidden');
      el.prompt.innerHTML = link.up ? '<kbd>F</kbd> 지상으로 올라가기' : '<kbd>F</kbd> <span style="color:#7dff9a">수상한 해치… 내려가기</span>';
      return;
    }
    if (!it) {
      el.prompt.classList.add('hidden');
      return;
    }
    const manual = it.type === 'gun' || it.type === 'melee';
    const auto = ZR.PlayerSys.canAutoPick(me, it);
    el.prompt.classList.remove('hidden');
    el.prompt.innerHTML = `${manual ? '<kbd>F</kbd> ' : ''}<span style="color:${ZR.Items.color(it)}">${esc(ZR.Items.label(it))}</span>${!manual && !auto ? ' <small>(가득 참)</small>' : ''}`;
  }

  function toggleBigmap(v) { el.bigmap.classList.toggle('hidden', !v); }

  function board(world, visible) {
    el.board.classList.toggle('hidden', !visible);
    if (!visible) return;
    const rows = [...world.players.values()]
      .sort((a, b) => (b.alive - a.alive) || (b.kills - a.kills) || ((a.rank || 0) - (b.rank || 0)))
      .map((p, i) => `<tr class="${p.id === world.localId ? 'me' : ''}${p.alive ? '' : ' dead'}"><td>${i + 1}</td><td>${esc(p.name)}</td><td>${p.kills}</td><td>${p.alive ? '생존' : `#${p.rank}`}</td></tr>`)
      .join('');
    setHTML('board', el.board, `<table><tr><th>#</th><th>이름</th><th>킬</th><th>상태</th></tr>${rows}</table>`);
  }

  function spectating(name) {
    el.spectate.classList.toggle('hidden', !name);
    if (name) el.spectate.innerHTML = `관전 중: <b>${esc(name)}</b> <small>(← → 로 변경)</small>`;
  }

  // 결과 화면. buttons: [{label, onClick, primary}]
  function result({ title, rank, total, kills, dmg, sub, wardrobeCode }, buttons) {
    const box = $('result');
    box.classList.remove('hidden');
    $('resultTitle').textContent = title;
    $('resultStats').innerHTML = `<div><b>#${rank}</b><span>/ ${total}</span></div><div><b>${kills}</b><span>킬</span></div><div><b>${Math.round(dmg)}</b><span>피해량</span></div>`;
    resultNote(sub);
    $('resultWardrobe').classList.toggle('hidden', !wardrobeCode);
    const code = $('resultWardrobeCode');
    code.value = wardrobeCode || '';
    const copy = $('copyWardrobeCode');
    copy.textContent = '코드 복사';
    copy.onclick = async () => {
      code.focus();
      code.select();
      try {
        await navigator.clipboard.writeText(code.value);
        copy.textContent = '복사 완료';
      } catch (err) {
        copy.textContent = '코드 선택됨';
      }
    };
    const wrap = $('resultBtns');
    wrap.innerHTML = '';
    buttons.forEach((b) => {
      const btn = document.createElement('button');
      btn.textContent = b.label;
      if (b.primary) btn.className = 'primary';
      btn.onclick = b.onClick;
      wrap.append(btn);
    });
  }

  const resultNote = (text) => { $('resultSub').textContent = text || ''; };
  const hideResult = () => $('result').classList.add('hidden');

  ZR.HUD = Object.freeze({ init, show, update, banner, toggleBigmap, board, spectating, result, resultNote, hideResult, esc });
})(typeof window !== 'undefined' ? window : globalThis);
