# Smart Web Extractor

Extension Chrome (Manifest V3) d'extraction locale de données depuis des tableaux et des fiches détaillées, avec apprentissage du parcours manuel.

La spécification complète est dans [CAHIER_DES_CHARGES.md](CAHIER_DES_CHARGES.md) (version PDF : `cahier_des_charges_smart_web_extractor_v2.pdf`).

## État d'avancement

| Phase | Contenu | État |
|---|---|---|
| 1. Fondations | Build, manifeste, permissions, panneau latéral, routeur de messages validés, injection à la demande | ✅ validée |
| 2. Détection | Tableaux, listes, champs, sélecteur visuel, localisateurs, extraction manuelle | ✅ validée |
| 3. Stockage | Scénarios, révisions, résultats, purge | à venir |
| 4. Apprentissage | Enregistrement du parcours, éditeur de scénario | à venir |
| 5. Automatisation | Navigation, pagination, reprise, mode assisté | à venir |
| 6. Résultats et export | Tableau de résultats, XLSX, CSV | à venir |
| 7. Finalisation | Tests complets, sécurité, accessibilité, documentation | à venir |

## Prérequis

- Node.js 24 (testé avec 24.20) et npm 11
- Google Chrome 116 ou plus récent

## Installation et build

```bash
npm install
npm run build        # vérification TypeScript + build dans dist/
```

## Charger l'extension dans Chrome

1. Ouvrir `chrome://extensions`.
2. Activer le **Mode développeur** (en haut à droite).
3. Cliquer sur **Charger l'extension non empaquetée** et choisir le dossier `dist/`.
4. Épingler l'icône de l'extension dans la barre d'outils (icône puzzle → épingle).

Après chaque `npm run build`, cliquer sur l'icône de rechargement de l'extension dans `chrome://extensions`.

## Tests

```bash
npm test             # tests unitaires (Vitest)
npx playwright install chromium   # une seule fois
npm run test:e2e     # build de test (dist-e2e/) + tests de bout en bout (Playwright)
```

Les tests de bout en bout chargent l'extension dans le Chromium de Playwright. Le Chrome du système n'est pas utilisé, car les versions officielles récentes de Chrome ignorent l'option `--load-extension`. Le build de test (`dist-e2e/`) est identique au build normal, sauf qu'il a un accès permanent à `http://127.0.0.1/*` pour piloter les pages de test sans clic manuel.

## Test manuel

Lancer le serveur des pages de test (`npm run serve:test-pages`), ouvrir <http://127.0.0.1:5174/>, puis le panneau latéral (icône de l'extension → **Ouvrir le panneau latéral**). Le panneau suit l'onglet actif.

### Phase 1 — fondations

1. Sur <http://127.0.0.1:5174/liste-simple.html>, la popup affiche le domaine `127.0.0.1:5174`.
2. **Autoriser ce domaine** : l'accès durable passe à « accordé » (révocable dans `chrome://extensions` → Détails → Accès aux sites).
3. Sur `chrome://extensions`, l'analyse affiche « Chrome n'autorise pas les extensions sur cette page ».
4. Le **Tableau de bord** affiche « Service worker opérationnel ».

### Phase 2 — détection et extraction manuelle

