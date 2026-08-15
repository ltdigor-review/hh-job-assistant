import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = new URL('../', import.meta.url);
const loggerSource = await readFile(new URL('src/agent-log.js', root), 'utf8');
const sanitizerSource = await readFile(new URL('src/log-sanitize.js', root), 'utf8').catch(() => '');

function createStorage(initial = {}) {
  const data = { ...initial };
  const writes = [];
  const removals = [];
  return {
    data,
    writes,
    removals,
    api: {
      async get(keys) {
        if (keys == null) return { ...data };
        if (Array.isArray(keys)) {
          return Object.fromEntries(keys.map((key) => [key, data[key]]));
        }
        if (typeof keys === 'string') return { [keys]: data[keys] };
        return Object.fromEntries(Object.keys(keys).map((key) => [key, data[key] ?? keys[key]]));
      },
      async set(value) {
        writes.push(value);
        Object.assign(data, value);
      },
      async remove(keys) {
        const list = Array.isArray(keys) ? keys : [keys];
        removals.push(...list);
        for (const key of list) delete data[key];
      }
    }
  };
}

async function loadLogger(storage) {
  globalThis.chrome = {
    storage: { local: storage.api },
    runtime: {
      getManifest() {
        return { version: '9.8.7' };
      }
    }
  };
  if (sanitizerSource) {
    await import(`data:text/javascript;base64,${Buffer.from(sanitizerSource).toString('base64')}#debug-sanitize-${crypto.randomUUID()}`);
  }
  await import(`data:text/javascript;base64,${Buffer.from(loggerSource).toString('base64')}#debug-history-${crypto.randomUUID()}`);
  return globalThis.HHJobAssistantLog;
}

function cleanupLogger() {
  delete globalThis.chrome;
  delete globalThis.HHJobAssistantLog;
  delete globalThis.HHJA_LOG_SANITIZE;
}

async function writeClassicLevelStorage(dir, values) {
  const { ClassicLevel } = await import('classic-level');
  const db = new ClassicLevel(dir, { valueEncoding: 'utf8' });
  await db.open();
  try {
    for (const [key, value] of Object.entries(values)) {
      await db.put(key, JSON.stringify(value));
    }
  } finally {
    await db.close();
  }
}

