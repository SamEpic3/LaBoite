// Serveur de « La boîte » : sert les pages du jeu et gère les salles multijoueurs.
// Aucune dépendance : seulement Node.js (version 18 ou plus).
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { brancherWebSocket } = require("./websocket.js");
const Hote = require("./public/js/hote.js");

const PORT = Number(process.env.PORT) || 3000;
const DOSSIER_PUBLIC = path.join(__dirname, "public");
const TEST = process.env.LABOITE_TEST === "1"; // délais très courts pour les tests automatiques
const DELAIS_PERMIS = [0, 15, 30, 60]; // secondes par tour choisies par l'hôte (0 = illimité)
const MAX_HUMAINS = 8;
const DUREE_VIE_SALLE_VIDE = 10 * 60 * 1000;

// ---------- Fichiers statiques ----------

const TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".txt": "text/plain; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
};

const serveur = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/sante") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        return res.end("ok");
    }
    let chemin = decodeURIComponent(url.pathname);
    if (chemin.endsWith("/")) chemin += "index.html";
    const fichier = path.normalize(path.join(DOSSIER_PUBLIC, chemin));
    if (!fichier.startsWith(DOSSIER_PUBLIC + path.sep)) {
        res.writeHead(403);
        return res.end();
    }
    fs.readFile(fichier, (err, contenu) => {
        if (err) {
            res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
            return res.end("Page introuvable");
        }
        const ext = path.extname(fichier).toLowerCase();
        res.writeHead(200, {
            "Content-Type": TYPES[ext] || "application/octet-stream",
            "Cache-Control": ext === ".png" || ext === ".jpg" ? "public, max-age=86400" : "no-cache",
        });
        res.end(contenu);
    });
});

// ---------- Salles ----------

const salles = new Map();
const LETTRES = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // sans I ni O pour éviter la confusion avec 1 et 0

function nouveauCode() {
    let code;
    do {
        code = Array.from({ length: 4 }, () => LETTRES[crypto.randomInt(LETTRES.length)]).join("");
    } while (salles.has(code));
    return code;
}

const nouveauJeton = () => crypto.randomBytes(16).toString("hex");

// Mot de passe d'une partie : on garde seulement une empreinte salée, jamais le mot de passe lui-même.
function empreinte(motDePasse, sel) {
    // (SHA-256 salé : rapide, pour ne pas bloquer le serveur; les essais sont limités plus bas)
    return crypto.createHmac("sha256", sel).update(String(motDePasse)).digest();
}
function verifierMotDePasse(salle, essai) {
    if (!salle.motDePasse) return true;
    const e = empreinte(essai || "", salle.motDePasse.sel);
    return crypto.timingSafeEqual(e, salle.motDePasse.empreinte);
}

// ---------- Liste des parties ouvertes ----------
// Les joueurs sur l'écran d'accueil reçoivent la liste en direct.

const observateurs = new Set();
let listeEnAttente = false;

function listeSalles() {
    return [...salles.values()]
        .filter((s) => !s.partie && s.joueurs.length < MAX_HUMAINS && s.joueurs.some((j) => j.conn))
        .map((s) => ({
            code: s.code,
            nom: s.nom,
            joueurs: s.joueurs.map((j) => j.nom),
            places: s.config.nb,
            ptsMax: s.config.ptsMax,
            delai: s.config.delai,
            protegee: !!s.motDePasse,
        }));
}

function diffuserListe() {
    if (listeEnAttente) return;
    listeEnAttente = true;
    setImmediate(() => {
        listeEnAttente = false;
        const msg = { t: "liste", salles: listeSalles() };
        observateurs.forEach((c) => c.envoyer(msg));
    });
}

function nettoyerNom(nom) {
    const n = String(nom || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 14);
    return n || "Joueur";
}

function nomUnique(salle, nom) {
    const pris = new Set(salle.joueurs.map((j) => j.nom.toLowerCase()));
    if (!pris.has(nom.toLowerCase())) return nom;
    for (let k = 2; ; k++) if (!pris.has(`${nom} ${k}`.toLowerCase())) return `${nom} ${k}`;
}

// L'hôte de la salle : le créateur, ou le premier joueur encore connecté s'il est parti.
function hoteDe(salle) {
    const createur = salle.joueurs.find((j) => j.jeton === salle.jetonHote);
    if (createur && createur.conn) return createur;
    const remplacant = salle.joueurs.find((j) => j.conn);
    if (remplacant) salle.jetonHote = remplacant.jeton;
    return remplacant || createur;
}

