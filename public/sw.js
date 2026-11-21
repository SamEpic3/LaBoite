// Service worker de La boîte : permet d'installer le jeu et de jouer en solo sans Internet.
// Stratégie « réseau d'abord » pour les pages et le code : on a toujours la dernière version
// quand on est en ligne, et la copie en cache sert seulement hors ligne.
// Changer VERSION quand la liste de FICHIERS change.
const VERSION = "laboite-v1";
const FICHIERS = [
    "./", "./index.html", "./solo.html", "./multi.html", "./style.css", "./manifest.webmanifest",
    "./solo.js", "./multi.js", "./js/regles.js", "./js/hote.js", "./js/rendu.js", "./js/client.js", "./js/pwa.js",
    "./images/cards_spritesheet.png", "./images/box_petit.png",
    "./images/avatars/georges.png", "./images/avatars/francis.png", "./images/avatars/mike.png",
    "./images/avatars/paul.png", "./images/avatars/aline.png", "./images/avatars/jocelyne.png",
    "./images/avatars/claudette.png", "./images/avatars/richard.png",
    "./icons/icone-192.png", "./icons/icone-512.png", "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
    e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FICHIERS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
    e.waitUntil(
        caches.keys()
            .then((cles) => Promise.all(cles.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", (e) => {
    const req = e.request;
    const url = new URL(req.url);
    if (req.method !== "GET" || url.origin !== location.origin || url.pathname === "/ws") return;

    // Images : cache d'abord (elles ne changent presque jamais)
    if (/\.(png|jpg|svg)$/.test(url.pathname)) {
        e.respondWith(caches.match(req).then((trouve) => trouve || fetch(req).then((r) => garder(req, r))));
        return;
    }
    // Pages et code : réseau d'abord, cache si hors ligne
    e.respondWith(
        fetch(req)
            .then((r) => garder(req, r))
            .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match("./index.html")))
    );
});

function garder(req, reponse) {
    if (reponse.ok) {
        const copie = reponse.clone();
        caches.open(VERSION).then((c) => c.put(req, copie));
    }
    return reponse;
}
