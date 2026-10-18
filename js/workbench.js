// 工作台：以青瓷云纹瓶 GLB 为坯，调整器型（轮廓变形）、釉色、纹样；AI 助手给建议；
// 完成后入窑、命名，生成分享图，进入分享页。
import * as THREE from 'three';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { RoomEnvironment } from './vendor/RoomEnvironment.js';
import { $, clamp, lerp, prefs, rng, tween, wait, easeInOut, loadImage } from './util.js';
import { SHAPES, GLAZES, PATTERNS, INKS, DEFAULT_WORK } from './data.js';
import { interpret, inspire, nameFor, summary } from './ai.js';

const Y0 = 0.3009; // 原模型高度（米）
const TEX = 1024;
const STEPS = [
  { id: 'shape', num: '壹', name: '器型', sub: '塑坯' },
  { id: 'glaze', num: '贰', name: '釉色', sub: '施釉' },
  { id: 'pattern', num: '叁', name: '纹样', sub: '绘饰' },
];
const byId = (list, id) => list.find((x) => x.id === id);

let app, wrap, renderer, scene, camera, vase, outerMat, innerMat, texCanvas, texCtx, texture;
let geoms = [], basePos = new Map(), profile = null; // geoms: [{pos, nor}]，按位置属性去重
let base = null; // 原贴图分解：细节、蓝色纹样遮罩
let masks = {};
let work = { ...DEFAULT_WORK }, history = [], hIndex = -1;
let step = 'shape', raf = 0, running = false, firing = false, ready = null;
let rot = { y: 0.4, x: 0.1, vy: 0, vx: 0 }, dist = 1.5, distT = 1.5, lastInput = 0, dragging = null;
let pendingAI = null;

// ---------- 场景 ----------
function setupScene() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  wrap.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;

  camera = new THREE.PerspectiveCamera(26, 1, 0.01, 20);

  scene.add(new THREE.HemisphereLight(0x8fb2ad, 0x0b1112, 0.7));
  const key = new THREE.SpotLight(0xffe2b8, 9, 4, 0.55, 0.85, 1.6);
  key.position.set(0.15, 1.6, 0.55);
  key.target.position.set(0, 0.12, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.bias = -0.0004;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(0xd8e6e2, 0.55);
  fill.position.set(-1, 0.6, 1.2);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0x7fb3b0, 1.4);
  rim.position.set(-0.8, 0.9, -1.2);
  scene.add(rim);

  // 青铜圆台（呼应篇章结尾的展台）
  const ringTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 512;
    const g = c.getContext('2d');
    g.fillStyle = '#5a3e2a'; g.fillRect(0, 0, 512, 512);
    for (let r = 4; r < 256; r += 3) {
      g.strokeStyle = `rgba(${r % 2 ? 210 : 40},${r % 2 ? 160 : 25},${r % 2 ? 110 : 10},${0.05 + Math.random() * 0.08})`;
      g.lineWidth = 1 + Math.random();
      g.beginPath(); g.arc(256, 256, r, 0, Math.PI * 2); g.stroke();
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const bronze = new THREE.MeshStandardMaterial({ color: 0x5c3d27, metalness: 0.8, roughness: 0.38, map: ringTex });
  const side = new THREE.MeshStandardMaterial({ color: 0x4a3221, metalness: 0.7, roughness: 0.5 });
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.174, 0.03, 128), [side, bronze, side]);
  plinth.position.y = -0.015;
  plinth.receiveShadow = true;
  scene.add(plinth);
  const lip = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.0018, 8, 160), new THREE.MeshStandardMaterial({ color: 0xd8a877, metalness: 0.9, roughness: 0.3 }));
  lip.rotation.x = Math.PI / 2;
  lip.position.y = -0.0005;
  scene.add(lip);
}

function resize() {
  const w = wrap.clientWidth, h = wrap.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // 窄屏时拉远一些，保证器物完整
  camera.userData.fit = w / h < 1 ? 1.5 : 1;
  camera.updateProjectionMatrix();
}

