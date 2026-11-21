// L'« hôte » fait avancer une partie : il fait jouer l'ordinateur, gère la minuterie,
// enchaîne les manches et envoie à chaque joueur ce qu'il a le droit de voir.
// Le mode solo l'utilise dans le navigateur, le serveur l'utilise pour chaque salle.
(function (racine, fabrique) {
    if (typeof module === "object" && module.exports) module.exports = fabrique(require("./regles.js"));
    else racine.Hote = fabrique(racine.Regles);
})(typeof self !== "undefined" ? self : this, function (Regles) {
    "use strict";

    const NOMS_IA = ["Georges", "Francis", "Mike", "Paul", "Aline", "Jocelyne", "Claudette", "Richard"];

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
            alea = Math.random,
        }) {
            this.config = { ptsMax, delaiIA, delaiBoite, delaiManche, delaiTour, alea };
            this.joueurs = joueurs.map((j) => ({ ...j, connecte: !j.ia }));
            this.envoyer = envoyer;
            this.minuterie = null;
            this.echeance = null;
            this.partie = null;
        }

        demarrer() {
            this.partie = new Regles.Partie(this.joueurs.map((j) => j.nom), this.config.ptsMax, this.config.alea);
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
                if (connecte) this.envoyer(i, this.message(i, { type: "sync" }));
                if (this.partie.tour === i) this.planifier();
                this.diffuser({ type: "presence", joueur: i });
            }
        }

        apres(ev) {
            this.annulerMinuterie(); // l'ancienne minuterie ne doit pas apparaître dans le nouvel état
            this.diffuser(ev);
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
            const ev = this.partie.jouer(i, this.partie.choixIA(i));
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
    return Hote;
});
