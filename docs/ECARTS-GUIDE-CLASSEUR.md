# Impact'IA : écarts relevés entre le guide méthodologique et le classeur

Ce document recense les points relevés en portant la calculatrice Impact'IA en application web. Pour cela, toutes les formules du classeur ont été recalculées et comparées au guide méthodologique et au document « Impact'IA vs Ecologits ». Il est proposé aux auteurs comme un retour constructif : chaque point indique où il se trouve et son effet sur les résultats, et l'arbitrage leur revient.

Sources examinées (dépôt [SNCFdevelopers/ImpactIA](https://github.com/SNCFdevelopers/ImpactIA)) :
- `Impact'IA - Calculatrice - vOpenSource.xlsx` : onglet « Calcul », colonne N pour le modèle sélectionné, colonnes O à R pour les modèles de comparaison ;
- `Impact'IA - Guide méthodologique - vOpenSource.pdf`, v1.0, juillet 2026, 51 pages ;
- `Impact’IA vs Ecologits – Comparaison des périmètres modélisés.pdf`, 10 septembre 2026.

Les ordres de grandeur sont calculés pour Claude Sonnet 4.5, en Production : 100 M de tokens d'entrée et 100 M de tokens de sortie par mois, 1 Md de tokens d'embedding par mois, mix France.

## Synthèse

| # | Sujet | Effet probable |
|---|---|---|
| 1 | Amortissement de l'entraînement : trois paramètres diffèrent du guide | **Entraînement × 50** environ avec les valeurs du guide |
| 2 | Latence par token : TPS OpenRouter au lieu de la formule Ecologits | Serveur, réseau et embarqué **÷ 2 à ÷ 25** selon le modèle |
| 3 | Facteur bâtiment 0,01 au lieu de 0,046 | **GES + 30 %** avec le mix français |
| 4 | Eau de production d'électricité non comptée | **Eau + 30 à 40 %** |
| 5 | Embarqué du serveur inférieur au glossaire | **Eau embarquée × 3** environ avec la valeur du guide |
| 6 | Modèles de comparaison calculés avec les données du modèle sélectionné | Comparaisons faussées ; `#DIV/0!` sans modèle sélectionné |
| 7 | Eau de l'entraînement : eau sur site comptée deux fois | Faible à modéré |
| 8 | Incohérences d'unités (kW × FLOP/W, requêtes mensuelles et tokens annuels…) | Variable, parfois compensé |
| 9 | Valeurs secondaires différentes du glossaire (front, disque dur, réseau, mix mondial) | Faible |
| 10 | Document Ecologits : page 9 non reproductible depuis le classeur | Sans effet sur la calculatrice |
| 11 | Lien de l'AFNOR Spec 2314 erroné | Aucun (contenu) |

## 1. Amortissement de l'entraînement

Le classeur ramène l'énergie de l'entraînement au projet via le nombre de tokens qu'un modèle produit pendant sa vie [N114-N116]. Trois paramètres diffèrent du guide :

| Paramètre | Guide | Classeur |
|---|---|---|
| Part de la capacité de calcul dédiée à l'inférence | 20 % (p. 36, glossaire p. 50) | 0,8 [M118] |
| Efficacité ε_total | 0,5 × 0,5 × (1/PUE) × 0,7 ≈ 0,15 (p. 37) | 0,85 × 0,85 = 0,72 [N115] |
| FLOP par watt | 1,4·10¹² (p. 25) | 2,25·10¹² pour tous les modèles (Modèles_IA) |

Cumulés, les paramètres du guide multiplient l'entraînement attribué au projet par environ 50 : dans l'exemple, il passe de 42 à environ 2 170 kg CO₂e. Le guide annonce un entraînement final de l'ordre de 200 % de l'inférence (p. 16), alors que le classeur en donne environ 20 %. Les colonnes de comparaison [O115] utilisent d'ailleurs la formule ε du guide, contrairement à la colonne du modèle sélectionné [N115].

## 2. Latence par token

Le guide donne la formule Ecologits α·P_actif + β·Batch + γ (p. 40). Le classeur utilise 1/TPS issu d'OpenRouter dès que la valeur existe [N183], soit pour 39 modèles sur 40. En médiane, 1/TPS vaut 0,23 fois la formule (de 0,04 à 0,56 selon le modèle). L'énergie serveur et réseau, l'embarqué et l'eau embarquée en sont réduits d'autant. Le guide est lui-même ambigu : la page 39 et le glossaire mentionnent aussi le TPS d'OpenRouter.

## 3. Facteur bâtiment et environnement technique

Le classeur retient 0,01 kg CO₂e/kWh (Bibliothèque_FE, [M217]). Le guide indique 0,046 (glossaire p. 49) ou 0,0408 (p. 31). Avec un mix bas carbone comme celui de la France, ce poste pèse lourd : le GES total de l'exemple passerait de 280 à 369 kg CO₂e, soit + 32 %.

## 4. Eau consommée pour produire l'électricité

Le facteur « WUE off site » (3,67 L/kWh) est présent dans Bibliothèque_FE, mais il n'entre dans aucun résultat : il n'est utilisé que dans la cellule Ecologits [N234], qui n'alimente rien. La page 5 du guide cite pourtant l'eau nécessaire à la production d'électricité. L'inclure augmenterait l'eau totale d'environ 30 à 40 %.

## 5. Embarqué du serveur

Le glossaire (p. 49) donne 7 670 kg CO₂e et 7 570 m³ pour un serveur « avec GPU ». Le classeur retient 3 952 kg CO₂e et 1 540 m³ pour le serveur, auxquels s'ajoutent 8 GPU (2 353 m³ au total) [M225] [M241]. L'eau embarquée représente environ 75 % de l'eau totale ; avec la valeur du guide, ce poste triplerait à peu près.

## 6. Colonnes de comparaison (O à R)

Les modèles de comparaison de l'onglet Résultats sont calculés avec certaines données du modèle **sélectionné** :
- le PUE : `$N165` dans [O163] et suivantes ;
- le nombre de modèles actifs du fournisseur : `'⚙️Données'!$F$26` dans [O119] ;
- l'embarqué bâtiment du RAG : `$N$129` dans [M138] ;
- une efficacité ε différente de celle du modèle sélectionné [O115], voir §1.

Conséquences : un même modèle ne donne pas le même résultat selon qu'il est sélectionné ou comparé. Sans modèle sélectionné (état du fichier publié), les colonnes de comparaison affichent `#DIV/0!`.

## 7. Eau de l'entraînement

Le guide (p. 26) ajoute à l'entraînement le ratio « embarqué / énergie » de l'inférence. Le classeur [N100] divise toute l'eau de l'inférence par son énergie [N235/N163], ce qui inclut l'eau consommée sur site ; il ajoute ensuite une seconde fois l'eau sur site de l'entraînement [N99].

## 8. Incohérences d'unités

- **Capacité de calcul** [N115-N116] : une puissance en kW est multipliée par des FLOP/W, il manque donc un facteur 1 000. Il compense par hasard la non-prise en compte du faible taux d'utilisation réel des GPU en décodage. À ne corriger qu'en même temps que le §1, sinon l'entraînement devient négligeable.
- **Préremplissage** [N191] : 17,88 ms × requêtes **mensuelles** ('⚙️Données'!D36), alors que les tokens d'entrée sont **annuels**. En phase Conception, D36 est un champ masqué de la phase Production, qui garde sa dernière valeur. L'effet est faible (environ 0,1 % de la latence).
- **Latence d'embedding** [M126] : les tokens annuels sont multipliés par le batch, puis redivisés par le batch [N129]. La constante de 97 ms est donc comptée une fois par an au lieu d'une fois par requête, et le guide (p. 29) omet la division par 1 000 pour passer des ms aux s. Négligeable.
- **TTFT** : en millisecondes dans le guide (p. 40), en secondes dans les données (0,44…).
- **Base de l'eau sur site** : énergie IT sans PUE pour le traitement des requêtes [N236], énergie avec PUE pour le RAG, l'entraînement et le stockage. C'est conforme aux formules du guide, mais pas homogène entre les briques (environ 10 à 20 %).
- **Embarqué réseau** : multiplié par N_GPU/8 pour l'eau [N243], pas pour le GES [N228], alors que le RAG l'applique aux deux [M138] [M142].
- **Phase Conception** [M28] : si la taille de requête (D33) est vide, le ×365 est oublié (parenthésage).

## 9. Valeurs secondaires

| Élément | Glossaire du guide | Classeur |
|---|---|---|
| Nœud du front applicatif (embarqué) | 42,13 kg CO₂e, 43,57 m³ | 19,93 kg CO₂e, 7,27 m³ |
| Puissance d'un nœud | 0,01 kW (p. 35) / 0,0144 kW (glossaire) | 0,0144 kW |
| Tokens traités par nœud | « annuels » (p. 34-35) / « mensuels » (glossaire) | annuels |
| Disque dur (embarqué) | 1 043 kg CO₂e, 270 m³ | 640 kg CO₂e, 163 m³ |
| Puissance d'un pare-feu | 0,095 kW | 0,09 kW |
| Équipements réseau (embarqué) | 1 073 / 2 440 / 1 634 kg (usage compris) | 334 / 403 / 363 kg (embarqué seul, ce qui évite un double compte) |
| Mix électrique mondial | 0,47301 kg CO₂e/kWh | 0,458 kg CO₂e/kWh |
| Tokens d'entraînement | P_actif (p. 21) | P_total [N65] (sans effet visible : le stockage pèse environ 0) |

Le front applicatif utilise par ailleurs un PUE fixe de 1,2 [N146] et un WUE fixe de 0,2 [N156], au lieu de ceux du fournisseur. Le guide indique aussi 0,095 kW pour un disque dur dans son glossaire, contre 0,0095 kW en page 22 (coquille probable ; le classeur suit la page 22). En page 41, il écrit N_GPU|serveur au lieu de N_GPU|projet.

## 10. Document « Impact'IA vs Ecologits »

- **Pages 4-5** : la part « autres composants » se retrouve exactement en la calculant sur l'électricité du traitement des requêtes (`1 − N173/N163`). La part de l'entraînement se retrouve en médiane (13,5 % contre 13 %), mais le maximum de Mistral Medium donne 55 % au lieu de 63 % : la table des modèles a évolué depuis le document.
- **Page 9** : le tableau ne vient pas des cellules « Ecologits » du classeur [N164 à N234], mais de la **bibliothèque EcoLogits 0.10.2**. L'électricité et l'eau se reproduisent à 6 % près, avec un facteur global d'environ **1,40** constant sur les 24 modèles, sans doute un écart de volume de tokens entre les deux simulations. Le ratio « eau » divise les **litres** d'Impact'IA par l'**énergie** (kWh) d'EcoLogits, et non par son eau. Le ratio carbone n'est pas reproductible à partir du classeur actuel.
- **Cellules Ecologits du classeur** : elles s'écartent de la méthode EcoLogits :
  - le facteur France est écrit en dur [N209], au lieu du mix choisi ;
  - le PUE est appliqué à l'eau hors site [N234] ;
  - l'embarqué [N220] multiplie deux fois par une latence.

## 11. Contenu

Dans l'onglet ♻️ Bonnes pratiques, le lien de l'**AFNOR Spec 2314** pointe vers la page du RGESN (même URL que la référence précédente).

---

*Points relevés lors du portage web (dépôt [kameltovic/impactia](https://github.com/kameltovic/impactia)). Les formules et les cellules citées sont détaillées dans [METHODOLOGIE.md](METHODOLOGIE.md).*
