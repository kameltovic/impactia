# Guide de maintenance

Ce guide s'adresse à la personne qui reprend le calculateur : mettre à jour les données, ajouter un modèle ou un indicateur, vérifier et publier. Aucune connaissance de framework n'est nécessaire. Le site est fait de fichiers statiques (HTML, CSS, JavaScript sans compilation) et d'un fichier de données.

## 1. Vue d'ensemble

```
index.html, app.js      Calculateur (interface). Aucun chiffre ni nom de modèle en dur.
admin.html, admin.js    Back-office : édition de data.json dans le navigateur, validation, export.
calc.js                 Moteur de calcul (portage de l'onglet « Calcul » du classeur).
validate.js             Contrôles de cohérence de data.json (back-office + tests).
ecologits.js            Comparaison avec EcoLogits via son API publique (préparation de la requête, appel, passage à l'année).
data.json               TOUTES les données : modèles, paramètres, dimensions, mix, contenus.
styles.css              Styles partagés (palette SNCF en variables CSS en tête de fichier).
vendor/                 Bibliothèques front copiées localement (Lucide, Tom Select, drapeaux, logos).
source.xlsx             Classeur Excel d'origine, pour la synchronisation des valeurs.
scripts/extract.py      Synchronise data.json avec le classeur Excel.
scripts/excel-reference.py  Recalcule les formules du classeur pour produire les valeurs de référence des tests.
scripts/vendor.mjs      Recopie les bibliothèques de node_modules vers vendor/.
test/                   Tests de non-régression (node --test).
docs/METHODOLOGIE.md    Formules, correspondance avec les cellules Excel, écarts connus.
```

Le calcul se fait en deux temps (détail dans `docs/METHODOLOGIE.md`) :

1. chaque étape du cycle de vie (stockage, R&D, entraînement final, RAG, front, traitement des requêtes) calcule des **activités physiques** : kWh consommés, part de la durée de vie d'un serveur, d'un GPU, d'un équipement réseau… ;
2. chaque **dimension** (électricité, GES, eau, ou toute autre ajoutée) multiplie ces activités par **ses facteurs**.

Conséquence : modifier une hypothèse, ajouter un modèle ou ajouter un indicateur se fait dans `data.json`, sans toucher au code.

## 2. Lancer le site en local

Prérequis : Node.js ≥ 20 (tests et bibliothèques) et Python 3 (serveur local, synchronisation Excel).

```bash
npm install          # une fois : récupère les bibliothèques front (dépendances de développement)
npm run vendor       # recopie les bibliothèques dans vendor/ (déjà fait dans le dépôt)
python3 -m http.server 8000   # puis http://localhost:8000 et http://localhost:8000/admin.html
npm test             # tests de non-régression
```

Le site doit être servi en HTTP (pas ouvert en `file://`), car il charge `data.json`.

## 3. Le fichier data.json

