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
    const NOMS_SORTES = { Clubs: "trèfle", Diamonds: "carreau", Hearts: "cœur", Spades: "pique" };
    const NOMS_VALEURS = { a: "As", j: "Valet", q: "Dame", k: "Roi" };
    // Réactions toutes faites (multijoueur, et parfois les ordinateurs)
    const REACTIONS = ["👍 Bien joué !", "😅 Oups", "😱 Ah non…", "📦 La boîte !", "😂", "🔥", "⏳ Vite !", "😎"];

    const memeCarte = (a, b) => a.suit === b.suit && a.value === b.value;
    const rang = (carte) => VALEURS.indexOf(carte.value);
    // Règles par défaut; l'hôte peut choisir des variantes.
    const REGLES_DEFAUT = { boite: 20, as: 15, bonusFin: 0 };
    const pointsCarte = (carte, regles = REGLES_DEFAUT) => (carte.value === "a" ? regles.as : POINTS[rang(carte)]);
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
        // regles : { boite: points de la boîte, as: points de l'as, bonusFin: points retirés à celui qui finit }
        constructor(noms, ptsMax = 200, alea = Math.random, regles = {}) {
            if (noms.length < 2 || noms.length > 8) throw new Error("Il faut de 2 à 8 joueurs");
            this.alea = alea;
            this.ptsMax = ptsMax;
            this.regles = { ...REGLES_DEFAUT, ...regles };
            this.historique = []; // total de chaque joueur après chaque manche
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
            const R = this.regles;
            const points = this.joueurs.map(
                (j, i) =>
                    j.cartes.reduce((t, c) => t + pointsCarte(c, R), 0) +
                    (i === this.boite ? R.boite : 0) -
                    (i === gagnant ? R.bonusFin : 0)
            );
            this.joueurs.forEach((j, i) => (j.points += points[i]));
            this.historique.push(this.joueurs.map((j) => j.points));
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

        // Choix de l'ordinateur selon son niveau :
        // - facile : une carte permise au hasard
        // - normal : la carte qui vaut le plus de points
        // - difficile : joue comme un vrai joueur (voir noteCarte)
        choixIA(i, niveau = "normal") {
            const jouables = this.jouables(i);
            if (jouables.length === 0) return null;
            const auHasard = (liste) => liste[Math.floor(this.alea() * liste.length)];
            if (niveau === "facile") return auHasard(jouables);
            const note = niveau === "difficile"
                ? (c) => this.noteCarte(i, c)
                : (c) => pointsCarte(c, this.regles);
            const notes = jouables.map(note);
            const max = Math.max(...notes);
            return auHasard(jouables.filter((c, k) => notes[k] === max));
        }

        // Valeur d'un coup pour l'ordinateur difficile. Poser une carte rend la suivante jouable :
        // tant mieux si c'est la mienne (je pourrai continuer), tant pis si c'est celle d'un autre
        // (je lui fais un cadeau). Il faut aussi ouvrir le chemin vers mes cartes plus loin dans
        // la sorte, et se débarrasser des cartes qui valent cher.
        noteCarte(i, carte) {
            const main = this.joueurs[i].cartes;
            const r = rang(carte);
            const sorte = this.table.filter((c) => c.suit === carte.suit).map(rang);
            const directions = sorte.length === 0 ? [-1, 1] : [r < Math.min(...sorte) ? -1 : 1];
            const aMoi = (rg) => main.some((c) => c.suit === carte.suit && rang(c) === rg);
            // Poids trouvés par simulation (des milliers de manches contre le niveau normal)
            let note = pointsCarte(carte, this.regles) / 4;
            directions.forEach((d) => {
                const suivante = r + d;
                if (suivante < 0 || suivante > 12) return;
                note += aMoi(suivante) ? 4 : -4;
                for (let k = suivante + d; k >= 0 && k <= 12; k += d) if (aMoi(k)) note += 2;
            });
            return note;
        }
    }

    return {
        SORTES, VALEURS, POINTS,
        REGLES_DEFAUT, REACTIONS, Partie, cartesJouables, trierMain, nouveauPaquet, melanger,
        memeCarte, pointsCarte, nomCarte, nomCarteArticle,
    };
});
