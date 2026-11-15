'use strict';
// 캔버스 그리기: 땅 → 건물 바닥 → 전리품 → 장애물 → 플레이어 → 투사체 → 나무·덤불 → 지붕 → 효과 → 자기장.
(function (root) {
  const ZR = (root.ZR = root.ZR || {});
  const U = ZR.U;
  const TAU = U.TAU;

  let cv, ctx, dpr = 1;
  const GRID = 100;

  function init(canvas) {
    cv = canvas;
    ctx = cv.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
  }

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.floor(window.innerWidth * dpr);
    cv.height = Math.floor(window.innerHeight * dpr);
  }

  const viewSize = () => ({ w: cv.width / dpr, h: cv.height / dpr });

  function draw(world, cam) {
    const { w, h } = viewSize();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#2b3a22';
    ctx.fillRect(0, 0, w, h);
    const sx = (Math.random() - 0.5) * world.shakeAmt, sy = (Math.random() - 0.5) * world.shakeAmt;
    ctx.translate(w / 2 + sx, h / 2 + sy);
    ctx.scale(cam.scale, cam.scale);
    ctx.translate(-cam.x, -cam.y);
    const half = { x: w / 2 / cam.scale + 80, y: h / 2 / cam.scale + 80 };
    const view = { x0: cam.x - half.x, y0: cam.y - half.y, x1: cam.x + half.x, y1: cam.y + half.y };
    const me = world.local;
    const under = world.isUnder(cam.x);
    const inside = me && me.alive ? world.map.buildings.find((b) => me.x > b.x && me.x < b.x + b.w && me.y > b.y && me.y < b.y + b.h) : null;

    if (under) {
      drawUnderground(world, view, me);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawDarkness(w, h, cam);
      return;
    }
    drawGround(world, view);
    drawHatches(world, 'surface');
    world.map.buildings.forEach((b) => {
      ctx.fillStyle = b.floor;
      ctx.fillRect(b.x, b.y, b.w, b.h);
    });
    const visible = world.map.grid.query(view.x0, view.y0, view.x1, view.y1);
    drawLoot(world, view);
    drawFields(world, 'under');
    visible.filter((o) => o.kind !== 'tree' && o.kind !== 'bush').forEach(drawObstacle);
    drawNades(world);
    for (const p of world.players.values()) if (!p.alive && inView(p, view)) drawCorpse(p);
    for (const p of world.players.values()) {
      if (!p.alive || !inView(p, view)) continue;
      const hid = hiddenByRoof(world, p, inside);
      if (!hid) drawPlayer(world, p, me);
    }
    drawProjectiles(world);
    for (const p of world.players.values()) if (p.beamSegs && !hiddenByRoof(world, p, inside)) drawBeams(p);
    visible.filter((o) => o.kind === 'bush').forEach((o) => drawBush(o, me));
    visible.filter((o) => o.kind === 'tree').forEach(drawTree);
    world.map.buildings.forEach((b) => { if (b !== inside) drawRoof(b); });
    drawFields(world, 'over');
    drawFx(world);
    drawAirdropMarkers(world);
    drawZone(world, view);
    drawTexts(world);
  }

  const inView = (p, v) => p.x > v.x0 && p.x < v.x1 && p.y > v.y0 && p.y < v.y1;

  // ---- 지하 벙커 (들어간 사람에게만 그려진다) ----
  function drawUnderground(world, view, me) {
    const R = world.map.under;
    ctx.fillStyle = '#07080a';
    ctx.fillRect(R.x - 400, R.y - 400, R.w + 800, R.h + 800);
    const tints = ['#24222b', '#1f2a2a', '#2b2422'];
    for (const room of world.map.rooms) {
      ctx.fillStyle = tints[room.tint];
      ctx.fillRect(room.x, room.y, room.w, room.h);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = R.x; x <= R.x + R.w; x += 60) {
      ctx.moveTo(x, R.y);
      ctx.lineTo(x, R.y + R.h);
    }
    for (let y = R.y; y <= R.y + R.h; y += 60) {
      ctx.moveTo(R.x, y);
      ctx.lineTo(R.x + R.w, y);
    }
    ctx.stroke();
    drawHatches(world, 'under');
    drawLoot(world, view);
    drawFields(world, 'under');
    const visible = world.map.grid.query(view.x0, view.y0, view.x1, view.y1);
    visible.forEach((o) => (o.kind === 'wall' ? drawBunkerWall(o) : o.kind === 'pillar' ? drawPillar(o) : drawObstacle(o)));
    drawNades(world);
    for (const p of world.players.values()) if (!p.alive && inView(p, view)) drawCorpse(p);
    for (const p of world.players.values()) if (p.alive && inView(p, view)) drawPlayer(world, p, me);
    drawProjectiles(world);
    for (const p of world.players.values()) if (p.beamSegs && inView(p, view)) drawBeams(p);
    drawFields(world, 'over');
    drawFx(world);
    drawTexts(world);
  }

  function drawBunkerWall(o) {
    ctx.fillStyle = '#4a4f5c';
    ctx.fillRect(o.x, o.y, o.w, o.h);
    ctx.fillStyle = 'rgba(255,200,60,0.5)';
    for (let i = 0; i < Math.max(o.w, o.h); i += 40) {
      if (o.w > o.h) ctx.fillRect(o.x + i, o.y, 18, 4);
      else ctx.fillRect(o.x, o.y + i, 4, 18);
    }
  }

  function drawPillar(o) {
    ctx.fillStyle = '#5a5f6e';
    ctx.strokeStyle = '#2b2e36';
    ctx.lineWidth = 5;
    circle(o.x, o.y, o.r);
    ctx.fill();
    ctx.stroke();
  }

  // 손전등 느낌: 화면 중앙(플레이어) 주변만 밝다
  function drawDarkness(w, h, cam) {
    const r = 330 * cam.scale;
    const g = ctx.createRadialGradient(w / 2, h / 2, r * 0.35, w / 2, h / 2, r * 1.6);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.6, 'rgba(0,0,0,0.55)');
    g.addColorStop(1, 'rgba(0,0,0,0.92)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  // 지상에선 해치, 지하에선 올라가는 계단
  function drawHatches(world, layer) {
    const t = performance.now() / 1000;
    for (const l of world.map.links) {
      const x = layer === 'surface' ? l.hx : l.sx, y = layer === 'surface' ? l.hy : l.sy;
      ctx.save();
      ctx.translate(x, y);
      ctx.fillStyle = layer === 'surface' ? '#3b3f45' : '#2d3a2d';
      ctx.strokeStyle = layer === 'surface' ? '#1c1e22' : '#7dff9a';
      ctx.lineWidth = 5;
      circle(0, 0, 34);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = layer === 'surface' ? '#6b7079' : '#7dff9a';
      ctx.lineWidth = 3;
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(-22, i * 8);
        ctx.lineTo(22, i * 8);
        ctx.stroke();
      }
      if (layer === 'under') {
        ctx.globalAlpha = 0.4 + Math.sin(t * 3) * 0.2;
        ctx.strokeStyle = '#7dff9a';
        circle(0, 0, 44);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }
  }

  function hiddenByRoof(world, p, inside) {
    if (p.id === world.localId) return false;
    const b = world.map.buildings.find((bb) => p.x > bb.x && p.x < bb.x + bb.w && p.y > bb.y && p.y < bb.y + bb.h);
    return b && b !== inside;
  }

  function drawGround(world, v) {
    const s = world.size;
    ctx.fillStyle = '#4f7a35';
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(0,0,0,0.08)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = Math.max(0, Math.floor(v.x0 / GRID) * GRID); x <= Math.min(s, v.x1); x += GRID) {
      ctx.moveTo(x, Math.max(0, v.y0));
      ctx.lineTo(x, Math.min(s, v.y1));
    }
    for (let y = Math.max(0, Math.floor(v.y0 / GRID) * GRID); y <= Math.min(s, v.y1); y += GRID) {
      ctx.moveTo(Math.max(0, v.x0), y);
      ctx.lineTo(Math.min(s, v.x1), y);
    }
    ctx.stroke();
    ctx.strokeStyle = '#1d2a16';
    ctx.lineWidth = 12;
    ctx.strokeRect(0, 0, s, s);
  }

  function drawLoot(world, v) {
    const t = performance.now() / 1000;
    for (const it of world.loot.values()) {
      if (it.x < v.x0 || it.x > v.x1 || it.y < v.y0 || it.y > v.y1) continue;
      const col = ZR.Items.color(it);
      const big = it.type === 'gun' || it.type === 'melee';
      const r = big ? 20 : 14;
      ctx.save();
      ctx.translate(it.x, it.y);
      if (big && ZR.Weapons.rank(it.key) >= 3) {
        ctx.globalAlpha = 0.35 + Math.sin(t * 4) * 0.15;
        ctx.fillStyle = col;
        circle(0, 0, r + 8);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = 'rgba(20,24,20,0.7)';
      ctx.strokeStyle = col;
      ctx.lineWidth = 3;
      circle(0, 0, r);
      ctx.fill();
      ctx.stroke();
      lootIcon(it, col, r);
      ctx.restore();
    }
  }

  function lootIcon(it, col, r) {
    ctx.fillStyle = col;
    ctx.strokeStyle = col;
    switch (it.type) {
      case 'gun': {
        const def = ZR.W[it.key];
        const len = Math.min(28, 10 + def.barrel * 0.35);
        ctx.fillRect(-len / 2, -3, len, Math.min(9, def.bw * 0.6));
        ctx.fillRect(-len / 2, 0, 5, 7);
        break;
      }
      case 'melee':
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(-9, 9);
        ctx.lineTo(9, -9);
        ctx.stroke();
        break;
      case 'throw':
        circle(0, 1, 7);
        ctx.fill();
        ctx.fillRect(-2, -9, 4, 4);
        break;
      case 'ammo':
        ctx.fillRect(-7, -6, 4, 12);
        ctx.fillRect(-1, -6, 4, 12);
        ctx.fillRect(5, -6, 3, 12);
        break;
      case 'heal':
        ctx.fillStyle = '#e33';
        ctx.fillRect(-2.5, -8, 5, 16);
        ctx.fillRect(-8, -2.5, 16, 5);
        break;
      default:
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(it.type === 'scope' ? `${it.level}x` : `${{ armor: it.key === 'helmet' ? 'H' : 'V', pack: 'B' }[it.type]}${it.level}`, 0, 1);
    }
    void r;
  }

  function circle(x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
  }

  function hitWobble(o) {
    return o.hitT > 0 ? (Math.random() - 0.5) * 4 : 0;
  }

  function drawObstacle(o) {
    const wob = hitWobble(o);
    const hpK = Number.isFinite(o.maxHp) ? 0.75 + 0.25 * Math.max(0, o.hp / o.maxHp) : 1;
    switch (o.kind) {
      case 'wall':
        ctx.fillStyle = '#3a3530';
        ctx.fillRect(o.x, o.y, o.w, o.h);
        break;
      case 'rock': {
        const g = 140 + (o.tint || 0);
        ctx.fillStyle = `rgb(${g},${g},${g + 4})`;
        ctx.strokeStyle = '#555';
        ctx.lineWidth = 4;
        circle(o.x + wob, o.y, o.r * hpK);
        ctx.fill();
        ctx.stroke();
        break;
      }
      case 'crate':
      case 'airdrop': {
        const s = hpK;
        const cx = o.x + o.w / 2 + wob, cy = o.y + o.h / 2;
        const hw = (o.w / 2) * s, hh = (o.h / 2) * s;
        ctx.fillStyle = o.kind === 'airdrop' ? '#c9ccd1' : '#a8763e';
        ctx.strokeStyle = o.kind === 'airdrop' ? '#ff3d6e' : '#6b4521';
        ctx.lineWidth = 5;
        ctx.fillRect(cx - hw, cy - hh, hw * 2, hh * 2);
        ctx.strokeRect(cx - hw, cy - hh, hw * 2, hh * 2);
        ctx.beginPath();
        ctx.moveTo(cx - hw, cy - hh);
        ctx.lineTo(cx + hw, cy + hh);
        ctx.moveTo(cx + hw, cy - hh);
        ctx.lineTo(cx - hw, cy + hh);
        ctx.lineWidth = 3;
        ctx.stroke();
        break;
      }
      case 'barrel':
        ctx.fillStyle = '#c0392b';
        ctx.strokeStyle = '#6e1a12';
        ctx.lineWidth = 4;
        circle(o.x + wob, o.y, o.r * hpK);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#ffd34d';
        circle(o.x + wob, o.y, o.r * 0.35);
        ctx.fill();
        break;
      default:
    }
  }

  function drawTree(o) {
    const wob = hitWobble(o);
    const k = 0.7 + 0.3 * Math.max(0, o.hp / o.maxHp);
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = '#2f6b2a';
    circle(o.x + wob, o.y, o.canopy * k);
    ctx.fill();
    ctx.fillStyle = '#3d8436';
    circle(o.x + wob - 6, o.y - 6, o.canopy * k * 0.65);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#5a3d22';
    circle(o.x + wob, o.y, o.r * 0.55);
    ctx.fill();
  }

  function drawBush(o, me) {
    const near = me && U.dist2(me.x, me.y, o.x, o.y) < o.r * o.r;
    ctx.globalAlpha = near ? 0.45 : 0.9;
    ctx.fillStyle = '#3f7d31';
    circle(o.x + hitWobble(o), o.y, o.r);
    ctx.fill();
    ctx.fillStyle = '#4e9440';
    circle(o.x - 8, o.y - 8, o.r * 0.55);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function drawRoof(b) {
    ctx.fillStyle = b.roof;
    ctx.fillRect(b.x - 4, b.y - 4, b.w + 8, b.h + 8);
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let x = b.x + 30; x < b.x + b.w; x += 30) {
      ctx.moveTo(x, b.y - 4);
      ctx.lineTo(x, b.y + b.h + 4);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 6;
    ctx.strokeRect(b.x - 4, b.y - 4, b.w + 8, b.h + 8);
  }

  // ---- 플레이어 ----
  function drawPlayer(world, p, me) {
    const def = p.weapon || ZR.W.fists;
    ctx.save();
    ctx.translate(p.x, p.y);
    if (p.isBot && p.brain && p.brain.dummy) ctx.globalAlpha = 0.85;
    ctx.rotate(p.angle);
    drawHeld(p, def);
    if (p.vest) {
      ctx.fillStyle = ['', '#7d8a6a', '#5d6f8c', '#2d2f36'][p.vest];
      circle(0, 0, p.r + 4);
      ctx.fill();
    }
    const hasSkin = p.skin !== 'default' && p.hurtT <= 0 && ZR.Cosmetics.draw(ctx, p.skin, p.r);
    if (!hasSkin) {
      ctx.fillStyle = p.hurtT > 0 ? '#fff' : p.color;
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth = 3;
      circle(0, 0, p.r);
      ctx.fill();
      ctx.stroke();
    }
    if (p.helmet) {
      const helmetColor = ['', '#6b7d4f', '#4f6a8a', '#22252c'][p.helmet];
      if (hasSkin) {
        ctx.strokeStyle = helmetColor;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(0, 0, p.r + 1, 2.4, 3.9);
        ctx.stroke();
      } else {
        ctx.fillStyle = helmetColor;
        circle(-3, 0, p.r * 0.62);
        ctx.fill();
      }
    }
    if (p.slow) {
      ctx.strokeStyle = 'rgba(150,220,255,0.9)';
      ctx.lineWidth = 4;
      circle(0, 0, p.r + 6);
      ctx.stroke();
    }
    ctx.restore();
    if (p.burn) {
      for (let i = 0; i < 2; i++) world.addFx({ kind: 'ember', x: p.x + (Math.random() - 0.5) * 30, y: p.y + (Math.random() - 0.5) * 30, vx: 0, vy: -50, t: 0, life: 0.4, color: '#ff7b29' });
    }
    if (p !== me) {
      const mate = me && p.team != null && p.team === me.team;
      if (mate) {
        ctx.strokeStyle = 'rgba(125,255,154,0.85)';
        ctx.lineWidth = 3;
        circle(p.x, p.y, p.r + 9);
        ctx.stroke();
      }
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillText(p.name, p.x + 1, p.y - p.r - 13);
      ctx.fillStyle = mate ? '#7dff9a' : '#fff';
      ctx.fillText(p.name, p.x, p.y - p.r - 14);
    }
    if (p.skinTag) {
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0,0,0,0.72)';
      const width = Math.min(ctx.measureText(p.skinTag).width, 130);
      ctx.fillRect(p.x - width / 2 - 4, p.y + p.r + 7, width + 8, 15);
      ctx.fillStyle = '#ffe5a0';
      ctx.fillText(p.skinTag, p.x, p.y + p.r + 18, 130);
    }
    if (p.charge > 0 && def.charge) {
      ctx.strokeStyle = def.color || '#7cf';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r + 10, -Math.PI / 2, -Math.PI / 2 + TAU * (p.charge / def.charge));
      ctx.stroke();
    }
  }

  function hand(x, y, color) {
    ctx.fillStyle = color;
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 2.5;
    circle(x, y, 7);
    ctx.fill();
    ctx.stroke();
  }

  function drawHeld(p, def) {
    const skin = p.color;
    if (def.kind === 'gun') {
      const col = ZR.Weapons.color(p.wid);
      const len = def.barrel + 10;
      ctx.fillStyle = '#222';
      ctx.fillRect(p.r - 8, -def.bw / 2 - 1, len + 2, def.bw + 2);
      ctx.fillStyle = col;
      ctx.fillRect(p.r - 7, -def.bw / 2, len, def.bw);
      if (def.spinUp && p.spin > 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.fillRect(p.r + len - 16, -def.bw / 2, 8, def.bw);
      }
      hand(p.r + 4, 6, skin);
      hand(p.r + Math.min(len - 6, 26), -4, skin);
      return;
    }
    if (def.kind === 'throw') {
      const k = p.swingT > 0 ? p.swingT / 0.25 : 0;
      hand(p.r - 4 + k * 18, p.r * 0.75, skin);
      hand(p.r - 2, -p.r * 0.75, skin);
      ctx.fillStyle = def.color;
      circle(p.r - 2, -p.r * 0.75 - 2, 6);
      ctx.fill();
      return;
    }
    const swing = p.swingT > 0 ? Math.sin((p.swingT / 0.22) * Math.PI) * p.swingSide : 0;
    if (p.wid === 'fists') {
      hand(p.r * 0.8 + (swing > 0 ? swing * 18 : 0), p.r * 0.7, skin);
      hand(p.r * 0.8 + (swing < 0 ? -swing * 18 : 0), -p.r * 0.7, skin);
      return;
    }
    ctx.save();
    ctx.rotate(swing * 1.1);
    ctx.fillStyle = def.color || '#ccc';
    ctx.shadowColor = def.color || '#fff';
    ctx.shadowBlur = def.rarity === 'common' ? 0 : 12;
    const blade = def.range * 0.75;
    ctx.fillRect(p.r, -3, blade, p.wid === 'hammer' ? 6 : 5);
    if (p.wid === 'hammer') ctx.fillRect(p.r + blade - 14, -14, 18, 28);
    if (p.wid === 'scythe') {
      ctx.beginPath();
      ctx.arc(p.r + blade - 10, -26, 28, 0.3, 1.9);
      ctx.lineWidth = 7;
      ctx.strokeStyle = def.color;
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
    hand(p.r, 5, skin);
    ctx.restore();
    hand(p.r * 0.5, -p.r * 0.85, skin);
  }

  function drawCorpse(p) {
    ctx.fillStyle = 'rgba(80,10,10,0.5)';
    circle(p.x, p.y, p.r * 1.3);
    ctx.fill();
    ctx.fillStyle = 'rgba(30,30,30,0.6)';
    circle(p.x, p.y, p.r * 0.7);
    ctx.fill();
  }

  // ---- 투사체·광선 ----
  function drawProjectiles(world) {
    for (const pr of world.projectiles) {
      if (pr.kind === 'nade') continue;
      if (pr.kind === 'lob') {
        const s = 1 + (pr.h || 0) / 80;
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        circle(pr.x, pr.y, pr.r);
        ctx.fill();
        ctx.fillStyle = '#ff9f43';
        circle(pr.x, pr.y - (pr.h || 0), pr.r * s);
        ctx.fill();
        continue;
      }
      if (pr.kind === 'flame') {
        const k = 1 - pr.life / 0.62;
        ctx.globalAlpha = Math.max(0.15, 0.75 - k * 0.5);
        ctx.fillStyle = k < 0.3 ? '#ffe066' : k < 0.6 ? '#ff7b29' : '#c0392b';
        circle(pr.x, pr.y, pr.r);
        ctx.fill();
        ctx.globalAlpha = 1;
        continue;
      }
      if (pr.kind === 'singularity') {
        ctx.fillStyle = '#120022';
        ctx.strokeStyle = '#b86bff';
        ctx.lineWidth = 4;
        circle(pr.x, pr.y, pr.r);
        ctx.fill();
        ctx.stroke();
        continue;
      }
      const sp = Math.hypot(pr.vx, pr.vy) || 1;
      const tail = Math.min(60, sp * 0.03) + pr.r * 2;
      ctx.strokeStyle = pr.color;
      ctx.lineWidth = pr.r * 1.4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(pr.x - (pr.vx / sp) * tail, pr.y - (pr.vy / sp) * tail);
      ctx.lineTo(pr.x, pr.y);
      ctx.stroke();
      if (pr.fx.explode) {
        ctx.fillStyle = '#ffde59';
        circle(pr.x, pr.y, pr.r * 0.9);
        ctx.fill();
      }
    }
    ctx.lineCap = 'butt';
  }

  function drawNades(world) {
    for (const pr of world.projectiles) {
      if (pr.kind !== 'nade') continue;
      const lift = pr.h || 0;
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      circle(pr.x, pr.y, 8);
      ctx.fill();
      ctx.fillStyle = pr.color;
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 2;
      circle(pr.x, pr.y - lift, 8 + lift / 10);
      ctx.fill();
      ctx.stroke();
      const def = ZR.W[pr.wid];
      if (pr.t > pr.flight) {
        const k = (pr.t - pr.flight) / Math.max(0.01, pr.fuse - pr.flight);
        ctx.strokeStyle = `rgba(255,60,60,${0.2 + 0.4 * k})`;
        ctx.lineWidth = 2;
        circle(pr.x, pr.y, def.r);
        ctx.stroke();
      }
    }
  }

  function drawBeams(p) {
    const def = p.weapon;
    ctx.lineCap = 'round';
    for (const s of p.beamSegs) {
      ctx.strokeStyle = def.beamColor;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = def.beamWidth * 2.6 + Math.random() * 4;
      line(s.x1, s.y1, s.x2, s.y2);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = def.beamWidth * 0.6;
      line(s.x1, s.y1, s.x2, s.y2);
      ctx.fillStyle = def.beamColor;
      circle(s.x2, s.y2, def.beamWidth + Math.random() * 6);
      ctx.fill();
    }
    ctx.lineCap = 'butt';
  }

  function line(x1, y1, x2, y2) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  function drawFields(world, layer) {
    const t = performance.now() / 1000;
    for (const f of world.fields) {
      if (f.kind === 'meteor' && layer === 'under') {
        const k = f.t / f.dur;
        ctx.strokeStyle = 'rgba(255,80,30,0.9)';
        ctx.lineWidth = 4;
        circle(f.x, f.y, f.r);
        ctx.stroke();
        ctx.fillStyle = `rgba(255,80,30,${0.15 + k * 0.3})`;
        circle(f.x, f.y, f.r * k);
        ctx.fill();
      } else if (f.kind === 'meteor' && layer === 'over') {
        const k = f.t / f.dur;
        const mx = f.x + (1 - k) * 260, my = f.y - (1 - k) * 520;
        ctx.fillStyle = '#ffcf5a';
        circle(mx, my, 22);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,120,40,0.7)';
        ctx.lineWidth = 16;
        line(mx, my, mx + 90, my - 180);
      } else if (f.kind === 'fire' && layer === 'under') {
        ctx.fillStyle = `rgba(255,${90 + Math.sin(t * 20) * 30},20,0.3)`;
        circle(f.x, f.y, f.r);
        ctx.fill();
      } else if (f.kind === 'hole' && layer === 'over') {
        drawHole(f, t);
      }
    }
  }

  function drawHole(f, t) {
    const grad = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r);
    grad.addColorStop(0, 'rgba(0,0,0,0.95)');
    grad.addColorStop(0.25, 'rgba(40,0,80,0.8)');
    grad.addColorStop(1, 'rgba(120,60,255,0)');
    ctx.fillStyle = grad;
    circle(f.x, f.y, f.r);
    ctx.fill();
    ctx.strokeStyle = 'rgba(200,150,255,0.7)';
    ctx.lineWidth = 3;
    for (let i = 0; i < 4; i++) {
      const a = t * 4 + (i * TAU) / 4;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r * (0.3 + 0.15 * i), a, a + 1.6);
      ctx.stroke();
    }
  }

  function drawFx(world) {
    for (const f of world.fx) {
      const k = f.t / f.life;
      switch (f.kind) {
        case 'boom': {
          ctx.globalAlpha = 1 - k;
          ctx.fillStyle = k < 0.2 ? '#fff6c2' : f.color;
          circle(f.x, f.y, f.r * (0.4 + k * 0.7));
          ctx.fill();
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 6 * (1 - k);
          circle(f.x, f.y, f.r * (0.6 + k * 0.5));
          ctx.stroke();
          ctx.globalAlpha = 1;
          break;
        }
        case 'nukeflash':
          ctx.globalAlpha = (1 - k) * 0.8;
          ctx.fillStyle = '#fffbe0';
          circle(f.x, f.y, 600 * (0.3 + k));
          ctx.fill();
          ctx.globalAlpha = 1;
          break;
        case 'flash':
          ctx.fillStyle = f.color;
          ctx.globalAlpha = 1 - k;
          circle(f.x, f.y, 10);
          ctx.fill();
          ctx.globalAlpha = 1;
          break;
        case 'spark':
        case 'chip':
        case 'ember':
          ctx.globalAlpha = 1 - k;
          ctx.fillStyle = f.color;
          ctx.fillRect(f.x - 2.5, f.y - 2.5, 5, 5);
          ctx.globalAlpha = 1;
          break;
        case 'rail':
          ctx.globalAlpha = 1 - k;
          ctx.strokeStyle = f.color;
          ctx.lineWidth = 18 * (1 - k) + 2;
          line(f.x, f.y, f.x2, f.y2);
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 4 * (1 - k) + 1;
          line(f.x, f.y, f.x2, f.y2);
          ctx.globalAlpha = 1;
          break;
        case 'bolt':
          drawBolt(f, k);
          break;
        case 'slash':
          ctx.globalAlpha = 0.6 * (1 - k);
          ctx.strokeStyle = f.color;
          ctx.lineWidth = 10;
          ctx.beginPath();
          ctx.arc(f.x, f.y, f.r, f.a - f.arc / 2, f.a + f.arc / 2);
          ctx.stroke();
          ctx.globalAlpha = 1;
          break;
        case 'label':
          ctx.globalAlpha = 1 - k;
          ctx.font = 'bold 15px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillStyle = f.color;
          ctx.fillText(f.text, f.x, f.y - k * 30);
          ctx.globalAlpha = 1;
          break;
        default:
      }
    }
  }

  function drawBolt(f, k) {
    ctx.globalAlpha = 1 - k;
    ctx.strokeStyle = f.color;
    ctx.lineWidth = 4;
    ctx.beginPath();
    f.points.forEach((pt, i) => {
      if (i === 0) {
        ctx.moveTo(pt.x, pt.y);
        return;
      }
      const prev = f.points[i - 1];
      for (let s = 1; s <= 5; s++) {
        const q = s / 5;
        const j = s === 5 ? 0 : (Math.random() - 0.5) * 30;
        ctx.lineTo(U.lerp(prev.x, pt.x, q) + j, U.lerp(prev.y, pt.y, q) + j);
      }
    });
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawAirdropMarkers(world) {
    for (const d of world.airdrops) {
      if (!d.announced || d.landed) continue;
      const k = U.clamp(1 - (d.t - world.time) / 10, 0, 1);
      ctx.fillStyle = `rgba(0,0,0,${0.15 + k * 0.25})`;
      circle(d.x, d.y, 20 + k * 30);
      ctx.fill();
      ctx.strokeStyle = '#ff3d6e';
      ctx.lineWidth = 3;
      circle(d.x, d.y, 60);
      ctx.stroke();
    }
  }

  function drawZone(world, v) {
    const z = world.zoneState;
    if (!z || z.dps <= 0) return;
    ctx.fillStyle = 'rgba(200,30,60,0.28)';
    ctx.beginPath();
    ctx.rect(v.x0 - 100, v.y0 - 100, v.x1 - v.x0 + 200, v.y1 - v.y0 + 200);
    ctx.arc(z.x, z.y, Math.max(1, z.r), 0, TAU, true);
    ctx.fill('evenodd');
    ctx.strokeStyle = 'rgba(255,60,80,0.9)';
    ctx.lineWidth = 5;
    circle(z.x, z.y, Math.max(1, z.r));
    ctx.stroke();
    if (z.tr < z.r - 1) {
      ctx.setLineDash([24, 16]);
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 4;
      circle(z.tx, z.ty, Math.max(1, z.tr));
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function drawTexts(world) {
    ctx.textAlign = 'center';
    for (const t of world.texts) {
      const k = t.t / t.life;
      const big = t.amt >= 40;
      ctx.globalAlpha = 1 - k * k;
      ctx.font = `900 ${big ? 26 : 18}px sans-serif`;
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      const y = t.y - k * 40;
      const s = Math.round(t.amt).toString();
      ctx.strokeText(s, t.x, y);
      ctx.fillStyle = big ? '#ff5470' : '#ffe066';
      ctx.fillText(s, t.x, y);
    }
    ctx.globalAlpha = 1;
  }

  // ---- 미니맵 ----
  // 지상 지도에는 지하 벙커가 나오지 않는다. 벙커 안에 있을 때만 벙커 지도를 보여준다.
  const caches = new Map();
  function cached(world, size, under) {
    const key = `${world.seed}:${size}:${under ? 'u' : 's'}`;
    if (!caches.has(key)) {
      if (caches.size > 6) caches.clear();
      caches.set(key, under ? buildUnderCache(world, size) : buildMapCache(world, size));
    }
    return caches.get(key);
  }

  function buildMapCache(world, size) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const k = size / world.size;
    g.fillStyle = '#4f7a35';
    g.fillRect(0, 0, size, size);
    world.map.buildings.forEach((b) => {
      g.fillStyle = b.roof;
      g.fillRect(b.x * k, b.y * k, b.w * k, b.h * k);
    });
    world.map.obstacles.forEach((o) => {
      if (o.kind === 'wall' || o.under) return;
      g.fillStyle = { tree: '#2f6b2a', rock: '#999', bush: '#3f7d31', crate: '#a8763e', barrel: '#c0392b' }[o.kind] || '#777';
      const c2 = U.center(o);
      g.fillRect(c2.x * k - 1, c2.y * k - 1, 2, 2);
    });
    return c;
  }

  function buildUnderCache(world, size) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const R = world.map.under;
    const k = size / R.w;
    g.fillStyle = '#111317';
    g.fillRect(0, 0, size, size);
    world.map.rooms.forEach((r) => {
      g.fillStyle = ['#24222b', '#1f2a2a', '#2b2422'][r.tint];
      g.fillRect((r.x - R.x) * k, (r.y - R.y) * k, r.w * k, r.h * k);
    });
    g.fillStyle = '#8a90a0';
    world.map.obstacles.forEach((o) => {
      if (o.kind === 'wall' && o.under) g.fillRect((o.x - R.x) * k, (o.y - R.y) * k, Math.max(1.5, o.w * k), Math.max(1.5, o.h * k));
    });
    g.fillStyle = '#7dff9a';
    world.map.links.forEach((l) => g.fillRect((l.sx - R.x) * k - 4, (l.sy - R.y) * k - 4, 8, 8));
    return c;
  }

  function dot(g, x, y, r, fill) {
    g.fillStyle = fill;
    g.strokeStyle = '#000';
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.fill();
    g.stroke();
  }

  function drawMinimap(g, world, size, focus, full) {
    const under = !!focus && world.isUnder(focus.x);
    g.save();
    g.clearRect(0, 0, size, size);
    g.drawImage(cached(world, size, under), 0, 0);
    const R = world.map.under;
    const k = under ? size / R.w : size / world.size;
    const ox = under ? R.x : 0, oy = under ? R.y : 0;
    const map = (p) => [(p.x - ox) * k, (p.y - oy) * k];
    if (!under) drawMiniZone(g, world, size, k);
    const me = world.local;
    for (const p of world.players.values()) {
      const mate = me && p !== me && p.alive && p.team != null && p.team === me.team;
      if (mate && world.isUnder(p.x) === under) dot(g, ...map(p), 4, '#7dff9a');
    }
    if (focus) dot(g, ...map(focus), full ? 6 : 4.5, '#fff');
    if (under) {
      g.fillStyle = '#7dff9a';
      g.font = 'bold 12px sans-serif';
      g.fillText('지하 벙커', 6, 16);
    }
    g.restore();
  }

  function drawMiniZone(g, world, size, k) {
    const z = world.zoneState;
    if (z && z.dps > 0) {
      g.fillStyle = 'rgba(200,30,60,0.35)';
      g.beginPath();
      g.rect(0, 0, size, size);
      g.arc(z.x * k, z.y * k, Math.max(0.5, z.r * k), 0, TAU, true);
      g.fill('evenodd');
      g.strokeStyle = '#fff';
      g.setLineDash([4, 3]);
      g.beginPath();
      g.arc(z.tx * k, z.ty * k, Math.max(0.5, z.tr * k), 0, TAU);
      g.stroke();
      g.setLineDash([]);
    }
    for (const d of world.airdrops) {
      if (!d.announced) continue;
      const o = world.map.byId.get(d.id);
      if (o && o.dead) continue;
      g.fillStyle = '#ff3d6e';
      g.fillRect(d.x * k - 4, d.y * k - 4, 8, 8);
    }
  }

  ZR.Render = Object.freeze({ init, draw, drawMinimap, viewSize, resize });
})(typeof window !== 'undefined' ? window : globalThis);
