// 内容数据：器物、地图光河、陶瓷篇章文案、工作台选项。
// 名称与说明均为示意，未经内容组核验的项目一律标“示意 / 待核实”，不写入具体史实或地域归属。

export const MAP_SIZE = { w: 1678, h: 937 };
export const CLOSEUP_SIZE = { w: 1672, h: 941 };

/** 器物：地图锚点（原图像素坐标）、近景素材、开放状态。ring 顺序即近景左右邻项顺序。 */
export const OBJECTS = [
  {
    id: 'puppet', name: '人偶', label: '人偶 · 示意', craft: '待定品类',
    status: 'soon', statusText: '即将开放 · 仅供预览',
    desc: '这件器物的品类与出处尚在核实中，本期仅作预览。',
    map: { x: 1240, y: 186, w: 137, h: 186, img: 'assets/img/map-puppet.png' },
    solid: 'assets/img/map-puppet.png', particle: 'assets/img/map-puppet.png', centerH: 300, sideH: 230,
  },
  {
    id: 'papercut', name: '团花纹饰', label: '团花纹饰 · 示意', craft: '剪纸（示意）',
    status: 'soon', statusText: '即将开放 · 仅供预览',
    desc: '圆形团花，形似剪纸。工坊尚未开放，本期仅作预览。',
    map: { x: 126, y: 271, w: 109, h: 100, img: 'assets/img/map-papercut.png' },
    solid: 'assets/img/map-papercut.png', particle: 'assets/img/obj-papercut-particle.png', overlay: 'assets/img/obj-papercut-particle.png',
    centerH: 330, sideH: 250,
  },
  {
    id: 'celadon', name: '青瓷云纹瓶', label: '青瓷云纹瓶', craft: '陶瓷',
    status: 'open', statusText: '陶瓷 · 已开放在线创作',
    desc: '从一抔土开始，经练泥、拉坯、施釉、入窑，成为一件器。',
    map: { x: 374, y: 446, w: 166, h: 216, img: 'assets/img/map-celadon.png' },
    solid: 'assets/img/obj-celadon.png', particle: 'assets/img/obj-celadon.png', centerH: 480, sideH: 300,
  },
  {
    id: 'filigree', name: '花丝饰件', label: '花丝饰件 · 示意', craft: '金工（示意）',
    status: 'soon', statusText: '即将开放 · 仅供预览',
    desc: '金色镂空饰件，镶彩石。工坊尚未开放，本期仅作预览。',
    map: { x: 1365, y: 544, w: 223, h: 166, img: 'assets/img/map-filigree.png' },
    solid: 'assets/img/map-filigree.png', particle: 'assets/img/obj-filigree-particle.png', overlay: 'assets/img/obj-filigree-particle.png',
    centerH: 300, sideH: 250,
  },
  {
    id: 'basket', name: '编篮', label: '编篮 · 示意', craft: '编织（示意）',
    status: 'soon', statusText: '即将开放 · 仅供预览',
    desc: '一只小提篮，形似竹编。工坊尚未开放，本期仅作预览。',
    map: { x: 480, y: 273, w: 64, h: 73, img: 'assets/img/map-basket.png' },
    solid: 'assets/img/map-basket.png', particle: 'assets/img/map-basket.png', centerH: 240, sideH: 200,
  },
];

export const objectById = (id) => OBJECTS.find((o) => o.id === id);

/** 地图光河中心线（地图原图像素坐标，由远到近）。 */
export const RIVER = [
  [889, 148], [906, 176], [839, 210], [772, 235], [873, 260], [965, 294], [906, 319], [722, 336],
  [646, 361], [621, 403], [671, 440], [772, 470], [906, 503], [1032, 545], [1091, 579], [1074, 618],
  [1015, 654], [982, 696], [940, 747], [873, 789], [772, 826], [688, 864], [646, 923],
];

