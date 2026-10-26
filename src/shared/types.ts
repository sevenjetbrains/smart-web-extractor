/**
 * Modèle de données de référence (cahier des charges §5.1).
 * Scénarios (règles), exécutions (campagnes) et résultats (données) sont distincts.
 * Les schémas de validation correspondants sont dans schemas.ts.
 */

// ---------- Localisateurs ----------
export type LocatorStrategy =
  | { kind: 'id'; value: string }
  | { kind: 'attribute'; name: string; value: string }
  | { kind: 'role'; role: string; name?: string }
  | { kind: 'label'; text: string }
  | { kind: 'css'; selector: string }
  | { kind: 'context'; anchorText: string; relation: 'sameRow' | 'next' | 'parent' | 'columnOfHeader' }
  /** Position de colonne (0 = première), dans la grille du tableau après dépliage des cellules fusionnées. */
  | { kind: 'columnIndex'; index: number };

/** Manière de lire la valeur de l'élément localisé. */
export type ReadMode =
  /** Texte visible, ou valeur pour un champ de formulaire non sensible. */
  | 'text'
  /** Adresse absolue du lien contenu dans l'élément. */
  | 'href'
  /** Texte situé après le premier « : » (ex. « Grade : Ingénieur »). */
  | 'afterColon';

export interface Locator {
  /** Ordonnées par fiabilité décroissante. */
  strategies: LocatorStrategy[];
  /** 'row' : relatif à la ligne courante d'une liste. */
  scope: 'page' | 'row';
  expectedCount: 'one' | 'many';
}

// ---------- Conditions de réussite (déclaratives, jamais de code) ----------
export type SuccessCondition =
  | { kind: 'elementVisible'; locator: Locator }
  | { kind: 'elementGone'; locator: Locator }
  /** Motif glob, pas d'expression régulière arbitraire. */
  | { kind: 'urlMatches'; pattern: string }
  | { kind: 'rowCountChanged' }
  | { kind: 'textChanged'; locator: Locator };

export interface RetryPolicy {
  /** 1 à 5. */
  maxAttempts: number;
  backoffMs: number;
  onFailure: 'skipRecord' | 'pause' | 'switchToAssisted' | 'abort';
}

// ---------- Étapes ----------
export type StepType =
  | 'locateList'
  | 'openDetail'
  | 'extractFields'
  | 'returnToList'
  | 'nextPage'
  | 'waitFor'
  | 'scrollLoad';

export interface Step {
  id: string;
  type: StepType;
  locator?: Locator;
  /** Pour openDetail. */
  openIn?: 'sameTab' | 'backgroundTab';
  /** Pour returnToList. */
  returnMethod?: 'historyBack' | 'locator' | 'closeTab';
  successCondition: SuccessCondition;
  /** 1 000 à 60 000. */
  timeoutMs: number;
  retry: RetryPolicy;
}

// ---------- Champs ----------
export type FieldValueType = 'text' | 'number' | 'date' | 'url';

export interface FieldRule {
  /** Identifiant technique stable, [a-z0-9_]. */
  key: string;
  /** Libellé affiché, renommable. */
  label: string;
  source: 'list' | 'detail' | 'both';
  valueType: FieldValueType;
  required: boolean;
  /** Si vrai : jamais lu ni stocké. */
  sensitive: boolean;
  listLocator?: Locator;
  detailLocator?: Locator;
  /** Ajouté en version 2 du format (cf. storage/migrations.ts). */
  read: ReadMode;
  /** Utilisé si source = 'both'. */
  conflictPolicy: 'preferDetail' | 'preferList' | 'flag';
}

// ---------- Association ----------
export interface AssociationKey {
  primary:
    | { kind: 'technical'; locator: Locator }
    /** Un champ ou une combinaison de champs. */
    | { kind: 'field'; fieldKeys: string[] };
  fallback: 'detailUrl' | 'none';
}

// ---------- Pagination ----------
export type PaginationRule =
  | { kind: 'none' }
  | { kind: 'nextButton'; locator: Locator }
  | { kind: 'pageLinks'; locator: Locator }
  | { kind: 'infiniteScroll'; maxScrolls: number };