// ---------- 模型 ----------
async function loadVase() {
  const gltf = await new GLTFLoader().loadAsync('assets/model/celadon-vase.glb');
  vase = new THREE.Group();
  const meshes = [];
  gltf.scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
  for (const m of meshes) {
    m.castShadow = true;
    m.receiveShadow = true;
    const g = m.geometry;
    const pos = g.attributes.position, nor = g.attributes.normal;
    if (!geoms.some((x) => x.pos === pos)) {
      geoms.push({ pos, nor, g });
      basePos.set(pos, pos.array.slice());
      basePos.set(nor, nor.array.slice());
    }
    if (m.material.map) { outerMat = m.material; outerMat.userData.geom = g; } else innerMat = m.material;
  }
  vase.add(gltf.scene);
  scene.add(vase);

  // 轮廓（外壁）用于器型缩略图
  const pos = outerMat.userData.geom.attributes.position;
  const bins = new Float32Array(80);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i), r = Math.hypot(pos.getX(i), pos.getZ(i));
    const b = Math.min(79, Math.max(0, Math.floor((y / Y0) * 80)));
    if (r > bins[b]) bins[b] = r;
  }
  profile = bins;

  // 贴图分解
  const img = outerMat.map.image;
  texCanvas = document.createElement('canvas');
  texCanvas.width = texCanvas.height = TEX;
  texCtx = texCanvas.getContext('2d', { willReadFrequently: true });
  texCtx.drawImage(img, 0, 0, TEX, TEX);
  const src = texCtx.getImageData(0, 0, TEX, TEX).data;
  const n = TEX * TEX;
  const detail = new Float32Array(n), blue = new Float32Array(n);
  let sum = 0, cnt = 0;
  for (let i = 0; i < n; i++) {
    const r = src[i * 4], g = src[i * 4 + 1], b = src[i * 4 + 2];
    const m = clamp((b - r - 18) / 95);
    blue[i] = m;
    const L = 0.3 * r + 0.59 * g + 0.11 * b;
    detail[i] = L;
    if (m < 0.05) { sum += L; cnt++; }
  }
  const mean = sum / Math.max(1, cnt);
  for (let i = 0; i < n; i++) detail[i] = clamp(detail[i] / mean, 0.7, 1.18);
  base = { detail, blue };
  masks.cloud = blue;
  masks.lotus = drawMask(paintLotus);
  masks.wave = drawMask(paintWave);
  masks.crackle = drawMask(paintCrackle);

  texture = new THREE.CanvasTexture(texCanvas);
  texture.flipY = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  outerMat.map = texture;
  outerMat.envMapIntensity = 0.7;
  outerMat.needsUpdate = true;
}

