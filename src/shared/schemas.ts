/**
 * Schémas de validation des objets du modèle (cahier §5.1).
 * Les localisateurs peuvent provenir d'un scénario importé : ils sont traités
 * comme des données non fiables (tailles bornées, aucune propriété inconnue).
 */
import { z } from './zod';
import type { Locator, LocatorStrategy, ReadMode } from './types';

const text = (max: number) => z.string().max(max);

export const LocatorStrategySchema: z.ZodType<LocatorStrategy> = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('id'), value: text(200).min(1) }),
  z.strictObject({ kind: z.literal('attribute'), name: text(100).min(1), value: text(300) }),
  z.strictObject({ kind: z.literal('role'), role: text(50).min(1), name: text(300).optional() }),
  z.strictObject({ kind: z.literal('label'), text: text(300).min(1) }),
  z.strictObject({ kind: z.literal('css'), selector: text(1000).min(1) }),
  z.strictObject({
    kind: z.literal('context'),
    anchorText: text(300).min(1),
    relation: z.enum(['sameRow', 'next', 'parent', 'columnOfHeader']),
  }),
  z.strictObject({ kind: z.literal('columnIndex'), index: z.number().int().min(0).max(500) }),
]);

export const LocatorSchema: z.ZodType<Locator> = z.strictObject({
  strategies: z.array(LocatorStrategySchema).min(1).max(10),
  scope: z.enum(['page', 'row']),
  expectedCount: z.enum(['one', 'many']),
});

export const ReadModeSchema: z.ZodType<ReadMode> = z.enum(['text', 'href', 'afterColon']);

export const FieldValueTypeSchema = z.enum(['text', 'number', 'date', 'url']);
