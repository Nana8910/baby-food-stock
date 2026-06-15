/**
 * Service Worker（キャッシュ対策＋オフライン対応）。
 *
 * 方針：ネットワーク優先（network-first）。
 *  - オンライン時：常に最新を取得して表示（＝更新が確実に反映される）。取得物はキャッシュへ控える。
 *  - オフライン時：直近のキャッシュで動く。ナビゲーションは index.html にフォールバック。
 *  - 同一オリジンのGETのみ対象。Firebase/フォント等の外部や非GETは素通り（介入しない）。
 *
 * network-first なので、デプロイのたびにバージョンを上げ直さなくても最新が反映される。
 * CACHE 名のバージョンは「古いキャッシュの掃除」のために使う。
 */
const VERSION = '2026-06-15';
const CACHE = 'miete-' + VERSION;
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './src/logic.js',
  './src/app.js',
  './src/sync.js',
  './manifest.webmanifest',
  './assets/logo.png',
  './assets/apple-touch-icon.png',
  './assets/icon-192.png',
  './assets/icon-512.png',
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .catch(() => {})
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return; // 非GET（Firestoreの書き込み等）は介入しない
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 外部（Firebase/フォント）は素通り

  e.respondWith(
    (async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone());
        return fresh;
      } catch (err) {
        const cached = await caches.match(req);
        if (cached) return cached;
        if (req.mode === 'navigate') return caches.match('./index.html');
        throw err;
      }
    })()
  );
});
