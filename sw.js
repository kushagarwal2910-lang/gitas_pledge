/* Service worker: cache the app shell so it works fully offline. */
const CACHE = 'ga-pledge-v7';
const ASSETS = [
  './',
  './index.html',
  './app.css',
  './app.js',
  './manifest.webmanifest',
  './icon.svg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  e.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          // Cache same-origin successful responses for next time.
          if (res && res.status === 200 && new URL(req.url).origin === self.location.origin) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
    })
  );
});

/* ---- daily background due-date check + notifications ---- */
self.addEventListener('periodicsync', (e) => {
  if (e.tag === 'ga-due-check') e.waitUntil(checkDueAndNotify());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cl) => {
      for (const c of cl) { if ('focus' in c) return c.focus(); }
      if (self.clients.openWindow) return self.clients.openWindow('./');
    })
  );
});

function swOpenDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('ga_pledge_db', 1);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function swGetAll(db, store) {
  return new Promise((res) => {
    try {
      const rq = db.transaction(store, 'readonly').objectStore(store).getAll();
      rq.onsuccess = () => res(rq.result || []);
      rq.onerror = () => res([]);
    } catch (e) { res([]); }
  });
}
function swMaturity(iso) {
  if (!iso) return null;
  const p = String(iso).split('-').map(Number);
  if (p.length !== 3 || !p[0]) return null;
  const d = new Date(p[0], p[1] - 1, p[2]);
  d.setMonth(d.getMonth() + 6);
  d.setHours(0, 0, 0, 0);
  return d;
}
async function checkDueAndNotify() {
  try {
    const db = await swOpenDB();
    const pledges = await swGetAll(db, 'pledges');
    const settingsArr = await swGetAll(db, 'settings');
    let win = 7;
    if (settingsArr[0] && settingsArr[0].reminderDays) win = parseInt(settingsArr[0].reminderDays, 10) || 7;
    const t = new Date(); t.setHours(0, 0, 0, 0);
    let overdue = 0, due = 0;
    pledges.forEach((p) => {
      if (p.deleted || p.status === 'redeemed') return;
      const m = swMaturity(p.date);
      if (!m) return;
      const d = Math.round((m.getTime() - t.getTime()) / 86400000);
      if (d < 0) overdue++; else if (d <= win) due++;
    });
    if (overdue + due > 0) {
      const parts = [];
      if (overdue) parts.push(overdue + ' overdue');
      if (due) parts.push(due + ' due soon');
      await self.registration.showNotification('Pledge reminders', {
        body: parts.join(' · ') + ' — tap to review.',
        icon: './icon.svg', badge: './icon.svg', tag: 'ga-due', renotify: true
      });
    }
  } catch (e) {}
}
