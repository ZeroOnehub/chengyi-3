// 山河器物地图：底图、雾层、器物与热点同在“地图坐标系”里一起拖动缩放；
// 光河流光、环境微粒、鼠标拖尾画在屏幕坐标系的画布上。
import { $, clamp, fitCanvas, glowSprite, rng, sampleSpline, pointAt, tween, easeInOut } from './util.js';
import { MAP_SIZE, OBJECTS, RIVER } from './data.js';

const W = MAP_SIZE.w, H = MAP_SIZE.h;
let app, viewport, world, canvas, ctx, itemsEl, hint;
let raf = 0, last = 0, running = false;
const view = { s: 1, x: 0, y: 0 };
const target = { s: 1, x: 0, y: 0 };
let saved = null, prepared = false, focusing = false, focusTween = null;
let minS = 1, maxS = 2.6;
const river = sampleSpline(RIVER, 20);
const gold = glowSprite('255,212,140');
const pale = glowSprite('235,230,200');
let glints = [], motes = [], trail = [];
let pointer = { x: -1, y: -1, inside: false };
let drag = null, dragMoved = false;

function limits() {
  const vw = viewport.clientWidth, vh = viewport.clientHeight;
  minS = Math.max(vw / W, vh / H);
  maxS = minS * 2.6;
  return { vw, vh };
}

function clampView(v) {
  const { vw, vh } = limits();
  v.s = clamp(v.s, minS, maxS);
  v.x = clamp(v.x, vw - W * v.s, 0);
  v.y = clamp(v.y, vh - H * v.s, 0);
  return v;
}

function homeView() {
  const { vw, vh } = limits();
  return { s: minS, x: (vw - W * minS) / 2, y: (vh - H * minS) / 2 };
}

function apply() {
  world.style.transform = `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.s})`;
  world.style.setProperty('--inv', (1 / view.s).toFixed(3));
}

function zoomAt(mx, my, factor) {
  const s2 = clamp(target.s * factor, minS, maxS);
  const wx = (mx - target.x) / target.s, wy = (my - target.y) / target.s;
  target.s = s2;
  target.x = mx - wx * s2;
  target.y = my - wy * s2;
  clampView(target);
  hint.classList.add('off');
}

