/**
 * 離乳食ストック管理の純粋ロジック。
 *
 * DOM・localStorage・現在時刻に依存しない関数だけを置く。
 * 鮮度や日数の計算は now（基準日時）を引数で受け取り、テストを決定的にする。
 *
 * ブラウザでは window.BabyFood として、Node では require() で読み込める。
 *
 * batch（ストック1回分）: { id, veg, qty, made, store }   made は "YYYY-MM-DD"
 * meal （あげた記録）   : { id, ts, slot, items: [{ veg, qty }] }
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

  /** 保存方法ごとの鮮度しきい値（日数）。 */
  const STORE_LIMITS = {
    冷蔵: { soon: 1, limit: 2 },
    冷凍: { soon: 5, limit: 7 },
  };

  /** "YYYY-MM-DD" を 0 時のローカル Date にする。 */
  function atMidnight(iso) {
    return new Date(iso + 'T00:00:00');
  }

  /** made からの経過日数（日付単位）。now 省略時は現在時刻。 */
  function daysSince(madeISO, now) {
    const base = now ? new Date(now) : new Date();
    base.setHours(0, 0, 0, 0);
    const made = atMidnight(madeISO);
    return Math.round((base - made) / 86400000);
  }

  /** ストックの鮮度を判定する。{ cls, txt, alert } を返す。 */
  function freshness(batch, now) {
    const d = daysSince(batch.made, now);
    const { soon, limit } = STORE_LIMITS[batch.store] || STORE_LIMITS['冷蔵'];
    if (d > limit) return { cls: 'b-old', txt: '期限すぎ', alert: true };
    if (d >= soon) return { cls: 'b-soon', txt: '早めに', alert: false };
    return { cls: 'b-fresh', txt: d <= 0 ? 'つくりたて' : '新しい', alert: false };
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
        next.push({ id: uid(), veg: item.veg, qty: item.qty, made: today, store: '冷蔵' });
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

  return {
    STORE_LIMITS,
    daysSince,
    freshness,
    madeLabel,
    groupBatches,
    summarize,
    totalOf,
    deductFIFO,
    restoreToStock,
    slotFromHour,
    mergeItems,
  };
});
