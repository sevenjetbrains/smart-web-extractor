import { describe, expect, it } from 'vitest';
import { canonicalUrl, computeRecordKey, markDuplicates } from '../../src/association/keys';
import type { Run } from '../../src/shared/types';
import { STORES, transaction } from '../../src/storage/db';
import { StorageError, isQuotaError } from '../../src/storage/errors';
import { listLogs, sanitizeLogMessage } from '../../src/storage/logs';
import { buildManualRun, saveManualRun } from '../../src/storage/manual-run';
import {
  clearAllData,
  deleteRun,
  deleteScenarioData,
  getLastPurge,
  purgeExpiredRuns,
  runsExpiringSoon,
} from '../../src/storage/purge';
import { countResults, findByRecordKey, listResults } from '../../src/storage/results';
import { getRun, listRuns, pauseInterruptedRuns, putRun, updateRun } from '../../src/storage/runs';
import { createScenario, listScenarios } from '../../src/storage/scenarios';
import { getSettings, updateSettings } from '../../src/storage/settings';
import { extraction, field, v2Scenario } from './helpers/scenarios';
import { useFakeStorage } from './helpers/storage';

useFakeStorage();

const PAGE = 'http://127.0.0.1:5174/liste-simple.html?session=abc123';
const DAY = 24 * 60 * 60 * 1000;

describe('clé d’association', () => {
  const byMatricule = { primary: { kind: 'field' as const, fieldKeys: ['matricule'] }, fallback: 'detailUrl' as const };

  it('retire le fragment et les paramètres de suivi de l’URL canonique', () => {
    expect(canonicalUrl('https://x.exemple/agents/12?utm_source=mail&id=12&fbclid=z#haut')).toBe('https://x.exemple/agents/12?id=12');
    expect(canonicalUrl('javascript:alert(1)')).toBeNull();
  });

  it('utilise le champ déclaré, puis la combinaison, puis l’URL de la fiche', () => {
    expect(computeRecordKey(byMatricule, { matricule: ' 00123 ' }, null)).toEqual({ recordKey: '00123', keyKind: 'field', reliable: true });
    expect(
      computeRecordKey({ primary: { kind: 'field', fieldKeys: ['nom', 'service'] }, fallback: 'none' }, { nom: 'Benali', service: 'RH' }, null),
    ).toEqual({ recordKey: '["Benali","RH"]', keyKind: 'field', reliable: true });
    expect(computeRecordKey(byMatricule, { matricule: null }, 'https://x.exemple/agents/12#a')).toEqual({
      recordKey: 'https://x.exemple/agents/12',
      keyKind: 'detailUrl',
      reliable: false,
    });
    expect(computeRecordKey({ ...byMatricule, fallback: 'none' }, { matricule: null }, 'https://x.exemple/a')).toBeNull();
  });

  it('signale les doublons sans les supprimer', () => {
    const records = markDuplicates([
      { recordKey: 'a', status: ['complete'] },
      { recordKey: 'b', status: ['complete'] },
      { recordKey: 'a', status: ['incomplete'] },
    ]);
    expect(records.map((r) => r.status)).toEqual([['complete'], ['complete'], ['incomplete', 'duplicate']]);
  });
});

