// Mode solo : l'hôte tourne directement dans le navigateur, avec des joueurs ordinateur.
(function () {
    "use strict";
    const champNom = document.querySelector("#nom");
    const champNb = document.querySelector("#nb");
    const champPts = document.querySelector("#pts");
    const champsOptions = ["difficulte", "r-boite", "r-as", "r-bonus"].map((id) => document.querySelector("#" + id));
    try {
        champNom.value = localStorage.getItem("laboite-nom") || "";
        champNb.value = localStorage.getItem("laboite-nb") || "4";
        champPts.value = localStorage.getItem("laboite-pts") || "200";
        champsOptions.forEach((c) => (c.value = localStorage.getItem("laboite-" + c.id) || c.value));
    } catch (e) {}

    document.querySelector("#form-solo").addEventListener("submit", (e) => {
        e.preventDefault();
        const nom = champNom.value.trim() || "Moi";
        const nb = Number(champNb.value);
        const ptsMax = Number(champPts.value);
        try {
            localStorage.setItem("laboite-nom", nom);
            localStorage.setItem("laboite-nb", String(nb));
            localStorage.setItem("laboite-pts", String(ptsMax));
            champsOptions.forEach((c) => localStorage.setItem("laboite-" + c.id, c.value));
        } catch (e) {}
        demarrer(nom, nb, ptsMax, {
            difficulte: champsOptions[0].value,
            regles: {
                boite: Number(champsOptions[1].value),
                as: Number(champsOptions[2].value),
                bonusFin: Number(champsOptions[3].value),
            },
        });
    });

    function demarrer(nom, nb, ptsMax, options) {
        document.querySelector("#menu").classList.add("cache");
        const conteneur = document.querySelector("#jeu");
        conteneur.classList.remove("cache");

        let hote;
        const client = new ClientJeu({
            conteneur,
            envoyer: (carte) => {
                const erreur = hote.action(0, carte);
                if (erreur) client.erreur(erreur);
            },
            rejouer: () => hote.rejouer(),
            suivante: () => hote.mancheSuivante(),
            arreter: () => hote.arreter(),
            menu: () => location.reload(),
        });
        hote = new Hote({
            joueurs: Hote.completerAvecIA([{ nom }], nb),
            ptsMax,
            ...options,
            delaiManche: null, // on attend le bouton « Manche suivante »
            envoyer: (i, msg) => client.recevoir(msg),
        });
        window.partie = { hote, client }; // pratique pour déboguer dans la console
        client.pret.then(() => hote.demarrer());
    }
})();