// ---------- 纹样遮罩（在展开的柱面贴图上绘制，横向无缝） ----------
function drawMask(fn) {
  const c = document.createElement('canvas');
  c.width = c.height = TEX;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, TEX, TEX);
  g.fillStyle = g.strokeStyle = '#fff';
  for (const off of [-TEX, 0, TEX]) { g.save(); g.translate(off, 0); fn(g); g.restore(); }
  const blur = document.createElement('canvas');
  blur.width = blur.height = TEX;
  const b = blur.getContext('2d');
  b.filter = 'blur(1.2px)';
  b.drawImage(c, 0, 0);
  const d = b.getImageData(0, 0, TEX, TEX).data;
  const m = new Float32Array(TEX * TEX);
  for (let i = 0; i < m.length; i++) m[i] = d[i * 4] / 255;
  return m;
}
function borders(g, ys) { g.lineWidth = 3; ys.forEach((y) => { g.beginPath(); g.moveTo(0, y); g.lineTo(TEX, y); g.stroke(); }); }
function paintLotus(g) {
  const r = rng(4), y0 = 620, A = 70, periods = 3;
  borders(g, [400, 410, 900, 910]);
  g.lineWidth = 7; g.lineCap = 'round';
  g.beginPath();
  for (let x = 0; x <= TEX; x += 4) { const y = y0 + A * Math.sin((x / TEX) * Math.PI * 2 * periods); x ? g.lineTo(x, y) : g.moveTo(x, y); }
  g.stroke();
  for (let k = 0; k < periods * 2; k++) {
    const x = ((k + 0.25) / (periods * 2)) * TEX, up = k % 2 === 0;
    const y = y0 + (up ? A : -A) * 1;
    // 莲花：五瓣
    g.save(); g.translate(x, y + (up ? -10 : 10));
    for (let p = -2; p <= 2; p++) { g.save(); g.rotate(p * 0.42); g.beginPath(); g.ellipse(0, -38, 14, 40, 0, 0, Math.PI * 2); g.globalAlpha = 0.85; g.fill(); g.restore(); }
    g.globalAlpha = 1; g.beginPath(); g.arc(0, 4, 12, 0, Math.PI * 2); g.fill();
    g.restore();
    // 叶与卷须
    for (let s = -1; s <= 1; s += 2) {
      const lx = x + s * 70, ly = y0 + (up ? A : -A) * Math.cos(s * 0.4) * 0.4;
      g.save(); g.translate(lx, ly); g.rotate(s * 0.7 + (up ? 0.3 : -0.3));
      g.beginPath(); g.ellipse(0, 0, 34, 12, 0, 0, Math.PI * 2); g.fill(); g.restore();
      g.lineWidth = 3; g.beginPath(); g.arc(x + s * 120, y0 + (up ? -20 : 20), 18 + r() * 6, 0, Math.PI * 1.5); g.stroke();
    }
  }
}
function paintWave(g) {
  borders(g, [400, 410]);
  g.lineWidth = 4;
  const rows = [[700, 64], [745, 64], [790, 64], [835, 64], [880, 64]];
  rows.forEach(([y, w], i) => {
    const off = (i % 2) * (w / 2);
    for (let x = -w + off; x < TEX + w; x += w) {
      for (let k = 0; k < 3; k++) { g.beginPath(); g.arc(x, y + 28, 30 - k * 9, Math.PI, Math.PI * 2); g.stroke(); }
    }
  });
  // 浪头
  for (let x = 30; x < TEX; x += 256) {
    g.beginPath(); g.moveTo(x, 690); g.bezierCurveTo(x + 40, 600, x + 120, 610, x + 110, 660); g.bezierCurveTo(x + 100, 690, x + 70, 680, x + 78, 660); g.lineWidth = 6; g.stroke();
  }
  borders(g, [910, 920]);
}
function paintCrackle(g) {
  const r = rng(12);
  g.lineWidth = 1.4;
  for (let i = 0; i < 520; i++) {
    let x = r() * TEX, y = r() * TEX;
    g.globalAlpha = 0.4 + r() * 0.6;
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 3; k++) { x += (r() - 0.5) * 70; y += (r() - 0.5) * 70; g.lineTo(x, y); }
    g.stroke();
  }
  g.globalAlpha = 1;
}

// ---------- 应用作品参数 ----------
function applyShape() {
  const sp = byId(SHAPES, work.shape).p;
  const Wm = sp.W * work.W, Hm = sp.H * work.H;
  const G = (h, m, s) => Math.exp(-0.5 * ((h - m) / s) ** 2);
  const dG = (h, m, s) => -((h - m) / (s * s)) * G(h, m, s);
  for (const { pos, nor, g } of geoms) {
    const P0 = basePos.get(pos), N0 = basePos.get(nor);
    const p = pos.array, n = nor.array;
    for (let i = 0; i < pos.count; i++) {
      const x = P0[i * 3], y = P0[i * 3 + 1], z = P0[i * 3 + 2];
      const h = y / Y0;
      const f = Wm * (1 + sp.B * G(h, 0.33, 0.14) + sp.S * G(h, 0.56, 0.09) + sp.N * G(h, 0.8, 0.08));
      const fp = Wm * (sp.B * dG(h, 0.33, 0.14) + sp.S * dG(h, 0.56, 0.09) + sp.N * dG(h, 0.8, 0.08)) / Y0;
      p[i * 3] = x * f; p[i * 3 + 1] = y * Hm; p[i * 3 + 2] = z * f;
      // 法线按雅可比逆转置变换：(x,y,z) → (x·f(h), y·H, z·f(h))
      const nx = N0[i * 3], ny = N0[i * 3 + 1], nz = N0[i * 3 + 2];
      const mx = nx / f, my = (-x * fp * nx - z * fp * nz) / (f * Hm) + ny / Hm, mz = nz / f;
      const L = Math.hypot(mx, my, mz) || 1;
      n[i * 3] = mx / L; n[i * 3 + 1] = my / L; n[i * 3 + 2] = mz / L;
    }
    pos.needsUpdate = nor.needsUpdate = true;
    g.computeBoundingSphere();
    g.computeBoundingBox();
  }
  vase.userData.height = Y0 * Hm;
}

