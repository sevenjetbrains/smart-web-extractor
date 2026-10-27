/**
 * Enregistrement d'une extraction manuelle (mode semi-automatique, une page)
 * sous forme d'exécution terminée, avec ses résultats et son journal.
 * L'écriture est atomique : soit tout est enregistré, soit rien.
 */
import { computeRecordKey, markDuplicates } from '../association/keys';
import type { ExtractResult } from '../shared/content-protocol';
import { httpHostname } from '../shared/schemas';
import type { FieldValue, LogEntry, RecordStatus, ResultRecord, Run, Scenario } from '../shared/types';
import { STORES, transaction } from './db';
import { sanitizeLogMessage, urlWithoutParams } from './logs';
import { newRunId } from './runs';

export interface ManualRunInput {
  scenario: Scenario;
  extraction: ExtractResult;
  /** Adresse de la page extraite. */
  pageUrl: string;
  tabId?: number;
  now?: Date;
}

export interface ManualRun {
  run: Run;
  records: ResultRecord[];
  logs: LogEntry[];
}

/**
 * Adresse de la fiche liée à une ligne : premier champ lu comme lien. Le lien
 * vient de la page (non fiable) : seule une adresse http(s) est retenue.
 */
function detailUrlOf(scenario: Scenario, row: Record<string, string | null>, pageUrl: string): string | null {
  if (scenario.recordType === 'detail') return pageUrl;
  const link = scenario.fields.filter((f) => f.read === 'href').map((f) => row[f.key]).find((v) => v && httpHostname(v));
  return link ?? null;
}

export function buildManualRun({ scenario, extraction, pageUrl, tabId, now = new Date() }: ManualRunInput): ManualRun {
  const at = now.toISOString();
  const runId = newRunId();
  const fields = scenario.fields.filter((f) => !f.sensitive);

  let records: ResultRecord[] = extraction.rows.slice(0, scenario.limits.maxRecords).map((row, index) => {
    const values: Record<string, FieldValue> = {};
    for (const field of fields) values[field.key] = { original: row[field.key] ?? null };

    const status: RecordStatus[] = [];
    const errors: ResultRecord['errors'] = [];
    const missing = fields.filter((f) => f.required && values[f.key]!.original === null);
    status.push(missing.length > 0 ? 'incomplete' : 'complete');

    const detailUrl = detailUrlOf(scenario, row, pageUrl);
    const key = computeRecordKey(scenario.association, row, detailUrl);
    if (key && !key.reliable) status.push('uncertainMatch');
    if (!key) {
      status.push('uncertainMatch');
      errors.push({ code: 'KEY_MISSING', message: 'Clé d’association absente : enregistrement identifié par sa position.' });
    }

    return {
      id: `${runId}_${index + 1}`,
      runId,
      scenarioId: scenario.id,
      scenarioRevision: scenario.revision,
      recordKey: key?.recordKey ?? `${urlWithoutParams(pageUrl)}#ligne-${index + 1}`,
      keyKind: key?.keyKind ?? 'detailUrl',
      values,
      sourceUrl: detailUrl ?? pageUrl,
      ...(scenario.recordType === 'detail' ? {} : { listPageUrl: pageUrl }),
      collectedAt: at,
      status,
      validation: 'unreviewed',
      deleted: false,
      errors,
    };
  });
  records = markDuplicates(records);

  const errorCount = records.filter((r) => r.errors.length > 0).length;
  const run: Run = {
    id: runId,
    scenarioId: scenario.id,
    scenarioRevision: scenario.revision,
    mode: 'semi_automatic',
    state: 'completed',
    progress: { page: 1, rowIndex: records.length, recordsDone: records.length, errors: errorCount },
    startedAt: at,
    endedAt: at,
    ...(tabId !== undefined ? { tabId } : {}),
  };

  // Journal : codes et messages techniques uniquement, jamais de valeur extraite.
  const logs: LogEntry[] = [
    {
      runId,
      at,
      level: 'info',
      code: 'MANUAL_EXTRACTION',
      message: sanitizeLogMessage(`Extraction manuelle de ${records.length} enregistrement(s) sur ${pageUrl}.`),
    },
  ];
  for (const warning of extraction.warnings) logs.push({ runId, at, level: 'warning', code: warning.code, message: warning.message });
  for (const field of fields) {
    for (const warning of extraction.fieldWarnings[field.key] ?? []) {
      logs.push({ runId, at, level: 'warning', code: warning.code, message: `Champ ${field.key} : ${warning.message}` });
    }
  }
  if (extraction.rows.length > records.length) {
    logs.push({ runId, at, level: 'warning', code: 'MAX_RECORDS', message: `Limite de ${scenario.limits.maxRecords} enregistrement(s) atteinte.` });
  }
  const duplicates = records.filter((r) => r.status.includes('duplicate')).length;
  if (duplicates > 0) logs.push({ runId, at, level: 'warning', code: 'DUPLICATES', message: `${duplicates} doublon(s) signalé(s).` });

  return { run, records, logs };
}

export async function saveManualRun(input: ManualRunInput): Promise<ManualRun> {
  const built = buildManualRun(input);
  await transaction([STORES.runs, STORES.results, STORES.logs], 'readwrite', (tx) => {
    tx.objectStore(STORES.runs).put(built.run);
    const results = tx.objectStore(STORES.results);
    for (const record of built.records) results.put(record);
    const logs = tx.objectStore(STORES.logs);
    for (const entry of built.logs) logs.add({ ...entry, message: sanitizeLogMessage(entry.message) });
  });
  return built;
}
