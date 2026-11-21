// Règles du jeu « La boîte ».
// Ce fichier ne touche pas à l'écran : il est utilisé tel quel par le mode solo
// (dans le navigateur) et par le serveur multijoueur (dans Node).
(function (racine, fabrique) {
    const module_ = fabrique();
    if (typeof module === "object" && module.exports) module.exports = module_;
    else racine.Regles = module_;
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    const SORTES = ["Clubs", "Diamonds", "Hearts", "Spades"];
    const VALEURS = ["a", "2", "3", "4", "5", "6", "7", "8", "9", "10", "j", "q", "k"];
    const POINTS = [15, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 10, 10];
    const POINTS_BOITE = 20;
    const NOMS_SORTES = { Clubs: "trèfle", Diamonds: "carreau", Hearts: "cœur", Spades: "pique" };
    const NOMS_VALEURS = { a: "As", j: "Valet", q: "Dame", k: "Roi" };

    const memeCarte = (a, b) => a.suit === b.suit && a.value === b.value;
    const rang = (carte) => VALEURS.indexOf(carte.value);
    const pointsCarte = (carte) => POINTS[rang(carte)];
    const nomCarte = (carte) =>
        `${NOMS_VALEURS[carte.value] || carte.value} de ${NOMS_SORTES[carte.suit]}`;
    // « l'As de cœur », « la Dame de pique », « le 8 de trèfle »
    const nomCarteArticle = (carte) =>
        (carte.value === "a" ? "l'" : carte.value === "q" ? "la " : "le ") + nomCarte(carte);

    function nouveauPaquet() {
        const paquet = [];
        SORTES.forEach((suit) => VALEURS.forEach((value) => paquet.push({ suit, value })));
        return paquet;
    }

    function melanger(cartes, alea = Math.random) {
        const res = [...cartes];
        for (let i = res.length - 1; i > 0; i--) {
            const j = Math.floor(alea() * (i + 1));
            [res[i], res[j]] = [res[j], res[i]];
        }
        return res;
    }

    // Cartes de la main qu'on a le droit de poser sur la table.
    // Un 7 ouvre une nouvelle sorte; sinon on prolonge une sorte déjà ouverte par un bout.
    function cartesJouables(main, table) {
        return main.filter((carte) => {
            const sorte = table.filter((c) => c.suit === carte.suit).map(rang);
            if (sorte.length === 0) return carte.value === "7";
            const r = rang(carte);
            return r === Math.min(...sorte) - 1 || r === Math.max(...sorte) + 1;
        });
    }

    function trierMain(main) {
        return [...main].sort(
            (a, b) => SORTES.indexOf(a.suit) - SORTES.indexOf(b.suit) || rang(a) - rang(b)
        );
    }

    class Partie {
        // noms : liste des noms des joueurs, dans l'ordre où ils sont assis.
        constructor(noms, ptsMax = 200, alea = Math.random) {
            if (noms.length < 2 || noms.length > 8) throw new Error("Il faut de 2 à 8 joueurs");
            this.alea = alea;
            this.ptsMax = ptsMax;
            this.joueurs = noms.map((nom) => ({ nom, cartes: [], points: 0 }));
            this.table = [];
            this.tour = -1;
            this.boite = -1;
            this.manche = 0;
            this.phase = "attente"; // attente | jeu | finManche | finPartie
            this.derniereManche = null; // { gagnant, points: [...] }
            this.vainqueurs = [];
        }

        get nb() {
            return this.joueurs.length;
        }

        suivant(i) {
            return (i + 1) % this.nb;
        }

        // Distribue les cartes. Celui qui a le 7 de cœur le pose et prend la boîte;
        // c'est ensuite au joueur à sa gauche.
        nouvelleManche() {
            if (this.phase === "jeu" || this.phase === "finPartie") throw new Error("Impossible maintenant");
            this.manche++;
            this.table = [];
            this.joueurs.forEach((j) => (j.cartes = []));
            melanger(nouveauPaquet(), this.alea).forEach((carte, i) =>
                this.joueurs[i % this.nb].cartes.push(carte)
            );
            const septCoeur = { suit: "Hearts", value: "7" };
            const porteur = this.joueurs.findIndex((j) => j.cartes.some((c) => memeCarte(c, septCoeur)));
            const main = this.joueurs[porteur].cartes;
            main.splice(main.findIndex((c) => memeCarte(c, septCoeur)), 1);
            this.table.push(septCoeur);
            this.boite = porteur;
            this.tour = this.suivant(porteur);
            this.phase = "jeu";
            this.derniereManche = null;
            return { type: "manche", joueur: porteur, carte: septCoeur };
        }

        jouables(i) {
            return cartesJouables(this.joueurs[i].cartes, this.table);
        }

        peutJouer(i) {
            return this.jouables(i).length > 0;
        }

        verifierTour(i) {
            if (this.phase !== "jeu") throw new Error("La manche n'est pas en cours");
            if (i !== this.tour) throw new Error("Ce n'est pas ton tour");
        }

        jouer(i, carte) {
            this.verifierTour(i);
            const main = this.joueurs[i].cartes;
            const pos = main.findIndex((c) => memeCarte(c, carte));
            if (pos === -1) throw new Error("Tu n'as pas cette carte");
            if (!this.jouables(i).some((c) => memeCarte(c, carte))) throw new Error("Cette carte ne peut pas être jouée");
            const [jouee] = main.splice(pos, 1);
            this.table.push(jouee);
            const ev = { type: "jouer", joueur: i, carte: jouee };
            if (main.length === 0) this.terminerManche(i);
            else this.tour = this.suivant(i);
            return ev;
        }

        // On ne peut pas passer volontairement : on prend la boîte seulement si aucune carte n'est jouable.
        prendreBoite(i) {
            this.verifierTour(i);
            if (this.peutJouer(i)) throw new Error("Tu dois jouer si tu peux jouer");
            const ev = { type: "boite", de: this.boite, a: i };
            this.boite = i;
            this.tour = this.suivant(i);
            return ev;
        }

        terminerManche(gagnant) {
            const points = this.joueurs.map(
                (j, i) => j.cartes.reduce((t, c) => t + pointsCarte(c), 0) + (i === this.boite ? POINTS_BOITE : 0)
            );
            this.joueurs.forEach((j, i) => (j.points += points[i]));
            this.derniereManche = { gagnant, points };
            this.tour = -1;
            if (this.joueurs.some((j) => j.points >= this.ptsMax)) {
                const min = Math.min(...this.joueurs.map((j) => j.points));
                this.vainqueurs = this.joueurs.map((j, i) => (j.points === min ? i : -1)).filter((i) => i >= 0);
                this.phase = "finPartie";
            } else {
                this.phase = "finManche";
            }
        }

        // Fin de partie demandée par le joueur. Les cartes encore en main ne comptent pas.
        arreter() {
            this.tour = -1;
            const min = Math.min(...this.joueurs.map((j) => j.points));
            this.vainqueurs = this.joueurs.map((j, i) => (j.points === min ? i : -1)).filter((i) => i >= 0);
            this.phase = "finPartie";
            this.arretee = true;
        }

        // Choix de l'ordinateur : on se débarrasse de la carte qui vaut le plus de points.
        choixIA(i) {
            const jouables = this.jouables(i);
            if (jouables.length === 0) return null;
            const max = Math.max(...jouables.map(pointsCarte));
            const meilleures = jouables.filter((c) => pointsCarte(c) === max);
            return meilleures[Math.floor(this.alea() * meilleures.length)];
        }
    }

    return {
        SORTES, VALEURS, POINTS, POINTS_BOITE,
        Partie, cartesJouables, trierMain, nouveauPaquet, melanger,
        memeCarte, pointsCarte, nomCarte, nomCarteArticle,
    };
});
