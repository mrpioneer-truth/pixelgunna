'use strict';
// 정적 사이트용 지갑. 브라우저 안에서만 경기를 정산하고 스킨을 저장한다.
(function (root) {
  const ZR = (root.ZR = root.ZR || {});
  const KEY = 'zr.wallet.v1';
  const DEFAULT = 'default';

  function readWallet() {
    const saved = JSON.parse(root.localStorage.getItem(KEY) || 'null');
    const coins = saved && Number.isSafeInteger(saved.coins) && saved.coins >= 0 ? saved.coins : 0;
    const ids = saved && Array.isArray(saved.owned) ? saved.owned : [];
    const owned = [...new Set([DEFAULT, ...ids.filter((id) => ZR.Cosmetics.get(id))])];
    const equipped = saved && owned.includes(saved.equipped) ? saved.equipped : DEFAULT;
    const receipts = saved && saved.receipts && typeof saved.receipts === 'object' && !Array.isArray(saved.receipts)
      ? saved.receipts : {};
    return { coins, owned, equipped, receipts };
  }

  function getWallet() {
    try {
      const { coins, owned, equipped } = readWallet();
      return { coins, owned, equipped };
    } catch (err) {
      return { coins: 0, owned: [DEFAULT], equipped: DEFAULT };
    }
  }

  async function changeWallet(change, failed) {
    function save() {
      const wallet = readWallet();
      const result = change(wallet);
      if (result) {
        root.localStorage.setItem(KEY, JSON.stringify(wallet));
        root.dispatchEvent(new root.Event('zr.walletchange'));
      }
      return result;
    }
    try {
      const locks = root.navigator && root.navigator.locks;
      return locks ? await locks.request(KEY, save) : save();
    } catch (err) {
      return failed;
    }
  }

  function buy(id) {
    const skin = ZR.Cosmetics.get(id);
    if (!skin || !skin.price) return Promise.resolve(false);
    return changeWallet((wallet) => {
      if (wallet.owned.includes(id) || wallet.coins < skin.price) return false;
      wallet.coins -= skin.price;
      wallet.owned.push(id);
      return true;
    }, false);
  }

  function equip(id) {
    return changeWallet((wallet) => {
      if (!wallet.owned.includes(id)) return false;
      wallet.equipped = id;
      return true;
    }, false);
  }

  // 0은 이미 정산한 경기, null은 보상 대상이 아니거나 저장에 실패한 경기다.
  function recordMatch({ id, mode, rank, total, kills, won }) {
    if (!id || (mode !== 'solo' && mode !== 'online') || !Number.isSafeInteger(total) || total < 2 ||
        !Number.isSafeInteger(rank) || rank < 1 || rank > total) return Promise.resolve(null);
    const placement = rank === 1 && won ? 40
      : rank >= 2 && rank <= 3 ? 20
      : rank >= 4 && rank <= Math.floor(total / 2) ? 10 : 0;
    const earned = 10 + placement + 5 * (Number.isSafeInteger(kills) && kills > 0 ? kills : 0);
    const key = `${mode}:${id}`;
    return changeWallet((wallet) => {
      if (Object.hasOwn(wallet.receipts, key)) return 0;
      if (!Number.isSafeInteger(wallet.coins + earned)) return null;
      wallet.coins += earned;
      wallet.receipts[key] = earned;
      return earned;
    }, null);
  }

  ZR.Economy = Object.freeze({ getWallet, buy, equip, recordMatch });
})(typeof window !== 'undefined' ? window : globalThis);