function storageFixture({
  state = 'complete',
  processed = 3,
  runResults = null,
  privateEntries = null,
  droppedEntries = 0
} = {}) {
  const results = runResults || [
    {
      vacancyId: '101',
      status: 'applied',
      title: 'Secret Java Role',
      url: 'https://hh.ru/vacancy/101?tracking=private#response',
      error: '',
      timestamp: '2026-07-27T10:00:02.000Z'
    },
    {
      vacancyId: '102',
      status: 'applied_test_assisted',
      title: 'Secret QA Role',
      url: 'https://hh.ru/vacancy/102?token=private',
      error: 'Sensitive employer failure explanation',
      timestamp: '2026-07-27T10:00:03.000Z'
    },
    {
      vacancyId: '103',
      status: 'skipped_response_unavailable',
      title: 'Secret Python Role',
      url: 'https://hh.ru/vacancy/103?query=private',
      error: 'HHJA_SAFE_CODE',
      timestamp: '2026-07-27T10:00:04.000Z'
    }
  ];
  const auditEntries = privateEntries || [
    {
      timestamp: '2026-07-27T10:00:03.500Z',
      runId: 'run-current',
      vacancyId: '102',
      url: 'https://hh.ru/vacancy/102?private=audit',
      questions: {
        textAnswers: [{ question: 'Private question', answer: 'Private answer' }],
        choiceAnswers: [{ question: 'Private choice', selectedOptions: ['Private option'] }]
      },
      coverLetter: 'Private cover letter'
    }
  ];
  return {
    runResults: results,
    runState: {
      state,
      processed,
      applied: 2,
      skipped: 1,
      errors: 0,
      currentAction: 'Secret current action',
      lastError: '',
      updatedAt: '2026-07-27T10:00:05.000Z'
    },
    dailyApplicationLedger: {
      date: '2026-07-27',
      legacySubmitted: 4,
      newSubmitted: 12,
      alreadyApplied: 7,
      submittedVacancyIds: ['1', '2'],
      alreadyAppliedVacancyIds: ['3'],
      hhDailyLimitReached: false,
      updatedAt: '2026-07-27T10:00:05.000Z'
    },
    automationSettingsAudit: {
      checkedAt: '2026-07-27T09:59:59.000Z',
      checks: { dailyLimit200: true },
      issues: [],
      ready: true
    },
    agentPrivateQuestionAudit: {
      formatVersion: 1,
      retentionDays: 7,
      entries: auditEntries
    },
    agentDebugActiveRunId: 'run-current',
    agentDebugRunIndex: [
      {
        id: 'run-current',
        runId: 'run-current',
        name: 'hh-job-assistant-auto-apply-current.debug',
        createdAt: '2026-07-27T10:00:00.000Z',
        updatedAt: '2026-07-27T10:00:05.000Z',
        status: state,
        inProgress: state !== 'complete',
        droppedEntries
      }
    ],
    'agentDebugRun:run-current': {
      meta: {
        id: 'run-current',
        runId: 'run-current',
        name: 'hh-job-assistant-auto-apply-current.debug',
        createdAt: '2026-07-27T10:00:00.000Z',
        updatedAt: '2026-07-27T10:00:05.000Z',
        extensionVersion: '0.1.238',
        status: state,
        inProgress: state !== 'complete',
        droppedEntries
      },
      entries: [
        {
          timestamp: '2026-07-27T10:00:00.000Z',
          scope: 'content',
          event: 'start_run',
          details: {
            runId: 'run-current',
            mode: 'live',
            limit: 200,
            extensionVersion: '0.1.238',
            flowVersion: 'list-click-return-v12',
            url: 'https://hh.ru/search/vacancy?text=Private'
          }
        }
      ]
    }
  };
}

test('[BS:COVERS:HHJA-BR-000038] debug history is opt-in, retains N runs, and downloads the selected run', async () => {
  const storage = createStorage({
    agentDebugLogsEnabled: false,
    agentDebugRetentionCount: 2
  });
  const logger = await loadLogger(storage);

  try {
    await logger.reset('content', 'auto_apply_started', { runId: 'disabled-run', mode: 'live' });
    await logger.append('content', 'disabled_event', { status: 'error' });
    assert.deepEqual(await logger.listRuns(), []);
    assert.equal(storage.data.agentDebugActiveRunId, undefined);

    storage.data.agentDebugLogsEnabled = true;
    await logger.append('content', 'enabled_mid_run', { status: 'error' });
    assert.deepEqual(await logger.listRuns(), []);

    await logger.reset('content', 'auto_apply_started', { runId: 'run-1', mode: 'live' });
    await logger.append('background', 'run_state', { state: 'complete', applied: 1 });
    await logger.append('content', 'only_run_1', { vacancyId: '111', status: 'applied' });

    await logger.reset('background', 'resume_refresh_started', { runId: 'run-2', action: 'refresh_resumes' });
    await logger.append('background', 'run_state', { state: 'complete', processed: 1 });
    await logger.append('background', 'only_run_2', { status: 'complete' });

    await logger.reset('content', 'auto_apply_started', { runId: 'run-3', mode: 'dry' });
    await logger.append('background', 'run_state', { state: 'error', errors: 1 });

    const runs = await logger.listRuns();
    assert.deepEqual(runs.map((run) => run.id), ['run-3', 'run-2']);
    assert.equal(storage.data['agentDebugRun:run-1'], undefined);
    assert.equal(runs[0].kind, 'auto_apply');
    assert.equal(runs[0].status, 'error');
    assert.equal(runs[0].extensionVersion, '9.8.7');
    assert.equal(runs[1].kind, 'resume_refresh');

    const selected = await logger.getArtifact('run-2');
    assert.equal(selected.available, true);
    assert.match(selected.name, /^hh-job-assistant-resume-refresh-.+\.debug$/);
    assert.match(selected.text, /only_run_2/);
    assert.doesNotMatch(selected.text, /only_run_1/);
    assert.ok(selected.text.endsWith('\n'));
    for (const line of selected.text.trim().split('\n')) {
      assert.doesNotThrow(() => JSON.parse(line));
    }
  } finally {
    cleanupLogger();
  }
});

