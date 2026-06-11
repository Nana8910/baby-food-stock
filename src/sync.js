/**
 * 家族での共有（Firebase Firestore + 匿名認証 + スペースコード）。
 *
 * 仕組み：
 *  - 端末ごとに「スペースコード（合言葉）」を localStorage に持つ。
 *  - 同じコードの端末は Firestore の spaces/{コード} を共有して読み書きする。
 *  - 変更は onSnapshot でリアルタイムに各端末へ反映される。
 *
 * 画面側（src/app.js）とは window.BabyFoodApp 経由でやり取りする：
 *  - BabyFoodApp.snapshot()        … いまのローカル状態を取得（新規スペースの初期化に使う）
 *  - BabyFoodApp.applyRemote(state) … クラウドの状態を取り込み再描画
 *  - BabyFoodApp.connect(api|null)  … 保存先としてクラウドを接続/切断
 *
 * ※ Firebase が使えない（未設定・オフライン・認証未許可）場合でも、
 *    アプリは src/app.js 側のローカル保存だけで通常どおり動く。
 */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-app.js';
import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyDi7AmtzIpJdBmGfFAQOGXFbI6kPq0gr1Y',
  authDomain: 'baby-food-management.firebaseapp.com',
  projectId: 'baby-food-management',
  storageBucket: 'baby-food-management.firebasestorage.app',
  messagingSenderId: '1024446392118',
  appId: '1:1024446392118:web:60de1c6a2d0b07527b7597',
  measurementId: 'G-SV6GBCMNZ7',
};

const SPACE_KEY = 'babyfood:space';
// 紛らわしい文字（0/O/1/I）を除いたコード用アルファベット。
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

let db = null;
let currentCode = null;
let unsubscribe = null;

