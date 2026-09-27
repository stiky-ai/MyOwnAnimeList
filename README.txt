# Anime History

## Objectif

Anime History est une application personnelle pour constituer et consulter un historique des anime par année et par saison. Elle permet de retrouver les séries d'une saison, de suivre celles que l'on a vues et de conserver ses favoris, sans dépendre d'un compte ni d'un serveur propre au projet.

Le site est composé de fichiers statiques (`index.html`, `style.css` et `app.js`). Les données sont stockées dans IndexedDB, dans le navigateur utilisé. Les services distants ne servent qu'à remplir ou actualiser la copie locale.

## Solution et architecture

La séparation des responsabilités est volontaire :

- **AniList** est l'unique source de synchronisation. Seuls les résultats comportant un identifiant MyAnimeList sont importés, afin de conserver la clé MAL commune aux données anime et aux marqueurs personnels.
- **IndexedDB** est la base locale de consultation. L'application n'interroge pas ces services pour afficher une saison déjà synchronisée.
- **Les données personnelles** (vu, favori étoilé, like, dislike et watchlist « À voir ») sont conservées dans un store séparé des informations publiques des anime.
- **Les images** restent des URL distantes; les fichiers ne sont pas copiés dans la base locale.

Schéma conceptuel :

```text
AniList ── synchronisation ──> IndexedDB
			├── anime (clé MAL ID)
			├── saisons (année + saison + MAL ID)
			├── user (vu, favori)
			└── meta (dernière synchronisation)
```

AniList est interrogé avec son API GraphQL, par année et saison, avec pagination. Les erreurs temporaires réseau, serveur et de limitation de débit sont retentées avec un délai progressif. Le traitement global espace également ses requêtes. Si une saison échoue ou ne contient pas de résultats cohérents, sa copie locale existante reste inchangée.

Les erreurs 408, 429 et 5xx sont retentées avec un délai progressif. La pagination est séquentielle afin de limiter la pression sur l'API.

## Fonctionnalités

### Navigation et consultation

- Choix d'une année et d'une saison (hiver, printemps, été, automne), ou déplacement vers la saison précédente/suivante.
- La vue, l'année et la saison sélectionnées sont inscrites dans l'URL et restaurées au rechargement.
- La première saison affichée est la saison actuelle selon le calendrier.
- Affichage des cartes anime enregistrées localement avec tri configurable.
- Recherche locale en direct sur les titres romaji/principal, anglais et japonais, avec suggestions issues de la base locale et sélection au clavier.
- Filtres « vus uniquement », « favoris uniquement » et « à voir uniquement ».
- Compteurs pour le total de la saison, les anime vus, les favoris et les anime à voir.

Le tri initial **Priorité** place les favoris étoilés d'abord, puis les likes, les anime vus, les dislikes, les anime à voir et enfin les autres anime. Les anime sont triés par note décroissante à l'intérieur de chaque groupe. Les boutons **Note**, **Popularité** et **Titre** permettent de choisir un autre ordre.

### Suivi personnel

- Marquer un anime comme vu ou non vu.
- Ajouter ou retirer un favori.
- Ajouter ou retirer un like avec le cœur, ou un dislike avec un pouce monochrome.
- Activer un favori, un like ou un dislike marque automatiquement l'anime comme vu.
- Ajouter ou retirer le marqueur « À voir » pour les anime prévus plus tard.
- Ces changements sont stockés localement et ne sont jamais envoyés à AniList.

### Fiche détaillée

La fiche affiche le synopsis, les titres, le score AniList, le type, le statut, le nombre d'épisodes, les genres, les studios, les dates et un lien vers la fiche MyAnimeList. La source des informations et du score est indiquée.

### Vues transversales

- **Vue années** : cartes identiques à celles de Saison, regroupées par année. Par défaut, elle affiche en OU les anime vus, favoris et dislikes ; « à voir » est une condition optionnelle.
- **Mes favoris** : uniquement les favoris étoilés, toutes saisons confondues. Les likes ne sont pas inclus.
- **Parcourir** : toutes les fiches locales dans une grille de vignettes. La recherche utilise les titres connus et les cases sélectionnées sont combinées en OU pour rechercher vus, favoris, likes, dislikes ou « à voir ».

### Actualiser toute la base

