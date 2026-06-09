'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const BabyFood = require('../src/logic.js');

// テストの基準日（決定的にするため固定）
const NOW = '2026-06-09T10:00:00';

const batch = (over) => ({
  id: 'x',
  veg: 'にんじん',
  qty: 1,
  made: '2026-06-09',
  store: '冷蔵',
  ...over,
});

test('daysSince: 日付の差を日数で返す', () => {
  assert.equal(BabyFood.daysSince('2026-06-09', NOW), 0);
  assert.equal(BabyFood.daysSince('2026-06-08', NOW), 1);
  assert.equal(BabyFood.daysSince('2026-06-02', NOW), 7);
});

test('freshness: 冷蔵は2日まで、超えると期限すぎ', () => {
  assert.equal(BabyFood.freshness(batch({ made: '2026-06-09', store: '冷蔵' }), NOW).txt, 'つくりたて');
  assert.equal(BabyFood.freshness(batch({ made: '2026-06-08', store: '冷蔵' }), NOW).txt, '早めに');
  const old = BabyFood.freshness(batch({ made: '2026-06-06', store: '冷蔵' }), NOW);
  assert.equal(old.txt, '期限すぎ');
  assert.equal(old.alert, true);
});

test('freshness: 冷凍は7日まで持つ', () => {
  assert.equal(BabyFood.freshness(batch({ made: '2026-06-06', store: '冷凍' }), NOW).txt, '新しい'); // 3日
  assert.equal(BabyFood.freshness(batch({ made: '2026-06-04', store: '冷凍' }), NOW).txt, '早めに'); // 5日
  assert.equal(BabyFood.freshness(batch({ made: '2026-06-01', store: '冷凍' }), NOW).alert, true); // 8日
});

test('madeLabel: 今日 / 昨日 / N日前', () => {
  assert.equal(BabyFood.madeLabel('2026-06-09', NOW), '今日');
  assert.equal(BabyFood.madeLabel('2026-06-08', NOW), '昨日');
  assert.equal(BabyFood.madeLabel('2026-06-04', NOW), '5日前');
});

test('groupBatches: 野菜ごとに、在庫切れを除き、古い順でまとめる', () => {
  const batches = [
    batch({ id: 'a', veg: 'にんじん', made: '2026-06-08' }),
    batch({ id: 'b', veg: 'にんじん', made: '2026-06-05' }),
    batch({ id: 'c', veg: 'かぼちゃ', made: '2026-06-09' }),
    batch({ id: 'd', veg: 'にんじん', made: '2026-06-09', qty: 0 }), // 在庫切れ
  ];
  const g = BabyFood.groupBatches(batches);
  assert.deepEqual(Object.keys(g).sort(), ['かぼちゃ', 'にんじん']);
  assert.deepEqual(g['にんじん'].map((b) => b.id), ['b', 'a']); // 古い順
});

test('summarize: 種類・合計・期限すぎを集計する', () => {
  const batches = [
    batch({ veg: 'にんじん', qty: 3, made: '2026-06-09', store: '冷蔵' }),
    batch({ veg: 'かぼちゃ', qty: 2, made: '2026-06-01', store: '冷蔵' }), // 期限すぎ
    batch({ veg: 'にんじん', qty: 0, made: '2026-06-09' }), // 在庫切れは除外
  ];
  assert.deepEqual(BabyFood.summarize(batches, NOW), { types: 2, total: 5, alert: 1 });
});

test('deductFIFO: 古いストックから先に引き、元配列は変えない', () => {
  const batches = [
    batch({ id: 'new', veg: 'にんじん', qty: 5, made: '2026-06-09' }),
    batch({ id: 'old', veg: 'にんじん', qty: 3, made: '2026-06-05' }),
  ];
  const next = BabyFood.deductFIFO(batches, [{ veg: 'にんじん', qty: 4 }]);
  // 古い old(3) を使い切り、残り1を new から
  assert.equal(next.find((b) => b.id === 'old').qty, 0);
  assert.equal(next.find((b) => b.id === 'new').qty, 4);
  // 元配列は不変
  assert.equal(batches.find((b) => b.id === 'old').qty, 3);
});

test('restoreToStock: 取り消し分を一番新しいストックに戻す', () => {
  const batches = [
    batch({ id: 'new', veg: 'にんじん', qty: 1, made: '2026-06-09' }),
    batch({ id: 'old', veg: 'にんじん', qty: 0, made: '2026-06-05' }),
  ];
  const next = BabyFood.restoreToStock(batches, [{ veg: 'にんじん', qty: 2 }]);
  assert.equal(next.find((b) => b.id === 'new').qty, 3);
});

test('restoreToStock: 戻し先が無ければ新規ストックを作る', () => {
  const next = BabyFood.restoreToStock(
    [],
    [{ veg: 'ほうれん草', qty: 2 }],
    { uid: () => 'gen', today: '2026-06-09' }
  );
  assert.equal(next.length, 1);
  assert.deepEqual(next[0], { id: 'gen', veg: 'ほうれん草', qty: 2, made: '2026-06-09', store: '冷蔵' });
});

test('slotFromHour: 時刻から朝昼晩を決める', () => {
  assert.equal(BabyFood.slotFromHour(7), '朝');
  assert.equal(BabyFood.slotFromHour(12), '昼');
  assert.equal(BabyFood.slotFromHour(19), '晩');
  assert.equal(BabyFood.slotFromHour(2), '晩');
});

test('mergeItems: 同じ野菜の数量をまとめ、初出順を保つ', () => {
  const merged = BabyFood.mergeItems([
    { veg: 'にんじん', qty: 2 },
    { veg: 'おかゆ', qty: 1 },
    { veg: 'にんじん', qty: 1 },
  ]);
  assert.deepEqual(merged, [
    { veg: 'にんじん', qty: 3 },
    { veg: 'おかゆ', qty: 1 },
  ]);
});