describe('enregistrement d’une extraction manuelle', () => {
  const scenario = v2Scenario({
    fields: [field('matricule', { required: true }), field('nom'), field('code', { sensitive: true }), field('fiche', { read: 'href' })],
  });
  const rows = [
    { matricule: '00123', nom: 'Benali Karim', code: 'secret', fiche: 'http://127.0.0.1:5174/fiche.html?id=1' },
    { matricule: null, nom: 'Sans matricule', code: null, fiche: 'http://127.0.0.1:5174/fiche.html?id=2&utm_source=x' },
    { matricule: '00123', nom: 'Doublon', code: null, fiche: null },
    { matricule: null, nom: 'Ni clé ni lien', code: null, fiche: null },
  ];

  it('construit l’exécution, les enregistrements et leurs états', () => {
    const { run, records } = buildManualRun({ scenario, extraction: extraction(rows), pageUrl: PAGE, tabId: 4 });
    expect(run).toMatchObject({
      scenarioId: 'scn_test',
      scenarioRevision: 1,
      mode: 'semi_automatic',
      state: 'completed',
      tabId: 4,
      progress: { page: 1, rowIndex: 4, recordsDone: 4, errors: 1 },
    });
    expect(records.map((r) => [r.recordKey, r.keyKind, r.status])).toEqual([
      ['00123', 'field', ['complete']],
      ['http://127.0.0.1:5174/fiche.html?id=2', 'detailUrl', ['incomplete', 'uncertainMatch']],
      ['00123', 'field', ['complete', 'duplicate']],
      ['http://127.0.0.1:5174/liste-simple.html#ligne-4', 'detailUrl', ['incomplete', 'uncertainMatch']],
    ]);
    expect(records[3]!.errors).toEqual([expect.objectContaining({ code: 'KEY_MISSING' })]);
    expect(records[0]).toMatchObject({
      runId: run.id,
      sourceUrl: 'http://127.0.0.1:5174/fiche.html?id=1',
      listPageUrl: PAGE,
      validation: 'unreviewed',
      deleted: false,
      values: { matricule: { original: '00123' }, nom: { original: 'Benali Karim' } },
    });
  });

  it('ne stocke jamais la valeur d’un champ sensible', () => {
    const { records } = buildManualRun({ scenario, extraction: extraction(rows), pageUrl: PAGE });
    expect(JSON.stringify(records)).not.toContain('secret');
    expect(records[0]!.values).not.toHaveProperty('code');
  });

  it('respecte la limite d’enregistrements du scénario', () => {
    const limited = { ...scenario, limits: { ...scenario.limits, maxRecords: 2 } };
    const { records, logs } = buildManualRun({ scenario: limited, extraction: extraction(rows), pageUrl: PAGE });
    expect(records).toHaveLength(2);
    expect(logs.map((l) => l.code)).toContain('MAX_RECORDS');
  });

  it('enregistre le tout et le relit, sans valeur extraite dans le journal', async () => {
    const result = extraction(rows);
    result.fieldWarnings = { nom: [{ code: 'MISSING_VALUES', message: '1 valeur(s) manquante(s).' }] };
    const { run } = await saveManualRun({ scenario, extraction: result, pageUrl: PAGE });

    expect(await getRun(run.id)).toEqual(run);
    expect((await listResults(run.id)).map((r) => r.values.nom!.original)).toEqual(['Benali Karim', 'Sans matricule', 'Doublon', 'Ni clé ni lien']);
    expect(await countResults(run.id)).toBe(4);
    expect(await findByRecordKey(run.id, '00123')).toHaveLength(2);

    const logs = await listLogs(run.id);
    expect(logs.map((l) => l.code)).toEqual(['MANUAL_EXTRACTION', 'MISSING_VALUES', 'DUPLICATES']);
    const text = JSON.stringify(logs);
    for (const value of ['00123', 'Benali', 'abc123', 'secret']) expect(text).not.toContain(value);
  });

  it('ne mélange pas les résultats de deux exécutions', async () => {
    const first = await saveManualRun({ scenario, extraction: extraction(rows.slice(0, 1)), pageUrl: PAGE });
    const second = await saveManualRun({ scenario, extraction: extraction(rows.slice(1, 3)), pageUrl: PAGE });
    expect(first.run.id).not.toBe(second.run.id);
    expect(await countResults(first.run.id)).toBe(1);
    expect(await countResults(second.run.id)).toBe(2);
    expect((await listRuns({ scenarioId: 'scn_test' })).map((r) => r.id).sort()).toEqual([first.run.id, second.run.id].sort());
  });
});

describe('journal', () => {
  it('retire les paramètres des adresses citées', () => {
    expect(sanitizeLogMessage('Fiche https://x.exemple/agents?id=00123#a introuvable')).toBe('Fiche https://x.exemple/agents introuvable');
    expect(sanitizeLogMessage('x'.repeat(600))).toHaveLength(500);
  });
});

function run(id: string, patch: Partial<Run> = {}): Run {
  return {
    id,
    scenarioId: 'scn_test',
    scenarioRevision: 1,
    mode: 'semi_automatic',
    state: 'completed',
    progress: { page: 1, rowIndex: 0, recordsDone: 0, errors: 0 },
    startedAt: '2026-09-01T10:00:00.000Z',
    endedAt: '2026-09-01T10:05:00.000Z',
    ...patch,
  };
}

