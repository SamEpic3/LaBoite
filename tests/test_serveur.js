// Test de bout en bout : démarre le serveur en mode test, joue une partie complète
// à 3 humains (+1 ordinateur), avec une déconnexion/reconnexion et un joueur qui laisse filer le temps.
const { spawn } = require("child_process");
const assert = require("assert");
const path = require("path");
const PORT = 3999;
const srv = spawn("node", [path.join(__dirname, "..", "server.js")], { env: { ...process.env, PORT, LABOITE_TEST: "1" }, stdio: ["ignore", "pipe", "inherit"] });
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

function bot(nom, { paresseux = false } = {}) {
  const b = { nom, msgs: [], salle: null, etat: null };
  b.connecter = () => new Promise((ok) => {
    b.ws = new WebSocket(`ws://localhost:${PORT}/ws`);
    b.ws.onopen = ok;
    b.ws.onmessage = (e) => {
      const m = JSON.parse(e.data); b.msgs.push(m);
      if (m.t === "salle") b.salle = m;
      if (m.t === "liste") b.liste = m.salles;
      if (m.t === "etat") {
        b.etat = m.etat;
        // les autres ne doivent jamais voir ma main
        assert.strictEqual(m.etat.main.length, m.etat.joueurs[m.etat.moi].nbCartes);
        if (m.etat.tour >= 0 && m.etat.joueurs[m.etat.tour].ia) assert.strictEqual(m.etat.resteMs, null, "pas de minuterie pour l'ordinateur");
        const v = m.etat;
        if (!paresseux && v.phase === "jeu" && v.tour === v.moi && v.jouables.length) {
          const c = v.jouables[Math.floor(Math.random() * v.jouables.length)];
          setTimeout(() => b.envoyer({ t: "jouer", carte: c }), 2);
        }
      }
    };
  });
  b.envoyer = (m) => b.ws.readyState === 1 && b.ws.send(JSON.stringify(m));
  return b;
}

