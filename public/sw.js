/* MoneyControl — Service Worker (offline + instalable)
   Estrategia:
   - Navegación: network-first, con respaldo al index cacheado (la app funciona sin conexión)
   - Estáticos del mismo origen (JS/CSS con hash): cache-first
   - Fuentes de Google: stale-while-revalidate
   - Supabase y otras APIs: solo red (la app lee de localStorage igualmente) */

const CACHE = 'moneycontrol-v1'
const FONTS = 'moneycontrol-fonts-v1'

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'])),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== FONTS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)

  // Supabase: nunca cachear
  if (url.hostname.endsWith('.supabase.co')) return

  // Fuentes de Google: stale-while-revalidate
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(
      caches.open(FONTS).then(async (cache) => {
        const cached = await cache.match(req)
        const net = fetch(req)
          .then((res) => {
            cache.put(req, res.clone())
            return res
          })
          .catch(() => cached)
        return cached || net
      }),
    )
    return
  }

  if (url.origin !== location.origin) return

  // Navegación (SPA): network-first con fallback offline
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put('/', copy))
          return res
        })
        .catch(() => caches.match('/')),
    )
    return
  }

  // Estáticos: cache-first
  e.respondWith(
    caches.match(req).then(
      (cached) =>
        cached ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(req, copy))
          }
          return res
        }),
    ),
  )
})
