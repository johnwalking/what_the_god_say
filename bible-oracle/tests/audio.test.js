import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MUTE_FADE_SEC, midiToFreq, CHORDS, PROGRESSION, chordAt, createMuteStore, createAudio, MASTER_LEVEL, CHORD_SEC, HUSH_LEVEL, TOLL_MIN_SEC, TOLL_MAX_SEC, TOLL_LEVEL, BELL_LEVEL, FADE_IN_SEC } from '../assets/audio.js';

test('midiToFreq', () => {
  assert.equal(midiToFreq(69), 440);
  assert.ok(Math.abs(midiToFreq(57) - 220) < 1e-9);
});

test('和弦音高都在合理音域，且至少有四個聲部', () => {
  for (const chord of CHORDS) {
    assert.ok(chord.bass >= 24 && chord.bass <= 40);
    assert.ok(chord.voices.length >= 4);
    for (const v of chord.voices) assert.ok(v >= 40 && v <= 64);
  }
});

test('進行為 Dm Bb Gm Dm Am Bb Gm A 並可循環', () => {
  const names = PROGRESSION.map((i) => CHORDS[i].name);
  assert.deepEqual(names, ['Dm', 'Bb', 'Gm', 'Dm', 'Am', 'Bb', 'Gm', 'A']);
  assert.equal(chordAt(8), chordAt(0));
  assert.equal(chordAt(9), chordAt(1));
});

test('靜音儲存：正常、無 storage、storage 拋錯都不丟例外', () => {
  const data = new Map();
  const ok = createMuteStore({ getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) });
  assert.equal(ok.get(), false);
  ok.set(true);
  assert.equal(ok.get(), true);
  const none = createMuteStore(undefined);
  none.set(true);
  assert.equal(none.get(), false);
  const boom = createMuteStore({ getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } });
  boom.set(true);
  assert.equal(boom.get(), false);
});

test('沒有 AudioContext 時回傳無作用物件', () => {
  const audio = createAudio({ AudioContextCtor: null, storage: undefined });
  assert.equal(audio.available, false);
  assert.doesNotThrow(() => { audio.start(); audio.setMuted(true); audio.hush(true); audio.bell(); audio.stop(); });
});

// ---- 假的 AudioContext：記錄節點、參數排程與連線 ----

class FakeParam {
  constructor(value = 0) { this.value = value; this.targets = []; this.calls = []; this.events = []; }
  record(name, v, t) { this.calls.push(name); this.events.push({ name, v, t }); if (typeof v === 'number') this.targets.push(v); return this; }
  setValueAtTime(v, t) { return this.record('setValueAtTime', v, t); }
  linearRampToValueAtTime(v, t) { return this.record('linearRampToValueAtTime', v, t); }
  exponentialRampToValueAtTime(v, t) { return this.record('exponentialRampToValueAtTime', v, t); }
  setTargetAtTime(v, t) { return this.record('setTargetAtTime', v, t); }
  cancelScheduledValues(t) { return this.record('cancelScheduledValues', undefined, t); }
}

class FakeNode {
  constructor(kind) {
    this.kind = kind;
    this.frequency = new FakeParam(350);
    this.gain = new FakeParam(1);
    this.detune = new FakeParam(0);
    this.Q = new FakeParam(1);
    this.connections = [];
    this.started = false;
    this.stopped = false;
    this.stopCalls = 0;
    this.disconnected = 0;
  }
  connect(dst) { this.connections.push(dst); return dst; }
  disconnect() { this.connections = []; this.disconnected++; }
  start() { this.started = true; }
  stop() { this.stopped = true; this.stopCalls++; }
}

