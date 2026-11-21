// Mode multijoueur : se connecte au serveur par WebSocket.
(function () {
    "use strict";
    const $ = (s) => document.querySelector(s);
    const ecrans = { accueil: $("#accueil"), attente: $("#attente"), jeu: $("#jeu") };
    const montrer = (nom) => Object.entries(ecrans).forEach(([k, e]) => e.classList.toggle("cache", k !== nom));

    // La place dans la salle est gardée pour cet onglet (on peut recharger la page sans la perdre).
    const CLE = "laboite-salle";
    const lireSession = () => {
        try { return JSON.parse(sessionStorage.getItem(CLE)); } catch (e) { return null; }
    };
    const ecrireSession = (v) => {
        try { v ? sessionStorage.setItem(CLE, JSON.stringify(v)) : sessionStorage.removeItem(CLE); } catch (e) {}
    };

    try { $("#nom").value = localStorage.getItem("laboite-nom") || ""; } catch (e) {}
    const codeLien = new URLSearchParams(location.search).get("salle");
    if (codeLien) $("#code").value = codeLien.toUpperCase();

    let ws = null;
    let essais = 0;
    let attenteEnvoi = null; // message à envoyer dès que la connexion est prête
    let client = null;
    let salle = null;

    function connecter() {
        const proto = location.protocol === "https:" ? "wss" : "ws";
        ws = new WebSocket(`${proto}://${location.host}/ws`);
        const lent = setTimeout(() => {
            $("#etat-connexion").textContent =
                "Connexion au serveur… S'il dormait, il peut prendre jusqu'à une minute à se réveiller.";
        }, 2500);
        ws.onopen = () => {
            clearTimeout(lent);
            essais = 0;
            $("#etat-connexion").textContent = "";
            const session = lireSession();
            if (session) envoyer({ t: "rejoindre", code: session.code, jeton: session.jeton, nom: session.nom });
            else if (attenteEnvoi) envoyer(attenteEnvoi);
            attenteEnvoi = null;
        };
        ws.onmessage = (e) => recevoir(JSON.parse(e.data));
        ws.onclose = () => {
            clearTimeout(lent);
            ws = null;
            if (client) client.flash("Connexion perdue, reconnexion…");
            essais++;
            setTimeout(connecter, Math.min(10000, 500 * 2 ** essais));
        };
    }

    function envoyer(msg) {
        if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
        else attenteEnvoi = msg;
    }

    function erreurAccueil(texte) {
        const e = $("#erreur-accueil");
        e.textContent = texte;
        e.classList.toggle("cache", !texte);
    }

    function recevoir(m) {
        if (m.t === "erreur") {
            if (client && salle && salle.enJeu) return client.erreur(m.msg);
            // Salle disparue (serveur redémarré, salle expirée) : on revient à l'accueil.
            if (/n'existe pas|déjà commencée|pleine/.test(m.msg)) {
                ecrireSession(null);
                montrer("accueil");
            }
            return erreurAccueil(m.msg);
        }
        if (m.t === "salle") {
            salle = m;
            ecrireSession({ code: m.code, jeton: m.jeton, nom: m.nom });
            history.replaceState(null, "", `?salle=${m.code}`);
            erreurAccueil("");
            if (m.enJeu) {
                demarrerJeu();
                client.rejouer = m.estHote ? () => envoyer({ t: "rejouer" }) : null;
            } else {
                afficherAttente(m);
            }
            return;
        }
        if (m.t === "etat" && client) client.recevoir(m);
    }

    function afficherAttente(s) {
        montrer("attente");
        $("#code-salle").textContent = s.code;
        const liste = $("#liste-joueurs");
        liste.innerHTML = "";
        s.joueurs.forEach((j) => {
            const li = document.createElement("li");
            li.textContent = j.nom + (j.hote ? " (hôte)" : "") + (j.nom === s.nom ? " — toi" : "") + (j.connecte ? "" : " — déconnecté");
            liste.append(li);
        });
        const nb = $("#nb");
        nb.innerHTML = "";
        for (let n = Math.max(2, s.joueurs.length); n <= 8; n++) {
            const o = document.createElement("option");
            o.value = o.textContent = n;
            nb.append(o);
        }
        nb.value = String(s.config.nb);
        $("#pts").value = String(s.config.ptsMax);
        const ia = s.config.nb - s.joueurs.length;
        $("#resume-config").textContent =
            `${s.config.nb} joueurs` + (ia > 0 ? ` (${ia} à l'ordinateur)` : "") + ` · fin à ${s.config.ptsMax} points · 30 s par tour`;
        $("#options-hote").classList.toggle("cache", !s.estHote);
        $("#btn-demarrer").classList.toggle("cache", !s.estHote);
        $("#attente-hote").classList.toggle("cache", s.estHote);
    }

    function demarrerJeu() {
        if (client) return;
        montrer("jeu");
        client = new ClientJeu({
            conteneur: ecrans.jeu,
            envoyer: (carte) => envoyer({ t: "jouer", carte }),
            rejouer: null,
            menu: () => {
                envoyer({ t: "quitter" });
                ecrireSession(null);
                location.href = "index.html";
            },
        });
    }

    // ----- Boutons -----

    function nomChoisi() {
        const nom = $("#nom").value.trim();
        if (!nom) {
            erreurAccueil("Écris ton nom d'abord.");
            $("#nom").focus();
            return null;
        }
        try { localStorage.setItem("laboite-nom", nom); } catch (e) {}
        return nom;
    }

    $("#btn-creer").onclick = () => {
        const nom = nomChoisi();
        if (nom) envoyer({ t: "creer", nom });
    };

    $("#form-rejoindre").onsubmit = (e) => {
        e.preventDefault();
        const nom = nomChoisi();
        const code = $("#code").value.trim().toUpperCase();
        if (!nom) return;
        if (code.length !== 4) return erreurAccueil("Le code de la salle a 4 lettres.");
        envoyer({ t: "rejoindre", code, nom });
    };

    const envoyerConfig = () => envoyer({ t: "config", nb: Number($("#nb").value), ptsMax: Number($("#pts").value) });
    $("#nb").onchange = envoyerConfig;
    $("#pts").onchange = envoyerConfig;
    $("#btn-demarrer").onclick = () => envoyer({ t: "demarrer" });

    $("#btn-quitter").onclick = () => {
        envoyer({ t: "quitter" });
        ecrireSession(null);
        salle = null;
        history.replaceState(null, "", location.pathname);
        montrer("accueil");
    };

    $("#btn-partager").onclick = async () => {
        const lien = `${location.origin}${location.pathname}?salle=${salle.code}`;
        try {
            if (navigator.share) await navigator.share({ title: "La boîte", text: `Viens jouer à La boîte ! Code : ${salle.code}`, url: lien });
            else {
                await navigator.clipboard.writeText(lien);
                $("#btn-partager").textContent = "Lien copié !";
                setTimeout(() => ($("#btn-partager").textContent = "Copier le lien d'invitation"), 2000);
            }
        } catch (e) {}
    };

    montrer(lireSession() ? "attente" : "accueil");
    connecter();
})();
