# NounouPay — Revue complète de l'application

**Date :** 25 juillet 2026
**Périmètre :** `index.html` (3 063 lignes, 179 Ko), `sw.js`, `manifest.json`, `README.md`
**Objectif de la revue :** rendre l'app utilisable **dans la durée** (plusieurs années de données, montée de version, sauvegarde fiable) et **par tous** (conjoint·e, autres familles, accessibilité).

> Ce document est un **constat + propositions**. Aucune modification de code n'a été faite.
> Les priorités P0/P1/P2 sont des suggestions : on tranche ensemble.

---

## 1. Verdict en une page

L'application est **fonctionnellement riche et soignée** : le calcul de paye couvre le réel et le mensualisé, les indemnités d'entretien / repas / km / cotisations / acomptes, la validation figée par mois, l'historique des paramètres, les analyses annuelles, l'export/import et une synchro cloud. C'est déjà beaucoup, et le code est commenté en français, ce qui est rare et précieux.

Elle n'est en revanche **pas encore prête pour un usage de longue durée ni pour un usage partagé au-delà de deux personnes**. Trois familles de problèmes dominent :

| Famille | Résumé | Gravité |
|---|---|---|
| **Exactitude de la paye** | Les heures payées ignorent les horaires réels saisis dans « Entretien ». Avec les réglages par défaut, l'app paie **40 h/semaine au lieu de 45,5 h**. | 🔴 Critique |
| **Durabilité des données** | Un seul `localStorage` + un seul document Firestore contenant **tout** l'historique en une chaîne JSON. Pas de numéro de version de schéma, pas de sauvegarde automatique, perte irréversible en cas de dévalidation. | 🔴 Critique |
| **Partage / multi-utilisateur** | L'espace cloud est un document unique codé en dur (`shared/couple`) réservé à deux UID déclarés à la main dans la console Firebase. Aucune tierce personne ne peut utiliser l'app. | 🟠 Majeur |

