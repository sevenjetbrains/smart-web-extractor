/**
 * Préférences de l'utilisateur, dans chrome.storage.local (cahier §4).
 */
import { z } from '../shared/zod';
import { toStorageError } from './errors';

export const SETTINGS_KEY = 'swx.settings';

export const SettingsSchema = z.strictObject({
  /** Durée de conservation des exécutions et résultats (cahier §6.2). */
  retentionDays: z.number().int().min(1).max(3650),
  /** Date d'acceptation de l'avertissement de premier lancement, ou null. */
  warningAcknowledgedAt: z.string().max(40).nullable(),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = { retentionDays: 30, warningAcknowledgedAt: null };

export async function getSettings(): Promise<Settings> {
  const stored = (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY];
  // Valeur absente ou corrompue : chaque préférence invalide reprend sa valeur par défaut.
  const merged = { ...DEFAULT_SETTINGS, ...(typeof stored === 'object' && stored !== null ? stored : {}) };
  const parsed = SettingsSchema.safeParse(merged);
  if (parsed.success) return parsed.data;
  const result = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    const one = SettingsSchema.shape[key].safeParse(merged[key]);
    if (one.success) (result as Record<string, unknown>)[key] = one.data;
  }
  return result;
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = SettingsSchema.parse({ ...(await getSettings()), ...patch });
  try {
    await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  } catch (e) {
    throw toStorageError(e);
  }
  return next;
}
