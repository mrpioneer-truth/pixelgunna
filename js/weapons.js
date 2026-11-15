'use strict';
// 무기 정의. 총(gun), 근접(melee), 투척(throw) 세 종류.
// type: bullet | homing | flame | beam | rail | chain | lob | singularity | meteor
(function (root) {
  const ZR = (root.ZR = root.ZR || {});

  const RARITY = Object.freeze({
    common: { name: '일반', color: '#c9d1d9', rank: 0 },
    rare: { name: '희귀', color: '#4fa3ff', rank: 1 },
    epic: { name: '영웅', color: '#b86bff', rank: 2 },
    legendary: { name: '전설', color: '#ffa53a', rank: 3 },
    mythic: { name: '신화', color: '#ff3d6e', rank: 4 },
  });

  // max: 가방 레벨(0~3)별 최대 보유량
  const AMMO = Object.freeze({
    light: { name: '경탄', color: '#f2c94c', pickup: 30, max: [90, 180, 240, 300] },
    heavy: { name: '중탄', color: '#56ccf2', pickup: 30, max: [90, 180, 240, 300] },
    shell: { name: '산탄', color: '#ff6b6b', pickup: 10, max: [15, 30, 45, 60] },
    cell: { name: '에너지셀', color: '#6fffe9', pickup: 40, max: [120, 200, 280, 360] },
    rocket: { name: '로켓', color: '#ff9f43', pickup: 4, max: [8, 12, 16, 24] },
  });

  const freezeDef = (d) => Object.freeze({ ...d, fx: Object.freeze({ ...(d.fx || {}) }) });

  const gun = (d) => freezeDef({
    kind: 'gun', type: 'bullet', auto: false, pellets: 1, spread: 0.04, speed: 1500, range: 800,
    size: 4, moveMul: 0.95, reload: 2.0, barrel: 34, bw: 7, sound: 'pop', ...d,
  });
  const melee = (d) => freezeDef({ kind: 'melee', moveMul: 1.05, ...d });
  const thrown = (d) => freezeDef({ kind: 'throw', moveMul: 1, ...d });

  const W = {
    // ---- 일반 ----
    pistol: gun({ name: 'P9 사이드암', rarity: 'common', ammo: 'light', mag: 15, fireDelay: 0.14, dmg: 15, range: 750, spread: 0.05, barrel: 24, bw: 6, desc: '가볍고 빠른 권총' }),
    smg: gun({ name: '베스파 SMG', rarity: 'common', ammo: 'light', mag: 32, auto: true, fireDelay: 0.065, dmg: 10, spread: 0.11, range: 650, barrel: 30, desc: '근거리 연사' }),
    shotgun: gun({ name: '브리처 12', rarity: 'common', ammo: 'shell', mag: 5, fireDelay: 0.75, pellets: 9, dmg: 9, spread: 0.28, speed: 1300, range: 420, reload: 2.4, barrel: 38, bw: 9, sound: 'boom', moveMul: 0.92, desc: '9발 산탄' }),
    rifle: gun({ name: 'K-17 돌격소총', rarity: 'common', ammo: 'heavy', mag: 30, auto: true, fireDelay: 0.1, dmg: 14, spread: 0.055, range: 950, speed: 1700, barrel: 42, desc: '만능 자동소총' }),
    // ---- 희귀 ----
    dmr: gun({ name: '롱샷 DMR', rarity: 'rare', ammo: 'heavy', mag: 12, fireDelay: 0.32, dmg: 40, spread: 0.008, speed: 2400, range: 1500, barrel: 54, sound: 'crack', moveMul: 0.9, desc: '정밀 저격' }),
    minigun: gun({ name: '호넷 미니건', rarity: 'rare', ammo: 'heavy', mag: 150, auto: true, fireDelay: 0.035, spinUp: 0.6, dmg: 9, spread: 0.15, range: 850, barrel: 48, bw: 13, moveMul: 0.72, reload: 4, desc: '예열 후 초당 28발' }),
    ricochet: gun({ name: '리코셰 블래스터', rarity: 'rare', ammo: 'cell', mag: 20, auto: true, fireDelay: 0.17, dmg: 19, speed: 950, range: 1300, size: 6, color: '#5ff', sound: 'zap', fx: { bounce: 3 }, desc: '벽에 3번 튕김' }),
    flamer: gun({ name: '인페르노 스피터', rarity: 'rare', ammo: 'cell', mag: 90, auto: true, fireDelay: 0.035, type: 'flame', dmg: 3, speed: 520, range: 320, spread: 0.22, size: 8, sound: 'flame', fx: { burn: { dps: 12, dur: 2 } }, desc: '화염 + 화상' }),
    // ---- 영웅 ----
    thunder: gun({ name: '썬더 코일', rarity: 'epic', ammo: 'cell', mag: 12, fireDelay: 0.45, type: 'chain', dmg: 34, range: 520, color: '#9cf', sound: 'zap', fx: { chain: { n: 4, range: 280 } }, desc: '번개가 4명까지 연쇄' }),
    cryo: gun({ name: '크라이오 레이', rarity: 'epic', ammo: 'cell', mag: 100, auto: true, type: 'beam', dps: 48, ammoPerSec: 12, range: 560, beamColor: '#9be7ff', beamWidth: 8, beams: 1, fx: { slow: { mul: 0.45, dur: 1.2 } }, desc: '빙결 광선, 둔화' }),
    swarm: gun({ name: '스웜 런처', rarity: 'epic', ammo: 'rocket', mag: 3, fireDelay: 0.9, pellets: 6, type: 'homing', dmg: 10, speed: 620, range: 1100, spread: 0.7, size: 5, sound: 'whoosh', barrel: 40, bw: 12, fx: { homing: 4.5, explode: { r: 55, dmg: 12 } }, desc: '유도 미사일 6발' }),
    rail: gun({ name: '레일 랜스', rarity: 'epic', ammo: 'cell', mag: 4, fireDelay: 0.9, charge: 0.7, type: 'rail', dmg: 88, range: 1700, barrel: 58, sound: 'rail', color: '#7cf', fx: { wallPierce: true }, desc: '충전 후 벽까지 관통' }),
    mortar: gun({ name: '클러스터 박격포', rarity: 'epic', ammo: 'rocket', mag: 4, fireDelay: 1.0, type: 'lob', dmg: 0, range: 750, sound: 'thump', barrel: 30, bw: 14, fx: { explode: { r: 95, dmg: 45 }, cluster: { n: 6, r: 55, dmg: 20 } }, desc: '조준점에 집속탄' }),
    // ---- 전설 ----
    nova: gun({ name: '노바 로켓', rarity: 'legendary', ammo: 'rocket', mag: 1, fireDelay: 0.5, reload: 2.6, dmg: 30, speed: 780, range: 1200, size: 9, barrel: 46, bw: 15, sound: 'whoosh', moveMul: 0.85, fx: { explode: { r: 170, dmg: 100, knock: 900 } }, desc: '초대형 폭발' }),
    singularity: gun({ name: '특이점 캐논', rarity: 'legendary', ammo: 'cell', mag: 2, fireDelay: 1.4, reload: 3, type: 'singularity', speed: 420, range: 650, size: 12, barrel: 40, bw: 14, sound: 'void', fx: { hole: { r: 240, dps: 28, pull: 520, dur: 3.2 } }, desc: '블랙홀 생성' }),
    prism: gun({ name: '프리즘 레이저', rarity: 'legendary', ammo: 'cell', mag: 80, auto: true, type: 'beam', dps: 55, beams: 3, beamSpread: 0.14, ammoPerSec: 16, range: 720, beamColor: '#ff6bf1', beamWidth: 6, desc: '3갈래 레이저' }),
    dragon: gun({ name: '드래곤 브레스', rarity: 'legendary', ammo: 'shell', mag: 6, fireDelay: 0.7, pellets: 8, dmg: 12, spread: 0.26, range: 480, color: '#ff7b29', sound: 'boom', barrel: 40, bw: 10, fx: { burn: { dps: 14, dur: 2.5 }, explode: { r: 34, dmg: 7 } }, desc: '폭발 화염 산탄' }),
    // ---- 신화 (보급 상자 전용) ----
    apocalypse: gun({ name: '아포칼립스 개틀링', rarity: 'mythic', ammo: 'rocket', mag: 80, auto: true, fireDelay: 0.075, spinUp: 0.4, dmg: 10, speed: 900, range: 1000, spread: 0.13, size: 6, moveMul: 0.75, reload: 4.5, barrel: 52, bw: 16, sound: 'whoosh', fx: { explode: { r: 60, dmg: 20 } }, desc: '연사형 소형 로켓' }),
    starfall: gun({ name: '스타폴 셉터', rarity: 'mythic', ammo: 'cell', mag: 8, fireDelay: 0.55, type: 'meteor', range: 700, barrel: 44, bw: 8, sound: 'void', fx: { meteor: { r: 140, dmg: 85, delay: 0.7 }, burn: { dps: 15, dur: 2 } }, desc: '조준점에 유성 낙하' }),
    gauss: gun({ name: '가우스 섬멸포', rarity: 'mythic', ammo: 'cell', mag: 3, fireDelay: 1.1, charge: 0.9, type: 'rail', dmg: 120, range: 2200, barrel: 64, bw: 12, sound: 'rail', color: '#f6f', fx: { wallPierce: true, explode: { r: 80, dmg: 40 } }, desc: '관통 + 명중점 폭발' }),

    // ---- 근접 ----
    fists: melee({ name: '주먹', rarity: 'common', dmg: 20, range: 46, arc: 1.1, delay: 0.28 }),
    knife: melee({ name: '전투 단검', rarity: 'common', dmg: 30, range: 58, arc: 1.2, delay: 0.24, moveMul: 1.1 }),
    katana: melee({ name: '플라즈마 카타나', rarity: 'epic', dmg: 48, range: 95, arc: 1.7, delay: 0.42, dash: 180, color: '#7af' }),
    hammer: melee({ name: '중력 해머', rarity: 'legendary', dmg: 58, range: 80, arc: 1.4, delay: 0.85, color: '#fa5', shock: { r: 150, dmg: 30, knock: 700 } }),
    scythe: melee({ name: '보이드 사이드', rarity: 'mythic', dmg: 75, range: 125, arc: 2.6, delay: 0.55, lifesteal: 0.35, dash: 120, color: '#c4f' }),

    // ---- 투척 ----
    frag: thrown({ name: '파편 수류탄', rarity: 'common', fuse: 2.2, r: 150, dmg: 95, knock: 500, color: '#5a7' }),
    cryonade: thrown({ name: '냉각 수류탄', rarity: 'rare', fuse: 1.6, r: 170, dmg: 28, color: '#9df', fx: { slow: { mul: 0.35, dur: 3 } } }),
    sticky: thrown({ name: '플라즈마 점착탄', rarity: 'epic', fuse: 1.4, r: 110, dmg: 90, sticky: true, color: '#f5a' }),
    nuke: thrown({ name: '미니 핵', rarity: 'legendary', fuse: 3, r: 340, dmg: 160, knock: 1200, color: '#ff3' }),
  };

  const ids = Object.keys(W);
  const byKind = (kind) => ids.filter((id) => W[id].kind === kind);
  const byRarity = (kind, rarity) => ids.filter((id) => W[id].kind === kind && W[id].rarity === rarity);

  ZR.W = Object.freeze(W);
  ZR.Weapons = Object.freeze({
    RARITY,
    AMMO,
    get: (id) => W[id],
    byKind,
    byRarity,
    rank: (id) => (W[id] ? RARITY[W[id].rarity].rank : -1),
    color: (id) => (W[id] ? RARITY[W[id].rarity].color : '#fff'),
  });
})(typeof window !== 'undefined' ? window : globalThis);
