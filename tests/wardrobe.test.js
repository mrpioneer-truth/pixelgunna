'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomFillSync } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const path = require('node:path');

const source = readFileSync(path.join(__dirname, '..', 'js', 'wardrobe.js'), 'utf8');
const SKINS = 'rooms/_wardrobe/skins';
const CODE = 'MINWOOISTHEKING';

function wardrobeStore() {
  const values = {};
  const listeners = new Set();
  const notify = (listener) => listener('skins', { ...values });
  return {
    values,
    api: {
      async set(pathname, value) {
        assert.ok(pathname.startsWith(`${SKINS}/`));
        values[pathname.slice(SKINS.length + 1)] = value;
        for (const listener of listeners) notify(listener);
      },
      on(pathname, event, listener) {
        assert.equal(pathname, SKINS);
        assert.equal(event, 'value');
        listeners.add(listener);
        notify(listener);
        return () => listeners.delete(listener);
      },
    },
  };
}

function browser({ store, owned = [], disk = new Map(), search = '' }) {
  const transports = [];
  const events = [];
  const window = {
    location: { search },
    crypto: { getRandomValues: randomFillSync },
    ZR: {
      Cosmetics: { get: (id) => id === 'pony' ? { id, price: 120 } : undefined },
      Economy: { getWallet: () => ({ owned }) },
      Store: {
        async firebaseStore() { transports.push('firebase'); return store; },
        async localStore() { transports.push('local'); return store; },
      },
    },
    localStorage: {
      getItem: (key) => disk.get(key) ?? null,
      setItem: (key, value) => disk.set(key, value),
      removeItem: (key) => disk.delete(key),
    },
    Event,
    dispatchEvent: (event) => events.push(event.type),
  };
  runInNewContext(source, { window, URLSearchParams });
  return { wardrobe: window.ZR.Wardrobe, transports, disk, events };
}

test('올바른 공용 코드 입력 후 열리며 재접속해도 접근을 기억한다', async () => {
  const store = wardrobeStore().api;
  const current = browser({ store, search: '?net=local' });
  const { wardrobe } = current;
  assert.equal(wardrobe.CODE, CODE);
  assert.equal(wardrobe.hasAccess(), false);
  assert.equal(wardrobe.redeem('wrong'), false);
  await assert.rejects(wardrobe.subscribe(() => {}), /코드/);
  assert.deepEqual(current.transports, []);
  assert.equal(wardrobe.redeem(` ${CODE} `), true);
  assert.deepEqual(current.events, ['zr.wardrobechange']);
  assert.equal(browser({ store, disk: current.disk }).wardrobe.hasAccess(), true);
  const stop = await wardrobe.subscribe(() => {});
  assert.deepEqual(current.transports, ['local']);
  stop();
});

test('구매한 스킨의 이름표를 공용으로 올리고 다른 브라우저에서 장착한다', async () => {
  const { api: store, values } = wardrobeStore();
  const owner = browser({ store, owned: ['pony'] });
  const visitor = browser({ store });
  owner.wardrobe.redeem(CODE);
  visitor.wardrobe.redeem(CODE);
  let published;
  const stop = await visitor.wardrobe.subscribe((items) => { [published] = items; });
  await assert.rejects(visitor.wardrobe.publish('pony', '방문자'), /구매한/);
  await assert.rejects(owner.wardrobe.publish('pony', '   '), /이름표/);
  const original = await owner.wardrobe.publish('pony', '  민우\u0000  ');
  assert.equal(original.tag, '민우');
  assert.equal(original.mine, true);
  assert.equal(published.id, original.id);
  assert.equal(published.mine, false);
  assert.equal(visitor.wardrobe.wear({ id: 'missing' }), false);
  assert.equal(visitor.wardrobe.wear(published), true);
  assert.equal(visitor.wardrobe.getOutfit().skin, 'pony');
  assert.equal(browser({ store, disk: visitor.disk }).wardrobe.getOutfit().tag, '민우');
  assert.deepEqual(visitor.transports, ['firebase']);

  await owner.wardrobe.publish('pony', '새 이름표');
  assert.equal(Object.keys(values).length, 1);
  assert.equal(published.tag, '새 이름표');
  assert.equal(browser({ store, disk: visitor.disk }).wardrobe.getOutfit().tag, '새 이름표');
  assert.equal(visitor.wardrobe.clearOutfit(), true);
  assert.equal(visitor.wardrobe.getOutfit(), null);
  stop();
});

test('옷장 목록에는 저장 형식과 알려진 구매 스킨이 일치하는 항목만 나온다', async () => {
  const { api: store, values } = wardrobeStore();
  const accountId = 'a'.repeat(32);
  values[`${accountId}_pony`] = { skin: 'pony', tag: '✨'.repeat(20) };
  values[`${accountId}_bad`] = { skin: 'pony', tag: '잘못된 값' };
  values[`${accountId}_unknown`] = { skin: 'unknown', tag: '알 수 없는 스킨' };
  values.bad = { skin: 'pony', tag: '잘못된 키' };
  const { wardrobe } = browser({ store });
  wardrobe.redeem(CODE);
  const stop = await wardrobe.subscribe((items) => {
    assert.equal(items.length, 1);
    assert.equal(items[0].tag, '✨'.repeat(18));
  });
  stop();
});
