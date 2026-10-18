// AI 助手（演示版）：按关键词理解用户描述，给出器型 / 釉色 / 纹样建议，确认后才应用。
// 尚未接入大模型。接入时设置 window.CHENGYI_AI_ENDPOINT，接口约定见 README「AI 接入」。
import { SHAPES, GLAZES, PATTERNS, INKS } from './data.js';

const byId = (list, id) => list.find((x) => x.id === id);

const RULES = [
  // 器型
  { re: /修长|细长|瘦|高挑|挺拔|胆瓶|纤/, patch: { shape: 'dan' } },
  { re: /圆润|饱满|丰腹|胖|圆|天球|敦厚|大肚/, patch: { shape: 'tianqiu' } },
  { re: /丰肩|宽肩|梅瓶|肩/, patch: { shape: 'meiyun' } },
  { re: /玉壶春|原样|经典|原来的/, patch: { shape: 'yuhuchun' } },
  { re: /矮|短|小巧/, patch: { H: 0.92 } },
  { re: /高一点|更高|拉高/, patch: { H: 1.1 } },
  { re: /宽一点|更宽|粗/, patch: { W: 1.12 } },
  { re: /窄一点|更窄|细一点/, patch: { W: 0.9 } },
  // 釉色
  { re: /天青|雨过天青|淡蓝|蓝色|天空/, patch: { glaze: 'tianqing' } },
  { re: /粉青|翠|玉|绿/, patch: { glaze: 'fenqing' } },
  { re: /豆青|黄绿|草/, patch: { glaze: 'douqing' } },
  { re: /月白|月光|月亮/, patch: { glaze: 'yuebai' } },
  { re: /甜白|纯白|洁白|白色|雪/, patch: { glaze: 'tianbai' } },
  { re: /影青|青白/, patch: { glaze: 'yingqing' } },
  { re: /亮|光泽|透亮|玻璃/, patch: { gloss: 'bright' } },
  { re: /哑|柔和|温润|润|内敛/, patch: { gloss: 'soft' } },
  { re: /开片|冰裂|裂纹/, patch: { crackle: true } },
  // 纹样
  { re: /云|祥云|云气/, patch: { pattern: 'cloud' } },
  { re: /莲|花|缠枝|植物|藤/, patch: { pattern: 'lotus' } },
  { re: /海|浪|水|波/, patch: { pattern: 'wave' } },
  { re: /素|简洁|干净|无纹|不要花纹|极简/, patch: { pattern: 'plain' } },
  // 纹色
  { re: /青花|钴蓝|蓝花/, patch: { ink: 'cobalt' } },
  { re: /红|喜庆|釉里红|朱/, patch: { ink: 'copper' } },
  { re: /金|华贵|富贵|描金/, patch: { ink: 'gold' } },
  { re: /墨|黑|水墨/, patch: { ink: 'ink' } },
];

// 情绪词：没有具体选项时，按氛围给一组搭配
const MOODS = [
  { re: /安静|宁静|清雅|淡雅|文人|禅/, patch: { glaze: 'yuebai', pattern: 'plain', gloss: 'soft' }, why: '安静的器物宜少纹饰，月白润釉更显清雅' },
  { re: /喜庆|热闹|送礼|祝福|新婚|生日/, patch: { pattern: 'lotus', ink: 'copper', glaze: 'tianbai' }, why: '缠枝莲连绵不断，配红色纹饰更显喜气' },
  { re: /大气|豪迈|壮阔|山河/, patch: { shape: 'meiyun', pattern: 'wave', ink: 'cobalt' }, why: '丰肩器形配海水纹，气势更开阔' },
  { re: /温柔|柔和|可爱|小巧/, patch: { shape: 'tianqiu', glaze: 'fenqing', gloss: 'soft' }, why: '圆润的器形与粉青润釉，观感柔和' },
  { re: /古朴|古典|传统/, patch: { shape: 'yuhuchun', pattern: 'cloud', ink: 'cobalt' }, why: '保留原器形与云纹青花，最为古朴' },
];

const describe = (k, v) => {
  if (k === 'shape') return '器型 · ' + byId(SHAPES, v).name;
  if (k === 'glaze') return '釉色 · ' + byId(GLAZES, v).name;
  if (k === 'pattern') return '纹样 · ' + byId(PATTERNS, v).name;
  if (k === 'ink') return '纹色 · ' + byId(INKS, v).name;
  if (k === 'gloss') return v === 'bright' ? '釉面 · 亮釉' : '釉面 · 润釉';
  if (k === 'crackle') return v ? '开片' : '无开片';
  if (k === 'W') return v > 1 ? '略宽' : '略窄';
  if (k === 'H') return v > 1 ? '略高' : '略矮';
  return '';
};

