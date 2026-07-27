#!/usr/bin/env node

import { cp, chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import '../src/log-sanitize.js';

const EXTENSION_ID = process.env.HHJA_EXTENSION_ID || 'ohcopjcjekbfmlplembcbjocilnginmj';
const PROFILE = process.env.HHJA_CHROME_PROFILE || 'Profile 1';
const DEFAULT_STORAGE_DIR = join(
  homedir(),
  'Library/Application Support/Google/Chrome',
  PROFILE,
  'Local Extension Settings',
  EXTENSION_ID
);
const STORAGE_READ_ATTEMPTS = 3;
const sanitize = globalThis.HHJA_LOG_SANITIZE.sanitize;

function parseArgs(argv) {
  const args = {
    storageDir: process.env.HHJA_EXTENSION_STORAGE_DIR || DEFAULT_STORAGE_DIR,
    file: '',
    since: process.env.HHJA_SINCE || '',
    json: false,
    output: '',
    privateAuditOutput: ''
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--json') args.json = true;
    else if (value === '--since') args.since = argv[++index] || '';
    else if (value === '--storage-dir') args.storageDir = argv[++index] || args.storageDir;
    else if (value === '--file') args.file = argv[++index] || '';
    else if (value === '--output') args.output = argv[++index] || '';
    else if (value === '--private-audit-output') args.privateAuditOutput = argv[++index] || '';
  }
  return args;
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function countResults(results) {
  const applied = results.filter((item) => /^applied/.test(String(item.status || '')));
  const skipped = results.filter((item) => /^skipped/.test(String(item.status || '')));
  const newSubmitted = applied.filter((item) => item.status !== 'applied_already_confirmed');
  const alreadyApplied = applied.filter((item) => item.status === 'applied_already_confirmed');
  return {
    counts: {
      applied: applied.length,
      newSubmitted: newSubmitted.length,
      alreadyApplied: alreadyApplied.length,
      skipped: skipped.length,
      results: results.length
    },
    applied,
    skipped
  };
}

function parseDebugFileText(text) {
  const entries = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new Error('entry must be an object');
      }
      entries.push(entry);
    } catch (error) {
      throw new Error(`Invalid debug file JSON at line ${index + 1}: ${error.message}`);
    }
  }
  if (entries.length === 0) throw new Error('Debug file is empty');
  const header = entries[0];
  if (header.event !== 'debug_file_created' || !header.details?.formatVersion) {
    throw new Error('Unsupported debug file header');
  }
  return { entries, header };
}

function buildFileReport(args, text) {
  const { entries, header } = parseDebugFileText(text);
  const rawResults = entries
    .filter((entry) => entry.event === 'run_result' && entry.details)
    .map((entry) => ({
      ...entry.details,
      timestamp: entry.details.timestamp || entry.timestamp || ''
    }))
    .filter((item) => !args.since || String(item.timestamp || '') >= args.since);
  const rejectedIdentityless = rawResults.filter(
    (item) => !item || typeof item !== 'object' || !String(item.vacancyId || '').trim()
  ).length;
  const results = rawResults.filter(
    (item) => item && typeof item === 'object' && String(item.vacancyId || '').trim()
  );
  const states = entries
    .filter((entry) => entry.event === 'run_state' && entry.details?.state)
    .map((entry) => ({ ...entry.details, updatedAt: entry.details.updatedAt || entry.timestamp || '' }))
    .sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt)));
  const starts = entries
    .filter((entry) => ['auto_apply_started', 'resume_refresh_started', 'start_run'].includes(entry.event))
    .map((entry) => ({ ...entry.details, timestamp: entry.details?.timestamp || entry.timestamp || '' }))
    .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
  const { counts, applied, skipped } = countResults(results);
  const details = header.details || {};
  const latestState = states.at(-1) || null;
  const terminalComplete = latestState?.state === 'complete' || details.status === 'complete';
  const expectedResults = Math.max(0, Number(latestState?.processed) || 0);
  const assistedResults = results.filter((item) => item.status === 'applied_test_assisted').length;
  const warnings = [];
  if (details.incomplete === true) warnings.push('debug_file_incomplete');
  if (details.truncated === true) warnings.push('debug_history_truncated');
  if (expectedResults !== results.length) warnings.push('result_count_mismatch');
  if (rejectedIdentityless > 0) warnings.push('identityless_result');
  if (assistedResults > 0) warnings.push('private_audit_unavailable');
  const latestDebugFile = {
    name: details.fileName || basename(args.file),
    createdAt: details.createdAt || header.timestamp || '',
    runId: details.runId || '',
    kind: details.kind || '',
    extensionVersion: details.extensionVersion || '',
    status: details.status || '',
    incomplete: details.incomplete === true,
    truncated: details.truncated === true,
    droppedEntries: Number(details.droppedEntries || 0),
    formatVersion: details.formatVersion,
    redaction: details.redaction || ''
  };
  return {
    publicReport: {
      generatedAt: new Date().toISOString(),
      source: { mode: 'debug_file', fileName: basename(args.file) },
      since: args.since,
      counts,
      latestStart: sanitize(starts.at(-1) || null),
      latestState: sanitize(latestState),
      latestDebugFile: sanitize(latestDebugFile),
      hasLocalDebugText: false,
      dailyLedger: null,
      settingsAudit: null,
      privateQuestionAudit: null,
      evidence: {
        complete: terminalComplete && warnings.length === 0,
        expectedResults,
        readResults: results.length,
        rejectedIdentityless,
        debugHistoryTruncated: details.truncated === true,
        droppedDebugEntries: Number(details.droppedEntries || 0),
        privateAuditExpected: assistedResults,
        privateAuditRead: 0,
        warnings
      },
      applied: applied.map((item) => sanitize(item)),
      skipped: skipped.map((item) => sanitize(item))
    },
    privateQuestionAuditRaw: null
  };
}

