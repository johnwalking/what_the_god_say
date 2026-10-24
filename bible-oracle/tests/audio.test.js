import { test } from 'node:test';
import assert from 'node:assert/strict';
import { midiToFreq, CHORDS, PROGRESSION, chordAt, createMuteStore, createAudio, MASTER_LEVEL, CHORD_SEC } from '../assets/audio.js';

test('midiToFreq', () => {
  assert.equal(midiToFreq(69), 440);
  assert.ok(Math.abs(midiToFreq(57) - 220) < 1e-9);
});

test('和弦音高都在合理音域，且至少有四個聲部', () => {
  for (const chord of CHORDS) {
    assert.ok(chord.bass >= 28 && chord.bass <= 48);
    assert.ok(chord.voices.length >= 4);
    for (const v of chord.voices) assert.ok(v >= 50 && v <= 76);
  }
});

test('進行為 Dm Bb F C Dm Gm Bb C 並可循環', () => {
  const names = PROGRESSION.map((i) => CHORDS[i].name);
  assert.deepEqual(names, ['Dm', 'Bb', 'F', 'C', 'Dm', 'Gm', 'Bb', 'C']);
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
  constructor(value = 0) { this.value = value; this.targets = []; this.calls = []; }
  record(name, v) { this.calls.push(name); if (typeof v === 'number') this.targets.push(v); return this; }
  setValueAtTime(v) { return this.record('setValueAtTime', v); }
  linearRampToValueAtTime(v) { return this.record('linearRampToValueAtTime', v); }
  exponentialRampToValueAtTime(v) { return this.record('exponentialRampToValueAtTime', v); }
  setTargetAtTime(v) { return this.record('setTargetAtTime', v); }
  cancelScheduledValues() { return this.record('cancelScheduledValues'); }
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
  }
  connect(dst) { this.connections.push(dst); return dst; }
  disconnect() { this.connections = []; }
  start() { this.started = true; }
  stop() { this.stopped = true; }
}

function makeFakeCtx() {
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
    }
    make(kind) { const n = new FakeNode(kind); this.nodes.push(n); return n; }
    createOscillator() { return this.make('oscillator'); }
    createGain() { return this.make('gain'); }
    createConvolver() { return this.make('convolver'); }
    createBiquadFilter() { return this.make('biquad'); }
    createBuffer(ch, len) {
      this.buffers++;
      return { numberOfChannels: ch, length: len, getChannelData: () => new Float32Array(len) };
    }
    resume() { this.resumeCalls++; this.state = 'running'; return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
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

function setup({ muted = false } = {}) {
  const { FakeAudioContext, created } = makeFakeCtx();
  const timers = makeTimers();
  const data = new Map(muted ? [['sanctuary-muted', '1']] : []);
  const storage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
  const audio = createAudio({ AudioContextCtor: FakeAudioContext, storage, setTimer: timers.setTimer, clearTimer: timers.clearTimer });
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
  assert.equal(timers.size, 0);
  timers.advance(CHORD_SEC * 5000);
  assert.equal(glides(), after);
  assert.equal(ctx().nodes.length, count);
  assert.doesNotThrow(() => { audio.bell(); audio.setMuted(true); audio.hush(true); });
});