function applySurface() {
  const g = byId(GLAZES, work.glaze).rgb;
  const ink = byId(INKS, work.ink).rgb;
  const mask = work.pattern === 'plain' ? null : masks[work.pattern];
  const crack = work.crackle ? masks.crackle : null;
  const img = texCtx.createImageData(TEX, TEX);
  const d = img.data, det = base.detail, blue = base.blue;
  const inkA = work.ink === 'gold' ? 0.85 : 0.92;
  for (let i = 0; i < det.length; i++) {
    // 原纹样处的底色细节不可靠，用平均值代替
    const dt = lerp(det[i], 1, blue[i]);
    let r = g[0] * dt, gg = g[1] * dt, b = g[2] * dt;
    if (mask) {
      const m = mask[i] * inkA;
      // 青花浓淡：原云纹保留晕散深浅，绘制纹样略带笔触起伏
      const depth = work.pattern === 'cloud' ? 0.65 + 0.35 * mask[i] : 0.85;
      r = lerp(r, ink[0] * (2 - depth), m); gg = lerp(gg, ink[1] * (2 - depth), m); b = lerp(b, ink[2] * (2 - depth), m);
    }
    if (crack) { const c = 1 - crack[i] * 0.28; r *= c; gg *= c; b *= c; }
    d[i * 4] = r; d[i * 4 + 1] = gg; d[i * 4 + 2] = b; d[i * 4 + 3] = 255;
  }
  texCtx.putImageData(img, 0, 0);
  texture.needsUpdate = true;
  const soft = work.gloss === 'soft';
  outerMat.roughness = soft ? 0.42 : 0.2;
  outerMat.clearcoat = soft ? 0.32 : 0.66;
  outerMat.clearcoatRoughness = soft ? 0.32 : 0.12;
  if (innerMat) innerMat.color.setRGB(...g.map((v) => (v / 255) ** 2.2 * 0.6));
}

function applyAll(prev) {
  if (!prev || prev.shape !== work.shape || prev.W !== work.W || prev.H !== work.H) applyShape();
  if (!prev || ['glaze', 'ink', 'pattern', 'crackle', 'gloss'].some((k) => prev[k] !== work[k])) applySurface();
}

function commit(patch, record = true) {
  const prev = { ...work };
  Object.assign(work, patch);
  if (JSON.stringify(prev) === JSON.stringify(work)) return;
  if (record) {
    history = history.slice(0, hIndex + 1);
    history.push({ ...work });
    hIndex = history.length - 1;
  }
  applyAll(prev);
  prefs.set('draft', work);
  renderPanel();
  updateUndo();
}
function undo() { if (hIndex > 0) { hIndex--; const prev = { ...work }; work = { ...history[hIndex] }; applyAll(prev); prefs.set('draft', work); renderPanel(); updateUndo(); } }
function redo() { if (hIndex < history.length - 1) { hIndex++; const prev = { ...work }; work = { ...history[hIndex] }; applyAll(prev); prefs.set('draft', work); renderPanel(); updateUndo(); } }
function updateUndo() { $('#wb-undo').disabled = hIndex <= 0; $('#wb-redo').disabled = hIndex >= history.length - 1; }