function diffuserSalle(salle) {
    const hote = hoteDe(salle);
    salle.joueurs.forEach((j) => {
        if (!j.conn) return;
        j.conn.envoyer({
            t: "salle",
            code: salle.code,
            nomSalle: salle.nom,
            protegee: !!salle.motDePasse,
            jeton: j.jeton,
            nom: j.nom,
            estHote: j === hote,
            enJeu: !!salle.partie,
            config: salle.config,
            joueurs: salle.joueurs.map((k) => ({ nom: k.nom, connecte: !!k.conn, hote: k === hote })),
        });
    });
    diffuserListe();
}

function demarrerPartie(salle) {
    const { nb, ptsMax, delai } = salle.config;
    // Après ce délai, l'ordinateur joue à la place du joueur (null = pas de limite)
    const delaiTour = delai ? (TEST ? 300 : delai * 1000) : null;
    const total = Math.max(nb, salle.joueurs.length);
    salle.partie = new Hote({
        joueurs: Hote.completerAvecIA(salle.joueurs.map((j) => ({ nom: j.nom, avatar: "lettre" })), total),
        ptsMax,
        delaiTour,
        ...(TEST ? { delaiIA: 5, delaiBoite: 5, delaiManche: 20 } : {}),
        envoyer: (i, msg) => {
            const j = salle.joueurs[i];
            if (j && j.conn) j.conn.envoyer(msg);
        },
    });
    salle.joueurs.forEach((j, i) => {
        if (!j.conn) salle.partie.joueurs[i].connecte = false;
    });
    diffuserSalle(salle);
    salle.partie.demarrer();
    console.log(`[${salle.code}] partie lancée : ${total} joueurs dont ${salle.joueurs.length} humains`);
}

// volontaire : le joueur a cliqué sur « Quitter » (sinon sa connexion a simplement coupé)
function quitter(salle, joueur, volontaire = false) {
    const i = salle.joueurs.indexOf(joueur);
    if (i === -1) return;
    joueur.conn = null;
    if (salle.partie) {
        // En pleine partie, on garde la place : l'ordinateur joue pour lui jusqu'à son retour.
        salle.partie.setConnecte(i, false);
    } else if (volontaire) {
        salle.joueurs.splice(i, 1);
    } else {
        // Dans la salle d'attente, on garde la place 30 s (le temps de recharger la page).
        clearTimeout(joueur.depart);
        joueur.depart = setTimeout(() => {
            if (!joueur.conn && !salle.partie) quitter(salle, joueur, true);
        }, 30000);
    }
    if (!salle.joueurs.some((j) => j.conn)) salle.videDepuis = Date.now();
    if (salle.joueurs.length === 0) supprimerSalle(salle);
    else diffuserSalle(salle);
}

function supprimerSalle(salle) {
    if (salle.partie) salle.partie.detruire();
    salles.delete(salle.code);
    diffuserListe();
    console.log(`[${salle.code}] salle fermée`);
}

setInterval(() => {
    const maintenant = Date.now();
    salles.forEach((salle) => {
        if (!salle.joueurs.some((j) => j.conn) && maintenant - salle.videDepuis > DUREE_VIE_SALLE_VIDE) supprimerSalle(salle);
    });
}, 60000).unref();

// ---------- Messages des joueurs ----------

