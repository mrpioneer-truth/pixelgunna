'use strict';
// 바닥 아이템: 회복, 방어구, 가방, 조준경, 그리고 시드 기반 전리품 굴림.
(function (root) {
  const ZR = (root.ZR = root.ZR || {});

  const HEALS = Object.freeze({
    bandage: { name: '붕대', key: '7', heal: 15, cap: 75, dur: 3, pickup: 5, max: [5, 10, 15, 30], color: '#eee' },
    medkit: { name: '구급상자', key: '8', heal: 100, cap: 100, dur: 6, pickup: 1, max: [1, 2, 3, 4], color: '#f55' },
    soda: { name: '에너지 음료', key: '9', boost: 25, dur: 3, pickup: 1, max: [2, 5, 10, 15], color: '#4cf' },
    pills: { name: '진통제', key: '0', boost: 50, dur: 5, pickup: 1, max: [1, 2, 3, 4], color: '#fc4' },
  });

  const ARMOR = Object.freeze({
    helmet: [0, 0.1, 0.16, 0.22],
    vest: [0, 0.2, 0.3, 0.42],
  });

  const THROW_MAX = [3, 6, 9, 12];
  const SCOPE_VIEW = Object.freeze({ 1: 1050, 2: 1350, 4: 1750, 8: 2300 });

  const GUN_RARITY = Object.freeze({
    ground: [['common', 56], ['rare', 28], ['epic', 12], ['legendary', 4]],
    crate: [['common', 30], ['rare', 36], ['epic', 23], ['legendary', 11]],
    airdrop: [['legendary', 45], ['mythic', 55]],
    secret: [['rare', 15], ['epic', 40], ['legendary', 32], ['mythic', 13]],
  });

  const KIND_TABLE = Object.freeze({
    airdrop: [['gun', 70], ['armor', 20], ['heal', 10]],
    secret: [['gun', 45], ['armor', 15], ['heal', 15], ['throw', 13], ['melee', 12]],
    normal: [['gun', 34], ['ammo', 22], ['heal', 18], ['armor', 12], ['pack', 4], ['scope', 4], ['throw', 4], ['melee', 2]],
  });

  function gunItem(rng, table) {
    const rarity = rng.weighted(GUN_RARITY[table]);
    const wid = rng.pick(ZR.Weapons.byRarity('gun', rarity));
    const def = ZR.W[wid];
    const extra = ZR.Weapons.AMMO[def.ammo].pickup * (table === 'ground' || table === 'crate' ? 1 : 2);
    return [{ type: 'gun', key: wid }, { type: 'ammo', key: def.ammo, count: extra }];
  }

  function rollOne(rng, table) {
    const kind = rng.weighted(KIND_TABLE[table] || KIND_TABLE.normal);
    const hi = table === 'ground' ? 0 : 1;
    switch (kind) {
      case 'gun':
        return gunItem(rng, table);
      case 'ammo': {
        const key = rng.pick(Object.keys(ZR.Weapons.AMMO));
        return [{ type: 'ammo', key, count: ZR.Weapons.AMMO[key].pickup }];
      }
      case 'heal': {
        const key = rng.weighted([['bandage', 45], ['medkit', 15], ['soda', 25], ['pills', 15]]);
        return [{ type: 'heal', key, count: HEALS[key].pickup }];
      }
      case 'armor': {
        const key = rng.chance(0.5) ? 'helmet' : 'vest';
        const level = table === 'airdrop' ? 3 : rng.weighted([[1, 60 - hi * 25], [2, 30 + hi * 10], [3, 10 + hi * 15]]);
        return [{ type: 'armor', key, level }];
      }
      case 'pack':
        return [{ type: 'pack', key: 'pack', level: rng.weighted([[1, 60], [2, 30], [3, 10]]) }];
      case 'scope':
        return [{ type: 'scope', key: 'scope', level: rng.weighted([[2, 60], [4, 30], [8, 10]]) }];
      case 'throw': {
        const key = rng.weighted([['frag', 50], ['cryonade', 25], ['sticky', 18], ['nuke', 7]]);
        return [{ type: 'throw', key, count: key === 'nuke' ? 1 : 2 }];
      }
      default:
        return [{ type: 'melee', key: rng.weighted([['knife', 50], ['katana', 30], ['hammer', 15], ['scythe', 5]]) }];
    }
  }

  // 같은 시드면 같은 결과. 아이템 id는 idBase_순번
  function roll(rng, table, x, y, idBase, count = 1) {
    const out = [];
    for (let i = 0; i < count; i++) out.push(...rollOne(rng, table));
    return scatter(out, x, y, idBase, rng.next());
  }

  function scatter(items, x, y, idBase, turn = 0) {
    const n = items.length;
    return items.map((it, i) => {
      const a = (i / Math.max(1, n)) * Math.PI * 2 + turn * Math.PI * 2;
      const d = n > 1 ? 22 + 6 * n : 0;
      return { ...it, id: `${idBase}_${i}`, x: x + Math.cos(a) * d, y: y + Math.sin(a) * d };
    });
  }

  function label(item) {
    switch (item.type) {
      case 'gun':
      case 'melee':
        return ZR.W[item.key].name;
      case 'throw': return `${ZR.W[item.key].name} x${item.count}`;
      case 'ammo': return `${ZR.Weapons.AMMO[item.key].name} x${item.count}`;
      case 'heal': return `${HEALS[item.key].name} x${item.count}`;
      case 'armor': return `${item.key === 'helmet' ? '헬멧' : '조끼'} Lv.${item.level}`;
      case 'pack': return `가방 Lv.${item.level}`;
      case 'scope': return `${item.level}배 조준경`;
      default: return '?';
    }
  }

  const LEVEL_COLOR = ['#ccc', '#ccc', '#4fa3ff', '#b86bff', '#ffa53a'];
  function color(item) {
    if (item.type === 'gun' || item.type === 'melee' || item.type === 'throw') return ZR.Weapons.color(item.key);
    if (item.type === 'ammo') return ZR.Weapons.AMMO[item.key].color;
    if (item.type === 'heal') return HEALS[item.key].color;
    if (item.type === 'scope') return LEVEL_COLOR[Math.min(4, Math.log2(item.level) + 1)];
    return LEVEL_COLOR[item.level] || '#ccc';
  }

  ZR.Items = Object.freeze({ HEALS, ARMOR, THROW_MAX, SCOPE_VIEW, roll, scatter, label, color });
})(typeof window !== 'undefined' ? window : globalThis);