// ---------- 界面 ----------
function shapeSvg(p) {
  if (!profile) return '';
  const pts = [];
  const maxR = 0.13, G = (h, m, s) => Math.exp(-0.5 * ((h - m) / s) ** 2);
  for (let b = 0; b < 80; b++) {
    const h = (b + 0.5) / 80;
    const f = p.W * (1 + p.B * G(h, 0.33, 0.14) + p.S * G(h, 0.56, 0.09) + p.N * G(h, 0.8, 0.08));
    const r = profile[b] * f;
    pts.push([17 + (r / maxR) * 16, 48 - h * 44 * p.H]);
  }
  const right = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const left = pts.slice().reverse().map(([x, y]) => `${(34 - x).toFixed(1)},${y.toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 34 50" aria-hidden="true"><polygon points="${right} ${left}" fill="rgba(214,180,122,.18)" stroke="currentColor" stroke-width="1"/></svg>`;
}
function swatch(rgb) {
  const [r, g, b] = rgb;
  return `<span class="sw" style="background:radial-gradient(circle at 35% 30%, rgb(${Math.min(255, r + 30)},${Math.min(255, g + 30)},${Math.min(255, b + 30)}), rgb(${r},${g},${b}) 55%, rgb(${r * 0.7 | 0},${g * 0.7 | 0},${b * 0.7 | 0}))"></span>`;
}
function patternThumb(id) {
  const c = document.createElement('canvas');
  c.width = c.height = 80;
  const g = c.getContext('2d');
  const gl = byId(GLAZES, work.glaze).rgb, ink = byId(INKS, work.ink).rgb;
  g.fillStyle = `rgb(${gl})`; g.fillRect(0, 0, 80, 80);
  const m = id === 'plain' ? null : masks[id];
  if (m) {
    const img = g.getImageData(0, 0, 80, 80);
    for (let y = 0; y < 80; y++) for (let x = 0; x < 80; x++) {
      const sx = Math.floor(x * 5.12) % TEX, sy = Math.floor(380 + y * 7);
      const k = m[sy * TEX + sx] * 0.92, i = (y * 80 + x) * 4;
      for (let ch = 0; ch < 3; ch++) img.data[i + ch] = lerp(img.data[i + ch], ink[ch], k);
    }
    g.putImageData(img, 0, 0);
  }
  return c;
}

function renderSteps() {
  const nav = $('#wb-steps');
  const idx = STEPS.findIndex((s) => s.id === step);
  nav.innerHTML = STEPS.map((s, i) => `<button class="wb-step${s.id === step ? ' on' : ''}${i < idx ? ' done' : ''}" data-step="${s.id}"><i></i><span>${s.num} · ${s.name}<small>${s.sub}</small></span></button>`).join('');
  nav.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { step = b.dataset.step; renderSteps(); renderPanel(); }));
}

function renderPanel() {
  const panel = $('#wb-panel');
  const opt = (list, key, inner, cls = '') => `<div class="opt-grid ${cls}">${list.map((o) => `<button class="opt" data-k="${key}" data-v="${o.id}" aria-pressed="${work[key] === o.id}" title="${o.note || o.name}">${inner(o)}<span>${o.name}</span></button>`).join('')}</div>`;
  if (step === 'shape') {
    const sp = byId(SHAPES, work.shape);
    panel.innerHTML = `<h3>器型</h3><p class="lede">选一个基本形，再微调宽窄与高矮。形变在原模型上进行，效果为示意。</p>
      <div class="wb-group"><div class="wb-group-title">基本形 <em>${sp.name}</em></div>${opt(SHAPES, 'shape', (o) => shapeSvg(o.p))}</div>
      <div class="wb-group"><div class="wb-group-title">比例</div>
        <label class="slider"><span>窄</span><input type="range" min="0.85" max="1.18" step="0.01" value="${work.W}" data-k="W" aria-label="宽窄"><span>宽</span></label>
        <label class="slider"><span>矮</span><input type="range" min="0.88" max="1.14" step="0.01" value="${work.H}" data-k="H" aria-label="高矮"><span>高</span></label>
      </div>
      <button class="pill-btn next" data-next="glaze">下一步：施釉 <span aria-hidden="true">›</span></button>`;
  } else if (step === 'glaze') {
    const gl = byId(GLAZES, work.glaze);
    panel.innerHTML = `<h3>釉色</h3><p class="lede">釉色要在窑火中才会真正显现，这里预览的是烧成后的效果。</p>
      <div class="wb-group"><div class="wb-group-title">釉色 <em>${gl.name}</em></div>${opt(GLAZES, 'glaze', (o) => swatch(o.rgb), 'cols-3')}</div>
      <div class="wb-group"><div class="wb-group-title">釉面</div><div class="toggle-row">
        <button class="chip" data-k="gloss" data-v="bright" aria-pressed="${work.gloss === 'bright'}">亮釉</button>
        <button class="chip" data-k="gloss" data-v="soft" aria-pressed="${work.gloss === 'soft'}">润釉</button>
        <button class="chip" data-k="crackle" data-v="toggle" aria-pressed="${work.crackle}">开片</button></div></div>
      <button class="pill-btn next" data-next="pattern">下一步：绘饰 <span aria-hidden="true">›</span></button>`;
  } else {
    const pt = byId(PATTERNS, work.pattern);
    panel.innerHTML = `<h3>纹样</h3><p class="lede">纹样绕器身一周。纹色为示意效果，可与釉色自由搭配。</p>
      <div class="wb-group"><div class="wb-group-title">纹样 <em>${pt.name}</em></div><div class="opt-grid">${PATTERNS.map((o) => `<button class="opt" data-k="pattern" data-v="${o.id}" aria-pressed="${work.pattern === o.id}" title="${o.note}"><span class="pat" data-pat="${o.id}"></span><span>${o.name}</span></button>`).join('')}</div></div>
      <div class="wb-group"><div class="wb-group-title">纹色 <em>${byId(INKS, work.ink).name}</em></div>${opt(INKS, 'ink', (o) => swatch(o.rgb))}</div>
      <button class="pill-btn pill-strong next" data-finish>完成，入窑 <span aria-hidden="true">›</span></button>`;
    panel.querySelectorAll('.pat').forEach((s) => s.appendChild(patternThumb(s.dataset.pat)));
    panel.querySelectorAll('[data-k="ink"]').forEach((b) => { b.disabled = work.pattern === 'plain'; });
  }
  panel.querySelectorAll('button[data-k]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.k;
    commit({ [k]: k === 'crackle' ? !work.crackle : b.dataset.v, ...(k === 'shape' ? { W: 1, H: 1 } : {}) });
  }));
  panel.querySelectorAll('input[type="range"]').forEach((r) => {
    r.addEventListener('input', () => { const prev = { ...work }; work[r.dataset.k] = +r.value; applyAll(prev); });
    r.addEventListener('change', () => { const v = +r.value; work[r.dataset.k] = history[hIndex]?.[r.dataset.k]; commit({ [r.dataset.k]: v }); });
  });
  panel.querySelector('[data-next]')?.addEventListener('click', (e) => { step = e.currentTarget.dataset.next; renderSteps(); renderPanel(); });
  panel.querySelector('[data-finish]')?.addEventListener('click', finish);
  renderSteps();
}

