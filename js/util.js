'use strict';
// 수학, 시드 난수, 충돌 계산, 공간 격자.
(function (root) {
  const ZR = (root.ZR = root.ZR || {});
  const TAU = Math.PI * 2;

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function next() {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function rng(seed) {
    const next = mulberry32(seed);
    return {
      next,
      range: (a, b) => a + (b - a) * next(),
      int: (a, b) => a + Math.floor(next() * (b - a + 1)),
      pick: (arr) => arr[Math.floor(next() * arr.length)],
      chance: (p) => next() < p,
      weighted(table) {
        let total = 0;
        for (const [, w] of table) total += w;
        let roll = next() * total;
        for (const [v, w] of table) {
          roll -= w;
          if (roll < 0) return v;
        }
        return table[table.length - 1][0];
      },
    };
  }

  function hashStr(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // 선분과 원: 처음 닿는 t(0~1), 없으면 -1
  function segCircle(x1, y1, x2, y2, cx, cy, r) {
    const dx = x2 - x1, dy = y2 - y1;
    const fx = x1 - cx, fy = y1 - cy;
    const c = fx * fx + fy * fy - r * r;
    if (c <= 0) return 0;
    const a = dx * dx + dy * dy;
    if (a < 1e-9) return -1;
    const b = 2 * (fx * dx + fy * dy);
    const disc = b * b - 4 * a * c;
    if (disc < 0) return -1;
    const t = (-b - Math.sqrt(disc)) / (2 * a);
    return t >= 0 && t <= 1 ? t : -1;
  }

  function slab(p, d, lo, hi, state, axis) {
    if (Math.abs(d) < 1e-9) return p >= lo && p <= hi;
    let t1 = (lo - p) / d, t2 = (hi - p) / d, n = -1;
    if (t1 > t2) {
      const s = t1; t1 = t2; t2 = s; n = 1;
    }
    if (t1 > state.tmin) {
      state.tmin = t1;
      state.nx = axis === 0 ? n : 0;
      state.ny = axis === 1 ? n : 0;
    }
    state.tmax = Math.min(state.tmax, t2);
    return state.tmin <= state.tmax;
  }

  // 선분과 사각형(x,y 왼쪽 위): {t, nx, ny} 또는 null
  function segRect(x1, y1, x2, y2, rx, ry, rw, rh) {
    const dx = x2 - x1, dy = y2 - y1;
    const st = { tmin: 0, tmax: 1, nx: 0, ny: 0 };
    if (!slab(x1, dx, rx, rx + rw, st, 0)) return null;
    if (!slab(y1, dy, ry, ry + rh, st, 1)) return null;
    if (st.nx === 0 && st.ny === 0) {
      if (Math.abs(dx) > Math.abs(dy)) st.nx = -Math.sign(dx) || 1;
      else st.ny = -Math.sign(dy) || 1;
    }
    return { t: st.tmin, nx: st.nx, ny: st.ny };
  }

  // 원을 사각형 밖으로 밀어낸 위치, 겹치지 않으면 null
  function pushCircleRect(cx, cy, r, rx, ry, rw, rh) {
    const qx = clamp(cx, rx, rx + rw), qy = clamp(cy, ry, ry + rh);
    const dx = cx - qx, dy = cy - qy;
    const d2 = dx * dx + dy * dy;
    if (d2 >= r * r) return null;
    if (d2 > 1e-6) {
      const d = Math.sqrt(d2);
      return { x: qx + (dx / d) * r, y: qy + (dy / d) * r };
    }
    const left = cx - rx, right = rx + rw - cx, top = cy - ry, bottom = ry + rh - cy;
    const m = Math.min(left, right, top, bottom);
    if (m === left) return { x: rx - r, y: cy };
    if (m === right) return { x: rx + rw + r, y: cy };
    if (m === top) return { x: cx, y: ry - r };
    return { x: cx, y: ry + rh + r };
  }

  function pushCircleCircle(cx, cy, r, ox, oy, or) {
    const dx = cx - ox, dy = cy - oy;
    const min = r + or;
    const d2 = dx * dx + dy * dy;
    if (d2 >= min * min) return null;
    const d = Math.sqrt(d2) || 0.001;
    return { x: ox + (dx / d) * min, y: oy + (dy / d) * min };
  }

  function bounds(o) {
    if (o.shape === 'circle') return [o.x - o.r, o.y - o.r, o.x + o.r, o.y + o.r];
    return [o.x, o.y, o.x + o.w, o.y + o.h];
  }

  function center(o) {
    return o.shape === 'circle' ? { x: o.x, y: o.y } : { x: o.x + o.w / 2, y: o.y + o.h / 2 };
  }

  // 정적 장애물용 균일 격자
  class Grid {
    constructor(size, cell) {
      this.cell = cell;
      this.cols = Math.ceil(size / cell);
      this.cells = Array.from({ length: this.cols * this.cols }, () => []);
      this.stamp = 0;
    }
    range(minx, miny, maxx, maxy) {
      const c = this.cell, n = this.cols - 1;
      return [clamp(Math.floor(minx / c), 0, n), clamp(Math.floor(miny / c), 0, n),
        clamp(Math.floor(maxx / c), 0, n), clamp(Math.floor(maxy / c), 0, n)];
    }
    insert(o) {
      const b = bounds(o);
      const [x0, y0, x1, y1] = this.range(b[0], b[1], b[2], b[3]);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.cells[y * this.cols + x].push(o);
      o._stamp = 0;
    }
    query(minx, miny, maxx, maxy) {
      const out = [];
      const stamp = ++this.stamp;
      const [x0, y0, x1, y1] = this.range(minx, miny, maxx, maxy);
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          for (const o of this.cells[y * this.cols + x]) {
            if (o._stamp !== stamp && !o.dead) {
              o._stamp = stamp;
              out.push(o);
            }
          }
        }
      }
      return out;
    }
  }

  ZR.U = Object.freeze({
    TAU,
    clamp,
    lerp: (a, b, t) => a + (b - a) * t,
    dist: (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay),
    dist2: (ax, ay, bx, by) => (bx - ax) * (bx - ax) + (by - ay) * (by - ay),
    angleTo: (ax, ay, bx, by) => Math.atan2(by - ay, bx - ax),
    angleDiff(a, b) {
      let d = (b - a) % TAU;
      if (d > Math.PI) d -= TAU;
      if (d < -Math.PI) d += TAU;
      return d;
    },
    rng,
    hashStr,
    randSeed: () => Math.floor(Math.random() * 0xffffffff) >>> 0,
    uid: () => Math.random().toString(36).slice(2, 10),
    segCircle,
    segRect,
    pushCircleRect,
    pushCircleCircle,
    Grid,
    bounds,
    center,
  });
})(typeof window !== 'undefined' ? window : globalThis);