(async () => {
  await new Promise((ok) => srv.stdout.once("data", ok));
  // fichiers statiques
  for (const p of ["/", "/solo.html", "/multi.html", "/js/regles.js", "/images/cards_spritesheet.png"]) {
    const r = await fetch(`http://localhost:${PORT}${p}`); assert.strictEqual(r.status, 200, p);
  }
  assert.strictEqual((await fetch(`http://localhost:${PORT}/../server.js`)).status === 200, false);
  for (const p of ["/%2e%2e/server.js", "/..%2fserver.js", "/js/..%2f..%2fserver.js"]) assert.notStrictEqual((await fetch(`http://localhost:${PORT}${p}`)).status, 200, p);

  const a = bot("Sam"), b = bot("Léa"), c = bot("Zoé", { paresseux: true });
  // un observateur regarde la liste des parties
  const obs = bot("Obs"); await obs.connecter(); obs.envoyer({ t: "lister" }); await attendre(100);
  assert.deepStrictEqual(obs.liste, []);
  await a.connecter(); a.envoyer({ t: "creer", nom: "Sam", motDePasse: "secret" }); await attendre(100);
  const code = a.salle.code; assert.match(code, /^[A-Z]{4}$/); assert(a.salle.estHote);
  assert.strictEqual(a.salle.nomSalle, "Partie de Sam"); assert(a.salle.protegee);
  assert.strictEqual(obs.liste.length, 1); assert(obs.liste[0].protegee); assert.deepStrictEqual(obs.liste[0].joueurs, ["Sam"]);
  assert(!JSON.stringify(obs.liste).includes("secret"), "le mot de passe ne circule pas");
  await b.connecter();
  b.envoyer({ t: "rejoindre", code, nom: "Sam" }); await attendre(100);
  assert(!b.salle && b.msgs.at(-1).motDePasse, "mot de passe exigé");
  b.envoyer({ t: "rejoindre", code, nom: "Sam", motDePasse: "mauvais" }); await attendre(100);
  assert(!b.salle && /incorrect/.test(b.msgs.at(-1).msg));
  b.envoyer({ t: "rejoindre", code, nom: "Sam", motDePasse: "secret" }); await attendre(100);
  assert.strictEqual(b.salle.nom, "Sam 2"); // nom unique
  assert.strictEqual(obs.liste[0].joueurs.length, 2, "la liste se met à jour");
  await c.connecter(); c.envoyer({ t: "rejoindre", code: code.toLowerCase(), nom: "Zoé", motDePasse: "secret" }); await attendre(100);
  // trop d'essais : blocage
  const pirate = bot("P"); await pirate.connecter();
  for (let k = 0; k < 6; k++) { pirate.envoyer({ t: "rejoindre", code, nom: "P", motDePasse: "x" + k }); await attendre(20); }
  pirate.envoyer({ t: "rejoindre", code, nom: "P", motDePasse: "secret" }); await attendre(50);
  assert(/Trop d'essais/.test(pirate.msgs.at(-1).msg), "blocage après 5 essais");
  b.envoyer({ t: "demarrer" }); await attendre(50);
  assert(b.msgs.some((m) => m.t === "erreur"), "seul l'hôte démarre");
  a.envoyer({ t: "config", nb: 4, ptsMax: 100 }); await attendre(50);
  assert.strictEqual(c.salle.config.nb, 4);
  a.envoyer({ t: "demarrer" }); await attendre(200);
  assert(c.salle.enJeu);
  assert.deepStrictEqual(obs.liste, [], "une partie commencée n'est plus dans la liste");
  assert.strictEqual(a.etat.joueurs.length, 4);
  assert(a.etat.joueurs[3].ia);
  // un intrus ne peut pas entrer pendant la partie
  const d = bot("Intrus"); await d.connecter(); d.envoyer({ t: "rejoindre", code, nom: "X" }); await attendre(50);
  assert(d.msgs.some((m) => m.t === "erreur" && /commencée/.test(m.msg)));
  // jouer hors tour est refusé
  const hors = [a, b].find((x) => x.etat.phase === "jeu" && x.etat.tour !== x.etat.moi && x.etat.main.length);
  if (hors) { const n = hors.msgs.length; hors.envoyer({ t: "jouer", carte: hors.etat.main[0] }); await attendre(50);
    assert(hors.msgs.slice(n).some((m) => m.t === "erreur")); }
  // déconnexion de B puis retour avec son jeton
  await attendre(300);
  const jetonB = b.salle.jeton; b.ws.close(); await attendre(500);
  assert(a.etat.joueurs[1].connecte === false, "B affiché absent");
  const b2 = bot("Léa"); await b2.connecter(); b2.envoyer({ t: "rejoindre", code, jeton: jetonB }); await attendre(200); // sans mot de passe : le jeton suffit
  assert.strictEqual(b2.salle.nom, "Sam 2"); assert(b2.etat && b2.etat.moi === 1);
  // on laisse la partie se finir
  const t0 = Date.now();
  while (!(a.etat && a.etat.phase === "finPartie")) { await attendre(100); assert(Date.now() - t0 < 120000, "partie trop longue"); }
  assert(c.msgs.some((m) => m.t === "etat" && m.ev.tempsEcoule), "le temps du paresseux a été joué pour lui");
  console.log("partie finie en", Date.now() - t0, "ms,", a.etat.manche, "manches :", a.etat.joueurs.map((j) => j.nom + "=" + j.points).join(" "),
    "vainqueurs", a.etat.vainqueurs.map((i) => a.etat.joueurs[i].nom));
  // rejouer
  a.envoyer({ t: "rejouer" }); await attendre(200);
  assert.strictEqual(a.etat.phase === "jeu" || a.etat.phase === "finManche", true);
  assert(a.etat.joueurs.every((j) => j.points <= 120));
  // partie sans limite de temps : pas de minuterie, l'ordinateur ne joue pas à la place
  const h = bot("H", { paresseux: true }), g = bot("G", { paresseux: true });
  await h.connecter(); h.envoyer({ t: "creer", nom: "H" }); await attendre(80);
  await g.connecter(); g.envoyer({ t: "rejoindre", code: h.salle.code, nom: "G" }); await attendre(80);
  h.envoyer({ t: "config", nb: 2, ptsMax: 100, delai: 0 }); await attendre(50);
  assert.strictEqual(g.salle.config.delai, 0);
  h.envoyer({ t: "demarrer" }); await attendre(1000);
  const vh = h.etat;
  assert.strictEqual(vh.resteMs, null, "pas de minuterie");
  assert.strictEqual(vh.phase, "jeu");
  const nbAvant = vh.joueurs[vh.tour].nbCartes;
  await attendre(800);
  assert.strictEqual(h.etat.joueurs[h.etat.tour].nbCartes, nbAvant, "personne ne joue à la place du joueur");
  console.log("serveur OK");
  srv.kill(); process.exit(0);
})().catch((e) => { console.error(e); srv.kill(); process.exit(1); });
