/**
 * 離乳食記録の純粋ロジック。
 *
 * UI や localStorage に依存しない関数だけを置く。
 * ブラウザでは window.BabyFood として、Node では require() で読み込める。
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

  /** 食べたときの反応。UI のラベルと対応する。 */
  const REACTIONS = ['ok', 'watch', 'ng'];

  const REACTION_LABELS = {
    ok: '食べられた',
    watch: '様子見',
    ng: '合わなかった',
  };

  /**
   * 入力内容を検証し、問題があればメッセージの配列を返す。
   * 問題がなければ空配列。
   */
  function validateInput(input) {
    const errors = [];
    const food = (input && input.food ? String(input.food) : '').trim();
    if (!food) {
      errors.push('食材名を入力してください。');
    }
    if (!input || !input.date) {
      errors.push('日付を入力してください。');
    }
    if (!input || !REACTIONS.includes(input.reaction)) {
      errors.push('反応を選択してください。');
    }
    return errors;
  }

  /**
   * 検証済みの入力から記録オブジェクトを作る。
   * @param {function} [idGenerator] 一意な id を返す関数（省略時は時刻＋乱数）。
   * @throws 入力が不正な場合は Error。
   */
  function createRecord(input, idGenerator) {
    const errors = validateInput(input);
    if (errors.length > 0) {
      throw new Error(errors.join(' '));
    }
    const genId =
      idGenerator || (() => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    return {
      id: genId(),
      food: String(input.food).trim(),
      date: input.date,
      reaction: input.reaction,
      memo: input.memo ? String(input.memo).trim() : '',
    };
  }

  /** 記録を追加した新しい配列を返す（元の配列は変更しない）。 */
  function addRecord(records, record) {
    return records.concat([record]);
  }

  /** 指定 id を除いた新しい配列を返す。 */
  function removeRecord(records, id) {
    return records.filter((r) => r.id !== id);
  }

  /** 日付の新しい順に並べた新しい配列を返す。 */
  function sortByDateDesc(records) {
    return records
      .slice()
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }

  /** 反応ごとの件数を集計する。 */
  function summarize(records) {
    const counts = { ok: 0, watch: 0, ng: 0, total: records.length };
    for (const r of records) {
      if (counts[r.reaction] !== undefined) {
        counts[r.reaction] += 1;
      }
    }
    return counts;
  }

  return {
    REACTIONS,
    REACTION_LABELS,
    validateInput,
    createRecord,
    addRecord,
    removeRecord,
    sortByDateDesc,
    summarize,
  };
});
