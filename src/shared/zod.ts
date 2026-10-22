/**
 * Point d'entrée unique de Zod. Le mode « jitless » empêche Zod de tester
 * `Function("")` pour compiler ses validateurs : le cahier des charges interdit
 * eval/new Function, et la CSP de Manifest V3 le bloquerait de toute façon.
 * Tout le code doit importer Zod depuis ce module, jamais depuis 'zod' directement.
 */
import { z } from 'zod';

z.config({ jitless: true });

export { z };
