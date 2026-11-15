'use strict';
// 전역 설정. Firebase 웹 설정값은 공개용 식별자이며, 실제 보안은 Realtime Database 규칙이 담당한다.
(function (root) {
  const ZR = (root.ZR = root.ZR || {});
  ZR.CONFIG = Object.freeze({
    title: '오버차지 로얄',
    firebase: Object.freeze({
      apiKey: 'AIzaSyDtPl5-CUMpgA8W6c0tV7bIHqsH0EYuM3g',
      authDomain: 'surviv-e36f5.firebaseapp.com',
      projectId: 'surviv-e36f5',
      storageBucket: 'surviv-e36f5.firebasestorage.app',
      messagingSenderId: '420907235903',
      appId: '1:420907235903:web:d7e8286bd8e522de7c168a',
      databaseURL: 'https://surviv-e36f5-default-rtdb.asia-southeast1.firebasedatabase.app',
    }),
    firebaseSdk: 'https://www.gstatic.com/firebasejs/10.14.1/',
    worldSize: 5200,
    // 비밀 지하 벙커: 지상 지도 밖 멀리 떨어진 좌표에 둔다 (지상 화면에 절대 비치지 않게)
    underground: Object.freeze({ gap: 3200, w: 1800, h: 1800, cells: 4, links: 4 }),
    teamSizes: Object.freeze({ solo: 1, duo: 2, squad: 4 }),
    playerRadius: 22,
    playerSpeed: 250,
    maxHp: 100,
    soloBots: 49,
    netStateGap: 1 / 15,
    lateJoinSec: 60,
    shotEventMaxAgeMs: 2500,
  });
})(typeof window !== 'undefined' ? window : globalThis);
