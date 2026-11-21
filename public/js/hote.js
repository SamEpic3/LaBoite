// L'« hôte » fait avancer une partie : il fait jouer l'ordinateur, gère la minuterie,
// enchaîne les manches et envoie à chaque joueur ce qu'il a le droit de voir.
// Le mode solo l'utilise dans le navigateur, le serveur l'utilise pour chaque salle.
(function (racine, fabrique) {
    if (typeof module === "object" && module.exports) module.exports = fabrique(require("./regles.js"));
    else racine.Hote = fabrique(racine.Regles);
})(typeof self !== "undefined" ? self : this, function (Regles) {
    "use strict";

    const NOMS_IA = ["Georges", "Francis", "Mike", "Paul", "Aline", "Jocelyne", "Claudette", "Richard"];

    const REACTIONS = Regles.REACTIONS;

    // Complète la liste de joueurs humains avec des joueurs ordinateur jusqu'à nb.
    function completerAvecIA(humains, nb, alea = Math.random) {
        const pris = new Set(humains.map((h) => h.nom));
        const libres = Regles.melanger(NOMS_IA.filter((n) => !pris.has(n)), alea);
        const joueurs = humains.map((h) => ({ nom: h.nom, ia: false, avatar: h.avatar || "lettre" }));
        while (joueurs.length < nb) {
            const nom = libres.pop() || `Robot ${joueurs.length + 1}`;
            joueurs.push({ nom, ia: true, avatar: NOMS_IA.includes(nom) ? nom.toLowerCase() : "lettre" });
        }
        return joueurs;
    }

    class Hote {
        // joueurs : [{ nom, ia, avatar }]
        // envoyer(indexJoueur, message) : appelé pour chaque joueur humain
        constructor({
            joueurs, ptsMax = 200, envoyer,
            delaiIA = 1000, delaiBoite = 1500,
            delaiManche = 5000, // null = on attend mancheSuivante() (bouton en solo)
            delaiTour = null, // ms pour jouer avant que l'ordinateur joue à sa place (null = illimité)
            regles = {}, // variantes : { boite, as, bonusFin }
            difficulte = "normal", // niveau des joueurs ordinateur : facile, normal ou difficile
            reactionsIA = true, // les ordinateurs réagissent de temps en temps
            alea = Math.random,
        }) {
            this.config = { ptsMax, delaiIA, delaiBoite, delaiManche, delaiTour, regles, difficulte, reactionsIA, alea };
            this.joueurs = joueurs.map((j) => ({ ...j, connecte: !j.ia }));
            this.envoyer = envoyer;
            this.minuterie = null;
            this.echeance = null;
            this.partie = null;
        }

        demarrer() {
            this.partie = new Regles.Partie(
                this.joueurs.map((j) => j.nom), this.config.ptsMax, this.config.alea, this.config.regles
            );
            this.nouvelleManche();
        }

        // Passe à la manche suivante quand on attend un clic (delaiManche = null).
        mancheSuivante() {
            if (this.partie && this.partie.phase === "finManche") this.nouvelleManche();
        }

        // Arrête la partie maintenant : le plus petit pointage actuel gagne.
        arreter() {
            if (!this.partie || this.partie.phase === "finPartie") return;
            this.annulerMinuterie();
            this.partie.arreter();
            this.diffuser({ type: "arret" });
        }

        rejouer() {
            if (this.partie && this.partie.phase !== "finPartie") return;
            this.demarrer();
        }

        nouvelleManche() {
            this.annulerMinuterie();
            const ev = this.partie.nouvelleManche();
            this.diffuser(ev);
            this.planifier();
        }

        // Un joueur humain joue une carte. Retourne un message d'erreur ou null.
        action(i, carte) {
            try {
                const ev = this.partie.jouer(i, carte);
                this.apres(ev);
                return null;
            } catch (e) {
                return e.message;
            }
        }

        // Un joueur se déconnecte ou revient. Absent = l'ordinateur joue pour lui.
        setConnecte(i, connecte) {
            this.joueurs[i].connecte = connecte;
            if (this.partie) {
                if (this.partie.tour === i) this.annulerMinuterie();
                if (connecte) this.envoyer(i, this.message(i, { type: "sync" }));
                if (this.partie.tour === i) this.planifier();
                this.diffuser({ type: "presence", joueur: i });
            }
        }

        // Un nouveau joueur prend la place d'un ordinateur en pleine partie (avec ses cartes et ses points).
        remplacerIA(k, nom) {
            const ancien = this.joueurs[k].nom;
            this.joueurs[k] = { nom, ia: false, avatar: "lettre", connecte: true };
            if (this.partie) {
                this.partie.joueurs[k].nom = nom;
                if (this.partie.tour === k) this.annulerMinuterie();
                this.diffuser({ type: "arrivee", joueur: k, ancien });
                if (this.partie.tour === k) this.planifier();
            }
        }

        // Un joueur quitte la partie pour de bon : l'ordinateur reprend sa place.
        rendreIA(k) {
            this.joueurs[k] = { ...this.joueurs[k], ia: true, connecte: false };
            if (this.partie) {
                if (this.partie.tour === k) this.annulerMinuterie();
                this.diffuser({ type: "depart", joueur: k });
                if (this.partie.tour === k) this.planifier();
            }
        }

        placesIA() {
            return this.joueurs.map((j, k) => (j.ia ? k : -1)).filter((k) => k >= 0);
        }

        // Réaction d'un joueur (index dans REACTIONS), montrée à tout le monde.
        reagir(i, id) {
            if (!Number.isInteger(id) || id < 0 || id >= REACTIONS.length) return;
            this.joueurs.forEach((j, k) => {
                if (!j.ia) this.envoyer(k, { t: "reaction", joueur: i, id });
            });
        }

        // De temps en temps, un ordinateur réagit à ce qui lui arrive.
        reactionIA(ev) {
            if (!this.config.reactionsIA || !this.partie) return;
            const hasard = this.config.alea;
            let qui = -1;
            let id = -1;
            if (ev.type === "boite" && ev.de !== ev.a && this.joueurs[ev.a].ia && hasard() < 0.35) {
                qui = ev.a;
                id = hasard() < 0.5 ? 2 : 1;
            } else if (ev.type === "jouer" && this.partie.phase !== "jeu" && this.joueurs[ev.joueur].ia && hasard() < 0.6) {
                qui = ev.joueur;
                id = 7;
            }
            if (qui >= 0) setTimeout(() => this.reagir(qui, id), 500);
        }

        apres(ev) {
            this.annulerMinuterie(); // l'ancienne minuterie ne doit pas apparaître dans le nouvel état
            this.diffuser(ev);
            this.reactionIA(ev);
            this.planifier();
        }

        annulerMinuterie() {
            clearTimeout(this.minuterie);
            this.minuterie = null;
            this.echeance = null;
        }

        planifier() {
            this.annulerMinuterie();
            const p = this.partie;
            if (!p) return;
            if (p.phase === "finManche") {
                if (this.config.delaiManche != null)
                    this.minuterie = setTimeout(() => this.nouvelleManche(), this.config.delaiManche);
                return;
            }
            if (p.phase !== "jeu") return;
            const i = p.tour;
            const joueur = this.joueurs[i];
            if (!p.peutJouer(i)) {
                // Personne ne choisit de passer : si on ne peut pas jouer, on prend la boîte.
                this.minuterie = setTimeout(() => this.apres(p.prendreBoite(i)), this.config.delaiBoite);
            } else if (joueur.ia || !joueur.connecte) {
                this.minuterie = setTimeout(() => this.jouerPourLui(i), this.config.delaiIA);
            } else if (this.config.delaiTour) {
                this.echeance = Date.now() + this.config.delaiTour;
                this.minuterie = setTimeout(() => this.jouerPourLui(i, true), this.config.delaiTour);
                // On renvoie l'état pour que tout le monde voie la minuterie.
                this.diffuser({ type: "minuterie", joueur: i });
            }
        }

        jouerPourLui(i, tempsEcoule = false) {
            // Les ordinateurs jouent à leur niveau; pour un humain absent ou trop lent, niveau normal.
            const niveau = this.joueurs[i].ia ? this.config.difficulte : "normal";
            const ev = this.partie.jouer(i, this.partie.choixIA(i, niveau));
            if (tempsEcoule) ev.tempsEcoule = true;
            this.apres(ev);
        }

        diffuser(ev) {
            this.joueurs.forEach((j, i) => {
                if (!j.ia) this.envoyer(i, this.message(i, ev));
            });
        }

        // Ce que le joueur i a le droit de voir : sa main, mais seulement le nombre de cartes des autres.
        message(i, ev) {
            const p = this.partie;
            return {
                t: "etat",
                ev,
                etat: {
                    moi: i,
                    joueurs: this.joueurs.map((j, k) => ({
                        nom: j.nom,
                        ia: j.ia,
                        avatar: j.avatar,
                        connecte: j.connecte,
                        nbCartes: p.joueurs[k].cartes.length,
                        points: p.joueurs[k].points,
                    })),
                    main: Regles.trierMain(p.joueurs[i].cartes),
                    jouables: p.phase === "jeu" && p.tour === i ? p.jouables(i) : [],
                    table: [...p.table],
                    tour: p.tour,
                    boite: p.boite,
                    phase: p.phase,
                    manche: p.manche,
                    ptsMax: p.ptsMax,
                    derniereManche: p.derniereManche,
                    vainqueurs: p.vainqueurs,
                    arretee: !!p.arretee,
                    historique: p.historique,
                    regles: p.regles,
                    difficulte: this.config.difficulte,
                    resteMs: this.echeance ? Math.max(0, this.echeance - Date.now()) : null,
                    delaiTour: this.config.delaiTour,
                    delaiManche: this.config.delaiManche,
                },
            };
        }

        detruire() {
            this.annulerMinuterie();
            this.partie = null;
        }
    }

    Hote.completerAvecIA = completerAvecIA;
    Hote.NOMS_IA = NOMS_IA;
    Hote.REACTIONS = REACTIONS;
    return Hote;
});
