import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalize, hashFNV1a, scoreTopic, pickTopic, answer, THRESHOLD } from '../assets/match.js';
import { buildTopicIndex, COSINE_THRESHOLD } from '../assets/match.js';

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
  assert.equal(pickTopic('我老婆很煩每天都在吵架', data.topics).topic.id, 'wife-complaint');
});

test('pickTopic 同分時取關鍵字表較長者（較具體）', () => {
  const 甲 = { id: 'a', label: '甲', keywords: [{ w: '錢', s: 3 }], verses: [] };
  const 乙 = { id: 'b', label: '乙', keywords: [{ w: '錢', s: 3 }, { w: '債', s: 1 }, { w: '窮', s: 1 }], verses: [] };
  assert.equal(pickTopic('沒錢', [甲, 乙]).topic.id, 'b');
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

const 帶例句的主題 = [
  {
    id: 'wife-complaint',
    label: '抱怨老婆',
    keywords: [{ w: '老婆', s: 3 }],
    phrases: ['我老婆很煩', '太太一直唸我', '內人很難相處', '跟妻子吵架'],
    verses: [{ ref: '以弗所書 5:22', id: 'Eph5v22', text: '妻一', quip: '補刀一' }],
  },
  {
    id: 'bad-boss',
    label: '老闆爛',
    keywords: [{ w: '老闆', s: 3 }],
    phrases: ['老闆很爛', '主管一直針對我', '想離職', '工作好痛苦想換'],
    verses: [{ ref: '以弗所書 6:5', id: 'Eph6v5', text: '僕一', quip: '補刀二' }],
  },
];

const 帶索引的資料 = {
  topics: 帶例句的主題,
  wrappers: ['神的意念高過你的意念。'],
  fallback: [{ ref: '詩篇 17:6', id: 'Ps17v6', text: '兜底一' }],
  index: buildTopicIndex(帶例句的主題),
};

test('COSINE_THRESHOLD 為 0.05', () => {
  assert.equal(COSINE_THRESHOLD, 0.05);
});

test('關鍵字命中時不走向量層', () => {
  const a = answer('我老婆不好', 帶索引的資料);
  assert.equal(a.topicId, 'wife-complaint');
  assert.equal(a.tier, 'keyword');
});

test('關鍵字落空時由向量層接住近似的問法', () => {
  const a = answer('內人很難相處', 帶索引的資料);
  assert.equal(a.topicId, 'wife-complaint');
  assert.equal(a.tier, 'vector');
});

test('向量層也接得住換句話說的離職問題', () => {
  const a = answer('我想換工作', 帶索引的資料);
  assert.equal(a.topicId, 'bad-boss');
  assert.equal(a.tier, 'vector');
});

test('兩層都落空才走兜底', () => {
  const a = answer('推薦一部電影', 帶索引的資料);
  assert.equal(a.kind, 'fallback');
  assert.equal(a.tier, null);
});

test('沒有提供 index 時退化成純關鍵字比對，不拋錯', () => {
  const a = answer('內人很難相處', { ...帶索引的資料, index: undefined });
  assert.equal(a.kind, 'fallback');
  assert.equal(a.tier, null);
});

test('向量層仍然是決定論的', () => {
  const first = answer('內人很難相處', 帶索引的資料);
  for (let i = 0; i < 50; i += 1) {
    assert.equal(answer('內人很難相處', 帶索引的資料).ref, first.ref);
  }
});

/** 載入正式資料並建索引，讓 fixture 走的路徑與網站上線時完全相同。 */
function 讀真資料() {
  const topicsFile = JSON.parse(readFileSync(new URL('../data/topics.json', import.meta.url), 'utf8'));
  return {
    topics: topicsFile.topics,
    wrappers: topicsFile.wrappers,
    fallback: [{ ref: '詩篇 17:6', id: 'Ps17v6', text: '兜底' }],
    index: buildTopicIndex(topicsFile.topics),
  };
}

test('三十個主題各自能被典型問法命中', () => {
  const 真資料 = 讀真資料();
  const 樣本 = [
    ['我老婆不好', 'wife-complaint'],
    ['老闆很爛想離職', 'bad-boss'],
    ['我沒錢又欠債', 'money-trouble'],
    ['好憂鬱好想死', 'despair'],
    ['我單身好久了', 'lust-single'],
    ['我老公很廢什麼都不做', 'husband-complaint'],
    ['我想離婚了', 'divorce'],
    ['我老公外遇劈腿', 'affair'],
    ['婆婆很難相處', 'in-laws'],
    ['身為女性升遷永遠沒我的份', 'woman-at-work'],
    ['為什麼我不能講道', 'woman-speaking'],
    ['一直被催生小孩', 'childbirth'],
    ['生理期好痛', 'menstruation'],
    ['我是同性戀想出櫃', 'homosexuality'],
    ['我一直看a片戒不掉', 'porn'],
    ['每天加班到深夜', 'overtime'],
    ['我薪水太低了', 'low-pay'],
    ['同事很機車愛搶功勞', 'bad-colleague'],
    ['我想中樂透發財', 'get-rich'],
    ['買不起房子房貸好重', 'buy-house'],
    ['我在學校被霸凌', 'bullied'],
    ['朋友背叛我', 'betrayed'],
    ['我想報復他', 'revenge'],
    ['我每天都失眠睡不著', 'insomnia'],
    ['我生病了一直好不了', 'illness'],
    ['我很怕死', 'fear-of-death'],
    ['小孩不聽話該不該打', 'discipline-kids'],
    ['我媽一直催我結婚', 'family-pressure'],
    ['神真的存在嗎', 'does-god-exist'],
    ['你是不是在嘲笑基督徒', 'are-you-mocking'],
  ];
  assert.equal(樣本.length, 30, '每個主題都要有一條 fixture');
  const 涵蓋 = new Set(樣本.map(([, id]) => id));
  assert.equal(涵蓋.size, 30, 'fixture 的主題 id 不可重複');
  assert.equal(真資料.topics.length, 30, 'topics.json 應有三十個主題');
  for (const [問, 期望] of 樣本) {
    assert.equal(answer(問, 真資料).topicId, 期望, `「${問}」應命中 ${期望}`);
  }
});

test('主題經文池為空時不拋錯，改回傳安全兜底結果', () => {
  const 空池主題 = {
    id: 'empty-pool-topic',
    label: '空池主題',
    keywords: [{ w: '空池測試詞', s: 3 }],
    verses: [],
  };
  const 資料 = { topics: [空池主題], fallback: data.fallback, wrappers: data.wrappers };
  const a = answer('空池測試詞', 資料);
  assert.equal(a.kind, 'fallback');
  assert.equal(a.tier, null);
  assert.equal(a.topicId, null);
  assert.ok(a.ref);
  assert.ok(a.text);
});

test('兜底池為空時不拋錯，改回傳安全兜底結果', () => {
  const 資料 = { topics: [抱怨老婆], fallback: [], wrappers: data.wrappers };
  const a = answer('今天天氣如何', 資料);
  assert.equal(a.kind, 'fallback');
  assert.equal(a.tier, null);
  assert.equal(a.topicId, null);
  assert.ok(a.ref);
  assert.ok(a.text);
});

test('冷門問題走兜底', () => {
  const 真資料 = 讀真資料();
  for (const 問 of ['我家的貓不吃飯', '今天天氣如何', '推薦一部電影', '腳踏車壞了', '要不要學法文']) {
    assert.equal(answer(問, 真資料).kind, 'fallback', `「${問}」不該命中任何主題`);
  }
});