| Page | Action | Résultat attendu |
|---|---|---|
| Liste simple | **Analyser la page** | 2 sources : « Liste des agents » (3 lignes) et les champs du formulaire ; « 2 champ(s) sensible(s) ignoré(s) » |
| Liste simple | Renommer « Nom » en « Nom complet », **Extraire cette page** | Aperçu : 3 lignes, `00123` conservé, nom arabe correct, colonne « Nom complet » |
| Liste sans en-têtes | Analyser, ouvrir « Codes postaux », cocher « La première ligne contient les en-têtes » | Passage de 3 à 2 lignes |
| Cellules fusionnées | Analyser | Colonnes « Identité › Matricule »… ; « Logistique » répété sur 2 lignes ; avertissement « Cellules fusionnées » |
| Annuaire en cartes | Analyser | 1 liste de 4 éléments (le menu est ignoré) ; « Grade » : 1 valeur manquante |
| Annuaire en cartes | Cocher « Obligatoire » sur Grade, extraire | « 1 incomplète(s) », ligne surlignée |
| Annuaire en cartes | **Choisir dans la page**, cliquer un matricule | « « Matricule » sélectionné. » ; un clic sur « Voir la fiche » ne quitte pas la page ; Échap annule |
| Fiche agent | Analyser | 9 champs (Matricule, Nom, Grade, Date d'entrée, Situation, Adresse, Ville, Téléphone, Service), sans le mot de passe ; **Afficher** encadre la valeur dans la page |
| Contenu dynamique | Recharger la page puis analyser tout de suite | Le tableau apparaît après le chargement (3 lignes) |
| Sélecteurs ambigus | Analyser, ouvrir « Champs de la page », extraire | « Localisation ambiguë » ; les deux « Nom » restent vides au lieu d'être choisis au hasard |

Les résultats ne sont pas encore enregistrés : la sauvegarde des scénarios et des résultats arrive en phase 3.

## Architecture

```
src/
├── manifest.ts             # source unique du manifeste (dist/manifest.json est généré)
├── background/             # service worker : routeur de messages, injection à la demande
├── content/                # content script (IIFE) : détection, localisateurs, extraction, sélection visuelle
├── shared/                 # types du modèle (§5.1), messages, protocole du content script, schémas Zod
└── ui/                     # React : popup, panneau latéral, tableau de bord
tests/unit/                 # Vitest
tests/e2e/                  # Playwright
test-pages/                 # pages HTML de démonstration (servies en HTTP local)
scripts/                    # serveur des pages de test
```

### Choix techniques

- **Deux builds Vite** au lieu d'un plugin d'extension (`@crxjs/vite-plugin`) :
  - `vite.config.ts` construit les pages et le service worker en modules ES ;
  - `vite.content.config.ts` construit le content script en un seul fichier IIFE, injecté par `chrome.scripting.executeScript`.

  Ce plugin charge les content scripts via des `web_accessible_resources` accessibles aux sites visités. Cela contredit l'exigence de ne rien exposer aux pages (cahier §4.2 et §4.3).
- **Messages validés** : chaque message passe par un schéma Zod strict. Le service worker n'accepte les ordres que depuis les pages de l'extension, jamais depuis un content script. La réponse du content script est elle aussi revalidée.
- **Zod en mode `jitless`** : sans ce réglage, Zod essaie `Function("")` pour accélérer la validation. Le cahier interdit `eval`/`new Function`, et la CSP de Manifest V3 le bloquerait. Tout import de Zod passe donc par `src/shared/zod.ts`. Un test unitaire le vérifie.
- **Permissions minimales** : `storage`, `scripting`, `activeTab`, `sidePanel`. L'accès aux sites est demandé domaine par domaine (`optional_host_permissions`). Aucun content script n'est déclaré en permanence.
- **Échanges directs panneau ↔ page** : la détection, la sélection dans la page et l'extraction manuelle passent directement du panneau latéral au content script (`chrome.tabs.sendMessage`). Elles attendent des actions de l'utilisateur et ne doivent pas dépendre de la durée de vie du service worker, qui reste seul responsable de l'injection.
- **Localisateurs multi-stratégies** : identifiant stable, attribut stable, rôle accessible, libellé, chemin CSS. Un identifiant ou un attribut présent plusieurs fois n'est jamais retenu ; en cas de correspondances multiples ou de désaccord entre stratégies, la valeur reste vide et l'ambiguïté est signalée. Les colonnes de tableau sont repérées par leur en-tête, puis par leur position.
- **Service worker sans état en mémoire** : il peut être arrêté par Chrome à tout moment. La persistance de l'état des exécutions arrivera en phase 3.

## Confidentialité

- Aucune donnée n'est envoyée à un serveur externe. Un test de bout en bout et un test sur le code source le vérifient.
- La valeur des champs de formulaire n'est jamais lue. Seul le nombre de champs est renvoyé, et les champs sensibles sont comptés à part.

## Limites connues (phase 2)

- Les composants à **Shadow DOM** et les **iframes** sont signalés mais pas encore analysés.
- Le **défilement infini** et les **listes virtualisées** ne sont pas encore gérés (phase 5, avec la pagination).
- Les résultats et les choix de champs ne sont pas enregistrés : ils sont perdus en changeant de page (phase 3).