| Clé | Contenu |
|---|---|
| `meta` | Titre, licence, attribution, modèle par défaut, modèles de comparaison par défaut. |
| `models` | Un objet par modèle : `provider`, `name`, `category`, `pTotal` et `pActive` (milliards de paramètres), `pue`, `wue` (L/kWh), `tps` (tokens/s, vide = formule Ecologits), `ttft` (s), `flopsPerJoule`, `computeKw` (capacité de calcul du fournisseur), `published` (AAAA-MM-JJ). La catégorie `Embedding` est réservée aux modèles d'embedding (masqués dans le calculateur). |
| `parameters` | Hypothèses communes, chacune avec `label`, `group`, `unit`, `value`, `excel` (variable de l'onglet Bibliothèque_FE, si elle existe) et `cell` (cellule d'origine dans l'onglet Calcul). |
| `dimensions` | Indicateurs mesurés : libellé, unité, couleur, picto, échelle d'affichage, facteurs par activité, équivalences, seuils d'alerte. |
| `mixes` | Mix électriques par pays : valeur par kWh pour chaque dimension dont le facteur `gridInference` vaut `"mix"`, drapeau (code ISO), mix par défaut. |
| `requestSizes` | Tailles de requête proposées en phase Conception. |
| `providers` | Logo de chaque fournisseur (chemin dans `vendor/logos/`). |
| `content` | Bonnes pratiques, chiffres clés et références affichés sous les résultats. |

## 4. Tâches courantes

### Ajouter ou modifier un modèle

**Avec le back-office (recommandé).** Ouvrir `admin.html`, onglet « Modèles ». Le plus rapide est de dupliquer un modèle proche, puis de modifier son nom et ses caractéristiques. La validation en haut de page signale toute valeur manquante ou incohérente et calcule un exemple. Ensuite, « Aperçu dans le calculateur » pour vérifier, puis « Exporter data.json » (voir §5).

**Depuis l'Excel.** Ajouter la ligne dans l'onglet Modèles_IA du classeur, recalculer, enregistrer sous `source.xlsx`, puis lancer `npm run extract`. Le script affiche la liste des valeurs modifiées.

Un nouveau fournisseur fonctionne immédiatement ; pour lui donner un logo, voir « Fournisseurs » ci-dessous.

### Modifier une hypothèse (paramètre ou facteur)

Back-office, onglet « Paramètres » (hypothèses physiques : durées de vie, puissances, batch…) ou « Dimensions mesurées » (facteurs d'émission, d'eau…). Chaque ligne rappelle sa variable Excel et sa cellule d'origine.

### Ajouter une dimension à mesurer

Back-office, onglet « Dimensions mesurées », bouton « Ajouter une dimension ». Il faut renseigner :

- une **clé** courte (`adpe`), un libellé, une unité de calcul (`kg Sb eq`), une couleur et un picto [Lucide](https://lucide.dev/icons) ;
- les **facteurs par activité** : par kWh consommé à l'inférence (`gridInference`, ou `mix` pour un facteur qui dépend du pays), par kWh à l'entraînement (`gridTraining`), par kWh soumis au facteur bâtiment (`building`), par litre d'eau prélevée sur site (`onsite`), et par équipement fabriqué (`server`, `gpu`, `firewall`, `router`, `switch`, `node`, `hdd`). Un facteur à 0 exclut l'activité ;
- l'**échelle d'affichage** (seuil, unité) du plus grand au plus petit, par exemple `1000 → t`, `1 → kg`, `0.001 → g` ;
- éventuellement des équivalences et des seuils d'alerte.

La nouvelle dimension apparaît partout dans le calculateur : indicateurs, répartition entraînement/inférence, détail par étape, comparaison des modèles. Le test « ajouter une dimension ne demande que des données » garantit ce comportement.

Si un mix par pays est nécessaire (`gridInference` = `mix`), renseigner la valeur de chaque pays dans l'onglet « Mix électriques ».

### Ajouter un pays (mix électrique)

Onglet « Mix électriques », bouton « Ajouter un mix » : nom, code drapeau ISO 3166 (`fr`, `es`, `jp`… ; `un` pour une zone mondiale) et valeur par kWh.

### Fournisseurs et logos

Les logos disponibles sont dans `vendor/logos/`. Pour en ajouter un : l'ajouter à la liste de `scripts/vendor.mjs` (nom d'icône de [Lobe Icons](https://lobehub.com/icons)), lancer `npm run vendor`, puis saisir le chemin dans l'onglet « Fournisseurs ». Sans logo, l'initiale du fournisseur s'affiche.

### Comparaison avec EcoLogits

Dans « Résultats annuels », l'onglet « EcoLogits » affiche les mêmes indicateurs, dans les mêmes cartes, estimés par l'[API EcoLogits](https://github.com/mlco2/ecologits-api) (`meta.ecologitsApi`, actuellement `https://api.ecologits.ai/v1beta`). Chaque carte rappelle la valeur d'inférence Impact'IA et le ratio entre les deux. L'appel ne part que lorsque l'utilisateur ouvre l'onglet, puis se met à jour 300 ms après chaque saisie (réponses mises en cache). Correspondances à tenir à jour dans le back-office :

- **modèle** : colonne « Identifiant EcoLogits » (liste : `GET https://api.ecologits.ai/v1beta/models/<fournisseur>`). Vide = « non couvert par EcoLogits » ;
- **fournisseur** : onglet « Fournisseurs » (`openai`, `anthropic`, `mistralai`, `google_genai`…) ;
- **pays** : colonne « Zone EcoLogits » des mix (code ISO à 3 lettres, `WOR` pour le monde, `EEE` pour l'Europe) ;
- **dimension** : champ « Indicateur EcoLogits » (`energy`, `gwp`, `wcf` pour l'eau, `adpe`, `pe`), à renseigner seulement si les unités sont les mêmes que celles de la dimension.

L'API est en version bêta : si elle change d'adresse ou de format, seul `ecologits.js` est à adapter. Vider `meta.ecologitsApi` masque l'onglet.

### Bonnes pratiques et références

Onglet « Contenus (JSON) » du back-office : chaque groupe de pratiques a un titre, une couleur et des éléments (`icon`, `title`, `text`) ; chaque référence a un titre, une année et une URL.

## 5. Publier une modification

Le back-office ne publie rien lui-même. Les modifications restent dans le navigateur (brouillon local) jusqu'à l'export :

1. « Exporter data.json » (bouton désactivé tant que la validation signale un problème) ;
2. remplacer `data.json` à la racine du dépôt par le fichier exporté ;
3. `npm test` : les tests de référence Excel échouent si un résultat change. C'est attendu quand on modifie volontairement une hypothèse : mettre alors à jour les valeurs de référence (§6) ;
4. commit et pull request : le diff de `data.json` montre exactement ce qui a changé.

« Aperçu dans le calculateur » ouvre `index.html?apercu`, qui utilise le brouillon au lieu du `data.json` publié (un bandeau jaune le signale).

## 6. Tests

`npm test` lance `test/*.test.js` avec le lanceur intégré de Node (aucune dépendance) :

- **Fidélité au classeur** : 4 modèles comparés aux valeurs en cache de l'Excel, puis 39 modèles × 3 scénarios comparés aux formules du classeur recalculées (`test/excel-reference.json`), à 1e-9 près.
- **Simulations du document « Impact'IA vs Ecologits »** (`test/ecologits.test.js`) : voir le fichier pour les scénarios et tolérances.
- **Propriétés** : totaux = entraînement + inférence ; ajouter une dimension ne demande que des données ; chaque modèle donne des valeurs finies ; `data.json` passe la validation du back-office.

Régénérer les valeurs de référence après une évolution volontaire de la méthode :

```bash
npm run excel-reference -- /tmp/excel.json   # recalcule les formules de source.xlsx
```

Le script et la sélection des champs conservés dans `test/excel-reference.json` sont décrits en tête de `scripts/excel-reference.py`. Si la méthode du web s'écarte volontairement de l'Excel, documenter l'écart dans `docs/METHODOLOGIE.md` et ajuster le test.

## 7. Déploiement

Le site est statique : n'importe quel hébergement de fichiers convient (GitHub Pages, nginx…). Le `Dockerfile` fourni sert les fichiers avec nginx ; `.dockerignore` exclut tests, scripts, documentation et classeur. Penser à retirer ou adapter le script de mesure d'audience en tête de `index.html`, propre au déploiement de démonstration.

## 8. Mettre à jour une bibliothèque front

Changer la version dans `package.json`, puis `npm install && npm run vendor`, vérifier le site et commiter `vendor/`.
