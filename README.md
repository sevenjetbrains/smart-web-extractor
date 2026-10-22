# Smart Web Extractor

Extension Chrome (Manifest V3) d'extraction locale de données depuis des tableaux et des fiches détaillées, avec apprentissage du parcours manuel.

La spécification complète est dans [CAHIER_DES_CHARGES.md](CAHIER_DES_CHARGES.md) (version PDF : `cahier_des_charges_smart_web_extractor_v2.pdf`).

## État d'avancement

| Phase | Contenu | État |
|---|---|---|
| 1. Fondations | Build, manifeste, permissions, panneau latéral, routeur de messages validés, injection à la demande | ✅ terminée, en attente de validation |
| 2. Détection | Tableaux, listes, champs, sélecteur visuel, localisateurs | à venir |
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

## Test manuel de la phase 1

1. Lancer le serveur des pages de test : `npm run serve:test-pages`, puis ouvrir <http://127.0.0.1:5174/liste-simple.html>.
2. Cliquer sur l'icône de l'extension : la popup affiche le domaine `127.0.0.1:5174`.
3. Cliquer sur **Ouvrir le panneau latéral**. Le panneau reste ouvert pendant la navigation.
4. Dans le panneau, cliquer sur **Tester l'accès à la page**. Résultat attendu : « Connexion avec la page établie », 1 tableau, 3 champs, 2 champs sensibles ignorés (mot de passe et champ caché).
5. Cliquer sur **Autoriser ce domaine** et accepter : l'accès durable passe à « accordé ».
6. Ouvrir `chrome://extensions` dans le même onglet puis tester l'accès : message « Chrome n'autorise pas les extensions sur cette page ».
7. Ouvrir le **Tableau de bord** depuis la popup : il affiche « Service worker opérationnel ».
8. Dans `chrome://extensions`, vérifier qu'aucune erreur n'est signalée pour l'extension.

L'accès accordé à un domaine peut être retiré dans `chrome://extensions` → Détails → Accès aux sites.

## Architecture

```
src/
├── manifest.ts             # source unique du manifeste (dist/manifest.json est généré)
├── background/             # service worker : routeur de messages, injection à la demande
├── content/                # content script (IIFE), détection des champs sensibles
├── shared/                 # types du modèle (§5.1), messages et schémas Zod
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
- **Service worker sans état en mémoire** : il peut être arrêté par Chrome à tout moment. La persistance de l'état des exécutions arrivera en phase 3.

## Confidentialité

- Aucune donnée n'est envoyée à un serveur externe. Un test de bout en bout et un test sur le code source le vérifient.
- La valeur des champs de formulaire n'est jamais lue. Seul le nombre de champs est renvoyé, et les champs sensibles sont comptés à part.