describe('exécutions, purge et conservation', () => {
  it('met en pause les exécutions interrompues au redémarrage', async () => {
    await putRun(run('a', { state: 'running', endedAt: undefined }));
    await putRun(run('b', { state: 'completed' }));
    expect(await pauseInterruptedRuns()).toBe(1);
    expect((await getRun('a'))!.state).toBe('paused');
    expect((await getRun('b'))!.state).toBe('completed');
  });

  it('met à jour une exécution existante uniquement', async () => {
    await putRun(run('a'));
    expect((await updateRun('a', { state: 'stopped' })).state).toBe('stopped');
    await expect(updateRun('absente', { state: 'stopped' })).rejects.toBeInstanceOf(StorageError);
  });

  it('supprime une exécution avec ses résultats et son journal', async () => {
    const scenario = v2Scenario();
    const kept = await saveManualRun({ scenario, extraction: extraction([{ matricule: '1', nom: 'A' }]), pageUrl: PAGE });
    const removed = await saveManualRun({ scenario, extraction: extraction([{ matricule: '2', nom: 'B' }]), pageUrl: PAGE });
    await deleteRun(removed.run.id);
    expect(await getRun(removed.run.id)).toBeNull();
    expect(await countResults(removed.run.id)).toBe(0);
    expect(await listLogs(removed.run.id)).toEqual([]);
    expect(await countResults(kept.run.id)).toBe(1);
  });

  it('supprime tous les résultats d’un scénario sans toucher aux autres', async () => {
    await saveManualRun({ scenario: v2Scenario(), extraction: extraction([{ matricule: '1', nom: 'A' }]), pageUrl: PAGE });
    await saveManualRun({ scenario: v2Scenario(), extraction: extraction([{ matricule: '2', nom: 'B' }]), pageUrl: PAGE });
    const other = await saveManualRun({ scenario: v2Scenario({ id: 'scn_autre' }), extraction: extraction([{ matricule: '3', nom: 'C' }]), pageUrl: PAGE });
    expect(await deleteScenarioData('scn_test')).toBe(2);
    expect((await listRuns()).map((r) => r.id)).toEqual([other.run.id]);
  });

  it('purge les exécutions terminées au-delà de la durée de conservation, après préavis', async () => {
    const now = Date.parse('2026-10-26T12:00:00.000Z');
    await putRun(run('vieille', { endedAt: new Date(now - 31 * DAY).toISOString() }));
    await putRun(run('bientot', { endedAt: new Date(now - 27 * DAY).toISOString() }));
    await putRun(run('recente', { endedAt: new Date(now - 2 * DAY).toISOString() }));
    await putRun(run('en-pause', { state: 'paused', endedAt: undefined, startedAt: new Date(now - 90 * DAY).toISOString() }));

    expect((await runsExpiringSoon(30, now)).map((r) => r.id)).toEqual(['bientot']);
    expect(await purgeExpiredRuns(30, now)).toBe(1);
    expect((await listRuns()).map((r) => r.id).sort()).toEqual(['bientot', 'en-pause', 'recente']);
    expect(await getLastPurge()).toEqual({ at: '2026-10-26T12:00:00.000Z', count: 1 });

    // Durée raccourcie dans les paramètres : la purge suivante en tient compte.
    await updateSettings({ retentionDays: 1 });
    expect(await purgeExpiredRuns((await getSettings()).retentionDays, now)).toBe(2);
    expect((await listRuns()).map((r) => r.id)).toEqual(['en-pause']);
  });

  it('supprime toutes les données de l’extension', async () => {
    await createScenario({ name: 'A', startUrl: 'http://127.0.0.1/', recordType: 'list', fields: [field('a')] });
    await updateSettings({ retentionDays: 90 });
    await saveManualRun({ scenario: v2Scenario(), extraction: extraction([{ matricule: '1', nom: 'A' }]), pageUrl: PAGE });
    await clearAllData();
    expect(await listScenarios()).toEqual([]);
    expect(await listRuns()).toEqual([]);
    expect((await getSettings()).retentionDays).toBe(30);
  });

  it('convertit un dépassement de quota d’IndexedDB et annule la transaction', async () => {
    await putRun(run('a'));
    const quota = new DOMException('plein', 'QuotaExceededError');
    const error = await transaction([STORES.runs], 'readwrite', (tx) => {
      tx.objectStore(STORES.runs).put(run('b'));
      throw quota;
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StorageError);
    expect(isQuotaError(error)).toBe(true);
    expect((await listRuns()).map((r) => r.id)).toEqual(['a']);
  });
});
