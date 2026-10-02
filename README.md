# Impact'IA — version web

Version web de la calculatrice [Impact'IA](https://github.com/SNCFdevelopers/ImpactIA). Elle estime l'empreinte environnementale annuelle d'un projet mobilisant un modèle d'IA générative : électricité, gaz à effet de serre et eau, et toute autre dimension que l'on y ajoute.

> **Ce projet est entièrement basé sur le travail d'Impact'IA**, conçu par la Direction RSE et la Direction du Numérique Responsable du groupe SNCF avec [Resilio](https://resilio.tech) et [Wavestone](https://www.wavestone.com) : méthodologie, formules, facteurs d'impact, données de modèles, bonnes pratiques et références viennent de leur [calculatrice Excel et de leur guide méthodologique](https://github.com/SNCFdevelopers/ImpactIA). Cette version n'en est qu'une transposition en application web ; elle est indépendante et non officielle. Tout le mérite du fond revient aux auteurs d'origine.

Démonstration : https://impactia.dev.beancraft.dev · Back-office : https://impactia.dev.beancraft.dev/admin.html

## En bref

- **Fidèle au classeur.** Le moteur reproduit les formules de l'Excel à 1e-9 près (39 modèles × 3 scénarios, vérifié par les tests).
- **Paramètres séparés du code.** Modèles, hypothèses, facteurs, mix électriques et contenus sont dans `data.json` ; chaque paramètre indique son unité, sa variable Excel et sa cellule d'origine.
- **Indépendant des fournisseurs.** N'importe quel fournisseur ou modèle peut être ajouté ; le code ne contient aucun nom de modèle.
- **Dimensions extensibles.** Un nouvel indicateur se déclare par ses facteurs dans `data.json` (ou le back-office), sans toucher au code.
- **Back-office statique.** Édition, validation en direct et aperçu dans le navigateur, puis export de `data.json` à commiter. Aucun serveur ni base de données.
- **Simple à maintenir.** HTML, CSS et JavaScript sans framework ni compilation ; bibliothèques copiées dans `vendor/` ; tests avec le lanceur intégré de Node.

## Démarrer

```bash
npm install
python3 -m http.server 8000   # http://localhost:8000 et http://localhost:8000/admin.html
npm test
```

| Commande | Rôle |
|---|---|
| `npm test` | Tests de non-régression (Excel, simulations Ecologits, propriétés du moteur). |
| `npm run dev` | Serveur local via portless (https://impactia-web.localhost). |
| `npm run extract` | Synchronise `data.json` avec `source.xlsx` (Python + `uv`). |
| `npm run excel-reference` | Recalcule les formules du classeur pour régénérer les valeurs de référence des tests. |
| `npm run vendor` | Recopie les bibliothèques front dans `vendor/`. |

## Documentation

- [Guide de maintenance](docs/MAINTENANCE.md) : architecture, format de `data.json`, ajouter un modèle, un paramètre ou une dimension, publier, tester, déployer.
- [Méthodologie](docs/METHODOLOGIE.md) : formules par étape avec les cellules Excel correspondantes, particularités du classeur conservées, écarts volontaires, écarts relevés entre le guide méthodologique et le classeur.

## Déploiement de démonstration

Coolify beancraft (projet « ImpactIA » : Coolify refuse l'apostrophe), image `nginx:alpine` (voir `Dockerfile`), construite depuis `kameltovic/impactia` (branche `master`).

## Licence

Œuvre dérivée d'Impact'IA, publiée sous la même licence [CC BY-NC-SA 4.0](LICENSE) : attribution, pas d'usage commercial, partage dans les mêmes conditions. Les bibliothèques de `vendor/` gardent leur licence (Lucide ISC, Tom Select Apache-2.0, flag-icons MIT, Lobe Icons MIT).