test('debug history retains a realistic 200-vacancy run and still truncates true overflow', async () => {
  const storage = createStorage({
    agentDebugLogsEnabled: true,
    agentDebugRetentionCount: 2
  });
  const logger = await loadLogger(storage);
  const realisticEvents = [
    'run_state',
    'response_form_direct_open',
    'question_form_detected',
    'provider_request_started',
    'provider_request_completed',
    'question_answers_generated',
    'question_answers_validated',
    'question_answers_applied',
    'cover_letter_generated',
    'cover_letter_applied',
    'pending_submit_saved',
    'submit_clicked',
    'submit_confirmation_started',
    'submit_confirmation_detected',
    'daily_ledger_updated',
    'run_result',
    'queue_advanced',
    'search_return_started'
  ];

  try {
    await logger.reset('content', 'auto_apply_started', { runId: 'capacity-200', mode: 'live' });
    for (let index = 0; index < 200; index += 1) {
      for (const event of realisticEvents) {
        await logger.append('content', event, {
          vacancyId: String(100000 + index),
          status: event === 'run_result' ? 'applied' : 'ok',
          processed: index + 1
        });
      }
    }
    await logger.append('background', 'run_state', { state: 'complete', processed: 200, applied: 200 });

    const artifact = await logger.getArtifact('capacity-200');
    const lines = artifact.text.trim().split('\n').map((line) => JSON.parse(line));
    const header = lines[0];
    const events = lines.slice(1);
    assert.equal(header.details.truncated, false);
    assert.equal(header.details.droppedEntries, 0);
    assert.equal(events[0].event, 'auto_apply_started');
    assert.equal(events.filter((entry) => entry.event === 'run_result').length, 200);
    assert.equal(events.at(-1).event, 'run_state');
    assert.equal(events.at(-1).details.state, 'complete');

    await logger.reset('content', 'auto_apply_started', { runId: 'capacity-overflow', mode: 'live' });
    for (let index = 0; index < logger.MAX_ENTRIES + 5; index += 1) {
      await logger.append('content', 'overflow_event', { processed: index + 1 });
    }
    const overflowArtifact = await logger.getArtifact('capacity-overflow');
    const overflowHeader = JSON.parse(overflowArtifact.text.split('\n')[0]);
    assert.equal(overflowHeader.details.truncated, true);
    assert.equal(overflowHeader.details.droppedEntries, 6);
  } finally {
    cleanupLogger();
  }
});