S'y ajoutent **1 bug confirmé** (navigation depuis Analyses), un **risque de saisie décimale à la française**, une **PWA qui n'est pas réellement hors-ligne** (le CSS vient d'un CDN non mis en cache), et des **manques d'accessibilité** (zoom désactivé, calendrier non utilisable au clavier, textes de 9–10 px).

**Ce qui marche déjà très bien** (à conserver tel quel) :
- Le calcul des jours fériés (algorithme de Pâques) — correct, sans dépendance, valable pour toute année.
- La gestion du seuil hebdomadaire à cheval sur deux mois (`index.html:2116-2134`) — logique juste et bien pensée.
- L'échappement HTML systématique (`escapeHtml`) et la normalisation défensive des données importées (`normaliserProfil`) — bon réflexe sécurité.
- Le figeage des payes validées (instantané immuable) — c'est la bonne idée architecturale de l'app.
- La modale de récap, propre et partageable.

---

## 2. Exactitude des calculs de paye

C'est le cœur du sujet : une app de paye qui se trompe est pire que pas d'app.

### 2.1 🔴 Les heures payées ignorent les horaires réels — **incohérence majeure**

L'app connaît deux notions d'horaires qui ne se parlent pas :

- **« Jours & Horaires » (bloc Entretien)** — `index.html:795-798` : horaires **par jour de semaine** (par défaut : 9 h 30 du lundi au jeudi, 8 h 30 le vendredi). Utilisé **uniquement** pour l'indemnité d'entretien.
- **« Heures de garde / jour » (Paramètres au réel)** — `index.html:804`, curseur entier de 1 à 12, **valeur unique** pour toute la semaine. Utilisé **uniquement** pour le salaire (`index.html:2126`).

Conséquence avec le profil par défaut :

| | Horaires saisis (Entretien) | Heures payées (Salaire) |
|---|---|---|
| Lun–Jeu | 9,5 h × 4 = 38 h | 8 h × 4 = 32 h |
| Vendredi | 8,5 h | 8 h |
| **Semaine** | **46,5 h** | **40 h** |
| Heures majorées (seuil 45 h) | 1,5 h | **0 h** |

L'utilisateur saisit ses horaires réels une fois, croit avoir tout paramétré, et **le salaire est calculé sur une valeur sans rapport**. Sur un mois de 21 jours ouvrés à 4,50 €/h, l'écart est d'environ **120 € par mois**.

Aggravant : le curseur `paramHeuresJour` est un `<input type="range">` à pas entier (`min="1" max="12"`, `index.html:571`) — il est **impossible de saisir 9,5 h/jour**, qui est pourtant le cas le plus courant.

**Recommandation (P0)** — une seule source de vérité pour les horaires :
- Le tableau « Jours & Horaires » devient la référence unique (jours de la semaine + durée), utilisé pour le salaire **et** l'entretien.
- « Heures de garde / jour » disparaît, ou devient une valeur de repli quand aucune ligne n'est définie.
- Migration : au premier chargement de la nouvelle version, si des lignes d'entretien existent, on les prend ; sinon on génère une ligne Lun–Ven à `heuresJour`.
- Prévoir un écran de contrôle « voici ce que je vais compter » avant de basculer.

### 2.2 🔴 L'historique des taux est décoratif — il n'entre pas dans le calcul

`renderHistoriqueTaux` (`index.html:1468`) affiche joliment l'évolution des taux, mais `calculerPaye` lit toujours `enf.tauxNormal` (`index.html:2140`), c'est-à-dire **la valeur du jour**.

Conséquence : si vous augmentez le taux horaire en janvier 2027 et que vous rouvrez un mois de 2026 **non validé**, il est recalculé au nouveau taux. Idem pour les tarifs repas, les barèmes km, les taux de cotisation et les valeurs URSSAF (`entretienBaseReference` 3,92 € et `entretienPlancherMinimal` 2,65 €, revalorisées chaque année).

Le figeage des payes validées est la parade — mais elle ne protège que ce qui a été validé **à temps**. Rien ne rappelle de valider, rien ne signale « ce mois passé n'est pas validé ».

**Recommandation (P0/P1)** — au choix :
- **(a) Simple :** bandeau permanent « X mois passés non validés » avec accès direct, + refus de modifier un taux sans avertir « N mois passés non validés seront recalculés ». *(quelques heures)*
- **(b) Robuste :** rendre l'historique **effectif** — `calculerPaye(enf, mois)` va chercher les taux en vigueur à la date du mois. C'est la bonne solution sur le long terme, mais elle touche tout le moteur de calcul. *(1–2 jours)*

Je recommande **(a) maintenant, (b) plus tard**.

### 2.3 🟠 Repas et kilomètres facturés sur tous les jours de garde

`index.html:2174` et `2186` : chaque ration et chaque trajet est multiplié par `joursGarde`, sans exception possible. Impossible d'exprimer « pas de repas le mercredi » ou « trajet école seulement les jours d'école ». En pratique on est obligé de tricher sur le prix unitaire.

**Recommandation (P1)** : ajouter à chaque ration/trajet une sélection de jours de semaine, comme pour les lignes d'entretien (l'UI existe déjà, `JOURS_SEMAINE_BTN`).

### 2.4 🟠 Arrondis : le total peut ne pas égaler la somme des lignes

Tout est calculé en flottants et arrondi seulement à l'affichage (`toFixed(2)`). `totalGeneral` est la somme des valeurs **non arrondies** (`index.html:2210`). Sur un récap, on peut donc voir des lignes qui font 1 234,56 € et un total affiché à 1 234,57 €.

**Recommandation (P1)** : arrondir au centime **à chaque ligne** au moment du calcul, puis sommer les valeurs arrondies. Traiter les montants en centimes entiers en interne serait encore plus propre.

### 2.5 🟡 Manques fonctionnels métier

