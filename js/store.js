'use strict';
// 실시간 저장소 어댑터 두 가지. 같은 메서드를 제공한다.
//  - Firebase Realtime Database (실제 온라인)
//  - BroadcastChannel (같은 브라우저의 탭끼리, 개발·테스트용: ?net=local)
(function (root) {
  const ZR = (root.ZR = root.ZR || {});
  const C = ZR.CONFIG;

  const parts = (p) => p.split('/').filter(Boolean);
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  let firebaseConnection = null;
  let localConnection = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) return resolve();
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => {
        s.remove();
        reject(new Error('온라인 연결에 필요한 파일을 불러오지 못했습니다.'));
      };
      document.head.append(s);
      return undefined;
    });
  }

  function firebaseStore() {
    if (!firebaseConnection) {
      firebaseConnection = openFirebaseStore().catch((err) => {
        firebaseConnection = null;
        throw err;
      });
    }
    return firebaseConnection;
  }

  async function openFirebaseStore() {
    const url = C.firebase.databaseURL;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let response;
    try {
      // 규칙은 개별 방 단위로 열려 있다.
      response = await fetch(`${url}/rooms/_probe.json?shallow=true`, { cache: 'no-store', signal: controller.signal });
    } catch (err) {
      throw new Error('게임 서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.');
    } finally {
      clearTimeout(timeout);
    }
    if (response.status === 401 || response.status === 403) throw new Error('게임 서버에서 온라인 접속을 허용하지 않습니다.');
    if (!response.ok) throw new Error('게임 서버가 응답하지 않습니다. 잠시 뒤 다시 시도해 주세요.');
    await loadScript(`${C.firebaseSdk}firebase-app-compat.js`);
    await loadScript(`${C.firebaseSdk}firebase-database-compat.js`);
    const fb = window.firebase;
    const app = fb.apps.length ? fb.app() : fb.initializeApp(C.firebase);
    const db = app.database();
    let offset = 0;
    db.ref('.info/serverTimeOffset').on('value', (s) => { offset = s.val() || 0; });
    const ref = (p) => db.ref(p);
    return {
      kind: 'firebase',
      url,
      set: (p, v) => ref(p).set(v),
      update: (p, v) => ref(p).update(v),
      remove: (p) => ref(p).remove(),
      push(p, v) {
        const r = ref(p).push();
        r.set(v);
        return r.key;
      },
      newKey: (p) => ref(p).push().key,
      once: (p) => ref(p).once('value').then((s) => s.val()),
      on(p, event, cb, onError = (err) => ZR.log('구독 오류', p, err)) {
        const r = ref(p);
        const h = (snap) => cb(snap.key, snap.val());
        r.on(event, h, onError);
        return () => r.off(event, h);
      },
      claim: (p, v) => ref(p).transaction((cur) => (cur === null ? v : undefined)).then((r) => r.committed),
      onDisconnectRemove: (p) => ref(p).onDisconnect().remove(),
      now: () => Date.now() + offset,
    };
  }

  // ---- BroadcastChannel 버전 ----
  function localStore() {
    if (!localConnection) {
      localConnection = Promise.resolve().then(openLocalStore).catch((err) => {
        localConnection = null;
        throw err;
      });
    }
    return localConnection;
  }

  function openLocalStore() {
    const chan = new BroadcastChannel('overcharge-local');
    const me = Math.random().toString(36).slice(2);
    let tree = {};
    const listeners = new Set();
    const leaving = new Set();

    const get = (p) => {
      let n = tree;
      for (const k of parts(p)) {
        if (n == null || typeof n !== 'object') return undefined;
        n = n[k];
      }
      return n;
    };

    const setRaw = (p, v) => {
      const ks = parts(p);
      if (!ks.length) {
        tree = v && typeof v === 'object' ? clone(v) : {};
        return;
      }
      let n = tree;
      for (let i = 0; i < ks.length - 1; i++) {
        if (!n[ks[i]] || typeof n[ks[i]] !== 'object') n[ks[i]] = {};
        n = n[ks[i]];
      }
      if (v === null || v === undefined) delete n[ks[ks.length - 1]];
      else n[ks[ks.length - 1]] = clone(v);
    };

    const related = (a, b) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`) || a === '' || b === '';
    const childSnap = (L) => {
      const obj = get(L.path);
      const out = new Map();
      if (obj && typeof obj === 'object') for (const k of Object.keys(obj)) out.set(k, JSON.stringify(obj[k]));
      return out;
    };

    function apply(p, v) {
      const path = parts(p).join('/');
      const affected = [...listeners].filter((L) => related(path, L.path));
      const before = affected.map((L) => (L.event === 'value' ? JSON.stringify(get(L.path)) : childSnap(L)));
      setRaw(path, v);
      affected.forEach((L, i) => dispatch(L, before[i]));
    }

    function dispatch(L, before) {
      if (!listeners.has(L)) return;
      if (L.event === 'value') {
        const now = JSON.stringify(get(L.path));
        if (now !== before) L.cb(parts(L.path).pop() || null, clone(get(L.path)) ?? null);
        return;
      }
      const after = childSnap(L);
      const obj = get(L.path) || {};
      if (L.event === 'child_added') for (const k of after.keys()) if (!before.has(k)) L.cb(k, clone(obj[k]));
      if (L.event === 'child_changed') for (const [k, s] of after) if (before.has(k) && before.get(k) !== s) L.cb(k, clone(obj[k]));
      if (L.event === 'child_removed') for (const [k, s] of before) if (!after.has(k)) L.cb(k, JSON.parse(s));
    }

    const write = (p, v) => {
      apply(p, v);
      chan.postMessage({ op: 'set', path: p, val: v === undefined ? null : v });
    };

    chan.onmessage = (e) => {
      const m = e.data;
      if (m.op === 'set') apply(m.path, m.val);
      else if (m.op === 'hello' && m.from !== me) chan.postMessage({ op: 'snap', to: m.from, tree });
      else if (m.op === 'snap' && m.to === me && !gotSnap) {
        gotSnap = true;
        apply('', m.tree);
      }
    };
    let gotSnap = false;
    chan.postMessage({ op: 'hello', from: me });
    window.addEventListener('pagehide', () => leaving.forEach((p) => write(p, null)));

    let seq = 0;
    const newKey = () => `${Date.now().toString(36)}${(seq++).toString(36).padStart(3, '0')}${me.slice(0, 4)}`;
    const store = {
      kind: 'local',
      set: (p, v) => Promise.resolve(write(p, v)),
      update: (p, obj) => Promise.resolve(Object.entries(obj).forEach(([k, v]) => write(`${p}/${k}`, v))),
      remove: (p) => Promise.resolve(write(p, null)),
      push(p, v) {
        const k = newKey();
        write(`${p}/${k}`, v);
        return k;
      },
      newKey,
      once: (p) => Promise.resolve(clone(get(p)) ?? null),
      on(p, event, cb) {
        const L = { path: parts(p).join('/'), event, cb };
        listeners.add(L);
        queueMicrotask(() => dispatch(L, event === 'value' ? '__init__' : new Map()));
        return () => listeners.delete(L);
      },
      claim(p, v) {
        if (get(p) != null) return Promise.resolve(false);
        write(p, v);
        return Promise.resolve(true);
      },
      onDisconnectRemove: (p) => leaving.add(p),
      now: () => Date.now(),
    };
    return new Promise((resolve) => setTimeout(() => resolve(store), 350));
  }

  ZR.Store = Object.freeze({ firebaseStore, localStore });
})(typeof window !== 'undefined' ? window : globalThis);