function makeFakeCtx({ rejectResume = false, hold = false, pending = false } = {}) {
  const created = [];
  class FakeAudioContext {
    constructor() {
      created.push(this);
      this.currentTime = 0;
      this.sampleRate = 8000;
      this.state = 'suspended';
      this.destination = new FakeNode('destination');
      this.nodes = [];
      this.resumeCalls = 0;
      this.buffers = 0;
      this.listeners = [];
    }
    addEventListener(type, fn) { if (type === 'statechange') this.listeners.push(fn); }
    setState(s) { this.state = s; this.listeners.forEach((fn) => fn({ type: 'statechange' })); }
    make(kind) {
      const n = new FakeNode(kind);
      if (hold) n.gain.cancelAndHoldAtTime = function (t) { return this.record('cancelAndHoldAtTime', undefined, t); };
      this.nodes.push(n);
      return n;
    }
    createOscillator() { return this.make('oscillator'); }
    createGain() { return this.make('gain'); }
    createConvolver() { return this.make('convolver'); }
    createBiquadFilter() { return this.make('biquad'); }
    createBuffer(ch, len) {
      this.buffers++;
      return { numberOfChannels: ch, length: len, getChannelData: () => new Float32Array(len) };
    }
    resume() { this.resumeCalls++; if (pending) return new Promise(() => {}); if (rejectResume) return Promise.reject(new Error('blocked')); this.state = 'running'; return Promise.resolve(); }
    close() { this.closeCalls = (this.closeCalls || 0) + 1; this.state = 'closed'; return Promise.resolve(); }
    count(kind) { return this.nodes.filter((n) => n.kind === kind).length; }
    master() { return this.nodes.find((n) => n.kind === 'gain' && n.connections.includes(this.destination)); }
  }
  return { FakeAudioContext, created };
}

function makeTimers() {
  let now = 0; let id = 0; const pending = new Map();
  return {
    setTimer(fn, ms) { id += 1; pending.set(id, { fn, at: now + ms }); return id; },
    clearTimer(h) { pending.delete(h); },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...pending.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        pending.delete(next[0]); now = next[1].at; next[1].fn();
      }
      now = end;
    },
    get size() { return pending.size; },
  };
}

function setup({ muted = false, random = () => 0, ...fakeOpts } = {}) {
  const { FakeAudioContext, created } = makeFakeCtx(fakeOpts);
  const timers = makeTimers();
  const data = new Map(muted ? [['sanctuary-muted', '1']] : []);
  const storage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
  const audio = createAudio({ AudioContextCtor: FakeAudioContext, storage, setTimer: timers.setTimer, clearTimer: timers.clearTimer, random });
  return { audio, created, timers, data, ctx: () => created[0] };
}

test('start() 只建立一次 context 與 oscillator 組（重複呼叫不重複建立）', () => {
  const { audio, created, ctx } = setup();
  assert.equal(audio.available, true);
  audio.start();
  const oscs = ctx().count('oscillator');
  assert.ok(oscs > 0);
  assert.equal(ctx().count('convolver'), 1);
  assert.ok(ctx().resumeCalls >= 1);
  audio.start();
  assert.equal(created.length, 1);
  assert.equal(ctx().count('oscillator'), oscs);
  assert.equal(ctx().count('convolver'), 1);
});

test('master gain 目標值不超過 MASTER_LEVEL；初始靜音時不會升上去', () => {
  const a = setup();
  a.audio.start();
  const peak = Math.max(...a.ctx().master().gain.targets);
  assert.ok(peak > 0 && peak <= MASTER_LEVEL);
  assert.ok(MASTER_LEVEL <= 0.25);

  const b = setup({ muted: true });
  assert.equal(b.audio.isMuted(), true);
  b.audio.start();
  assert.ok(Math.max(...b.ctx().master().gain.targets) === 0);
  b.audio.hush(true); b.audio.hush(false);
  assert.ok(Math.max(...b.ctx().master().gain.targets) === 0);
});

test('setMuted 寫入 store；靜音時 bell() 不建立新 oscillator，取消靜音後恢復', () => {
  const { audio, data, ctx } = setup();
  audio.start();
  const base = ctx().count('oscillator');
  audio.setMuted(true);
  assert.equal(audio.isMuted(), true);
  assert.equal(data.get('sanctuary-muted'), '1');
  assert.equal(ctx().master().gain.targets.at(-1), 0);
  audio.bell();
  assert.equal(ctx().count('oscillator'), base);
  audio.setMuted(false);
  assert.equal(ctx().master().gain.targets.at(-1), MASTER_LEVEL);
  audio.bell();
  assert.ok(ctx().count('oscillator') > base);
});

test('hush(true) 時 bell() 不發聲，hush(false) 後恢復', () => {
  const { audio, ctx } = setup();
  audio.start();
  const base = ctx().count('oscillator');
  audio.hush(true);
  assert.ok(ctx().master().gain.targets.at(-1) < MASTER_LEVEL);
  audio.bell();
  assert.equal(ctx().count('oscillator'), base);
  audio.hush(false);
  assert.equal(ctx().master().gain.targets.at(-1), MASTER_LEVEL);
  audio.bell();
  assert.ok(ctx().count('oscillator') > base);
});

