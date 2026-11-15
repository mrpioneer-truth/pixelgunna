'use strict';
// 키보드·마우스 입력. 눌린 순간(pressed)은 프레임마다 consume()으로 비운다.
(function (root) {
  const ZR = (root.ZR = root.ZR || {});

  const state = { keys: new Set(), pressed: new Set(), mouse: { x: 0, y: 0, down: false }, wheel: 0, enabled: false };
  const BLOCK = new Set(['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

  function init(canvas) {
    window.addEventListener('keydown', (e) => {
      if (!state.enabled || e.target.tagName === 'INPUT') return;
      if (BLOCK.has(e.code)) e.preventDefault();
      if (!state.keys.has(e.code)) state.pressed.add(e.code);
      state.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => state.keys.delete(e.code));
    window.addEventListener('blur', () => {
      state.keys.clear();
      state.mouse.down = false;
    });
    canvas.addEventListener('mousemove', (e) => {
      state.mouse.x = e.clientX;
      state.mouse.y = e.clientY;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) state.mouse.down = true;
      ZR.Audio.unlock();
    });
    window.addEventListener('mouseup', (e) => { if (e.button === 0) state.mouse.down = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => {
      state.wheel += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });
  }

  const down = (code) => state.keys.has(code);
  const hit = (code) => state.pressed.has(code);

  function consume() {
    state.pressed.clear();
    state.wheel = 0;
  }

  ZR.Input = { state, init, down, hit, consume, setEnabled: (v) => { state.enabled = v; if (!v) { state.keys.clear(); state.mouse.down = false; } } };
})(typeof window !== 'undefined' ? window : globalThis);