Le bouton **Initialiser / actualiser toutes les saisons** parcourt les saisons de 1940 jusqu'à la saison courante. Une confirmation prévient que le traitement peut durer plusieurs minutes; le statut indique la saison en cours et un bouton permet d'arrêter après celle-ci. Chaque saison est traitée séparément. Une erreur temporaire déclenche plusieurs tentatives avec un délai croissant; après échec définitif, le traitement continue et la copie locale de cette saison est conservée. Le bilan affiche quelques saisons en échec pour faciliter leur reprise individuelle.

Les API peuvent ne pas avoir de données fiables pour toutes les périodes historiques. Les résultats AniList ne sont associés à une saison que si leur année et leur saison correspondent exactement à la requête. Cela évite qu'une réponse d'une autre année pollue l'historique; les périodes non couvertes sont indiquées parmi les échecs du bilan.

### Sauvegarde et restauration

- **Exporter** crée un fichier JSON comprenant les anime, leurs associations aux saisons, les données personnelles et les métadonnées.
- **Importer** fusionne les enregistrements du fichier avec la base locale. Il ne supprime pas les données existantes.
- Le fichier exporté est une sauvegarde à conserver séparément du navigateur.

## Données conservées

Le store `anime` est indexé par identifiant MAL et contient les informations publiques récupérées : titres, URL MAL, URL d'image, type, épisodes, statut, score, rang/popularité quand disponibles, synopsis, genres, studios, dates et provenance.

Le store `seasons` contient une association distincte par anime et par saison. Une clé de saison seule ne suffit pas : chaque association a une clé composée de l'année, de la saison et de l'identifiant MAL.

Le store `user` est indépendant. Il contient notamment `watched`, `favorite`, `liked`, `disliked` et `watchlist`, indexés par identifiant MAL. Les nouveaux champs sont ajoutés naturellement aux enregistrements existants et restent locaux.

Le store `meta` garde la date, le nombre d'entrées et la source de la dernière synchronisation.

Une migration IndexedDB est exécutée à l'ouverture pour convertir les anciennes associations de saison vers des clés uniques. Elle ne modifie pas les stores de données utilisateur.

## Installation et démarrage

Aucune compilation ni dépendance npm n'est nécessaire.

1. Garder ensemble `index.html`, `app.js` et `style.css`.
2. Ouvrir `index.html` dans un navigateur récent, idéalement Chrome ou Edge.
3. Choisir une année et une saison.
4. Cliquer sur **Actualiser cette saison** ou démarrer **Initialiser / actualiser toutes les saisons**.
5. Attendre le message de fin. Le traitement global peut être arrêté après la saison en cours.

Si le navigateur bloque les requêtes réseau à cause de l'origine `file://`, ouvrir le dossier avec un petit serveur HTTP local (par exemple l'extension Live Server de VS Code), puis recharger la page via l'adresse locale. Il n'est pas nécessaire d'héberger l'application sur Internet.

## Limites et comportement hors ligne

- Une première synchronisation nécessite Internet et la disponibilité de l'API AniList.
- Les saisons déjà téléchargées restent consultables sans API; les actions « Vu », « Favori » et « À voir », la recherche, les vues années et favoris sont locales.
- **Initialiser / actualiser toutes les saisons** peut durer plusieurs minutes et dépend de la couverture et des limites de l'API AniList. Le bilan indique les saisons qui n'ont pas pu être synchronisées; leur copie locale antérieure est préservée. Les échecs temporaires sont retentés automatiquement.
- Les images utilisent des URL distantes et peuvent ne pas s'afficher hors ligne.
- Certains anime AniList n'ont pas d'identifiant MAL. Ces résultats sont volontairement ignorés. La provenance AniList est indiquée dans la fiche et sur la carte.
- Les scores AniList et MyAnimeList sont des évaluations distinctes. Le détail indique la source du score.
- IndexedDB appartient au profil navigateur et à l'origine du site. Effacer les données du navigateur peut supprimer la base; exporter régulièrement un JSON.
- Ce projet n'est affilié ni à MyAnimeList ni à AniList. L'API tierce peut imposer des quotas ou être indisponible.

## Fichiers du projet

- `index.html` : structure et contrôles de l'interface.
- `style.css` : présentation responsive.
- `app.js` : logique de l'application, synchronisation, migration IndexedDB et export/import.
- `README.txt` : cette documentation.
- `AGENTS.md` : consignes de maintenance pour les agents de développement.