brancherWebSocket(serveur, "/ws", (conn) => {
    let salle = null;
    let joueur = null;
    let essaisRates = 0;
    let bloqueJusqua = 0;
    const erreur = (msg, extra = {}) => conn.envoyer({ t: "erreur", msg, ...extra });

    conn.on("message", (texte) => {
        let m;
        try {
            m = JSON.parse(texte);
        } catch (e) {
            return;
        }
        if (!m || typeof m.t !== "string") return;

        if (m.t === "lister") {
            observateurs.add(conn);
            conn.envoyer({ t: "liste", salles: listeSalles() });
            return;
        }

        if (m.t === "creer") {
            if (joueur) quitter(salle, joueur, true);
            const nom = nettoyerNom(m.nom);
            const motDePasse = typeof m.motDePasse === "string" ? m.motDePasse.slice(0, 30) : "";
            salle = {
                code: nouveauCode(),
                nom: `Partie de ${nom}`,
                joueurs: [],
                config: { nb: 4, ptsMax: 200, delai: 30 },
                partie: null,
                videDepuis: Date.now(),
                motDePasse: null,
            };
            if (motDePasse) {
                const sel = crypto.randomBytes(16);
                salle.motDePasse = { sel, empreinte: empreinte(motDePasse, sel) };
            }
            observateurs.delete(conn);
            joueur = { jeton: nouveauJeton(), nom, conn };
            salle.jetonHote = joueur.jeton;
            salle.joueurs.push(joueur);
            salles.set(salle.code, salle);
            console.log(`[${salle.code}] salle créée par ${joueur.nom}`);
            return diffuserSalle(salle);
        }

        if (m.t === "rejoindre") {
            const s = salles.get(String(m.code || "").toUpperCase().trim());
            if (!s) return erreur("Cette partie n'existe plus.", { introuvable: true });
            const ancien = m.jeton && s.joueurs.find((j) => j.jeton === m.jeton);
            if (ancien) {
                // Retour d'un joueur (rechargement de la page, réseau coupé…) : pas besoin du mot de passe
                observateurs.delete(conn);
                const vieille = ancien.conn;
                ancien.conn = conn;
                clearTimeout(ancien.depart);
                if (vieille && vieille !== conn) vieille.fermer(4000);
                salle = s;
                joueur = ancien;
                diffuserSalle(s);
                if (s.partie) s.partie.setConnecte(s.joueurs.indexOf(ancien), true);
                return;
            }
            if (s.partie) return erreur("Cette partie est déjà commencée.", { introuvable: true });
            if (s.joueurs.length >= MAX_HUMAINS) return erreur("Cette partie est pleine.");
            if (s.motDePasse) {
                // Quelques essais seulement, pour décourager qui voudrait deviner le mot de passe
                if (Date.now() < bloqueJusqua) return erreur("Trop d'essais. Attends une minute.", { motDePasse: true, code: s.code });
                if (!verifierMotDePasse(s, m.motDePasse)) {
                    if (++essaisRates >= 5) {
                        essaisRates = 0;
                        bloqueJusqua = Date.now() + 60000;
                    }
                    return erreur(m.motDePasse ? "Mot de passe incorrect." : "Cette partie demande un mot de passe.", { motDePasse: true, code: s.code });
                }
            }
            essaisRates = 0;
            observateurs.delete(conn);
            if (joueur) quitter(salle, joueur, true);
            salle = s;
            joueur = { jeton: nouveauJeton(), nom: nomUnique(s, nettoyerNom(m.nom)), conn };
            s.joueurs.push(joueur);
            if (s.config.nb < s.joueurs.length) s.config.nb = s.joueurs.length;
            return diffuserSalle(s);
        }

        if (!salle || !joueur) return erreur("Tu n'es dans aucune salle.");
        const estHote = hoteDe(salle) === joueur;

        switch (m.t) {
            case "config":
                if (!estHote || salle.partie) return;
                salle.config = {
                    nb: Math.max(2, salle.joueurs.length, Math.min(8, Number(m.nb) || 4)),
                    ptsMax: [100, 200, 300, 500].includes(Number(m.ptsMax)) ? Number(m.ptsMax) : 200,
                    delai: DELAIS_PERMIS.includes(Number(m.delai)) ? Number(m.delai) : 30,
                };
                return diffuserSalle(salle);
            case "demarrer":
                if (!estHote) return erreur("Seul l'hôte peut démarrer la partie.");
                if (salle.partie) return;
                return demarrerPartie(salle);
            case "jouer": {
                if (!salle.partie) return;
                const e = salle.partie.action(salle.joueurs.indexOf(joueur), m.carte || {});
                if (e) erreur(e);
                return;
            }
            case "rejouer":
                if (!estHote || !salle.partie) return;
                salle.partie.rejouer();
                return;
            case "quitter":
                quitter(salle, joueur, true);
                salle = joueur = null;
                observateurs.add(conn);
                conn.envoyer({ t: "liste", salles: listeSalles() });
                return;
        }
    });

    conn.on("close", () => {
        observateurs.delete(conn);
        if (salle && joueur && joueur.conn === conn) quitter(salle, joueur);
    });
});

serveur.listen(PORT, () => console.log(`La boîte roule sur http://localhost:${PORT}/`));
