# Méthodologie du moteur de calcul

Le moteur (`calc.js`) reproduit l'onglet « Calcul » du classeur Impact'IA. Les références `[N123]` renvoient à ses cellules (colonne N = modèle sélectionné, colonne M = valeurs communes). La méthodologie de fond est décrite dans le guide méthodologique du projet d'origine ; ce document explique comment elle est implémentée et où le web s'écarte du classeur.

Unités : kWh, kg CO₂e, L eq ; toutes les valeurs portent sur **une année de projet**.

## 1. Principe : activités × facteurs

Le classeur calcule séparément électricité, GES et eau pour chaque étape. Le moteur web factorise ce calcul :

1. chaque étape produit des **activités physiques** (`ACTIVITIES` dans `calc.js`) ;
2. chaque dimension de `data.json` les convertit : **impact(étape, dimension) = Σ activité × facteur(dimension, activité)**.

| Activité | Signification | Facteur électricité | Facteur GES | Facteur eau |
|---|---|---|---|---|
| `gridInference` | kWh consommés à l'inférence (avec PUE) | 1 | mix du pays d'inférence | 0 |
| `gridTraining` | kWh consommés à l'entraînement (avec PUE) | 1 | mix mondial 0,458 | 0 |
| `building` | kWh soumis au facteur bâtiment et environnement technique | 0 | 0,01 | 0 |
| `onsite` | kWh × WUE du centre de données (L prélevés sur site) | 0 | 0 | CF_Aware 1,4 |
| `server` | fraction de la durée de vie d'un serveur utilisée | 0 | 3 952,3 | 1 540 630 |
| `gpu` | fraction de la durée de vie d'un GPU utilisée | 0 | 366,54 | 101 500 |
| `firewall`, `router`, `switch` | fraction de vie d'un équipement réseau × ratio d'usage | 0 | 333,8 / 403 / 363 | 95 550 / 114 720 / 103 410 |
| `node` | fraction de la durée de vie d'un nœud du front | 0 | 19,93 | 7 270 |
| `hdd` | fraction de la durée de vie d'un disque dur | 0 | 640,5 | 163 480 |