// ---------- Source de l'extraction ----------
export type SourceKind = 'table' | 'list' | 'fields';
export type HeaderMode = 'explicit' | 'firstRow' | 'none';

/**
 * Où se trouvent les données sur la page : tableau, liste d'éléments répétés,
 * ou champs isolés d'une fiche. Ajouté en version 2 du format.
 */
export interface ExtractionSource {
  kind: SourceKind;
  container: Locator;
  /** Sélecteur relatif des éléments d'une liste (ex. ":scope > article.carte"). */
  itemSelector?: string;
  headerMode?: HeaderMode;
}

// ---------- Scénario ----------
export type RunMode = 'semi_automatic' | 'automatic';

export interface ScenarioLimits {
  /** Nombre d'enregistrements finaux (fusionnés). */
  maxRecords: number;
  maxPages: number;
  /** Minimum 300. */
  delayBetweenActionsMs: number;
  maxActionsPerMinute: number;
}

export interface Scenario {
  /** Version du format, pour les migrations. */
  schemaVersion: number;
  id: string;
  /** Révision du scénario, incrémentée à chaque modification validée. */
  revision: number;
  name: string;
  /** Ex. "intranet.exemple.local". */
  domain: string;
  /** Doit appartenir à `domain`. */
  startUrl: string;
  recordType: 'list' | 'detail' | 'list_and_details';
  compatibleModes: RunMode[];
  status: 'draft' | 'validated';
  fields: FieldRule[];
  steps: Step[];
  /** Absente des scénarios de version 1. */
  extractionSource?: ExtractionSource;
  pagination: PaginationRule;
  association: AssociationKey;
  limits: ScenarioLimits;
  duplicates: 'flagOnly' | 'flagAndExcludeFromExport';
  /** ISO 8601. */
  createdAt: string;
  updatedAt: string;
}

// ---------- Exécution (campagne) ----------
export type RunState = 'running' | 'paused' | 'assisted' | 'completed' | 'stopped' | 'failed';

export interface Run {
  id: string;
  scenarioId: string;
  scenarioRevision: number;
  mode: RunMode;
  state: RunState;
  progress: { page: number; rowIndex: number; recordsDone: number; errors: number };
  startedAt: string;
  endedAt?: string;
  tabId?: number;
}

// ---------- Résultats ----------
export interface FieldValue {
  /** Valeur extraite, jamais modifiée. */
  original: string | null;
  /** Correction manuelle éventuelle. */
  corrected?: string;
  /** Si source = 'both'. */
  listValue?: string | null;
  detailValue?: string | null;
  conflict?: boolean;
}

export type RecordStatus =
  /** Tous les champs obligatoires présents. */
  | 'complete'
  /** Au moins un champ obligatoire manquant. */
  | 'incomplete'
  /** Échec d'extraction ou fiche inaccessible. */
  | 'error'
  /** Même clé qu'un autre enregistrement de l'exécution. */
  | 'duplicate'
  /** Association liste–fiche non fiable. */
  | 'uncertainMatch';

export interface ResultRecord {
  id: string;
  runId: string;
  scenarioId: string;
  scenarioRevision: number;
  recordKey: string;
  keyKind: 'technical' | 'field' | 'detailUrl';
  values: Record<string, FieldValue>;
  /** URL de la fiche, ou de la liste. */
  sourceUrl: string;
  listPageUrl?: string;
  collectedAt: string;
  /** Plusieurs états possibles. */
  status: RecordStatus[];
  validation: 'unreviewed' | 'validated' | 'rejected';
  /** Suppression logique. */
  deleted: boolean;
  errors: Array<{ stepId?: string; code: string; message: string }>;
}

// ---------- Journal ----------
export interface LogEntry {
  runId: string;
  at: string;
  stepId?: string;
  level: 'info' | 'warning' | 'error';
  /** Ex. FIELD_NOT_FOUND, AMBIGUOUS_LOCATOR. */
  code: string;
  /** Sans aucune valeur extraite sensible. */
  message: string;
}
