/* ==========================================================
   Service Worker — 離線支援

   策略刻意選「網路優先、離線才回退快取」，而不是一般 PWA 常見的
   快取優先。這個 app 靠 GitHub Pages 持續更新，快取優先會讓使用者
   被鎖在舊版程式碼裡，而且很難自己救回來（強制重新整理也未必有用，
   因為回應是 service worker 給的，根本沒碰到網路）。

   代價是連線正常時不會變快——對這個 app 來說無所謂，反正資料都在
   本機 localStorage，網路只負責抓靜態檔。換來的是「更新一定拿得到」。
   ========================================================== */

const VERSION = 'v103';
const CACHE = 'worldbuilder-' + VERSION;

// 離線時要能完整開起來所需的檔案
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './ui-tokens.css',
  './style.css',
  './js/state.js',
  './js/storage.js',
  './js/main.js',
  './js/documents.js',
  './js/doc-table.js',
  './js/directory.js',
  './js/search.js',
  './js/modal.js',
  './js/import-export.js',
  './js/canvas.js',
  './js/api.js',
  './js/gdrive.js',
  './js/sync-merge.js',
  './js/sync.js',
  './js/theme.js',
  './js/app.js',
  './icons/favicon-16.png',
  './icons/favicon-32.png',
  './icons/favicon-48.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      // 個別加入而不是 addAll：任何一個檔案失敗都會讓 addAll 整批拒絕，
      // 導致 service worker 安裝不起來，離線功能整個沒有。
      return Promise.all(SHELL.map(function (url) {
        return cache.add(url).catch(function () { /* 單一檔案失敗不影響其他 */ });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.map(function (name) {
        if (name !== CACHE) return caches.delete(name);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

/* 讓頁面問得到「正在服務你的這個 worker 是哪一版」。

   設定裡那一行版本不能只顯示「伺服器上最新是哪一版」——使用者還沒換版的
   時候，那個數字會是新的、他跑的卻是舊的，正好在最需要它的時候說謊。
   要判斷「我是不是最新版」，得拿這裡回報的值跟伺服器上的比。 */
self.addEventListener('message', function (event) {
  if (!event.data || event.data.type !== 'GET_VERSION') return;
  if (event.ports && event.ports[0]) event.ports[0].postMessage({ version: VERSION });
});

self.addEventListener('fetch', function (event) {
  const req = event.request;

  // 只處理自家的 GET。Supabase、Google API、Google Fonts 等跨網域請求
  // 一律放行讓瀏覽器自己處理——快取它們只會造成同步拿到過期資料。
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(req).then(function (res) {
      // 只快取正常的同源回應，避免把錯誤頁或不透明回應存進去
      if (res && res.status === 200 && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then(function (cache) { cache.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) {
        if (hit) return hit;
        // 導覽請求（例如離線時直接開 app）退回快取的首頁
        if (req.mode === 'navigate') return caches.match('./index.html');
        return new Response('', { status: 504, statusText: 'Offline' });
      });
    })
  );
});
