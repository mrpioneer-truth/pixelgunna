'use strict';
// 자기장: 시드로 모든 단계의 원을 미리 정해 둔다. 경기 시작 후 시간만 같으면 모두 같은 원을 본다.
(function (root) {
  const ZR = (root.ZR = root.ZR || {});
  const U = ZR.U;

  // 5200 크기 맵 기준. 대기(wait) 후 축소(shrink), frac = 이전 원 대비 반지름 비율
  const PHASES = Object.freeze([
    { wait: 60, shrink: 40, frac: 0.6, dps: 2 },
    { wait: 45, shrink: 32, frac: 0.55, dps: 3 },
    { wait: 40, shrink: 28, frac: 0.5, dps: 5 },
    { wait: 35, shrink: 25, frac: 0.48, dps: 8 },
    { wait: 30, shrink: 22, frac: 0.42, dps: 11 },
    { wait: 25, shrink: 20, frac: 0.35, dps: 15 },
    { wait: 18, shrink: 16, frac: 0, dps: 22 },
  ]);
  const AIRDROP_TIMES = Object.freeze([80, 190, 300, 410, 500]);

  class Zone {
    constructor(seed, size, disabled = false) {
      const rng = U.rng((seed ^ 0x5eed1) >>> 0);
      this.disabled = disabled;
      this.size = size;
      this.circles = [{ x: size / 2, y: size / 2, r: size * 0.74 }];
      for (const ph of PHASES) {
        const prev = this.circles[this.circles.length - 1];
        const r = prev.r * ph.frac;
        const a = rng.range(0, U.TAU);
        const d = Math.sqrt(rng.next()) * (prev.r - r) * 0.85;
        const margin = Math.min(size / 2, r + 120);
        this.circles.push({
          x: U.clamp(prev.x + Math.cos(a) * d, margin, size - margin),
          y: U.clamp(prev.y + Math.sin(a) * d, margin, size - margin),
          r,
        });
      }
    }

    state(t) {
      if (this.disabled) {
        const c = this.circles[0];
        return { x: c.x, y: c.y, r: this.size * 2, tx: c.x, ty: c.y, tr: this.size * 2, shrinking: false, remain: 0, dps: 0, phase: -1 };
      }
      let acc = 0;
      for (let i = 0; i < PHASES.length; i++) {
        const ph = PHASES[i], from = this.circles[i], to = this.circles[i + 1];
        if (t < acc + ph.wait) {
          return { ...pack(from, to, 0), shrinking: false, remain: acc + ph.wait - t, dps: ph.dps, phase: i };
        }
        acc += ph.wait;
        if (t < acc + ph.shrink) {
          return { ...pack(from, to, (t - acc) / ph.shrink), shrinking: true, remain: acc + ph.shrink - t, dps: ph.dps, phase: i };
        }
        acc += ph.shrink;
      }
      const last = this.circles[this.circles.length - 1];
      return { ...pack(last, last, 0), shrinking: false, remain: 0, dps: PHASES[PHASES.length - 1].dps * 1.5, phase: PHASES.length };
    }

    airdrops(seed) {
      if (this.disabled) return [];
      const rng = U.rng((seed ^ 0xa1d0) >>> 0);
      return AIRDROP_TIMES.map((t, i) => {
        const s = this.state(t);
        const a = rng.range(0, U.TAU);
        const d = Math.sqrt(rng.next()) * s.tr * 0.7;
        return {
          id: `air${i}`, t,
          x: U.clamp(s.tx + Math.cos(a) * d, 120, this.size - 120),
          y: U.clamp(s.ty + Math.sin(a) * d, 120, this.size - 120),
          lootSeed: rng.int(1, 1e9), announced: false, landed: false,
        };
      });
    }
  }

  function pack(from, to, k) {
    return {
      x: U.lerp(from.x, to.x, k), y: U.lerp(from.y, to.y, k), r: U.lerp(from.r, to.r, k),
      tx: to.x, ty: to.y, tr: to.r,
    };
  }

  ZR.Zone = Zone;
})(typeof window !== 'undefined' ? window : globalThis);
