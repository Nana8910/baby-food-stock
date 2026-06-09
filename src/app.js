/**
 * 画面とのつなぎ込み。
 * 状態は localStorage に保存し、純粋ロジックは window.BabyFood に任せる。
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'baby-food-records';
  const {
    REACTION_LABELS,
    validateInput,
    createRecord,
    addRecord,
    removeRecord,
    sortByDateDesc,
    summarize,
  } = window.BabyFood;

  const form = document.getElementById('record-form');
  const errorEl = document.getElementById('form-error');
  const listEl = document.getElementById('record-list');
  const emptyEl = document.getElementById('empty-message');
  const summaryEl = document.getElementById('summary');

  let records = load();

  /** localStorage から記録を読み込む。壊れていれば空配列。 */
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  }

  function showError(message) {
    errorEl.textContent = message;
    errorEl.hidden = !message;
  }

  function render() {
    const sorted = sortByDateDesc(records);
    listEl.innerHTML = '';

    for (const record of sorted) {
      const li = document.createElement('li');
      li.className = 'record-item';

      const badge = document.createElement('span');
      badge.className = `badge ${record.reaction}`;
      badge.textContent = REACTION_LABELS[record.reaction] || record.reaction;

      const main = document.createElement('div');
      main.className = 'record-main';

      const food = document.createElement('div');
      food.className = 'record-food';
      food.textContent = record.food;

      const meta = document.createElement('div');
      meta.className = 'record-meta';
      meta.textContent = record.date;

      main.append(food, meta);

      if (record.memo) {
        const memo = document.createElement('div');
        memo.className = 'record-memo';
        memo.textContent = record.memo;
        main.append(memo);
      }

      const del = document.createElement('button');
      del.className = 'delete-btn';
      del.type = 'button';
      del.setAttribute('aria-label', `${record.food} の記録を削除`);
      del.textContent = '×';
      del.addEventListener('click', () => {
        records = removeRecord(records, record.id);
        save();
        render();
      });

      li.append(badge, main, del);
      listEl.append(li);
    }

    const counts = summarize(records);
    emptyEl.hidden = counts.total > 0;
    summaryEl.textContent =
      counts.total > 0
        ? `合計 ${counts.total} 件（食べられた ${counts.ok} ・様子見 ${counts.watch} ・合わなかった ${counts.ng}）`
        : '';
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = {
      food: form.food.value,
      date: form.date.value,
      reaction: form.reaction.value,
      memo: form.memo.value,
    };

    const errors = validateInput(input);
    if (errors.length > 0) {
      showError(errors.join(' '));
      return;
    }

    showError('');
    records = addRecord(records, createRecord(input));
    save();
    render();

    form.reset();
    form.food.focus();
  });

  // 今日の日付を初期値にしておく。
  form.date.value = new Date().toISOString().slice(0, 10);
  render();
})();
