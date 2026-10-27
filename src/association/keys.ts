/**
 * Clé d'association d'un enregistrement (cahier §3.4) : elle identifie un
 * enregistrement de façon unique, pour fusionner liste et fiche et pour
 * détecter les doublons. Aucune clé n'est déduite d'une ressemblance de valeurs.
 */
import type { AssociationKey, ResultRecord } from '../shared/types';

/** Paramètres de suivi retirés de l'URL canonique. */
const TRACKING_PARAM = /^(utm_[a-z]+|fbclid|gclid|dclid|msclkid|yclid|mc_cid|mc_eid|_ga|_gl|igshid)$/i;

/** URL canonique d'une fiche : sans fragment ni paramètres de suivi. */
export function canonicalUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    for (const name of [...u.searchParams.keys()]) {
      if (TRACKING_PARAM.test(name)) u.searchParams.delete(name);
    }
    return u.toString();
  } catch {
    return null;
  }
}

export interface RecordKey {
  recordKey: string;
  keyKind: ResultRecord['keyKind'];
  /** Faux pour la clé de repli (URL de la fiche) : risque d'association à signaler. */
  reliable: boolean;
}

/**
 * Calcule la clé d'un enregistrement. Ordre de priorité : champ(s) déclaré(s)
 * par l'utilisateur, puis URL canonique de la fiche si le scénario l'autorise.
 * L'identifiant technique (localisateur) sera lu par le moteur d'extraction
 * (phase 5) ; à défaut, la clé de repli s'applique.
 */
export function computeRecordKey(
  association: AssociationKey,
  values: Record<string, string | null>,
  detailUrl: string | null,
): RecordKey | null {
  const { primary } = association;
  if (primary.kind === 'field') {
    const parts = primary.fieldKeys.map((key) => values[key]?.trim() || null);
    if (parts.every((part): part is string => part !== null)) {
      return { recordKey: parts.length === 1 ? parts[0]! : JSON.stringify(parts), keyKind: 'field', reliable: true };
    }
  }
  if (association.fallback === 'detailUrl' && detailUrl) {
    const url = canonicalUrl(detailUrl);
    if (url) return { recordKey: url, keyKind: 'detailUrl', reliable: false };
  }
  return null;
}

/**
 * Marque `duplicate` les enregistrements dont la clé est déjà portée par un
 * enregistrement précédent de la même exécution. Rien n'est supprimé.
 */
export function markDuplicates<T extends Pick<ResultRecord, 'recordKey' | 'status'>>(records: T[]): T[] {
  const seen = new Set<string>();
  return records.map((record) => {
    if (!seen.has(record.recordKey)) {
      seen.add(record.recordKey);
      return record;
    }
    return record.status.includes('duplicate') ? record : { ...record, status: [...record.status, 'duplicate'] };
  });
}
