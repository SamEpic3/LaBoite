const assert = require('assert');
const R = require('../public/js/regles.js');
const Hote = require('../public/js/hote.js');
// règles de base
assert.deepStrictEqual(R.cartesJouables([{suit:'Clubs',value:'7'},{suit:'Hearts',value:'6'},{suit:'Hearts',value:'5'},{suit:'Hearts',value:'8'}],[{suit:'Hearts',value:'7'}]).map(c=>c.suit+c.value),['Clubs7','Hearts6','Hearts8']);
assert.deepStrictEqual(R.cartesJouables([{suit:'Hearts',value:'a'},{suit:'Hearts',value:'k'}],[{suit:'Hearts',value:'2'},{suit:'Hearts',value:'q'},{suit:'Hearts',value:'7'}]).length,2);
// parties complètes, 2 à 8 joueurs
for (let n=2;n<=8;n++) for (let essai=0;essai<200;essai++){
  const p = new R.Partie(Array.from({length:n},(_, i)=>'J'+i), 200);
  let manches=0;
  while(p.phase!=='finPartie'){
    p.nouvelleManche(); manches++;
    assert.strictEqual(p.joueurs.reduce((t,j)=>t+j.cartes.length,0)+p.table.length,52);
    let coups=0;
    while(p.phase==='jeu'){
      const i=p.tour;
      if(p.peutJouer(i)) { assert.throws(()=>p.prendreBoite(i)); p.jouer(i,p.choixIA(i)); }
      else { p.prendreBoite(i); }
      assert(++coups<2000,'boucle infinie');
    }
    const pm=p.derniereManche;
    assert.strictEqual(pm.points[pm.gagnant], pm.gagnant===p.boite?20:0);
  }
  assert(p.joueurs.some(j=>j.points>=200));
  const min=Math.min(...p.joueurs.map(j=>j.points));
  assert(p.vainqueurs.every(i=>p.joueurs[i].points===min));
}
// erreurs
const p=new R.Partie(['a','b','c'],200); p.nouvelleManche();
assert.throws(()=>p.jouer((p.tour+1)%3,p.joueurs[(p.tour+1)%3].cartes[0]),/pas ton tour/);
console.log('regles OK');
// hôte : partie entière tout-IA sauf joueur 0 absent, délais 0
const msgs=[];
const h=new Hote({joueurs:Hote.completerAvecIA([{nom:'Sam'}],4),envoyer:(i,m)=>msgs.push(m),delaiIA:0,delaiBoite:0,delaiManche:0,delaiTour:5});
h.demarrer();
const t0=Date.now();
const iv=setInterval(()=>{ if(h.partie.phase==='finPartie'){clearInterval(iv);
  const fin=msgs.at(-1); assert.strictEqual(fin.etat.phase,'finPartie'); assert(msgs.every(m=>m.etat.joueurs.length===4));
  assert(msgs.some(m=>m.ev.tempsEcoule)); console.log('hote OK', msgs.length,'messages', fin.etat.manche,'manches', Date.now()-t0,'ms', fin.etat.joueurs.map(j=>j.nom+':'+j.points).join(' '));}},20);
