// Interface d'une partie en cours : reçoit les messages de l'hôte (local ou serveur),
// anime les coups, affiche les messages, le pointage et les fins de manche.
(function () {
    "use strict";
    const { nomCarteArticle, REACTIONS } = Regles;
    // Une couleur par joueur (graphique des points)
    const COULEURS_JOUEURS = ["#ffd23f", "#ff7a8a", "#7fd6ff", "#b8f28c", "#d7a6ff", "#ffa94d", "#ffffff", "#4ef0c8"];
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
        // reagir(id) : envoie une réaction (null = pas de bouton de réactions)
        constructor({ conteneur, envoyer, rejouer, menu, suivante = null, arreter = null, reagir = null }) {
            this.reagir = reagir;
            this.sons = window.Sons ? new Sons() : null;
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
            // En bas à droite : le son, et les réactions en multijoueur
            this.boutonSon = el("button", { class: "bouton-rond", title: "Son", onclick: () => this.basculerSon() });
            this.coinDroit = el("div", { class: "coin-droit" });
            this.palette = el("div", { class: "palette cache" });
            if (reagir) {
                REACTIONS.forEach((texte, id) =>
                    this.palette.append(el("button", { onclick: () => this.envoyerReaction(id) }, texte)));
                this.coinDroit.append(el("button", {
                    class: "bouton-rond", title: "Réactions",
                    onclick: () => this.palette.classList.toggle("cache"),
                }, "😀"));
            }
            this.coinDroit.append(this.boutonSon);
            this.majBoutonSon();
            conteneur.append(this.canvas, this.info, this.pointage, this.boutonArret, this.coinDroit, this.palette, this.fenetre);

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
            // Les réactions s'affichent tout de suite, sans attendre les animations
            if (msg.t === "reaction") return this.afficherReaction(msg);
            this.file.push(msg);
            this.traiterFile();
        }

        son(nom) {
            if (this.sons) this.sons.jouer(nom);
        }

        basculerSon() {
            if (this.sons) this.sons.basculer();
            this.majBoutonSon();
        }

        majBoutonSon() {
            this.boutonSon.textContent = this.sons && this.sons.actif ? "🔊" : "🔇";
        }

        envoyerReaction(id) {
            this.palette.classList.add("cache");
            if (performance.now() - (this.derniereReaction || 0) < 1000) return;
            this.derniereReaction = performance.now();
            this.reagir(id);
        }

        // Bulle au-dessus de l'avatar du joueur, pendant quelques secondes
        afficherReaction({ joueur, id }) {
            if (!this.vue || !REACTIONS[id] || !this.vue.joueurs[joueur]) return;
            const r = this.rendu;
            const p = r.posAvatar(joueur);
            const bulle = el("div", { class: "bulle" }, REACTIONS[id]);
            document.body.append(bulle);
            const l = bulle.offsetWidth;
            const x = Math.min(innerWidth - l / 2 - 6, Math.max(l / 2 + 6, p.x + r.avatar / 2));
            const enBas = joueur === this.vue.moi;
            bulle.style.left = x + "px";
            bulle.style.top = (enBas ? p.y - r.texte * 1.2 : p.y + r.avatar + r.texte * 2.2) + "px";
            if (enBas) bulle.classList.add("vers-haut");
            this.son("reaction");
            setTimeout(() => bulle.classList.add("disparait"), 2400);
            setTimeout(() => bulle.remove(), 2900);
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
                if (ev.type === "jouer") {
                    this.son("carte");
                    await this.rendu.animerCarte(ancienne, etat, ev.joueur, ev.carte);
                } else if (ev.type === "boite") {
                    if (ev.de !== ev.a) this.son("boite");
                    await this.rendu.animerBoite(etat, ev.de, ev.a);
                } else if (ev.type === "manche") {
                    this.fenetre.classList.add("cache");
                    const vide = { ...etat, table: [] };
                    this.rendu.setVue(vide);
                    await new Promise((ok) => setTimeout(ok, 400));
                    this.son("carte");
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
            } else if (ev.type === "arrivee") {
                this.dernierMessage = ev.joueur === etat.moi
                    ? `Tu prends la place de ${ev.ancien}, avec ses cartes et ses points.`
                    : `${etat.joueurs[ev.joueur].nom} prend la place de ${ev.ancien}.`;
            } else if (ev.type === "depart") {
                this.dernierMessage = `${etat.joueurs[ev.joueur].nom} a quitté la partie : l'ordinateur prend sa place.`;
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
            // C'est à moi : petit son (et vibration sur Android)
            const monTour = (v) => v && v.phase === "jeu" && v.tour === v.moi;
            if (monTour(etat) && etat.jouables.length && (!monTour(ancienne) || ev.type === "manche")) {
                this.son("tour");
                if (navigator.vibrate) navigator.vibrate(25);
            }
            const nouvellePhase = !ancienne || ancienne.phase !== etat.phase;
            if (etat.phase === "finManche" && nouvellePhase) {
                this.son("manche");
                this.afficherFinManche(etat);
            }
            if (etat.phase === "finPartie") {
                const gagne = etat.vainqueurs.includes(etat.moi);
                if (nouvellePhase) {
                    this.son(gagne ? "victoire" : "defaite");
                    if (gagne) confettis();
                    this.afficherFinPartie(etat);
                } else if (!this.fenetre.classList.contains("cache") || ev.type === "sync") {
                    this.afficherFinPartie(etat);
                }
            }
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
                    el("td", {}, el("span", { class: "pastille", style: `background:${COULEURS_JOUEURS[i % 8]}` }),
                        v.joueurs[i].nom + (i === v.boite ? " 📦" : "")),
                    ...(m ? [el("td", {}, m.points[i] < 0 ? "−" + -m.points[i] : "+" + m.points[i])] : []),
                    el("td", {}, String(v.joueurs[i].points))))
            );
        }

        afficherFinManche(v) {
            const m = v.derniereManche;
            const qui = m.gagnant === v.moi ? "Tu n'as plus de cartes !" : `${v.joueurs[m.gagnant].nom} n'a plus de cartes.`;
            const titre = el("h2", {}, `Fin de la manche ${v.manche}`);
            const R = v.regles || { boite: 20, bonusFin: 0 };
            const bonus = R.bonusFin ? ` Celui qui finit retire ${R.bonusFin} points.` : "";
            const texte = el("p", {}, `${qui} La boîte vaut ${R.boite} points.${bonus}`);
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
                this.graphique(v),
                this.tableauPoints(v),
                boutons
            );
        }

        // Courbe des points de chaque joueur, manche après manche
        graphique(v) {
            const h = v.historique || [];
            if (h.length < 2) return el("span");
            const NS = "http://www.w3.org/2000/svg";
            const svg = document.createElementNS(NS, "svg");
            const L = 300, H = 130, mg = 22, md = 8, mh = 8, mb = 18;
            svg.setAttribute("viewBox", `0 0 ${L} ${H}`);
            svg.setAttribute("class", "graphique");
            const series = [v.joueurs.map(() => 0), ...h];
            const max = Math.max(v.ptsMax, ...h.flat(), 1);
            const min = Math.min(0, ...h.flat());
            const X = (k) => mg + ((L - mg - md) * k) / (series.length - 1);
            const Y = (p) => H - mb - ((H - mb - mh) * (p - min)) / (max - min);
            const ajouter = (tag, attrs, texte) => {
                const e = document.createElementNS(NS, tag);
                Object.entries(attrs).forEach(([k, val]) => e.setAttribute(k, val));
                if (texte != null) e.textContent = texte;
                svg.append(e);
            };
            // Ligne de fin de partie
            if (!v.arretee) ajouter("line", { x1: mg, x2: L - md, y1: Y(v.ptsMax), y2: Y(v.ptsMax), class: "ligne-fin" });
            ajouter("text", { x: mg - 4, y: Y(v.ptsMax) + 3, class: "axe", "text-anchor": "end" }, v.ptsMax);
            ajouter("text", { x: mg - 4, y: Y(0) + 3, class: "axe", "text-anchor": "end" }, 0);
            series.forEach((_, k) => {
                if (k > 0 && (series.length <= 12 || k % 2 === 0))
                    ajouter("text", { x: X(k), y: H - 4, class: "axe", "text-anchor": "middle" }, k);
            });
            v.joueurs.forEach((j, i) => {
                const points = series.map((s, k) => `${X(k).toFixed(1)},${Y(s[i]).toFixed(1)}`).join(" ");
                ajouter("polyline", {
                    points, fill: "none", stroke: COULEURS_JOUEURS[i % 8],
                    "stroke-width": i === v.moi ? 3 : 2, "stroke-linejoin": "round",
                });
            });
            return svg;
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

    // Confettis à la victoire
    function confettis() {
        if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        const c = el("canvas", { class: "confettis" });
        document.body.append(c);
        const dpr = Math.min(2, devicePixelRatio || 1);
        c.width = innerWidth * dpr;
        c.height = innerHeight * dpr;
        const g = c.getContext("2d");
        g.scale(dpr, dpr);
        const morceaux = Array.from({ length: 160 }, () => ({
            x: Math.random() * innerWidth,
            y: -20 - Math.random() * innerHeight * 0.5,
            vx: (Math.random() - 0.5) * 2,
            vy: 2 + Math.random() * 3,
            r: Math.random() * Math.PI,
            vr: (Math.random() - 0.5) * 0.3,
            t: 5 + Math.random() * 6,
            couleur: COULEURS_JOUEURS[Math.floor(Math.random() * COULEURS_JOUEURS.length)],
        }));
        const t0 = performance.now();
        const image = (t) => {
            const age = t - t0;
            g.clearRect(0, 0, innerWidth, innerHeight);
            g.globalAlpha = Math.max(0, Math.min(1, (4000 - age) / 800));
            morceaux.forEach((m) => {
                m.x += m.vx + Math.sin((age / 300) + m.r) * 0.6;
                m.y += m.vy;
                m.r += m.vr;
                g.save();
                g.translate(m.x, m.y);
                g.rotate(m.r);
                g.fillStyle = m.couleur;
                g.fillRect(-m.t / 2, -m.t / 4, m.t, m.t / 2);
                g.restore();
            });
            if (age < 4000) requestAnimationFrame(image);
            else c.remove();
        };
        requestAnimationFrame(image);
    }

    window.ClientJeu = ClientJeu;
    window.creerElement = el;
})();
