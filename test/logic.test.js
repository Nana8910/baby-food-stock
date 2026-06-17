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
  assert.deepEqual(next[0], { id: 'gen', veg: 'ほうれん草', qty: 2, made: '2026-06-09', store: '冷蔵', cat: '野菜' });
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

test('catOfName: 名前からカテゴリを推定（不明は野菜）', () => {
  assert.equal(BabyFood.catOfName('にんじん'), '野菜');
  assert.equal(BabyFood.catOfName('鶏ささみ'), 'タンパク質');
  assert.equal(BabyFood.catOfName('5倍がゆ'), 'ごはん');
  assert.equal(BabyFood.catOfName('未知の食材'), '野菜');
});

test('daysUntil: 指定日まであと何日か（過去は負）', () => {
  assert.equal(BabyFood.daysUntil('2026-06-09', NOW), 0);
  assert.equal(BabyFood.daysUntil('2026-06-11', NOW), 2);
  assert.equal(BabyFood.daysUntil('2026-06-07', NOW), -2);
});

test('ingFreshness: 使い切りたい日から残り日数を判定', () => {
  assert.equal(BabyFood.ingFreshness({ expire: '' }, NOW), null);
  assert.deepEqual(BabyFood.ingFreshness({ expire: '2026-06-09' }, NOW), { cls: 'b-soon', txt: '今日まで', alert: true });
  assert.deepEqual(BabyFood.ingFreshness({ expire: '2026-06-07' }, NOW), { cls: 'b-old', txt: '期限すぎ2日', alert: true });
  assert.deepEqual(BabyFood.ingFreshness({ expire: '2026-06-10' }, NOW), { cls: 'b-soon', txt: 'あと1日', alert: false });
  assert.deepEqual(BabyFood.ingFreshness({ expire: '2026-06-14' }, NOW), { cls: 'b-fresh', txt: 'あと5日', alert: false });
});

test('buildPools: カテゴリ別に分け、冷蔵→古い順に並べる', () => {
  const batches = [
    { id: '1', veg: 'にんじん', qty: 2, made: '2026-06-08', store: '冷凍', cat: '野菜' },
    { id: '2', veg: 'ブロッコリー', qty: 1, made: '2026-06-09', store: '冷蔵', cat: '野菜' },
    { id: '3', veg: '鶏ささみ', qty: 1, made: '2026-06-09', store: '冷凍', cat: 'タンパク質' },
    { id: '4', veg: 'からっぽ', qty: 0, made: '2026-06-09', store: '冷蔵', cat: '野菜' },
  ];
  const pools = BabyFood.buildPools(batches);
  assert.deepEqual(pools['野菜'].map((e) => e.veg), ['ブロッコリー', 'にんじん']); // 冷蔵が先
  assert.equal(pools['タンパク質'].length, 1);
  assert.equal(pools['ごはん'].length, 0);
});

test('planMenus: 在庫1食分から1食だけ献立を作り、在庫切れを示す', () => {
  const batches = [
    { id: 'r', veg: '5倍がゆ', qty: 1, made: '2026-06-09', store: '冷凍', cat: 'ごはん' },
    { id: 'p', veg: '鶏ささみ', qty: 1, made: '2026-06-09', store: '冷凍', cat: 'タンパク質' },
    { id: 'v', veg: 'にんじん', qty: 1, made: '2026-06-09', store: '冷蔵', cat: '野菜' },
  ];
  const r = BabyFood.planMenus(batches, { perDay: 1 });
  assert.equal(r.hasStock, true);
  assert.equal(r.total, 1);
  assert.equal(r.ranOut, true);
  assert.equal(r.days.length, 1);
  const meal = r.days[0][0];
  assert.equal(meal.rice.veg, '5倍がゆ');
  assert.equal(meal.protein.veg, '鶏ささみ');
  assert.deepEqual(meal.veg.map((v) => v.veg), ['にんじん']);
  // 元の在庫は変更されない
  assert.equal(batches[0].qty, 1);
});

test('planMenus: 在庫が無ければ hasStock=false', () => {
  const r = BabyFood.planMenus([], { perDay: 2 });
  assert.equal(r.hasStock, false);
  assert.equal(r.total, 0);
});

