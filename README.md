# Impact'IA — version web

Version web de la calculatrice [Impact'IA](https://github.com/SNCFdevelopers/ImpactIA) (SNCF, Resilio, Wavestone) :
électricité, GES et eau d'un projet mobilisant un modèle d'IA générative, sur un an.

Site statique sans dépendance ni build : `index.html` + `app.js` (interface) + `calc.js` (portage de l'onglet « Calcul »)
+ `data.js` (modèles et facteurs d'émission, générés depuis `source.xlsx`).

```bash
npm run dev       # https://impactia-web.localhost (portless)
npm test          # compare le moteur aux valeurs calculées par Excel
npm run extract   # régénère data.js après mise à jour de source.xlsx
```

## Fidélité au classeur

- Les formules du classeur ont été recalculées hors Excel (`scripts/excel-reference.py`, lib `formulas`) pour les 39 modèles
  sur 3 scénarios (Production France, Production USA sans RAG, Conception avec mix personnalisé) : le moteur JS retrouve
  les mêmes totaux, entraînement compris, à 1e-15 près (`test/excel-reference.json`, vérifié par `npm test`).
- Écarts volontaires avec le classeur, qui y calcule les modèles de comparaison différemment du modèle choisi :
  - chaque modèle comparé utilise son propre PUE et son propre nombre de modèles actifs ; le classeur réutilise ceux du modèle choisi (`$N165`, `'⚙️Données'!$F$26`) ;
  - le classeur applique `0.5*0.5*(1/PUE)*0.7` au lieu de `0.85*0.85` pour les FLOPS des modèles comparés [O115] ; ici, c'est la formule du modèle choisi partout ;
  - en phase Conception, le nombre de requêtes mensuelles du préremplissage [N191] est dérivé des usages au lieu d'être lu dans le champ masqué de la phase Production ;
  - si un fournisseur n'a aucun modèle publié depuis 24 mois, on compte 1 modèle actif au lieu de renvoyer `#DIV/0!`.
- Comme dans le classeur, l'amortissement de l'entraînement dépend de la date du jour (nombre de modèles du fournisseur publiés depuis 24 mois).

## Déploiement

Coolify beancraft (projet « ImpactIA », Coolify refuse l'apostrophe) → https://impactia.dev.beancraft.dev.
Image `nginx:alpine` (voir `Dockerfile`), construite depuis `kameltovic/impactia` (branche `master`) via la GitHub App Coolify.

## Licence

Œuvre dérivée d'Impact'IA, publiée sous [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.fr) : pas d'usage commercial, même licence pour les dérivés.