async function readJsonValue(db, key) {
  try {
    const raw = await db.get(key);
    try {
      return { present: true, valid: true, value: JSON.parse(String(raw)) };
    } catch {
      return { present: true, valid: false, value: null };
    }
  } catch (error) {
    if (error?.code === 'LEVEL_NOT_FOUND') {
      return { present: false, valid: false, value: null };
    }
    throw error;
  }
}

async function readExactStorageSnapshot(storageDir) {
  const snapshotRoot = await mkdtemp(join(tmpdir(), 'hhja-leveldb-snapshot-'));
  const snapshotDir = join(snapshotRoot, 'db');
  await chmod(snapshotRoot, 0o700);
  let db = null;
  try {
    await cp(storageDir, snapshotDir, { recursive: true, force: false });
    const { ClassicLevel } = await import('classic-level');
    db = new ClassicLevel(snapshotDir, { valueEncoding: 'utf8' });
    await db.open();
    const keys = [
      'runResults',
      'runState',
      'dailyApplicationLedger',
      'automationSettingsAudit',
      'agentPrivateQuestionAudit',
      'agentDebugRunIndex',
      'agentDebugActiveRunId'
    ];
    const values = Object.fromEntries(await Promise.all(
      keys.map(async (key) => [key, await readJsonValue(db, key)])
    ));
    const index = Array.isArray(values.agentDebugRunIndex.value)
      ? values.agentDebugRunIndex.value
      : [];
    const activeRunId = String(values.agentDebugActiveRunId.value || index[0]?.id || '');
    values.currentRunRecord = activeRunId
      ? await readJsonValue(db, `agentDebugRun:${activeRunId}`)
      : { present: false, valid: false, value: null };
    return { values, activeRunId };
  } finally {
    await db?.close().catch(() => {});
    await rm(snapshotRoot, { recursive: true, force: true });
  }
}