function stepOf(patch) {
  if ('pattern' in patch || 'ink' in patch) return 'pattern';
  if ('glaze' in patch || 'gloss' in patch || 'crackle' in patch) return 'glaze';
  return 'shape';
}

function local(text, work) {
  const patch = {};
  let why = '';
  for (const r of RULES) if (r.re.test(text)) Object.assign(patch, r.patch);
  for (const m of MOODS) if (m.re.test(text)) { for (const [k, v] of Object.entries(m.patch)) if (!(k in patch)) patch[k] = v; why = why || m.why; }
  if (/不要开片|不开片/.test(text)) patch.crackle = false;
  // 去掉与当前一致的项
  for (const k of Object.keys(patch)) if (work[k] === patch[k]) delete patch[k];
  const chips = Object.entries(patch).map(([k, v]) => describe(k, v)).filter(Boolean);
  if (!chips.length) {
    return {
      reply: /撤销|回去|上一步/.test(text) ? '想退回上一步，可以点左下角的撤销。' :
        '我还没听懂这个心意。可以说说想要的器型（修长、圆润、丰肩）、釉色（天青、粉青、月白……）或纹样（云纹、缠枝莲、海水、素面），也可以点「给我灵感」。',
      patch: null, chips: [],
    };
  }
  return { reply: `我理解的是：${chips.join('、')}。${why ? why + '。' : ''}要按这个改吗？`, patch, chips, step: stepOf(patch) };
}

export async function interpret(text, work) {
  const ep = window.CHENGYI_AI_ENDPOINT;
  if (ep) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      const res = await fetch(ep, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, work }), signal: ctrl.signal });
      clearTimeout(timer);
      if (res.ok) {
        const j = await res.json();
        if (j && typeof j.reply === 'string') {
          const patch = j.patch && typeof j.patch === 'object' ? j.patch : null;
          return { reply: j.reply, patch, chips: patch ? Object.entries(patch).map(([k, v]) => describe(k, v)).filter(Boolean) : [], step: patch ? stepOf(patch) : null, live: true };
        }
      }
    } catch { /* 退回本地规则 */ }
  }
  return local(text, work);
}

const pick = (a) => a[(Math.random() * a.length) | 0];
const INSPIRE = [
  { patch: { shape: 'dan', glaze: 'tianqing', pattern: 'plain', gloss: 'soft' }, why: '修长器形配天青素面，像雨后一片天色' },
  { patch: { shape: 'tianqiu', glaze: 'tianbai', pattern: 'lotus', ink: 'cobalt' }, why: '圆腹宜绕一周缠枝莲，白地青花最清朗' },
  { patch: { shape: 'meiyun', glaze: 'yingqing', pattern: 'wave', ink: 'cobalt', crackle: false }, why: '丰肩器形配下腹海水纹，稳重而有动势' },
  { patch: { shape: 'yuhuchun', glaze: 'fenqing', pattern: 'cloud', ink: 'gold', crackle: true }, why: '粉青开片上描金云纹，温润中带一点华彩' },
  { patch: { shape: 'yuhuchun', glaze: 'douqing', pattern: 'lotus', ink: 'ink', gloss: 'soft' }, why: '豆青润釉配墨彩缠枝，有几分文人气' },
  { patch: { shape: 'dan', glaze: 'yuebai', pattern: 'cloud', ink: 'copper' }, why: '月白地上一抹红云，素净里见心意' },
];

export function inspire(work) {
  let s;
  do { s = pick(INSPIRE); } while (Object.entries(s.patch).every(([k, v]) => work[k] === v));
  const patch = { ...s.patch };
  const chips = Object.entries(patch).map(([k, v]) => describe(k, v)).filter(Boolean);
  return { reply: `试试这一组：${s.why}。`, patch, chips, step: 'pattern' };
}

export function nameFor(work) {
  const g = byId(GLAZES, work.glaze).name, p = byId(PATTERNS, work.pattern), s = byId(SHAPES, work.shape).name;
  const mid = p.id === 'plain' ? '素' : p.id === 'cloud' ? '云' : p.id === 'lotus' ? '莲' : '海';
  return `${g}${mid}纹 · ${s}`.replace('素纹', '素面');
}

export function summary(work) {
  const parts = [byId(SHAPES, work.shape).name, byId(GLAZES, work.glaze).name + (work.gloss === 'soft' ? '润釉' : '亮釉') + (work.crackle ? '开片' : '')];
  const p = byId(PATTERNS, work.pattern);
  parts.push(p.id === 'plain' ? '素面' : `${byId(INKS, work.ink).name}${p.name}`);
  return parts.join(' · ');
}