test('換和弦以 setTargetAtTime 滑動、不新增 oscillator；stop() 之後不再排程', () => {
  const { audio, timers, ctx } = setup();
  audio.start();
  const oscs = ctx().nodes.filter((n) => n.kind === 'oscillator');
  const glides = () => oscs.reduce((s, o) => s + o.frequency.calls.filter((c) => c === 'setTargetAtTime').length, 0);
  assert.equal(glides(), 0);
  timers.advance(CHORD_SEC * 1000 + 10);
  assert.ok(glides() > 0);
  assert.equal(ctx().count('oscillator'), oscs.length);
  audio.stop();
  const after = glides();
  const count = ctx().nodes.length;
  timers.advance(CHORD_SEC * 5000);
  assert.equal(glides(), after);
  assert.equal(ctx().nodes.length, count);
  assert.doesNotThrow(() => { audio.bell(); audio.setMuted(true); audio.hush(true); });
});

// ---- 審查修正 ----

test('淡入途中靜音：以目前值錨定，不會先跳到 0', () => {
  const { audio, ctx } = setup();
  audio.start();
  const g = ctx().master().gain;
  ctx().currentTime = 1.5;
  g.value = 0.125;
  audio.setMuted(true);
  const after = g.events.slice(g.events.findIndex((e) => e.name === 'linearRampToValueAtTime') + 1);
  assert.ok(!after.some((e) => e.name === 'setValueAtTime' && e.v === 0 && e.t === 1.5));
  const anchor = after.findIndex((e) => e.name === 'setValueAtTime' && e.v === 0.125 && e.t === 1.5);
  const target = after.findIndex((e) => e.name === 'setTargetAtTime' && e.v === 0);
  assert.ok(anchor >= 0 && target > anchor);
  assert.equal(after[0].name, 'cancelScheduledValues');
});

test('有 cancelAndHoldAtTime 時用它保留目前值，且排在新目標之前', () => {
  const { audio, ctx } = setup({ hold: true });
  audio.start();
  const g = ctx().master().gain;
  ctx().currentTime = 1.5;
  audio.hush(true);
  const names = g.events.map((e) => e.name);
  const hold = names.lastIndexOf('cancelAndHoldAtTime');
  assert.ok(hold >= 0);
  assert.ok(!names.slice(hold).includes('cancelScheduledValues'));
  assert.equal(names[hold + 1], 'setTargetAtTime');
});

test('stop() 先淡出 master，延遲後才 stop oscillator 並關閉 context（一次）', () => {
  const { audio, timers, ctx } = setup();
  audio.start();
  const c = ctx();
  const oscs = c.nodes.filter((n) => n.kind === 'oscillator');
  audio.stop();
  const g = c.master().gain;
  assert.equal(g.events.at(-1).name, 'setTargetAtTime');
  assert.equal(g.events.at(-1).v, 0);
  assert.ok(oscs.every((o) => o.stopCalls === 0));
  assert.equal(c.closeCalls || 0, 0);
  timers.advance(MUTE_FADE_SEC * 1000 + 500);
  assert.ok(oscs.every((o) => o.stopCalls === 1));
  assert.equal(c.closeCalls, 1);
  timers.advance(60000);
  assert.equal(c.closeCalls, 1);
  assert.ok(oscs.every((o) => o.stopCalls === 1));
});

test('stop() 之後 start() 會建立新的 context；舊的仍照常收尾', () => {
  const { audio, timers, created } = setup();
  audio.start();
  audio.stop();
  audio.start();
  assert.equal(created.length, 2);
  assert.equal(created[1].count('convolver'), 1);
  timers.advance(MUTE_FADE_SEC * 1000 + 500);
  assert.equal(created[0].closeCalls, 1);
  assert.equal(created[1].closeCalls || 0, 0);
  assert.ok(created[1].nodes.filter((n) => n.kind === 'oscillator').every((o) => o.stopCalls === 0));
});

test('換和弦的目標頻率等於下一個和弦各音的 midiToFreq', () => {
  const { audio, timers, ctx } = setup();
  audio.start();
  const oscs = ctx().nodes.filter((n) => n.kind === 'oscillator');
  timers.advance(CHORD_SEC * 1000 + 10);
  const next = chordAt(1);
  const targets = oscs.flatMap((o) => o.frequency.targets.filter((_, i) => o.frequency.calls[i] === 'setTargetAtTime'));
  assert.ok(targets.includes(midiToFreq(next.bass)));
  assert.ok(targets.includes(midiToFreq(next.bass + 12)));
  for (const v of next.voices) assert.ok(targets.includes(midiToFreq(v)));
});

