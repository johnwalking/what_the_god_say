/**
 * 聖殿配樂：Web Audio 即時合成（低音、合唱音墊、程式生成殘響、遠處鐘響），沒有音檔。
 * 上半部是純函式與常數（可在 node 下測試）；下半部是引擎，沒有 AudioContext 時全部無作用。
 */

// ---- 可調參數（聽感不對先改這裡）----
export const MASTER_LEVEL = 0.25;   // 總音量上限；調高會更大聲，請勿超過 0.25
export const HUSH_LEVEL = 0.06;     // 危機訊息時的低音量（小但可聽）；調高則 hush 時更明顯
export const FADE_IN_SEC = 5;       // 淡入秒數（resume 後才開始推進）；調高則更慢浮現
export const MUTE_FADE_SEC = 0.4;   // 靜音／hush 切換約需秒數；調高則更緩慢收放
export const CHORD_SEC = 24;        // 每個和弦停留秒數；調高則進行更慢
export const CROSSFADE_SEC = 6;     // 和弦滑動約需秒數（時間常數為其 1/3）；調高則更黏、更模糊
export const REVERB_SEC = 7;        // 殘響長度（秒）；調高則更空曠但更糊
export const REVERB_DECAY = 6;      // 殘響指數衰減速率；調高則尾巴收得更快、更乾
export const REVERB_DAMP = 0.65;    // 殘響高頻阻尼 0..0.95；調高則殘響更暗更悶
export const REVERB_WET = 0.7;      // 殘響（濕）比例；調高則更遠更糊
export const REVERB_DRY = 0.35;     // 直達（乾）比例；調高則更清晰靠近
export const PAD_LEVEL = 0.5;       // 合唱音墊整體音量；調高則音墊壓過低音
export const BASS_LEVEL = 0.34;     // 低音整體音量；調高則更厚重、可能混濁
export const BASS_OCTAVE_MIX = 0.5; // 低音八度（上方）的相對音量；調高則低音更亮
export const PAD_DETUNE_CENTS = 7;  // 每聲部三個鋸齒波的失諧量（±）；調高則合唱感更強、更不穩
export const PAD_DIRECT_MIX = 0.35; // 未經母音共振峰的直通比例；調高則更厚實、較不像人聲
export const FORMANT_1_HZ = 600;    // 母音「啊」第一共振峰；調高則更開、更亮
export const FORMANT_2_HZ = 900;    // 母音「啊」第二共振峰；調高則更尖
export const FORMANT_Q = 5;         // 共振峰尖銳度；調高則更像人聲但可能刺耳
export const FORMANT_GAIN = 1.2;    // 共振峰支路增益（補償帶通損耗）；調高則母音感更重、更響
export const PAD_LOWPASS_HZ = 1300; // 音墊低通截止；調高則更亮更刺，調低則更悶
export const LFO_HZ = 0.04;         // 緩慢調變速度；調高則呼吸更急
export const LFO_FILTER_HZ = 250;   // LFO 對低通截止的擺幅（Hz）；調高則明暗起伏更大
export const LFO_AMP = 0.08;        // LFO 對總音量的擺幅（±比例）；調高則音量起伏更明顯
export const BELL_LEVEL = 0.18;     // 鐘聲音量（相對於 master）；調高則鐘更突出
export const BELL_ATTACK_SEC = 0.008; // 鐘聲起音秒數；調高則起音更柔、較不像敲擊
export const BELL_MIN_GAP_SEC = 1.5;  // 兩次鐘聲的最小間隔；調高則鐘聲更稀疏
export const STOP_MARGIN_SEC = 0.1;   // stop() 淡出後再多等的緩衝秒數
export const BELL_DECAY_SEC = 6;    // 鐘聲衰減秒數；調高則餘音更長
export const BELL_PARTIALS = [[1, 1], [2.76, 0.45], [5.4, 0.2]]; // [基頻倍數, 相對音量]；改倍數會改變鐘的音色
export const SUB_MIDI = 26;         // 次低音持續音高（D1 約 37Hz）；改值需與和弦調性相容
export const SUB_LEVEL = 0.12;      // 次低音音量；調高則更震胸但小喇叭聽不到、易混濁
export const TOLL_MIN_SEC = 30;     // 遠鐘最短間隔秒數；調高則更稀疏
export const TOLL_MAX_SEC = 45;     // 遠鐘最長間隔秒數；調高則更稀疏
export const TOLL_LEVEL = BELL_LEVEL * 0.7; // 遠鐘音量；調高則更突出
export const TOLL_MIDI_OFFSET = 24; // 遠鐘音高 = 當前和弦低音 + 此半音數；調高則較不沉
export const TOLL_ATTACK_SEC = 0.03; // 遠鐘起音秒數；調高則更柔
export const TOLL_DECAY_SEC = 12;   // 遠鐘衰減秒數；調高則餘音更長
export const TOLL_WET = 1.2;        // 遠鐘送進殘響的比例；調高則更遙遠
export const TOLL_DRY = 0.12;       // 遠鐘直達比例；調高則更近
export const BELL_WET = 0.9;        // 鐘聲送進殘響的比例；調高則更遙遠
export const BELL_DRY = 0.25;       // 鐘聲直達比例；調高則更近