test('[BS:COVERS:HHJA-BR-000039] stored and exported debug history anonymizes personal text and secrets', async () => {
  const storage = createStorage({
    agentDebugLogsEnabled: true,
    agentDebugRetentionCount: 5
  });
  const logger = await loadLogger(storage);

  try {
    await logger.reset('content', 'auto_apply_started', {
      runId: 'safe-run',
      mode: 'live',
      url: 'https://hh.ru/search/vacancy?text=Secret+Role&token=query-secret'
    });
    await logger.append('background', 'groq_test_assist_request', {
      apiKey: 'gsk_key_secret',
      authorization: 'Bearer bearer-secret',
      expectedSalary: '250 000 рублей',
      telegramUsername: '@private_candidate',
      title: 'Secret Role at Secret Company',
      age: 37,
      questions: [{ question: 'Private employer question', answer: 'Private candidate answer' }],
      requestBody: {
        messages: [{ role: 'user', content: 'Full private resume and prompt' }]
      },
      url: 'https://hh.ru/applicant/vacancy_response?vacancyId=123&access_token=url-secret',
      vacancyId: '123',
      status: 'waiting_for_dialog',
      model: 'openai/gpt-oss-120b',
      componentLengths: { resumeBrief: 42 }
    });

    const artifact = await logger.getArtifact('safe-run');
    const stored = JSON.stringify(storage.data['agentDebugRun:safe-run']);
    for (const secret of [
      'gsk_key_secret',
      'bearer-secret',
      '250 000 рублей',
      '@private_candidate',
      'Secret Role',
      'Secret Company',
      'Private employer question',
      'Private candidate answer',
      'Full private resume and prompt',
      'query-secret',
      'url-secret',
      '"age":37'
    ]) {
      assert.doesNotMatch(stored, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.doesNotMatch(artifact.text, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    assert.match(artifact.text, /"vacancyId":"123"/);
    assert.match(artifact.text, /"model":"openai\/gpt-oss-120b"/);
    assert.match(artifact.text, /"resumeBrief":42/);
    assert.match(artifact.text, /https:\/\/hh\.ru\/applicant\/vacancy_response/);
    assert.doesNotMatch(artifact.text, /\?vacancyId|access_token/);

    const header = JSON.parse(artifact.text.split('\n')[0]);
    assert.equal(header.event, 'debug_file_created');
    assert.equal(header.details.formatVersion, 2);
    assert.equal(header.details.redaction, 'anonymized');
    assert.equal(header.details.runId, 'safe-run');
    assert.equal(header.details.incomplete, true);
    assert.equal(header.details.truncated, false);
  } finally {
    cleanupLogger();
  }
});

test('debug history trims immediately and clearHistory removes history plus legacy raw logs', async () => {
  const storage = createStorage({
    agentDebugLogsEnabled: true,
    agentDebugRetentionCount: 3,
    agentDebugLog: [{ event: 'legacy-private' }],
    agentDebugLogFile: { name: 'legacy.debug' },
    agentDebugLogText: 'legacy private text'
  });
  const logger = await loadLogger(storage);

  try {
    for (const id of ['run-a', 'run-b', 'run-c']) {
      await logger.reset('content', 'auto_apply_started', { runId: id, mode: 'live' });
    }
    await logger.trimHistory(1);
    assert.deepEqual((await logger.listRuns()).map((run) => run.id), ['run-c']);
    assert.equal(storage.data['agentDebugRun:run-a'], undefined);
    assert.equal(storage.data['agentDebugRun:run-b'], undefined);

    await logger.clearHistory();
    assert.deepEqual(await logger.listRuns(), []);
    for (const key of [
      'agentDebugActiveRunId',
      'agentDebugRunIndex',
      'agentDebugLog',
      'agentDebugLogFile',
      'agentDebugLogText',
      'agentDebugRun:run-c'
    ]) {
      assert.equal(storage.data[key], undefined, key);
    }
  } finally {
    cleanupLogger();
  }
});

test('inspect:logs reads a downloaded debug file and rejects malformed NDJSON with a line number', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hhja-debug-file-'));
  const file = join(dir, 'selected-run.debug');
  const malformed = join(dir, 'malformed.debug');
  const lines = [
    {
      timestamp: '2026-07-26T10:00:00.000Z',
      scope: 'extension',
      event: 'debug_file_created',
      details: {
        formatVersion: 2,
        runId: 'run-selected',
        kind: 'auto_apply',
        extensionVersion: '9.8.7',
        status: 'complete'
      }
    },
    {
      timestamp: '2026-07-26T10:00:01.000Z',
      scope: 'background',
      event: 'run_state',
      details: { state: 'complete', applied: 1, processed: 1, skipped: 0, errors: 0 }
    },
    {
      timestamp: '2026-07-26T10:00:02.000Z',
      scope: 'background',
      event: 'run_result',
      details: { vacancyId: '123', status: 'applied', timestamp: '2026-07-26T10:00:02.000Z' }
    }
  ];

  try {
    await writeFile(file, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf8');
    const { stdout } = await execFileAsync(process.execPath, [
      'scripts/inspect-extension-log.mjs',
      '--file',
      file,
      '--json'
    ], { cwd: new URL('.', root) });
    const report = JSON.parse(stdout);
    assert.deepEqual(report.source, { mode: 'debug_file', fileName: 'selected-run.debug' });
    assert.equal(report.latestDebugFile.runId, 'run-selected');
    assert.equal(report.latestState.state, 'complete');
    assert.equal(report.counts.applied, 1);

    await writeFile(malformed, `${JSON.stringify(lines[0])}\nnot-json\n`, 'utf8');
    await assert.rejects(
      execFileAsync(process.execPath, ['scripts/inspect-extension-log.mjs', '--file', malformed], {
        cwd: new URL('.', root)
      }),
      /Invalid debug file JSON at line 2/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('inspect:logs fails closed for completed debug files with missing result identity or count', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hhja-debug-incomplete-'));
  const identityless = join(dir, 'identityless.debug');
  const countMismatch = join(dir, 'count-mismatch.debug');
  const header = {
    timestamp: '2026-07-27T10:00:00.000Z',
    scope: 'extension',
    event: 'debug_file_created',
    details: {
      formatVersion: 2,
      runId: 'run-incomplete',
      extensionVersion: '0.1.239',
      status: 'complete'
    }
  };

  try {
    await writeFile(identityless, [
      header,
      {
        timestamp: '2026-07-27T10:00:01.000Z',
        event: 'run_state',
        details: { state: 'complete', processed: 1 }
      },
      {
        timestamp: '2026-07-27T10:00:02.000Z',
        event: 'run_result',
        details: { status: 'skipped_unknown', title: 'Private identity-less title' }
      }
    ].map((line) => JSON.stringify(line)).join('\n'), 'utf8');
    await assert.rejects(
      execFileAsync(process.execPath, ['scripts/inspect-extension-log.mjs', '--file', identityless], {
        cwd: new URL('.', root)
      }),
      /Completed report evidence incomplete: result_count_mismatch,identityless_result/
    );

    await writeFile(countMismatch, [
      header,
      {
        timestamp: '2026-07-27T10:00:01.000Z',
        event: 'run_state',
        details: { state: 'complete', processed: 2 }
      },
      {
        timestamp: '2026-07-27T10:00:02.000Z',
        event: 'run_result',
        details: { vacancyId: '101', status: 'applied' }
      }
    ].map((line) => JSON.stringify(line)).join('\n'), 'utf8');
    await assert.rejects(
      execFileAsync(process.execPath, ['scripts/inspect-extension-log.mjs', '--file', countMismatch], {
        cwd: new URL('.', root)
      }),
      /Completed report evidence incomplete: result_count_mismatch/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('[BS:COVERS:HHJA-BR-000040] inspect:logs reads exact current evidence from a ClassicLevel snapshot and separates private audit', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hhja-level-source-'));
  const output = join(dir, 'public.json');
  const privateOutput = join(dir, 'private.json');
  await writeClassicLevelStorage(join(dir, 'db'), storageFixture());

  try {
    const { stdout } = await execFileAsync(process.execPath, [
      'scripts/inspect-extension-log.mjs',
      '--storage-dir',
      join(dir, 'db'),
      '--output',
      output,
      '--private-audit-output',
      privateOutput,
      '--json'
    ], { cwd: new URL('.', root) });
    const report = JSON.parse(stdout);
    assert.deepEqual(report.source, { mode: 'leveldb_snapshot', storageName: 'db' });
    assert.deepEqual(report.counts, {
      applied: 2,
      newSubmitted: 2,
      alreadyApplied: 0,
      skipped: 1,
      results: 3
    });
    assert.equal(report.dailyLedger.newSubmitted, 12);
    assert.equal(report.evidence.complete, true);
    assert.equal(report.evidence.expectedResults, 3);
    assert.equal(report.evidence.readResults, 3);
    assert.equal(report.evidence.rejectedIdentityless, 0);
    assert.equal(report.evidence.privateAuditExpected, 1);
    assert.equal(report.evidence.privateAuditRead, 1);
    assert.deepEqual(report.evidence.warnings, []);
    assert.equal(report.latestState.updatedAt, '2026-07-27T10:00:05.000Z');
    assert.equal(report.privateQuestionAudit.entriesCount, 1);
    assert.equal(report.privateQuestionAudit.textAnswersCount, 1);
    assert.equal(report.privateQuestionAudit.choiceAnswersCount, 1);
    assert.equal(report.privateQuestionAudit.coverLettersCount, 1);
    assert.equal(report.privateQuestionAudit.assistedResultsCount, 1);
    assert.equal(report.privateQuestionAudit.missingAssistedAuditCount, 0);
    assert.equal(report.privateQuestionAudit.orphanAuditCount, 0);
    assert.equal(report.privateQuestionAuditRaw, undefined);
    assert.equal(report.applied[0].title.redacted, true);
    assert.equal(report.applied[0].url, 'https://hh.ru/vacancy/101');
    assert.equal(report.applied[1].error.redacted, true);
    assert.equal(report.skipped[0].error, 'HHJA_SAFE_CODE');
    assert.doesNotMatch(stdout, /Secret Java Role|Sensitive employer|Private question|Private answer|Private cover letter/);

    const publicText = await readFile(output, 'utf8');
    const privateText = await readFile(privateOutput, 'utf8');
    assert.doesNotMatch(publicText, /Private question|Private answer|Private cover letter/);
    assert.match(privateText, /Private question/);
    assert.match(privateText, /Private answer/);
    assert.match(privateText, /Private cover letter/);
    assert.equal((await stat(output)).mode & 0o777, 0o600);
    assert.equal((await stat(privateOutput)).mode & 0o777, 0o600);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('inspect:logs rejects identity-less current rows from active evidence without leaking them', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hhja-level-identity-'));
  const values = storageFixture({
    state: 'applying',
    processed: 2,
    runResults: [
      {
        vacancyId: '101',
        status: 'applied',
        title: 'Safe identity',
        timestamp: '2026-07-27T10:00:02.000Z'
      },
      {
        status: 'skipped_unknown',
        title: 'Identity-less secret',
        error: 'Identity-less private error',
        timestamp: '2026-07-27T10:00:03.000Z'
      }
    ],
    privateEntries: []
  });
  await writeClassicLevelStorage(join(dir, 'db'), values);

  try {
    const { stdout } = await execFileAsync(process.execPath, [
      'scripts/inspect-extension-log.mjs',
      '--storage-dir',
      join(dir, 'db'),
      '--json'
    ], { cwd: new URL('.', root) });
    const report = JSON.parse(stdout);
    assert.equal(report.counts.results, 1);
    assert.equal(report.evidence.complete, false);
    assert.equal(report.evidence.rejectedIdentityless, 1);
    assert.ok(report.evidence.warnings.includes('identityless_result'));
    assert.doesNotMatch(stdout, /Identity-less secret|Identity-less private error/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('inspect:logs retries then fails closed for incomplete completed LevelDB evidence', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hhja-level-incomplete-'));
  await writeClassicLevelStorage(join(dir, 'db'), storageFixture({
    processed: 4
  }));

  try {
    await assert.rejects(
      execFileAsync(process.execPath, [
        'scripts/inspect-extension-log.mjs',
        '--storage-dir',
        join(dir, 'db'),
        '--json'
      ], { cwd: new URL('.', root) }),
      /Completed storage evidence incomplete.*result_count_mismatch/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('inspect:logs reports truncated debug history without rejecting complete exact LevelDB evidence', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hhja-level-truncated-debug-'));
  await writeClassicLevelStorage(join(dir, 'db'), storageFixture({
    droppedEntries: 479
  }));

  try {
    const { stdout } = await execFileAsync(process.execPath, [
      'scripts/inspect-extension-log.mjs',
      '--storage-dir',
      join(dir, 'db'),
      '--json'
    ], { cwd: new URL('.', root) });
    const report = JSON.parse(stdout);
    assert.equal(report.evidence.complete, true);
    assert.equal(report.evidence.debugHistoryTruncated, true);
    assert.equal(report.evidence.droppedDebugEntries, 479);
    assert.deepEqual(report.evidence.warnings, ['debug_history_truncated']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
