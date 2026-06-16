/**
 * 離乳食ストック管理の純粋ロジック。
 *
 * DOM・localStorage・現在時刻に依存しない関数だけを置く。
 * 鮮度や日数の計算は now（基準日時）を引数で受け取り、テストを決定的にする。
 *
 * ブラウザでは window.BabyFood として、Node では require() で読み込める。
 *
 * ingredient（冷蔵庫の生食材）: { id, name, qty, unit, store, bought, expire, cat }
 * batch（ストック1回分）      : { id, veg, qty, made, store, cat, expire? }   made/expire は "YYYY-MM-DD"
 * meal （あげた記録）         : { id, ts, slot, items: [{ veg, qty }], furikake? }
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api; // Node（node --test / require）
  } else {
    root.BabyFood = api; // ブラウザ（window.BabyFood）
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** 食材のカテゴリ（表示順）。 */
  const CATS = [
    { key: '野菜', icon: '🥕' },
    { key: 'タンパク質', icon: '🍗' },
    { key: 'ごはん', icon: '🍚' },
  ];

  /** カテゴリごとのプリセット候補。 */
  const PRESETS_BY_CAT = {
    野菜: ['にんじん', 'ブロッコリー', 'じゃがいも', 'かぼちゃ', 'ほうれん草', 'トマト', 'だいこん', 'たまねぎ'],
    タンパク質: ['鶏ささみ', '鶏むね肉', '鶏ひき肉', 'おやき', 'とうふ', '白身魚', 'しらす', 'ツナ', '卵', '納豆'],
    ごはん: ['10倍がゆ', '7倍がゆ', '5倍がゆ', '軟飯', 'ごはん', 'パンがゆ', 'うどん'],
  };

  /** 名前 → カテゴリの逆引き表。 */
  const CAT_OF_NAME = {};
  for (const c of CATS) {
    for (const n of PRESETS_BY_CAT[c.key] || []) CAT_OF_NAME[n] = c.key;
  }

  /** 名前からカテゴリを推定する（不明は「野菜」）。 */
  function catOfName(name) {
    return CAT_OF_NAME[name] || '野菜';
  }

  /** 保存方法ごとの鮮度しきい値（日数）。 */
  const STORE_LIMITS = {
    冷蔵: { soon: 1, limit: 2 },
    冷凍: { soon: 5, limit: 7 },
  };

  /** "YYYY-MM-DD" を 0 時のローカル Date にする。 */
  function atMidnight(iso) {
    return new Date(iso + 'T00:00:00');
  }

  /** ローカル Date を "YYYY-MM-DD" にする。 */
  function fmtISO(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  /**
   * ストックの実効期限を "YYYY-MM-DD" で返す（並べ替えの基準）。
   * expire があればそれ、無ければ made + 保存方法の限度日数（冷蔵2日/冷凍7日）。
   */
  function effectiveExpiry(batch) {
    if (batch.expire) return batch.expire;
    const limit = (STORE_LIMITS[batch.store] || STORE_LIMITS['冷蔵']).limit;
    const d = atMidnight(batch.made);
    d.setDate(d.getDate() + limit);
    return fmtISO(d);
  }

  /** now（省略時は現在時刻）を 0 時に丸めた Date。 */
  function baseDay(now) {
    const base = now ? new Date(now) : new Date();
    base.setHours(0, 0, 0, 0);
    return base;
  }

  /** made からの経過日数（日付単位）。now 省略時は現在時刻。 */
  function daysSince(madeISO, now) {
    return Math.round((baseDay(now) - atMidnight(madeISO)) / 86400000);
  }

  /** 指定日まであと何日か（過去なら負）。now 省略時は現在時刻。 */
  function daysUntil(targetISO, now) {
    return Math.round((atMidnight(targetISO) - baseDay(now)) / 86400000);
  }

  /**
   * ストックの鮮度を判定する。{ cls, txt, alert } を返す。
   * expire（期限の直接入力）があればその日付を優先し、
   * 無ければ作った日と保存方法（冷蔵2日/冷凍7日）から判定する。
   */
  function freshness(batch, now) {
    if (batch.expire) {
      const d = daysUntil(batch.expire, now);
      if (d < 0) return { cls: 'b-old', txt: `期限すぎ${-d}日`, alert: true };
      if (d === 0) return { cls: 'b-soon', txt: '今日まで', alert: true };
      if (d <= 1) return { cls: 'b-soon', txt: `あと${d}日`, alert: false };
      return { cls: 'b-fresh', txt: `あと${d}日`, alert: false };
    }
    const d = daysSince(batch.made, now);
    const { soon, limit } = STORE_LIMITS[batch.store] || STORE_LIMITS['冷蔵'];
    if (d > limit) return { cls: 'b-old', txt: '期限すぎ', alert: true };
    if (d >= soon) return { cls: 'b-soon', txt: '早めに', alert: false };
    return { cls: 'b-fresh', txt: d <= 0 ? 'つくりたて' : '新しい', alert: false };
  }

  /** 生食材の鮮度（使い切りたい日が基準）。expire 未設定なら null。 */
  function ingFreshness(ing, now) {
    if (!ing.expire) return null;
    const d = daysUntil(ing.expire, now);
    if (d < 0) return { cls: 'b-old', txt: `期限すぎ${-d}日`, alert: true };
    if (d === 0) return { cls: 'b-soon', txt: '今日まで', alert: true };
    if (d <= 2) return { cls: 'b-soon', txt: `あと${d}日`, alert: false };
    return { cls: 'b-fresh', txt: `あと${d}日`, alert: false };
  }

  /** 「今日 / 昨日 / N日前」の表示。 */
  function madeLabel(madeISO, now) {
    const d = daysSince(madeISO, now);
    if (d <= 0) return '今日';
    if (d === 1) return '昨日';
    return d + '日前';
  }

  /** 在庫のある batch を野菜ごとにまとめる。各配列は古い順。 */
  function groupBatches(batches) {
    const map = {};
    for (const b of batches) {
      if (b.qty > 0) {
        (map[b.veg] = map[b.veg] || []).push(b);
      }
    }
    for (const arr of Object.values(map)) {
      arr.sort((a, b) => a.made.localeCompare(b.made));
    }
    return map;
  }

  /** ストックのサマリー（種類数・合計個数・期限すぎ数）。 */
  function summarize(batches, now) {
    const live = batches.filter((b) => b.qty > 0);
    const types = new Set(live.map((b) => b.veg)).size;
    const total = live.reduce((s, b) => s + b.qty, 0);
    const alert = live.filter((b) => freshness(b, now).alert).length;
    return { types, total, alert };
  }

  /** ある野菜の在庫合計。 */
  function totalOf(batches, veg) {
    return batches
      .filter((b) => b.veg === veg && b.qty > 0)
      .reduce((s, b) => s + b.qty, 0);
  }

  /**
   * あげた分を在庫から引く（古いストックから先に＝先入れ先出し）。
   * 元の配列は変更せず、新しい batches 配列を返す。
   */
  function deductFIFO(batches, items) {
    const next = batches.map((b) => ({ ...b }));
    for (const item of items) {
      let need = item.qty;
      const arr = next
        .filter((b) => b.veg === item.veg && b.qty > 0)
        .sort((a, b) => a.made.localeCompare(b.made));
      for (const b of arr) {
        if (need <= 0) break;
        const take = Math.min(b.qty, need);
        b.qty -= take;
        need -= take;
      }
    }
    return next;
  }

  /**
   * 取り消し用：あげた分を在庫に戻す。
   * 同じ野菜の一番新しい batch に戻し、無ければ新規 batch を作る。
   * options.uid / options.today を注入できる（省略時は実時刻）。
   */
  function restoreToStock(batches, items, options) {
    const opts = options || {};
    const uid = opts.uid || (() => Math.random().toString(36).slice(2, 10));
    const today =
      opts.today ||
      (() => {
        const d = new Date();
        return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
          .toISOString()
          .slice(0, 10);
      })();
    const next = batches.map((b) => ({ ...b }));
    for (const item of items) {
      const arr = next
        .filter((b) => b.veg === item.veg)
        .sort((a, b) => b.made.localeCompare(a.made));
      if (arr.length > 0) {
        arr[0].qty += item.qty;
      } else {
        next.push({
          id: uid(),
          veg: item.veg,
          qty: item.qty,
          made: today,
          store: '冷蔵',
          cat: catOfName(item.veg),
        });
      }
    }
    return next;
  }

  /** 時間帯（朝/昼/晩）を時刻から決める。 */
  function slotFromHour(hour) {
    if (hour >= 4 && hour < 11) return '朝';
    if (hour >= 11 && hour < 16) return '昼';
    return '晩';
  }

  /** ごはん系の名前か（ふりかけの付随表示などに使う）。 */
  function isRice(name) {
    return catOfName(name) === 'ごはん' || /ごはん|ご飯|がゆ|軟飯|おじや|雑炊/.test(name);
  }

  /**
   * 同じ野菜の数量を合算してまとめる（初めて出てきた順を保つ）。
   * 例: [人参2, おかゆ1, 人参1] → [人参3, おかゆ1]
   */
  function mergeItems(items) {
    const order = [];
    const map = {};
    for (const it of items) {
      if (map[it.veg] == null) {
        map[it.veg] = it.qty;
        order.push(it.veg);
      } else {
        map[it.veg] += it.qty;
      }
    }
    return order.map((veg) => ({ veg, qty: map[veg] }));
  }

  /**
   * 在庫をカテゴリごとの「使える分」プールにする。
   * 冷蔵を先に、同じ保存方法なら古い順（先に使う）で並べる。
   * 各要素: { veg, store, made, n }（n は残り個数）
   */
  function buildPools(batches) {
    const pools = { 野菜: [], タンパク質: [], ごはん: [] };
    for (const b of batches) {
      if (b.qty <= 0) continue;
      const cat = b.cat || catOfName(b.veg);
      (pools[cat] = pools[cat] || []).push({ veg: b.veg, store: b.store, made: b.made, n: b.qty });
    }
    for (const k in pools) {
      pools[k].sort(
        (a, b) => (a.store === '冷蔵' ? 0 : 1) - (b.store === '冷蔵' ? 0 : 1) || a.made.localeCompare(b.made)
      );
    }
    return pools;
  }

  /** プールから1つ取り出す（取り出した要素を返し、無ければ null）。 */
  function takeOne(pool, avoidHard, avoidSoft) {
    if (!pool) return null;
    avoidHard = avoidHard || [];
    avoidSoft = avoidSoft || [];
    // 1) 同じ食事で未使用 かつ 前の食事と違うものを優先
    let i = pool.findIndex((e) => e.n > 0 && !avoidHard.includes(e.veg) && !avoidSoft.includes(e.veg));
    // 2) なければ 同じ食事で未使用ならOK（前の食事と同じでも可）
    if (i < 0) i = pool.findIndex((e) => e.n > 0 && !avoidHard.includes(e.veg));
    if (i < 0) return null;
    pool[i].n--;
    return pool[i];
  }

  /**
   * ごはん1＋タンパク質1＋野菜3（別々の3種）が「そろう」献立を、
   * いまの在庫からいくつ作れるか数える。元の batches は変更しない。
   */
  function countCompleteMenus(batches, options) {
    const vegPerMeal = (options || {}).vegPerMeal || 3;
    const pools = buildPools(batches);
    let count = 0;
    for (;;) {
      const rice = takeOne(pools['ごはん'], [], []);
      const protein = takeOne(pools['タンパク質'], [], []);
      const used = [];
      let veg = 0;
      for (let k = 0; k < vegPerMeal; k++) {
        const p = takeOne(pools['野菜'], used, []);
        if (p) {
          veg++;
          used.push(p.veg);
        }
      }
      if (rice && protein && veg === vegPerMeal) count++;
      else break;
    }
    return count;
  }

  /**
   * いまの在庫から、これからのおすすめ献立（ごはん1＋タンパク質1＋野菜数品）を組む。
   * 毎食なるべく違う組み合わせにする。元の batches は変更しない。
   * options: { perDay=2, maxDays=4, vegPerMeal=3 }
   * 返り値: { days: [[{rice,protein,veg:[]}]], ranOut, total, complete, hasStock }
   */
  function planMenus(batches, options) {
    const opts = options || {};
    const per = opts.perDay || 2;
    const maxDays = opts.maxDays || 4;
    const vegPerMeal = opts.vegPerMeal || 3;
    const pools = buildPools(batches);
    const days = [];
    let ranOut = false;
    let prev = { rice: null, protein: null, veg: [] };
    for (let d = 0; d < maxDays && !ranOut; d++) {
      const meals = [];
      for (let m = 0; m < per; m++) {
        const rice = takeOne(pools['ごはん'], [], prev.rice ? [prev.rice] : []);
        const protein = takeOne(pools['タンパク質'], [], prev.protein ? [prev.protein] : []);
        const veg = [];
        const used = [];
        for (let k = 0; k < vegPerMeal; k++) {
          const pick = takeOne(pools['野菜'], used, prev.veg);
          if (!pick) break;
          veg.push(pick);
          used.push(pick.veg);
        }
        if (!rice && !protein && !veg.length) {
          ranOut = true;
          break;
        }
        meals.push({ rice, protein, veg });
        prev = { rice: rice ? rice.veg : null, protein: protein ? protein.veg : null, veg: veg.map((v) => v.veg) };
      }
      if (meals.length) days.push(meals);
    }
    const total = days.reduce((s, m) => s + m.length, 0);
    return {
      days,
      ranOut,
      total,
      complete: countCompleteMenus(batches, { vegPerMeal }),
      hasStock: batches.some((b) => b.qty > 0),
    };
  }

  /* ================= こんだて計画（plan） ================= */

  /** プールから指定の野菜を qty 分だけ消費する（在庫の見通し計算用）。 */
  function consumeFromPool(pools, veg, qty) {
    const cat = catOfName(veg);
    const arr = pools[cat];
    if (!arr) return;
    let need = qty;
    for (const e of arr) {
      if (need <= 0) break;
      if (e.veg === veg) {
        const take = Math.min(e.n, need);
        e.n -= take;
        need -= take;
      }
    }
  }

  /** 1食からカテゴリ別の代表（前食との重複回避に使う）を取り出す。 */
  function mealPrev(meal) {
    const items = (meal && meal.items) || [];
    const r = items.find((i) => catOfName(i.veg) === 'ごはん');
    const p = items.find((i) => catOfName(i.veg) === 'タンパク質');
    const v = items.filter((i) => catOfName(i.veg) === '野菜').map((i) => i.veg);
    return { rice: r ? r.veg : null, protein: p ? p.veg : null, veg: v };
  }

  /**
   * 在庫の見通し。{ meals, days, bottleneck, perCat } を返す。
   * meals = ごはん1＋タンパク質1＋野菜vegPerMeal がそろう食数（カテゴリの最少が律速）。
   * bottleneck = 最初に尽きるカテゴリ。perCat = カテゴリ別に作れる食数。
   */
  function stockOutlook(batches, options) {
    const opts = options || {};
    const vegPerMeal = opts.vegPerMeal || 3;
    const perDay = opts.perDay || 2;
    const pools = buildPools(batches);
    const sum = (cat) => (pools[cat] || []).reduce((s, e) => s + e.n, 0);
    const perCat = {
      ごはん: sum('ごはん'),
      タンパク質: sum('タンパク質'),
      野菜: Math.floor(sum('野菜') / vegPerMeal),
    };
    let bottleneck = 'ごはん';
    let min = Infinity;
    for (const k of ['ごはん', 'タンパク質', '野菜']) {
      if (perCat[k] < min) {
        min = perCat[k];
        bottleneck = k;
      }
    }
    const meals = Math.max(0, min);
    return { meals, days: Math.floor(meals / perDay), bottleneck, perCat };
  }

  /**
   * 在庫から数日分のこんだて計画を組む。在庫が尽きた分の枠は空のままにする
   * （在庫に無いものは画面側で手動追加できる）。
   * 既存計画の「ピン留め項目」と「確定済みの日」は保持する。元の batches は変更しない。
   * options: { perDay, horizonDays, vegPerMeal=3, startDate:"YYYY-MM-DD", uid }
   */
  function buildPlan(batches, options, existing) {
    const opts = options || {};
    const perDay = opts.perDay || 2;
    const horizon = opts.horizonDays || 7;
    const VEG = opts.vegPerMeal || 3;
    const uid = opts.uid || (() => Math.random().toString(36).slice(2, 10));
    const exByDate = {};
    ((existing && existing.days) || []).forEach((d) => (exByDate[d.date] = d));
    const pools = buildPools(batches);
    const startDate = atMidnight(opts.startDate);
    const days = [];
    let prev = { rice: null, protein: null, veg: [] };
    for (let di = 0; di < horizon; di++) {
      const dd = new Date(startDate);
      dd.setDate(dd.getDate() + di);
      const date = fmtISO(dd);
      const ex = exByDate[date];
      // 確定済みの日はそのまま保持し、在庫だけ先に消費しておく。
      if (ex && ex.confirmed) {
        (ex.meals || []).forEach((m) => (m.items || []).forEach((it) => consumeFromPool(pools, it.veg, it.qty || 1)));
        days.push(ex);
        const last = (ex.meals || [])[(ex.meals || []).length - 1];
        if (last) prev = mealPrev(last);
        continue;
      }
      const meals = [];
      for (let mi = 0; mi < perDay; mi++) {
        const exMeal = ex && ex.meals ? ex.meals[mi] : null;
        const slot = exMeal ? exMeal.slot : ['朝', '昼', '晩'][mi % 3];
        const pinned = exMeal ? (exMeal.items || []).filter((i) => i.pinned) : [];
        pinned.forEach((it) => consumeFromPool(pools, it.veg, it.qty || 1));
        const items = pinned.map((i) => ({ veg: i.veg, qty: i.qty || 1, pinned: true }));
        const hasRice = items.some((i) => catOfName(i.veg) === 'ごはん');
        const hasProt = items.some((i) => catOfName(i.veg) === 'タンパク質');
        if (!hasRice) {
          const r = takeOne(pools['ごはん'], [], prev.rice ? [prev.rice] : []);
          if (r) items.push({ veg: r.veg, qty: 1, pinned: false });
        }
        if (!hasProt) {
          const p = takeOne(pools['タンパク質'], [], prev.protein ? [prev.protein] : []);
          if (p) items.push({ veg: p.veg, qty: 1, pinned: false });
        }
        const used = items.filter((i) => catOfName(i.veg) === '野菜').map((i) => i.veg);
        for (let k = used.length; k < VEG; k++) {
          const pick = takeOne(pools['野菜'], used, prev.veg);
          if (!pick) break;
          items.push({ veg: pick.veg, qty: 1, pinned: false });
          used.push(pick.veg);
        }
        meals.push({
          id: (exMeal && exMeal.id) || uid(),
          slot,
          items,
          furikake: exMeal ? exMeal.furikake || '' : '',
          servedMealId: exMeal ? exMeal.servedMealId || null : null,
        });
        prev = mealPrev(meals[meals.length - 1]);
      }
      days.push({ date, confirmed: false, meals });
    }
    return { perDay, horizonDays: horizon, days };
  }

  /**
   * 計画が在庫を超えて必要とする分（＝不足）を野菜ごとに集計する。
   * 古い日から順に在庫を引き当てる。すでに「あげた」食事は除く。
   * options: { onlyConfirmed }
   * 返り値: [{ veg, qty, cat }]
   */
  function planShortfall(plan, batches, options) {
    const opts = options || {};
    const avail = {};
    (batches || []).forEach((b) => {
      if (b.qty > 0) avail[b.veg] = (avail[b.veg] || 0) + b.qty;
    });
    const short = {};
    for (const d of (plan && plan.days) || []) {
      if (opts.onlyConfirmed && !d.confirmed) continue;
      for (const m of d.meals || []) {
        if (m.servedMealId) continue;
        for (const it of m.items || []) {
          const need = it.qty || 1;
          const have = avail[it.veg] || 0;
          const use = Math.min(have, need);
          avail[it.veg] = have - use;
          const lack = need - use;
          if (lack > 0) {
            if (!short[it.veg]) short[it.veg] = { veg: it.veg, qty: 0, cat: catOfName(it.veg) };
            short[it.veg].qty += lack;
          }
        }
      }
    }
    return Object.values(short);
  }

  /**
   * 不足を「買い物（生の在庫が無い）」と「作り置き（食材タブに生在庫あり）」に振り分ける。
   * 返り値: { buy: [...], prep: [...] }（各要素に reason を付与）
   */
  function classifyShortfall(shortfalls, ingredients) {
    const ingNames = new Set((ingredients || []).filter((i) => i.qty > 0).map((i) => i.name));
    const buy = [];
    const prep = [];
    for (const s of shortfalls || []) {
      if (ingNames.has(s.veg)) prep.push({ ...s, reason: '食材タブに在庫あり' });
      else buy.push({ ...s, reason: s.cat === '野菜' ? '生の在庫なし' : '在庫なし' });
    }
    return { buy, prep };
  }

  /** 確定済みの日の在庫品を「予約」として控除した残り batches を返す（元配列は不変）。 */
  function reserveConfirmed(batches, plan) {
    const items = [];
    ((plan && plan.days) || []).forEach((d) => {
      if (!d.confirmed) return;
      (d.meals || []).forEach((m) => {
        if (m.servedMealId) return;
        (m.items || []).forEach((it) => items.push({ veg: it.veg, qty: it.qty || 1 }));
      });
    });
    return deductFIFO(batches, items);
  }

  /** 直近 days 日であげていない野菜（presets のうち）を返す＝買い物の候補。 */
  function recentlyUnusedVegs(meals, presets, options) {
    const opts = options || {};
    const span = opts.days || 14;
    const base = opts.now ? new Date(opts.now) : new Date();
    base.setHours(0, 0, 0, 0);
    const cutoff = base.getTime() - span * 86400000;
    const lastUsed = {};
    (meals || []).forEach((m) => {
      (m.items || []).forEach((it) => {
        if (!lastUsed[it.veg] || m.ts > lastUsed[it.veg]) lastUsed[it.veg] = m.ts;
      });
    });
    return (presets || []).filter((v) => lastUsed[v] == null || lastUsed[v] < cutoff);
  }

  return {
    CATS,
    PRESETS_BY_CAT,
    CAT_OF_NAME,
    catOfName,
    STORE_LIMITS,
    daysSince,
    daysUntil,
    effectiveExpiry,
    freshness,
    ingFreshness,
    madeLabel,
    groupBatches,
    summarize,
    totalOf,
    deductFIFO,
    restoreToStock,
    slotFromHour,
    isRice,
    mergeItems,
    buildPools,
    countCompleteMenus,
    planMenus,
    stockOutlook,
    buildPlan,
    planShortfall,
    classifyShortfall,
    reserveConfirmed,
    recentlyUnusedVegs,
  };
});