const MUTE_KEY = 'sanctuary-muted';

export const CHORDS = [
  { name: 'Dm', bass: 26, voices: [45, 50, 53, 57] },
  { name: 'Bb', bass: 34, voices: [46, 50, 53, 58] },
  { name: 'Gm', bass: 31, voices: [43, 46, 50, 55] },
  { name: 'Am', bass: 33, voices: [45, 48, 52, 57] },
  { name: 'A',  bass: 33, voices: [45, 49, 52, 57] },
];
export const PROGRESSION = [0, 1, 2, 0, 3, 1, 2, 4];

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

function buildReverbBuffer(ctx, random) {
  const rate = ctx.sampleRate || 44100;
  const len = Math.max(1, Math.floor(rate * REVERB_SEC));
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    let prev = 0;
    for (let i = 0; i < len; i++) {
      const noise = random() * 2 - 1;
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
  random = Math.random, // 遠鐘間隔與殘響噪聲的亂數來源；測試可注入
} = {}) {
  const store = createMuteStore(storage);
  let muted = store.get();
  let hushed = false;

  if (typeof AudioContextCtor !== 'function') {
    return {
      available: false, start: noop, stop: noop, hush: noop, bell: noop,
      state: () => 'unavailable',
      onStateChange: () => noop,
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
  let tollBus = null;
  let tollTimer = null;
  let blocked = false;          // 最近一次 resume() 被拒絕
  const listeners = new Set();  // onStateChange 訂閱者，跨 context 保留

  function state() {
    if (ctx && ctx.state === 'running') return 'running';
    return blocked ? 'blocked' : 'suspended';
  }

  function emit() {
    const s = state();
    for (const cb of [...listeners]) { try { cb(s); } catch { /* 訂閱者錯誤不影響引擎 */ } }
  }

  function onStateChange(cb) {
    if (typeof cb !== 'function') return noop;
    listeners.add(cb);
    return () => { listeners.delete(cb); };
  }

  /** 每次都嘗試 resume；被拒只標記 blocked 並通知，絕不拆除節點圖。 */
  function tryResume(c) {
    try {
      const p = c.resume?.();
      p?.then?.(
        () => { if (ctx === c && blocked) { blocked = false; emit(); } },
        () => { if (ctx === c && !blocked) { blocked = true; emit(); } },
      );
    } catch { /* 忽略 */ }
  }

  const level = () => (muted ? 0 : hushed ? HUSH_LEVEL : MASTER_LEVEL);

  let lastBellAt = -Infinity;

  /** 從目前值平滑滑向目標：先錨定目前值，避免取消排程後掉回 0 而爆音。 */
  function glideMaster(target = level()) {
    if (!ctx || !master) return;
    const now = ctx.currentTime;
    const p = master.gain;
    if (typeof p.cancelAndHoldAtTime === 'function') {
      p.cancelAndHoldAtTime(now);
    } else {
      p.cancelScheduledValues(now);
      p.setValueAtTime(p.value, now);
    }
    if (ctx.state !== 'running') {
      // 時間軸沒在走（currentTime 停在 0）：快速的 setTargetAtTime 會讓音樂在 resume 後瞬間滿音量，
      // 改成沿用長淡入的斜坡到新位準
      p.linearRampToValueAtTime(target, now + FADE_IN_SEC);
      return;
    }
    p.setTargetAtTime(target, now, MUTE_FADE_SEC / 4);
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
    reverbIn.buffer = buildReverbBuffer(ctx, random);
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

    // 次低音：固定的 D 持續音，直達 master（不進殘響，避免混濁）
    osc('sine', midiToFreq(SUB_MIDI), gainNode(SUB_LEVEL, master));

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
    // 遠鐘匯流排：更乾淨的殘響比例
    tollBus = gainNode(1, null);
    tollBus.connect(gainNode(TOLL_DRY, master));
    tollBus.connect(gainNode(TOLL_WET, reverbIn));
  }

  function nextChord() {
    if (!ctx || ctx.state === 'closed') { timer = null; return; }
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

  /** 敲一次鐘：數個正弦部分音，各自短 attack、指數衰減，結束後斷線。 */
  function strike(base, peak, attack, decay, bus) {
    const now = ctx.currentTime;
    for (const [mult, amp] of BELL_PARTIALS) {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(peak * amp, now + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, now + decay);
      g.connect(bus);
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(base * mult, now);
      o.connect(g);
      o.onended = () => {
        try { o.disconnect(); g.disconnect(); } catch { /* 忽略 */ }
      };
      o.start(now);
      o.stop(now + decay + 0.2);
    }
  }

  function scheduleToll() {
    const sec = TOLL_MIN_SEC + random() * (TOLL_MAX_SEC - TOLL_MIN_SEC);
    tollTimer = setTimer(toll, sec * 1000);
  }

  function toll() {
    if (!ctx || ctx.state === 'closed') { tollTimer = null; return; }
    scheduleToll();
    // 靜音、hush、或尚未 running（時間軸沒在走）都略過這一聲
    if (muted || hushed || ctx.state !== 'running') return;
    try {
      strike(midiToFreq(chordAt(chordIndex).bass + TOLL_MIDI_OFFSET), TOLL_LEVEL, TOLL_ATTACK_SEC, TOLL_DECAY_SEC, tollBus);
    } catch { /* 遠鐘失敗不影響其他 */ }
  }

  function start() {
    if (ctx) { tryResume(ctx); return; }
    try {
      const mine = new AudioContextCtor();
      ctx = mine;
      blocked = false;
      const forward = () => { if (ctx === mine) emit(); };
      if (typeof mine.addEventListener === 'function') mine.addEventListener('statechange', forward);
      else mine.onstatechange = forward;
      build();
      schedule();
      scheduleToll();
      tryResume(mine);
    } catch {
      teardown();
    }
  }

  function release(c, list) {
    for (const o of list) { try { o.stop(); } catch { /* 忽略 */ } }
    try { c?.close?.()?.catch?.(noop); } catch { /* 忽略 */ }
  }

  function clearState() {
    if (timer !== null) clearTimer(timer);
    if (tollTimer !== null) clearTimer(tollTimer);
    timer = null; tollTimer = null; blocked = false;
    ctx = null; master = null; reverbIn = null; bellBus = null; tollBus = null;
    oscs = []; bassOscs = []; padOscs = []; chordIndex = 0; lastBellAt = -Infinity;
  }

  function teardown() {
    const c = ctx; const list = oscs;
    clearState();
    release(c, list);
  }

  /** 淡出後才收尾；內部狀態立刻清空，之後的 start() 會建立全新的 context。 */
  function stop() {
    if (!ctx) return;
    glideMaster(0);
    const c = ctx; const list = oscs;
    clearState();
    setTimer(() => release(c, list), (MUTE_FADE_SEC + STOP_MARGIN_SEC) * 1000);
  }

  function bell() {
    if (!ctx || muted || hushed) return;
    if (ctx.currentTime - lastBellAt < BELL_MIN_GAP_SEC) return;
    try {
      lastBellAt = ctx.currentTime;
      strike(midiToFreq(chordAt(chordIndex).voices[1] + 12), BELL_LEVEL, BELL_ATTACK_SEC, BELL_DECAY_SEC, bellBus);
    } catch { /* 鐘聲失敗不影響其他 */ }
  }

  return {
    available: true,
    start,
    stop,
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
    state,
    onStateChange,
  };
}
