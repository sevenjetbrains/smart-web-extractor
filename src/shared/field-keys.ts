/**
 * Clés techniques des champs ([a-z][a-z0-9_]*), dérivées des libellés.
 * Les libellés restent libres (accents, arabe…) ; seule la clé est normalisée.
 */

export function slugify(label: string): string {
  const base = label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  if (!base) return 'champ';
  return /^[a-z]/.test(base) ? base : `c_${base}`.slice(0, 40);
}

/** Clés uniques, dans l'ordre des libellés (« nom », « nom_2 »…). */
export function uniqueKeys(labels: string[]): string[] {
  const taken = new Set<string>();
  return labels.map((label) => {
    const base = slugify(label);
    let key = base;
    for (let n = 2; taken.has(key); n++) key = `${base}_${n}`;
    taken.add(key);
    return key;
  });
}
