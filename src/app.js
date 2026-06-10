/**
 * 画面とのつなぎ込み。
 * 状態は localStorage に保存し、計算ロジックは window.BabyFood に任せる。
 *
 * ingredient: { id, name, qty, unit, store, bought, expire, cat }
 * batch     : { id, veg, qty, made, store, cat }
 * meal      : { id, ts, slot, items: [{ veg, qty }] }
 */
(function () {
  'use strict';

  const {
    CATS,
    PRESETS_BY_CAT,
    CAT_OF_NAME,
    catOfName,
    freshness,
    ingFreshness,
    madeLabel,
    daysUntil,
    slotFromHour,
    groupBatches,
    deductFIFO,
    restoreToStock,
    planMenus,
  } = window.BabyFood;

  const KEY = 'babyfood:state:v1';

  /* ---------- 状態 ---------- */
  let state = { ingredients: [], batches: [], meals: [], settings: { recPerDay: 2 } };
  let recPerDay = 2;

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) state = JSON.parse(raw);
    } catch (e) {
      /* 壊れていれば初期状態のまま */
    }
    state.ingredients = state.ingredients || [];
    state.batches = state.batches || [];
    state.meals = state.meals || [];
    state.settings = state.settings || {};
    if (!state.settings.recPerDay) state.settings.recPerDay = 2;
    recPerDay = state.settings.recPerDay;
    // 旧データの移行：カテゴリが無いものは名前から推定する。
    state.batches.forEach((b) => {
      if (!b.cat) b.cat = catOfName(b.veg);
    });
    state.ingredients.forEach((i) => {
      if (!i.cat) i.cat = '野菜';
    });
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      /* 保存できない環境ではそのまま続行 */
    }
  }

  const uid = () => Math.random().toString(36).slice(2, 10);
  const $ = (id) => document.getElementById(id);

  /* ---------- 野菜の色 ---------- */
  const COLORS = {
    にんじん: '#EF9038', ブロッコリー: '#5AA24E', じゃがいも: '#D9B863', さつまいも: '#C77B4A',
    かぼちゃ: '#E8973A', ほうれん草: '#3E8E5E', トマト: '#E1574A', だいこん: '#BFC6B0',
    たまねぎ: '#E0CB86', キャベツ: '#8FC06B', なす: '#7163A0', とうもろこし: '#F1C546',
    かぶ: '#C9CBB8', こまつな: '#4FA05E',
    鶏ささみ: '#E6A39C', 鶏むね肉: '#E6A39C', 鶏もも肉: '#DD928A', 鶏肉: '#E09189',
    鶏ひき肉: '#DC857C', おやき: '#D79F57', とうふ: '#EDEAD8', 白身魚: '#CFE0E2',
    しらす: '#9FB7C4', ツナ: '#C99A6A', 卵: '#F2C94C', 納豆: '#B6975A',
    '10倍がゆ': '#ECE6D5', '7倍がゆ': '#E8E0C9', '5倍がゆ': '#E4DBBE', 軟飯: '#E1D6B3',
    ごはん: '#EAE3CF', パンがゆ: '#E8CFA0', うどん: '#ECE6D6', バナナ: '#E9C84B',
  };
  const FALLBACK = ['#7DA86E', '#C98A5E', '#6FA8B0', '#B07FA6', '#D2A24C', '#80A0C2'];
  let fbIdx = 0;
  const fbMap = {};
  function colorOf(v) {
    if (COLORS[v]) return COLORS[v];
    if (!fbMap[v]) fbMap[v] = FALLBACK[fbIdx++ % FALLBACK.length];
    return fbMap[v];
  }

  const CAT_ICON = Object.fromEntries(CATS.map((c) => [c.key, c.icon]));

  /* ---------- 食材タブの描画 ---------- */
  function renderIngredients() {
    const list = [...state.ingredients].sort((a, b) => {
      const ea = a.expire ? daysUntil(a.expire) : 9999;
      const eb = b.expire ? daysUntil(b.expire) : 9999;
      return ea - eb;
    });
    const alertCount = state.ingredients.filter((i) => {
      const f = ingFreshness(i);
      return f && f.alert;
    }).length;

    let html = `<button class="add-ing" data-act="add-ing">＋ 野菜の食材を追加</button>`;
    html += `<div class="summary">
      <div class="sum-card"><div class="sum-num">${state.ingredients.length}</div><div class="sum-lab">野菜の種類</div></div>
      <div class="sum-card ${alertCount ? 'alert' : ''}"><div class="sum-num">${alertCount}</div><div class="sum-lab">期限が近い</div></div>
    </div>`;

    if (!list.length) {
      html += `<div class="empty"><div class="big">🧺</div>冷蔵庫の野菜を登録しましょう。<br>ここから ゆでて野菜ストックを作れます。<br><span style="font-size:12px">（お肉・ごはんは「＋ つくる」から直接ストックにできます）</span></div>`;
    } else {
      for (const ing of list) {
        const c = colorOf(ing.name);
        const f = ingFreshness(ing);
        html += `<div class="veg">
          <div class="veg-head">
            <div class="chip" style="background:${c}">${[...ing.name][0] || '・'}</div>
            <div><div class="veg-name">${esc(ing.name)}</div>
              <div class="veg-meta">${f ? `<span class="badge ${f.cls}">${f.txt}</span> ` : ''}<span class="store">${esc(ing.store)}</span></div></div>
            <div class="veg-count"><b>${ing.qty}</b><span> ${esc(ing.unit)}</span></div>
          </div>
          <div class="veg-actions">
            <button class="make" data-act="ing-make" data-id="${ing.id}">🥄 ストックを作る</button>
            <button data-act="ing-edit" data-id="${ing.id}">編集</button>
            <button class="del" data-act="ing-del" data-id="${ing.id}">削除</button>
          </div>
        </div>`;
      }
    }
    $('view-ingredients').innerHTML = html;
  }

  /* ---------- 在庫タブの描画 ---------- */
  const STOCK_SECTIONS = [
    { icon: '🥕', label: '野菜', cat: '野菜', store: null },
    { icon: '🍗', label: 'タンパク質（冷蔵）', cat: 'タンパク質', store: '冷蔵' },
    { icon: '🧊', label: 'タンパク質（冷凍）', cat: 'タンパク質', store: '冷凍' },
    { icon: '🍚', label: 'ごはん', cat: 'ごはん', store: null },
  ];
  function groupBy(pred) {
    const m = {};
    state.batches
      .filter((b) => b.qty > 0 && pred(b))
      .forEach((b) => {
        (m[b.veg] = m[b.veg] || []).push(b);
      });
    Object.values(m).forEach((arr) => arr.sort((a, b) => a.made.localeCompare(b.made)));
    return m;
  }
  function vegCardHTML(v, arr) {
    const sum = arr.reduce((s, x) => s + x.qty, 0);
    const c = colorOf(v);
    const worst = arr.some((b) => freshness(b).alert);
    let h = `<div class="veg">
      <div class="veg-head">
        <div class="chip" style="background:${c}">${[...v][0] || '・'}</div>
        <div><div class="veg-name">${esc(v)}</div>
          <div class="veg-meta">${arr.length}回分のストック${worst ? ' ・ 期限すぎあり' : ''}</div></div>
        <div class="veg-count"><b>${sum}</b><span> 個</span></div>
      </div>
      <div class="batches">`;
    for (const b of arr) {
      const f = freshness(b);
      h += `<div class="batch">
        <span class="badge ${f.cls}">${f.txt}</span>
        <span class="store">${b.store}</span>
        <span class="made">${madeLabel(b.made)}につくった</span>
        <span class="qty">×${b.qty}</span>
        <button class="trash" title="このストックを削除" data-del="${b.id}">🗑</button>
      </div>`;
    }
    return h + `</div></div>`;
  }
  function renderStock() {
    const totalQty = state.batches.reduce((s, b) => s + Math.max(0, b.qty), 0);
    const kinds = new Set(state.batches.filter((b) => b.qty > 0).map((b) => b.veg)).size;
    const alertCount = state.batches.filter((b) => b.qty > 0 && freshness(b).alert).length;
    let html = `<div class="summary">
      <div class="sum-card"><div class="sum-num">${kinds}</div><div class="sum-lab">ストックの種類</div></div>
      <div class="sum-card"><div class="sum-num">${totalQty}</div><div class="sum-lab">ストック合計</div></div>
      <div class="sum-card ${alertCount ? 'alert' : ''}"><div class="sum-num">${alertCount}</div><div class="sum-lab">期限すぎ</div></div>
    </div>`;

    if (totalQty <= 0) {
      html += `<div class="empty"><div class="big">🍱</div>まだストックがありません。<br>「＋ つくる」から、ゆでた野菜・肉、冷凍ごはんなどを追加しましょう。</div>`;
    } else {
      for (const sec of STOCK_SECTIONS) {
        const g = groupBy((b) => (b.cat || '野菜') === sec.cat && (sec.store ? b.store === sec.store : true));
        const vs = Object.keys(g);
        if (!vs.length) continue;
        vs.sort((a, b) => g[b].reduce((s, x) => s + x.qty, 0) - g[a].reduce((s, x) => s + x.qty, 0));
        const total = vs.reduce((s, v) => s + g[v].reduce((n, x) => n + x.qty, 0), 0);
        html += `<div class="cat-h"><span class="ic">${sec.icon}</span>${sec.label}<span class="cnt">${total}個</span></div>`;
        for (const v of vs) html += vegCardHTML(v, g[v]);
      }
    }
    $('view-stock').innerHTML = html;
  }

  /* ---------- おすすめ献立の描画 ---------- */
  function menuPills(m) {
    const chip = (n) => `<span class="pill" style="background:${colorOf(n)}22"><i style="background:${colorOf(n)}"></i>${esc(n)}</span>`;
    const miss = (t) => `<span class="pill miss">＋${t}</span>`;
    let s = '';
    s += m.rice ? chip(m.rice.veg) : miss('ごはん');
    s += m.protein ? chip(m.protein.veg) : miss('タンパク質');
    s += m.veg.length ? m.veg.map((v) => chip(v.veg)).join('') : miss('野菜');
    return s;
  }
  function renderRecommend() {
    const box = $('recommendBox');
    const { days, ranOut, total, hasStock } = planMenus(state.batches, { perDay: recPerDay });
    let html = `<div class="rec-title">📋 これからのおすすめ献立</div>
      <div class="rec-sub">いまの在庫を組み合わせた、仮のメニュー（ごはん1＋タンパク質1＋野菜3）です。毎食なるべく違う組み合わせにします。</div>
      <div class="rec-controls"><span>1日の回数</span><div class="seg seg-rec" id="recPer">
        ${[1, 2, 3].map((n) => `<button data-v="${n}" aria-pressed="${n === recPerDay}">${n}回</button>`).join('')}
      </div></div>`;

    if (!hasStock) {
      html += `<div class="rec-blank">
        <div class="rec-blank-h">まずは3種類そろえると安心です</div>
        <div class="rec-template">
          <span class="pill miss">🍚 ごはん</span><span class="pill miss">🍗 タンパク質</span><span class="pill miss">🥕 野菜</span>
        </div>
        <p class="note" style="margin-top:10px">例：ごはん＋鶏ささみ＋にんじん。この3つを「＋ つくる」でストックすると、ここに数日分の献立が自動で並びます。</p>
        <button class="save" style="margin-top:14px" data-act="rec-make">＋ つくる</button>
      </div>`;
    } else {
      html += `<div class="rec-count">いまの在庫で <b>あと${total}回分</b> の献立が作れます${ranOut ? '' : '（4日分以上）'}</div>`;
      const dayName = ['今日', '明日', '明後日', '3日後'];
      days.forEach((meals, di) => {
        html += `<div class="rec-day">${dayName[di] || di + 1 + '日後'}</div>`;
        meals.forEach((m, mi) => {
          html += `<div class="rec-meal"><span class="rec-no">${mi + 1}回目</span><div class="rec-pills">${menuPills(m)}</div></div>`;
        });
      });
      if (ranOut) html += `<div class="rec-note">この先は在庫が足りません。「＋ つくる」で補充すると、おすすめが先まで伸びます。</div>`;
    }
    box.innerHTML = html;
  }

  /* ---------- あげたきろくの描画 ---------- */
  const SLOTS = ['朝', '昼', '晩'];
  const SLOT_ICON = { 朝: '🌅', 昼: '🌞', 晩: '🌙' };
  function slotOf(m) {
    return m.slot || slotFromHour(new Date(m.ts).getHours());
  }
  function renderLog() {
    const el = $('historyBox');
    let html = `<div class="rec-title" style="margin-top:24px">🥄 あげたきろく</div>`;
    if (!state.meals.length) {
      el.innerHTML = html + `<div class="empty"><div class="big">🍽️</div>まだ記録がありません。<br>「🥄 あげる」であげた分を記録しましょう。</div>`;
      return;
    }
    const byDay = {};
    state.meals.forEach((m) => {
      const k = new Date(m.ts).toISOString().slice(0, 10);
      (byDay[k] = byDay[k] || []).push(m);
    });
    for (const k of Object.keys(byDay).sort().reverse()) {
      html += `<div class="day"><div class="day-h">${fmtDay(k)}</div>`;
      const bySlot = {};
      byDay[k].forEach((m) => {
        const s = slotOf(m);
        (bySlot[s] = bySlot[s] || []).push(m);
      });
      for (const s of SLOTS) {
        const meals = (bySlot[s] || []).sort((a, b) => a.ts - b.ts);
        if (!meals.length) continue;
        const tot = meals.reduce((n, m) => n + m.items.reduce((x, i) => x + i.qty, 0), 0);
        html += `<div class="slot-h"><span class="dot">${SLOT_ICON[s]}</span>${s}<span class="cnt">合計 ${tot}個</span></div>`;
        for (const m of meals) {
          const t = new Date(m.ts);
          const hm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
          html += `<div class="meal"><span class="time">${hm}</span>`;
          for (const it of m.items) {
            html += `<span class="pill" style="background:${colorOf(it.veg)}22"><i style="background:${colorOf(it.veg)}"></i>${esc(it.veg)} ×${it.qty}</span>`;
          }
          html += `<button class="undo" data-undo="${m.id}">取り消し</button></div>`;
        }
      }
      html += `</div>`;
    }
    el.innerHTML = html;
  }

  function renderAll() {
    renderIngredients();
    renderStock();
    renderRecommend();
    renderLog();
    $('serveBtn').disabled = !state.batches.some((b) => b.qty > 0);
  }

  /* ---------- タブ ---------- */
  function switchTab(t) {
    const tabs = { ingredients: 'tab-ingredients', stock: 'tab-stock', log: 'tab-log' };
    const views = { ingredients: 'view-ingredients', stock: 'view-stock', log: 'view-log' };
    for (const k in tabs) {
      $(tabs[k]).setAttribute('aria-selected', k === t);
      $(views[k]).hidden = k !== t;
    }
  }

  /* ---------- つくるシート ---------- */
  let makeVeg = null;
  let makeStore = '冷蔵';
  let makeIngId = null;
  let makeCat = '野菜';

  function renderMakeCat() {
    $('makeCat').innerHTML = CATS.map(
      (c) => `<button data-act="make-cat" data-v="${c.key}" aria-pressed="${c.key === makeCat}">${c.icon} ${c.key}</button>`
    ).join('');
  }
  function makePickList(cat) {
    const ings = state.ingredients.filter((i) => (i.cat || '野菜') === cat).map((i) => ({ label: i.name, id: i.id }));
    const ingNames = ings.map((x) => x.label);
    const exs = (PRESETS_BY_CAT[cat] || []).filter((p) => !ingNames.includes(p)).map((p) => ({ label: p, id: null }));
    return [...ings, ...exs];
  }
  function renderMakePicks() {
    const list = makePickList(makeCat);
    $('makePicks').innerHTML =
      list
        .map(
          (it) =>
            `<button class="veg-pick" data-act="make-pick" data-v="${esc(it.label)}" data-ing="${it.id || ''}" aria-pressed="false"><i style="background:${colorOf(it.label)}"></i>${esc(it.label)}</button>`
        )
        .join('') || `<span class="note" style="margin:0">候補がありません。下に直接入力してください。</span>`;
  }
  function openMake(ingId) {
    makeVeg = null;
    makeIngId = null;
    const fromIng = typeof ingId === 'string' ? state.ingredients.find((i) => i.id === ingId) : null;
    makeCat = fromIng ? fromIng.cat || '野菜' : '野菜';
    makeStore = makeCat === '野菜' ? '冷蔵' : '冷凍'; // 肉・ごはんは冷凍が基本
    renderMakeCat();
    renderMakePicks();
    $('makeCustom').value = '';
    $('makeQty').value = 8;
    $('makeDate').value = todayISO();
    document.querySelectorAll('#makeStore button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === makeStore));
    $('makeUse').hidden = true;
    show('makeScrim');
    if (fromIng) {
      const btn = document.querySelector(`#makePicks .veg-pick[data-ing="${ingId}"]`);
      if (btn) pickMake(btn);
    }
  }
  function selectMakeCat(cat) {
    makeCat = cat;
    makeVeg = null;
    makeIngId = null;
    $('makeUse').hidden = true;
    $('makeCustom').value = '';
    renderMakeCat();
    renderMakePicks();
  }
  function pickMake(btn) {
    makeVeg = btn.dataset.v;
    makeIngId = btn.dataset.ing || null;
    $('makeCustom').value = '';
    document.querySelectorAll('#makePicks .veg-pick').forEach((b) => b.setAttribute('aria-pressed', b === btn));
    showUseField();
  }
  function showUseField() {
    const box = $('makeUse');
    const ing = state.ingredients.find((i) => i.id === makeIngId);
    if (!ing) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    $('makeUseUnit').textContent = ing.unit;
    $('makeUseHint').textContent = `いま冷蔵庫に ${ing.qty}${ing.unit}。使った分だけ食材から減ります。`;
    const inp = $('makeUseQty');
    inp.max = ing.qty;
    inp.value = Math.min(1, ing.qty);
  }
  function saveMake() {
    const custom = $('makeCustom').value.trim();
    const veg = custom || makeVeg;
    const qty = Math.max(1, parseInt($('makeQty').value, 10) || 0);
    const made = $('makeDate').value || todayISO();
    if (!veg) {
      toast('食材を選んでね');
      return;
    }
    const ing0 = state.ingredients.find((i) => i.id === makeIngId);
    const cat = ing0 ? ing0.cat || makeCat : CAT_OF_NAME[veg] || makeCat;
    state.batches.push({ id: uid(), veg, qty, made, store: makeStore, cat });
    // 紐づく生食材があれば、使った分だけ減らす。
    let usedMsg = '';
    if (ing0 && !custom) {
      const used = Math.min(ing0.qty, Math.max(0, parseInt($('makeUseQty').value, 10) || 0));
      if (used > 0) {
        ing0.qty = Math.round((ing0.qty - used) * 100) / 100;
        usedMsg = ` / 食材 -${used}${ing0.unit}`;
      }
      if (ing0.qty <= 0) state.ingredients = state.ingredients.filter((i) => i.id !== ing0.id);
    }
    save();
    renderAll();
    hide('makeScrim');
    switchTab('stock');
    toast(`${veg} ストック +${qty}個${usedMsg}`);
  }

  /* ---------- 食材シート ---------- */
  let ingEditId = null;
  let ingStore = '冷蔵';
  function renderIngPicks() {
    $('ingPicks').innerHTML = (PRESETS_BY_CAT['野菜'] || [])
      .map(
        (v) => `<button class="veg-pick" data-act="ing-pick" data-v="${esc(v)}" aria-pressed="false"><i style="background:${colorOf(v)}"></i>${esc(v)}</button>`
      )
      .join('');
  }
  function openIng(id) {
    ingEditId = id || null;
    const existing = id ? state.ingredients.find((i) => i.id === id) : null;
    $('ingTitle').textContent = existing ? '野菜の食材を編集' : '野菜の食材を追加';
    ingStore = existing ? existing.store : '冷蔵';
    renderIngPicks();
    $('ingName').value = existing ? existing.name : '';
    $('ingQty').value = existing ? existing.qty : 1;
    $('ingUnit').value = existing ? existing.unit : '本';
    $('ingExpire').value = existing ? existing.expire || '' : '';
    document.querySelectorAll('#ingStore button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === ingStore));
    show('ingScrim');
  }
  function pickIng(v) {
    $('ingName').value = v;
    document.querySelectorAll('#ingPicks .veg-pick').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === v));
  }
  function saveIng() {
    const name = $('ingName').value.trim();
    const qty = Math.max(0, parseInt($('ingQty').value, 10) || 0);
    const unit = $('ingUnit').value;
    const expire = $('ingExpire').value || '';
    if (!name) {
      toast('野菜の名前を入れてね');
      return;
    }
    if (ingEditId) {
      const ing = state.ingredients.find((i) => i.id === ingEditId);
      Object.assign(ing, { name, qty, unit, store: ingStore, expire, cat: '野菜' });
    } else {
      state.ingredients.push({ id: uid(), name, qty, unit, store: ingStore, bought: todayISO(), expire, cat: '野菜' });
    }
    save();
    renderAll();
    hide('ingScrim');
    switchTab('ingredients');
    toast(`${name} を保存しました`);
  }
  function delIng(id) {
    state.ingredients = state.ingredients.filter((i) => i.id !== id);
    save();
    renderAll();
    toast('食材を削除しました');
  }

  /* ---------- あげるシート ---------- */
  let serveSlot = '朝';
  function catOfVeg(v) {
    const b = state.batches.find((x) => x.veg === v);
    return b ? b.cat || '野菜' : '野菜';
  }
  function openServe() {
    serveSlot = slotFromHour(new Date().getHours());
    document.querySelectorAll('#serveSlot button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === serveSlot));
    const g = groupBatches(state.batches);
    const byCat = {};
    Object.keys(g).forEach((v) => {
      const c = catOfVeg(v);
      (byCat[c] = byCat[c] || []).push(v);
    });
    let html = '';
    for (const cat of CATS) {
      const vs = byCat[cat.key];
      if (!vs || !vs.length) continue;
      html += `<div class="cat-h" style="margin-top:14px"><span class="ic">${cat.icon}</span>${cat.key}</div>`;
      for (const v of vs) {
        const sum = g[v].reduce((s, x) => s + x.qty, 0);
        html += `<div class="serve-row" data-veg="${esc(v)}" data-max="${sum}">
          <div class="chip" style="background:${colorOf(v)};width:34px;height:34px;border-radius:11px;font-size:15px">${[...v][0]}</div>
          <div><div class="nm">${esc(v)}</div><div class="av">のこり ${sum}個</div></div>
          <div class="right"><div class="stepper">
            <button data-serve-step="-1" aria-label="へらす">−</button>
            <input type="number" value="0" min="0" max="${sum}" inputmode="numeric" />
            <button data-serve-step="1" aria-label="ふやす">＋</button>
          </div></div></div>`;
      }
    }
    $('serveList').innerHTML = html;
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
    $('serveSave').disabled = tot === 0;
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
  function undoMeal(id) {
    const m = state.meals.find((x) => x.id === id);
    if (!m) return;
    state.batches = restoreToStock(state.batches, m.items, { uid, today: todayISO() });
    state.meals = state.meals.filter((x) => x.id !== id);
    save();
    renderAll();
    toast('取り消しました');
  }

  /* ---------- ヘルパー ---------- */
  function show(id) {
    $(id).classList.add('on');
    document.body.style.overflow = 'hidden';
  }
  function hide(id) {
    $(id).classList.remove('on');
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
    const el = $('toast');
    el.textContent = t;
    el.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('on'), 2200);
  }

  /* ---------- セグメントUIの共通処理 ---------- */
  function wireSeg(containerId, onpick) {
    $(containerId).addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      onpick(b.dataset.v);
      $(containerId).querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b));
    });
  }
  function stepField(target, dir) {
    const i = $(target);
    if (target === 'makeUseQty') {
      const max = parseInt(i.max, 10) || 0;
      i.value = Math.max(0, Math.min(max, (parseInt(i.value, 10) || 0) + dir));
    } else {
      i.value = Math.max(1, (parseInt(i.value, 10) || 0) + dir);
    }
  }

  /* ---------- イベント配線 ---------- */
  function wire() {
    document.querySelector('.tabs').addEventListener('click', (e) => {
      const b = e.target.closest('.tab');
      if (b) switchTab(b.dataset.tab);
    });
    $('makeBtn').addEventListener('click', () => openMake());
    $('serveBtn').addEventListener('click', openServe);
    $('makeSave').addEventListener('click', saveMake);
    $('ingSave').addEventListener('click', saveIng);
    $('serveSave').addEventListener('click', saveServe);

    // 各シートのステッパー（数の増減）
    document.querySelectorAll('[data-step]').forEach((b) =>
      b.addEventListener('click', () => stepField(b.dataset.step, parseInt(b.dataset.dir, 10)))
    );

    // セグメント切り替え
    wireSeg('makeStore', (v) => (makeStore = v));
    wireSeg('ingStore', (v) => (ingStore = v));
    wireSeg('serveSlot', (v) => (serveSlot = v));

    // つくるシート：カテゴリ・候補
    $('makeCat').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b) selectMakeCat(b.dataset.v);
    });
    $('makePicks').addEventListener('click', (e) => {
      const b = e.target.closest('.veg-pick');
      if (b) pickMake(b);
    });
    $('makeCustom').addEventListener('input', () => {
      makeVeg = null;
      makeIngId = null;
      $('makeUse').hidden = true;
      document.querySelectorAll('#makePicks .veg-pick').forEach((b) => b.setAttribute('aria-pressed', 'false'));
    });

    // 食材シート：候補・名前入力
    $('ingPicks').addEventListener('click', (e) => {
      const b = e.target.closest('.veg-pick');
      if (b) pickIng(b.dataset.v);
    });
    $('ingName').addEventListener('input', () => {
      const val = $('ingName').value.trim();
      document.querySelectorAll('#ingPicks .veg-pick').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === val));
    });

    // あげるシート：数の増減
    $('serveList').addEventListener('click', (e) => {
      const b = e.target.closest('[data-serve-step]');
      if (b) serveStep(b, parseInt(b.dataset.serveStep, 10));
    });
    $('serveList').addEventListener('input', (e) => {
      if (e.target.matches('input')) serveTotal();
    });

    // 食材タブ：追加・編集・削除・ストック化
    $('view-ingredients').addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'add-ing') openIng();
      else if (b.dataset.act === 'ing-make') openMake(b.dataset.id);
      else if (b.dataset.act === 'ing-edit') openIng(b.dataset.id);
      else if (b.dataset.act === 'ing-del') delIng(b.dataset.id);
    });

    // 在庫タブ：ストック削除
    $('view-stock').addEventListener('click', (e) => {
      const b = e.target.closest('[data-del]');
      if (b) delBatch(b.dataset.del);
    });

    // おすすめ：回数切替・空状態のつくる
    $('recommendBox').addEventListener('click', (e) => {
      const per = e.target.closest('#recPer button');
      if (per) {
        recPerDay = parseInt(per.dataset.v, 10);
        state.settings.recPerDay = recPerDay;
        save();
        renderRecommend();
        return;
      }
      if (e.target.closest('[data-act="rec-make"]')) openMake();
    });

    // きろく：取り消し
    $('historyBox').addEventListener('click', (e) => {
      const b = e.target.closest('[data-undo]');
      if (b) undoMeal(b.dataset.undo);
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
    $('today').textContent = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${w}）`;
    load();
    wire();
    renderAll();
  }

  boot();
})();
