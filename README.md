# La boîte

Jeu de cartes en solo (contre l'ordinateur) ou en multijoueur. Installable sur téléphone (PWA).

En ligne : https://laboite.onrender.com

## Jouer sur ton ordi

Il faut Node.js 18 ou plus. Aucune dépendance à installer.

```
npm start
```

Ensuite, ouvre http://localhost:3000. Pour tester le multijoueur seul, ouvre deux onglets : chaque onglet compte comme un joueur différent.

`npm run dev` redémarre le serveur chaque fois que tu modifies un fichier.
`npm test` vérifie les règles (des centaines de parties simulées).
`node tests/test_serveur.js` joue une partie multijoueur complète contre le serveur.

## Mettre en ligne gratuitement (Render)

1. Pousse le projet sur GitHub (`git push`).
2. Sur https://render.com, crée un compte, puis **New → Web Service** et choisis le dépôt LaBoite.
3. Réglages :
   - Runtime : **Node**
   - Build Command : `npm install`
   - Start Command : `npm start`
   - Instance Type : **Free**
4. Render te donne une adresse du genre `https://laboite-xxxx.onrender.com`. C'est celle-là que tu partages.

Le dépôt GitHub SamEpic3/LaBoite est relié au service Render `laboite` : chaque push sur `main` redéploie le jeu automatiquement.

Le forfait gratuit met le serveur en veille quand personne ne joue. La première personne qui arrive attend environ une minute qu'il se réveille (la page l'indique). Si le serveur redémarre, les salles en cours sont perdues.

## Organisation du code

- `public/js/regles.js` : les règles (paquet, coups permis, boîte, pointage). Sert au solo et au serveur.
- `public/js/hote.js` : fait avancer la partie (tours de l'ordinateur, minuterie de 30 s, manches). Sert au solo et au serveur.
- `public/js/rendu.js` : le dessin dans le canvas et les animations.
- `public/js/client.js` : l'interface de partie (messages, pointage, fins de manche).
- `public/solo.html` / `solo.js` : le mode solo.
- `public/multi.html` / `multi.js` : liste des parties ouvertes, salles d'attente et connexion au serveur.
- `public/sw.js`, `manifest.webmanifest`, `icons/` : l'app installable (le solo marche sans Internet).
- `server.js` : sert les pages et gère les salles. `websocket.js` : le WebSocket, écrit sans dépendance.

## Règles

- Les 52 cartes sont distribuées. Celui qui a le 7 de cœur le pose et prend la boîte.
- On pose un 7 pour ouvrir une sorte, ou une carte qui prolonge un bout d'une sorte déjà sur la table (de l'as au roi).
- Si tu peux jouer, tu dois jouer. Sinon, tu prends la boîte.
- La manche finit quand quelqu'un n'a plus de cartes. Les autres comptent leurs cartes : as = 15, figures = 10, les autres leur valeur. La boîte vaut 20 points.
- La partie finit quand quelqu'un atteint le maximum (200 par défaut). Le plus petit pointage gagne.
- En multijoueur, on choisit une partie dans la liste des parties ouvertes. Le créateur peut la protéger par un mot de passe.
- En multijoueur, tu as 30 secondes pour jouer. Ensuite, l'ordinateur joue à ta place. Si un joueur se déconnecte, l'ordinateur joue pour lui jusqu'à son retour.
