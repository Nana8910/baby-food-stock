/**
 * 画面とのつなぎ込み。
 * 状態は localStorage に保存し、計算ロジックは window.BabyFood に任せる。
 *
 * ingredient: { id, name, qty, unit, store, bought, expire, cat }
 * batch     : { id, veg, qty, made, store, cat, expire? }
 * meal      : { id, ts, slot, items: [{ veg, qty }], furikake? }
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
    effectiveExpiry,
    slotFromHour,
    isRice,
    groupBatches,
    deductFIFO,
    restoreToStock,
    totalOf,
    planMenus,
    stockOutlook,
    buildForecast,
    prepAsBatches,
    shoppingForPrep,
    reserveConfirmed,
    recentlyUnusedVegs,
  } = window.BabyFood;

  const KEY = 'babyfood:state:v1';

  /* ---------- 状態 ---------- */
  let state = { ingredients: [], batches: [], meals: [], settings: { recPerDay: 2 } };
  let recPerDay = 2;
  let remote = null; // 共有バックエンド（src/sync.js から接続後にセット）

  // 不足フィールドの補完・旧データの移行。読み込み元（ローカル/クラウド）に依らず通す。
  function normalize(s) {
    s = s || {};
    s.ingredients = s.ingredients || [];
    s.batches = s.batches || [];
    s.meals = s.meals || [];
    s.settings = s.settings || {};
    if (!s.settings.recPerDay) s.settings.recPerDay = 2;
    s.batches.forEach((b) => { if (!b.cat) b.cat = catOfName(b.veg); });
    s.ingredients.forEach((i) => { if (!i.cat) i.cat = '野菜'; });
    s.plan = s.plan || {};
    s.plan.perDay = s.plan.perDay || s.settings.recPerDay || 2;
    s.plan.horizonDays = s.plan.horizonDays || 7;
    s.plan.days = s.plan.days || [];
    s.plan.prep = s.plan.prep || []; // 作り置き予定
    return s;
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) state = JSON.parse(raw);
    } catch (e) {
      /* 壊れていれば初期状態のまま */
    }
    state = normalize(state);
    recPerDay = state.settings.recPerDay;
  }

  function persistLocal() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      /* 保存できない環境ではそのまま続行 */
    }
  }

  // ローカルへ即保存し、共有に接続済みならクラウドへも反映する。
  function save() {
    persistLocal();
    if (remote && remote.write) remote.write(state);
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
        <button class="trash edit" title="このストックを編集" data-edit-batch="${b.id}">✏️</button>
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
        // 各ストックを期限が近い（古い）順に並べ、カードもそのカテゴリ内で期限が近い順にする。
        const minExpiry = (arr) => arr.reduce((m, b) => (effectiveExpiry(b) < m ? effectiveExpiry(b) : m), '9999-99-99');
        for (const v of vs) g[v].sort((a, b) => effectiveExpiry(a).localeCompare(effectiveExpiry(b)));
        vs.sort((a, b) => minExpiry(g[a]).localeCompare(minExpiry(g[b])));
        const total = vs.reduce((s, v) => s + g[v].reduce((n, x) => n + x.qty, 0), 0);
        html += `<div class="cat-h"><span class="ic">${sec.icon}</span>${sec.label}<span class="cnt">${total}個</span></div>`;
        for (const v of vs) html += vegCardHTML(v, g[v]);
      }
    }
    $('view-stock').innerHTML = html;
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
      const k = localDayISO(m.ts);
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
          // ふりかけは最初のごはん系の品に付随表示し、無ければ別途表示する。
          let furiDone = false;
          for (const it of m.items) {
            let label = esc(it.veg);
            if (m.furikake && !furiDone && (isRice(it.veg) || catOfVeg(it.veg) === 'ごはん')) {
              label += `<span class="furi-sub">（${esc(m.furikake)}）</span>`;
              furiDone = true;
            }
            html += `<span class="pill" style="background:${colorOf(it.veg)}22"><i style="background:${colorOf(it.veg)}"></i>${label} ×${it.qty}</span>`;
          }
          if (m.furikake && !furiDone) html += `<span class="furi-loose">ふりかけ：${esc(m.furikake)}</span>`;
          html += `<button class="undo" data-edit="${m.id}">編集</button><button class="undo" data-undo="${m.id}">取り消し</button></div>`;
        }
      }
      html += `</div>`;
    }
    el.innerHTML = html;
  }

  function renderAll() {
    renderIngredients();
    renderStock();
    renderPlan();
    renderLog();
    // 在庫が無くても「在庫にないもの」を記録できるため、常に押せる。
    $('serveBtn').disabled = false;
  }

  /* ---------- タブ ---------- */
  function switchTab(t) {
    const tabs = { ingredients: 'tab-ingredients', stock: 'tab-stock', plan: 'tab-plan', log: 'tab-log' };
    const views = { ingredients: 'view-ingredients', stock: 'view-stock', plan: 'view-plan', log: 'view-log' };
    for (const k in tabs) {
      $(tabs[k]).setAttribute('aria-selected', k === t);
      $(views[k]).hidden = k !== t;
    }
  }

  /* ---------- こんだて計画タブ ---------- */
  const PLAN_SLOT_ICON = { 朝: '🌅', 昼: '🌞', 晩: '🌙' };
  function planDayLabel(iso) {
    const today = todayISO();
    const diff = Math.round((new Date(iso + 'T00:00:00') - new Date(today + 'T00:00:00')) / 86400000);
    const names = { 0: '今日', 1: '明日', 2: '明後日' };
    const d = new Date(iso + 'T00:00:00');
    const w = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
    return (names[diff] || `${diff}日後`) + `（${d.getMonth() + 1}/${d.getDate()} ${w}）`;
  }
  const CAT_ICON2 = { 野菜: '🥕', タンパク質: '🍗', ごはん: '🍚' };
  function fmtMD(dt) {
    const w = ['日', '月', '火', '水', '木', '金', '土'][dt.getDay()];
    return `${dt.getMonth() + 1}/${dt.getDate()}(${w})`;
  }
  function ymd(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function mdFromISO(iso) {
    return fmtMD(new Date(iso + 'T00:00:00'));
  }
  // 計画の日付窓を今日起点にそろえる。過去の日は落とし、未来は空の日で埋める。
  // ユーザーが入れた献立はそのまま保持する（自動生成はしない）。
  function ensurePlanFresh() {
    const today = todayISO();
    const byDate = {};
    (state.plan.days || []).filter((d) => d.date >= today).forEach((d) => { byDate[d.date] = d; });
    const out = [];
    const base = new Date(today + 'T00:00:00');
    for (let i = 0; i < (state.plan.horizonDays || 7); i++) {
      const dt = new Date(base);
      dt.setDate(dt.getDate() + i);
      const date = ymd(dt);
      out.push(byDate[date] || { date, confirmed: false, meals: [] });
    }
    state.plan.days = out;
  }
  // 「在庫から埋める」：献立が空の日だけ、在庫＋作り置き予定からの提案で埋める（既存は触らない）。
  function autoFillPlan() {
    const fc = buildForecast(state.batches, state.plan.prep, {
      perDay: state.plan.perDay,
      horizonDays: state.plan.horizonDays,
      startDate: todayISO(),
      uid,
    }, { days: [] });
    const byDate = {};
    fc.days.forEach((d) => { byDate[d.date] = d; });
    state.plan.days.forEach((day) => {
      if (day.meals.length) return;
      const f = byDate[day.date];
      if (f) day.meals = f.meals.map((m) => ({ id: uid(), slot: m.slot, items: m.items.map((it) => ({ veg: it.veg, qty: it.qty })), furikake: '', servedMealId: null }));
    });
    save();
    renderPlan();
  }
  function planChip(it, short) {
    return `<span class="plan-chip${short ? ' short' : ''}"><i class="dot" style="background:${colorOf(it.veg)}"></i>${esc(it.veg)} ×${it.qty || 1}</span>`;
  }

  function renderPlan() {
    ensurePlanFresh();
    const el = $('view-plan');
    const prepBatches = prepAsBatches(state.plan.prep); // 作り置き予定（実行前）を在庫相当に
    const cov = planCoverage(state.plan, state.batches); // 在庫だけで足りるか
    const covWith = planCoverage(state.plan, state.batches.concat(prepBatches)); // 在庫＋作り置き予定
    const remainShort = planShortfall(state.plan, state.batches.concat(prepBatches)); // まだ足りない分（作るべき提案）
    const anyMeals = state.plan.days.some((d) => (d.meals || []).some((m) => !m.servedMealId && (m.items || []).length));

    // 1) 見通し（計画に対し足りる/足りない）
    let head;
    if (!anyMeals) {
      head = `<div class="lab">こんだて計画</div><div class="num" style="font-size:18px">まだ予定がありません</div><div class="sub">各日の「＋ 予定を追加」から、何を何個あげるか登録しましょう</div>`;
    } else if (cov.fullyCovered) {
      head = `<div class="lab">見通し</div><div class="num">計画は今の在庫で全部まかなえます 🎉</div>`;
    } else {
      head = `<div class="lab">見通し</div><div class="num">${cov.lastCoveredDate ? mdFromISO(cov.lastCoveredDate) + ' まで足りる' : '今の在庫では不足'}</div><div class="sub">${mdFromISO(cov.firstShortDate)} から不足</div>`;
    }
    let html = `<div class="plan-outlook">${head}`;
    if (anyMeals && !cov.fullyCovered) {
      if (covWith.fullyCovered) html += `<div class="reserved">下の作り置き予定でまかなえます ✓</div>`;
      else html += `<div class="reserved">作り置き予定でも ${mdFromISO(covWith.firstShortDate)} から不足。提案を追加してください</div>`;
    }
    html += `</div>`;
    html += `<div class="rec-controls"><span>1日の目安</span><div class="seg seg-rec" id="planPer">
      ${[1, 2, 3].map((n) => `<button data-act="per" data-v="${n}" aria-pressed="${n === state.plan.perDay}">${n}回</button>`).join('')}
      </div><button class="plan-add" data-act="autofill" style="margin-left:auto">↻ 在庫から埋める</button></div>`;

    // 2) こんだての計画（あげる/きろくと同じUIで登録・編集）
    html += `<div class="cat-h" style="margin-top:16px"><span class="ic">🗓️</span>こんだての計画</div>`;
    const avail = {};
    state.batches.forEach((b) => { if (b.qty > 0) avail[b.veg] = (avail[b.veg] || 0) + b.qty; });
    prepBatches.forEach((b) => { avail[b.veg] = (avail[b.veg] || 0) + b.qty; });
    state.plan.days.forEach((day, di) => {
      html += `<div class="plan-day-h">${planDayLabel(day.date)}${day.confirmed ? '<span class="badge b-fresh" style="margin-left:6px">確定</span>' : ''}
        <button class="confirm ${day.confirmed ? 'on' : ''}" data-act="confirm" data-day="${di}">${day.confirmed ? '確定済み' : '確定する'}</button></div>`;
      day.meals.forEach((m, mi) => {
        html += `<div class="plan-meal ${day.confirmed ? 'confirmed' : ''}">
          <div class="plan-meal-h"><span class="dot">${PLAN_SLOT_ICON[m.slot] || ''}</span>${m.slot}
          ${m.servedMealId ? '<span class="served">✓ あげた</span>' : `<button class="serve-btn" data-act="serve" data-day="${di}" data-mid="${mi}">🥄 あげた</button>`}</div>
          <div class="plan-chips" ${m.servedMealId ? '' : `data-act="plan-edit" data-day="${di}" data-mid="${mi}" style="cursor:pointer"`}>`;
        if (!m.items.length) html += `<span class="why" style="font-size:12px;color:var(--ink-soft)">タップして内容を入れる</span>`;
        m.items.forEach((it) => {
          let short = false;
          if (!m.servedMealId) {
            const have = avail[it.veg] || 0;
            const use = Math.min(have, it.qty || 1);
            avail[it.veg] = have - use;
            short = use < (it.qty || 1);
          }
          html += planChip(it, short);
        });
        html += `</div>`;
        if (!m.servedMealId) {
          html += `<div class="plan-add-row"><button class="plan-add" data-act="plan-edit" data-day="${di}" data-mid="${mi}">✎ 編集</button><button class="plan-add" data-act="plan-mealdel" data-day="${di}" data-mid="${mi}">削除</button></div>`;
        }
        html += `</div>`;
      });
      html += `<button class="plan-add" data-act="plan-new" data-day="${di}" style="margin:2px 2px 8px">＋ 予定を追加</button>`;
    });

    // 3) 作り置き予定（計画から逆算＝自動 ＋ 手動）
    html += `<div class="cat-h" style="margin-top:16px"><span class="ic">🍳</span>作り置き予定<span class="cnt">計画から逆算</span></div>`;
    const active = [...state.plan.prep].filter((p) => !p.doneBatchId).sort((a, b) => a.date.localeCompare(b.date));
    html += `<div class="plan-list">`;
    if (active.length) {
      active.forEach((p) => {
        html += `<div class="plan-list-row">
          <span class="ic"><i class="dot" style="width:10px;height:10px;border-radius:3px;background:${colorOf(p.veg)};display:inline-block"></i></span>
          <div style="flex:1" data-act="prep-edit" data-id="${p.id}"><div class="nm">${esc(p.veg)} ×${p.qty} をつくる</div><div class="why">${planDayLabel(p.date)} ・ ${esc(p.store || '冷蔵')}</div></div>
          <button class="confirm" data-act="prep-make" data-id="${p.id}">つくった</button>
          <button class="mini" data-act="prep-del" data-id="${p.id}" title="削除" style="font-size:14px;color:var(--ink-soft);background:none;border:0;cursor:pointer">✕</button>
        </div>`;
      });
    } else {
      html += `<div class="plan-list-row" style="cursor:default"><span class="why">手動の作り置き予定はありません</span></div>`;
    }
    html += `</div>`;
    if (remainShort.length) {
      html += `<div class="plan-list" style="background:var(--leaf-soft);border-color:var(--leaf)">`;
      remainShort.forEach((s) => {
        html += `<div class="plan-list-row" data-act="prep-suggest" data-veg="${esc(s.veg)}" data-cat="${s.cat}" data-qty="${s.qty}">
          <span class="ic">💡</span><div style="flex:1"><div class="nm" style="color:var(--leaf-dark)">${esc(s.veg)} ×${s.qty} を作るとよい</div><div class="why">計画に対して不足</div></div><span class="go">予定に追加 ›</span></div>`;
      });
      html += `</div>`;
    }
    html += `<button class="add-ing" data-act="prep-add" style="margin-top:2px">＋ 作り置きを追加</button>`;

    // 4) 買い物予定（作り置きの材料で食材タブに無いもの）
    const shop = shoppingForPrep(state.plan.prep, state.ingredients);
    html += `<div class="cat-h" style="margin-top:16px"><span class="ic">🛒</span>買い物予定</div>`;
    html += `<div class="plan-list">`;
    if (shop.length) {
      shop.forEach((s) => {
        html += `<div class="plan-list-row" data-act="buy" data-veg="${esc(s.veg)}"><span class="ic">${CAT_ICON2[s.cat] || '🛒'}</span><div style="flex:1"><div class="nm">${esc(s.veg)} ×${s.qty}</div><div class="why">作り置きに必要・食材タブに無し</div></div><span class="go">食材に追加 ›</span></div>`;
      });
    } else {
      html += `<div class="plan-list-row" style="cursor:default"><span class="why">作り置きに必要な買い物はありません</span></div>`;
    }
    html += `</div>`;

    html += `<p class="note" style="text-align:center">献立を計画 → 不足分を作り置き予定に → 必要な材料は買い物予定に。<br>実在庫が減るのは「あげた」時です。</p>`;
    el.innerHTML = html;
  }

  /* ---------- 計画の操作 ---------- */
  let servingFromPlan = null;
  function planMealAt(di, mi) {
    const d = state.plan.days[di];
    return d ? d.meals[mi] : null;
  }
  function planConfirm(di) {
    const d = state.plan.days[di];
    if (!d) return;
    d.confirmed = !d.confirmed;
    save();
    renderPlan();
  }
  function planDeleteMeal(di, mi) {
    const d = state.plan.days[di];
    if (!d) return;
    d.meals.splice(mi, 1);
    save();
    renderPlan();
  }

  // 計画の食事を「あげた」→ あげるシートを内容入りで開く（保存で実在庫が減る）。
  function planServe(di, mid) {
    const m = planMealAt(di, mid);
    if (!m) return;
    servingFromPlan = { di, mid };
    openServe();
    serveSlot = m.slot;
    document.querySelectorAll('#serveSlot button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === serveSlot));
    m.items.forEach((it) => {
      let placed = false;
      document.querySelectorAll('#serveList .serve-row').forEach((row) => {
        if (row.dataset.veg === it.veg) {
          const inp = row.querySelector('input');
          const max = parseInt(inp.max, 10) || 0;
          inp.value = Math.min(it.qty || 1, max);
          placed = true;
        }
      });
      if (!placed) {
        const ex = directItems.find((d) => d.veg === it.veg);
        if (ex) ex.qty += it.qty || 1;
        else directItems.push({ veg: it.veg, qty: it.qty || 1 });
      }
    });
    renderDirectChips();
    $('serveFurikake').value = m.furikake || '';
    serveTotal();
  }

  // 買い物→食材シートを名前入りで開く。
  function planBuy(veg) {
    openIng();
    $('ingName').value = veg;
    document.querySelectorAll('#ingPicks .veg-pick').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === veg));
  }

  /* ---------- 作り置き予定シート ---------- */
  let prepEditId = null;
  let prepCat = '野菜';
  let prepStore = '冷蔵';
  function renderPrepCat() {
    $('prepCat').innerHTML = CATS.map((c) => `<button data-v="${c.key}" aria-pressed="${c.key === prepCat}">${c.icon} ${c.key}</button>`).join('');
  }
  function renderPrepPicks() {
    const inStock = state.ingredients.filter((i) => i.qty > 0 && (i.cat || '野菜') === prepCat).map((i) => i.name);
    const presets = (PRESETS_BY_CAT[prepCat] || []).filter((p) => !inStock.includes(p));
    const list = [...inStock, ...presets];
    $('prepPicks').innerHTML =
      list
        .map((v) => `<button class="veg-pick" data-v="${esc(v)}"><i style="background:${colorOf(v)}"></i>${esc(v)}${inStock.includes(v) ? ' <span style="color:var(--leaf-dark);font-size:11px">(食材あり)</span>' : ''}</button>`)
        .join('') || `<span class="note" style="margin:0">候補がありません。下に入力してください。</span>`;
  }
  function openPrep(id, presetVeg, presetCat, presetQty) {
    prepEditId = id || null;
    const ex = id ? state.plan.prep.find((p) => p.id === id) : null;
    prepCat = ex ? ex.cat || '野菜' : presetCat || '野菜';
    prepStore = ex ? ex.store || '冷蔵' : prepCat === '野菜' ? '冷蔵' : '冷凍';
    $('prepTitle').textContent = ex ? '作り置きを編集' : '作り置きを追加';
    renderPrepCat();
    renderPrepPicks();
    $('prepCustom').value = ex ? ex.veg : presetVeg || '';
    $('prepQty').value = ex ? ex.qty : presetQty || 8;
    $('prepDate').value = ex ? ex.date : todayISO();
    document.querySelectorAll('#prepStore button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === prepStore));
    $('prepDelete').hidden = !ex;
    show('prepScrim');
  }
  function savePrep() {
    const veg = $('prepCustom').value.trim();
    const qty = Math.max(1, parseInt($('prepQty').value, 10) || 1);
    const date = $('prepDate').value || todayISO();
    if (!veg) {
      toast('食材を選んでね');
      return;
    }
    const cat = CAT_OF_NAME[veg] || prepCat;
    if (prepEditId) {
      const p = state.plan.prep.find((x) => x.id === prepEditId);
      if (p) Object.assign(p, { veg, qty, date, store: prepStore, cat });
    } else {
      state.plan.prep.push({ id: uid(), veg, qty, date, store: prepStore, cat });
    }
    save();
    renderPlan();
    hide('prepScrim');
    toast(`${veg} の作り置きを予定しました`);
  }
  function delPrep(id) {
    state.plan.prep = state.plan.prep.filter((p) => p.id !== id);
    save();
    renderPlan();
  }
  function delPrepFromSheet() {
    if (prepEditId) delPrep(prepEditId);
    hide('prepScrim');
  }
  // 作り置きを「つくった」＝実在庫(batch)化。以後は見通しで実在庫として扱う。
  function makeFromPrep(id) {
    const p = state.plan.prep.find((x) => x.id === id);
    if (!p) return;
    const b = { id: uid(), veg: p.veg, qty: p.qty, made: todayISO(), store: p.store || '冷蔵', cat: p.cat || catOfName(p.veg) };
    state.batches.push(b);
    p.doneBatchId = b.id;
    save();
    renderAll();
    toast(`${p.veg} ×${p.qty} をストックに追加しました`);
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
    $('makeExpire').value = '';
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
    const expire = $('makeExpire').value || '';
    if (!veg) {
      toast('食材を選んでね');
      return;
    }
    const ing0 = state.ingredients.find((i) => i.id === makeIngId);
    const cat = ing0 ? ing0.cat || makeCat : CAT_OF_NAME[veg] || makeCat;
    state.batches.push({ id: uid(), veg, qty, made, store: makeStore, cat, expire });
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
  let directItems = []; // 在庫にないものの直接記録 [{ veg, qty }]
  function catOfVeg(v) {
    const b = state.batches.find((x) => x.veg === v);
    return b ? b.cat || '野菜' : '野菜';
  }
  function openServe() {
    serveSlot = slotFromHour(new Date().getHours());
    directItems = [];
    $('directName').value = '';
    $('directQty').value = 1;
    $('serveFurikake').value = '';
    renderDirectChips();
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
    $('serveList').innerHTML = html || `<p class="note" style="margin:4px 2px">在庫はありません。下の「在庫にないもの」から記録できます。</p>`;
    serveTotal();
    show('serveScrim');
  }
  function renderDirectChips() {
    $('directChips').innerHTML = directItems
      .map(
        (d, i) =>
          `<button class="veg-pick" data-direct-del="${i}"><i style="background:${colorOf(d.veg)}"></i>${esc(d.veg)} ×${d.qty} ✕</button>`
      )
      .join('');
  }
  function addDirect() {
    const name = $('directName').value.trim();
    const qty = Math.max(1, parseInt($('directQty').value, 10) || 1);
    if (!name) {
      toast('食材名を入れてね');
      return;
    }
    const ex = directItems.find((d) => d.veg === name);
    if (ex) ex.qty += qty;
    else directItems.push({ veg: name, qty });
    $('directName').value = '';
    $('directQty').value = 1;
    renderDirectChips();
    serveTotal();
  }
  function removeDirect(i) {
    directItems.splice(i, 1);
    renderDirectChips();
    serveTotal();
  }
  // 「追加」を押し忘れても、入力欄に残っている食材を取り込む。
  function flushDirect() {
    const name = $('directName').value.trim();
    if (!name) return;
    const qty = Math.max(1, parseInt($('directQty').value, 10) || 1);
    const ex = directItems.find((d) => d.veg === name);
    if (ex) ex.qty += qty;
    else directItems.push({ veg: name, qty });
    $('directName').value = '';
    $('directQty').value = 1;
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
    tot += directItems.reduce((s, d) => s + d.qty, 0);
    if ($('directName').value.trim()) tot++; // 入力中（未追加）も有効に
    $('serveSave').disabled = tot === 0;
  }
  function saveServe() {
    flushDirect();
    // 在庫から選んだ分と直接記録を、同名はまとめて1リストにする。
    const map = {};
    document.querySelectorAll('#serveList .serve-row').forEach((r) => {
      const v = parseInt(r.querySelector('input').value, 10) || 0;
      if (v > 0) map[r.dataset.veg] = (map[r.dataset.veg] || 0) + v;
    });
    directItems.forEach((d) => {
      map[d.veg] = (map[d.veg] || 0) + d.qty;
    });
    // taken = 実際に在庫から引ける数。取り消し・編集で在庫に戻すのはこの分だけ
    // （在庫に無い「直接記録」を戻すと、存在しないストックが生まれてしまうため）。
    const items = Object.keys(map).map((veg) => ({
      veg,
      qty: map[veg],
      taken: Math.min(map[veg], totalOf(state.batches, veg)),
    }));
    if (!items.length) return;
    // 在庫がある分はFIFOで減らす（在庫に無い名前はそのままスキップされる）。
    state.batches = deductFIFO(state.batches, items);
    const furikake = $('serveFurikake').value.trim();
    const mealId = uid();
    state.meals.push({ id: mealId, ts: Date.now(), slot: serveSlot, items, furikake });
    // 計画から「あげた」場合は、その計画の食事に実績を紐付ける。
    if (servingFromPlan) {
      const pm = planMealAt(servingFromPlan.di, servingFromPlan.mid);
      if (pm) pm.servedMealId = mealId;
      servingFromPlan = null;
    }
    save();
    renderAll();
    hide('serveScrim');
    switchTab('log');
    toast(`${serveSlot}：` + items.map((i) => `${i.veg}×${i.qty}`).join('・'));
  }

  /* ---------- きろく/計画 編集シート（共用） ---------- */
  let editContext = null; // { kind:'rec', id } | { kind:'plan', di, mi(null=新規) }
  let editSlot = '朝';
  let editItems = []; // 編集中の品目 [{ veg, qty }]

  function openEditSheet(slot, items, furikake, title, note) {
    editSlot = slot;
    editItems = items.map((it) => ({ veg: it.veg, qty: it.qty }));
    document.querySelectorAll('#editSlot button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === editSlot));
    $('editAddName').value = '';
    $('editAddQty').value = 1;
    $('editFurikake').value = furikake || '';
    $('editTitle').textContent = title;
    $('editListLabel').textContent = '内容（何を何個）';
    $('editNote').textContent = note;
    renderEditList();
    show('editScrim');
  }
  function openEditMeal(id) {
    const m = state.meals.find((x) => x.id === id);
    if (!m) return;
    editContext = { kind: 'rec', id };
    openEditSheet(slotOf(m), m.items, m.furikake, 'きろくを編集', '数量を変えると、差の分だけ在庫を調整します（増やせば在庫から減り、減らせば在庫に戻ります）。0にすると、その食材はきろくから外れます。');
  }
  // 計画の食事を、あげる/きろくと同じUIで登録・編集（在庫は減らさない）。
  function openPlanMeal(di, mi) {
    const day = state.plan.days[di];
    if (!day) return;
    const m = mi == null ? null : day.meals[mi];
    const slot = m ? m.slot : ['朝', '昼', '晩'][(day.meals || []).length % 3];
    editContext = { kind: 'plan', di, mi: mi == null ? null : mi };
    openEditSheet(slot, m ? m.items : [], m ? m.furikake : '', m ? '予定を編集' : '予定を追加', '何を何個あげる予定かを入れてください。これをもとに「作り置き予定」を自動で計算します（在庫は減りません）。');
  }
  function renderEditList() {
    const el = $('editList');
    if (!editItems.length) {
      el.innerHTML = `<p class="note" style="margin:4px 2px">食材がありません。下から追加できます。</p>`;
      return;
    }
    el.innerHTML = editItems
      .map(
        (it, i) => `<div class="serve-row" data-edit-idx="${i}">
      <div class="chip" style="background:${colorOf(it.veg)};width:34px;height:34px;border-radius:11px;font-size:15px">${[...it.veg][0]}</div>
      <div><div class="nm">${esc(it.veg)}</div></div>
      <div class="right"><div class="stepper">
        <button data-edit-step="-1" aria-label="へらす">−</button>
        <input type="number" value="${it.qty}" min="0" inputmode="numeric" />
        <button data-edit-step="1" aria-label="ふやす">＋</button>
      </div></div></div>`
      )
      .join('');
  }
  function editAddItem() {
    const name = $('editAddName').value.trim();
    const qty = Math.max(1, parseInt($('editAddQty').value, 10) || 1);
    if (!name) {
      toast('食材名を入れてね');
      return;
    }
    const ex = editItems.find((d) => d.veg === name);
    if (ex) ex.qty += qty;
    else editItems.push({ veg: name, qty });
    $('editAddName').value = '';
    $('editAddQty').value = 1;
    renderEditList();
  }
  function saveEditMeal() {
    // 「追加」を押し忘れても、入力欄に残っている食材を取り込む。
    const pName = $('editAddName').value.trim();
    if (pName) {
      const pQty = Math.max(1, parseInt($('editAddQty').value, 10) || 1);
      const ex = editItems.find((d) => d.veg === pName);
      if (ex) ex.qty += pQty;
      else editItems.push({ veg: pName, qty: pQty });
    }
    const furikake = $('editFurikake').value.trim();
    const neuItems = editItems.filter((it) => it.qty > 0).map((it) => ({ veg: it.veg, qty: it.qty }));

    // 計画の食事：在庫は触らず、計画に書くだけ。
    if (editContext && editContext.kind === 'plan') {
      const day = state.plan.days[editContext.di];
      if (!day) { hide('editScrim'); return; }
      if (editContext.mi == null) {
        if (neuItems.length) day.meals.push({ id: uid(), slot: editSlot, items: neuItems, furikake, servedMealId: null });
      } else {
        const m = day.meals[editContext.mi];
        if (m) {
          if (!neuItems.length) day.meals.splice(editContext.mi, 1);
          else { m.items = neuItems; m.slot = editSlot; m.furikake = furikake; }
        }
      }
      save();
      renderAll();
      hide('editScrim');
      toast('計画を更新しました');
      return;
    }

    // 記録の編集：元の記録との差分だけ在庫を調整する（増→在庫から引く／減→在庫に戻す）。
    const m = state.meals.find((x) => x.id === (editContext && editContext.id));
    if (!m) { hide('editScrim'); return; }
    // 在庫に戻すのは「実際に在庫から引いた数（taken）」が上限。
    const orig = {};
    m.items.forEach((it) => {
      const o = (orig[it.veg] = orig[it.veg] || { qty: 0, taken: 0 });
      o.qty += it.qty;
      o.taken += takenOf(it);
    });
    const neu = {};
    editItems.forEach((it) => {
      if (it.qty > 0) neu[it.veg] = (neu[it.veg] || 0) + it.qty;
    });
    const increases = [];
    const decreases = [];
    const newTaken = {};
    new Set([...Object.keys(orig), ...Object.keys(neu)]).forEach((veg) => {
      const o = orig[veg] || { qty: 0, taken: 0 };
      const q = neu[veg] || 0;
      const delta = q - o.qty;
      if (delta > 0) {
        // 増えた分は在庫から引く（在庫が足りない分は直接記録扱い）。
        increases.push({ veg, qty: delta });
        newTaken[veg] = o.taken + Math.min(delta, totalOf(state.batches, veg));
      } else if (delta < 0) {
        // 減った分は、在庫から引いた範囲だけ在庫に戻す。
        const back = Math.min(-delta, o.taken);
        if (back > 0) decreases.push({ veg, qty: back });
        newTaken[veg] = o.taken - back;
      } else {
        newTaken[veg] = Math.min(q, o.taken);
      }
    });
    if (increases.length) state.batches = deductFIFO(state.batches, increases);
    if (decreases.length) state.batches = restoreToStock(state.batches, decreases, { uid, today: todayISO() });
    m.items = Object.keys(neu).map((veg) => ({ veg, qty: neu[veg], taken: Math.min(neu[veg], newTaken[veg]) }));
    m.slot = editSlot;
    m.furikake = $('editFurikake').value.trim();
    if (!m.items.length) state.meals = state.meals.filter((x) => x.id !== m.id); // 全部0なら記録ごと削除
    save();
    renderAll();
    hide('editScrim');
    toast('きろくを更新しました');
  }

  /* ---------- ストック編集シート ---------- */
  let editBatchId = null;
  let batchStore = '冷蔵';
  let batchCat = '野菜';
  function openEditBatch(id) {
    const b = state.batches.find((x) => x.id === id);
    if (!b) return;
    editBatchId = id;
    batchStore = b.store || '冷蔵';
    batchCat = b.cat || catOfName(b.veg);
    $('batchVeg').textContent = b.veg;
    $('batchCat').innerHTML = CATS.map(
      (c) => `<button data-v="${c.key}" aria-pressed="${c.key === batchCat}">${c.icon} ${c.key}</button>`
    ).join('');
    $('batchQty').value = Math.max(1, b.qty);
    $('batchMade').value = b.made || todayISO();
    $('batchExpire').value = b.expire || '';
    document.querySelectorAll('#batchStore button').forEach((x) => x.setAttribute('aria-pressed', x.dataset.v === batchStore));
    show('batchScrim');
  }
  function saveEditBatch() {
    const b = state.batches.find((x) => x.id === editBatchId);
    if (!b) return;
    b.qty = Math.max(1, parseInt($('batchQty').value, 10) || 1);
    b.store = batchStore;
    b.cat = batchCat;
    b.made = $('batchMade').value || b.made || todayISO();
    b.expire = $('batchExpire').value || '';
    save();
    renderAll();
    hide('batchScrim');
    toast(`${b.veg} を更新しました`);
  }
  function deleteEditBatch() {
    if (!editBatchId) return;
    delBatch(editBatchId);
    hide('batchScrim');
    toast('ストックを削除しました');
  }

  /* ---------- 削除 / 取り消し ---------- */
  function delBatch(id) {
    state.batches = state.batches.filter((b) => b.id !== id);
    save();
    renderAll();
  }
  // 記録した品目のうち、在庫から実際に引いた数（taken が無い古い記録は全量）。
  function takenOf(it) {
    return it.taken != null ? it.taken : it.qty;
  }
  function undoMeal(id) {
    const m = state.meals.find((x) => x.id === id);
    if (!m) return;
    const restore = m.items
      .map((it) => ({ veg: it.veg, qty: takenOf(it) }))
      .filter((it) => it.qty > 0);
    if (restore.length) state.batches = restoreToStock(state.batches, restore, { uid, today: todayISO() });
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
  // タイムスタンプをローカル時刻の "YYYY-MM-DD" にする（toISOString は UTC のため直接は使わない）。
  function localDayISO(ts) {
    const d = new Date(ts);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }
  function todayISO() {
    return localDayISO(Date.now());
  }
  function fmtDay(iso) {
    const d = new Date(iso + 'T00:00:00');
    const w = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
    const today = todayISO();
    const yi = localDayISO(Date.now() - 86400000);
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
    $('serveBtn').addEventListener('click', () => { servingFromPlan = null; openServe(); });
    $('makeSave').addEventListener('click', saveMake);
    $('ingSave').addEventListener('click', saveIng);
    $('serveSave').addEventListener('click', saveServe);
    $('editSave').addEventListener('click', saveEditMeal);
    $('batchSave').addEventListener('click', saveEditBatch);
    $('batchDelete').addEventListener('click', deleteEditBatch);
    $('prepSave').addEventListener('click', savePrep);
    $('prepDelete').addEventListener('click', delPrepFromSheet);
    wireSeg('prepStore', (v) => (prepStore = v));
    $('prepCat').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      prepCat = b.dataset.v;
      renderPrepCat();
      renderPrepPicks();
    });
    $('prepPicks').addEventListener('click', (e) => {
      const b = e.target.closest('.veg-pick');
      if (b) {
        $('prepCustom').value = b.dataset.v;
        document.querySelectorAll('#prepPicks .veg-pick').forEach((x) => x.setAttribute('aria-pressed', x === b));
      }
    });

    // 計画タブ
    $('view-plan').addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const a = b.dataset.act;
      if (a === 'autofill') autoFillPlan();
      else if (a === 'per') { state.plan.perDay = parseInt(b.dataset.v, 10); save(); renderPlan(); }
      else if (a === 'confirm') planConfirm(parseInt(b.dataset.day, 10));
      else if (a === 'plan-edit') openPlanMeal(parseInt(b.dataset.day, 10), parseInt(b.dataset.mid, 10));
      else if (a === 'plan-new') openPlanMeal(parseInt(b.dataset.day, 10), null);
      else if (a === 'plan-mealdel') planDeleteMeal(parseInt(b.dataset.day, 10), parseInt(b.dataset.mid, 10));
      else if (a === 'serve') planServe(parseInt(b.dataset.day, 10), parseInt(b.dataset.mid, 10));
      else if (a === 'buy') planBuy(b.dataset.veg);
      else if (a === 'prep-add') openPrep();
      else if (a === 'prep-edit') openPrep(b.dataset.id);
      else if (a === 'prep-del') delPrep(b.dataset.id);
      else if (a === 'prep-make') makeFromPrep(b.dataset.id);
      else if (a === 'prep-suggest') openPrep(null, b.dataset.veg, b.dataset.cat, parseInt(b.dataset.qty, 10) || undefined);
    });

    // 各シートのステッパー（数の増減）
    document.querySelectorAll('[data-step]').forEach((b) =>
      b.addEventListener('click', () => stepField(b.dataset.step, parseInt(b.dataset.dir, 10)))
    );

    // セグメント切り替え
    wireSeg('makeStore', (v) => (makeStore = v));
    wireSeg('ingStore', (v) => (ingStore = v));
    wireSeg('serveSlot', (v) => (serveSlot = v));
    wireSeg('editSlot', (v) => (editSlot = v));
    wireSeg('batchStore', (v) => (batchStore = v));
    wireSeg('batchCat', (v) => (batchCat = v));

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

    // あげるシート：数の増減・直接記録
    $('serveList').addEventListener('click', (e) => {
      const b = e.target.closest('[data-serve-step]');
      if (b) serveStep(b, parseInt(b.dataset.serveStep, 10));
    });
    $('serveList').addEventListener('input', (e) => {
      if (e.target.matches('input')) serveTotal();
    });
    $('directAdd').addEventListener('click', addDirect);
    $('directName').addEventListener('input', serveTotal);
    $('directChips').addEventListener('click', (e) => {
      const b = e.target.closest('[data-direct-del]');
      if (b) removeDirect(parseInt(b.dataset.directDel, 10));
    });

    // きろく編集シート：品目の増減・追加
    $('editList').addEventListener('click', (e) => {
      const b = e.target.closest('[data-edit-step]');
      if (!b) return;
      const row = b.closest('[data-edit-idx]');
      const i = parseInt(row.dataset.editIdx, 10);
      editItems[i].qty = Math.max(0, (editItems[i].qty || 0) + parseInt(b.dataset.editStep, 10));
      renderEditList();
    });
    $('editList').addEventListener('input', (e) => {
      if (!e.target.matches('input')) return;
      const row = e.target.closest('[data-edit-idx]');
      if (!row) return;
      editItems[parseInt(row.dataset.editIdx, 10)].qty = Math.max(0, parseInt(e.target.value, 10) || 0);
    });
    $('editAdd').addEventListener('click', editAddItem);

    // 食材タブ：追加・編集・削除・ストック化
    $('view-ingredients').addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'add-ing') openIng();
      else if (b.dataset.act === 'ing-make') openMake(b.dataset.id);
      else if (b.dataset.act === 'ing-edit') openIng(b.dataset.id);
      else if (b.dataset.act === 'ing-del') delIng(b.dataset.id);
    });

    // 在庫タブ：ストック編集・削除
    $('view-stock').addEventListener('click', (e) => {
      const ed = e.target.closest('[data-edit-batch]');
      if (ed) {
        openEditBatch(ed.dataset.editBatch);
        return;
      }
      const b = e.target.closest('[data-del]');
      if (b) delBatch(b.dataset.del);
    });

    // きろく：編集・取り消し
    $('historyBox').addEventListener('click', (e) => {
      const ed = e.target.closest('[data-edit]');
      if (ed) {
        openEditMeal(ed.dataset.edit);
        return;
      }
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

  /* ---------- 共有バックエンドとの接続点（src/sync.js が利用） ---------- */
  window.BabyFoodApp = {
    // クラウドへ流す現在の状態。
    snapshot() {
      return state;
    },
    // クラウド側の状態を取り込んで再描画する。
    applyRemote(incoming) {
      state = normalize(incoming);
      recPerDay = state.settings.recPerDay;
      persistLocal();
      renderAll();
    },
    // 共有バックエンドを接続/切断する（null で切断＝以後ローカルのみ）。
    connect(remoteApi) {
      remote = remoteApi;
    },
  };

  /* ---------- 起動 ---------- */
  function boot() {
    const d = new Date();
    const w = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
    $('today').textContent = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${w}）`;
    load();
    wire();
    renderAll();
    switchTab('stock'); // 起動時は在庫タブを表示
  }

  boot();
})();