function multiset(values) {
  const counts = new Map();
  for (const value of values) {
    const key = String(value || '');
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function auditCoverage(results, rawAudit, activeRunId) {
  const assistedIds = results
    .filter((item) => item.status === 'applied_test_assisted')
    .map((item) => String(item.vacancyId || ''));
  const allEntries = Array.isArray(rawAudit?.entries) ? rawAudit.entries : [];
  const entries = activeRunId
    ? allEntries.filter((entry) => String(entry?.runId || '') === activeRunId)
    : allEntries;
  const assisted = multiset(assistedIds);
  const audited = multiset(entries.map((entry) => entry?.vacancyId));
  let missing = 0;
  let orphan = 0;
  for (const [id, count] of assisted) missing += Math.max(0, count - (audited.get(id) || 0));
  for (const [id, count] of audited) orphan += Math.max(0, count - (assisted.get(id) || 0));
  const matched = assistedIds.length - missing;
  return { assistedIds, entries, missing, orphan, matched };
}

function summarizePrivateAudit(rawAudit, coverage) {
  if (!rawAudit || !Array.isArray(rawAudit.entries)) return null;
  return {
    formatVersion: rawAudit.formatVersion,
    retentionDays: rawAudit.retentionDays,
    entriesCount: coverage.entries.length,
    textAnswersCount: coverage.entries.reduce(
      (sum, entry) => sum + (Array.isArray(entry?.questions?.textAnswers) ? entry.questions.textAnswers.length : 0),
      0
    ),
    choiceAnswersCount: coverage.entries.reduce(
      (sum, entry) => sum + (Array.isArray(entry?.questions?.choiceAnswers) ? entry.questions.choiceAnswers.length : 0),
      0
    ),
    coverLettersCount: coverage.entries.filter((entry) => String(entry?.coverLetter || '').trim()).length,
    assistedResultsCount: coverage.assistedIds.length,
    missingAssistedAuditCount: coverage.missing,
    orphanAuditCount: coverage.orphan,
    lastTimestamp: coverage.entries
      .map((entry) => String(entry?.timestamp || ''))
      .sort()
      .at(-1) || ''
  };
}

function buildStorageReport(args, snapshot) {
  const { values, activeRunId } = snapshot;
  const rawResults = Array.isArray(values.runResults.value) ? values.runResults.value : [];
  const rejectedIdentityless = rawResults.filter(
    (item) => !item || typeof item !== 'object' || !String(item.vacancyId || '').trim()
  ).length;
  const results = rawResults.filter(
    (item) => item && typeof item === 'object' && String(item.vacancyId || '').trim()
  );
  const runState = values.runState.value && typeof values.runState.value === 'object'
    ? values.runState.value
    : null;
  const runRecord = values.currentRunRecord.value && typeof values.currentRunRecord.value === 'object'
    ? values.currentRunRecord.value
    : null;
  const rawAudit = values.agentPrivateQuestionAudit.value;
  const coverage = auditCoverage(results, rawAudit, activeRunId);
  const privateQuestionAudit = summarizePrivateAudit(rawAudit, coverage);
  const expectedResults = Math.max(0, Number(runState?.processed) || 0);
  const droppedDebugEntries = Math.max(0, Number(runRecord?.meta?.droppedEntries) || 0);
  const debugHistoryTruncated = droppedDebugEntries > 0 || runRecord?.meta?.truncated === true;
  const warnings = [];
  const required = [
    ['runResults', values.runResults, Array.isArray(values.runResults.value)],
    ['runState', values.runState, Boolean(runState)],
    ['dailyApplicationLedger', values.dailyApplicationLedger, Boolean(values.dailyApplicationLedger.value)],
    ['automationSettingsAudit', values.automationSettingsAudit, Boolean(values.automationSettingsAudit.value)],
    ['currentRunRecord', values.currentRunRecord, Boolean(runRecord)]
  ];
  for (const [key, entry, shapeValid] of required) {
    if (!entry.present || !entry.valid || !shapeValid) warnings.push(`missing_required_key:${key}`);
  }
  if (expectedResults !== results.length) warnings.push('result_count_mismatch');
  if (rejectedIdentityless > 0) warnings.push('identityless_result');
  if (coverage.missing > 0 || coverage.orphan > 0) warnings.push('private_audit_coverage_mismatch');
  if (debugHistoryTruncated) warnings.push('debug_history_truncated');
  const terminalComplete = runState?.state === 'complete';
  const fatalWarnings = warnings.filter((warning) => warning !== 'debug_history_truncated');
  const evidence = {
    complete: terminalComplete && fatalWarnings.length === 0,
    expectedResults,
    readResults: results.length,
    rejectedIdentityless,
    debugHistoryTruncated,
    droppedDebugEntries,
    privateAuditExpected: coverage.assistedIds.length,
    privateAuditRead: coverage.matched,
    warnings
  };
  const starts = Array.isArray(runRecord?.entries)
    ? runRecord.entries
      .filter((entry) => ['auto_apply_started', 'resume_refresh_started', 'start_run'].includes(entry?.event))
      .map((entry) => ({ ...entry.details, timestamp: entry.details?.timestamp || entry.timestamp || '' }))
    : [];
  const { counts, applied, skipped } = countResults(results);
  return {
    publicReport: {
      generatedAt: new Date().toISOString(),
      source: { mode: 'leveldb_snapshot', storageName: basename(args.storageDir) },
      since: args.since,
      counts,
      latestStart: sanitize(starts.at(-1) || null),
      latestState: sanitize(runState),
      latestDebugFile: sanitize(runRecord?.meta || null),
      hasLocalDebugText: false,
      dailyLedger: values.dailyApplicationLedger.value || null,
      settingsAudit: sanitize(values.automationSettingsAudit.value || null),
      privateQuestionAudit,
      evidence,
      applied: applied.map((item) => sanitize(item)),
      skipped: skipped.map((item) => sanitize(item))
    },
    privateQuestionAuditRaw: rawAudit || null
  };
}

async function buildStorageReportWithRetries(args) {
  if (!await pathExists(args.storageDir)) {
    throw new Error(`Extension storage dir not found: ${args.storageDir}`);
  }
  let last = null;
  let lastReadErrorCode = '';
  for (let attempt = 1; attempt <= STORAGE_READ_ATTEMPTS; attempt += 1) {
    try {
      last = buildStorageReport(args, await readExactStorageSnapshot(args.storageDir));
      const report = last.publicReport;
      if (report.latestState?.state !== 'complete' || report.evidence.complete) return last;
    } catch (error) {
      lastReadErrorCode = String(error?.code || error?.name || 'snapshot_read_failed')
        .replace(/[^A-Za-z0-9_.:-]/g, '')
        .slice(0, 80);
    }
  }
  if (!last) {
    throw new Error(
      `Unable to read complete LevelDB snapshot after ${STORAGE_READ_ATTEMPTS} attempts: ${lastReadErrorCode || 'snapshot_read_failed'}`
    );
  }
  throw new Error(
    `Completed storage evidence incomplete after ${STORAGE_READ_ATTEMPTS} attempts: ${last.publicReport.evidence.warnings.join(',')}`
  );
}

async function writeSecureJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

function formatResultLine(item) {
  return [item.timestamp || '', item.status || '', item.vacancyId || ''].filter(Boolean).join(' ');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let built;
  if (args.file) {
    if (!await pathExists(args.file)) throw new Error(`Debug file not found: ${args.file}`);
    built = buildFileReport(args, await readFile(args.file, 'utf8'));
  } else {
    built = await buildStorageReportWithRetries(args);
  }
  const { publicReport, privateQuestionAuditRaw } = built;
  const terminalComplete = publicReport.latestState?.state === 'complete'
    || publicReport.latestDebugFile?.status === 'complete';
  if (terminalComplete && !publicReport.evidence.complete) {
    throw new Error(`Completed report evidence incomplete: ${publicReport.evidence.warnings.join(',')}`);
  }
  if (args.output) await writeSecureJson(args.output, publicReport);
  if (args.privateAuditOutput && privateQuestionAuditRaw) {
    await writeSecureJson(args.privateAuditOutput, privateQuestionAuditRaw);
  }
  if (args.json) {
    console.log(JSON.stringify(publicReport, null, 2));
    return;
  }
  console.log(`Applied: ${publicReport.counts.applied}`);
  console.log(`New submitted: ${publicReport.counts.newSubmitted}`);
  console.log(`Already applied: ${publicReport.counts.alreadyApplied}`);
  console.log(`Skipped: ${publicReport.counts.skipped}`);
  if (publicReport.dailyLedger) {
    console.log(`Daily ledger: date=${publicReport.dailyLedger.date}, new=${publicReport.dailyLedger.newSubmitted}, already=${publicReport.dailyLedger.alreadyApplied}, hhLimit=${publicReport.dailyLedger.hhDailyLimitReached === true}`);
  }
  if (publicReport.latestState) {
    console.log(`Latest state: ${publicReport.latestState.state}, applied=${publicReport.latestState.applied}, processed=${publicReport.latestState.processed}, updatedAt=${publicReport.latestState.updatedAt}`);
  }
  for (const item of [...publicReport.applied.slice(-10), ...publicReport.skipped.slice(-10)]) {
    console.log(formatResultLine(item));
  }
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
