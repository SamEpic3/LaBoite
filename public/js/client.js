// Interface d'une partie en cours : reçoit les messages de l'hôte (local ou serveur),
// anime les coups, affiche les messages, le pointage et les fins de manche.
(function () {
    "use strict";
    const { nomCarteArticle } = Regles;
    const PETIT_ECRAN = "(max-width: 600px), (max-height: 500px)";
    const AVATARS = ["georges", "francis", "mike", "paul", "aline", "jocelyne", "claudette", "richard"];

    const el = (tag, attrs = {}, ...enfants) => {
        const e = document.createElement(tag);
        Object.entries(attrs).forEach(([k, v]) => (k === "class" ? (e.className = v) : k.startsWith("on") ? (e[k] = v) : e.setAttribute(k, v)));
        enfants.forEach((c) => e.append(c));
        return e;
    };

    class ClientJeu {
        // envoyer(carte) : envoie le coup du joueur local
        // rejouer() : relance une partie (null si ce joueur ne peut pas le faire)
        // menu() : retour au menu
        // suivante() : passe à la manche suivante (null = elle part toute seule après un décompte)
        // arreter() : arrête la partie (null = pas de bouton)
        constructor({ conteneur, envoyer, rejouer, menu, suivante = null, arreter = null }) {
            this.envoyer = envoyer;
            this.rejouer = rejouer;
            this.menu = menu;
            this.suivante = suivante;
            this.arreter = arreter;
            this.file = [];
            this.occupe = false;
            this.vue = null;
            this.verrou = false;
            this.dernierMessage = "";

            this.canvas = el("canvas");
            this.info = el("div", { class: "info" });
            this.pointage = el("div", { class: "pointage" });
            this.fenetre = el("div", { class: "fenetre cache" });
            this.boutonArret = el("button", { class: "bouton-coin cache", onclick: () => this.confirmerArret() }, "Arrêter");
            conteneur.append(this.canvas, this.info, this.pointage, this.boutonArret, this.fenetre);

            this.rendu = new Rendu(this.canvas);
            this.rendu.surCarte = (carte, jouable) => this.clicCarte(carte, jouable);
            this.pret = this.rendu.charger(AVATARS);
            setInterval(() => this.majInfo(), 250);
            window.addEventListener("resize", () => this.mesurerHaut());
        }

        clicCarte(carte, jouable) {
            const v = this.vue;
            if (!v || v.phase !== "jeu" || this.verrou) return;
            if (v.tour !== v.moi) return this.flash("Attends ton tour.");
            if (!jouable) return this.flash("Cette carte ne peut pas être jouée maintenant.");
            this.verrou = true; // empêche de jouer deux cartes pendant l'animation
            this.envoyer(carte);
        }

        flash(texte) {
            this.alerte = { texte, jusqua: performance.now() + 2000 };
            this.majInfo();
        }

        erreur(texte) {
            this.verrou = false;
            this.flash(texte);
        }

        recevoir(msg) {
            this.file.push(msg);
            this.traiterFile();
        }

        async traiterFile() {
            if (this.occupe) return;
            this.occupe = true;
            await this.pret;
            while (this.file.length) {
                const msg = this.file.shift();
                // S'il y a du retard (onglet caché, réseau lent), on saute les animations.
                const rapide = this.file.length > 2;
                try {
                    await this.traiter(msg, rapide);
                } catch (e) {
                    console.error(e);
                }
            }
            this.occupe = false;
        }

        async traiter({ ev, etat }, rapide) {
            etat.recuA = performance.now();
            const ancienne = this.vue;
            const nom = (i) => (i === etat.moi ? "Tu" : etat.joueurs[i].nom);

            if (!rapide && ancienne) {
                if (ev.type === "jouer") await this.rendu.animerCarte(ancienne, etat, ev.joueur, ev.carte);
                else if (ev.type === "boite") await this.rendu.animerBoite(etat, ev.de, ev.a);
                else if (ev.type === "manche") {
                    this.fenetre.classList.add("cache");
                    const vide = { ...etat, table: [] };
                    this.rendu.setVue(vide);
                    await new Promise((ok) => setTimeout(ok, 400));
                    await this.rendu.animerCarte(null, etat, ev.joueur, ev.carte);
                }
            }
            if (ev.type === "jouer") {
                const qui = ev.joueur === etat.moi ? "Tu joues" : `${etat.joueurs[ev.joueur].nom} joue`;
                this.dernierMessage = ev.tempsEcoule && ev.joueur === etat.moi
                    ? `Temps écoulé : l'ordinateur a joué ${nomCarteArticle(ev.carte)} pour toi.`
                    : `${qui} ${nomCarteArticle(ev.carte)}.`;
            } else if (ev.type === "boite") {
                const verbe = ev.de === ev.a ? "garde" : "prend";
                this.dernierMessage = ev.a === etat.moi
                    ? `Tu ne peux pas jouer : tu ${verbe}s la boîte.`
                    : `${nom(ev.a)} ne peut pas jouer et ${verbe} la boîte.`;
            } else if (ev.type === "arret") {
                this.dernierMessage = "Partie arrêtée.";
            } else if (ev.type === "manche") {
                this.fenetre.classList.add("cache");
                this.dernierMessage = ev.joueur === etat.moi
                    ? "Manche " + etat.manche + " : tu avais le 7 de cœur, tu as la boîte."
                    : `Manche ${etat.manche} : ${etat.joueurs[ev.joueur].nom} avait le 7 de cœur et a la boîte.`;
            }

            this.vue = etat;
            this.verrou = false;
            this.majPointage();
            this.majInfo();
            this.rendu.setVue(etat);
            this.boutonArret.classList.toggle("cache", !this.arreter || etat.phase === "finPartie");
            if (etat.phase === "finManche" && ancienne && ancienne.phase === "jeu") this.afficherFinManche(etat);
            if (etat.phase === "finManche" && !ancienne) this.afficherFinManche(etat);
            if (etat.phase === "finPartie") this.afficherFinPartie(etat);
        }

        majInfo() {
            const v = this.vue;
            if (!v) return;
            let ligne2 = "";
            if (v.phase === "jeu") {
                if (v.tour === v.moi) {
                    if (v.jouables.length === 0) ligne2 = "Tu ne peux pas jouer…";
                    else {
                        ligne2 = "À toi de jouer !";
                        if (v.resteMs != null) {
                            const s = Math.ceil(Math.max(0, v.resteMs - (performance.now() - v.recuA)) / 1000);
                            ligne2 += ` (${s} s)`;
                        }
                    }
                } else {
                    ligne2 = `Au tour de ${v.joueurs[v.tour].nom}`;
                }
            }
            const alerte = this.alerte && this.alerte.jusqua > performance.now() ? this.alerte.texte : "";
            this.info.innerHTML = "";
            this.info.append(
                el("div", {}, this.dernierMessage),
                el("div", { class: v.tour === v.moi && v.phase === "jeu" ? "ton-tour" : "" }, ligne2),
            );
            if (alerte) this.info.append(el("div", { class: "alerte" }, alerte));
            this.mesurerHaut();
        }

        // Les joueurs du haut se placent sous les panneaux de texte.
        mesurerHaut() {
            // Sur petit écran, le pointage est replié : seul son titre compte (ouvert, il passe par-dessus).
            const petit = matchMedia(PETIT_ECRAN).matches;
            const pointage = petit && this.pointage.firstChild ? this.pointage.firstChild : this.pointage;
            const bas = Math.max(this.info.getBoundingClientRect().bottom, pointage.getBoundingClientRect().bottom + (petit ? 6 : 0));
            const reserve = Math.ceil(bas / 10) * 10; // arrondi pour éviter que tout bouge à chaque message
            if (reserve > (this.rendu.hautReserve || 0) || reserve < (this.rendu.hautReserve || 0) - 20) {
                this.rendu.hautReserve = reserve;
                this.rendu.dessiner();
            }
        }

        majPointage() {
            const v = this.vue;
            this.pointage.innerHTML = "";
            this.pointage.onclick = () => this.pointage.classList.toggle("ouvert");
            this.pointage.append(el("div", { class: "titre" }, `Manche ${v.manche} · fin à ${v.ptsMax}`));
            v.joueurs.forEach((j, i) => {
                this.pointage.append(
                    el("div", { class: "ligne" + (i === v.moi ? " moi" : "") },
                        el("span", {}, j.nom + (i === v.boite ? " 📦" : "")),
                        el("span", {}, String(j.points)))
                );
            });
        }

        tableauPoints(v) {
            const m = v.derniereManche; // absent si la partie a été arrêtée en pleine manche
            const ordre = v.joueurs.map((j, i) => i).sort((a, b) => v.joueurs[a].points - v.joueurs[b].points);
            return el("table", {},
                el("tr", {}, el("th", {}, "Joueur"), ...(m ? [el("th", {}, "Manche")] : []), el("th", {}, "Total")),
                ...ordre.map((i) => el("tr", { class: i === v.moi ? "moi" : "" },
                    el("td", {}, v.joueurs[i].nom + (i === v.boite ? " 📦" : "")),
                    ...(m ? [el("td", {}, "+" + m.points[i])] : []),
                    el("td", {}, String(v.joueurs[i].points))))
            );
        }

        afficherFinManche(v) {
            const m = v.derniereManche;
            const qui = m.gagnant === v.moi ? "Tu n'as plus de cartes !" : `${v.joueurs[m.gagnant].nom} n'a plus de cartes.`;
            const titre = el("h2", {}, `Fin de la manche ${v.manche}`);
            const texte = el("p", {}, qui + " La boîte vaut 20 points.");
            if (this.suivante) {
                // En solo, on prend le temps de regarder le pointage.
                const boutons = el("div", { class: "boutons" },
                    el("button", { onclick: (e) => { e.target.disabled = true; this.suivante(); } }, "Manche suivante"));
                if (this.arreter) boutons.append(el("button", { class: "secondaire", onclick: () => this.arreter() }, "Arrêter la partie"));
                this.ouvrirFenetre(titre, texte, this.tableauPoints(v), boutons);
                return;
            }
            const decompte = el("p", { class: "petit" });
            const fin = performance.now() + v.delaiManche;
            const maj = () => {
                const s = Math.ceil((fin - performance.now()) / 1000);
                decompte.textContent = s > 0 ? `Prochaine manche dans ${s} s…` : "Distribution…";
                if (s > 0 && !this.fenetre.classList.contains("cache")) setTimeout(maj, 250);
            };
            this.ouvrirFenetre(titre, texte, this.tableauPoints(v), decompte);
            maj();
        }

        afficherFinPartie(v) {
            const noms = v.vainqueurs.map((i) => (i === v.moi ? "toi" : v.joueurs[i].nom));
            const liste = noms.length > 1 ? noms.slice(0, -1).join(", ") + " et " + noms.at(-1) : noms[0];
            const titre = noms.length > 1
                ? `Égalité : ${liste}`
                : v.vainqueurs[0] === v.moi ? "Tu as gagné ! 🎉" : `Victoire : ${liste}`;
            const boutons = el("div", { class: "boutons" });
            if (this.rejouer) boutons.append(el("button", { onclick: () => this.rejouer() }, "Rejouer"));
            else boutons.append(el("p", { class: "petit" }, "En attente de l'hôte pour rejouer…"));
            boutons.append(el("button", { class: "secondaire", onclick: () => this.menu() }, "Menu principal"));
            this.ouvrirFenetre(
                el("h2", {}, titre),
                el("p", {}, v.arretee
                    ? "Partie arrêtée. Le plus petit pointage gagne (la manche en cours ne compte pas)."
                    : `Quelqu'un a atteint ${v.ptsMax} points. Le plus petit pointage gagne.`),
                this.tableauPoints(v),
                boutons
            );
        }

        confirmerArret() {
            this.ouvrirFenetre(
                el("h2", {}, "Arrêter la partie ?"),
                el("p", {}, "Le joueur qui a le moins de points maintenant gagne. La manche en cours ne compte pas."),
                el("div", { class: "boutons" },
                    el("button", { onclick: () => this.arreter() }, "Arrêter la partie"),
                    el("button", { class: "secondaire", onclick: () => this.fenetre.classList.add("cache") }, "Continuer à jouer"))
            );
        }

        ouvrirFenetre(...contenu) {
            this.fenetre.innerHTML = "";
            this.fenetre.append(el("div", { class: "boite-dialogue" }, ...contenu));
            this.fenetre.classList.remove("cache");
        }
    }

    window.ClientJeu = ClientJeu;
    window.creerElement = el;
})();