test('freshness: 期限の直接入力があればそちらを優先する', () => {
  const withExpire = (expire) => batch({ made: '2026-06-09', store: '冷蔵', expire });
  assert.deepEqual(BabyFood.freshness(withExpire('2026-06-07'), NOW), { cls: 'b-old', txt: '期限すぎ2日', alert: true });
  assert.deepEqual(BabyFood.freshness(withExpire('2026-06-09'), NOW), { cls: 'b-soon', txt: '今日まで', alert: true });
  assert.deepEqual(BabyFood.freshness(withExpire('2026-06-10'), NOW), { cls: 'b-soon', txt: 'あと1日', alert: false });
  assert.deepEqual(BabyFood.freshness(withExpire('2026-06-14'), NOW), { cls: 'b-fresh', txt: 'あと5日', alert: false });
  // expire が空文字なら従来どおり（作った日＋保存方法）
  assert.equal(BabyFood.freshness(batch({ made: '2026-06-09', store: '冷蔵', expire: '' }), NOW).txt, 'つくりたて');
});

test('effectiveExpiry: expire優先、無ければ made+保存方法の限度日数', () => {
  assert.equal(BabyFood.effectiveExpiry(batch({ expire: '2026-06-13' })), '2026-06-13');
  assert.equal(BabyFood.effectiveExpiry(batch({ made: '2026-06-09', store: '冷蔵', expire: '' })), '2026-06-11'); // +2
  assert.equal(BabyFood.effectiveExpiry(batch({ made: '2026-06-09', store: '冷凍', expire: '' })), '2026-06-16'); // +7
  // 月またぎも正しく計算
  assert.equal(BabyFood.effectiveExpiry(batch({ made: '2026-06-30', store: '冷蔵', expire: '' })), '2026-07-02');
});

test('isRice: ごはん系の名前を判定する', () => {
  assert.equal(BabyFood.isRice('5倍がゆ'), true);
  assert.equal(BabyFood.isRice('軟飯'), true);
  assert.equal(BabyFood.isRice('ひとくちおにぎりご飯'), true);
  assert.equal(BabyFood.isRice('雑炊'), true);
  assert.equal(BabyFood.isRice('にんじん'), false);
  assert.equal(BabyFood.isRice('鶏ささみ'), false);
});

test('countCompleteMenus: ごはん1＋タンパク質1＋野菜3 がそろう回数を数える', () => {
  const batches = [
    { id: 'r', veg: '5倍がゆ', qty: 2, made: '2026-06-09', store: '冷凍', cat: 'ごはん' },
    { id: 'p', veg: '鶏ささみ', qty: 2, made: '2026-06-09', store: '冷凍', cat: 'タンパク質' },
    { id: 'v1', veg: 'にんじん', qty: 2, made: '2026-06-09', store: '冷蔵', cat: '野菜' },
    { id: 'v2', veg: 'かぼちゃ', qty: 2, made: '2026-06-09', store: '冷蔵', cat: '野菜' },
    { id: 'v3', veg: 'ほうれん草', qty: 2, made: '2026-06-09', store: '冷蔵', cat: '野菜' },
  ];
  // 2巡目も r/p/野菜3種がそろうので 2回分
  assert.equal(BabyFood.countCompleteMenus(batches), 2);
  // 野菜が2種しか無ければ「そろう」献立は作れない
  const fewVeg = batches.filter((b) => b.id !== 'v3');
  assert.equal(BabyFood.countCompleteMenus(fewVeg), 0);
  // 元の在庫は変更されない
  assert.equal(batches[0].qty, 2);
});

test('stockOutlook: 食数・日数・ボトルネックを返す', () => {
  const batches = [
    { veg: '5倍がゆ', qty: 4, made: '2026-06-09', store: '冷凍', cat: 'ごはん' },
    { veg: '鶏ささみ', qty: 1, made: '2026-06-09', store: '冷凍', cat: 'タンパク質' }, // 律速
    { veg: 'にんじん', qty: 3, made: '2026-06-09', store: '冷蔵', cat: '野菜' },
    { veg: 'かぼちゃ', qty: 3, made: '2026-06-09', store: '冷蔵', cat: '野菜' },
    { veg: 'ほうれん草', qty: 3, made: '2026-06-09', store: '冷蔵', cat: '野菜' },
  ];
  const o = BabyFood.stockOutlook(batches, { perDay: 2, vegPerMeal: 3 });
  assert.equal(o.meals, 1); // タンパク質1が律速
  assert.equal(o.bottleneck, 'タンパク質');
  assert.equal(o.perCat['野菜'], 3); // 9個 /3
  assert.equal(o.days, 0); // floor(1/2)
});

