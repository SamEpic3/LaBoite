// Dessin du jeu dans le canvas : table, joueurs, boîte, main et animations.
// Le joueur local (etat.moi) est toujours en bas de l'écran.
(function () {
    "use strict";
    const { SORTES, VALEURS, memeCarte } = Regles;

    const COULEUR_BORD = "#0b4f3f"; // même couleur que le fond de la page (voir style.css)
    const SPRITE_L = 100;
    const SPRITE_H = 144;
    const DUREE_CARTE = 300; // ms
    const DUREE_BOITE = 500; // ms

    function chargerImage(src) {
        return new Promise((ok) => {
            const img = new Image();
            img.onload = () => ok(img);
            img.onerror = () => ok(null); // une image manquante ne bloque pas le jeu
            img.src = src;
        });
    }

    const COULEURS = ["#e85d75", "#5a6acf", "#f29e4c", "#2f9bd8", "#4c8f3a", "#d65db1", "#7b6cf6", "#c0563a"];

    const attendre = (ms) => new Promise((ok) => setTimeout(ok, ms));
    const doux = (t) => 1 - Math.pow(1 - t, 3);

    class Rendu {
        constructor(canvas) {
            this.canvas = canvas;
            this.ctx = canvas.getContext("2d");
            this.vue = null;
            this.zones = []; // cartes cliquables de la main
            this.anim = null; // { carte, x, y } ou { boite: true, x, y }
            this.surCarte = () => {};
            this.redimensionner();
            // Sur iPhone, la taille de l'écran n'est pas toujours à jour au moment de l'événement
            // de rotation : on remesure plusieurs fois, et dès que le canvas change de taille.
            const remesurer = () => {
                this.redimensionner();
                this.dessiner();
            };
            window.addEventListener("resize", remesurer);
            window.addEventListener("orientationchange", () => [50, 250, 600].forEach((ms) => setTimeout(remesurer, ms)));
            if (window.visualViewport) visualViewport.addEventListener("resize", remesurer);
            if (window.ResizeObserver) new ResizeObserver(remesurer).observe(canvas);
            canvas.addEventListener("click", (e) => this.clic(e));
            // Redessine en continu quand une minuterie est affichée.
            setInterval(() => {
                if (this.vue && this.vue.resteMs != null && !this.anim) this.dessiner();
            }, 100);
        }

        async charger(avatars) {
            const [cartes, boite, ...imgs] = await Promise.all([
                chargerImage("images/cards_spritesheet.png"),
                chargerImage("images/box_petit.png"),
                ...avatars.map((a) => chargerImage(`images/avatars/${a}.png`)),
            ]);
            this.imgCartes = cartes;
            this.sortes = cartes ? this.extraireSortes(cartes) : null;
            this.imgBoite = boite;
            this.avatars = {};
            avatars.forEach((a, i) => (this.avatars[a] = imgs[i]));
        }

        // Marges de sécurité de l'iPhone (encoche, barre d'état, barre d'accueil), en pixels.
        lireMarges() {
            if (!this.sonde) {
                this.sonde = document.createElement("div");
                this.sonde.style.cssText =
                    "position:fixed;visibility:hidden;pointer-events:none;top:0;left:0;" +
                    "padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)";
                document.body.append(this.sonde);
            }
            const cs = getComputedStyle(this.sonde);
            return {
                haut: parseFloat(cs.paddingTop) || 0,
                droite: parseFloat(cs.paddingRight) || 0,
                bas: parseFloat(cs.paddingBottom) || 0,
                gauche: parseFloat(cs.paddingLeft) || 0,
            };
        }

        // Les 4 petites sortes du coin des cartes, sur fond transparent (pour les recopier sous le chiffre).
        extraireSortes(img) {
            const c = document.createElement("canvas");
            c.width = 34;
            c.height = 36 * 4;
            const g = c.getContext("2d");
            SORTES.forEach((suit, s) => g.drawImage(img, SPRITE_L + 55, s * SPRITE_H + 4, 34, 36, 0, s * 36, 34, 36));
            try {
                const d = g.getImageData(0, 0, c.width, c.height);
                for (let i = 0; i < d.data.length; i += 4) {
                    const clair = Math.min(d.data[i], d.data[i + 1], d.data[i + 2]);
                    if (clair > 200) d.data[i + 3] = Math.max(0, 255 - (clair - 200) * 4.6); // le blanc devient transparent
                }
                g.putImageData(d, 0, 0);
            } catch (e) {}
            return c;
        }

        redimensionner() {
            const dpr = Math.max(window.devicePixelRatio || 1, 2);
            // Le canvas occupe tout l'écran par le CSS (position fixed, inset 0) : on lit sa vraie taille.
            const r = this.canvas.getBoundingClientRect();
            const l = Math.round(r.width) || window.innerWidth;
            const h = Math.round(r.height) || window.innerHeight;
            if (l === this.lTotal && h === this.hTotal && this.canvas.width === Math.round(l * dpr)) return;
            this.lTotal = l;
            this.hTotal = h;
            this.canvas.width = Math.round(l * dpr);
            this.canvas.height = Math.round(h * dpr);
            this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

            // Zone utile : l'écran moins les marges de sécurité
            const m = this.lireMarges();
            this.x0 = m.gauche;
            this.y0 = m.haut;
            this.l = l - m.gauche - m.droite;
            this.h = h - m.haut - Math.max(0, m.bas - 8);

            const L = this.l;
            const H = this.h;
            this.carteH = Math.min(H * 0.11, (L * 0.12 * SPRITE_H) / SPRITE_L);
            this.carteL = (this.carteH * SPRITE_L) / SPRITE_H;
            this.ecartV = this.carteH * 0.2;
            // Cartes de la main : plus grandes que celles de la table, pour bien les voir et les toucher
            this.mainH = Math.max(this.carteH, Math.min(H * 0.19, ((L / 5.2) * SPRITE_H) / SPRITE_L, 120));
            this.mainL = (this.mainH * SPRITE_L) / SPRITE_H;
            this.avatar = Math.max(40, Math.min(100, Math.min(L, H) * 0.11));
            this.marge = Math.max(8, Math.min(L, H) * 0.022);
            this.texte = Math.max(11, this.avatar * 0.18);
        }

        // ----- Positions -----

        siege(i) {
            const n = this.vue.joueurs.length;
            return (i - this.vue.moi + n) % n;
        }

        posAvatar(i) {
            const { l, h, avatar, marge, x0, y0 } = this;
            const n = this.vue.joueurs.length;
            const s = this.siege(i);
            if (s === 0) return { x: x0 + l / 2 - avatar / 2, y: y0 + h - avatar - marge - this.texte * 1.4 };
            // Les autres joueurs se répartissent en arc de la gauche vers la droite, en passant par le haut.
            const autres = n - 1;
            const angle = Math.PI - ((s - 0.5) * Math.PI) / autres;
            const rx = l / 2 - avatar / 2 - marge;
            // Le haut de l'écran est réservé aux panneaux de texte (hautReserve).
            const centreY = y0 + h * 0.48;
            const haut = Math.max(y0 + marge, this.hautReserve || 0) + this.texte * 1.4;
            const ry = Math.max(avatar * 0.5, centreY - haut - avatar / 2);
            const cx = x0 + l / 2 + rx * Math.cos(angle);
            const cy = centreY - ry * Math.sin(angle);
            return { x: cx - avatar / 2, y: cy - avatar / 2 };
        }

        // La table se place dans l'espace libre entre les joueurs du haut et la main,
        // et resserre ses cartes si l'écran est bas (téléphone à l'horizontale).
        zoneTable() {
            const esp = this.carteL * 0.15;
            const largeur = 4 * this.carteL + 3 * esp;
            const gauche = this.x0 + this.l / 2 - largeur / 2;
            const haut = this.hautTable();
            const basMain = this.hautMainReserve() - this.texte * 0.6;
            const dispo = basMain - haut;
            const ecart = Math.max(this.carteH * 0.1, Math.min(this.ecartV, (dispo - this.carteH) / 12));
            const hauteur = this.carteH + 12 * ecart;
            const y0 = haut + Math.max(0, (dispo - hauteur) / 2);
            return { gauche, esp, ecart, y0 };
        }

        // Bas des joueurs placés au-dessus de la table (là où la table peut commencer)
        hautTable() {
            const largeur = 4 * this.carteL * 1.15;
            const gauche = this.x0 + this.l / 2 - largeur / 2;
            let haut = Math.max(this.y0, this.hautReserve || 0) + this.marge;
            this.vue.joueurs.forEach((j, i) => {
                if (i === this.vue.moi) return;
                const p = this.posAvatar(i);
                const chevauche = p.x < gauche + largeur + 20 && p.x + this.avatar > gauche - 20;
                if (chevauche) haut = Math.max(haut, p.y + this.avatar + this.texte * 1.6);
            });
            return haut;
        }

        posTable(carte) {
            const z = this.zoneTable();
            const x = z.gauche + SORTES.indexOf(carte.suit) * (this.carteL + z.esp);
            const y = z.y0 + (12 - VALEURS.indexOf(carte.value)) * z.ecart;
            return { x, y };
        }

        // Taille et nombre de rangées de la main, choisis une fois pour la manche (selon le nombre
        // de cartes du départ) : les plus grandes cartes possible qui laissent la table visible.
        // Chaque carte montre au moins la moitié de sa largeur (son chiffre et sa sorte).
        parametresMain() {
            const n = this.vue.joueurs.length;
            const cle = [this.lTotal, this.hTotal, n, this.hautReserve].join();
            if (this.pm && this.pm.cle === cle) return this.pm;
            const nDepart = Math.ceil(52 / n);
            const tableMin = this.carteH * 2.3 + this.texte;
            const vmax = this.basMain() - this.hautTable() - tableMin;
            let choix = null;
            for (let ch = this.mainH; ch >= this.carteH * 0.9; ch *= 0.95) {
                const cl = (ch * SPRITE_L) / SPRITE_H;
                const dispo = this.l - 2 * this.marge - cl;
                const cap = Math.max(1, Math.floor(dispo / (cl * 0.5)) + 1);
                // 1 à 3 rangées égales, ou 4 rangées : une par sorte
                for (const rangees of [1, 2, 3, 4]) {
                    if (rangees < 4 && Math.ceil(nDepart / rangees) > cap) continue;
                    const decalV = ch * 0.5;
                    const souleve = rangees === 1 ? ch * 0.16 : 0;
                    const hauteur = ch + (rangees - 1) * decalV + souleve;
                    choix = { cle, ch, cl, dispo, cap, rangees, decalV, hauteur };
                    if (hauteur <= vmax) return (this.pm = choix);
                    break; // à cette taille, plus de rangées serait encore plus haut
                }
            }
            return (this.pm = choix);
        }

        rangeesMain(main) {
            const pm = this.parametresMain();
            if (main.length <= pm.cap) return [main];
            if (pm.rangees === 4) {
                const rangees = [];
                SORTES.forEach((suit) => {
                    const sorte = main.filter((c) => c.suit === suit);
                    for (let k = 0; k < sorte.length; k += pm.cap) rangees.push(sorte.slice(k, k + pm.cap));
                });
                return rangees;
            }
            const nb = Math.ceil(main.length / pm.cap);
            const parRangee = Math.ceil(main.length / nb);
            const rangees = [];
            for (let k = 0; k < main.length; k += parRangee) rangees.push(main.slice(k, k + parRangee));
            return rangees;
        }

        basMain() {
            return this.posAvatar(this.vue.moi).y - this.texte * 1.6;
        }

        hautMainReserve() {
            return this.basMain() - this.parametresMain().hauteur;
        }

        posMain() {
            const rangees = this.rangeesMain(this.vue.main);
            const pm = this.parametresMain();
            const { cl, dispo } = pm;
            const m = { ch: pm.ch, decalV: pm.decalV, souleve: rangees.length === 1 ? pm.ch * 0.16 : 0 };
            const monTour = this.vue.tour === this.vue.moi;
            const bas = this.basMain();
            const res = [];
            rangees.forEach((cartes, r) => {
                const k = cartes.length;
                const pas = k > 1 ? Math.min(cl * 0.85, dispo / (k - 1)) : 0;
                const total = cl + pas * (k - 1);
                const xg = this.x0 + this.l / 2 - total / 2;
                const y = bas - m.ch - (rangees.length - 1 - r) * m.decalV;
                cartes.forEach((carte, j) => {
                    const jouable = monTour && this.vue.jouables.some((c) => memeCarte(c, carte));
                    res.push({ carte, jouable, x: xg + j * pas, y: y - (jouable ? m.souleve : 0), l: cl, h: m.ch, main: true });
                });
            });
            return res;
        }

        // ----- Dessin -----

        dessinerCarte(carte, x, y, assombrie = false, carteL = this.carteL, carteH = this.carteH, jouable = false, enMain = false) {
            const { ctx } = this;
            if (this.imgCartes) {
                const sx = VALEURS.indexOf(carte.value) * SPRITE_L;
                const sy = SORTES.indexOf(carte.suit) * SPRITE_H;
                ctx.drawImage(this.imgCartes, sx, sy, SPRITE_L, SPRITE_H, x, y, carteL, carteH);
                if (enMain) {
                    // Dans la main, les cartes se chevauchent et cachent la petite sorte du coin droit :
                    // on la recopie sous le chiffre, dans la partie qui reste visible.
                    ctx.drawImage(this.sortes || this.imgCartes, this.sortes ? 0 : sx + 55, this.sortes ? (sy / SPRITE_H) * 36 : sy + 4, 34, 36,
                        x + carteL * 0.07, y + carteH * 0.28, carteL * 0.28, carteH * 0.2);
                }
            } else {
                ctx.fillStyle = "white";
                ctx.fillRect(x, y, carteL, carteH);
            }
            if (assombrie) {
                ctx.fillStyle = "rgba(0,0,0,0.45)";
                ctx.beginPath();
                ctx.roundRect(x, y, carteL, carteH * 0.98, carteL * 0.06);
                ctx.fill();
            }
            if (jouable) {
                ctx.strokeStyle = "#ffd23f";
                ctx.lineWidth = Math.max(2, carteL * 0.05);
                ctx.beginPath();
                ctx.roundRect(x + 1, y + 1, carteL - 2, carteH * 0.98 - 2, carteL * 0.07);
                ctx.stroke();
            }
        }

        dessinerTable(cacher) {
            const { ctx } = this;
            // Emplacements vides des 7
            SORTES.forEach((suit) => {
                const { x, y } = this.posTable({ suit, value: "7" });
                ctx.strokeStyle = "rgba(255,255,255,0.25)";
                ctx.lineWidth = 1.5;
                ctx.setLineDash([4, 4]);
                ctx.beginPath();
                ctx.roundRect(x, y, this.carteL, this.carteH, this.carteL * 0.08);
                ctx.stroke();
                ctx.setLineDash([]);
            });
            // Du roi à l'as : les cartes basses se dessinent par-dessus.
            const cartes = this.vue.table
                .filter((c) => !(cacher && memeCarte(c, cacher)))
                .sort((a, b) => VALEURS.indexOf(b.value) - VALEURS.indexOf(a.value));
            cartes.forEach((c) => {
                const { x, y } = this.posTable(c);
                this.dessinerCarte(c, x, y);
            });
        }

        dessinerJoueurs() {
            const { ctx, avatar, texte } = this;
            const v = this.vue;
            v.joueurs.forEach((j, i) => {
                const { x, y } = this.posAvatar(i);
                const img = this.avatars[j.avatar];
                ctx.save();
                ctx.beginPath();
                ctx.roundRect(x, y, avatar, avatar, avatar * 0.15);
                ctx.clip();
                if (img) {
                    ctx.drawImage(img, x, y, avatar, avatar);
                } else {
                    // Joueur humain en multijoueur : pastille de couleur avec son initiale
                    ctx.fillStyle = COULEURS[i % COULEURS.length]; // une couleur par place à la table
                    ctx.fillRect(x, y, avatar, avatar);
                    ctx.fillStyle = "white";
                    ctx.font = `bold ${avatar * 0.5}px system-ui, Arial`;
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    ctx.fillText(j.nom.charAt(0).toUpperCase(), x + avatar / 2, y + avatar / 2 + avatar * 0.03);
                    ctx.textBaseline = "alphabetic";
                }
                if (!j.connecte && !j.ia) {
                    ctx.fillStyle = "rgba(0,0,0,0.55)";
                    ctx.fillRect(x, y, avatar, avatar);
                }
                ctx.restore();

                if (v.tour === i) {
                    ctx.lineWidth = Math.max(3, avatar / 18);
                    ctx.strokeStyle = "#7CFC00";
                    ctx.beginPath();
                    ctx.roundRect(x - 2, y - 2, avatar + 4, avatar + 4, avatar * 0.17);
                    ctx.stroke();
                    // Minuterie : un arc qui se vide autour de l'avatar
                    if (v.resteMs != null && v.delaiTour) {
                        const reste = Math.max(0, v.resteMs - (performance.now() - v.recuA));
                        const frac = reste / v.delaiTour;
                        ctx.strokeStyle = frac < 0.3 ? "#ff5050" : "#ffd23f";
                        ctx.lineWidth = Math.max(4, avatar / 14);
                        ctx.beginPath();
                        ctx.arc(x + avatar / 2, y + avatar / 2, avatar * 0.62, -Math.PI / 2, -Math.PI / 2 + frac * 2 * Math.PI);
                        ctx.stroke();
                    }
                }

                ctx.textAlign = "center";
                ctx.fillStyle = "white";
                ctx.font = `bold ${texte}px system-ui, Arial`;
                const absent = !j.connecte && !j.ia ? " (absent)" : "";
                ctx.fillText(j.nom + absent, x + avatar / 2, y - texte * 0.5);
                ctx.font = `${texte * 0.9}px system-ui, Arial`;
                const sous = i === v.moi ? `${j.points} pts` : `${j.nbCartes} cartes · ${j.points} pts`;
                ctx.fillText(sous, x + avatar / 2, y + avatar + texte * 1.15);

                if (v.boite === i && !(this.anim && this.anim.boite)) this.dessinerBoite(x + avatar * 0.62, y + avatar * 0.62);
            });
        }

        dessinerBoite(x, y) {
            const t = this.avatar * 0.5;
            if (this.imgBoite) {
                this.ctx.save();
                this.ctx.shadowColor = "rgba(0,0,0,0.5)";
                this.ctx.shadowBlur = 6;
                this.ctx.drawImage(this.imgBoite, x, y, t, t * 0.88);
                this.ctx.restore();
            }
        }

        dessinerMain(cacher) {
            this.zones = [];
            const monTour = this.vue.tour === this.vue.moi;
            this.posMain().forEach(({ carte, jouable, x, y, l, h }) => {
                if (cacher && memeCarte(carte, cacher)) return;
                this.dessinerCarte(carte, x, y, monTour && !jouable, l, h, jouable, true);
                this.zones.push({ carte, jouable, x, y, l, h });
            });
        }

        dessiner() {
            if (!this.vue) return;
            const { ctx } = this;
            const L = this.lTotal;
            const H = this.hTotal;
            const fond = ctx.createRadialGradient(L / 2, H * 0.45, 0, L / 2, H * 0.45, Math.max(L, H) * 0.75);
            fond.addColorStop(0, "#1b9474");
            fond.addColorStop(0.6, "#0d5f4b");
            fond.addColorStop(1, "#0a4a3b");
            ctx.fillStyle = fond;
            ctx.fillRect(0, 0, L, H);
            // En haut et en bas, le dégradé se fond dans la couleur de bord (la même que celle que
            // l'iPhone met sous la barre d'état et la barre d'accueil) : pas de coupure nette.
            // Même hauteur que la bande unie du haut (.barre-haut dans style.css)
            const bande = document.querySelector(".barre-haut");
            const solideHaut = Math.min(H * 0.4, bande ? bande.getBoundingClientRect().height : this.y0 + 24);
            // Fondu en douceur (courbe en S) pour qu'on ne voie pas où finit la bande unie
            const fondu = H * 0.3;
            const haut = ctx.createLinearGradient(0, 0, 0, solideHaut + fondu);
            haut.addColorStop(0, COULEUR_BORD);
            for (let k = 0; k <= 10; k++) {
                const t = k / 10;
                const opacite = 1 - t * t * (3 - 2 * t);
                const alpha = Math.round(opacite * 255).toString(16).padStart(2, "0");
                haut.addColorStop((solideHaut + t * fondu) / (solideHaut + fondu), COULEUR_BORD + alpha);
            }
            ctx.fillStyle = haut;
            ctx.fillRect(0, 0, L, solideHaut + fondu);
            const bas = ctx.createLinearGradient(0, H * 0.8, 0, H);
            bas.addColorStop(0, COULEUR_BORD + "00");
            bas.addColorStop(1, COULEUR_BORD);
            ctx.fillStyle = bas;
            ctx.fillRect(0, H * 0.8, L, H * 0.2);
            const a = this.anim;
            this.dessinerTable(a && a.carte);
            this.dessinerJoueurs();
            this.dessinerMain(a && a.carte);
            if (a && a.carte) this.dessinerCarte(a.carte, a.x, a.y, false, a.l, a.h);
            if (a && a.boite) this.dessinerBoite(a.x, a.y);
        }

        setVue(vue) {
            this.vue = vue;
            this.dessiner();
        }

        // ----- Animations -----

        animer(duree, depart, arrivee, base) {
            if (document.hidden) return Promise.resolve(); // pas d'animation dans un onglet caché
            return new Promise((ok) => {
                const t0 = performance.now();
                const image = () => {
                    const p = Math.min(1, (performance.now() - t0) / duree);
                    const e = doux(p);
                    const entre = (k) => depart[k] + (arrivee[k] - depart[k]) * e;
                    this.anim = { ...base, x: entre("x"), y: entre("y") };
                    if (depart.l) Object.assign(this.anim, { l: entre("l"), h: entre("h") });
                    this.dessiner();
                    if (p < 1) requestAnimationFrame(image);
                    else {
                        this.anim = null;
                        ok();
                    }
                };
                requestAnimationFrame(image);
            });
        }

        // ancienne : l'état avant le coup (pour savoir d'où part la carte)
        // vue : l'état après le coup, affiché pendant que la carte se déplace
        animerCarte(ancienne, vue, joueur, carte) {
            let depart = null;
            if (ancienne && joueur === ancienne.moi && ancienne.joueurs.length === vue.joueurs.length) {
                this.vue = ancienne;
                depart = this.posMain().find((z) => memeCarte(z.carte, carte)) || null;
            }
            this.vue = vue;
            if (!depart) {
                const p = this.posAvatar(joueur);
                depart = { x: p.x + this.avatar / 2 - this.carteL / 2, y: p.y + this.avatar / 2 - this.carteH / 2, l: this.carteL, h: this.carteH };
            }
            // La carte rapetisse de la taille de la main à celle de la table
            const arrivee = { ...this.posTable(carte), l: this.carteL, h: this.carteH };
            return this.animer(DUREE_CARTE, depart, arrivee, { carte });
        }

        animerBoite(vue, de, a) {
            this.vue = vue;
            if (de === a || de < 0) return attendre(0);
            const coin = (i) => {
                const p = this.posAvatar(i);
                return { x: p.x + this.avatar * 0.62, y: p.y + this.avatar * 0.62 };
            };
            return this.animer(DUREE_BOITE, coin(de), coin(a), { boite: true });
        }

        clic(e) {
            if (!this.vue || this.anim) return;
            const r = this.canvas.getBoundingClientRect();
            const x = e.clientX - r.left;
            const y = e.clientY - r.top;
            // La carte du dessus est la dernière dessinée
            const zone = [...this.zones].reverse().find(
                (z) => x >= z.x && x <= z.x + z.l && y >= z.y && y <= z.y + z.h
            );
            if (zone) this.surCarte(zone.carte, zone.jouable);
        }
    }

    window.Rendu = Rendu;
})();
