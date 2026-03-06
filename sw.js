const CACHE = "workout-pwa-v12";
const ASSETS = ["./", "./index.html", "./app.css", "./app.js", "./manifest.webmanifest", "./favicon.ico",
  "./icons/icon-192.png", "./icons/icon-512.png"
];

const NETWORK_FIRST = new Set(["./", "./index.html", "./app.css", "./app.js", "./manifest.webmanifest", "./sw.js"]);

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async ()=>{
    const keys = await caches.keys();
    await Promise.all(keys.map(k => k !== CACHE ? caches.delete(k) : null));
    await self.clients.claim();
  })());
});

async function networkFirst(request){
  try{
    const res = await fetch(request, { cache: "no-store" });
    const cache = await caches.open(CACHE);
    cache.put(request, res.clone());
    return res;
  }catch{
    const cached = await caches.match(request);
    if (cached) return cached;
    throw new Error("offline");
  }
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // only handle same-origin
  if (url.origin !== self.location.origin) return;

  const path = url.pathname.endsWith("/") ? "./" : "./" + url.pathname.split("/").pop();
  if (NETWORK_FIRST.has(path) || e.request.destination === "document"){
    e.respondWith(networkFirst(e.request));
    return;
  }
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