/** 陶瓷篇章：八幕，range 为整段滚动进度区间。文案依据《陶瓷篇章-产品与交互规格》。 */
export const ACTS = [
  { id: 'soil', num: '壹', range: [0, 0.14], title: '择土 · 寻泥为胎', body: ['瓷石为骨，高岭为魂；', '经粉碎、淘洗，沉淀成细腻的泥。'], side: 'right' },
  { id: 'clay', num: '贰', range: [0.14, 0.26], title: '练泥 · 陈腐揉匀', body: ['陈藏数月，反复揉练，', '排尽气泡，使泥性温润致密。'], side: 'left' },
  { id: 'form', num: '叁', range: [0.26, 0.38], title: '成形 · 拉坯利坯', body: ['转轮拉坯，初见器形；', '半干后持刀修削，薄厚合度、形神始定。'], side: 'right' },
  { id: 'glaze', num: '肆', range: [0.38, 0.55], title: '施釉 · 着衣彩绘', notes: ['青花绘于素胎', '再覆釉浆', '静待窑火'], side: 'left' },
  { id: 'kiln', num: '伍', range: [0.55, 0.68], title: '入窑 · 一窑天成', body: ['千三百度窑火，历氧化、还原而瓷化；', '火尽开窑，釉色天成。'], side: 'left' },
  { id: 'done', num: '陆', range: [0.68, 0.78], title: '完成作品', side: 'top' },
  { id: 'return', num: '柒', range: [0.78, 0.92], title: '消解 · 归土', side: 'top' },
  { id: 'legacy', num: '捌', range: [0.92, 1], title: '承艺', steps: ['择土', '练泥', '成形', '施釉', '入窑'], side: 'top' },
];

/** 工作台：器型、釉色、纹样。器型参数作用于青瓷云纹瓶 GLB 的轮廓。 */
export const SHAPES = [
  { id: 'yuhuchun', name: '玉壶春', note: '原型器形，颈细腹圆', p: { W: 1, H: 1, B: 0, S: 0, N: 0 } },
  { id: 'dan', name: '修长', note: '收腹拉高，形如胆瓶', p: { W: 0.86, H: 1.12, B: -0.06, S: 0, N: -0.1 } },
  { id: 'tianqiu', name: '丰腹', note: '腹部饱满，形近天球', p: { W: 1.06, H: 0.94, B: 0.16, S: 0.04, N: 0 } },
  { id: 'meiyun', name: '丰肩', note: '肩部隆起，腹下内收', p: { W: 0.96, H: 1.04, B: -0.16, S: 0.26, N: 0 } },
];

export const GLAZES = [
  { id: 'yingqing', name: '影青', rgb: [205, 224, 220], note: '青白相间，薄处见白' },
  { id: 'tianqing', name: '天青', rgb: [178, 204, 212], note: '淡青微蓝' },
  { id: 'fenqing', name: '粉青', rgb: [163, 197, 178], note: '青中泛绿，温润如玉' },
  { id: 'douqing', name: '豆青', rgb: [176, 190, 148], note: '青黄相和' },
  { id: 'yuebai', name: '月白', rgb: [222, 228, 226], note: '白中闪青' },
  { id: 'tianbai', name: '甜白', rgb: [238, 234, 222], note: '洁白温润' },
];

export const PATTERNS = [
  { id: 'cloud', name: '云纹', note: '原器云气纹' },
  { id: 'lotus', name: '缠枝莲', note: '连绵花叶绕腹一周' },
  { id: 'wave', name: '海水', note: '下腹层叠浪纹' },
  { id: 'plain', name: '素面', note: '不加纹饰，只见釉色' },
];

export const INKS = [
  { id: 'cobalt', name: '青花', rgb: [38, 74, 140] },
  { id: 'copper', name: '釉里红', rgb: [146, 52, 44] },
  { id: 'gold', name: '描金', rgb: [184, 142, 72] },
  { id: 'ink', name: '墨彩', rgb: [44, 50, 56] },
];

export const DEFAULT_WORK = {
  shape: 'yuhuchun', W: 1, H: 1, glaze: 'yingqing', gloss: 'bright', crackle: false,
  pattern: 'cloud', ink: 'cobalt',
};
