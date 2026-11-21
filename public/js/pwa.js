// Enregistre le service worker (installation sur l'écran d'accueil, solo hors ligne).
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
