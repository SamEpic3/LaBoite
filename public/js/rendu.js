// Dessin du jeu dans le canvas : table, joueurs, boîte, main et animations.
// Le joueur local (etat.moi) est toujours en bas de l'écran.
(function () {
    "use strict";
    const { SORTES, VALEURS, memeCarte } = Regles;

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

    const COULEURS = ["#e85d75", "#f29e4c", "#7b6cf6", "#2f9bd8", "#d65db1", "#4c8f3a", "#c0563a", "#5a6acf"];
    function couleurNom(nom) {
        let h = 0;
        for (const c of nom) h = (h * 31 + c.charCodeAt(0)) >>> 0;
        return COULEURS[h % COULEURS.length];
    }

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
            window.addEventListener("resize", () => {
                this.redimensionner();
                this.dessiner();
            });
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
            this.imgBoite = boite;
            this.avatars = {};
            avatars.forEach((a, i) => (this.avatars[a] = imgs[i]));
        }

        redimensionner() {
            const dpr = Math.max(window.devicePixelRatio || 1, 2);
            this.l = window.innerWidth;
            this.h = window.innerHeight;
            this.canvas.style.width = this.l + "px";
            this.canvas.style.height = this.h + "px";
            this.canvas.width = this.l * dpr;
            this.canvas.height = this.h * dpr;
            this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

            const { l, h } = this;
            this.carteH = Math.min(h * 0.11, (l * 0.12 * SPRITE_H) / SPRITE_L);
            this.carteL = (this.carteH * SPRITE_L) / SPRITE_H;
            this.ecartV = this.carteH * 0.2;
            this.avatar = Math.max(44, Math.min(100, Math.min(l, h) * 0.11));
            this.marge = Math.max(10, Math.min(l, h) * 0.025);
            this.texte = Math.max(11, this.avatar * 0.18);
        }

        // ----- Positions -----

        siege(i) {
            const n = this.vue.joueurs.length;
            return (i - this.vue.moi + n) % n;
        }

        posAvatar(i) {
            const { l, h, avatar, marge } = this;
            const n = this.vue.joueurs.length;
            const s = this.siege(i);
            if (s === 0) return { x: l / 2 - avatar / 2, y: h - avatar - marge - this.texte * 1.4 };
            // Les autres joueurs se répartissent en arc de la gauche vers la droite, en passant par le haut.
            const autres = n - 1;
            const angle = Math.PI - ((s - 0.5) * Math.PI) / autres;
            const rx = l / 2 - avatar / 2 - marge;
            // Le haut de l'écran est réservé aux panneaux de texte (hautReserve).
            const centreY = h * 0.48;
            const haut = Math.max(marge, this.hautReserve || 0) + this.texte * 1.4;
            const ry = Math.max(avatar * 0.5, centreY - haut - avatar / 2);
            const cx = l / 2 + rx * Math.cos(angle);
            const cy = centreY - ry * Math.sin(angle);
            return { x: cx - avatar / 2, y: cy - avatar / 2 };
        }

        // La table se place dans l'espace libre entre les joueurs du haut et la main,
        // et resserre ses cartes si l'écran est bas (téléphone à l'horizontale).
        zoneTable() {
            const esp = this.carteL * 0.15;
            const largeur = 4 * this.carteL + 3 * esp;
            const gauche = this.l / 2 - largeur / 2;
            let haut = (this.hautReserve || 0) + this.marge;
            this.vue.joueurs.forEach((j, i) => {
                if (i === this.vue.moi) return;
                const p = this.posAvatar(i);
                const chevauche = p.x < gauche + largeur + 20 && p.x + this.avatar > gauche - 20;
                if (chevauche) haut = Math.max(haut, p.y + this.avatar + this.texte * 1.6);
            });
            const basMain = this.posAvatar(this.vue.moi).y - this.carteH * 1.18 - this.texte * 2.2;
            const dispo = basMain - haut;
            const ecart = Math.max(this.carteH * 0.1, Math.min(this.ecartV, (dispo - this.carteH) / 12));
            const hauteur = this.carteH + 12 * ecart;
            const y0 = haut + Math.max(0, (dispo - hauteur) / 2);
            return { gauche, esp, ecart, y0 };
        }

        posTable(carte) {
            const z = this.zoneTable();
            const x = z.gauche + SORTES.indexOf(carte.suit) * (this.carteL + z.esp);
            const y = z.y0 + (12 - VALEURS.indexOf(carte.value)) * z.ecart;
            return { x, y };
        }

        posMain() {
            const main = this.vue.main;
            const n = main.length;
            const yAvatar = this.posAvatar(this.vue.moi).y;
            const y = yAvatar - this.carteH - this.texte * 1.8;
            const dispo = this.l - 2 * this.marge - this.carteL;
            const pas = n > 1 ? Math.min(this.carteL * 0.85, dispo / (n - 1)) : 0;
            const total = this.carteL + pas * (n - 1);
            const x0 = this.l / 2 - total / 2;
            const monTour = this.vue.tour === this.vue.moi;
            return main.map((carte, k) => {
                const jouable = monTour && this.vue.jouables.some((c) => memeCarte(c, carte));
                return { carte, jouable, x: x0 + k * pas, y: y - (jouable ? this.carteH * 0.18 : 0) };
            });
        }

        // ----- Dessin -----

        dessinerCarte(carte, x, y, assombrie = false) {
            const { ctx, carteL, carteH } = this;
            if (this.imgCartes) {
                ctx.drawImage(
                    this.imgCartes,
                    VALEURS.indexOf(carte.value) * SPRITE_L, SORTES.indexOf(carte.suit) * SPRITE_H,
                    SPRITE_L, SPRITE_H, x, y, carteL, carteH
                );
            } else {
                ctx.fillStyle = "white";
                ctx.fillRect(x, y, carteL, carteH);
            }
            if (assombrie) {
                ctx.fillStyle = "rgba(0,0,0,0.4)";
                ctx.beginPath();
                ctx.roundRect(x, y, carteL, carteH * 0.98, carteL * 0.06);
                ctx.fill();
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
                    ctx.fillStyle = couleurNom(j.nom);
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
            this.posMain().forEach(({ carte, jouable, x, y }) => {
                if (cacher && memeCarte(carte, cacher)) return;
                const monTour = this.vue.tour === this.vue.moi;
                this.dessinerCarte(carte, x, y, monTour && !jouable);
                this.zones.push({ carte, jouable, x, y });
            });
        }

        dessiner() {
            if (!this.vue) return;
            const { ctx } = this;
            const fond = ctx.createRadialGradient(this.l / 2, this.h * 0.45, 0, this.l / 2, this.h * 0.45, Math.max(this.l, this.h) * 0.75);
            fond.addColorStop(0, "#1b9474");
            fond.addColorStop(0.6, "#0d5f4b");
            fond.addColorStop(1, "#0a4a3b");
            ctx.fillStyle = fond;
            ctx.fillRect(0, 0, this.l, this.h);
            const a = this.anim;
            this.dessinerTable(a && a.carte);
            this.dessinerJoueurs();
            this.dessinerMain(a && a.carte);
            if (a && a.carte) this.dessinerCarte(a.carte, a.x, a.y);
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
                    this.anim = { ...base, x: depart.x + (arrivee.x - depart.x) * e, y: depart.y + (arrivee.y - depart.y) * e };
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
                depart = { x: p.x + this.avatar / 2 - this.carteL / 2, y: p.y + this.avatar / 2 - this.carteH / 2 };
            }
            return this.animer(DUREE_CARTE, depart, this.posTable(carte), { carte });
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
                (z) => x >= z.x && x <= z.x + this.carteL && y >= z.y && y <= z.y + this.carteH
            );
            if (zone) this.surCarte(zone.carte, zone.jouable);
        }
    }

    window.Rendu = Rendu;
})();
