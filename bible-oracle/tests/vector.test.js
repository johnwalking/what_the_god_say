import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bigramCounts, buildIndex, query } from '../assets/vector.js';

test('bigramCounts 切出相鄰兩字的組合', () => {
  assert.deepEqual(bigramCounts('老婆很煩'), { 老婆: 1, 婆很: 1, 很煩: 1 });
});

test('bigramCounts 累計重複出現的組合', () => {
  assert.equal(bigramCounts('老婆老婆')['老婆'], 2);
});

test('bigramCounts 對單一字元回傳空表', () => {
  assert.deepEqual(bigramCounts('我'), {});
});

test('bigramCounts 對空字串回傳空表', () => {
  assert.deepEqual(bigramCounts(''), {});
});

test('buildIndex 不會產生跨例句邊界的 bigram', () => {
  // 「老婆」結尾接「老闆」開頭，不可以生出「婆老」這個假組合
  const index = buildIndex([
    { id: 'a', texts: ['我老婆', '老闆很爛'] },
    { id: 'b', texts: ['完全無關的句子'] },
  ]);
  const a = index.vectors.find((v) => v.id === 'a');
  assert.equal(a.vec['婆老'], undefined);
  assert.ok(a.vec['老婆'] !== undefined || a.vec['老闆'] !== undefined);
});

test('出現在每一份文件的組合權重為零（不具鑑別力）', () => {
  const index = buildIndex([
    { id: 'a', texts: ['老婆'] },
    { id: 'b', texts: ['老婆'] },
  ]);
  assert.equal(index.idf['老婆'], 0);
});

test('query 依相似度由高到低排序', () => {
  const index = buildIndex([
    { id: 'wife', texts: ['我老婆很煩', '太太一直唸我'] },
    { id: 'boss', texts: ['老闆很爛', '主管針對我'] },
    { id: 'money', texts: ['我沒錢', '負債好多'] },
  ]);
  const ranked = query(index, '我老婆很煩');
  assert.equal(ranked[0].id, 'wife');
  assert.ok(ranked[0].score > ranked[1].score);
});

test('query 對完全無關的輸入給出接近零的分數', () => {
  const index = buildIndex([
    { id: 'wife', texts: ['我老婆很煩'] },
    { id: 'boss', texts: ['老闆很爛'] },
  ]);
  const ranked = query(index, '推薦一部電影');
  assert.ok(ranked[0].score < 0.01, `分數應接近零，實際為 ${ranked[0].score}`);
});

test('query 對空輸入不拋錯', () => {
  const index = buildIndex([{ id: 'a', texts: ['我老婆很煩'] }, { id: 'b', texts: ['老闆很爛'] }]);
  const ranked = query(index, '');
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].score, 0);
});

test('buildIndex 對空的 docs 不拋錯', () => {
  const index = buildIndex([]);
  assert.deepEqual(query(index, '任何東西'), []);
});
