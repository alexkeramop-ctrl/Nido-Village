/* Nido Village PWA. Σκόπιμα ΔΕΝ κρατά σελίδες ή δεδομένα (παραγγελίες/ταμείο πρέπει να είναι πάντα ζωντανά):
   κρατά μόνο τη σελίδα «εκτός σύνδεσης» και το σήμα, και τα δείχνει όταν μια πλοήγηση αποτύχει. */
const CACHE = "nido-offline-v2";
const ASSETS = ["/offline", "/brand/mark.webp"];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(() => caches.match("/offline")));
    return;
  }
  if (req.method === "GET" && new URL(req.url).pathname === "/brand/mark.webp") {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
  }
});
