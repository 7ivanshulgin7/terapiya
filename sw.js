// Терапия — service worker: офлайн-кэш + пуш-уведомления
const VERSION = 'tp-5';
const CACHE = 'terapiya-' + VERSION;
const API = 'https://functions.yandexcloud.net/d4elpg9r75i48or6lqpi'; // тот же адрес, что API_URL в index.html
const FILES = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png', './icon-180.png', './badge-96.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  // сеть первой — чтобы новая версия подхватывалась сразу; без сети — из кэша
  e.respondWith(
    fetch(e.request).then((r) => { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('./index.html')))
  );
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
        try { await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'snooze', uid: d.uid, item: { ts: 0, title: d.title, body: d.body, ids: d.ids, date: d.date } }) }); } catch (err) {}
      }
      return;
    }
    if (wins.length) { wins[0].focus(); return; }
    await self.clients.openWindow('./');
  })());
});