Non bloquants, mais à connaître si l'app doit servir de référence :
- **Congés payés (10 %)** et régularisation annuelle : absents.
- **Déduction d'absences en mensualisé** : en mode mensualisé, le calendrier n'influence pas le salaire (seulement entretien/repas/km). Une absence non rémunérée ne se déduit pas.
- **Jours fériés** : liste France métropolitaine en dur (`index.html:764-776`) — pas d'Alsace-Moselle (Vendredi saint, 26 décembre) ni DOM, et pas d'ajout manuel possible.
- **Attestation annuelle** (crédit d'impôt garde d'enfant) : les totaux par année existent dans Analyses, mais pas d'export imprimable/PDF.

---

## 3. Durabilité dans le temps

### 3.1 🔴 Un seul point de stockage local, effaçable

`localStorage` sous la clé `nounoupay_v4_state` (`index.html:989`) est le **seul** stockage local. Or :
- iOS/Safari purge le stockage des sites peu utilisés (politique ITP) ; l'installation en PWA sur l'écran d'accueil limite le risque mais ne le supprime pas.
- « Effacer les données de navigation » efface tout, sans avertissement.
- Le quota (~5 Mo) est partagé et le stockage est synchrone.

Si le cloud n'est pas connecté, **une purge = perte totale de plusieurs années de payes**.