// ---------- AI ----------
function showReply(res) {
  const box = $('#ai-reply');
  pendingAI = res.patch ? res : null;
  box.hidden = false;
  box.innerHTML = `<span class="ai-who">承艺 AI${res.live ? '' : ' · 演示'}</span>${res.reply}` +
    (res.chips?.length ? `<div class="ai-chips">${res.chips.map((c) => `<span>${c}</span>`).join('')}</div>` : '') +
    `<div class="ai-actions">${res.patch ? '<button class="link-btn" data-a="no">再想想</button><button class="link-btn apply" data-a="yes">按这个改</button>' : '<button class="link-btn" data-a="no">知道了</button>'}</div>`;
  box.querySelector('[data-a="no"]').onclick = () => { box.hidden = true; pendingAI = null; };
  box.querySelector('[data-a="yes"]')?.addEventListener('click', () => {
    const p = { ...pendingAI.patch };
    if (p.shape && !('W' in p)) p.W = 1;
    if (p.shape && !('H' in p)) p.H = 1;
    commit(p);
    if (pendingAI.step) { step = pendingAI.step; renderSteps(); renderPanel(); }
    box.hidden = true; pendingAI = null;
    app.toast('已按建议修改，可随时撤销');
  });
}

// ---------- 交互 ----------
function onDown(e) {
  if (firing || e.button !== 0) return;
  dragging = { x: e.clientX, y: e.clientY };
  wrap.setPointerCapture?.(e.pointerId);
  wrap.classList.add('dragging');
  $('#wb-drag-hint').classList.add('off');
}
function onMove(e) {
  if (!dragging) return;
  const dx = e.clientX - dragging.x, dy = e.clientY - dragging.y;
  dragging = { x: e.clientX, y: e.clientY };
  rot.vy = dx * 0.008; rot.vx = dy * 0.004;
  rot.y += rot.vy; rot.x = clamp(rot.x + rot.vx, -0.2, 0.35);
  lastInput = performance.now();
}
function onUp() { dragging = null; wrap.classList.remove('dragging'); }

