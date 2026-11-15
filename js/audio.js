'use strict';
// 게임 효과음을 거리별로 믹싱한다. 샘플이 준비되는 동안에는 합성음을 사용한다.
(function (root) {
  const ZR = (root.ZR = root.ZR || {});

  let ctx = null, master = null, noiseBuf = null;
  const samples = new Map();
  const listener = { x: 0, y: 0 };
  const HEAR = 1400;
  const MAX_PER_FRAME = 10;
  const MAX_SAMPLE_VOICES = 20;
  const RESERVED_NEAR_VOICES = 4;
  let activeSamples = 0;
  let budget = MAX_PER_FRAME;
  let muted = false;

  const cue = (file, rate = 1, pitch = 0, level = 0.8, maxDuration = Infinity) => ({ file, rate, pitch, level, maxDuration });
  const WEAPON_CUES = {
    pistol: cue('pistol'),
    smg: cue('automatic', 1.15, 220, 0.55),
    shotgun: cue('heavy'),
    rifle: cue('automatic'),
    dmr: cue('rifle'),
    minigun: cue('automatic', 1.25, -330, 0.38),
    ricochet: cue('energy-shot'),
    flamer: cue('laser', 0.95, -520, 0.16, 0.1),
    thunder: cue('energy-shot', 1.2, 380),
    cryo: cue('beam', 1, 0, 0.38, 0.14),
    swarm: cue('energy-shot', 1.3, -430, 0.63),
    rail: cue('laser'),
    mortar: cue('heavy', 0.78, -520),
    nova: cue('heavy', 1.18, -650),
    singularity: cue('energy-blast', 0.9, -460),
    prism: cue('laser', 1.2, 550, 0.22, 0.14),
    dragon: cue('heavy', 1.2, 240),
    apocalypse: cue('automatic', 0.76, -440, 0.53),
    starfall: cue('energy-blast', 1.25, 250),
    gauss: cue('energy-blast'),
    fists: cue('pistol', 0.65, -950, 0.19, 0.12),
    knife: cue('beam', 1.55, 680, 0.35),
    katana: cue('energy-shot', 1.42, 460, 0.42),
    hammer: cue('heavy', 0.85, -850, 0.57),
    scythe: cue('laser', 0.82, -670, 0.50),
    frag: cue('heavy', 1.18, -240),
    cryonade: cue('energy-shot', 0.82, 580),
    sticky: cue('energy-blast', 1.2, -180),
    nuke: cue('energy-blast', 0.64, -480),
  };
  const RELOAD_CUE = cue('reload', 1, 0, 0.55);
  const SAMPLE_FILES = new Set([...Object.values(WEAPON_CUES), RELOAD_CUE].map(({ file }) => file));

  async function loadSample(file) {
    try {
      const response = await root.fetch(`assets/audio/${file}.mp3`);
      if (response.ok) samples.set(file, await ctx.decodeAudioData(await response.arrayBuffer()));
    } catch {
      // 파일을 읽을 수 없는 환경에서도 합성 효과음은 재생된다.
    }
  }

  function unlock() {
    if (typeof window === 'undefined' || !window.AudioContext) return;
    if (!ctx) {
      ctx = new window.AudioContext();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.35;
      master.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      for (const file of SAMPLE_FILES) loadSample(file);
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  }

  function env(vol, dur) {
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    g.connect(master);
    return g;
  }

  function noise(vol, dur, type, freq, q = 1) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    src.connect(f).connect(env(vol, dur));
    src.start();
    src.stop(ctx.currentTime + dur);
  }

  function tone(vol, dur, wave, f0, f1) {
    const o = ctx.createOscillator();
    o.type = wave;
    o.frequency.setValueAtTime(f0, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), ctx.currentTime + dur);
    o.connect(env(vol, dur));
    o.start();
    o.stop(ctx.currentTime + dur);
  }

  const SOUNDS = {
    pop: (v) => noise(v * 0.5, 0.08, 'highpass', 1200),
    crack: (v) => { noise(v * 0.7, 0.12, 'highpass', 800); tone(v * 0.2, 0.1, 'square', 900, 200); },
    boom: (v) => { noise(v, 0.5, 'lowpass', 400); tone(v * 0.5, 0.4, 'sine', 120, 40); },
    nuke: (v) => { noise(v * 1.2, 1.4, 'lowpass', 250); tone(v * 0.8, 1.2, 'sine', 90, 25); },
    zap: (v) => tone(v * 0.25, 0.15, 'square', 1600, 300),
    flame: (v) => noise(v * 0.15, 0.1, 'bandpass', 600, 0.6),
    whoosh: (v) => noise(v * 0.4, 0.35, 'bandpass', 900, 2),
    rail: (v) => { tone(v * 0.35, 0.45, 'sawtooth', 2400, 80); noise(v * 0.4, 0.2, 'highpass', 2000); },
    void: (v) => tone(v * 0.45, 0.8, 'sine', 300, 40),
    thump: (v) => tone(v * 0.6, 0.25, 'sine', 160, 50),
    beam: (v) => tone(v * 0.08, 0.13, 'sawtooth', 700, 650),
    swing: (v) => noise(v * 0.25, 0.1, 'bandpass', 1500, 1.5),
    reload: (v) => noise(v * 0.2, 0.08, 'bandpass', 1600, 1.3),
    break: (v) => noise(v * 0.4, 0.2, 'bandpass', 500, 1),
    pickup: (v) => tone(v * 0.25, 0.12, 'sine', 600, 1200),
  };

  function playSample(buffer, settings, volume) {
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    source.buffer = buffer;
    source.playbackRate.value = settings.rate;
    source.detune.value = settings.pitch;
    const t = ctx.currentTime;
    const naturalDuration = buffer.duration / (settings.rate * 2 ** (settings.pitch / 1200));
    const duration = Math.min(naturalDuration, settings.maxDuration);
    gain.gain.value = volume * settings.level;
    if (duration < naturalDuration) {
      gain.gain.setValueAtTime(gain.gain.value, t + Math.max(0, duration - 0.025));
      gain.gain.linearRampToValueAtTime(0, t + duration);
    }
    source.connect(gain).connect(master);
    activeSamples++;
    source.onended = () => {
      activeSamples--;
      source.disconnect();
      gain.disconnect();
    };
    source.start(t);
    if (duration < naturalDuration) source.stop(t + duration);
  }

  function play(kind, x, y, wid) {
    if (!ctx || ctx.state !== 'running' || muted || budget <= 0) return;
    const d = Math.hypot(x - listener.x, y - listener.y);
    if (d >= HEAR) return;
    const volume = Math.pow(1 - d / HEAR, 1.6);
    const settings = wid ? WEAPON_CUES[wid] : kind === 'reload' ? RELOAD_CUE : null;
    const buffer = settings && samples.get(settings.file);
    if (buffer) {
      const limit = d < 350 ? MAX_SAMPLE_VOICES : MAX_SAMPLE_VOICES - RESERVED_NEAR_VOICES;
      if (activeSamples >= limit) return;
      budget--;
      playSample(buffer, settings, volume);
    } else if (SOUNDS[kind]) {
      budget--;
      SOUNDS[kind](volume);
    }
  }

  function setListener(x, y) {
    listener.x = x;
    listener.y = y;
    budget = MAX_PER_FRAME;
  }

  function toggleMute() {
    muted = !muted;
    if (master) master.gain.value = muted ? 0 : 0.35;
    return muted;
  }

  ZR.Audio = { unlock, play, setListener, toggleMute };
})(typeof window !== 'undefined' ? window : globalThis);