**Recommandation (P0)** :
- Rappel d'export automatique (« dernière sauvegarde il y a 47 jours »), avec la date du dernier export mémorisée.
- Demander `navigator.storage.persist()` au premier lancement (protège contre l'éviction automatique).
- À terme, passer sur IndexedDB (asynchrone, quota bien plus large, non purgé de la même façon).

### 3.2 🔴 Dévalider une paye détruit l'instantané, sans retour possible

`devalidePayeMois` fait `delete enf.payesValidees[mois]` (`index.html:2409`). L'instantané figé — qui contenait les taux et montants historiques exacts — **disparaît immédiatement**. Si vous revalidez, le nouveau calcul utilise les paramètres **d'aujourd'hui**. Une simple curiosité (« je clique pour voir ») peut réécrire une paye de 2024 aux taux de 2026.

**Recommandation (P0)** : conserver l'instantané dans un champ `payesArchivees[mois][]` (pile de versions) au lieu de le supprimer, et afficher « version précédente : 1 187,40 € du 03/02/2025 » lors de la revalidation.

### 3.3 🟠 Pas de version de schéma → migrations impossibles à écrire proprement

L'objet `appState` n'a **aucun champ de version**. `normaliserEtat` fait du « best effort » : elle complète les champs manquants avec les valeurs par défaut, mais ne sait pas distinguer « champ absent car ancienne version » de « champ absent car corrompu ». Seuls les instantanés de paye portent un `v: 1` (`index.html:2391`).

Le jour où on renomme un champ ou où on change une unité, il n'y a **aucun moyen fiable** de savoir quoi migrer.

**Recommandation (P0, très peu coûteux)** : ajouter `schemaVersion: 1` à `appState` dès maintenant, et une fonction `migrer(etat)` avec un `switch` par version. C'est une heure de travail qui évitera des jours de galère.

### 3.4 🟠 Le document cloud grossit indéfiniment et est réécrit en entier

Le cloud stocke **tout l'état** dans un unique champ texte `payloadJSON` d'un unique document `shared/couple` (`index.html:2980`). Chaque enregistrement réécrit l'intégralité.

Projection réaliste (2 enfants) :

| Ancienneté | Instantanés de payes | `agendaCustom` | Total approx. |
|---|---|---|---|
| 3 ans | ~72 × 900 o ≈ 65 Ko | ~10 Ko | **~80 Ko** |
| 10 ans | ~240 × 900 o ≈ 216 Ko | ~30 Ko | **~260 Ko** |
| 20 ans / 4 enfants | ~960 × 900 o ≈ 860 Ko | ~120 Ko | **~1 Mo → limite atteinte** |

La limite Firestore est de **1 Mio par document**. Ce n'est pas imminent, mais deux effets se font sentir bien avant :
- Chaque frappe au clavier déclenche `sauvegarderTout()` → `JSON.stringify(appState)` **deux fois** (`index.html:1002-1010`). À 260 Ko, la saisie devient perceptiblement saccadée sur un téléphone d'entrée de gamme.
- Chaque modification pousse 260 Ko sur le réseau (débounce 800 ms). En 4G/itinérance, c'est du gâchis.

**Recommandation (P1)** : découper le document cloud — un document par enfant, et les payes validées dans une sous-collection `payes/{enfantId}_{YYYY}`. Alternativement, un simple archivage : au-delà de N années, les payes anciennes sortent du document actif vers un document « archives » chargé à la demande.

### 3.5 🟠 La PWA n'est pas réellement utilisable hors-ligne

`sw.js` ignore volontairement tout ce qui est cross-origin (`sw.js:31`). Or :
- **Tailwind arrive d'un CDN** (`index.html:21`, `@tailwindcss/browser@4`) et compile le CSS **dans le navigateur au chargement**.
- Firebase arrive de `gstatic.com`.

Hors ligne : `index.html` est servi depuis le cache… **sans aucune feuille de style**. L'app s'affiche en HTML brut, illisible. Le manifeste promet pourtant `display: standalone` et l'app se présente comme fonctionnant hors-ligne.

En plus du hors-ligne, c'est une **dépendance de survie** : le jour où jsDelivr change l'URL ou retire `@tailwindcss/browser@4`, l'app devient inutilisable, sans que personne n'ait touché au code.

**Recommandation (P0)** : compiler Tailwind une fois et **committer le CSS résultant** dans le dépôt (`styles.css`, quelques dizaines de Ko), puis le mettre dans les `ASSETS` du service worker. Bénéfices cumulés : hors-ligne réel, plus de FOUC au lancement, chargement plus rapide, indépendance vis-à-vis d'un CDN tiers. Firebase peut rester en CDN (dégradation propre déjà gérée par `window.Cloud && …`).

### 3.6 🟡 Mise à jour silencieuse et versions incohérentes

Le service worker fait `skipWaiting()` + `clients.claim()` : la nouvelle version prend la main **au milieu d'une session**, sans prévenir. Par ailleurs trois « versions » cohabitent sans lien : le titre `v4.2` (`index.html:12`), la clé `nounoupay_v4_state`, et le cache `nounoupay-v3` (`sw.js:5`).

**Recommandation (P2)** : une constante `APP_VERSION` unique, affichée en bas de l'écran Configuration (indispensable pour du support à distance : « tu es en quelle version ? »), et un bandeau « Nouvelle version disponible — Recharger ».

---

## 4. Partage et multi-utilisateur

### 4.1 🟠 L'espace cloud est codé en dur pour deux personnes

```js
const SHARED_SPACE = 'couple';               // index.html:2943
const spaceDoc = () => doc(db, 'shared', SHARED_SPACE);
```

Toute personne qui se connecte pointe vers **le même document**. La sécurité repose sur des règles Firestore listant deux UID à la main dans la console. Donc :
- Une troisième personne qui se connecte obtient une **erreur de permission** brute (`lecture: permission-denied…`), sans explication utile.
- Si les règles étaient assouplies, **tout le monde partagerait les mêmes données** — fuite immédiate.
- L'UI expose d'ailleurs l'UID avec un bouton « Copier » et le texte « à mettre dans les règles Firestore » (`index.html:611`) : c'est une procédure d'administration manuelle exposée à l'utilisateur final.

C'est le blocage principal du « **utilisable par tous** ».

**Recommandation (P1)** : passer à un modèle par foyer :
```
foyers/{foyerId}          { membres: [uid1, uid2], ... }
foyers/{foyerId}/data/etat
```
avec règle `allow read, write: if request.auth.uid in resource.data.membres`. Par défaut, `foyerId = uid` du créateur ; un écran « Inviter » génère un code de partage. Les deux UID actuels seraient migrés vers un foyer existant. Le bloc « UID / règles Firestore » disparaît de l'interface.

### 4.2 🟠 Dernier écrivain gagne — les modifications simultanées s'écrasent

`Cloud.push` fait un `setDoc` **complet** débouncé à 800 ms (`index.html:2973-2992`). Si vous et votre conjoint·e modifiez chacun un enfant différent en même temps, **l'un des deux jeux de modifications disparaît sans aucun signal**.

**Recommandation (P1)** : soit une transaction avec numéro de révision (rejet + refusion si la révision a changé), soit un découpage du document (§3.4) qui réduit mécaniquement les collisions.

### 4.3 🟠 La fusion de première connexion peut écraser le cloud

`__mergeData` (`index.html:1040-1058`) part du **local** et n'ajoute du cloud que : les profils absents localement, et les clés manquantes de `acomptesParMois` / `agendaCustom` / `payesValidees`. **Tous les autres réglages du cloud sont ignorés** (taux, listes de repas, km, cotisations, horaires), puis le résultat est **repoussé vers le cloud** (`index.html:3044`).

Scénario concret : votre conjoint·e installe l'app sur un nouveau téléphone, joue deux minutes avec les réglages avant de se connecter, puis se connecte. Ses réglages par défaut/bidouillés remontent et remplacent les vôtres dans le cloud. En prime, son profil local par défaut a un `id` différent (`Date.now()`) → il est ajouté comme **enfant supplémentaire**, créant un doublon « Mon Enfant ».

**Recommandation (P0)** : à la première connexion, si le cloud contient des données **et** que le local n'a jamais été modifié (aucune paye validée, aucun agenda personnalisé), **adopter le cloud sans fusion**. Sinon, afficher un écran de choix explicite : « Garder les données de cet appareil / Prendre celles du cloud / Fusionner » avec les dates des deux côtés.

### 4.4 🟡 L'import de fichier écrase le cloud sans prévenir

`importerDonnees` (`index.html:1252`) avertit bien « remplacera toutes les données actuelles », mais pas que la réplication cloud immédiate **écrasera aussi les données de l'autre personne**.

**Recommandation (P2)** : mentionner le cloud dans le message de confirmation quand une session est connectée.

---

## 5. Bugs confirmés

### 5.1 🔴 Cliquer un mois dans Analyses ne bascule pas sur le bon enfant

```js
// index.html:2739 — l'ID part dans le HTML, il devient une chaîne
`<button onclick="ouvrirMoisDepuisStats('${p.enfId}','${p.mois}')">`

// index.html:2877-2878 — mais il est comparé en strict à un nombre
if (appState.enfants.some(e => e.id === enfId)) { … }
```

Les identifiants d'enfant sont des **nombres** (`Date.now()`, `index.html:1306`), l'attribut `onclick` transmet une **chaîne**. `1737000000000 === "1737000000000"` vaut `false` (vérifié). Le bloc est donc systématiquement ignoré.

**Symptôme :** en périmètre « Tous », cliquer sur un mois de l'enfant B change bien le mois affiché mais **reste sur l'enfant A** — on regarde alors la mauvaise paye en croyant voir la bonne. Silencieux, donc trompeur.

**Correctif :** comparer avec `String(e.id) === String(enfId)`, et de façon plus durable **normaliser tous les identifiants en chaînes** (`normaliserListe` le fait déjà pour les sous-listes ; `normaliserProfil` ne le fait pas pour l'enfant).

### 5.2 🟠 Saisie décimale à la française : un taux peut tomber à 0 silencieusement

Tous les champs monétaires sont des `<input type="number">` avec `inputmode="decimal"`. Sur un clavier français, la touche décimale produit une **virgule**. Selon le navigateur, `input.value` devient alors une chaîne vide, et le code fait :

```js
enf.tauxNormal = parseFloat(document.getElementById('paramTauxNormal').value) || 0;  // index.html:1406
```

`parseFloat("") || 0` → **0** (vérifié). Le taux horaire passe à 0 € **sans aucun message**, et toutes les payes non validées deviennent fausses.

Même schéma sur les 9 autres champs numériques (`index.html:1406-1422`, `modifierLigneRepas`, `modifierLigneKm`, `modifierLigneCotisation`).

**Recommandation (P0)** : normaliser la saisie (`value.replace(',', '.')`) avant `parseFloat`, et surtout **ne jamais retomber sur 0 silencieusement** — conserver la valeur précédente et signaler visuellement un champ invalide. À tester en priorité sur l'iPhone réellement utilisé.

### 5.3 🟡 Deux boîtes de dialogue ouvertes = une promesse jamais résolue

`_ouvrirDialog` (`index.html:2347-2366`) écrase `_confirmResolve` sans résoudre la promesse précédente. Si deux confirmations se déclenchent, la première reste en attente pour toujours (fuite mémoire mineure, `await` bloqué).

Par ailleurs ces modales n'ont **ni fermeture au clavier (Échap), ni piège de focus, ni `role="dialog"`**.

### 5.4 🟡 Le mois enregistré est systématiquement écrasé au démarrage

`index.html:995` : `appState.moisEnCours = moisActuelIso();` juste après le chargement. Le champ `moisEnCours` est donc stocké et **synchronisé vers le cloud** pour rien — chaque navigation entre mois déclenche une écriture Firestore et met à jour le « Dernière modif par… ». Résultat : la modale « État du cloud » affiche des modifications fantômes alors que personne n'a rien changé.

**Recommandation (P2)** : sortir `moisEnCours`, `activeEnfantId` et les états d'onglets du payload synchronisé — ce sont des **préférences d'affichage locales**, pas des données.

### 5.5 🟡 Code mort et scories

- `agregerParMois` (`index.html:2776`) n'est jamais appelée.
- `entretienExceptions` (`index.html:799`) est créé, normalisé, synchronisé — et jamais lu.
- `recalculerTauxMajoreSinceNormal` (`index.html:1387`) déclare `const enf` sans l'utiliser ; le nom mélange anglais et français (« Since » pour « Depuis »).
- `Cloud.deleteRemote` (`index.html:2994`) existe sans aucun point d'entrée dans l'UI.

---

## 6. Accessibilité et ergonomie « par tous »

L'app est belle, mais son parti pris graphique la rend difficile d'accès à une partie des utilisateurs.

| Point | Constat | Gravité |
|---|---|---|
| **Zoom désactivé** | `maximum-scale=1.0, user-scalable=no` (`index.html:5`) empêche le zoom sur mobile. Violation directe de WCAG 1.4.4. Bloquant pour une personne presbyte ou malvoyante. | 🟠 |
| **Calendrier non utilisable au clavier** | Les cases sont des `<div>` avec un `addEventListener('click')` (`index.html:2009-2035`) : ni focalisables, ni activables au clavier, ni annoncées par un lecteur d'écran. | 🟠 |
| **Textes minuscules** | `text-[9px]` et `text-[10px]` sont omniprésents (détails, badges, libellés d'axes). En dessous du seuil de lisibilité confortable. | 🟠 |
| **Contrastes faibles** | `text-slate-500` sur fond `slate-950`, `text-slate-600` pour les jours non travaillés : sous le ratio 4,5:1 exigé. | 🟡 |
| **Boutons icône sans libellé** | ❌, ✕, ‹, ›, l'icône nuage : pas d'`aria-label`. Un lecteur d'écran annonce « bouton » ou lit l'emoji. | 🟡 |
| **Pas de focus visible** | Aucun style `:focus-visible` — navigation clavier impossible à suivre. | 🟡 |
| **Information par la couleur seule** | Le calendrier distingue travaillé/non travaillé/férié uniquement par la couleur (plus un barré pour un cas). | 🟡 |
| **Thème sombre imposé** | `color-scheme: dark` forcé, aucun mode clair. Problématique en plein soleil et pour certaines sensibilités visuelles. | 🟡 |

**Recommandation (P1)** : un lot « accessibilité » cohérent — réactiver le zoom, transformer les cases du calendrier en `<button>` avec `aria-pressed` et un `aria-label` explicite (« Mardi 14 janvier, travaillé »), remonter le plancher typographique à 11–12 px, ajouter les `aria-label` manquants et un anneau de focus. Environ **1 journée**, et cela lève l'essentiel des obstacles.

### Ergonomie — points de friction relevés

- **Aucun libellé n'explique la différence** entre « Heures de garde / jour » et le tableau « Jours & Horaires » (cf. §2.1) — l'utilisateur ne peut pas deviner lequel compte.
- **Pas d'écran d'accueil / de premier paramétrage**. Au premier lancement, on tombe sur un profil « Mon Enfant » pré-rempli avec des taux fictifs (4,50 €) et des horaires fictifs. Rien ne dit qu'il faut les changer — risque réel de valider une paye sur des valeurs par défaut.
- **Le bouton « Valider la paye » n'a pas de garde-fou de date** : on peut valider décembre 2027 depuis aujourd'hui.
- **Impossible de consulter le détail d'une paye validée** autrement que par la modale récap ; aucune vue « journal des payes ».
- **Aucune aide contextuelle** sur les notions métier (plancher URSSAF, base de référence 9 h, types de base de cotisation).

---

## 7. Sécurité et vie privée

**Ce qui est correct :** la clé API Firebase exposée n'est pas un secret (c'est bien documenté en commentaire, `index.html:2907`) ; `escapeHtml` est appliqué de manière systématique sur les champs libres ; les données importées sont normalisées avec des listes blanches (`baseType`, formats de dates, états d'agenda) — c'est du bon travail défensif.

**Points d'attention :**

| Point | Détail | Gravité |
|---|---|---|
| **Règles Firestore absentes du dépôt** | Elles n'existent que dans la console Firebase. Personne ne peut les relire, les versionner ni les restaurer. Si le projet est recréé ou l'accès perdu, la configuration de sécurité est perdue. | 🟠 |
| **Données personnelles sans gestion** | Prénoms d'enfants, nom de la nounou, rémunération : ce sont des données personnelles. Aucune mention d'information, aucun moyen de supprimer ses données du cloud depuis l'app (`deleteRemote` existe mais n'est pas branché), et la déconnexion ne purge pas le local. | 🟡 |
| **Identifiants interpolés dans `onclick`** | `onclick="modifierLigneRepas('${repas.id}', …)"`. Le risque est aujourd'hui neutralisé par `idValide` (`index.html:837`), mais c'est fragile : tout nouvel identifiant qui échapperait à la normalisation devient une injection. | 🟡 |
| **Pas de CSP** | Aucune `Content-Security-Policy`. Peu exploitable ici (pas de contenu tiers injecté), mais c'est une défense en profondeur bon marché. | 🟢 |

**Recommandation (P1)** : committer `firestore.rules` dans le dépôt avec un commentaire expliquant le modèle, et brancher un bouton « Supprimer mes données du cloud » + « Effacer les données de cet appareil ».

---

## 8. Maintenabilité et outillage

C'est le facteur le plus déterminant pour « utilisable dans le temps » — pas techniquement, mais humainement : est-ce que ce code sera encore modifiable dans deux ans ?

| Constat | Impact |
|---|---|
| **Un seul fichier de 3 063 lignes / 179 Ko** mêlant HTML, CSS, logique métier, rendu et synchro. | Toute modification demande de relire beaucoup ; les conflits Git sont douloureux. |
| **Aucun test.** Le moteur de calcul — la partie où une erreur coûte de l'argent — n'a **aucune vérification automatique**. | Une régression sur `calculerPaye` passe inaperçue jusqu'à la découverte d'un écart sur une vraie paye. |
| **Aucune CI**, pas de `.github/`. Rien ne vérifie qu'une modification ne casse pas la page. | |
| **`README.md` vide** (une ligne de titre). Aucune documentation du modèle de données, du déploiement, des règles Firestore, ni des valeurs URSSAF à revalider chaque année. | Dans six mois, il faudra tout re-déduire du code. |
| **Logique métier et DOM entrelacés.** `calculerPaye` est heureusement **pure** (excellent point), mais elle est noyée au milieu du rendu. | |
| **Pas de build.** Tailwind compile dans le navigateur (§3.5). | |

**Recommandation (P1) — la plus rentable de tout ce rapport :**

1. **Extraire `calculerPaye` et ses aides** (`joursFeriesAnnee`, `estJourTravaille`, `calculerDatePaques`, `normaliserProfil`) dans un `calc.js` en module ES — sans rien changer à la logique.
2. **Écrire une vingtaine de tests** sur des cas réels : un mois normal, un mois avec semaine à cheval, un mois avec fériés travaillés, le mensualisé, les 4 types de cotisation, le plancher d'entretien. C'est **une demi-journée** et cela protège durablement la partie qui compte.
3. **Une GitHub Action** qui lance les tests à chaque push.
4. **Remplir le README** : modèle de données commenté, procédure de déploiement, règles Firestore, et une section « À faire chaque janvier » listant les valeurs URSSAF à mettre à jour avec leur source.

Le reste du fichier peut rester tel quel : c'est le moteur de calcul qui mérite d'être isolé et testé, pas l'UI.

---

## 9. Plan d'action proposé

Trois lots. Rien n'est engagé — on choisit ensemble.

### Lot 1 — Fiabilité (P0) · estimé 1,5 à 2 jours
> *Objectif : plus aucune perte de données ni calcul faux.*

1. Unifier les horaires : le tableau « Jours & Horaires » devient la source du salaire **et** de l'entretien (§2.1) — **le point le plus important du rapport**.
2. Corriger la saisie décimale à la virgule + supprimer les retombées silencieuses à 0 (§5.2).
3. Corriger la navigation Analyses → enfant (§5.1).
4. Archiver l'instantané au lieu de le supprimer à la dévalidation (§3.2).
5. Ajouter `schemaVersion` + fonction de migration (§3.3).
6. Sécuriser la fusion de première connexion (§4.3).
7. Committer le CSS Tailwind compilé + le mettre en cache dans le service worker (§3.5).
8. Rappel de sauvegarde + `storage.persist()` (§3.1).

### Lot 2 — Pérennité et partage (P1) · estimé 2 à 3 jours
> *Objectif : l'app tient dix ans et s'ouvre à d'autres foyers.*

9. Extraire `calc.js` + tests + CI (§8) — **à faire idéalement avant le lot 1**, pour valider les corrections.
10. Modèle « foyer » côté Firestore + écran d'invitation, fin du `SHARED_SPACE` codé en dur (§4.1).
11. Découpage du document cloud / archivage par année (§3.4).
12. Résolution de conflit par révision (§4.2).
13. Lot accessibilité : zoom, calendrier au clavier, tailles de police, `aria-label`, focus (§6).
14. Arrondis au centime par ligne (§2.4).
15. Bandeau « mois passés non validés » (§2.2a).
16. Jours de semaine sur les repas et les trajets (§2.3).
17. `firestore.rules` versionné + suppression des données depuis l'app (§7).
18. README complet + `APP_VERSION` affichée (§8, §3.6).

### Lot 3 — Confort et fonctionnalités (P2) · à la carte
19. Écran de premier paramétrage guidé.
20. Export PDF/impression du récap + attestation annuelle pour le crédit d'impôt.
21. Historique des taux réellement appliqué au calcul (§2.2b).
22. Congés payés 10 % et déduction d'absences en mensualisé (§2.5).
23. Mode clair / respect du thème système.
24. Jours fériés personnalisables (Alsace-Moselle, DOM).
25. Nettoyage du code mort (§5.5), sortie des préférences d'affichage du payload synchronisé (§5.4).

---

## 10. Mon avis, en trois phrases

L'application a de vraies qualités d'architecture — le calcul est une fonction pure, les payes validées sont figées, les données importées sont normalisées : ce sont exactement les bons choix, et ils rendent tout le reste réparable.

Le problème le plus urgent n'est ni le cloud ni le design : c'est que **les heures payées ne correspondent pas aux horaires que l'utilisateur croit avoir saisis**. Tant que ce point n'est pas réglé, tout le reste est secondaire.

Ensuite, la meilleure heure investie sera celle passée à **extraire le moteur de calcul et à l'entourer de tests** — c'est ce qui déterminera si cette app est encore modifiable sereinement dans deux ans.