function frame(now) {
  raf = requestAnimationFrame(frame);
  if (!vase) return;
  const idle = now - lastInput > 3500;
  if (!dragging) {
    rot.vy *= 0.94; rot.vx *= 0.9;
    rot.y += rot.vy + (idle && !app.reduced ? 0.0022 : 0);
    rot.x = clamp(rot.x + rot.vx, -0.2, 0.35);
    if (idle) rot.x += (0.1 - rot.x) * 0.02;
  }
  dist += (distT - dist) * 0.12;
  vase.rotation.y = rot.y;
  const H = vase.userData.height || Y0;
  const fit = camera.userData.fit || 1;
  const d = dist * fit * (0.75 + H / Y0 * 0.25);
  const ty = H * 0.38;
  camera.position.set(0, ty + Math.sin(rot.x) * d, Math.cos(rot.x) * d);
  camera.lookAt(0, ty - 0.012, 0);
  renderer.render(scene, camera);
}

// ---------- 入窑与完成 ----------
async function finish() {
  if (firing) return;
  firing = true;
  const sc = $('#scene-workbench');
  sc.classList.add('firing');
  $('#ai-reply').hidden = true;
  const kiln = $('#wb-kiln'), cap = $('#wb-caption');
  const say = async (text, ms) => { cap.textContent = text; cap.classList.add('on'); await wait(ms); cap.classList.remove('on'); await wait(300); };
  kiln.classList.add('on');
  const em = new THREE.Color(1, 0.42, 0.12);
  outerMat.emissive = em;
  const heat = tween(app.reduced ? 600 : 4200, (_, t) => {
    const k = Math.sin(Math.PI * Math.min(1, t * 1.05));
    outerMat.emissiveIntensity = k * 0.55;
    renderer.toneMappingExposure = 1.05 + k * 0.25;
  }, (x) => x);
  if (!app.reduced) {
    await say('入窑 · 升温', 900);
    await say('窑火 · 一千三百度', 900);
    await say('还原 · 釉色渐成', 900);
  }
  await heat;
  outerMat.emissiveIntensity = 0;
  renderer.toneMappingExposure = 1.05;
  kiln.classList.remove('on');
  await say('开窑', 700);
  const dlg = $('#name-dialog');
  $('#work-name').value = nameFor(work);
  $('#work-author').value = prefs.get('author', '');
  dlg.hidden = false;
  setTimeout(() => $('#work-name').select(), 50);
}

function cancelFinish() {
  $('#name-dialog').hidden = true;
  $('#scene-workbench').classList.remove('firing');
  firing = false;
}

async function snapshot(name, author) {
  // 用当前机位正面拍一张，裁出器物区域，再与背景、文字合成分享图
  const saveRot = rot.y;
  vase.rotation.y = rot.y;
  renderer.render(scene, camera);
  const src = renderer.domElement;
  const H = vase.userData.height || Y0;
  const top = new THREE.Vector3(0, H * 1.02, 0).project(camera), bot = new THREE.Vector3(0, -0.04, 0).project(camera);
  const sy = (1 - top.y) / 2 * src.height, ey = (1 - bot.y) / 2 * src.height;
  const vh = ey - sy, cropH = vh * 1.12, cropW = cropH * 0.86;
  const cx = src.width / 2, cy = (sy + ey) / 2;
  const W = 1080, Hc = 1350;
  const c = document.createElement('canvas');
  c.width = W; c.height = Hc;
  const g = c.getContext('2d');
  try {
    const bg = await loadImage('assets/img/studio.jpg');
    const s = Math.max(W / bg.width, (Hc + 160) / bg.height);
    g.drawImage(bg, (W - bg.width * s) / 2, -80, bg.width * s, bg.height * s);
  } catch { g.fillStyle = '#0a1517'; g.fillRect(0, 0, W, Hc); }
  const vg = g.createRadialGradient(W / 2, Hc * 0.42, 50, W / 2, Hc * 0.5, Hc * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.55)');
  g.fillStyle = vg; g.fillRect(0, 0, W, Hc);
  const glow = g.createRadialGradient(W / 2, 560, 20, W / 2, 560, 420);
  glow.addColorStop(0, 'rgba(255,226,170,.16)'); glow.addColorStop(1, 'rgba(255,226,170,0)');
  g.fillStyle = glow; g.fillRect(0, 0, W, Hc);
  const dh = 900, dw = dh * (cropW / cropH);
  g.drawImage(src, cx - cropW / 2, cy - cropH / 2, cropW, cropH, (W - dw) / 2, 120, dw, dh);
  await document.fonts?.ready;
  const serif = '"Noto Serif SC", "Songti SC", serif';
  g.textAlign = 'center';
  g.fillStyle = '#eee4cf';
  g.font = `400 30px ${serif}`;
  g.fillText('承　艺', W / 2, 92);
  g.strokeStyle = 'rgba(214,180,122,.45)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(W / 2 - 70, 116); g.lineTo(W / 2 + 70, 116); g.stroke();
  g.font = `400 54px ${serif}`;
  g.fillStyle = '#f3ead6';
  g.fillText(name, W / 2, 1110);
  g.font = `400 24px ${serif}`;
  g.fillStyle = 'rgba(238,228,207,.68)';
  g.fillText(summary(work), W / 2, 1162);
  const date = new Date();
  g.font = `400 21px ${serif}`;
  g.fillStyle = 'rgba(214,180,122,.85)';
  g.fillText(`${author ? author + ' 制 · ' : ''}${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日`, W / 2, 1210);
  g.fillStyle = 'rgba(238,228,207,.42)';
  g.font = `400 19px ${serif}`;
  g.fillText('万千手艺，由此生光 · 与 AI 一起，让心意成形', W / 2, 1300);
  rot.y = saveRot;
  return c.toDataURL('image/jpeg', 0.9);
}

