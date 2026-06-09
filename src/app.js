/**
 * 画面とのつなぎ込み。
 * 状態は localStorage に保存し、計算ロジックは window.BabyFood に任せる。
 *
 * batch: { id, veg, qty, made, store }
 * meal : { id, ts, slot, items: [{ veg, qty }] }
 */
(function () {
  'use strict';

  const {
    freshness,
    madeLabel,
    groupBatches,
    summarize,
    deductFIFO,
    restoreToStock,
    slotFromHour,
    mergeItems,
  } = window.BabyFood;

  const KEY = 'babyfood:state:v1';

  /* ---------- 状態 ---------- */
  let state = { batches: [], meals: [] };

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) state = JSON.parse(raw);
    } catch (e) {
      /* 壊れていれば初期状態のまま */
    }
    state.batches = state.batches || [];
    state.meals = state.meals || [];
  }

  function save() {
    localStorage.setItem(KEY, JSON.stringify(state));
  }

  const uid = () => Math.random().toString(36).slice(2, 10);

  /* ---------- 野菜の色 ---------- */
  const COLORS = {
    にんじん: '#EF9038', ブロッコリー: '#5AA24E', じゃがいも: '#D9B863', さつまいも: '#C77B4A',
    かぼちゃ: '#E8973A', ほうれん草: '#3E8E5E', トマト: '#E1574A', だいこん: '#BFC6B0',
    たまねぎ: '#E0CB86', キャベツ: '#8FC06B', なす: '#7163A0', とうもろこし: '#F1C546',
    かぶ: '#C9CBB8', こまつな: '#4FA05E', おかゆ: '#E9E2C8', しらす: '#9FB7C4',
    とうふ: '#EDEAD8', バナナ: '#E9C84B',
  };
  const FALLBACK = ['#7DA86E', '#C98A5E', '#6FA8B0', '#B07FA6', '#D2A24C', '#80A0C2'];
  let fbIdx = 0;
  const fbMap = {};
  function colorOf(v) {
    if (COLORS[v]) return COLORS[v];
    if (!fbMap[v]) fbMap[v] = FALLBACK[fbIdx++ % FALLBACK.length];
    return fbMap[v];
  }
  const PRESETS = ['にんじん', 'ブロッコリー', 'じゃがいも', 'かぼちゃ', 'ほうれん草', 'トマト', 'だいこん', 'たまねぎ', 'おかゆ', 'とうふ'];

  /* ---------- 在庫の描画 ---------- */
  function renderStock() {
    const g = groupBatches(state.batches);
    let veggies = Object.keys(g);
    const sum = summarize(state.batches);

    let html = `<div class="summary">
      <div class="sum-card"><div class="sum-num">${sum.types}</div><div class="sum-lab">やさいの種類</div></div>
      <div class="sum-card"><div class="sum-num">${sum.total}</div><div class="sum-lab">ストック合計</div></div>
      <div class="sum-card ${sum.alert ? 'alert' : ''}"><div class="sum-num">${sum.alert}</div><div class="sum-lab">期限すぎ</div></div>
    </div>`;

    if (!veggies.length) {
      html += `<div class="empty"><div class="big">🥕</div>まだストックがありません。<br>「＋ つくる」からゆでた野菜を追加しましょう。</div>`;
    } else {
      veggies = veggies.sort(
        (a, b) => g[b].reduce((s, x) => s + x.qty, 0) - g[a].reduce((s, x) => s + x.qty, 0)
      );
      for (const v of veggies) {
        const arr = g[v];
        const count = arr.reduce((s, x) => s + x.qty, 0);
        const c = colorOf(v);
        const worst = arr.some((b) => freshness(b).alert);
        html += `<div class="veg">
          <div class="veg-head">
            <div class="chip" style="background:${c}">${[...v][0] || '・'}</div>
            <div><div class="veg-name">${esc(v)}</div>
              <div class="veg-meta">${arr.length}回分のストック${worst ? ' ・ 期限すぎあり' : ''}</div></div>
            <div class="veg-count"><b>${count}</b><span> 個</span></div>
          </div>
          <div class="batches">`;
        for (const b of arr) {
          const f = freshness(b);
          html += `<div class="batch">
            <span class="badge ${f.cls}">${f.txt}</span>
            <span class="store">${b.store}</span>
            <span class="made">${madeLabel(b.made)}につくった</span>
            <span class="qty">×${b.qty}</span>
            <button class="trash" title="このストックを削除" data-del="${b.id}">🗑</button>
          </div>`;
        }
        html += `</div></div>`;
      }
    }
    document.getElementById('view-stock').innerHTML = html;
  }

  /* ---------- きろくの描画 ---------- */
  const SLOTS = ['朝', '昼', '晩'];
  const SLOT_ICON = { 朝: '🌅', 昼: '🌞', 晩: '🌙' };
  function slotOf(m) {
    return m.slot || slotFromHour(new Date(m.ts).getHours());
  }

  function renderLog() {
    const el = document.getElementById('view-log');
    if (!state.meals.length) {
      el.innerHTML = `<div class="empty"><div class="big">🥄</div>まだ記録がありません。<br>「🥄 あげる」であげた分を記録しましょう。</div>`;
      return;
    }
    const byDay = {};
    state.meals.forEach((m) => {
      const k = new Date(m.ts).toISOString().slice(0, 10);
      (byDay[k] = byDay[k] || []).push(m);
    });
    let html = '';
    for (const k of Object.keys(byDay).sort().reverse()) {
      html += `<div class="day"><div class="day-h">${fmtDay(k)}</div>`;
      const bySlot = {};
      byDay[k].forEach((m) => {
        const s = slotOf(m);
        (bySlot[s] = bySlot[s] || []).push(m);
      });
      // 時間帯（朝/昼/晩）ごとに1つにまとめて表示する。
      for (const s of SLOTS) {
        const meals = bySlot[s] || [];
        if (!meals.length) continue;
        const merged = mergeItems(meals.reduce((acc, m) => acc.concat(m.items), []));
        const tot = merged.reduce((n, i) => n + i.qty, 0);
        html += `<div class="slot-h"><span class="dot">${SLOT_ICON[s]}</span>${s}<span class="cnt">合計 ${tot}個</span></div>`;
        html += `<div class="meal">`;
        for (const it of merged) {
          html += `<span class="pill" style="background:${colorOf(it.veg)}22"><i style="background:${colorOf(it.veg)}"></i>${esc(it.veg)} ×${it.qty}</span>`;
        }
        html += `<button class="undo" data-undo-day="${k}" data-undo-slot="${s}">取り消し</button></div>`;
      }
      html += `</div>`;
    }
    el.innerHTML = html;
  }

  function renderAll() {
    renderStock();
    renderLog();
    document.getElementById('serveBtn').disabled = !state.batches.some((b) => b.qty > 0);
  }

  /* ---------- タブ ---------- */
  function switchTab(t) {
    const s = t === 'stock';
    document.getElementById('tab-stock').setAttribute('aria-selected', s);
    document.getElementById('tab-log').setAttribute('aria-selected', !s);
    document.getElementById('view-stock').hidden = !s;
    document.getElementById('view-log').hidden = s;
  }

  /* ---------- つくるシート ---------- */
  let makeVeg = null;
  let makeStore = '冷蔵';

  function openMake() {
    makeVeg = null;
    makeStore = '冷蔵';
    const p = document.getElementById('makePicks');
    p.innerHTML = PRESETS.map(
      (v) =>
        `<button class="veg-pick" data-pick="${v}" aria-pressed="false"><i style="background:${colorOf(v)}"></i>${v}</button>`
    ).join('');
    document.getElementById('makeCustom').value = '';
    document.getElementById('makeQty').value = 8;
    document.getElementById('makeDate').value = todayISO();
    document.querySelectorAll('#makeStore button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === '冷蔵'));
    show('makeScrim');
  }

  function pickMake(v) {
    makeVeg = v;
    document.getElementById('makeCustom').value = '';
    document.querySelectorAll('#makePicks .veg-pick').forEach((b) => b.setAttribute('aria-pressed', b.dataset.pick === v));
  }

  function saveMake() {
    const custom = document.getElementById('makeCustom').value.trim();
    const veg = custom || makeVeg;
    const qty = Math.max(1, parseInt(document.getElementById('makeQty').value, 10) || 0);
    const made = document.getElementById('makeDate').value || todayISO();
    if (!veg) {
      toast('やさいを選んでね');
      return;
    }
    state.batches.push({ id: uid(), veg, qty, made, store: makeStore });
    save();
    renderAll();
    hide('makeScrim');
    switchTab('stock');
    toast(`${veg} を ${qty}個 追加しました`);
  }

  /* ---------- あげるシート ---------- */
  let serveSlot = '朝';

  function openServe() {
    serveSlot = slotFromHour(new Date().getHours());
    document.querySelectorAll('#serveSlot button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === serveSlot));
    const g = groupBatches(state.batches);
    const list = document.getElementById('serveList');
    list.innerHTML = Object.keys(g)
      .map((v) => {
        const sum = g[v].reduce((s, x) => s + x.qty, 0);
        return `<div class="serve-row" data-veg="${esc(v)}" data-max="${sum}">
          <div class="chip" style="background:${colorOf(v)};width:34px;height:34px;border-radius:11px;font-size:15px">${[...v][0]}</div>
          <div><div class="nm">${esc(v)}</div><div class="av">のこり ${sum}個</div></div>
          <div class="right"><div class="stepper">
            <button data-serve-step="-1" aria-label="へらす">−</button>
            <input type="number" value="0" min="0" max="${sum}" inputmode="numeric" />
            <button data-serve-step="1" aria-label="ふやす">＋</button>
          </div></div></div>`;
      })
      .join('');
    serveTotal();
    show('serveScrim');
  }

  function serveStep(btn, d) {
    const inp = btn.parentElement.querySelector('input');
    const max = parseInt(inp.max, 10);
    let v = (parseInt(inp.value, 10) || 0) + d;
    v = Math.max(0, Math.min(max, v));
    inp.value = v;
    serveTotal();
  }

  function serveTotal() {
    let tot = 0;
    document.querySelectorAll('#serveList .serve-row').forEach((r) => {
      const inp = r.querySelector('input');
      let v = parseInt(inp.value, 10) || 0;
      const max = parseInt(r.dataset.max, 10);
      if (v > max) {
        v = max;
        inp.value = max;
      }
      if (v < 0) {
        v = 0;
        inp.value = 0;
      }
      tot += v;
    });
    document.getElementById('serveSave').disabled = tot === 0;
  }

  function saveServe() {
    const items = [];
    document.querySelectorAll('#serveList .serve-row').forEach((r) => {
      const v = parseInt(r.querySelector('input').value, 10) || 0;
      if (v > 0) items.push({ veg: r.dataset.veg, qty: v });
    });
    if (!items.length) return;
    state.batches = deductFIFO(state.batches, items);
    state.meals.push({ id: uid(), ts: Date.now(), slot: serveSlot, items });
    save();
    renderAll();
    hide('serveScrim');
    switchTab('log');
    toast(`${serveSlot}：` + items.map((i) => `${i.veg}×${i.qty}`).join('・'));
  }

  /* ---------- 削除 / 取り消し ---------- */
  function delBatch(id) {
    state.batches = state.batches.filter((b) => b.id !== id);
    save();
    renderAll();
  }

  // ある日のある時間帯（朝/昼/晩）の記録をまとめて取り消し、在庫に戻す。
  function undoSlot(day, slot) {
    const target = state.meals.filter(
      (m) => new Date(m.ts).toISOString().slice(0, 10) === day && slotOf(m) === slot
    );
    if (!target.length) return;
    const items = target.reduce((acc, m) => acc.concat(m.items), []);
    state.batches = restoreToStock(state.batches, items, { uid, today: todayISO() });
    const ids = new Set(target.map((m) => m.id));
    state.meals = state.meals.filter((m) => !ids.has(m.id));
    save();
    renderAll();
    toast('取り消しました');
  }

  /* ---------- ヘルパー ---------- */
  function show(id) {
    document.getElementById(id).classList.add('on');
    document.body.style.overflow = 'hidden';
  }
  function hide(id) {
    document.getElementById(id).classList.remove('on');
    document.body.style.overflow = '';
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  function todayISO() {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }
  function fmtDay(iso) {
    const d = new Date(iso + 'T00:00:00');
    const w = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
    const today = todayISO();
    const y = new Date(Date.now() - 86400000);
    const yi = new Date(y.getTime() - y.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    let pre = '';
    if (iso === today) pre = '今日 ・ ';
    else if (iso === yi) pre = '昨日 ・ ';
    return `${pre}${d.getMonth() + 1}月${d.getDate()}日（${w}）`;
  }
  let toastTimer;
  function toast(t) {
    const el = document.getElementById('toast');
    el.textContent = t;
    el.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('on'), 2200);
  }

  /* ---------- イベント配線 ---------- */
  function wire() {
    document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
    document.getElementById('makeBtn').addEventListener('click', openMake);
    document.getElementById('serveBtn').addEventListener('click', openServe);
    document.getElementById('makeSave').addEventListener('click', saveMake);
    document.getElementById('serveSave').addEventListener('click', saveServe);

    // ステッパー（つくる数）
    document.querySelectorAll('[data-step]').forEach((b) =>
      b.addEventListener('click', () => {
        const i = document.getElementById(b.dataset.step);
        i.value = Math.max(1, (parseInt(i.value, 10) || 0) + parseInt(b.dataset.dir, 10));
      })
    );

    // 保存方法セグメント
    document.getElementById('makeStore').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      makeStore = b.dataset.v;
      document.querySelectorAll('#makeStore button').forEach((x) => x.setAttribute('aria-pressed', x === b));
    });
    document.getElementById('makeCustom').addEventListener('input', () => {
      makeVeg = null;
      document.querySelectorAll('#makePicks .veg-pick').forEach((b) => b.setAttribute('aria-pressed', 'false'));
    });

    // 時間帯セグメント
    document.getElementById('serveSlot').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      serveSlot = b.dataset.v;
      document.querySelectorAll('#serveSlot button').forEach((x) => x.setAttribute('aria-pressed', x === b));
    });

    // 動的に作られる要素はデリゲーションで処理
    document.getElementById('makePicks').addEventListener('click', (e) => {
      const b = e.target.closest('.veg-pick');
      if (b) pickMake(b.dataset.pick);
    });
    document.getElementById('view-stock').addEventListener('click', (e) => {
      const b = e.target.closest('[data-del]');
      if (b) delBatch(b.dataset.del);
    });
    document.getElementById('view-log').addEventListener('click', (e) => {
      const b = e.target.closest('[data-undo-slot]');
      if (b) undoSlot(b.dataset.undoDay, b.dataset.undoSlot);
    });
    document.getElementById('serveList').addEventListener('click', (e) => {
      const b = e.target.closest('[data-serve-step]');
      if (b) serveStep(b, parseInt(b.dataset.serveStep, 10));
    });
    document.getElementById('serveList').addEventListener('input', (e) => {
      if (e.target.matches('input')) serveTotal();
    });

    // シートを閉じる（背景クリック / Escape）
    document.querySelectorAll('.scrim').forEach((s) =>
      s.addEventListener('click', (e) => {
        if (e.target === s) hide(s.id);
      })
    );
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') document.querySelectorAll('.scrim.on').forEach((s) => hide(s.id));
    });
  }

  /* ---------- 起動 ---------- */
  function boot() {
    const d = new Date();
    const w = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
    document.getElementById('today').textContent = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${w}）`;
    load();
    wire();
    renderAll();
  }

  boot();
})();
