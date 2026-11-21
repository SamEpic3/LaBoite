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
    // Lien d'invitation : ?salle=CODE met cette partie en évidence dans la liste
    const codeLien = (new URLSearchParams(location.search).get("salle") || "").toUpperCase();
    let derniereListe = [];
    const mdpOuverts = new Set(); // parties protégées dont le champ de mot de passe est ouvert

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
            const enAttente = attenteEnvoi;
            attenteEnvoi = null;
            if (session) envoyer({ t: "rejoindre", code: session.code, jeton: session.jeton, nom: session.nom });
            else {
                envoyer({ t: "lister" });
                if (enAttente) envoyer(enAttente);
            }
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
        if (m.t === "liste") {
            derniereListe = m.salles;
            return afficherListe();
        }
        if (m.t === "erreur") {
            if (client && salle && salle.enJeu) return client.erreur(m.msg);
            if (m.motDePasse) {
                // Mauvais mot de passe : le message s'affiche sous la partie concernée
                mdpOuverts.add(m.code);
                messagesParties[m.code] = m.msg;
                afficherListe();
                const champ = document.querySelector(`[data-mdp="${m.code}"]`);
                if (champ) champ.focus();
                return;
            }
            if (m.introuvable) {
                // Partie disparue (serveur redémarré, partie commencée ou expirée) : retour à l'accueil.
                ecrireSession(null);
                salle = null;
                montrer("accueil");
                envoyer({ t: "lister" });
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

    const messagesParties = {};
    const texteDelai = (d) => (d ? `${d === 60 ? "1 min" : d + " s"} par tour` : "temps illimité");

    function afficherListe() {
        const liste = $("#liste-parties");
        liste.innerHTML = "";
        $("#aucune-partie").textContent = "Aucune partie ouverte pour l'instant. Crée la tienne !";
        $("#aucune-partie").classList.toggle("cache", derniereListe.length > 0);
        // La partie du lien d'invitation en premier
        const triees = [...derniereListe].sort((a, b) => (b.code === codeLien) - (a.code === codeLien));
        triees.forEach((p) => {
            const li = creerElement("li", { class: p.code === codeLien ? "invitee" : "" });
            const details = creerElement("div", { class: "details" },
                creerElement("strong", {}, (p.protegee ? "🔒 " : "") + p.nom),
                creerElement("span", {}, `${p.joueurs.length} / ${p.places} joueurs · ${p.joueurs.join(", ")} · fin à ${p.ptsMax} · ${texteDelai(p.delai)}`));
            const bouton = creerElement("button", {}, "Rejoindre");
            li.append(details, bouton);
            if (p.protegee && mdpOuverts.has(p.code)) {
                const champ = creerElement("input", {
                    "data-mdp": p.code, placeholder: "Mot de passe", autocomplete: "off",
                    autocapitalize: "off", spellcheck: "false", maxlength: "30",
                });
                champ.value = champsMdp[p.code] || "";
                champ.oninput = () => (champsMdp[p.code] = champ.value);
                champ.onkeydown = (e) => e.key === "Enter" && rejoindre(p);
                li.append(creerElement("div", { class: "zone-mdp" }, champ));
            }
            if (messagesParties[p.code]) li.append(creerElement("p", { class: "msg" }, messagesParties[p.code]));
            bouton.onclick = () => rejoindre(p);
            liste.append(li);
        });
        // Garder le curseur dans le champ de mot de passe quand la liste se met à jour
        if (focusMdp) {
            const champ = document.querySelector(`[data-mdp="${focusMdp}"]`);
            if (champ) champ.focus();
        }
    }

    const champsMdp = {};
    let focusMdp = null;
    document.addEventListener("focusin", (e) => (focusMdp = e.target.dataset && e.target.dataset.mdp) || null);

    function rejoindre(p) {
        const nom = nomChoisi();
        if (!nom) return;
        if (p.protegee && !mdpOuverts.has(p.code)) {
            mdpOuverts.add(p.code);
            afficherListe();
            const champ = document.querySelector(`[data-mdp="${p.code}"]`);
            if (champ) champ.focus();
            return;
        }
        delete messagesParties[p.code];
        envoyer({ t: "rejoindre", code: p.code, nom, motDePasse: champsMdp[p.code] || "" });
    }

    function afficherAttente(s) {
        montrer("attente");
        $("#titre-salle").textContent = s.nomSalle || "Salle d'attente";
        $("#salle-protegee").classList.toggle("cache", !s.protegee);
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
        $("#delai").value = String(s.config.delai);
        const ia = s.config.nb - s.joueurs.length;
        $("#resume-config").textContent =
            `${s.config.nb} joueurs` + (ia > 0 ? ` (${ia} à l'ordinateur)` : "") + ` · fin à ${s.config.ptsMax} points · ${texteDelai(s.config.delai)}`;
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
        if (nom) envoyer({ t: "creer", nom, motDePasse: $("#mdp-creer").value });
    };

    const envoyerConfig = () => envoyer({
        t: "config", nb: Number($("#nb").value), ptsMax: Number($("#pts").value), delai: Number($("#delai").value),
    });
    $("#nb").onchange = envoyerConfig;
    $("#pts").onchange = envoyerConfig;
    $("#delai").onchange = envoyerConfig;
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
            if (navigator.share) await navigator.share({ title: "La boîte", text: `Viens jouer à La boîte avec moi ! (${salle.nomSalle})`, url: lien });
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