/* ---------- ヘルパー ---------- */
function genCode() {
  const arr = new Uint32Array(12);
  crypto.getRandomValues(arr);
  let s = '';
  for (let i = 0; i < 12; i++) {
    s += ALPHABET[arr[i] % ALPHABET.length];
    if (i % 4 === 3 && i < 11) s += '-'; // ABCD-EFGH-JKLM
  }
  return s;
}
function normCode(v) {
  return (v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}
function withMeta(state) {
  return {
    ingredients: state.ingredients || [],
    batches: state.batches || [],
    meals: state.meals || [],
    settings: state.settings || {},
    updatedAt: serverTimestamp(),
  };
}
function stripMeta(d) {
  const { updatedAt, ...rest } = d || {};
  return rest;
}
function banner(msg, ms) {
  const t = document.getElementById('toast');
  if (!t) {
    console.log('[sync]', msg);
    return;
  }
  t.textContent = msg;
  t.classList.add('on');
  setTimeout(() => t.classList.remove('on'), ms || 3500);
}

/* ---------- スペース接続 ---------- */
// mode: 'create' | 'join' | 'resume'
async function connectSpace(rawCode, mode) {
  const code = normCode(rawCode);
  if (code.length < 10) {
    banner('コードが正しくありません');
    return false;
  }
  const ref = doc(db, 'spaces', code);

  let snap;
  try {
    snap = await getDoc(ref);
  } catch (e) {
    console.error('[sync] getDoc failed', e);
    banner('共有に接続できませんでした（設定/ルールをご確認ください）', 5000);
    return false;
  }

  if (snap.exists()) {
    // 既存スペース：クラウドのデータを採用。
    window.BabyFoodApp.applyRemote(stripMeta(snap.data()));
  } else if (mode === 'join') {
    // 参加しようとしたコードのデータが無い（打ち間違い等）。
    banner('そのコードの共有データが見つかりません');
    return false;
  } else {
    // 新規作成 / 再開：いまの端末のデータでスペースを作る。
    try {
      await setDoc(ref, withMeta(window.BabyFoodApp.snapshot()));
    } catch (e) {
      console.error('[sync] seed failed', e);
      banner('共有の作成に失敗しました（ルールをご確認ください）', 5000);
      return false;
    }
  }

  // リアルタイム購読（自分の書き込みのこだまは無視）。
  if (unsubscribe) unsubscribe();
  unsubscribe = onSnapshot(
    ref,
    (s) => {
      if (s.metadata.hasPendingWrites) return;
      if (s.exists()) window.BabyFoodApp.applyRemote(stripMeta(s.data()));
    },
    (e) => console.error('[sync] onSnapshot error', e)
  );

  // 保存先としてクラウドを接続。
  window.BabyFoodApp.connect({
    write: async (state) => {
      try {
        await setDoc(ref, withMeta(state));
      } catch (e) {
        console.error('[sync] write failed', e);
      }
    },
  });

  currentCode = code;
  localStorage.setItem(SPACE_KEY, code);
  updateShareButton();
  return true;
}

function leaveSpace() {
  localStorage.removeItem(SPACE_KEY);
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  currentCode = null;
  window.BabyFoodApp.connect(null); // 以後ローカルのみ
  updateShareButton();
}

/* ---------- UI（既存の .scrim / .sheet / .save 等のクラスを流用） ---------- */
function makeScrim() {
  const scrim = document.createElement('div');
  scrim.className = 'scrim on';
  scrim.addEventListener('click', (e) => {
    if (e.target === scrim) scrim.remove();
  });
  document.body.appendChild(scrim);
  return scrim;
}

function showGate() {
  const scrim = makeScrim();
  scrim.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="共有">
    <div class="grab"></div>
    <h2>家族でデータを共有する</h2>
    <p class="note" style="margin-top:0">同じ「共有コード」を入れた端末どうしで、在庫・きろくを共有します。</p>
    <button class="save" data-act="create">＋ 新しく共有を作る</button>
    <label style="margin-top:18px">すでにコードがある場合</label>
    <input data-el="code" placeholder="共有コードを入力（例：ABCD-EFGH-JKLM）" autocapitalize="characters" autocomplete="off" />
    <button class="save" data-act="join" style="background:var(--surface);color:var(--leaf-dark);border:1.5px solid var(--leaf)">このコードで参加</button>
    <button class="save" data-act="skip" style="background:transparent;color:var(--ink-soft);box-shadow:none;margin-top:6px">いまは共有しない（この端末だけ）</button>
    <p class="note">※コードを知っている人は同じデータにアクセスできます。家族だけに共有してください。</p>
  </div>`;
  scrim.querySelector('[data-act="create"]').onclick = async () => {
    const code = genCode();
    if (await connectSpace(code, 'create')) {
      scrim.remove();
      showCodeDialog(code, true);
    }
  };
  scrim.querySelector('[data-act="join"]').onclick = async () => {
    const v = scrim.querySelector('[data-el="code"]').value;
    if (await connectSpace(v, 'join')) scrim.remove();
  };
  scrim.querySelector('[data-act="skip"]').onclick = () => scrim.remove();
}

function showCodeDialog(code, justCreated) {
  const scrim = makeScrim();
  scrim.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="共有コード">
    <div class="grab"></div>
    <h2>${justCreated ? '共有を作成しました' : '共有コード'}</h2>
    <p class="note" style="margin-top:0">この「共有コード」を家族に伝えると、同じデータを使えます。</p>
    <input data-el="code" readonly value="${code || ''}" style="text-align:center;font-family:'M PLUS Rounded 1c';font-weight:800;letter-spacing:.08em" />
    <button class="save" data-act="copy">コードをコピー</button>
    <button class="save" data-act="leave" style="background:var(--surface);color:var(--ink-soft);border:1.5px solid var(--line);margin-top:10px">別のコードに切り替え／退出</button>
    <button class="save" data-act="close" style="background:transparent;color:var(--ink-soft);box-shadow:none;margin-top:6px">閉じる</button>
    <p class="note">※コードを知っている人は同じデータにアクセスできます。</p>
  </div>`;
  const copyBtn = scrim.querySelector('[data-act="copy"]');
  copyBtn.onclick = async () => {
    try {
      await navigator.clipboard.writeText(code);
      copyBtn.textContent = 'コピーしました ✓';
    } catch (e) {
      scrim.querySelector('[data-el="code"]').select();
    }
  };
  scrim.querySelector('[data-act="close"]').onclick = () => scrim.remove();
  scrim.querySelector('[data-act="leave"]').onclick = () => {
    if (!confirm('この端末の共有を解除します。別のコードに入り直せます。よろしいですか？')) return;
    leaveSpace();
    scrim.remove();
    showGate();
  };
}

function updateShareButton() {
  const btn = document.getElementById('shareBtn');
  if (!btn) return;
  btn.hidden = false;
  btn.textContent = currentCode ? '👨‍👩‍👧 共有中' : '🔗 共有する';
}
function setupShareButton() {
  const btn = document.getElementById('shareBtn');
  if (!btn) return;
  updateShareButton();
  btn.onclick = () => (currentCode ? showCodeDialog(currentCode, false) : showGate());
}

/* ---------- 起動 ---------- */
async function main() {
  try {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    await signInAnonymously(getAuth(app));
  } catch (e) {
    console.error('[sync] Firebase 初期化/認証に失敗', e);
    banner('クラウド接続に失敗（この端末だけで動作中）', 5000);
    return; // アプリはローカルで通常どおり動く
  }

  setupShareButton();

  const saved = localStorage.getItem(SPACE_KEY);
  if (saved) {
    await connectSpace(saved, 'resume');
  } else {
    showGate();
  }
}

main();
