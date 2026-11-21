// Petits sons du jeu, fabriqués par le navigateur (Web Audio) : aucun fichier à télécharger.
// Sur iPhone, le son ne peut démarrer qu'après un premier toucher de l'écran.
(function () {
    "use strict";
    const CLE = "laboite-son";

    class Sons {
        constructor() {
            try {
                this.actif = localStorage.getItem(CLE) !== "non";
            } catch (e) {
                this.actif = true;
            }
            this.ctx = null;
            const debloquer = () => {
                this.contexte();
                if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
            };
            addEventListener("pointerdown", debloquer, { passive: true });
            addEventListener("keydown", debloquer);
        }

        contexte() {
            if (!this.ctx) {
                const AC = window.AudioContext || window.webkitAudioContext;
                if (AC) this.ctx = new AC();
            }
            return this.ctx;
        }

        basculer() {
            this.actif = !this.actif;
            try {
                localStorage.setItem(CLE, this.actif ? "oui" : "non");
            } catch (e) {}
            if (this.actif) this.jouer("tour");
            return this.actif;
        }

        // Une note : fréquence (Hz), début (s), durée (s), volume, forme d'onde
        note(f, t0, duree, volume = 0.15, forme = "sine", glisse = null) {
            const ctx = this.ctx;
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.type = forme;
            const t = ctx.currentTime + t0;
            o.frequency.setValueAtTime(f, t);
            if (glisse) o.frequency.exponentialRampToValueAtTime(glisse, t + duree);
            g.gain.setValueAtTime(0.0001, t);
            g.gain.exponentialRampToValueAtTime(volume, t + 0.01);
            g.gain.exponentialRampToValueAtTime(0.0001, t + duree);
            o.connect(g).connect(ctx.destination);
            o.start(t);
            o.stop(t + duree + 0.02);
        }

        // Bruit bref (carte qui claque sur la table)
        bruit(t0, duree, volume, frequence) {
            const ctx = this.ctx;
            const n = Math.floor(ctx.sampleRate * duree);
            const tampon = ctx.createBuffer(1, n, ctx.sampleRate);
            const d = tampon.getChannelData(0);
            for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3);
            const src = ctx.createBufferSource();
            src.buffer = tampon;
            const filtre = ctx.createBiquadFilter();
            filtre.type = "bandpass";
            filtre.frequency.value = frequence;
            const g = ctx.createGain();
            g.gain.value = volume;
            src.connect(filtre).connect(g).connect(ctx.destination);
            src.start(ctx.currentTime + t0);
        }

        jouer(nom) {
            if (!this.actif || !this.contexte() || this.ctx.state !== "running") return;
            try {
                switch (nom) {
                    case "carte":
                        this.bruit(0, 0.07, 0.5, 2200);
                        break;
                    case "boite":
                        this.note(160, 0, 0.25, 0.25, "triangle", 70);
                        this.bruit(0.02, 0.12, 0.35, 500);
                        break;
                    case "tour":
                        this.note(880, 0, 0.18, 0.08);
                        this.note(1320, 0.09, 0.25, 0.07);
                        break;
                    case "reaction":
                        this.note(600, 0, 0.12, 0.08, "sine", 900);
                        break;
                    case "manche":
                        [523, 659, 784].forEach((f, i) => this.note(f, i * 0.11, 0.3, 0.09, "triangle"));
                        break;
                    case "victoire":
                        [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.note(f, i * 0.12, 0.35, 0.1, "triangle"));
                        break;
                    case "defaite":
                        [523, 466, 392].forEach((f, i) => this.note(f, i * 0.16, 0.35, 0.08, "triangle"));
                        break;
                }
            } catch (e) {}
        }
    }

    window.Sons = Sons;
})();
