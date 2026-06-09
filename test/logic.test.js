'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const BabyFood = require('../src/logic.js');

const seq = () => {
  let n = 0;
  return () => `id-${++n}`;
};

test('validateInput: 正しい入力ではエラーなし', () => {
  const errors = BabyFood.validateInput({ food: 'にんじん', date: '2026-06-09', reaction: 'ok' });
  assert.deepEqual(errors, []);
});

test('validateInput: 欠けている項目を検出する', () => {
  const errors = BabyFood.validateInput({ food: '  ', date: '', reaction: 'maybe' });
  assert.equal(errors.length, 3);
});

test('createRecord: 入力をトリムして記録を作る', () => {
  const record = BabyFood.createRecord(
    { food: '  かぼちゃ ', date: '2026-06-09', reaction: 'watch', memo: '  少量  ' },
    seq()
  );
  assert.equal(record.food, 'かぼちゃ');
  assert.equal(record.memo, '少量');
  assert.equal(record.id, 'id-1');
});

test('createRecord: 不正な入力では例外を投げる', () => {
  assert.throws(() => BabyFood.createRecord({ food: '', date: '', reaction: 'ok' }));
});

test('addRecord / removeRecord は元の配列を変更しない', () => {
  const r1 = BabyFood.createRecord({ food: 'おかゆ', date: '2026-06-01', reaction: 'ok' }, seq());
  const base = [];
  const added = BabyFood.addRecord(base, r1);
  assert.equal(base.length, 0);
  assert.equal(added.length, 1);

  const removed = BabyFood.removeRecord(added, r1.id);
  assert.equal(added.length, 1);
  assert.equal(removed.length, 0);
});

test('sortByDateDesc: 日付の新しい順に並べる', () => {
  const records = [
    { id: 'a', food: 'A', date: '2026-06-01', reaction: 'ok', memo: '' },
    { id: 'b', food: 'B', date: '2026-06-09', reaction: 'ok', memo: '' },
    { id: 'c', food: 'C', date: '2026-06-05', reaction: 'ok', memo: '' },
  ];
  const sorted = BabyFood.sortByDateDesc(records);
  assert.deepEqual(
    sorted.map((r) => r.id),
    ['b', 'c', 'a']
  );
});

test('summarize: 反応ごとに集計する', () => {
  const records = [
    { reaction: 'ok' },
    { reaction: 'ok' },
    { reaction: 'ng' },
    { reaction: 'watch' },
  ];
  assert.deepEqual(BabyFood.summarize(records), { ok: 2, watch: 1, ng: 1, total: 4 });
});
