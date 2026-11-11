// Терапия — service worker: офлайн-кэш + пуш-уведомления
const VERSION = 'tp-7';
const PREFIX = 'terapiya-';
const CACHE = PREFIX + VERSION;
const FONTS = PREFIX + 'fonts'; // шрифты Google — отдельный кэш, при обновлении не удаляется
const API = 'https://functions.yandexcloud.net/d4elpg9r75i48or6lqpi'; // тот же адрес, что API_URL в index.html
const FILES = ['./index.html', './', './manifest.json', './icon-192.png', './icon-512.png', './icon-180.png', './badge-96.png'];
const NET_TIMEOUT = 6000;
const FONT_TIMEOUT = 1000;

// fetch с таймаутом: при «глючной» сети не висим 20 с
function fetchT(req, ms, opts) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('timeout')), ms);
    fetch(req, opts).then((r) => { clearTimeout(t); res(r); }, (e) => { clearTimeout(t); rej(e); });
  });
}

// install: по одному файлу; без index.html — ошибка, остаётся старая рабочая версия
self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.allSettled(FILES.map((f) => fetch(f, { cache: 'no-store' }).then((r) => { if (r.ok) return c.put(f, r); throw new Error(f); })));
    if (!(await c.match('./index.html'))) throw new Error('index.html не закэширован');
    await self.skipWaiting();
  })());
});

// activate: удаляем только СВОИ старые кэши (на сайте живут и другие приложения)
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k.indexOf(PREFIX) === 0 && k !== CACHE && k !== FONTS).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const OFFLINE_HTML = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Терапия — нет связи</title><style>body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;background:#0F1715;color:#E7EFEC;font:16px system-ui,sans-serif;text-align:center;padding:24px;box-sizing:border-box}
h1{font-size:22px;margin:0}p{margin:0;color:#9AADA6;max-width:320px;line-height:1.4}button{height:48px;padding:0 22px;border:0;border-radius:14px;background:#2DD4BF;color:#06201C;font:inherit;font-weight:700}</style></head>
<body><h1>Нет связи</h1><p>Приложение ещё не сохранилось на телефоне. Подключитесь к интернету и попробуйте снова.</p><button onclick="location.reload()">Попробовать ещё раз</button></body></html>`;

async function fromAnyCache() {
  // во ВСЕХ кэшах: ключ — полный адрес /terapiya/index.html, чужие приложения не зацепит
  return (await caches.match('./index.html', { ignoreSearch: true })) || (await caches.match('./', { ignoreSearch: true }));
}
async function refreshIndex() {
  try {
    const r = await fetchT('./index.html', NET_TIMEOUT * 2, { cache: 'no-store' });
    if (r.ok) { const c = await caches.open(CACHE); await c.put('./index.html', r.clone()); await c.put('./', r); }
  } catch (err) {}
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);

  // шрифты Google: из кэша; нет — ждём сеть ≤1 с, потом пустой CSS (страница не висит на стилях)
  if (u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com') {
    e.respondWith((async () => {
      const hit = await caches.match(req, { cacheName: FONTS });
      if (hit) return hit;
      try {
        const r = await fetchT(req, FONT_TIMEOUT);
        if (r.ok || r.type === 'opaque') { const cp = r.clone(); e.waitUntil(caches.open(FONTS).then((c) => c.put(req, cp))); }
        return r;
      } catch (err) {
        return u.hostname === 'fonts.googleapis.com'
          ? new Response('', { status: 200, headers: { 'Content-Type': 'text/css' } })
          : new Response('', { status: 504 });
      }
    })());
    return;
  }

  if (u.origin !== location.origin) return;

  // навигация: сразу из кэша + фоновое обновление index.html
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      const hit = await fromAnyCache();
      if (hit) { e.waitUntil(refreshIndex()); return hit; }
      try {
        const r = await fetchT(req, NET_TIMEOUT);
        if (r.ok) { const cp = r.clone(); e.waitUntil(caches.open(CACHE).then((c) => c.put('./index.html', cp))); }
        return r;
      } catch (err) {
        return new Response(OFFLINE_HTML, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
    })());
    return;
  }

  // свои файлы: кэш (без учёта ?v=), иначе сеть ≤6 с и в кэш
  e.respondWith((async () => {
    const hit = await caches.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const r = await fetchT(req, NET_TIMEOUT);
      if (r.ok) { const cp = r.clone(); e.waitUntil(caches.open(CACHE).then((c) => c.put(req, cp))); }
      return r;
    } catch (err) {
      return new Response('', { status: 504 });
    }
  })());
});

// --- Пуш ---
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: 'Терапия', body: e.data ? e.data.text() : '' }; }
  const hasIds = d.ids && d.ids.length;
  e.waitUntil(self.registration.showNotification(d.title || 'Терапия', {
    body: d.body || '',
    icon: './icon-192.png',
    badge: './badge-96.png',
    tag: 'tp-' + (d.date || '') + '-' + (d.ids || []).join(','),
    renotify: true,
    requireInteraction: true,
    vibrate: [200, 100, 200],
    data: d,
    actions: hasIds ? [{ action: 'done', title: 'Принял' }, { action: 'snooze', title: '+15 мин' }] : [],
  }));
});

// Отметки «Принял», сделанные из уведомления, складываем в IndexedDB — приложение заберёт их при открытии
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('terapiya', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('pending', { autoIncrement: true });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function addPending(rec) {
  const db = await idb();
  await new Promise((res, rej) => { const tx = db.transaction('pending', 'readwrite'); tx.objectStore('pending').add(rec); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
}
self.addEventListener('notificationclick', (e) => {
  const d = e.notification.data || {};
  e.notification.close();
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (e.action === 'done') {
      await addPending({ date: d.date, ids: d.ids });
      wins.forEach((w) => w.postMessage({ type: 'pending' }));
      return;
    }
    if (e.action === 'snooze') {
      if (d.uid && API.indexOf('http') === 0) {
        try { await fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'snooze', uid: d.uid, item: { ts: 0, title: d.title, body: d.body, ids: d.ids, date: d.date } }) }); } catch (err) {}
      }
      return;
    }
    if (wins.length) { wins[0].focus(); return; }
    await self.clients.openWindow('./');
  })());
});
