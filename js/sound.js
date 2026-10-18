// 环境声：用 WebAudio 合成极轻的低频长音与风声，不依赖音频文件。
// 浏览器要求用户先操作页面才能出声，因此在第一次点击 / 按键时启动。

let ctx = null, master = null, started = false;

function build() {
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 520; lp.Q.value = 0.3;
  lp.connect(master);

  // 两组略微失谐的正弦长音（A2 与 E3），缓慢起伏
  [[110, -4], [110.4, 3], [164.8, 0], [220.2, -7]].forEach(([f, detune], i) => {
    const o = ctx.createOscillator();
    o.type = 'sine'; o.frequency.value = f; o.detune.value = detune;
    const g = ctx.createGain(); g.gain.value = i === 3 ? 0.05 : 0.12;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05 + i * 0.023;
    const lg = ctx.createGain(); lg.gain.value = g.gain.value * 0.6;
    lfo.connect(lg).connect(g.gain);
    o.connect(g).connect(lp);
    o.start(); lfo.start();
  });

  // 风：带通滤波的粉噪
  const len = ctx.sampleRate * 4, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.997 * b0 + w * 0.029; b1 = 0.985 * b1 + w * 0.032; b2 = 0.95 * b2 + w * 0.048;
    d[i] = (b0 + b1 + b2) * 0.25;
  }
  const noise = ctx.createBufferSource(); noise.buffer = buf; noise.loop = true;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 420; bp.Q.value = 0.6;
  const ng = ctx.createGain(); ng.gain.value = 0.05;
  const nl = ctx.createOscillator(); nl.frequency.value = 0.07;
  const nlg = ctx.createGain(); nlg.gain.value = 0.035;
  nl.connect(nlg).connect(ng.gain);
  noise.connect(bp).connect(ng).connect(master);
  noise.start(); nl.start();
}

export const sound = {
  muted: false,
  /** 用户第一次操作后调用；返回是否已真正出声。 */
  unlock() {
    if (this.muted) return false;
    try {
      if (!ctx) build();
      if (ctx.state === 'suspended') ctx.resume();
      if (!started) { started = true; this.duck(1, 3); }
      return ctx.state !== 'suspended';
    } catch { return false; }
  },
  setMuted(m) {
    this.muted = m;
    if (!ctx) return; // 还没有用户操作过，等第一次点击时再创建
    this.duck(m ? 0 : 1, 0.6);
  },
  /** 音量到 level（0..1，相对基准），time 秒内渐变。过场视频播放时压低环境声。 */
  duck(level, time = 0.8) {
    if (!ctx || !master) return;
    const target = this.muted ? 0 : 0.32 * level;
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(target, now + time);
  },
  get running() { return !!ctx && ctx.state === 'running'; },
};