function seed() {
  const r = rng(5);
  glints = Array.from({ length: 90 }, () => ({ u: r(), sp: 0.006 + r() * 0.01, off: (r() - 0.5) * 2, sz: 0.5 + r(), tw: r() * 6.28 }));
  motes = Array.from({ length: 40 }, () => ({ x: r() * W, y: 120 + r() * (H - 120), z: r(), ph: r() * 6.28 }));
  // 山谷与边缘的薄雾（属于地形，跟随地图移动）
  const fogEl = $('#map-fog');
  fogEl.innerHTML = '';
  const spots = [[60, 330, 520, 180], [300, 560, 620, 200], [1120, 300, 560, 170], [1250, 600, 520, 220], [700, 180, 600, 140], [-80, 700, 520, 260], [1380, 150, 420, 160], [820, 420, 380, 140]];
  spots.forEach(([x, y, w, h], i) => {
    const d = document.createElement('i');
    d.className = 'fog';
    d.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px;--dur:${32 + i * 7}s;--dx:${(i % 2 ? -1 : 1) * (40 + i * 8)}px;--dy:${(i % 3) * 6 - 6}px;--o1:${0.55 + (i % 3) * 0.1};--o2:1;animation-delay:${-i * 5}s`;
    fogEl.appendChild(d);
  });
}

function buildItems() {
  itemsEl.innerHTML = '';
  for (const o of OBJECTS) {
    const b = document.createElement('button');
    b.className = 'map-item' + (o.status === 'open' ? ' open' : '');
    b.dataset.id = o.id;
    b.style.cssText = `left:${o.map.x}px;top:${o.map.y}px;width:${o.map.w}px;height:${o.map.h}px`;
    b.setAttribute('aria-label', `${o.label}，${o.statusText}`);
    b.innerHTML = `<img src="${o.map.img}" alt=""><span class="tag"><b>${o.label}</b><small>${o.status === 'open' ? '可在线创作' : '即将开放'}</small></span>`;
    b.addEventListener('click', (e) => {
      if (dragMoved || focusing) { e.preventDefault(); return; }
      focus(o, b);
    });
    itemsEl.appendChild(b);
  }
}

function frame(now) {
  raf = requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - (last || now)) / 1000);
  last = now;
  if (!focusing) {
    const k = app.reduced ? 1 : 1 - Math.exp(-dt * 12);
    view.s += (target.s - view.s) * k;
    view.x += (target.x - view.x) * k;
    view.y += (target.y - view.y) * k;
  }
  apply();
  draw(now / 1000, dt);
}

function draw(t, dt) {
  fitCanvas(canvas);
  const dpr = canvas.width / canvas.clientWidth;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (app.reduced) return;
  ctx.globalCompositeOperation = 'lighter';
  const toS = (x, y) => [(view.x + x * view.s) * dpr, (view.y + y * view.s) * dpr];

  // 光河：暖金光点由远向近缓慢流动，贴合原图河道；近处更宽更大
  for (const g of glints) {
    g.u += g.sp * dt * (0.6 + g.u);
    if (g.u > 1) g.u -= 1;
    const [x, y, ang] = pointAt(river, g.u);
    const persp = 0.35 + (y / H) * 1.1;
    const spread = 4 + persp * 18;
    const nx = -Math.sin(ang), ny = Math.cos(ang);
    const [sx, sy] = toS(x + nx * g.off * spread, y + ny * g.off * spread * 0.4);
    const fade = Math.min(1, g.u * 8, (1 - g.u) * 6);
    const tw = 0.55 + 0.45 * Math.sin(t * 3 + g.tw);
    const r = (1.4 + g.sz * 2.4) * persp * view.s * dpr;
    ctx.globalAlpha = 0.8 * fade * tw;
    ctx.drawImage(gold, sx - r * 2, sy - r * 2, r * 4, r * 4);
  }

  // 少量悬浮微粒，随地图视差轻移
  for (const m of motes) {
    const px = m.x + Math.sin(t * 0.2 + m.ph) * 14, py = m.y + Math.cos(t * 0.15 + m.ph) * 8 - (t * 6 * m.z) % 60;
    const par = 1 + m.z * 0.25;
    const sx = (view.x * par + px * view.s) * dpr, sy = (view.y * par + py * view.s) * dpr;
    const r = (1 + m.z * 3) * dpr;
    ctx.globalAlpha = 0.2 + 0.3 * (0.5 + 0.5 * Math.sin(t * 1.3 + m.ph));
    ctx.drawImage(pale, sx - r * 2, sy - r * 2, r * 4, r * 4);
  }

  // 鼠标拖尾：短而轻，停下后迅速衰减
  const nowMs = performance.now();
  trail = trail.filter((p) => nowMs - p.t < 420);
  for (let i = 0; i < trail.length; i++) {
    const p = trail[i], age = (nowMs - p.t) / 420;
    const r = (5 - age * 4) * dpr;
    ctx.globalAlpha = (1 - age) * 0.55;
    ctx.drawImage(gold, p.x * dpr - r * 2, p.y * dpr - r * 2, r * 4, r * 4);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

function onPointerDown(e) {
  if (focusing || e.button !== 0) return;
  dragMoved = false;
  drag = { x: e.clientX, y: e.clientY, vx: target.x, vy: target.y, id: e.pointerId };
}
function onPointerMove(e) {
  const rect = viewport.getBoundingClientRect();
  pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top, inside: true };
  if (!app.reduced && e.pointerType === 'mouse') trail.push({ x: pointer.x, y: pointer.y, t: performance.now() });
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (!dragMoved && Math.hypot(dx, dy) > 6) {
    dragMoved = true;
    viewport.classList.add('dragging');
    viewport.setPointerCapture?.(drag.id);
    hint.classList.add('off');
  }
  if (dragMoved) {
    target.x = drag.vx + dx;
    target.y = drag.vy + dy;
    clampView(target);
  }
}
function onPointerUp() {
  drag = null;
  viewport.classList.remove('dragging');
  // dragMoved 保留到下一次按下，用于屏蔽本次 click
  setTimeout(() => { dragMoved = false; }, 0);
}

async function focus(o, btn) {
  if (focusing) return;
  focusing = true;
  saved = { ...target };
  const rect = btn.getBoundingClientRect();
  const { vw, vh } = limits();
  const cx = o.map.x + o.map.w / 2, cy = o.map.y + o.map.h / 2;
  const s0 = { ...view };
  const s2 = Math.min(maxS * 1.1, view.s * 2.4);
  const to = { s: s2, x: vw / 2 - cx * s2, y: vh * 0.52 - cy * s2 };
  btn.style.visibility = 'hidden';
  const dur = app.reduced ? 250 : 1100;
  // 地图镜头向目标推进；器物本身由近景模块接手，从原位飞向中央
  app.go('object', { id: o.id, fromRect: rect, fromMap: true });
  focusTween = tween(dur, (k) => {
    view.s = s0.s + (to.s - s0.s) * k;
    view.x = s0.x + (to.x - s0.x) * k;
    view.y = s0.y + (to.y - s0.y) * k;
  }, easeInOut);
  await focusTween;
}

export const map = {
  init(a) {
    app = a;
    viewport = $('#map-viewport');
    world = $('#map-world');
    canvas = $('#map-fx');
    ctx = canvas.getContext('2d');
    itemsEl = $('#map-items');
    hint = $('#map-hint');
    seed();
    buildItems();
    viewport.addEventListener('pointerdown', onPointerDown);
    viewport.addEventListener('pointermove', onPointerMove);
    viewport.addEventListener('pointerup', onPointerUp);
    viewport.addEventListener('pointercancel', onPointerUp);
    viewport.addEventListener('pointerleave', () => { pointer.inside = false; });
    viewport.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (focusing) return;
      const rect = viewport.getBoundingClientRect();
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.0016));
    }, { passive: false });
    $('#zoom-in').addEventListener('click', () => { const { vw, vh } = limits(); zoomAt(vw / 2, vh / 2, 1.3); });
    $('#zoom-out').addEventListener('click', () => { const { vw, vh } = limits(); zoomAt(vw / 2, vh / 2, 1 / 1.3); });
    window.addEventListener('resize', () => { if (!focusing) { clampView(target); Object.assign(view, clampView({ ...view })); } });
    window.addEventListener('keydown', (e) => {
      if (app.scene !== 'map') return;
      const { vw, vh } = limits();
      if (e.key === '+' || e.key === '=') zoomAt(vw / 2, vh / 2, 1.25);
      if (e.key === '-') zoomAt(vw / 2, vh / 2, 0.8);
    });
  },
  /** 过场视频播放时提前摆好首帧取景：与视频尾帧一致的整幅铺满视角。 */
  prepare() {
    if (prepared) return;
    prepared = true;
    Object.assign(view, homeView());
    Object.assign(target, view);
    apply();
  },
  enter(opts) {
    app.setBrand('承艺');
    focusing = false;
    focusTween?.cancel();
    itemsEl.querySelectorAll('.map-item').forEach((b) => { b.style.visibility = ''; });
    if (!prepared) this.prepare();
    if (opts.back && saved) {
      // 从近景返回：回到离开前的视角，带一点后退的镜头
      Object.assign(target, clampView({ ...saved }));
      const { vw, vh } = limits();
      const k = 1.5, s = target.s * k;
      Object.assign(view, { s, x: vw / 2 - ((vw / 2 - target.x) / target.s) * s, y: vh / 2 - ((vh / 2 - target.y) / target.s) * s });
    }
    hint.classList.toggle('off', !!opts.back);
    running = true;
    last = 0;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(frame);
  },
  leave() {
    running = false;
    // 推进镜头与淡出期间继续渲染，结束后停下
    setTimeout(() => { if (!running) cancelAnimationFrame(raf); }, 1300);
  },
};