test('鐘聲：有短 attack、oscillator 會 stop，onended 後斷線', () => {
  const { audio, ctx } = setup();
  audio.start();
  const before = ctx().nodes.length;
  audio.bell();
  const added = ctx().nodes.slice(before);
  const oscs = added.filter((n) => n.kind === 'oscillator');
  const gains = added.filter((n) => n.kind === 'gain');
  assert.ok(oscs.length > 0 && gains.length === oscs.length);
  for (const g of gains) {
    const names = g.gain.events.map((e) => e.name);
    assert.deepEqual(names, ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime']);
    const ramp = g.gain.events[1];
    assert.ok(ramp.t > g.gain.events[0].t && ramp.t - g.gain.events[0].t <= 0.02);
  }
  for (const o of oscs) {
    assert.equal(o.started, true);
    assert.equal(o.stopCalls, 1);
    assert.equal(typeof o.onended, 'function');
    o.onended();
    assert.equal(o.disconnected, 1);
  }
  assert.ok(gains.every((g) => g.disconnected === 1));
});

test('鐘聲最小間隔：1.5 秒內重複呼叫被忽略', () => {
  const { audio, ctx } = setup();
  audio.start();
  audio.bell();
  const n = ctx().count('oscillator');
  ctx().currentTime = 1;
  audio.bell();
  assert.equal(ctx().count('oscillator'), n);
  ctx().currentTime = 1.6;
  audio.bell();
  assert.ok(ctx().count('oscillator') > n);
});

test('resume() 被拒絕時保留節點圖、不拆除，下次 start() 會再嘗試 resume', async () => {
  const { audio, timers, created } = setup({ rejectResume: true });
  audio.start();
  await new Promise((r) => setImmediate(r));
  assert.equal(created.length, 1);
  assert.equal(created[0].closeCalls || 0, 0);
  assert.ok(timers.size >= 1);
  assert.doesNotThrow(() => audio.bell());
  const oscs = created[0].count('oscillator');
  const calls = created[0].resumeCalls;
  audio.start();
  assert.equal(created.length, 1);
  assert.equal(created[0].resumeCalls, calls + 1);
  assert.equal(created[0].count('oscillator'), oscs);
  assert.equal(audio.state(), 'blocked');
});

test('suspended（resume 一直 pending）時 start() 不拆除；每次 start() 都呼叫 resume', () => {
  const { audio, created, ctx } = setup({ pending: true });
  audio.start();
  audio.start();
  audio.start();
  assert.equal(created.length, 1);
  assert.equal(ctx().resumeCalls, 3);
  assert.equal(ctx().closeCalls || 0, 0);
  assert.equal(audio.state(), 'suspended');
  assert.ok(ctx().count('oscillator') > 0);
});

test('state()：不可用、未啟動、running、blocked', async () => {
  assert.equal(createAudio({ AudioContextCtor: null }).state(), 'unavailable');
  const a = setup();
  assert.equal(a.audio.state(), 'suspended');
  a.audio.start();
  assert.equal(a.audio.state(), 'running');
  const b = setup({ rejectResume: true });
  b.audio.start();
  await new Promise((r) => setImmediate(r));
  assert.equal(b.audio.state(), 'blocked');
});

test('onStateChange：轉發 statechange、可取消；start() 之前註冊也會生效', async () => {
  const { audio, ctx } = setup({ pending: true });
  const seen = [];
  const off = audio.onStateChange((s) => seen.push(s));
  assert.equal(typeof off, 'function');
  audio.start();
  ctx().setState('running');
  assert.deepEqual(seen, ['running']);
  ctx().setState('suspended');
  assert.deepEqual(seen, ['running', 'suspended']);
  off();
  ctx().setState('running');
  assert.equal(seen.length, 2);
  const none = createAudio({ AudioContextCtor: null });
  assert.equal(typeof none.onStateChange(() => {}), 'function');
});

test('resume 被拒時通知 blocked，之後恢復通知 running', async () => {
  const { audio, ctx } = setup({ rejectResume: true });
  const seen = [];
  audio.onStateChange((s) => seen.push(s));
  audio.start();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(seen, ['blocked']);
  ctx().setState('running');
  assert.equal(audio.state(), 'running');
});

test('hush 位準小但可聽（0 < HUSH <= 0.1）並實際套用', () => {
  assert.ok(HUSH_LEVEL > 0 && HUSH_LEVEL <= 0.1);
  const { audio, ctx } = setup();
  audio.start();
  audio.hush(true);
  assert.equal(ctx().master().gain.targets.at(-1), HUSH_LEVEL);
});

// ---- 遠鐘 ----

test('遠鐘：隨機間隔 30..45 秒（rng 注入），低沉、音量約 BELL_LEVEL*0.7', () => {
  assert.equal(TOLL_MIN_SEC, 30);
  assert.equal(TOLL_MAX_SEC, 45);
  assert.ok(Math.abs(TOLL_LEVEL - BELL_LEVEL * 0.7) < 1e-9);
  const lo = setup({ random: () => 0 });
  lo.audio.start();
  const base = lo.ctx().nodes.length;
  lo.timers.advance(29900);
  assert.equal(lo.ctx().nodes.length, base);
  lo.timers.advance(200);
  const added = lo.ctx().nodes.slice(base);
  const oscs = added.filter((n) => n.kind === 'oscillator');
  assert.ok(oscs.length > 0);
  const peaks = added.filter((n) => n.kind === 'gain').map((g) => Math.max(...g.gain.targets));
  assert.ok(Math.max(...peaks) <= TOLL_LEVEL + 1e-9);
  assert.ok(Math.min(...oscs.map((o) => o.frequency.targets[0])) < midiToFreq(chordAt(0).voices[1] + 12));
  const hi = setup({ random: () => 1 });
  hi.audio.start();
  const b2 = hi.ctx().nodes.length;
  hi.timers.advance(44900);
  assert.equal(hi.ctx().nodes.length, b2);
  hi.timers.advance(200);
  assert.ok(hi.ctx().nodes.length > b2);
});

test('遠鐘持續排程；muted／hush 時略過但仍排下一次', () => {
  const { audio, timers, ctx } = setup({ random: () => 0 });
  audio.start();
  const n0 = ctx().count('oscillator');
  timers.advance(30000);
  const n1 = ctx().count('oscillator');
  assert.ok(n1 > n0);
  audio.setMuted(true);
  timers.advance(30000);
  assert.equal(ctx().count('oscillator'), n1);
  audio.setMuted(false);
  audio.hush(true);
  timers.advance(30000);
  assert.equal(ctx().count('oscillator'), n1);
  audio.hush(false);
  timers.advance(30000);
  assert.ok(ctx().count('oscillator') > n1);
});

test('遠鐘在 context 尚未 running 時略過；stop() 後清除計時器不再響', () => {
  const p = setup({ pending: true, random: () => 0 });
  p.audio.start();
  const n = p.ctx().count('oscillator');
  p.timers.advance(90000);
  assert.equal(p.ctx().count('oscillator'), n);
  const { audio, timers, ctx } = setup({ random: () => 0 });
  audio.start();
  audio.stop();
  const count = ctx().nodes.length;
  timers.advance(300000);
  assert.equal(ctx().nodes.length, count);
  assert.equal(timers.size, 0);
});

test('有持續的 sub drone（低於 40Hz 的 sine）', () => {
  const { audio, ctx } = setup();
  audio.start();
  const subs = ctx().nodes.filter((n) => n.kind === 'oscillator' && n.frequency.targets[0] < 40);
  assert.ok(subs.length >= 1);
});

test('context 已關閉時，換和弦計時器不再重排', () => {
  const { audio, timers, ctx } = setup();
  audio.start();
  ctx().close();
  timers.advance(CHORD_SEC * 1000 + 100000);
  assert.equal(timers.size, 0);
});

test('context 尚未 running 時 hush/setMuted 不取消長淡入：改排 linearRamp 到 FADE_IN_SEC 後的目標位準', () => {
  const { audio, ctx } = setup({ pending: true });
  audio.start();
  const g = ctx().master().gain;
  assert.equal(ctx().state, 'suspended');
  audio.hush(true);
  audio.hush(false);
  const ramps = g.events.filter((e) => e.name === 'linearRampToValueAtTime');
  const last = ramps.at(-1);
  assert.equal(last.v, MASTER_LEVEL);
  assert.equal(last.t, FADE_IN_SEC);
  assert.ok(!g.events.some((e, i) => i > 2 && e.name === 'setTargetAtTime'), 'suspended 時不用快速的 setTargetAtTime');
  audio.setMuted(true);
  assert.equal(g.events.filter((e) => e.name === 'linearRampToValueAtTime').at(-1).v, 0);
});