Les facteurs GES et eau sont ceux de l'onglet Bibliothèque_FE (valeurs embarquées par équipement, en kg CO₂e et L eq). Cette écriture rend explicite ce qui, dans le classeur, était réparti dans une centaine de cellules. Elle permet d'ajouter une dimension (par exemple les ressources abiotiques, citées dans l'onglet Résultats) en ne fournissant que ses facteurs.

## 2. Volumes du projet

| Grandeur | Production | Conception |
|---|---|---|
| Tokens de sortie / an `T` [M28] | tokens de sortie mensuels × 12 | utilisateurs × requêtes/jour × taille × 365 |
| Tokens d'entrée / an [M27] | tokens d'entrée mensuels × 12 | tokens de sortie × 5 (`conceptionInputOutputRatio`) |
| Tokens d'embedding / an [M127] | tokens d'embedding mensuels × 12 | 0 |
| Requêtes / an | requêtes mensuelles × 12 | utilisateurs × requêtes/jour × 365 |

## 3. Étapes

Notations : `B` batch (64), `S` GPU par serveur (8), `L_x` durée de vie de l'équipement x en secondes, `P_net` puissance réseau pondérée = Σ puissance × ratio d'usage.

### 3.1 Inférence — traitement des requêtes [N163-N243]

- Mémoire requise = 1,2 × P_total × 16/8 Go → GPU nécessaires = arrondi au dixième supérieur de mémoire/80, puis à la puissance de 2 supérieure (`N_GPU`) [N167-N169].
- Énergie GPU par token = α·e^(β·B)·P_actif + γ (Wh) ; `E_GPU = T × énergie/token / 1000 × N_GPU` [N173-N175].
- Latence par token = 1/TPS, ou α·P_actif + β·B + γ si le TPS est inconnu [N183].
- Préremplissage = (coefficient × tokens d'entrée + 17,88 ms × requêtes mensuelles) / 1000, avec coefficient = 0,062 × TTFT / 0,44 [N191].
- Latence totale `λ = T × latence/token + préremplissage` [N181].
- `E_serveur = λ/3600 × 1,2 kW × N_GPU/S / B` ; `E_réseau = N_GPU × P_net × λ/3600/S / B` [N193] [N197].
- `E_IT = E_GPU + E_serveur + E_réseau` ; électricité = `E_IT × PUE` [N163].
- Activités : `gridInference = E_IT × PUE` ; `building = E_IT` ; `onsite = E_IT × WUE` ; `server = N_GPU/S × λ/(B·L_serveur)` ; `gpu = N_GPU × λ/(B·L_GPU)` ; réseau = ratio d'usage × N_GPU/S × λ/(B·L_réseau).

### 3.2 Inférence — RAG / embedding [M126-M142, N129-N141]

- Latence = (0,022 × P_embedding/8 × tokens d'embedding × B + 97,394) / 1000 s [M126], avec P_embedding = paramètres du modèle d'embedding (`embeddingModel`).
- `E = (λ/3600 × (0,7 kW + 1,2/S) × N + P_net × λ/3600/S × N) × PUE / B` avec N = GPU d'embedding [M132] [M134] [N129].
- Activités : électricité, bâtiment et eau sur site sur `E` ; serveur, GPU et réseau au prorata de λ, comme en 3.1.

### 3.3 Inférence — front applicatif [N146-N158]

- Part du projet = T / 1,6 milliard de tokens par nœud et par an.
- `E = (nœuds × 0,0144 kW + nœuds/16 × P_net) × 1,2 (PUE fixe) × 8 760 h × part` [N146].
- Activités : électricité et bâtiment sur `E` ; `onsite = E × 0,2` (WUE fixe) ; `node` et réseau au prorata d'une année sur leur durée de vie.

### 3.4 Entraînement final [N90-N120]

- Modèles actifs du fournisseur = modèles publiés depuis 24 mois (dépend de la date du jour).
- Capacité de calcul allouée = capacité du fournisseur × 0,8 / modèles actifs × FLOP/J × 0,85² [N115-N116].
- Tokens produits sur la vie du modèle = capacité × (1 an / (2 × P_actif)) × 1,5 an [N114] ; part du projet = T / ce total.
- FLOPs d'entraînement = 10^(0,0006 × jours depuis 2020-01-01 + 17,151) × (P_total × 10⁹)^0,541 [N92].
- Électricité totale = (E_IT/E_GPU) × FLOPs / FLOP/J / 3,6·10⁶ × PUE [N91] ; part du projet `E_final` [N90].
- Activités : `gridTraining = E_final` ; l'embarqué suit le même ratio « hors électricité du réseau / kWh » que le traitement des requêtes : toutes les activités non électriques de 3.1 × `E_final / E_requêtes` [N97] [N100] ; plus `onsite = E_final × WUE` [N99].

### 3.5 Expérimentations R&D [N81-N86]

Activités de l'entraînement final × 4.

### 3.6 Stockage des données d'entraînement [N64-N77]

- Tokens d'entraînement = FLOPs / (6 × P_total) ; volume = tokens × 16 octets ; disques de 30 To.
- `E = 0,0095 kW × disques × PUE × 0,2 × 100 j × 24 h × part` [N64].
- Activités : `gridTraining = E` ; `onsite = E × WUE` ; `hdd = disques × 2 400 h × part / durée de vie (h)`.

### 3.7 Répartition par équipement

Électricité du traitement des requêtes : GPU (`E_GPU`), serveur, réseau, et infrastructures techniques (`E_IT × (PUE − 1)`), comme les cellules C36-C39.

## 4. Fidélité au classeur

`npm test` compare le moteur aux formules du classeur recalculées hors Excel (`scripts/excel-reference.py`) pour 39 modèles × 3 scénarios, et à des valeurs en cache du fichier d'origine : les écarts sont inférieurs à 1e-9 en relatif.

### Particularités du classeur conservées

Elles sont reproduites telles quelles pour rester fidèle aux chiffres publiés. Chacune est un réglage de données qu'on peut changer :

- **Embarqué réseau du traitement des requêtes** : multiplié par N_GPU/8 pour l'eau [N243], pas pour le GES [N228]. Option `scaleRequestNetworkByGpus` de chaque dimension.
- **Eau de l'entraînement** : le ratio embarqué/kWh repris de l'inférence inclut l'eau sur site, qui est ensuite ajoutée une seconde fois [N99-N100].
- **Base de l'eau sur site** : énergie IT sans PUE pour le traitement des requêtes [N236], énergie avec PUE pour le RAG, l'entraînement et le stockage.
- **Front applicatif** : PUE fixé à 1,2 et WUE à 0,2, au lieu de ceux du fournisseur (paramètres `frontPue`, `frontWue`).
- **Eau consommée pour produire l'électricité** : le facteur « WUE off site » (3,67 L/kWh) est présent dans Bibliothèque_FE mais n'entre dans aucun résultat. Pour l'inclure, mettre ce facteur sur `gridInference` et `gridTraining` de la dimension eau.
- **Unités du préremplissage** : 17,88 ms × requêtes *mensuelles*, alors que les tokens sont annuels [N191]. L'effet est négligeable.

### Écarts volontaires avec le classeur

- **Modèles de comparaison** : le classeur calcule les colonnes O à R avec le PUE [`$N165`] et le nombre de modèles actifs [`'⚙️Données'!$F$26`] du modèle *sélectionné*, et avec une autre efficacité de calcul [O115]. Ici, chaque modèle est calculé comme le modèle sélectionné, avec ses propres caractéristiques.
- **Phase Conception** : le classeur lit le nombre de requêtes mensuelles dans le champ masqué de la phase Production ; il est ici dérivé des usages saisis.
- **Fournisseur sans modèle récent** : 1 modèle actif est compté au lieu de renvoyer `#DIV/0!`.
- **Eau embarquée des GPU** : le classeur l'amortit sur la durée de vie du serveur [N240], le moteur sur celle du GPU. Les deux valent 3 ans : le résultat est identique tant qu'elles restent égales.

## 5. Écarts entre le guide méthodologique et le classeur

Les différences relevées entre le guide méthodologique et le classeur, et les incohérences internes du classeur, sont regroupées dans un document destiné aux auteurs : [ECARTS-GUIDE-CLASSEUR.md](ECARTS-GUIDE-CLASSEUR.md). Le moteur suit le classeur ; ces points relèvent de leur arbitrage.

## 6. Comparaison avec Ecologits (tests `test/ecologits.test.js`)

Le document « Impact'IA vs Ecologits – Comparaison des périmètres modélisés » (10/09/2026) sert de seconde référence. Ce qu'on a établi en cherchant à le reproduire :

- **Pages 4-5** (76 M de tokens d'entrée et 76 M de sortie par mois, 1 000 requêtes/mois, 33 modèles) :
  - la part des composants hors GPU se calcule sur l'**électricité** du traitement des requêtes, `1 − E_GPU / E_requêtes`. Le moteur retrouve médiane, minimum (Gemini 2.5 pro) et maximum à 1 point près ;
  - la part de l'entraînement dans le GES est retrouvée en médiane (13,5 % contre 13 %), avec le même maximum (Mistral Medium) mais plus bas : 55 % contre 63 %. Ce maximum dépend du nombre de modèles Mistral récents ; la table des modèles a changé depuis le document.
- **Page 9** (ratios Impact'IA / Ecologits sur 24 modèles) :
  - le tableau a été produit avec la **bibliothèque EcoLogits 0.10.2** (152 M de tokens de sortie, zone France), et non avec les cellules « Ecologits » du classeur (N164 à N234). Ces cellules s'écartent d'ailleurs d'EcoLogits : facteur France écrit en dur [N209], PUE appliqué à l'eau hors site [N234], latence comptée deux fois dans l'embarqué [N220] ;
  - côté Impact'IA, ce sont les totaux d'inférence [N104, N107, N110] pour 608 M de tokens d'entrée et 152,5 M de sortie par an, sans embedding ;
  - l'électricité et l'eau se reproduisent à 6 % près par modèle, avec un facteur global de 1,40 constant sur les 24 modèles. Nous ne l'expliquons pas ; un écart de volume de tokens entre les deux simulations est probable ;
  - le ratio « eau » du document divise les litres d'Impact'IA par l'**énergie** EcoLogits (kWh), et non par son eau : c'est vraisemblablement une erreur dans le document, reproduite telle quelle par le test ;
  - le carbone ne se reproduit pas à l'unité près. Le test vérifie la conclusion du document (Impact'IA plus élevé pour les 24 modèles) et la cohérence du classement (corrélation de rang ≥ 0,85).

Les valeurs EcoLogits 0.10.2 utilisées sont figées dans `test/ecologits-reference.json`, pour ne pas dépendre de la bibliothèque Python. Avec les fichiers de simulation d'origine, ces tolérances pourraient être resserrées.

## 7. Comparaison en direct avec l'API EcoLogits

L'onglet « EcoLogits » des résultats annuels interroge l'API publique d'EcoLogits (version à date, distincte de la 0.10.2 du document SNCF) :

- EcoLogits estime une requête : on lui envoie une **requête moyenne** du projet (tokens de sortie annuels / requêtes annuelles), avec la **latence de décodage** estimée par Impact'IA (tokens × 1/TPS, sans le préremplissage, qu'EcoLogits ne modélise pas) et la zone électrique correspondant au mix choisi ;
- la fourchette renvoyée (min–max) est multipliée par le nombre de requêtes annuelles ;
- la valeur affichée est le milieu de la fourchette ; le ratio de chaque carte compare l'inférence d'Impact'IA (RAG, front et traitement des requêtes, sans entraînement) à cette valeur ;
- les autres indicateurs d'EcoLogits (ressources abiotiques, énergie primaire) sont affichés dans des cartes supplémentaires, faute d'équivalent dans Impact'IA ;
- une intensité carbone personnalisée ne peut pas être transmise : la zone du mix par défaut est alors utilisée, et l'écran le signale.

Les données envoyées sont le fournisseur, le modèle, les tokens et la latence d'une requête moyenne et la zone électrique ; aucune donnée personnelle.
