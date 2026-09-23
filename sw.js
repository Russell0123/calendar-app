// Service Worker：網路優先（每次都向伺服器確認最新版），離線時用快取
// 解決 GitHub Pages 快取 10 分鐘導致更新看不到的問題，也讓 App 可以離線開啟
const CACHE = 'calendar-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const same = url.origin === self.location.origin;
  if (!same && url.hostname !== 'cdn.jsdelivr.net') return; // Supabase API 等直接走網路

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      // 同站檔案一律向伺服器確認（有 ETag 時只回 304，很快）
      const fresh = same ? new Request(req.mode === 'navigate' ? url.href : req, { cache: 'no-cache' }) : req;
      const res = await fetch(fresh);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch (err) {
      const hit = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
      if (hit) return hit;
      throw err;
    }
  })());
});
