'use strict';
// 공유 옷장에는 브라우저별로 구매한 스킨의 이름표 하나만 저장한다.
(function (root) {
  const ZR = (root.ZR = root.ZR || {});
  const CODE = 'MINWOOISTHEKING';
  const PATH = 'rooms/_wardrobe/skins';
  const ACCESS_KEY = 'zr.wardrobe.access';
  const CONTRIBUTOR_KEY = 'zr.wardrobe.contributor';
  const OUTFIT_KEY = 'zr.wardrobe.outfit';
  const CONTRIBUTOR = /^[0-9a-f]{32}$/;
  const ENTRY_KEY = /^([0-9a-f]{32})_([a-z0-9-]+)$/;
  const MAX_TAG = 18;
  let entries = new Map();

  function read(key) {
    try {
      return root.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function write(key, value) {
    try {
      if (value === null) root.localStorage.removeItem(key);
      else root.localStorage.setItem(key, value);
    } catch {
      return false;
    }
    if (key !== CONTRIBUTOR_KEY) root.dispatchEvent(new root.Event('zr.wardrobechange'));
    return true;
  }

  function hasAccess() {
    return read(ACCESS_KEY) === '1';
  }

  function redeem(code) {
    return typeof code === 'string' && code.trim() === CODE && (hasAccess() || write(ACCESS_KEY, '1'));
  }

  function cleanTag(value) {
    if (typeof value !== 'string') return '';
    const text = value.normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '').trim();
    return [...text].slice(0, MAX_TAG).join('').trim();
  }

  function parseEntry(id, value) {
    const match = typeof id === 'string' && ENTRY_KEY.exec(id);
    if (!match || !value || value.skin !== match[2] || !ZR.Cosmetics.get(value.skin)?.price) return null;
    const tag = cleanTag(value.tag);
    return tag ? { id, skin: value.skin, tag } : null;
  }

  function getOutfit() {
    if (!hasAccess()) return null;
    try {
      const value = JSON.parse(read(OUTFIT_KEY));
      const outfit = parseEntry(value?.id, value);
      return outfit && { ...(entries.get(outfit.id) || outfit) };
    } catch {
      return null;
    }
  }

  function wear(entry) {
    const outfit = entries.get(entry?.id);
    return !!outfit && hasAccess() && write(OUTFIT_KEY, JSON.stringify(outfit));
  }

  function clearOutfit() {
    return write(OUTFIT_KEY, null);
  }

  function contributorId() {
    function loadOrCreate() {
      const existing = read(CONTRIBUTOR_KEY);
      if (CONTRIBUTOR.test(existing)) return existing;
      const bytes = root.crypto.getRandomValues(new Uint8Array(16));
      const id = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
      if (!write(CONTRIBUTOR_KEY, id)) throw new Error('옷장에 올릴 브라우저 정보를 저장하지 못했습니다.');
      return id;
    }
    const locks = root.navigator?.locks;
    return locks ? locks.request(CONTRIBUTOR_KEY, loadOrCreate) : loadOrCreate();
  }

  async function openStore() {
    if (!hasAccess()) throw new Error('먼저 공용 옷장 코드를 입력해 주세요.');
    const local = new URLSearchParams(root.location.search).get('net') === 'local';
    return local ? ZR.Store.localStore() : ZR.Store.firebaseStore();
  }

  async function subscribe(onEntries, onError) {
    const store = await openStore();
    return store.on(PATH, 'value', (key, value) => {
      const contributor = read(CONTRIBUTOR_KEY);
      const oldOutfit = getOutfit();
      const next = new Map();
      for (const [id, record] of Object.entries(value || {})) {
        const outfit = parseEntry(id, record);
        if (outfit) next.set(id, outfit);
      }
      entries = next;
      const refreshed = oldOutfit && entries.get(oldOutfit.id);
      if (refreshed && refreshed.tag !== oldOutfit.tag) write(OUTFIT_KEY, JSON.stringify(refreshed));
      onEntries(Array.from(entries.values(), (outfit) => ({
        ...outfit, mine: outfit.id.startsWith(`${contributor}_`),
      })));
    }, onError);
  }

  async function publish(skin, value) {
    if (!hasAccess()) throw new Error('먼저 공용 옷장 코드를 입력해 주세요.');
    if (!ZR.Cosmetics.get(skin)?.price || !ZR.Economy.getWallet().owned.includes(skin)) {
      throw new Error('구매한 스킨에만 이름표를 붙일 수 있습니다.');
    }
    const tag = cleanTag(value);
    if (!tag) throw new Error('옷에 붙일 이름표를 입력해 주세요.');
    const store = await openStore();
    const contributor = await contributorId();
    const id = `${contributor}_${skin}`;
    await store.set(`${PATH}/${id}`, { skin, tag });
    const oldOutfit = getOutfit();
    const outfit = { id, skin, tag };
    entries.set(id, outfit);
    if (oldOutfit && oldOutfit.id === id && oldOutfit.tag !== tag) write(OUTFIT_KEY, JSON.stringify(outfit));
    return { ...outfit, mine: true };
  }

  ZR.Wardrobe = Object.freeze({ CODE, hasAccess, redeem, subscribe, publish, wear, getOutfit, clearOutfit, cleanTag });
})(typeof window !== 'undefined' ? window : globalThis);
