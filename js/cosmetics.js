'use strict';
(function (root) {
  const ZR = (root.ZR = root.ZR || {});

  const DEFAULT = 'default';
  const catalog = Object.freeze([
    { id: DEFAULT, name: '기본 스킨', price: 0, tint: '#9aa592' },
    { id: 'lucky-vicky', name: '럭키비키', price: 120, tint: '#f7aed8', art: drawUnicorn },
    // 기존 구매·장착 정보와 온라인 상태에서 이 ID를 사용한다.
    { id: 'good-night', name: '무야호!', price: 180, tint: '#75c8ff', art: drawMuyaho },
    { id: 'malatang', name: '마라탕후루', price: 240, tint: '#ffac75', art: drawHotPot },
    { id: 'unbroken', name: '중꺾마', price: 300, tint: '#78e2d8', art: drawHeart },
  ].map(Object.freeze));
  const byId = new Map(catalog.map((skin) => [skin.id, skin]));
  const sprites = new Map();
  const spriteSize = 160;
  const spriteRadius = 50;

  const get = (id) => byId.get(id);
  const validate = (id) => byId.has(id) ? id : DEFAULT;

  function oval(ctx, x, y, rx, ry, fill, stroke, rotation = 0) {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, rotation, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.stroke();
    }
  }

  function shape(ctx, fill, stroke, trace) {
    ctx.beginPath();
    trace(ctx);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.stroke();
    }
  }

  function line(ctx, color, trace) {
    ctx.beginPath();
    trace(ctx);
    ctx.strokeStyle = color;
    ctx.stroke();
  }

  function sparkle(ctx, x, y, r, fill) {
    shape(ctx, fill, null, (p) => {
      p.moveTo(x, y - r);
      p.quadraticCurveTo(x + r * 0.25, y - r * 0.25, x + r, y);
      p.quadraticCurveTo(x + r * 0.25, y + r * 0.25, x, y + r);
      p.quadraticCurveTo(x - r * 0.25, y + r * 0.25, x - r, y);
      p.quadraticCurveTo(x - r * 0.25, y - r * 0.25, x, y - r);
    });
  }

  function drawUnicorn(ctx) {
    const outline = '#592e60';
    oval(ctx, -0.32, -0.74, 0.29, 0.46, '#ec80c0', outline, -0.38);
    oval(ctx, 0.32, -0.77, 0.24, 0.37, '#ffc1dc', outline, 0.45);
    oval(ctx, 0, 0, 0.98, 0.94, '#ffd7ef', outline);
    shape(ctx, '#d280df', outline, (p) => {
      p.moveTo(-0.21, -0.9);
      p.bezierCurveTo(-0.99, -1.1, -1.31, -0.19, -1.13, 0.31);
      p.bezierCurveTo(-0.97, 0.76, -0.64, 0.85, -0.34, 0.8);
      p.quadraticCurveTo(-0.61, 0.47, -0.28, 0.15);
      p.quadraticCurveTo(0.3, -0.12, -0.21, -0.9);
    });
    line(ctx, '#f4b4fd', (p) => {
      p.moveTo(-0.46, -0.64);
      p.quadraticCurveTo(-1.04, -0.35, -0.73, 0.4);
    });
    shape(ctx, '#ffe58c', outline, (p) => {
      p.moveTo(0.29, -0.46);
      p.lineTo(1.24, -0.79);
      p.lineTo(0.74, -0.13);
      p.quadraticCurveTo(0.51, -0.18, 0.29, -0.46);
    });
    oval(ctx, 0.42, 0.29, 0.12, 0.16, outline, null, -0.3);
    oval(ctx, 0.45, 0.24, 0.034, 0.052, '#fff');
    oval(ctx, 0.26, 0.54, 0.15, 0.08, '#f899ba');
    sparkle(ctx, -0.6, -0.37, 0.24, '#fff5a8');
    sparkle(ctx, 1.05, 0.62, 0.22, '#fff5a8');
  }

  function drawMuyaho(ctx) {
    const outline = '#1d3657';
    oval(ctx, -0.09, 0, 1.06, 0.98, '#3274be', outline);
    oval(ctx, 0.19, -0.01, 0.78, 0.78, '#e7f6ff', outline);
    oval(ctx, 0.25, 0.01, 0.62, 0.57, '#ffcc9f');
    shape(ctx, '#28588b', outline, (p) => {
      p.moveTo(-0.79, 0.36);
      p.quadraticCurveTo(-0.5, 0.55, -0.16, 0.69);
      p.lineTo(0.04, 1.01);
      p.quadraticCurveTo(-0.56, 0.94, -0.79, 0.36);
    });
    line(ctx, '#83c4fb', (p) => {
      p.moveTo(-0.86, 0.05);
      p.quadraticCurveTo(-0.85, -0.57, -0.45, -0.72);
    });
    oval(ctx, 0.17, -0.23, 0.64, 0.27, '#f79e39', outline, -0.23);
    line(ctx, '#ffe3a6', (p) => {
      p.moveTo(-0.21, -0.19);
      p.lineTo(0.09, -0.38);
      p.moveTo(0.06, -0.19);
      p.lineTo(0.29, -0.35);
    });
    oval(ctx, 0.54, 0.25, 0.23, 0.19, '#853d43', outline, 0.22);
    oval(ctx, 0.57, 0.33, 0.12, 0.07, '#f18585', null, 0.22);
    line(ctx, '#fff2bf', (p) => {
      p.moveTo(1.03, 0.12);
      p.lineTo(1.3, -0.02);
      p.moveTo(1.04, 0.32);
      p.lineTo(1.44, 0.39);
      p.moveTo(0.99, 0.5);
      p.lineTo(1.2, 0.71);
    });
    sparkle(ctx, -0.86, -0.85, 0.19, '#e7f6ff');
    sparkle(ctx, 0.86, -0.8, 0.13, '#a4deff');
  }

  function drawHotPot(ctx) {
    const outline = '#702d34';
    oval(ctx, 0, 0, 0.99, 0.93, '#e55c47', outline);
    oval(ctx, 0.02, -0.11, 0.82, 0.65, '#ffad69', outline);
    oval(ctx, -0.02, -0.17, 0.65, 0.45, '#cb553a');
    line(ctx, '#f7de9b', (p) => {
      p.moveTo(-1.04, 0.03);
      p.lineTo(0.6, -0.78);
      p.moveTo(-0.64, -0.58);
      p.lineTo(0.54, -1.12);
    });
    oval(ctx, -0.33, -0.32, 0.24, 0.23, '#ffb6a3', outline);
    oval(ctx, 0.04, -0.51, 0.24, 0.23, '#ff7464', outline);
    oval(ctx, 0.4, -0.69, 0.24, 0.23, '#ffc55f', outline);
    line(ctx, '#ffd69c', (p) => {
      p.moveTo(-0.65, 0.34);
      p.quadraticCurveTo(0, 0.75, 0.67, 0.38);
    });
    oval(ctx, 0.06, 0.72, 0.11, 0.09, outline);
    oval(ctx, 0.48, 0.57, 0.11, 0.09, outline);
    sparkle(ctx, 0.71, -0.65, 0.2, '#fff4c2');
  }

  function drawHeart(ctx) {
    const outline = '#17424e';
    oval(ctx, 0, 0, 0.99, 0.94, '#6ddcd5', outline);
    oval(ctx, 0.63, 0.11, 0.35, 0.58, '#24384b', outline, -0.18);
    line(ctx, '#94f5ff', (p) => {
      p.moveTo(0.69, -0.22);
      p.quadraticCurveTo(0.9, 0.09, 0.72, 0.45);
    });
    oval(ctx, -0.52, 0.56, 0.34, 0.23, '#288f92', outline, 0.48);
    shape(ctx, '#fa647c', outline, (p) => {
      p.moveTo(-0.59, 0.37);
      p.bezierCurveTo(-0.82, 0.04, -1.32, -0.3, -0.98, -0.67);
      p.quadraticCurveTo(-0.73, -0.95, -0.43, -0.61);
      p.quadraticCurveTo(-0.12, -0.91, 0.11, -0.65);
      p.bezierCurveTo(0.53, -0.25, -0.12, 0.12, -0.59, 0.37);
    });
    line(ctx, '#ffd9aa', (p) => {
      p.moveTo(-0.42, -0.57);
      p.lineTo(-0.62, -0.31);
      p.lineTo(-0.41, -0.17);
      p.lineTo(-0.57, 0.16);
    });
    sparkle(ctx, -0.97, 0.5, 0.22, '#c5fff0');
  }

  function sprite(skin) {
    let canvas = sprites.get(skin.id);
    if (canvas) return canvas;
    canvas = root.document.createElement('canvas');
    canvas.width = canvas.height = spriteSize;
    const ctx = canvas.getContext('2d');
    ctx.translate(spriteSize / 2, spriteSize / 2);
    ctx.scale(spriteRadius, spriteRadius);
    ctx.lineWidth = 0.064;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    skin.art(ctx);
    sprites.set(skin.id, canvas);
    return canvas;
  }

  function draw(ctx, id, radius) {
    const skin = get(id);
    if (!skin || !skin.art) return false;
    const half = radius * spriteSize / (2 * spriteRadius);
    ctx.drawImage(sprite(skin), -half, -half, half * 2, half * 2);
    return true;
  }

  function preview(canvas, id, color) {
    const ctx = canvas.getContext('2d');
    const radius = Math.min(canvas.width, canvas.height) * 0.31;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    if (!draw(ctx, id, radius)) {
      ctx.lineWidth = radius * 0.12;
      oval(ctx, 0, 0, radius, radius, color, '#131a12');
      oval(ctx, -radius * 0.28, -radius * 0.33, radius * 0.28, radius * 0.15, 'rgba(255,255,255,0.24)', null, -0.44);
    }
    ctx.restore();
  }

  ZR.Cosmetics = Object.freeze({ catalog, get, validate, draw, preview });
})(typeof window !== 'undefined' ? window : globalThis);
