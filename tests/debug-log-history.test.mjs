import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = new URL('../', import.meta.url);
const loggerSource = await readFile(new URL('src/agent-log.js', root), 'utf8');

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
  await import(`data:text/javascript;base64,${Buffer.from(loggerSource).toString('base64')}#debug-history-${crypto.randomUUID()}`);
  return globalThis.HHJobAssistantLog;
}

function cleanupLogger() {
  delete globalThis.chrome;
  delete globalThis.HHJobAssistantLog;
}

test('debug history is opt-in, retains N runs, and downloads the selected run', async () => {
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

test('stored and exported debug history anonymizes personal text and secrets', async () => {
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
    assert.equal(report.sourceFile, file);
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