test('planShortfall + classifyShortfall: 在庫超過分を買い物/作り置きに振り分け', () => {
  const batches = [{ veg: 'にんじん', qty: 1, made: '2026-06-09', store: '冷蔵', cat: '野菜' }];
  const plan = {
    days: [
      { date: '2026-06-15', confirmed: false, meals: [
        { id: 'm1', slot: '朝', items: [{ veg: 'にんじん', qty: 2 }, { veg: '鶏ささみ', qty: 1 }] },
      ] },
    ],
  };
  const short = BabyFood.planShortfall(plan, batches);
  // にんじんは在庫1に対し2必要→不足1、鶏ささみは在庫0→不足1
  const byVeg = Object.fromEntries(short.map((s) => [s.veg, s.qty]));
  assert.equal(byVeg['にんじん'], 1);
  assert.equal(byVeg['鶏ささみ'], 1);
  // にんじんは食材タブに生在庫あり→作り置き、鶏ささみは無し→買い物
  const cls = BabyFood.classifyShortfall(short, [{ name: 'にんじん', qty: 1 }]);
  assert.deepEqual(cls.prep.map((x) => x.veg), ['にんじん']);
  assert.deepEqual(cls.buy.map((x) => x.veg), ['鶏ささみ']);
});

test('planShortfall: あげた済み(servedMealId)の食事は除外', () => {
  const plan = { days: [{ date: '2026-06-15', meals: [{ id: 'm', slot: '朝', servedMealId: 'x', items: [{ veg: 'にんじん', qty: 5 }] }] }] };
  assert.equal(BabyFood.planShortfall(plan, []).length, 0);
});

test('reserveConfirmed: 確定済みの在庫品を控除した残りを返す', () => {
  const batches = [{ id: 'a', veg: 'にんじん', qty: 3, made: '2026-06-09', store: '冷蔵', cat: '野菜' }];
  const plan = { days: [
    { date: '2026-06-15', confirmed: true, meals: [{ id: 'm', slot: '朝', items: [{ veg: 'にんじん', qty: 2 }] }] },
    { date: '2026-06-16', confirmed: false, meals: [{ id: 'n', slot: '朝', items: [{ veg: 'にんじん', qty: 1 }] }] },
  ] };
  const left = BabyFood.reserveConfirmed(batches, plan);
  assert.equal(left.find((b) => b.id === 'a').qty, 1); // 3 - 2(確定のみ)
});

test('recentlyUnusedVegs: 直近に使っていない野菜を返す', () => {
  const NOW2 = '2026-06-20T10:00:00';
  const meals = [
    { ts: new Date('2026-06-19T08:00:00').getTime(), items: [{ veg: 'にんじん', qty: 1 }] }, // 最近使った
    { ts: new Date('2026-06-01T08:00:00').getTime(), items: [{ veg: 'トマト', qty: 1 }] }, // 19日前
  ];
  const presets = ['にんじん', 'トマト', 'かぼちゃ'];
  const r = BabyFood.recentlyUnusedVegs(meals, presets, { now: NOW2, days: 14 });
  assert.deepEqual(r.sort(), ['かぼちゃ', 'トマト']); // にんじんは除外
});

test('buildPlan: 在庫から日別計画を作り、ピン留めと確定日を保持', () => {
  const batches = [
    { veg: '5倍がゆ', qty: 2, made: '2026-06-09', store: '冷凍', cat: 'ごはん' },
    { veg: '鶏ささみ', qty: 2, made: '2026-06-09', store: '冷凍', cat: 'タンパク質' },
    { veg: 'にんじん', qty: 2, made: '2026-06-09', store: '冷蔵', cat: '野菜' },
  ];
  const plan = BabyFood.buildPlan(batches, { perDay: 1, horizonDays: 3, startDate: '2026-06-15', uid: () => 'id' });
  assert.equal(plan.days.length, 3);
  assert.equal(plan.days[0].date, '2026-06-15');
  assert.equal(plan.days[2].date, '2026-06-17');
  assert.ok(plan.days[0].meals[0].items.length >= 1);
  // ピン留め＋確定の保持
  const existing = {
    days: [
      { date: '2026-06-15', confirmed: true, meals: [{ id: 'k', slot: '朝', items: [{ veg: 'おかゆ', qty: 1, pinned: false }] }] },
      { date: '2026-06-16', confirmed: false, meals: [{ id: 'p', slot: '朝', items: [{ veg: 'バナナ', qty: 1, pinned: true }] }] },
    ],
  };
  const plan2 = BabyFood.buildPlan(batches, { perDay: 1, horizonDays: 3, startDate: '2026-06-15', uid: () => 'id' }, existing);
  assert.equal(plan2.days[0].confirmed, true); // 確定日は丸ごと保持
  assert.equal(plan2.days[0].meals[0].items[0].veg, 'おかゆ');
  assert.ok(plan2.days[1].meals[0].items.some((i) => i.veg === 'バナナ' && i.pinned)); // ピン留めは残る
});