export const workbench = {
  init(a) {
    app = a;
    wrap = $('#wb-canvas-wrap');
    setupScene();
    const draft = prefs.get('draft', null);
    if (draft && typeof draft === 'object') work = { ...DEFAULT_WORK, ...draft };
    history = [{ ...work }]; hIndex = 0;
    ready = loadVase().then(() => { applyAll(null); renderPanel(); updateUndo(); }).catch((err) => {
      console.error(err);
      app.toast('器物模型加载失败，请刷新重试');
    });
    wrap.addEventListener('pointerdown', onDown);
    wrap.addEventListener('pointermove', onMove);
    wrap.addEventListener('pointerup', onUp);
    wrap.addEventListener('pointercancel', onUp);
    wrap.addEventListener('wheel', (e) => { e.preventDefault(); distT = clamp(distT * Math.exp(e.deltaY * 0.001), 1.0, 2.2); lastInput = performance.now(); }, { passive: false });
    window.addEventListener('resize', () => app.scene === 'workbench' && resize());
    $('#wb-undo').addEventListener('click', undo);
    $('#wb-redo').addEventListener('click', redo);
    $('#wb-finish').addEventListener('click', () => { if (step !== 'pattern') { step = 'pattern'; renderSteps(); renderPanel(); } finish(); });
    $('#ai-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = $('#ai-input'), text = input.value.trim();
      if (!text) { input.focus(); return; }
      input.value = '';
      showReply({ reply: '正在理解你的心意…', patch: null, chips: [] });
      showReply(await interpret(text, work));
    });
    $('#ai-inspire').addEventListener('click', () => showReply(inspire(work)));
    $('#name-cancel').addEventListener('click', cancelFinish);
    $('#name-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = $('#work-name').value.trim() || nameFor(work);
      const author = $('#work-author').value.trim();
      prefs.set('author', author);
      const image = await snapshot(name, author);
      app.work = { ...work, name, author, image, summary: summary(work), date: Date.now() };
      $('#name-dialog').hidden = true;
      app.go('share');
    });
    window.addEventListener('keydown', (e) => {
      if (app.scene !== 'workbench' || e.target.tagName === 'INPUT') return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      if (e.key === 'Escape' && !$('#name-dialog').hidden) cancelFinish();
    });
  },
  async enter(opts = {}) {
    app.setBrand('承艺');
    app.setBack('返回篇章', () => app.go('chapter', { keep: true }));
    $('#scene-workbench').classList.remove('firing');
    $('#name-dialog').hidden = true;
    firing = false;
    if (opts.again) { work = { ...DEFAULT_WORK }; history = [{ ...work }]; hIndex = 0; step = 'shape'; }
    running = true;
    resize();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(frame);
    await ready;
    if (opts.again) applyAll(null);
    renderPanel();
    updateUndo();
    lastInput = performance.now();
  },
  leave() {
    running = false;
    setTimeout(() => { if (!running) cancelAnimationFrame(raf); }, 900);
  },
};
