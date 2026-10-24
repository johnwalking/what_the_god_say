/**
 * 聖殿配樂：Web Audio 即時合成（低音、合唱音墊、程式生成殘響、遠處鐘響），沒有音檔。
 * 上半部是純函式與常數（可在 node 下測試）；下半部是引擎，沒有 AudioContext 時全部無作用。
 */

// ---- 可調參數（聽感不對先改這裡）----
export const MASTER_LEVEL = 0.25;   // 總音量上限；調高會更大聲，請勿超過 0.25
export const HUSH_LEVEL = 0.03;     // 危機訊息時的近乎無聲音量；調高則 hush 時仍聽得到
export const FADE_IN_SEC = 3;       // 進入聖殿時淡入秒數；調高則更慢浮現
export const MUTE_FADE_SEC = 0.4;   // 靜音／hush 切換約需秒數；調高則更緩慢收放
export const CHORD_SEC = 16;        // 每個和弦停留秒數；調高則進行更慢
export const CROSSFADE_SEC = 4;     // 和弦滑動約需秒數（時間常數為其 1/3）；調高則更黏、更模糊
export const REVERB_SEC = 5;        // 殘響長度（秒）；調高則更空曠但更糊
export const REVERB_DECAY = 6;      // 殘響指數衰減速率；調高則尾巴收得更快、更乾
export const REVERB_DAMP = 0.5;     // 殘響高頻阻尼 0..0.95；調高則殘響更暗更悶
export const REVERB_WET = 0.55;     // 殘響（濕）比例；調高則更遠更糊
export const REVERB_DRY = 0.45;     // 直達（乾）比例；調高則更清晰靠近
export const PAD_LEVEL = 0.5;       // 合唱音墊整體音量；調高則音墊壓過低音
export const BASS_LEVEL = 0.3;      // 低音整體音量；調高則更厚重、可能混濁
export const BASS_OCTAVE_MIX = 0.5; // 低音八度（上方）的相對音量；調高則低音更亮
export const PAD_DETUNE_CENTS = 7;  // 每聲部三個鋸齒波的失諧量（±）；調高則合唱感更強、更不穩
export const PAD_DIRECT_MIX = 0.35; // 未經母音共振峰的直通比例；調高則更厚實、較不像人聲
export const FORMANT_1_HZ = 800;    // 母音「啊」第一共振峰；調高則更開、更亮
export const FORMANT_2_HZ = 1200;   // 母音「啊」第二共振峰；調高則更尖
export const FORMANT_Q = 6;         // 共振峰尖銳度；調高則更像人聲但可能刺耳
export const FORMANT_GAIN = 1.2;    // 共振峰支路增益（補償帶通損耗）；調高則母音感更重、更響
export const PAD_LOWPASS_HZ = 2400; // 音墊低通截止；調高則更亮更刺，調低則更悶
export const LFO_HZ = 0.07;         // 緩慢調變速度；調高則呼吸更急
export const LFO_FILTER_HZ = 400;   // LFO 對低通截止的擺幅（Hz）；調高則明暗起伏更大
export const LFO_AMP = 0.08;        // LFO 對總音量的擺幅（±比例）；調高則音量起伏更明顯
export const BELL_LEVEL = 0.18;     // 鐘聲音量（相對於 master）；調高則鐘更突出
export const BELL_DECAY_SEC = 6;    // 鐘聲衰減秒數；調高則餘音更長
export const BELL_PARTIALS = [[1, 1], [2.76, 0.45], [5.4, 0.2]]; // [基頻倍數, 相對音量]；改倍數會改變鐘的音色
export const BELL_WET = 0.9;        // 鐘聲送進殘響的比例；調高則更遙遠
export const BELL_DRY = 0.25;       // 鐘聲直達比例；調高則更近

const MUTE_KEY = 'sanctuary-muted';

export const CHORDS = [
  { name: 'Dm', bass: 38, voices: [57, 62, 65, 69] },
  { name: 'Bb', bass: 34, voices: [58, 62, 65, 70] },
  { name: 'F',  bass: 41, voices: [57, 60, 65, 69] },
  { name: 'C',  bass: 36, voices: [55, 60, 64, 67] },
  { name: 'Gm', bass: 31, voices: [55, 58, 62, 67] },
];
export const PROGRESSION = [0, 1, 2, 3, 0, 4, 1, 3];