test('buildForecast: 作り置き予定がその日から見通しに反映される', () => {
  const batches = [
    { veg: '5倍がゆ', qty: 2, made: '2026-06-09', store: '冷凍', cat: 'ごはん' },
    { veg: '鶏ささみ', qty: 2, made: '2026-06-09', store: '冷凍', cat: 'タンパク質' },
  ]; // 野菜は在庫ゼロ
  const prep = [
    { id: 'p1', date: '2026-06-15', veg: 'にんじん', qty: 3, store: '冷蔵', cat: '野菜' },
    { id: 'p2', date: '2026-06-17', veg: 'かぼちゃ', qty: 3, store: '冷蔵', cat: '野菜' },
  ];
  const fc = BabyFood.buildForecast(batches, prep, { perDay: 1, horizonDays: 3, startDate: '2026-06-15', uid: () => 'id' });
  // 初日：にんじん(当日から使える)が献立に入る
  const day0veg = fc.days[0].meals[0].items.filter((i) => BabyFood.catOfName(i.veg) === '野菜').map((i) => i.veg);
  assert.ok(day0veg.includes('にんじん'));
  // かぼちゃは 06-17 からなので初日には入らない
  assert.ok(!day0veg.includes('かぼちゃ'));
  // doneBatchId 済みの予定は無視される
  const fc2 = BabyFood.buildForecast(batches, [{ id: 'p1', date: '2026-06-15', veg: 'にんじん', qty: 3, store: '冷蔵', cat: '野菜', doneBatchId: 'x' }], { perDay: 1, horizonDays: 1, startDate: '2026-06-15', uid: () => 'id' });
  const veg2 = fc2.days[0].meals[0].items.filter((i) => BabyFood.catOfName(i.veg) === '野菜');
  assert.equal(veg2.length, 0);
});

test('prepAsBatches / shoppingForPrep: 作り置きから買い物を導く', () => {
  const prep = [
    { id: 'p1', date: '2026-06-15', veg: 'だいこん', qty: 8, store: '冷蔵', cat: '野菜' },
    { id: 'p2', date: '2026-06-15', veg: 'ほうれん草', qty: 4, store: '冷蔵', cat: '野菜' },
    { id: 'p3', date: '2026-06-15', veg: 'にんじん', qty: 2, store: '冷蔵', cat: '野菜', doneBatchId: 'b' }, // 実行済みは除外
  ];
  assert.equal(BabyFood.prepAsBatches(prep).length, 2); // 実行済み除外
  const shop = BabyFood.shoppingForPrep(prep, [{ name: 'ほうれん草', qty: 1 }]);
  // ほうれん草は食材タブにあるので買い物不要、だいこんは無いので買い物
  assert.deepEqual(shop.map((s) => s.veg), ['だいこん']);
  assert.equal(shop[0].qty, 8);
});

test('planMenus: complete（そろう献立数）を含めて返す', () => {
  const batches = [
    { id: 'r', veg: '5倍がゆ', qty: 1, made: '2026-06-09', store: '冷凍', cat: 'ごはん' },
    { id: 'p', veg: '鶏ささみ', qty: 1, made: '2026-06-09', store: '冷凍', cat: 'タンパク質' },
    { id: 'v1', veg: 'にんじん', qty: 1, made: '2026-06-09', store: '冷蔵', cat: '野菜' },
    { id: 'v2', veg: 'かぼちゃ', qty: 1, made: '2026-06-09', store: '冷蔵', cat: '野菜' },
    { id: 'v3', veg: 'ほうれん草', qty: 1, made: '2026-06-09', store: '冷蔵', cat: '野菜' },
  ];
  assert.equal(BabyFood.planMenus(batches, { perDay: 1 }).complete, 1);
});
