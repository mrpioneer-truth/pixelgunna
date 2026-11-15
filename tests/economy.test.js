'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const path = require('node:path');

const source = readFileSync(path.join(__dirname, '..', 'js', 'economy.js'), 'utf8');

function browser(shared) {
  const skin = { id: 'meme', price: 120 };
  const window = {
    ZR: { Cosmetics: { get: (id) => id === skin.id ? skin : undefined } },
    localStorage: shared.storage,
    navigator: { locks: shared.locks },
    Event,
    dispatchEvent() {},
  };
  runInNewContext(source, { window });
  return window.ZR.Economy;
}

function walletStorage() {
  let saved = null;
  let last = Promise.resolve();
  return {
    storage: { getItem: () => saved, setItem: (key, json) => { saved = json; } },
    locks: {
      request(key, callback) {
        const next = last.then(callback);
        last = next.catch(() => {});
        return next;
      },
    },
  };
}

test('정상 완료한 경기만 순위·처치 수에 따라 각각 한 번 정산한다', async () => {
  const shared = walletStorage();
  const first = browser(shared);
  const second = browser(shared);
  const result = { id: 'match', mode: 'online', rank: 1, total: 20, kills: 4, won: true };
  assert.deepEqual(await Promise.all([first.recordMatch(result), second.recordMatch(result)]), [70, 0]);
  assert.equal(await second.recordMatch({ ...result, id: 'other', mode: 'solo', rank: 10, kills: 1, won: false }), 25);
  assert.equal(await first.recordMatch({ ...result, id: 'range', mode: 'range' }), null);
  assert.equal(await first.recordMatch({ ...result, id: 'only', total: 1 }), null);
  assert.equal(second.getWallet().coins, 95);
});

test('스킨을 한 번 구매해서 장착하고 다음 로드에서도 복원한다', async () => {
  const shared = walletStorage();
  const current = browser(shared);
  const result = { id: '1', mode: 'solo', rank: 2, total: 20, kills: 18, won: false };
  assert.equal(await current.buy('meme'), false);
  assert.equal(await current.equip('meme'), false);
  assert.equal(await current.recordMatch(result), 120);
  assert.deepEqual(await Promise.all([current.buy('meme'), browser(shared).buy('meme')]), [true, false]);
  assert.equal(await current.equip('meme'), true);
  const reloaded = browser(shared).getWallet();
  assert.equal(reloaded.coins, 0);
  assert.deepEqual(Array.from(reloaded.owned), ['default', 'meme']);
  assert.equal(reloaded.equipped, 'meme');
  assert.equal(await current.equip('default'), true);
});

test('브라우저가 저장을 막으면 정산을 완료한 것으로 표시하지 않는다', async () => {
  const shared = walletStorage();
  shared.storage.setItem = () => { throw new Error('저장할 수 없음'); };
  const economy = browser(shared);
  const result = { id: '1', mode: 'solo', rank: 20, total: 20, kills: 0, won: false };
  assert.equal(await economy.recordMatch(result), null);
  assert.equal(economy.getWallet().coins, 0);
});
