import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, hashFNV1a, scoreTopic, pickTopic, answer, THRESHOLD } from '../assets/match.js';

const 抱怨老婆 = {
  id: 'wife-complaint',
  label: '抱怨老婆',
  keywords: [{ w: '老婆', s: 3 }, { w: '太太', s: 3 }, { w: '吵架', s: 1 }],
  verses: [
    { ref: '以弗所書 5:22', id: 'Eph5v22', text: '妻一', quip: '補刀一' },
    { ref: '歌羅西書 3:18', id: 'Col3v18', text: '妻二', quip: '補刀二' },
    { ref: '箴言 21:9', id: 'Prov21v9', text: '妻三', quip: '補刀三' },
  ],
};

const 婚姻爭吵 = {
  id: 'marriage-fight',
  label: '婚姻爭吵',
  keywords: [{ w: '吵架', s: 1 }, { w: '冷戰', s: 1 }, { w: '離婚', s: 3 }, { w: '婚姻', s: 1 }],
  verses: [{ ref: '馬太福音 19:6', id: 'Matt19v6', text: '婚一', quip: '補刀四' }],
};

const data = {
  topics: [抱怨老婆, 婚姻爭吵],
  fallback: [
    { ref: '詩篇 17:6', id: 'Ps17v6', text: '兜底一' },
    { ref: '箴言 17:22', id: 'Prov17v22', text: '兜底二' },
  ],
  wrappers: ['神的意念高過你的意念。', '主已經回答了，是你還沒讀懂。'],
};

test('normalize 去除標點與空白', () => {
  assert.equal(normalize('我 老婆，不好！'), '我老婆不好');
});

test('normalize 把全形英數轉半形', () => {
  assert.equal(normalize('ＡＢＣ１２３'), 'abc123');
});

test('normalize 容忍 null 與 undefined', () => {
  assert.equal(normalize(null), '');
  assert.equal(normalize(undefined), '');
});

test('hashFNV1a 對同一字串永遠回傳同一值', () => {
  assert.equal(hashFNV1a('我老婆不好'), hashFNV1a('我老婆不好'));
});

test('hashFNV1a 對不同字串回傳不同值', () => {
  assert.notEqual(hashFNV1a('我老婆不好'), hashFNV1a('我老公不好'));
});

test('hashFNV1a 回傳非負的 32 位元整數', () => {
  const h = hashFNV1a('虛空的虛空');
  assert.ok(Number.isInteger(h) && h >= 0 && h <= 0xffffffff);
});

test('scoreTopic 累加命中的關鍵字權重', () => {
  assert.equal(scoreTopic('我老婆一直跟我吵架', 抱怨老婆), 4);
});

test('scoreTopic 沒命中時回傳 0', () => {
  assert.equal(scoreTopic('今天天氣很好', 抱怨老婆), 0);
});

test('pickTopic 低於門檻時回傳 null', () => {
  assert.equal(pickTopic('我們常常吵架', [抱怨老婆]), null);
});

test('pickTopic 取分數最高的主題', () => {
  assert.equal(pickTopic('我老婆很煩每天都在吵架', data.topics).id, 'wife-complaint');
});

test('pickTopic 同分時取關鍵字表較長者（較具體）', () => {
  const 甲 = { id: 'a', label: '甲', keywords: [{ w: '錢', s: 3 }], verses: [] };
  const 乙 = { id: 'b', label: '乙', keywords: [{ w: '錢', s: 3 }, { w: '債', s: 1 }, { w: '窮', s: 1 }], verses: [] };
  assert.equal(pickTopic('沒錢', [甲, 乙]).id, 'b');
});

test('THRESHOLD 為 3', () => {
  assert.equal(THRESHOLD, 3);
});

test('命中主題時回傳該主題的經文與補刀', () => {
  const a = answer('我老婆不好', data);
  assert.equal(a.kind, 'topic');
  assert.equal(a.topicId, 'wife-complaint');
  assert.ok(抱怨老婆.verses.some((v) => v.ref === a.ref && v.quip === a.quip));
  assert.equal(a.poolSize, 3);
});

test('沒命中時走兜底並套用包裝詞', () => {
  const a = answer('我家的貓不吃飯', data);
  assert.equal(a.kind, 'fallback');
  assert.equal(a.topicId, null);
  assert.ok(data.fallback.some((v) => v.ref === a.ref));
  assert.ok(data.wrappers.includes(a.quip));
});

test('同一組 (問題, n) 連續呼叫 100 次都回傳同一節', () => {
  const first = answer('我老婆不好', data, 0);
  for (let i = 0; i < 100; i += 1) {
    assert.equal(answer('我老婆不好', data, 0).ref, first.ref);
  }
});

test('不同的 n 走到經文池中不同的位置', () => {
  const refs = new Set([0, 1, 2].map((n) => answer('我老婆不好', data, n).ref));
  assert.equal(refs.size, 3);
});

test('n 超過經文池長度時取模回繞', () => {
  assert.equal(answer('我老婆不好', data, 3).ref, answer('我老婆不好', data, 0).ref);
});

test('空字串走兜底且不拋錯', () => {
  const a = answer('', data);
  assert.equal(a.kind, 'fallback');
  assert.ok(a.text);
});

test('負數的 n 被當作 0，不拋錯', () => {
  assert.equal(answer('我老婆不好', data, -5).ref, answer('我老婆不好', data, 0).ref);
});

test('非數字的 n 被當作 0，不拋錯', () => {
  assert.equal(answer('我老婆不好', data, NaN).ref, answer('我老婆不好', data, 0).ref);
});