export function midiToFreq(m) {
  return 440 * 2 ** ((m - 69) / 12);
}

export function chordAt(i) {
  return CHORDS[PROGRESSION[i % PROGRESSION.length]];
}

/** 靜音偏好存取；storage 缺少或拋錯都靜默忽略。 */
export function createMuteStore(storage) {
  return {
    get() {
      try { return storage?.getItem(MUTE_KEY) === '1'; } catch { return false; }
    },
    set(muted) {
      try { storage?.setItem(MUTE_KEY, muted ? '1' : '0'); } catch { /* 忽略 */ }
    },
  };
}

const VOICES = Math.min(...CHORDS.map((c) => c.voices.length));
const noop = () => {};

function buildReverbBuffer(ctx) {
  const rate = ctx.sampleRate || 44100;
  const len = Math.max(1, Math.floor(rate * REVERB_SEC));
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    let prev = 0;
    for (let i = 0; i < len; i++) {
      const noise = Math.random() * 2 - 1;
      prev = prev * REVERB_DAMP + noise * (1 - REVERB_DAMP); // 單極低通，讓殘響偏暗
      data[i] = prev * Math.exp(-REVERB_DECAY * (i / len));
    }
  }
  return buf;
}

export function createAudio({
  AudioContextCtor = globalThis.AudioContext || globalThis.webkitAudioContext,
  storage,
  setTimer = (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimer = (h) => globalThis.clearTimeout(h),
} = {}) {
  const store = createMuteStore(storage);
  let muted = store.get();
  let hushed = false;

  if (typeof AudioContextCtor !== 'function') {
    return {
      available: false, start: noop, stop: noop, hush: noop, bell: noop,
      setMuted(m) { muted = !!m; store.set(muted); },
      isMuted: () => muted,
    };
  }

  let ctx = null;
  let master = null;
  let timer = null;
  let chordIndex = 0;
  let oscs = [];       // 長駐的 oscillator，停止時一併 stop
  let bassOscs = [];   // [基頻, 八度]
  let padOscs = [];    // padOscs[voice] = 3 個失諧鋸齒波
  let reverbIn = null;
  let bellBus = null;

  const level = () => (muted ? 0 : hushed ? HUSH_LEVEL : MASTER_LEVEL);

  function glideMaster() {
    if (!ctx || !master) return;
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setTargetAtTime(level(), now, MUTE_FADE_SEC / 4);
  }

  function osc(type, freq, dest, detune = 0) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, ctx.currentTime);
    if (detune) o.detune.value = detune;
    o.connect(dest);
    o.start();
    oscs.push(o);
    return o;
  }

  function gainNode(value, dest) {
    const g = ctx.createGain();
    g.gain.value = value;
    if (dest) g.connect(dest);
    return g;
  }

  function filter(type, freq, q, dest) {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    if (q !== undefined) f.Q.value = q;
    if (dest) f.connect(dest);
    return f;
  }

  function build() {
    const now = ctx.currentTime;
    master = gainNode(0, ctx.destination);
    master.gain.setValueAtTime(0, now);
    master.gain.linearRampToValueAtTime(level(), now + FADE_IN_SEC);

    // 乾濕分流：swell（LFO 調音量）-> 乾 / 殘響 -> master
    const swell = gainNode(1, null);
    const dry = gainNode(REVERB_DRY, master);
    const wet = gainNode(REVERB_WET, master);
    reverbIn = ctx.createConvolver();
    reverbIn.buffer = buildReverbBuffer(ctx);
    reverbIn.connect(wet);
    swell.connect(dry);
    swell.connect(reverbIn);

    // 音墊：3 個失諧鋸齒 x 每聲部 -> padBus -> (F1 | F2 | 直通) -> 低通 -> swell
    const padLP = filter('lowpass', PAD_LOWPASS_HZ, 0.7, swell);
    const padBus = gainNode(PAD_LEVEL, null);
    padBus.connect(filter('bandpass', FORMANT_1_HZ, FORMANT_Q, gainNode(FORMANT_GAIN, padLP)));
    padBus.connect(filter('bandpass', FORMANT_2_HZ, FORMANT_Q, gainNode(FORMANT_GAIN, padLP)));
    padBus.connect(gainNode(PAD_DIRECT_MIX, padLP));
    const chord = chordAt(0);
    const perOsc = 1 / (VOICES * 3);
    for (let v = 0; v < VOICES; v++) {
      const voiceGain = gainNode(perOsc, padBus);
      padOscs.push([-PAD_DETUNE_CENTS, 0, PAD_DETUNE_CENTS].map(
        (c) => osc('sawtooth', midiToFreq(chord.voices[v]), voiceGain, c),
      ));
    }

    // 低音：triangle 基頻 + sine 八度，不經母音濾波，直接進 swell
    const bassBus = gainNode(BASS_LEVEL, swell);
    bassOscs = [
      osc('triangle', midiToFreq(chord.bass), bassBus),
      osc('sine', midiToFreq(chord.bass + 12), gainNode(BASS_OCTAVE_MIX, bassBus)),
    ];

    // LFO：緩慢調變低通截止與總音量
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = LFO_HZ;
    lfo.connect(gainNode(LFO_FILTER_HZ, null)).connect(padLP.frequency);
    lfo.connect(gainNode(LFO_AMP, null)).connect(swell.gain);
    lfo.start();
    oscs.push(lfo);

    // 鐘聲匯流排：直達 + 送入殘響
    bellBus = gainNode(1, null);
    bellBus.connect(gainNode(BELL_DRY, master));
    bellBus.connect(gainNode(BELL_WET, reverbIn));
  }

  function nextChord() {
    if (!ctx) return;
    chordIndex += 1;
    const chord = chordAt(chordIndex);
    const now = ctx.currentTime;
    const tc = CROSSFADE_SEC / 3;
    bassOscs[0].frequency.setTargetAtTime(midiToFreq(chord.bass), now, tc);
    bassOscs[1].frequency.setTargetAtTime(midiToFreq(chord.bass + 12), now, tc);
    padOscs.forEach((trio, v) => trio.forEach((o) => o.frequency.setTargetAtTime(midiToFreq(chord.voices[v]), now, tc)));
    schedule();
  }

  function schedule() {
    timer = setTimer(nextChord, CHORD_SEC * 1000);
  }

  function start() {
    if (ctx) {
      try { ctx.resume?.()?.catch?.(noop); } catch { /* 忽略 */ }
      return;
    }
    try {
      ctx = new AudioContextCtor();
      try { ctx.resume?.()?.catch?.(noop); } catch { /* 忽略 */ }
      build();
      schedule();
    } catch {
      teardown();
    }
  }

  function teardown() {
    if (timer !== null) clearTimer(timer);
    timer = null;
    for (const o of oscs) { try { o.stop(); } catch { /* 忽略 */ } }
    try { ctx?.close?.()?.catch?.(noop); } catch { /* 忽略 */ }
    ctx = null; master = null; reverbIn = null; bellBus = null;
    oscs = []; bassOscs = []; padOscs = []; chordIndex = 0;
  }

  function bell() {
    if (!ctx || muted || hushed) return;
    try {
      const now = ctx.currentTime;
      const base = midiToFreq(chordAt(chordIndex).voices[1] + 12);
      for (const [mult, amp] of BELL_PARTIALS) {
        const g = ctx.createGain();
        g.gain.setValueAtTime(BELL_LEVEL * amp, now);
        g.gain.exponentialRampToValueAtTime(0.0001, now + BELL_DECAY_SEC);
        g.connect(bellBus);
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(base * mult, now);
        o.connect(g);
        o.onended = () => {
          try { o.disconnect(); g.disconnect(); } catch { /* 忽略 */ }
        };
        o.start(now);
        o.stop(now + BELL_DECAY_SEC + 0.2);
      }
    } catch { /* 鐘聲失敗不影響其他 */ }
  }

  return {
    available: true,
    start,
    stop: teardown,
    setMuted(m) {
      muted = !!m;
      store.set(muted);
      glideMaster();
    },
    isMuted: () => muted,
    hush(on) {
      hushed = !!on;
      glideMaster();
    },
    bell,
  };
}
