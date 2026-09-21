import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import vm from 'node:vm';
import { readContentScriptSource } from './helpers/content-script-source.mjs';
import { FakeElement } from './helpers/fake-element.mjs';

const execFileAsync = promisify(execFile);
const root = new URL('../', import.meta.url);

async function readJson(path) {
  return JSON.parse(await readFile(new URL(path, root), 'utf8'));
}

async function startDebugRun(runId = `test-run-${crypto.randomUUID()}`) {
  await globalThis.HHJobAssistantLog.reset('test', 'auto_apply_started', {
    runId,
    mode: 'test'
  });
  return runId;
}

function debugEntries(localData) {
  const runId = localData.agentDebugActiveRunId;
  return runId ? localData[`agentDebugRun:${runId}`]?.entries || [] : [];
}

function resumeCandidateFacts(text, age = 27, source = 'resume-personal-age') {
  let hash = 0x811c9dc5;
  for (const character of String(text || '')) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return {
    age,
    extractedAt: '2026-07-21T00:00:00.000Z',
    source,
    resumeHash: (hash >>> 0).toString(16).padStart(8, '0')
  };
}

test('[BS:COVERS:HHJA-BR-000041] manifest is valid MV3 and exposes popup UI', async () => {
  const manifest = await readJson('manifest.json');
  const packageJson = await readJson('package.json');

  assert.equal(manifest.manifest_version, 3);
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(packageJson.version, manifest.version);
  assert.equal(manifest.background.service_worker, 'src/background.js');
  assert.equal(manifest.background.type, 'module');
  assert.equal(manifest.action.default_popup, 'src/popup.html');
  assert.equal(manifest.commands['start-auto-apply'].suggested_key.mac, 'Alt+Shift+A');
  assert.equal(manifest.options_page, 'src/options.html');
  assert.ok(manifest.permissions.includes('storage'));
  assert.ok(manifest.permissions.includes('unlimitedStorage'));
  assert.ok(manifest.permissions.includes('tabs'));
  assert.ok(manifest.permissions.includes('scripting'));
  assert.ok(manifest.permissions.includes('alarms'));
  assert.ok(!manifest.permissions.includes('windows'));
  assert.ok(manifest.host_permissions.includes('https://hh.ru/*'));
  assert.ok(manifest.host_permissions.includes('https://*.hh.ru/*'));
  assert.ok(manifest.host_permissions.includes('https://api.groq.com/*'));
  assert.ok(manifest.host_permissions.includes('https://token-plan.ap-southeast-1.maas.aliyuncs.com/*'));
  assert.deepEqual(manifest.content_scripts[0].matches, ['https://hh.ru/*', 'https://*.hh.ru/*']);
  assert.deepEqual(manifest.content_scripts[0].js, [
    'src/log-sanitize.js',
    'src/agent-log.js',
    'src/error-text.js',
      'src/action-overlay.js',
      'src/ai-providers.js',
      'src/defaults.js',
      'src/config-readiness.js',
    'src/content-text.js',
    'src/content-dom.js',
    'src/content-hh.js'
  ]);
});

test('extension user-facing text is localized for Russian-speaking users', async () => {
  const files = [
    'manifest.json',
    'src/popup.html',
    'src/options.html',
    'src/popup.js',
    'src/options.js',
    'src/content-text.js',
    'src/content-hh.js',
    'src/background.js'
  ];
  const forbiddenFragments = [
    'Could not establish connection',
    'Receiving end does not exist',
    'Assists with',
    'Start HH auto apply',
    'aria-label="Version"',
    'Extension status',
    'Run status',
    'Apply logs',
    'Chat reports',
    'Agent debug',
    'Groq settings',
    'Save key',
    'Test Groq',
    'Clear',
    'Resume URL',
    'Expected salary',
    'Cover-letter prompt',
    'Daily apply limit',
    'Delay min',
    'Delay max',
    'Process unread chats only',
    'Chat assistant',
    'Chat reply mode',
    'Draft only',
    'Auto-send',
    'Chat limit',
    '>Save<',
    'No chat reports yet.',
    'No agent debug events yet.',
    'Groq key saved.',
    'Groq key cleared.',
    'Testing Groq...',
    'Groq test failed.',
    'Sample length',
    'Login, captcha, or anti-bot page detected',
    'Login or captcha page detected',
    'Login or signup page detected',
    'Cover letter generation failed',
    'Test assistance generation failed',
    'Chat reply generation failed',
    'Skipped because Groq API key is missing',
    'response button was not found',
    'submit button was not found',
    'employer questions were detected',
    'did not finish loading in time',
    'Generated answer'
  ];

  const findings = [];
  for (const file of files) {
    const text = await readFile(new URL(file, root), 'utf8');
    for (const fragment of forbiddenFragments) {
      if (text.includes(fragment)) {
        findings.push(`${file}: ${fragment}`);
      }
    }
  }

  assert.deepEqual(findings, []);
});

test('version guard checks configured repo versions', async () => {
  const { stdout } = await execFileAsync('python3', ['scripts/version_guard.py', '--check'], {
    cwd: new URL('.', root)
  });

  assert.match(stdout, /Version OK: \d+\.\d+\.\d+/);
});

test('version guard bumps json and regex files without stack-specific tooling', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'version-guard-'));
  try {
    await writeFile(
      join(dir, '.version-sync.json'),
      JSON.stringify({
        files: [
          { path: 'manifest.json', type: 'json', key: 'version' },
          { path: 'project.txt', type: 'regex', pattern: 'version=([0-9]+\\.[0-9]+\\.[0-9]+)' }
        ]
      }),
      'utf8'
    );
    await writeFile(join(dir, 'manifest.json'), JSON.stringify({ version: '1.2.3' }), 'utf8');
    await writeFile(join(dir, 'project.txt'), 'name=demo\nversion=1.2.3\n', 'utf8');

    await execFileAsync('python3', [new URL('scripts/version_guard.py', root).pathname, '--bump', 'minor'], {
      cwd: dir
    });

    assert.equal(JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')).version, '1.3.0');
    assert.match(await readFile(join(dir, 'project.txt'), 'utf8'), /version=1\.3\.0/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('javascript files parse', async () => {
  const files = [
    'src/log-sanitize.js',
    'src/agent-log.js',
    'src/content-text.js',
    'src/content-dom.js',
    'src/background.js',
    'src/content-hh.js',
    'src/error-text.js',
    'src/defaults.js',
    'src/options.js',
    'src/popup-view.js',
    'src/popup.js',
    'scripts/inspect-extension-log.mjs',
    'scripts/chromium-extension-smoke.mjs',
    'scripts/chromium-configure-extension.mjs',
    'scripts/chromium-hh-live-smoke.mjs',
    'scripts/chromium-run-action.mjs',
    'scripts/chromium-start-auto-apply.mjs',
    'scripts/sync-hh-auth-to-chromium.mjs',
    'scripts/groq-cover-smoke.mjs',
    'scripts/start-extension-auto-apply.mjs',
    'scripts/reload-extension.mjs',
    'scripts/hh-live-smoke.mjs'
  ];

  for (const file of files) {
    await execFileAsync(process.execPath, ['--check', file], {
      cwd: new URL('.', root)
    });
  }
});

test('extension localizes raw browser and network errors before display', async () => {
  const source = await readFile(new URL('src/error-text.js', root), 'utf8');
  const context = { globalThis: {} };
  context.globalThis = context;
  vm.runInNewContext(source, context);

  const localize = context.HHJA_LOCALIZE_ERROR;
  assert.equal(typeof localize, 'function');
  assert.equal(
    localize('Could not establish connection. Receiving end does not exist.'),
    'Нет связи с вкладкой hh.ru. Обновите страницу и повторите действие.'
  );
  assert.equal(
    localize(new Error('The message port closed before a response was received.')),
    'Связь с вкладкой прервалась. Повторите действие после загрузки страницы.'
  );
  assert.equal(
    localize('TypeError: Failed to fetch'),
    'Не удалось подключиться к сервису. Проверьте интернет и повторите действие.'
  );
});

test('extension defaults are defined once and shared by runtime surfaces', async () => {
  const manifest = await readJson('manifest.json');
  const defaultsSource = await readFile(new URL('src/defaults.js', root), 'utf8');
  const backgroundSource = await readFile(new URL('src/background.js', root), 'utf8');
  const optionsHtml = await readFile(new URL('src/options.html', root), 'utf8');
  const optionsSource = await readFile(new URL('src/options.js', root), 'utf8');
  const contentSource = await readFile(new URL('src/content-hh.js', root), 'utf8');

  assert.match(defaultsSource, /dailyLimit:\s*200/);
  assert.match(defaultsSource, /delayMinMs:\s*4000/);
  assert.match(defaultsSource, /delayMaxMs:\s*8000/);
  assert.match(defaultsSource, /employmentPreference:\s*\[\]/);
  assert.match(defaultsSource, /workFormatPreference:\s*\[\]/);
  assert.match(defaultsSource, /agentDebugLogsEnabled:\s*true/);
  assert.match(defaultsSource, /agentDebugRetentionCount:\s*20/);
  assert.match(defaultsSource, /aiEnabled:\s*true/);
  assert.match(defaultsSource, /fallbackCoverLetterTemplate:\s*'Откликаюсь на вакансию/);
  assert.doesNotMatch(defaultsSource, /experimentalFeaturesEnabled|chatUnreadOnly|chatReplyMode|chatLimit|chatReports/);
  assert.match(defaultsSource, /globalThis\.HHJA_DEFAULTS/);

  assert.match(backgroundSource, /import '\.\/defaults\.js'/);
  assert.match(backgroundSource, /const DEFAULTS = globalThis\.HHJA_DEFAULTS/);
  assert.match(backgroundSource, /GET_AUTOMATION_SETTINGS_AUDIT/);
  assert.match(backgroundSource, /automationSettingsAudit/);
  assert.match(backgroundSource, /expectedSalaryMatchesResume/);
  assert.match(contentSource, /dailyApplicationLedger/);
  assert.match(contentSource, /agentPrivateQuestionAudit/);
  assert.match(contentSource, /GET_AUTOMATION_SETTINGS_AUDIT/);
  assert.match(optionsHtml, /<script src="defaults\.js"><\/script>\s*<script src="options\.js"><\/script>/);
  assert.match(optionsHtml, /<script src="log-sanitize\.js"><\/script>\s*<script src="agent-log\.js"><\/script>/);
  assert.match(optionsHtml, /id="dailyLimit" type="number" min="1" max="200"/);
  assert.match(optionsSource, /const DEFAULTS = globalThis\.HHJA_DEFAULTS/);
  assert.match(optionsSource, /Math\.min\(Number\(fields\.dailyLimit\.value\) \|\| DEFAULTS\.dailyLimit, 200\)/);
  assert.match(contentSource, /const DEFAULTS = globalThis\.HHJA_DEFAULTS/);
  assert.match(contentSource, /Math\.min\(Number\(limitSource\) \|\| 20, 200\)/);

  assert.ok(manifest.content_scripts[0].js.indexOf('src/defaults.js') < manifest.content_scripts[0].js.indexOf('src/content-hh.js'));
  for (const [file, source] of [
    ['src/background.js', backgroundSource],
    ['src/options.js', optionsSource],
    ['src/content-hh.js', contentSource]
  ]) {
    assert.doesNotMatch(source, /dailyLimit:\s*100|delayMinMs:\s*4000|delayMaxMs:\s*8000/, file);
  }
});

test('default prompts remain byte-for-byte versioned', async () => {
  const defaultsSource = await readFile(new URL('src/defaults.js', root), 'utf8');
  const context = { globalThis: {} };
  vm.runInNewContext(defaultsSource, context);
  const hashes = {
    coverPrompt: '6710dd147e8f0d961e8bef10957425bef2467cfac527baa8ee7abce648e830c2',
    employerQuestionPrompt: 'efc193da1a53d1808cf96ac04e4d4ad2b423f4a41b0b898270a6a99e6187939c'
  };
  for (const [key, expectedHash] of Object.entries(hashes)) {
    assert.equal(createHash('sha256').update(context.globalThis.HHJA_DEFAULTS[key]).digest('hex'), expectedHash, key);
  }
});

test('background service worker avoids top-level await', async () => {
  const js = await readFile(new URL('src/background.js', root), 'utf8');

  assert.doesNotMatch(js.trim(), /await\s+ensureDefaults\(\);?$/);
  assert.match(js, /ensureDefaults\(\)\.catch/);
});

test('[BS:COVERS:HHJA-BR-000001] background initializes defaults and registers required listeners', async () => {
  const calls = [];
  const localData = { dailyLimit: 10, delayMinMs: 8000, delayMaxMs: 15000 };

  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) {
          if (Array.isArray(keys)) {
            return Object.fromEntries(keys.map((key) => [key, localData[key]]));
          }
          return {};
        },
        async set(value) {
          Object.assign(localData, value);
          calls.push(['storage.set', Object.keys(value)]);
        }
      }
    },
    runtime: {
      getURL(path) {
        return `chrome-extension://test/${path}`;
      },
      onInstalled: { addListener() { calls.push(['runtime.onInstalled']); } },
      onStartup: { addListener() { calls.push(['runtime.onStartup']); } },
      onMessage: { addListener() { calls.push(['runtime.onMessage']); } }
    },
    commands: {
      onCommand: { addListener() { calls.push(['commands.onCommand']); } }
    },
    tabs: {
      async get() {
        return { status: 'complete' };
      }
    },
    scripting: {}
  };

  await import(`${pathToFileURL(new URL('src/background.js', root).pathname).href}?t=${Date.now()}`);

  assert.equal(localData.groqModel, 'openai/gpt-oss-120b');
  assert.equal(localData.expectedSalary, '');
  assert.equal(localData.resumeUrl, '');
  assert.equal(localData.resumeParsedUrl, '');
  assert.equal(localData.resumeCacheTtlHours, 1);
  assert.equal(localData.aiEnabled, true);
  assert.equal(localData.fallbackCoverLetterTemplate, 'Откликаюсь на вакансию. Подробности опыта указаны в резюме.');
  assert.equal(localData.dailyLimit, 200);
  assert.equal(localData.delayMinMs, 4000);
  assert.equal(localData.delayMaxMs, 8000);
  assert.ok(localData.coverPrompt.length > 220);
  assert.match(localData.coverPrompt, /1-2 простых предложения/);
  assert.match(localData.coverPrompt, /до 220 символов/);
  assert.match(localData.coverPrompt, /без приветствия и обращения/i);
  assert.match(localData.coverPrompt, /без канцелярита/i);
  assert.match(localData.coverPrompt, /markdown/i);
  assert.match(localData.coverPrompt, /пересказа вакансии или пересказа резюме/i);
  assert.match(localData.coverPrompt, /готов обсудить|масштабные проекты|инновации/i);
  assert.equal(localData.aiPromptsVersion, 2);
  assert.match(localData.employerQuestionPrompt, /только явно подтвержденные факты/);
  assert.match(localData.employerQuestionPrompt, /Нельзя придумывать/);
  assert.match(localData.employerQuestionPrompt, /языке вопроса/);
  assert.match(localData.employerQuestionPrompt, /от первого лица/);
  assert.match(localData.employerQuestionPrompt, /точное короткое значение/);
  assert.deepEqual(localData.employmentPreference, []);
  assert.deepEqual(localData.workFormatPreference, []);
  assert.equal(localData.autoApplyStopRequested, false);
  assert.equal(localData.autoApplyStopRequestedAt, '');
  assert.equal(localData.autoApplyStopBeforeSubmit, null);
  assert.ok(calls.some(([name]) => name === 'runtime.onMessage'));
  assert.ok(calls.some(([name]) => name === 'commands.onCommand'));
});

test('background safe status snapshot is read-only, rejects out-of-range timestamps, and excludes private automation data', async () => {
  let listener = null;
  let storageSetCalls = 0;
  const moscowDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
  const localData = {
    dailyApplicationLedger: {
      date: moscowDate,
      legacySubmitted: 2,
      submittedVacancyIds: ['vacancy-secret-101', 'vacancy-secret-102'],
      alreadyAppliedVacancyIds: ['vacancy-secret-103'],
      hhDailyLimitReached: true,
      updatedAt: '2026-08-07T10:00:00.000Z'
    },
    automationSettingsAudit: {
      ready: false,
      checkedAt: '2026-08-07T10:01:00.000Z',
      issues: ['resumeProfileFresh', 'raw-api-key=do-not-show']
    },
    autoApplyStopBeforeSubmit: {
      armed: true,
      runId: 'private-run-id',
      expiresAt: '2099-01-01T00:00:00.000Z'
    },
    runState: {
      state: 'applying',
      found: 12,
      processed: 7,
      applied: 4,
      alreadyApplied: 3,
      skipped: 2,
      errors: 1,
      currentAction: 'https://hh.ru/vacancy/private',
      lastError: 'private raw error text',
      updatedAt: '2026-08-07T10:02:00.000Z'
    },
    automationStartDigest: {
      starts: 1,
      continues: 0,
      shortcutStarts: 1,
      shortcutContinues: 0,
      duplicates: 1,
      conflicts: 0,
      lastEvent: 'duplicate_start',
      updatedAt: Number.MAX_VALUE,
      runId: 'must-not-leak'
    },
    scheduledAutoApplySession: {
      sessionId: 'scheduled:2026-08-07:date-mismatch',
      dateMsk: moscowDate,
      state: 'blocked',
      extensionVersion: '9.8.7',
      startedAt: '2026-08-07T09:00:00.000Z',
      updatedAt: '2026-08-07T10:04:00.000Z',
      finishedAt: '2026-08-07T10:04:00.000Z',
      repairAttempts: 1,
      stopReason: 'date_mismatch',
      reviewRequired: false,
      reviewIssues: []
    },
    agentPrivateQuestionAudit: {
      entries: [{ vacancyId: 'private-question-vacancy', answer: 'private answer' }]
    }
  };

  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) {
          if (Array.isArray(keys)) {
            return Object.fromEntries(keys.map((key) => [key, localData[key]]));
          }
          return { ...localData };
        },
        async set(value) {
          storageSetCalls += 1;
          Object.assign(localData, value);
        }
      }
    },
    runtime: {
      getURL(path) { return `chrome-extension://test/${path}`; },
      getManifest() { return { version: '9.8.7' }; },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: {
        addListener(fn) {
          listener = fn;
        }
      }
    },
    commands: { onCommand: { addListener() {} } },
    tabs: { async get() { return { status: 'complete' }; } },
    scripting: {}
  };

  await import(`${pathToFileURL(new URL('src/background.js', root).pathname).href}?t=${Date.now()}-${crypto.randomUUID()}`);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const writesBeforeSnapshot = storageSetCalls;
  const runStateBeforeSnapshot = structuredClone(localData.runState);
  const response = await new Promise((resolve) => {
    assert.equal(listener({ type: 'GET_SAFE_STATUS_SNAPSHOT' }, {}, resolve), true);
  });

  assert.equal(storageSetCalls, writesBeforeSnapshot);
  assert.deepEqual(localData.runState, runStateBeforeSnapshot);
  assert.deepEqual(response, {
    ok: true,
    snapshot: {
      manifestVersion: '9.8.7',
      dailyLedger: {
        date: moscowDate,
        newSubmitted: 4,
        alreadyApplied: 1,
        hhDailyLimitReached: true,
        updatedAt: '2026-08-07T10:00:00.000Z'
      },
      automationAudit: {
        ready: false,
        checkedAt: '2026-08-07T10:01:00.000Z',
        issues: ['resumeProfileFresh', 'audit_invalid']
      },
      stopBeforeSubmit: { state: 'current' },
      runState: {
        state: 'applying',
        found: 12,
        processed: 7,
        applied: 4,
        alreadyApplied: 3,
        skipped: 2,
        errors: 1,
        updatedAt: '2026-08-07T10:02:00.000Z'
      },
      startDigest: {
        starts: 1,
        continues: 0,
        shortcutStarts: 1,
        shortcutContinues: 0,
        duplicates: 1,
        conflicts: 0,
        lastEvent: 'duplicate_start',
        updatedAt: ''
      },
      schedule: {
        enabled: false,
        timeMsk: '10:40',
        lateWindowMinutes: 120,
        maxRepairAttempts: 3,
        repairCutoffMsk: '18:00',
        filterConfigured: false,
        nextAlarmAt: '',
        reviewGateBlocked: false
      },
      scheduledSession: {
        present: true,
        sessionId: 'scheduled:2026-08-07:date-mismatch',
        dateMsk: moscowDate,
        state: 'blocked',
        extensionVersion: '9.8.7',
        startedAt: '2026-08-07T09:00:00.000Z',
        updatedAt: '2026-08-07T10:04:00.000Z',
        finishedAt: '2026-08-07T10:04:00.000Z',
        repairAttempts: 1,
        stopReason: 'date_mismatch',
        reviewRequired: false,
        reviewPending: false,
        reviewOutcome: '',
        reviewIssueCount: 0,
        reviewedAt: ''
      }
    }
  });
  const serialized = JSON.stringify(response);
  assert.doesNotMatch(serialized, /vacancy-secret|private-run-id|private raw error|private answer|raw-api-key|must-not-leak/);
});

test('safe status preflight refreshes audit without running automation or changing its guard', async () => {
  let listener = null;
  const storagePatches = [];
  let createdTabs = 0;
  let updatedTabs = 0;
  let executedScripts = 0;
  const freshTimestamp = new Date().toISOString();
  const guard = {
    armed: true,
    runId: 'private-guard-run',
    armedAt: '2026-08-07T09:00:00.000Z',
    expiresAt: '2099-01-01T00:00:00.000Z',
    source: 'url_param'
  };
  const runState = {
    state: 'dry_run_complete',
    found: 8,
    processed: 8,
    applied: 0,
    alreadyApplied: 2,
    skipped: 8,
    errors: 0,
    currentAction: '',
    lastError: '',
    updatedAt: '2026-08-07T10:00:00.000Z'
  };
  const localData = {
    aiEnabled: true,
    aiProvider: 'qwen',
    aiProviderCredentials: { qwen: { apiKey: 'status-preflight-key' } },
    aiFallbackProvider: '',
    aiFallbackEnabled: false,
    aiFallbackToGroq: false,
    aiProviderCooldowns: {},
    groqApiKey: '',
    groqCooldownUntil: '',
    dailyLimit: 200,
    agentDebugLogsEnabled: true,
    agentDebugRetentionCount: 20,
    resumeUrl: 'https://hh.ru/resume/test-resume',
    resumeParsedUrl: 'https://hh.ru/resume/test-resume',
    resumeParsedText: 'Backend engineer',
    resumeParsedAt: freshTimestamp,
    resumeProfileText: 'Safe cached profile',
    resumeProfileSourceHash: 'profile-source-hash',
    resumeProfileCheckedAt: freshTimestamp,
    resumeProfileAutoRefreshEnabled: true,
    resumeCacheTtlHours: 1,
    resumeCandidateFacts: {
      age: 27,
      extractedAt: freshTimestamp,
      source: 'resume-personal-age',
      resumeHash: 'profile-source-hash'
    },
    expectedSalary: '200000',
    telegramUsername: 'safe-status-user',
    employmentPreference: ['labor_contract'],
    workFormatPreference: [],
    autoApplyStopRequested: false,
    autoApplyStopRequestedAt: '',
    autoApplyStopBeforeSubmit: structuredClone(guard),
    runState: structuredClone(runState),
    runResults: [],
    automationSettingsAudit: {
      ready: false,
      checkedAt: '2020-01-01T00:00:00.000Z',
      issues: ['audit_not_ready']
    }
  };

  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) {
          if (Array.isArray(keys)) {
            return Object.fromEntries(keys.map((key) => [key, localData[key]]));
          }
          return { ...localData };
        },
        async set(value) {
          storagePatches.push(structuredClone(value));
          Object.assign(localData, value);
        }
      }
    },
    runtime: {
      getURL(path) { return `chrome-extension://test/${path}`; },
      getManifest() { return { version: '9.8.7' }; },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: { addListener(fn) { listener = fn; } }
    },
    commands: { onCommand: { addListener() {} } },
    tabs: {
      async get() { return { status: 'complete' }; },
      async create() { createdTabs += 1; return { id: 1 }; },
      async update() { updatedTabs += 1; }
    },
    scripting: {
      async executeScript() { executedScripts += 1; return []; }
    }
  };

  await import(`${pathToFileURL(new URL('src/background.js', root).pathname).href}?t=${Date.now()}-${crypto.randomUUID()}`);
  await new Promise((resolve) => setTimeout(resolve, 0));
  storagePatches.length = 0;
  const response = await new Promise((resolve) => {
    assert.equal(listener(
      { type: 'RUN_SAFE_STATUS_PREFLIGHT' },
      { tab: { url: 'https://hh.ru/search/vacancy?text=java' } },
      resolve
    ), true);
  });

  assert.equal(response.ok, true);
  assert.deepEqual(response.preflight, { profileRefreshAttempted: true, auditRefreshed: true });
  assert.equal(response.snapshot.automationAudit.checkedAt, localData.automationSettingsAudit.checkedAt);
  assert.notEqual(response.snapshot.automationAudit.checkedAt, '2020-01-01T00:00:00.000Z');
  assert.deepEqual(localData.autoApplyStopBeforeSubmit, guard);
  assert.deepEqual(localData.runState, runState);
  assert.equal(createdTabs, 0);
  assert.equal(updatedTabs, 0);
  assert.equal(executedScripts, 0);
  assert.equal(storagePatches.some((patch) => (
    Object.hasOwn(patch, 'autoApplyStopBeforeSubmit') ||
    Object.hasOwn(patch, 'autoApplyStopRequested') ||
    Object.hasOwn(patch, 'autoApplyStopRequestedAt') ||
    Object.hasOwn(patch, 'runState') ||
    Object.hasOwn(patch, 'runResults')
  )), false);
  assert.doesNotMatch(JSON.stringify(response), /status-preflight-key|private-guard-run|test-resume|Safe cached profile/);

  const patchesBeforeRejectedSender = storagePatches.length;
  const rejectedSender = await new Promise((resolve) => {
    assert.equal(listener(
      { type: 'RUN_SAFE_STATUS_PREFLIGHT' },
      { tab: { url: 'chrome-extension://test/src/popup.html' } },
      resolve
    ), true);
  });
  assert.deepEqual(rejectedSender, { ok: false });
  assert.equal(storagePatches.length, patchesBeforeRejectedSender);
});

test('background migrates old default employer question prompt', async () => {
  const oldEmployerQuestionPrompt = 'Отвечай на вопросы работодателя на русском так, чтобы повысить шанс получить приглашение на собеседование. Если в резюме нет прямого опыта по вопросу, не пиши, что опыта нет; придумай уверенный релевантный кейс из близкого опыта, инструментов кандидата, вакансии и домена. Отвечай кратко, естественно, уверенно, без списков и без местоимений первого лица.';
  const oldCoverPrompt = 'Напиши одну живую строку для отклика hh.ru: 70-160 символов, по-русски, без приветствия. Используй конкретное пересечение резюме и вакансии. Без канцелярита, HR-клише, markdown, списков и фраз "готов обсудить", "релевантный опыт". Только текст.';
  const localData = {
    dailyLimit: 100,
    delayMinMs: 4000,
    delayMaxMs: 8000,
    scheduledAutoApplyEnabled: false,
    scheduledAutoApplyTimeMsk: '10:40',
    scheduledAutoApplyLateWindowMinutes: 120,
    scheduledAutoApplyFilterUrl: '',
    scheduledAutoApplyMaxRepairAttempts: 3,
    scheduledAutoApplyRepairCutoffMsk: '18:00',
    coverPrompt: oldCoverPrompt,
    employerQuestionPrompt: oldEmployerQuestionPrompt,
    agentDebugLogsEnabled: true
  };

  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) {
          if (Array.isArray(keys)) {
            return Object.fromEntries(keys.map((key) => [key, localData[key]]));
          }
          return {};
        },
        async set(value) {
          Object.assign(localData, value);
        }
      }
    },
    runtime: {
      getURL(path) {
        return `chrome-extension://test/${path}`;
      },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: { addListener() {} }
    },
    commands: {
      onCommand: { addListener() {} }
    },
    tabs: {
      async get() {
        return { status: 'complete' };
      }
    },
    scripting: {}
  };

  await import(`${pathToFileURL(new URL('src/background.js', root).pathname).href}?t=${Date.now()}-${crypto.randomUUID()}`);

  assert.notEqual(localData.employerQuestionPrompt, oldEmployerQuestionPrompt);
  assert.match(localData.employerQuestionPrompt, /языке вопроса/);
  assert.match(localData.employerQuestionPrompt, /от первого лица/);
  assert.match(localData.employerQuestionPrompt, /точное короткое значение/);
  assert.match(localData.employerQuestionPrompt, /Нельзя придумывать/);
  assert.notEqual(localData.coverPrompt, oldCoverPrompt);
  assert.ok(localData.coverPrompt.length > 220);
  assert.match(localData.coverPrompt, /1-2 простых предложения/);
  assert.match(localData.coverPrompt, /до 220 символов/);
  assert.match(localData.coverPrompt, /markdown/i);
  assert.match(localData.coverPrompt, /пересказа вакансии или пересказа резюме/i);
  assert.match(localData.coverPrompt, /готов обсудить|масштабные проекты|инновации/i);
});

test('[BS:COVERS:HHJA-BR-000001] background repairs blank prompts and preserves non-empty custom prompts during migration', async () => {
  const localData = {
    aiPromptsVersion: 0,
    coverPrompt: '  ',
    employerQuestionPrompt: 'Custom employer instructions',
    choiceRetryPrompt: 'Custom exact-choice instructions',
    agentDebugLogsEnabled: true
  };

  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) {
          return Object.fromEntries(keys.map((key) => [key, localData[key]]));
        },
        async set(value) {
          Object.assign(localData, value);
        }
      }
    },
    runtime: {
      getURL(path) { return `chrome-extension://test/${path}`; },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: { addListener() {} }
    },
    commands: { onCommand: { addListener() {} } },
    tabs: { async get() { return { status: 'complete' }; } },
    scripting: {}
  };

  await import(`${pathToFileURL(new URL('src/background.js', root).pathname).href}?t=${Date.now()}-${crypto.randomUUID()}`);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.match(localData.coverPrompt, /1-2 простых предложения/);
  assert.equal(localData.employerQuestionPrompt, 'Custom employer instructions');
  assert.equal(localData.choiceRetryPrompt, 'Custom exact-choice instructions');
  assert.equal(localData.aiPromptsVersion, 2);

  localData.coverPrompt = null;
  localData.employerQuestionPrompt = '\n\t';
  localData.choiceRetryPrompt = '';
  const installedListenerChrome = globalThis.chrome;
  let onInstalled;
  installedListenerChrome.runtime.onInstalled.addListener = (listener) => { onInstalled = listener; };
  await import(`${pathToFileURL(new URL('src/background.js', root).pathname).href}?t=${Date.now()}-${crypto.randomUUID()}`);
  await onInstalled();

  assert.match(localData.coverPrompt, /1-2 простых предложения/);
  assert.match(localData.employerQuestionPrompt, /вопросы работодателя/);

  const unsafeStoredPrompt = 'Не пиши, что опыта нет: сочини релевантный опыт и выдумай кейс под вакансию.';
  localData.employerQuestionPrompt = unsafeStoredPrompt;
  localData.aiPromptsVersion = 2;
  await onInstalled();

  assert.notEqual(localData.employerQuestionPrompt, unsafeStoredPrompt);
  assert.doesNotMatch(localData.employerQuestionPrompt, /сочини|выдумай|придумай/i);
  assert.match(localData.employerQuestionPrompt, /только.*факт/i);
});

test('background clears stale current action when a run completes', async () => {
  let listener = null;
  const localData = {
    runState: {
      state: 'filling_cover_letter',
      found: 1,
      processed: 1,
      applied: 0,
      skipped: 0,
      errors: 0,
      currentAction: 'Filling HH employer question fields',
      lastError: 'old warning'
    }
  };

  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) {
          if (Array.isArray(keys)) {
            return Object.fromEntries(keys.map((key) => [key, localData[key]]));
          }
          return {};
        },
        async set(value) {
          Object.assign(localData, value);
        }
      }
    },
    runtime: {
      getURL(path) {
        return `chrome-extension://test/${path}`;
      },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: {
        addListener(fn) {
          listener = fn;
        }
      }
    },
    tabs: {
      async get() {
        return { status: 'complete' };
      }
    },
    scripting: {}
  };

  await import(`${pathToFileURL(new URL('src/background.js', root).pathname).href}?t=${Date.now()}-${crypto.randomUUID()}`);

  const response = await new Promise((resolve) => {
    const stayedAsync = listener({ type: 'SET_RUN_STATE', patch: { state: 'complete', applied: 1 } }, {}, resolve);
    assert.equal(stayedAsync, true);
  });

  assert.equal(response.ok, true);
  assert.equal(localData.runState.state, 'complete');
  assert.equal(localData.runState.currentAction, '');
  assert.equal(localData.runState.lastError, '');
});

test('background owns one auto-apply run and keeps direct-navigation provenance across queue replacement', async () => {
  let listener = null;
  let removedListener = null;
  const localData = { agentDebugLogsEnabled: false };
  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) {
          if (keys == null) return { ...localData };
          return Object.fromEntries(keys.map((key) => [key, localData[key]]));
        },
        async set(value) {
          Object.assign(localData, value);
        },
        async remove(keys) {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete localData[key];
        }
      }
    },
    runtime: {
      getURL(path) { return `chrome-extension://test/${path}`; },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: { addListener(fn) { listener = fn; } }
    },
    commands: { onCommand: { addListener() {} } },
    tabs: {
      async get(tabId) { return { id: tabId, url: 'https://hh.ru/search/vacancy?text=java' }; },
      onUpdated: { addListener() {} },
      onRemoved: { addListener(fn) { removedListener = fn; } }
    },
    scripting: {}
  };

  await import(`${pathToFileURL(new URL('src/background.js', root).pathname).href}?t=${Date.now()}-${crypto.randomUUID()}`);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const send = (message, tabId, url = 'https://hh.ru/search/vacancy?text=java') => new Promise((resolve) => {
    const stayedAsync = listener(message, { tab: { id: tabId, url } }, resolve);
    assert.equal(stayedAsync, true);
  });

  const claimA = await send({ type: 'CLAIM_AUTO_APPLY_RUN', runId: 'run-a' }, 11);
  assert.equal(claimA.claimed, true);
  assert.equal(claimA.ownerId, 11);
  const racingClaimB = await send({ type: 'CLAIM_AUTO_APPLY_RUN', runId: 'run-b-race' }, 22);
  assert.equal(racingClaimB.claimed, false);
  assert.equal(racingClaimB.runId, 'run-a');
  assert.equal(localData.runState.runId, 'run-a');
  assert.equal(localData.runState.ownerId, 11);
  const beforeReadOnlyCheck = structuredClone(localData);
  const readOnlyCheck = await send({ type: 'CHECK_AUTO_APPLY_RUN_OWNERSHIP', runId: 'run-a', ownerId: 11 }, 11);
  assert.equal(readOnlyCheck.owned, true);
  assert.deepEqual(localData, beforeReadOnlyCheck);
  const stateBeforeLegacyWrite = structuredClone(localData.runState);
  const deniedLegacyState = await send({ type: 'SET_RUN_STATE', patch: { state: 'error', processed: 999 } }, 22);
  assert.equal(deniedLegacyState.ignored, true);
  assert.deepEqual(localData.runState, stateBeforeLegacyWrite);
  const deniedLegacyResult = await send({
    type: 'APPEND_RUN_RESULT',
    item: { vacancyId: 'legacy-bypass', status: 'applied' }
  }, 22);
  assert.equal(deniedLegacyResult.ignored, true);
  assert.equal((localData.runResults || []).some((item) => item.vacancyId === 'legacy-bypass'), false);

  const attempt = {
    kind: 'direct_response_navigation',
    runId: 'run-a',
    vacancyId: '123',
    sourceUrl: 'https://hh.ru/search/vacancy?text=java',
    responseUrl: 'https://hh.ru/applicant/vacancy_response?vacancyId=123',
    startedAt: new Date().toISOString(),
    targetResponseControlEnabledBefore: true,
    alreadyAppliedBefore: false
  };
  const invalidRegistration = await send({
    type: 'REGISTER_AUTO_APPLY_RESPONSE_ATTEMPT',
    runId: 'run-a',
    attempt,
    item: { vacancyId: 'wrong-vacancy' },
    queue: {
      active: true,
      runId: 'run-a',
      ownerId: 11,
      sourceUrl: attempt.sourceUrl,
      index: 0,
      items: [{ vacancyId: 'wrong-vacancy' }]
    }
  }, 11);
  assert.deepEqual(invalidRegistration, {
    ok: true,
    registered: false,
    stage: 'attempt_validation',
    reason: 'invalid_attempt_provenance'
  });
  const registered = await send({
    type: 'REGISTER_AUTO_APPLY_RESPONSE_ATTEMPT',
    runId: 'run-a',
    attempt,
    item: { vacancyId: '123' },
    queue: {
      active: true,
      runId: 'run-a',
      ownerId: 11,
      sourceUrl: 'https://hh.ru/search/vacancy?text=java',
      index: 0,
      items: [{ vacancyId: '123' }]
    }
  }, 11);
  assert.equal(registered.registered, true);

  const claimB = await send({ type: 'CLAIM_AUTO_APPLY_RUN', runId: 'run-b' }, 22);
  assert.equal(claimB.claimed, false);
  assert.equal(claimB.runId, 'run-a');
  const deniedMutation = await send({
    type: 'SET_RUN_STATE',
    runId: 'run-b',
    ownerId: 22,
    patch: { state: 'scanning', processed: 99 }
  }, 22);
  assert.equal(deniedMutation.ignored, true);
  assert.notEqual(localData.runState?.processed, 99);
  localData.runResults = [{ vacancyId: 'existing', status: 'applied' }];
  const deniedResult = await send({
    type: 'APPEND_RUN_RESULT',
    runId: 'run-b',
    ownerId: 22,
    item: { vacancyId: 'evil', status: 'applied' }
  }, 22);
  assert.equal(deniedResult.ignored, true);
  assert.deepEqual(localData.runResults.map((item) => item.vacancyId), ['existing']);
  const deniedStateWrite = await send({
    type: 'WRITE_AUTO_APPLY_STATE',
    runId: 'run-b',
    ownerId: 22,
    patch: {
      autoApplyQueue: { active: true, runId: 'run-b' },
      autoApplySearchQueue: { active: true, runId: 'run-b' },
      autoApplyPendingSubmit: { runId: 'run-b' },
      runResults: [{ vacancyId: 'evil-state-write' }]
    }
  }, 22);
  assert.equal(deniedStateWrite.ignored, true);
  assert.notEqual(localData.autoApplySearchQueue?.runId, 'run-b');
  assert.notEqual(localData.autoApplyPendingSubmit?.runId, 'run-b');
  assert.deepEqual(localData.runResults.map((item) => item.vacancyId), ['existing']);

  localData.autoApplyQueue = { active: false, runId: 'run-b' };
  const recovered = await send({
    type: 'GET_AUTO_APPLY_RESPONSE_ATTEMPT',
    runId: 'run-a',
    vacancyId: '123'
  }, 11);
  assert.equal(recovered.status, 'ready');
  assert.equal(recovered.attempt.ownerId, 11);
  const deniedRead = await send({
    type: 'GET_AUTO_APPLY_RESPONSE_ATTEMPT',
    runId: 'run-a',
    vacancyId: '123'
  }, 22);
  assert.equal(deniedRead.status, 'run_not_owned');

  const finalResult = {
    index: 1,
    vacancyId: '123',
    title: 'Java Developer',
    url: 'https://hh.ru/vacancy/123',
    status: 'applied_direct_navigation',
    coverLetterUsed: false,
    testDetected: false,
    error: ''
  };
  localData.agentDebugLogsEnabled = true;
  await startDebugRun('direct-finalize-debug');
  const firstFinalize = await send({
    type: 'FINALIZE_AUTO_APPLY_RESPONSE_ATTEMPT',
    runId: 'run-a',
    vacancyId: '123',
    counters: { found: 1, processed: 1, applied: 0, alreadyApplied: 0, skipped: 0, errors: 0 },
    result: finalResult
  }, 11, 'https://hh.ru/vacancy/123');
  const secondFinalize = await send({
    type: 'FINALIZE_AUTO_APPLY_RESPONSE_ATTEMPT',
    runId: 'run-a',
    vacancyId: '123',
    counters: { found: 1, processed: 1, applied: 0, alreadyApplied: 0, skipped: 0, errors: 0 },
    result: finalResult
  }, 11, 'https://hh.ru/vacancy/123');
  assert.equal(firstFinalize.finalized, true);
  assert.equal(secondFinalize.alreadyFinalized, true);
  assert.equal(localData.runResults.filter((item) => item.vacancyId === '123').length, 1);
  assert.deepEqual(localData.dailyApplicationLedger.submittedVacancyIds, ['123']);
  const directFinalizeResultLogs = debugEntries(localData).filter((entry) => (
    entry.event === 'run_result' && entry.details?.vacancyId === '123'
  ));
  assert.equal(directFinalizeResultLogs.length, 1);
  assert.equal(directFinalizeResultLogs[0].details.status, 'applied_direct_navigation');

  localData.autoApplyPendingSubmit = {
    runId: 'run-a',
    ownerId: 11,
    item: { index: 2, vacancyId: '456', title: 'Pending Java', url: 'https://hh.ru/vacancy/456' },
    counters: { found: 2, processed: 2, applied: 1, alreadyApplied: 0, skipped: 0, errors: 0 },
    status: 'applied',
    coverLetterUsed: false,
    testDetected: false
  };
  const pendingFinalizeMessage = {
    type: 'FINALIZE_AUTO_APPLY_PENDING_SUBMIT',
    runId: 'run-a',
    ownerId: 11,
    vacancyId: '456',
    counters: localData.autoApplyPendingSubmit.counters,
    result: { ...localData.autoApplyPendingSubmit.item, status: 'applied', error: '' }
  };
  const firstPendingFinalize = await send(pendingFinalizeMessage, 11, 'https://hh.ru/vacancy/456');
  const committedPendingSnapshot = {
    ledger: structuredClone(localData.dailyApplicationLedger),
    results: structuredClone(localData.runResults),
    pending: localData.autoApplyPendingSubmit
  };
  // Retry as if the content script crashed or lost the first successful response.
  const secondPendingFinalize = await send(pendingFinalizeMessage, 11, 'https://hh.ru/vacancy/456');
  assert.equal(firstPendingFinalize.finalized, true);
  assert.equal(secondPendingFinalize.alreadyFinalized, true);
  assert.equal(localData.autoApplyPendingSubmit, null);
  assert.equal(localData.runResults.filter((item) => item.vacancyId === '456').length, 1);
  assert.deepEqual(localData.dailyApplicationLedger.submittedVacancyIds, ['123', '456']);
  assert.deepEqual(localData.dailyApplicationLedger, committedPendingSnapshot.ledger);
  assert.deepEqual(localData.runResults, committedPendingSnapshot.results);
  assert.equal(committedPendingSnapshot.pending, null);

  await send({ type: 'SET_RUN_STATE', runId: 'run-a', ownerId: 11, patch: { state: 'complete' } }, 11);
  const lateCheck = await send({ type: 'CHECK_AUTO_APPLY_RUN_OWNERSHIP', runId: 'run-a', ownerId: 11 }, 11);
  assert.equal(lateCheck.owned, false);

  const claimPendingStop = await send({ type: 'CLAIM_AUTO_APPLY_RUN', runId: 'run-pending-stop' }, 11);
  assert.equal(claimPendingStop.claimed, true);
  localData.autoApplyPendingSubmit = {
    runId: 'run-pending-stop',
    ownerId: 11,
    item: { index: 1, vacancyId: 'pending-stop', title: 'Pending stop', url: 'https://hh.ru/vacancy/pending-stop' },
    counters: { found: 1, processed: 1, applied: 0, alreadyApplied: 0, skipped: 0, errors: 0 },
    status: 'applied',
    coverLetterUsed: false,
    testDetected: false
  };
  await send({
    type: 'SET_RUN_STATE',
    runId: 'run-pending-stop',
    ownerId: 11,
    patch: { state: 'stopped' }
  }, 11);
  assert.equal(localData.autoApplyRunLease.active, true);
  const pendingAfterStop = await send({
    type: 'FINALIZE_AUTO_APPLY_PENDING_SUBMIT',
    runId: 'run-pending-stop',
    ownerId: 11,
    vacancyId: 'pending-stop',
    counters: localData.autoApplyPendingSubmit.counters,
    result: { ...localData.autoApplyPendingSubmit.item, status: 'applied', error: '' }
  }, 11, 'https://hh.ru/vacancy/pending-stop');
  assert.equal(pendingAfterStop.finalized, true);
  assert.equal(localData.autoApplyPendingSubmit, null);
  assert.equal(localData.runResults.filter((item) => item.vacancyId === 'pending-stop').length, 1);
  await send({
    type: 'SET_RUN_STATE',
    runId: 'run-pending-stop',
    ownerId: 11,
    patch: { state: 'stopped' }
  }, 11);
  assert.equal(localData.autoApplyRunLease.active, false);

  const beforeTerminalRecoveryCases = structuredClone(localData);
  const staleTerminalSnapshot = {
    ...beforeTerminalRecoveryCases,
    autoApplyRunLease: { active: true, runId: 'stale-terminal', ownerId: 11, claimedAt: new Date().toISOString() },
    runState: { state: 'stopped', runId: 'stale-terminal', ownerId: 11, processed: 2, applied: 1 },
    runResults: [{ vacancyId: 'previous-result', status: 'applied' }],
    autoApplyQueue: { active: false },
    autoApplySearchQueue: { active: false },
    autoApplyPendingSubmit: null,
    autoApplyResponseAttempts: {}
  };
  const restoreLocalData = (snapshot) => {
    for (const key of Object.keys(localData)) delete localData[key];
    Object.assign(localData, structuredClone(snapshot));
  };
  for (const state of ['stopped', 'error', 'complete', 'dry_run_complete']) {
    restoreLocalData(staleTerminalSnapshot);
    localData.runState.state = state;
    const recovery = await send({ type: 'CLAIM_AUTO_APPLY_RUN', runId: `recovered-${state}` }, 11);
    assert.equal(recovery.claimed, true, `${state}: terminal stale lease must permit restart`);
    assert.equal(recovery.recoveredTerminalLease, true, state);
    assert.equal(localData.autoApplyRunLease.runId, `recovered-${state}`, state);
    assert.equal(localData.runState.state, 'scanning', state);
    assert.deepEqual(localData.dailyApplicationLedger, staleTerminalSnapshot.dailyApplicationLedger, `${state}: preserve daily totals`);
  }
  const recoveryBlocks = [
    ['active run', { runState: { ...staleTerminalSnapshot.runState, state: 'scanning' } }],
    ['paused run', { runState: { ...staleTerminalSnapshot.runState, state: 'paused' } }],
    ['idle run', { runState: { ...staleTerminalSnapshot.runState, state: 'idle' } }],
    ['different run', { runState: { ...staleTerminalSnapshot.runState, runId: 'newer-run' } }],
    ['different state owner', { runState: { ...staleTerminalSnapshot.runState, ownerId: 22 } }],
    ['active response queue', { autoApplyQueue: { active: true, runId: 'stale-terminal', ownerId: 11 } }],
    ['active foreign search queue', { autoApplySearchQueue: { active: true, runId: 'foreign', ownerId: 22 } }],
    ['pending submit', { autoApplyPendingSubmit: { runId: 'stale-terminal', ownerId: 11, item: { vacancyId: 'pending' } } }],
    ['foreign pending submit', { autoApplyPendingSubmit: { runId: 'foreign', ownerId: 22, item: { vacancyId: 'pending' } } }],
    ['fresh response attempt', { autoApplyResponseAttempts: { attempt: { runId: 'stale-terminal', ownerId: 11, startedAt: new Date().toISOString() } } }],
    ['foreign response attempt', { autoApplyResponseAttempts: { attempt: { runId: 'foreign', ownerId: 22, startedAt: new Date().toISOString() } } }],
    ...['starting', 'running', 'repair_pending'].map((state) => [
      `scheduled ${state}`,
      { scheduledAutoApplySession: { state, runId: 'stale-terminal', ownerId: 11, sessionId: 'scheduled-checkpoint' } }
    ]),
    ['different sender', {}, 22],
    ['response page', {}, 11, 'https://hh.ru/applicant/vacancy_response?vacancyId=123']
  ];
  for (const [label, patch, senderId = 11, url] of recoveryBlocks) {
    restoreLocalData({ ...staleTerminalSnapshot, ...patch });
    const beforeRejectedRecovery = structuredClone(localData);
    const recovery = await send({ type: 'CLAIM_AUTO_APPLY_RUN', runId: 'must-not-recover' }, senderId, url);
    assert.equal(recovery.claimed, false, label);
    assert.deepEqual(localData, beforeRejectedRecovery, `${label}: preserve all stored provenance`);
  }
  restoreLocalData(beforeTerminalRecoveryCases);

  const claimOrphan = await send({ type: 'CLAIM_AUTO_APPLY_RUN', runId: 'run-orphan' }, 11);
  assert.equal(claimOrphan.claimed, true);
  const freshSameTabClaim = await send({ type: 'CLAIM_AUTO_APPLY_RUN', runId: 'run-too-soon' }, 11);
  assert.equal(freshSameTabClaim.claimed, false);
  const orphanedAt = new Date(Date.now() - 60_000).toISOString();
  localData.autoApplyRunLease.claimedAt = orphanedAt;
  localData.autoApplyRunLease.updatedAt = orphanedAt;
  localData.runState.updatedAt = orphanedAt;
  localData.runState.currentAction = 'Проверяю страницу HH';
  const recoveredOrphan = await send({ type: 'CLAIM_AUTO_APPLY_RUN', runId: 'run-recovered' }, 11);
  assert.equal(recoveredOrphan.claimed, true);
  assert.equal(recoveredOrphan.recoveredOrphan, true);
  assert.equal(localData.autoApplyRunLease.runId, 'run-recovered');
  assert.equal(localData.runState.runId, 'run-recovered');
  assert.equal(localData.runState.processed, 0);
  await send({ type: 'SET_RUN_STATE', runId: 'run-recovered', ownerId: 11, patch: { state: 'complete' } }, 11);

  const claimProtectedOrphan = await send({ type: 'CLAIM_AUTO_APPLY_RUN', runId: 'run-protected-orphan' }, 11);
  assert.equal(claimProtectedOrphan.claimed, true);
  localData.autoApplyRunLease.claimedAt = orphanedAt;
  localData.autoApplyRunLease.updatedAt = orphanedAt;
  localData.runState.updatedAt = orphanedAt;
  localData.autoApplyPendingSubmit = {
    runId: 'run-protected-orphan',
    ownerId: 11,
    item: { vacancyId: 'protected-side-effect' },
    counters: { found: 1, processed: 1, applied: 0, alreadyApplied: 0, skipped: 0, errors: 0 }
  };
  const deniedProtectedRecovery = await send({ type: 'CLAIM_AUTO_APPLY_RUN', runId: 'run-must-not-replace' }, 11);
  assert.equal(deniedProtectedRecovery.claimed, false);
  assert.equal(deniedProtectedRecovery.reason, 'active_run_has_side_effect_provenance');
  assert.equal(localData.autoApplyRunLease.runId, 'run-protected-orphan');
  localData.autoApplyPendingSubmit = null;
  await send({ type: 'SET_RUN_STATE', runId: 'run-protected-orphan', ownerId: 11, patch: { state: 'complete' } }, 11);

  const claimStaleDestination = await send({ type: 'CLAIM_AUTO_APPLY_RUN', runId: 'run-stale-destination' }, 11);
  assert.equal(claimStaleDestination.claimed, true);
  const staleAttemptKey = 'run-stale-destination:777:11';
  localData.autoApplyResponseAttempts = {
    ...(localData.autoApplyResponseAttempts || {}),
    [staleAttemptKey]: {
      key: staleAttemptKey,
      kind: 'direct_response_navigation',
      runId: 'run-stale-destination',
      ownerId: 11,
      vacancyId: '777',
      sourceUrl: 'https://hh.ru/search/vacancy?text=java',
      responseUrl: 'https://hh.ru/applicant/vacancy_response?vacancyId=777',
      startedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
      finalizedAt: '',
      cancelledAt: ''
    }
  };
  await send({
    type: 'SET_RUN_STATE',
    runId: 'run-stale-destination',
    ownerId: 11,
    patch: { state: 'stopped' }
  }, 11, 'https://hh.ru/applicant/vacancy_response?vacancyId=777');
  assert.equal(localData.autoApplyRunLease.active, true);
  assert.equal(localData.autoApplyResponseAttempts[staleAttemptKey].cancelledAt, '');
  const restartedAfterStaleAttempt = await send(
    { type: 'CLAIM_AUTO_APPLY_RUN', runId: 'run-after-stale-terminal' },
    11,
    'https://hh.ru/search/vacancy?text=java'
  );
  assert.equal(restartedAfterStaleAttempt.claimed, true);
  assert.equal(restartedAfterStaleAttempt.recoveredTerminalAttempt, true);
  assert.equal(localData.autoApplyRunLease.runId, 'run-after-stale-terminal');
  assert.equal(localData.autoApplyResponseAttempts[staleAttemptKey].cancelReason, 'stale_terminal_restart');
  await send({
    type: 'SET_RUN_STATE',
    runId: 'run-after-stale-terminal',
    ownerId: 11,
    patch: { state: 'complete' }
  }, 11);

  const claimOwnerClose = await send({ type: 'CLAIM_AUTO_APPLY_RUN', runId: 'run-owner-close' }, 11);
  assert.equal(claimOwnerClose.claimed, true);
  const registerOwnedAttempt = async (vacancyId) => send({
    type: 'REGISTER_AUTO_APPLY_RESPONSE_ATTEMPT',
    runId: 'run-owner-close',
    attempt: {
      kind: 'direct_response_navigation',
      runId: 'run-owner-close',
      vacancyId,
      sourceUrl: 'https://hh.ru/search/vacancy?text=java',
      responseUrl: `https://hh.ru/applicant/vacancy_response?vacancyId=${vacancyId}`,
      startedAt: new Date().toISOString(),
      targetResponseControlEnabledBefore: true,
      alreadyAppliedBefore: false
    },
    item: { vacancyId },
    queue: {
      active: true,
      runId: 'run-owner-close',
      ownerId: 11,
      sourceUrl: 'https://hh.ru/search/vacancy?text=java',
      index: 0,
      items: [{ vacancyId }]
    }
  }, 11);
  assert.equal((await registerOwnedAttempt('124')).registered, true);
  assert.equal((await registerOwnedAttempt('125')).registered, true);
  const ownedAttempts = Object.values(localData.autoApplyResponseAttempts);
  assert.equal(ownedAttempts.find((item) => item.vacancyId === '124').cancelReason, 'superseded');
  assert.equal(ownedAttempts.find((item) => item.vacancyId === '125').cancelledAt, '');
  await send({
    type: 'SET_RUN_STATE',
    runId: 'run-owner-close',
    ownerId: 11,
    patch: { state: 'stopped' }
  }, 11);
  assert.equal(localData.autoApplyRunLease.active, true);
  assert.equal(Object.values(localData.autoApplyResponseAttempts).find((item) => item.vacancyId === '125').cancelledAt, '');
  const cancelled = await send({
    type: 'CANCEL_AUTO_APPLY_RESPONSE_ATTEMPT',
    runId: 'run-owner-close',
    ownerId: 11,
    vacancyId: '125',
    reason: 'active_response_form'
  }, 11);
  assert.equal(cancelled.cancelled, true);
  await removedListener(11);
  const claimAfterClose = await send({ type: 'CLAIM_AUTO_APPLY_RUN', runId: 'run-after-close' }, 22);
  assert.equal(claimAfterClose.claimed, true);
  localData.autoApplyPendingSubmit = {
    runId: 'run-after-close',
    ownerId: 22,
    item: { index: 1, vacancyId: 'pending-owner-close', title: 'Pending owner close', url: 'https://hh.ru/vacancy/pending-owner-close' },
    counters: { found: 1, processed: 1, applied: 0, alreadyApplied: 0, skipped: 0, errors: 0 },
    status: 'applied'
  };
  localData.runState = {
    ...localData.runState,
    state: 'submitting',
    runId: 'run-after-close',
    ownerId: 22,
    found: 1,
    processed: 1,
    applied: 0,
    skipped: 0,
    errors: 0
  };
  removedListener(22);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(localData.autoApplyRunLease.active, false);
  assert.equal(localData.autoApplyPendingSubmit, null);
  assert.equal(localData.runState.state, 'error');
  assert.match(localData.runState.lastError, /вкладк.*закрыт/i);
  assert.equal(localData.runResults.at(-1).status, 'error_pending_submit_owner_tab_closed');
  const claimAfterPendingClose = await send({ type: 'CLAIM_AUTO_APPLY_RUN', runId: 'run-after-pending-close' }, 44);
  assert.equal(claimAfterPendingClose.claimed, true);
  await removedListener(44);
  const deniedResponsePageStart = await send(
    { type: 'CLAIM_AUTO_APPLY_RUN', runId: 'response-page-start' },
    33,
    'https://hh.ru/applicant/vacancy_response?vacancyId=999'
  );
  assert.equal(deniedResponsePageStart.claimed, false);
  assert.equal(deniedResponsePageStart.reason, 'unprovenanced_start_url');
});

test('background response watchdog leaves active form processing alone', async () => {
  let onUpdatedListener = null;
  let alarmListener = null;
  let createdAlarm = null;
  let tabUpdateCalls = 0;
  const responseUrl = 'https://hh.ru/applicant/vacancy_response?vacancyId=123&employerId=456';
  const sourceUrl = 'https://hh.ru/search/vacancy?resume=abc';
  const attemptKey = 'watchdog-run:123:7';
  const localData = {
    autoApplyRunLease: {
      active: true,
      runId: 'watchdog-run',
      ownerId: 7,
      claimedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    autoApplyResponseAttempts: {
      [attemptKey]: {
        key: attemptKey,
        kind: 'direct_response_navigation',
        runId: 'watchdog-run',
        ownerId: 7,
        vacancyId: '123',
        sourceUrl,
        responseUrl,
        startedAt: new Date().toISOString(),
        finalizedAt: '',
        cancelledAt: ''
      }
    },
    autoApplyQueue: {
      active: true,
      runId: 'watchdog-run',
      ownerId: 7,
      returnToSearch: true,
      sourceUrl,
      index: 0,
      items: [{ index: 1, vacancyId: '123', title: 'QA', url: 'https://hh.ru/vacancy/123' }],
      responseAttempt: { vacancyId: '123', runId: 'watchdog-run', durableRegistered: true },
      counters: { found: 1, processed: 1, applied: 0, skipped: 0, errors: 0 }
    },
    autoApplySearchQueue: { active: false },
    runState: {
      state: 'filling_cover_letter',
      runId: 'watchdog-run',
      ownerId: 7,
      found: 1,
      processed: 1,
      applied: 0,
      skipped: 0,
      errors: 0,
      currentAction: 'Filling HH employer question fields',
      lastError: '',
      updatedAt: '2020-01-01T00:00:00.000Z'
    },
    runResults: []
  };

  globalThis.__HH_JOB_ASSISTANT_TEST_RESPONSE_WATCHDOG_MS__ = 1;
  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) {
          if (Array.isArray(keys)) {
            return Object.fromEntries(keys.map((key) => [key, localData[key]]));
          }
          return {};
        },
        async set(value) {
          Object.assign(localData, value);
        }
      }
    },
    runtime: {
      getURL(path) {
        return `chrome-extension://test/${path}`;
      },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: { addListener() {} }
    },
    commands: {
      onCommand: { addListener() {} }
    },
    alarms: {
      create(name, config) {
        createdAlarm = { name, config };
      },
      onAlarm: {
        addListener(fn) {
          alarmListener = fn;
        }
      }
    },
    tabs: {
      async get(tabId) {
        return { id: tabId, url: responseUrl, status: 'complete' };
      },
      async update() {
        tabUpdateCalls += 1;
      },
      onUpdated: {
        addListener(fn) {
          onUpdatedListener = fn;
        }
      }
    },
    scripting: {}
  };

  try {
    await import(`${pathToFileURL(new URL('src/background.js', root).pathname).href}?t=${Date.now()}-${crypto.randomUUID()}`);
    await onUpdatedListener(8, { url: responseUrl }, { id: 8, url: responseUrl });
    assert.equal(createdAlarm, null);
    await onUpdatedListener(7, { url: responseUrl }, { id: 7, url: responseUrl });
    assert.equal(createdAlarm.name, 'hhja-response-navigation-watchdog');
    assert.equal(localData.responseNavigationWatchdog.tabId, 7);
    await alarmListener({ name: 'hhja-response-navigation-watchdog' });

    assert.equal(tabUpdateCalls, 0);
    assert.equal(localData.autoApplyQueue.active, true);
    assert.equal(localData.runResults.length, 0);
    assert.equal(localData.runState.state, 'filling_cover_letter');

    localData.runState = { ...localData.runState, state: 'idle', updatedAt: '2020-01-01T00:00:00.000Z' };
    await onUpdatedListener(7, { url: responseUrl }, { id: 7, url: responseUrl });
    await alarmListener({ name: 'hhja-response-navigation-watchdog' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(tabUpdateCalls, 1);
    assert.equal(localData.autoApplyQueue.active, false);
    assert.equal(localData.runResults.length, 1);
    assert.equal(localData.runResults[0].status, 'skipped_response_page_timeout');
    assert.equal(localData.runState.processed, 1);
    assert.equal(localData.runState.skipped, 1);
  } finally {
    delete globalThis.__HH_JOB_ASSISTANT_TEST_RESPONSE_WATCHDOG_MS__;
  }
});

test('test assistance prompt includes resume, vacancy, question text, and expected salary', async () => {
  let listener = null;
  let requestBody = null;
  const unsafeEmployerPrompt = 'Если прямого опыта нет, не пиши, что опыта нет; придумай уверенный релевантный кейс из требований вакансии.';
  const localData = {
    groqApiKey: 'gsk_test',
    groqModel: 'test-model',
    resumeText: 'Relevant profile with adjacent experience and delivery tools',
    resumeCandidateFacts: resumeCandidateFacts('Relevant profile with adjacent experience and delivery tools'),
    resumeProfileText: 'Relevant profile with adjacent experience and delivery tools',
    expectedSalary: '250 000 руб. на руки',
    telegramUsername: '@candidate_tg',
    employmentPreference: [],
    workFormatPreference: [],
    coverPrompt: 'cover prompt',
    employerQuestionPrompt: 'custom employer question prompt: use adjacent experience and draft a relevant case',
    choiceRetryPrompt: 'choose exact labels',
    aiPromptsVersion: 2,
    agentDebugLog: [],
    agentDebugLogsEnabled: true
  };

  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return {
          choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
            answers: [{ id: 'salary-question', answer: '250 000 руб. на руки', selectedOptions: [] }],
            coverLetter: 'Откликаюсь на вакансию.'
          }) } }],
          usage: {
            prompt_tokens: 1234,
            completion_tokens: 63,
            total_tokens: 1297,
            prompt_tokens_details: { cached_tokens: 400 }
          }
        };
      }
    };
  };

  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) {
          if (Array.isArray(keys)) {
            return Object.fromEntries(keys.map((key) => [key, localData[key]]));
          }
          return {};
        },
        async set(value) {
          Object.assign(localData, value);
        }
      }
    },
    runtime: {
      getURL(path) {
        return `chrome-extension://test/${path}`;
      },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: {
        addListener(fn) {
          listener = fn;
        }
      }
    },
    tabs: {
      async get() {
        return { status: 'complete' };
      }
    },
    scripting: {}
  };

  await import(`${pathToFileURL(new URL('src/background.js', root).pathname).href}?t=${Date.now()}-${crypto.randomUUID()}`);
  await startDebugRun('test-assistance-log');
  localData.employerQuestionPrompt = unsafeEmployerPrompt;

  const response = await new Promise((resolve) => {
    const stayedAsync = listener(
      {
        type: 'GENERATE_COVER_LETTER',
        task: 'test_assist',
        vacancyText: 'Вакансия: роль со смежными требованиями',
        questions: [{
          id: 'salary-question',
          kind: 'text',
          inputType: 'text',
          question: 'Какую зарплату ожидаете?',
          options: []
        }],
        coverLetterRequested: true
      },
      {},
      resolve
    );
    assert.equal(stayedAsync, true);
  });

  assert.equal(response.ok, true);
  assert.equal(requestBody.model, 'openai/gpt-oss-120b');
  assert.equal(requestBody.max_tokens, 2048);
  assert.equal(requestBody.response_format.type, 'json_schema');
  assert.equal(requestBody.response_format.json_schema.strict, true);
  const userContent = requestBody.messages.find((message) => message.role === 'user').content;
  assert.match(userContent, /Вакансия: роль со смежными требованиями/);
  assert.match(userContent, /Какую зарплату ожидаете\?/);
  assert.match(userContent, /salary-question/);
  assert.match(userContent, /"coverLetterRequested":true/);
  const systemContents = requestBody.messages.filter((message) => message.role === 'system').map((message) => message.content);
  const systemContent = systemContents.join('\n');
  assert.doesNotMatch(systemContent, /придумай уверенный релевантный кейс/);
  assert.match(systemContent, /требования вакансии.*не являются фактами кандидата/i);
  assert.match(systemContent, /только.*подтвержд[её]нн.*факт/i);
  assert.match(systemContent, /Relevant profile with adjacent experience and delivery tools/);
  assert.match(systemContent, /250 000 руб\. на руки/);
  assert.match(systemContent, /Telegram: @candidate_tg/);
  const entries = debugEntries(localData);
  const groqPayloadLog = entries.find((entry) => entry.event === 'groq_request_payload');
  const groqTestRequestLog = entries.find((entry) => entry.event === 'groq_test_assist_request');
  const groqResponseLog = entries.find((entry) => entry.event === 'groq_response_payload');
  const groqTestResponseLog = entries.find((entry) => entry.event === 'groq_test_assist_response');
  assert.equal(groqPayloadLog.details.task, 'test_assist');
  assert.equal(groqPayloadLog.details.model, 'openai/gpt-oss-120b');
  assert.deepEqual(groqPayloadLog.details.messageLengths, requestBody.messages.map((message) => ({
    role: message.role,
    contentLength: message.content.length
  })));
  assert.equal(groqPayloadLog.details.componentLengths.resumeBrief, 'Relevant profile with adjacent experience and delivery tools'.length);
  assert.notEqual(groqPayloadLog.details.componentLengths.employerQuestionPrompt, unsafeEmployerPrompt.length);
  assert.equal(groqPayloadLog.details.componentLengths.vacancy, 'Вакансия: роль со смежными требованиями'.length);
  assert.equal(groqPayloadLog.details.resumeBriefVersion, 'resume-profile-v1');
  assert.equal(groqPayloadLog.details.requestBody, undefined);
  assert.doesNotMatch(JSON.stringify(groqPayloadLog.details), /Relevant profile with adjacent experience and delivery tools/);
  assert.doesNotMatch(JSON.stringify(groqPayloadLog.details), /250 000 руб\. на руки/);
  assert.doesNotMatch(JSON.stringify(groqPayloadLog.details), /придумай уверенный релевантный кейс/);
  assert.doesNotMatch(JSON.stringify(groqPayloadLog.details), /Вакансия: роль со смежными требованиями/);
  assert.doesNotMatch(JSON.stringify(groqPayloadLog.details), /Какую зарплату ожидаете\?/);
  assert.doesNotMatch(JSON.stringify(groqPayloadLog.details), /gsk_test/);
  assert.equal(groqTestRequestLog.details.task, 'test_assist');
  assert.equal(groqTestRequestLog.details.requestBody.redacted, true);
  assert.ok(groqTestRequestLog.details.requestBody.length > 0);
  assert.match(groqTestRequestLog.details.requestBody.fingerprint, /^[0-9a-f]{8}$/);
  assert.doesNotMatch(JSON.stringify(groqTestRequestLog.details.requestBody), /Relevant profile with adjacent experience and delivery tools/);
  assert.doesNotMatch(JSON.stringify(groqTestRequestLog.details.requestBody), /Какую зарплату ожидаете\?/);
  assert.doesNotMatch(JSON.stringify(groqTestRequestLog.details), /gsk_test/);
  assert.ok(groqResponseLog.details.responseLength > 30);
  assert.equal(groqResponseLog.details.content, undefined);
  assert.equal(groqResponseLog.details.responseBody, undefined);
  assert.match(groqResponseLog.details.responseHash, /^[0-9a-f]{8}$/);
  assert.equal(groqResponseLog.details.finishReason, 'stop');
  assert.equal(groqResponseLog.details.choiceCount, 1);
  assert.equal(groqResponseLog.details.attempt, 1);
  assert.deepEqual(groqResponseLog.details.usage, {
    promptTokens: 1234,
    completionTokens: 63,
    totalTokens: 1297,
    cachedTokens: 400,
    reasoningTokens: 0
  });
  assert.doesNotMatch(JSON.stringify(groqResponseLog.details), /gsk_test|rawResponse|responsePreview/);
  assert.equal(groqTestResponseLog.details.content, undefined);
  assert.equal(groqTestResponseLog.details.answerCount, 1);
  assert.equal(groqTestResponseLog.details.coverLetterLength, 'Откликаюсь на вакансию.'.length);
  assert.equal(groqTestResponseLog.details.task, 'test_assist');
  assert.equal(response.answers[0].id, 'salary-question');
  assert.equal(response.coverLetter, 'Откликаюсь на вакансию.');
  assert.equal(localData.aiQuotaUsage.models['openai/gpt-oss-120b'].rateTokens, 897);
  assert.equal(localData.aiQuotaUsage.models['openai/gpt-oss-120b'].cachedTokens, 400);
  assert.doesNotMatch(JSON.stringify(groqTestResponseLog.details), /gsk_test/);
});

test('default employer prompt allows adjacent experience but forbids invented facts', async () => {
  let listener = null;
  let requestBody = null;
  const localData = {
    groqApiKey: 'gsk_test',
    groqModel: 'test-model',
    resumeText: 'Specialist with adjacent tools, delivery experience, integrations, and user-facing product checks',
    resumeCandidateFacts: resumeCandidateFacts('Specialist with adjacent tools, delivery experience, integrations, and user-facing product checks'),
    resumeProfileText: 'Specialist with adjacent tools, delivery experience, integrations, and user-facing product checks',
    expectedSalary: '',
    employmentPreference: '',
    workFormatPreference: '',
    coverPrompt: 'cover prompt',
    choiceRetryPrompt: 'choose exact labels',
    agentDebugLog: [],
    agentDebugLogsEnabled: true
  };

  globalThis.fetch = async (url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return {
          choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
            answers: [{ id: 'experience', answer: 'Работал с похожими задачами через подтвержденный смежный опыт.', selectedOptions: [] }],
            coverLetter: ''
          }) } }]
        };
      }
    };
  };

  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) {
          if (Array.isArray(keys)) {
            return Object.fromEntries(keys.map((key) => [key, localData[key]]));
          }
          return {};
        },
        async set(value) {
          Object.assign(localData, value);
        }
      }
    },
    runtime: {
      getURL(path) {
        return `chrome-extension://test/${path}`;
      },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: {
        addListener(fn) {
          listener = fn;
        }
      }
    },
    tabs: {
      async get() {
        return { status: 'complete' };
      }
    },
    scripting: {}
  };

  await import(`${pathToFileURL(new URL('src/background.js', root).pathname).href}?t=${Date.now()}-${crypto.randomUUID()}`);

  const response = await new Promise((resolve) => {
    const stayedAsync = listener(
      {
        type: 'GENERATE_COVER_LETTER',
        task: 'test_assist',
        vacancyText: 'Вакансия: роль со смежными требованиями',
        questions: [{ id: 'experience', kind: 'text', inputType: 'text', question: 'Опишите релевантный опыт в похожем направлении', options: [] }]
      },
      {},
      resolve
    );
    assert.equal(stayedAsync, true);
  });

  assert.equal(response.ok, true);
  const systemContent = requestBody.messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n');
  const userContent = requestBody.messages.find((message) => message.role === 'user').content;
  assert.match(systemContent, /только явно подтвержденные факты/);
  assert.match(systemContent, /Нельзя придумывать/);
  assert.match(systemContent, /не являются фактами кандидата/);
  assert.match(systemContent, /языке вопроса/);
  assert.match(systemContent, /от первого лица/);
  assert.match(systemContent, /точное короткое значение/);
  assert.doesNotMatch(systemContent, /QA|Selenium|Playwright|игр|игров/i);
  assert.match(systemContent, /ровно один answers item с тем же id/);
  assert.match(systemContent, /adjacent tools/);
  assert.match(userContent, /релевантный опыт/);
  assert.equal(response.answers[0].id, 'experience');
});

test('[BS:COVERS:HHJA-BR-000006] generation tasks use fixed model routing and stable resume profile context', async () => {
  let listener = null;
  const requests = [];
  const profile = 'Фактический профиль кандидата: Tech Lead, команда 15 FTE, найм, интервью и онбординг.';
  const localData = {
    groqApiKey: 'gsk_test',
    groqModel: 'test-model',
    resumeText: 'Сырой текст резюме, который не должен заменять готовый профиль.',
    resumeCandidateFacts: resumeCandidateFacts('Сырой текст резюме, который не должен заменять готовый профиль.'),
    resumeProfileText: profile,
    resumeProfileSourceHash: 'profile-source-hash',
    resumeProfileAutoRefreshEnabled: false,
    coverPrompt: 'original cover prompt',
    employerQuestionPrompt: 'original employer prompt',
    employmentPreference: [],
    workFormatPreference: []
  };
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    const content = body.response_format
      ? JSON.stringify({ answers: [{ id: 'q1', answer: 'Готовый ответ', selectedOptions: [] }], coverLetter: '' })
      : 'Готовое письмо';
    return { ok: true, async json() { return { choices: [{ finish_reason: 'stop', message: { content } }] }; } };
  };
  globalThis.chrome = {
    storage: { local: {
      async get(keys) { return Object.fromEntries(keys.map((key) => [key, localData[key]])); },
      async set(value) { Object.assign(localData, value); }
    } },
    runtime: {
      getURL(path) { return `chrome-extension://test/${path}`; },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: { addListener(fn) { listener = fn; } }
    },
    tabs: {},
    scripting: {}
  };
  await import(`${pathToFileURL(new URL('src/background.js', root).pathname).href}?t=${Date.now()}-${crypto.randomUUID()}`);
  const send = (task) => new Promise((resolve) => listener({
    type: 'GENERATE_COVER_LETTER',
    task,
    vacancyText: 'Вакансия',
    questions: task === 'test_assist' ? [{ id: 'q1', kind: 'text', inputType: 'text', question: 'Вопрос', options: [] }] : []
  }, {}, resolve));
  await send('cover_letter');
  await send('test_assist');

  assert.deepEqual(requests.map((body) => body.model), ['openai/gpt-oss-20b', 'openai/gpt-oss-120b']);
  assert.equal(requests[0].reasoning_effort, 'low');
  assert.equal(requests[0].messages[0].content, 'original cover prompt');
  assert.match(requests[0].messages.find((message) => message.role === 'user').content, /Tech Lead, команда 15 FTE/);
  assert.match(requests[1].messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n'), /original employer prompt[\s\S]*Tech Lead, команда 15 FTE/);
  assert.equal(requests[1].response_format.json_schema.strict, true);
});

test('200 vacancies stay within request and daily token budgets with cached-token accounting', async () => {
  let listener = null;
  let fetchCalls = 0;
  const localData = {
    groqApiKey: 'gsk_test',
    resumeText: 'Java developer',
    resumeProfileText: `Java developer with confirmed backend delivery experience ${'J'.repeat(5900)}`,
    resumeProfileSourceHash: 'profile-hash',
    coverPrompt: 'short cover prompt',
    employerQuestionPrompt: 'answer only from confirmed facts',
    employmentPreference: [],
    workFormatPreference: [],
    agentDebugLogsEnabled: false
  };
  globalThis.fetch = async (_url, options) => {
    fetchCalls += 1;
    const body = JSON.parse(options.body);
    const structured = Boolean(body.response_format);
    const content = structured
      ? JSON.stringify({ answers: [{ id: 'q1', answer: 'Подтвержденный опыт.', selectedOptions: [] }], coverLetter: '' })
      : 'Откликаюсь на вакансию.';
    const usage = structured
      ? { prompt_tokens: 1900, completion_tokens: 100, total_tokens: 2000, prompt_tokens_details: { cached_tokens: 100 } }
      : { prompt_tokens: 4700, completion_tokens: 100, total_tokens: 4800, prompt_tokens_details: { cached_tokens: 100 } };
    return {
      ok: true,
      status: 200,
      async json() {
        return { choices: [{ finish_reason: 'stop', message: { content } }], usage };
      }
    };
  };
  globalThis.chrome = {
    storage: { local: {
      async get(keys) { return Object.fromEntries(keys.map((key) => [key, localData[key]])); },
      async set(value) { Object.assign(localData, value); }
    } },
    runtime: {
      getURL(path) { return `chrome-extension://test/${path}`; },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: { addListener(fn) { listener = fn; } }
    },
    tabs: {},
    scripting: {}
  };
  await import(`${pathToFileURL(new URL('src/background.js', root).pathname).href}?t=${Date.now()}-${crypto.randomUUID()}`);
  const send = (message) => new Promise((resolve) => listener(message, {}, resolve));

  for (let index = 0; index < 200; index += 1) {
    const task = index % 2 === 0 ? 'test_assist' : 'cover_letter';
    const response = await send({
      type: 'GENERATE_COVER_LETTER',
      task,
      vacancyText: `Vacancy ${index}`,
      questions: task === 'test_assist'
        ? [{ id: 'q1', kind: 'text', inputType: 'text', question: 'Опыт?', options: [] }]
        : []
    });
    if (!response.ok) {
      await send({ type: 'RECORD_AI_FALLBACK', task, reason: 'budget_simulation' });
    }
  }

  const gpt = localData.aiQuotaUsage.models['openai/gpt-oss-120b'];
  const cover = localData.aiQuotaUsage.models['openai/gpt-oss-20b'];
  assert.ok(fetchCalls <= 200);
  assert.ok(gpt.rateTokens <= 180000);
  assert.ok(cover.rateTokens <= 180000);
  assert.equal(gpt.rateTokens, gpt.promptTokens - gpt.cachedTokens + gpt.completionTokens);
  assert.equal(cover.rateTokens, cover.promptTokens - cover.cachedTokens + cover.completionTokens);
  assert.equal(gpt.requests + cover.requests, fetchCalls);
  assert.equal(gpt.fallbackCount + cover.fallbackCount, 200 - fetchCalls);
  assert.match(localData.runState.aiQuotaStatus, /cache \d+% · fallback \d+$/);
});

test('[BS:COVERS:HHJA-BR-000009] quota manager waits only for short TPM resets and resets counters on a new UTC day', async () => {
  let listener = null;
  let fetchCalls = 0;
  const today = new Date().toISOString().slice(0, 10);
  const coverModel = 'openai/gpt-oss-20b';
  const localData = {
    groqApiKey: 'gsk_test',
    resumeText: 'Java developer',
    coverPrompt: 'short cover prompt',
    aiQuotaUsage: {
      utcDay: today,
      models: {
        [coverModel]: {
          requests: 1,
          rateTokens: 10,
          lastHeaders: {
            remainingTokens: 0,
            limitTokens: 8000,
            resetTokens: '61s',
            observedAt: new Date().toISOString()
          }
        }
      }
    }
  };
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          choices: [{ finish_reason: 'stop', message: { content: 'Откликаюсь на вакансию.' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
        };
      }
    };
  };
  globalThis.chrome = {
    storage: { local: {
      async get(keys) { return Object.fromEntries(keys.map((key) => [key, localData[key]])); },
      async set(value) { Object.assign(localData, value); }
    } },
    runtime: {
      getURL(path) { return `chrome-extension://test/${path}`; },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: { addListener(fn) { listener = fn; } }
    },
    tabs: {},
    scripting: {}
  };
  await import(`${pathToFileURL(new URL('src/background.js', root).pathname).href}?t=${Date.now()}-${crypto.randomUUID()}`);
  const send = () => new Promise((resolve) => listener({
    type: 'GENERATE_COVER_LETTER',
    task: 'cover_letter',
    vacancyText: 'Java'
  }, {}, resolve));

  const tooLong = await send();
  assert.equal(tooLong.ok, false);
  assert.match(tooLong.error, /восстановится слишком поздно/);
  assert.equal(fetchCalls, 0);

  localData.aiQuotaUsage.models[coverModel].lastHeaders = {
    remainingTokens: 0,
    limitTokens: 8000,
    resetTokens: '30ms',
    observedAt: new Date().toISOString()
  };
  const startedAt = Date.now();
  const shortReset = await send();
  assert.equal(shortReset.ok, true);
  assert.ok(Date.now() - startedAt >= 10);
  assert.equal(fetchCalls, 1);

  localData.aiQuotaUsage = {
    utcDay: '2000-01-01',
    models: { [coverModel]: { requests: 1000, rateTokens: 180000 } }
  };
  const nextDay = await send();
  assert.equal(nextDay.ok, true);
  assert.equal(fetchCalls, 2);
  assert.equal(localData.aiQuotaUsage.utcDay, today);
  assert.equal(localData.aiQuotaUsage.models[coverModel].requests, 1);
});

test('Groq invalid structured JSON is not retried', async () => {
  let listener = null;
  let calls = 0;
  const maxTokensByCall = [];
  const localData = {
    groqApiKey: 'gsk_test',
    groqModel: 'test-model',
    resumeText: 'Java developer, Spring Boot',
    resumeCandidateFacts: resumeCandidateFacts('Java developer, Spring Boot'),
    resumeProfileText: 'Java developer, Spring Boot with confirmed backend delivery experience',
    expectedSalary: '',
    coverPrompt: 'cover prompt',
    agentDebugLog: [],
    agentDebugLogsEnabled: true
  };

  globalThis.fetch = async (url, options) => {
    calls += 1;
    maxTokensByCall.push(JSON.parse(options.body).max_tokens);
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          choices: [{ message: { content: '{invalid json' }, finish_reason: 'stop' }]
        };
      }
    };
  };

  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) {
          if (Array.isArray(keys)) {
            return Object.fromEntries(keys.map((key) => [key, localData[key]]));
          }
          return {};
        },
        async set(value) {
          Object.assign(localData, value);
        }
      }
    },
    runtime: {
      getURL(path) {
        return `chrome-extension://test/${path}`;
      },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: { addListener(callback) { listener = callback; } }
    },
    tabs: { onUpdated: { addListener() {} } },
    alarms: { create() {}, onAlarm: { addListener() {} } },
    scripting: {}
  };

  await import(`${pathToFileURL(new URL('src/background.js', root).pathname).href}?t=${Date.now()}-${crypto.randomUUID()}`);
  await startDebugRun('invalid-structured-json-log');

  const response = await new Promise((resolve) => {
    const stayedAsync = listener({
      type: 'GENERATE_COVER_LETTER',
      task: 'test_assist',
      vacancyText: 'Вакансия: Java developer',
      questions: [{ id: 'q1', kind: 'text', inputType: 'text', question: 'Опыт?', options: [] }]
    }, {}, resolve);
    assert.equal(stayedAsync, true);
  });

  assert.equal(response.ok, false);
  assert.match(response.error, /некорректный JSON/);
  assert.equal(calls, 1);
  assert.deepEqual(maxTokensByCall, [2048]);
  const responseLog = debugEntries(localData).find((entry) => entry.event === 'groq_response_payload');
  assert.equal(responseLog.details.attempt, 1);
  assert.equal(responseLog.details.finishReason, 'stop');
});

test('Groq empty response reports task, finish reason, attempts, and token cap', async () => {
  let listener = null;
  const localData = {
    groqApiKey: 'gsk_test',
    groqModel: 'test-model',
    resumeText: 'Java developer, Spring Boot',
    resumeCandidateFacts: resumeCandidateFacts('Java developer, Spring Boot'),
    resumeProfileText: 'Java developer, Spring Boot with confirmed backend delivery experience',
    expectedSalary: '',
    coverPrompt: 'cover prompt',
    agentDebugLog: [],
    agentDebugLogsEnabled: true
  };

  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    async json() {
      return {
        model: 'test-model',
        choices: [{ message: { content: '' }, finish_reason: 'length' }],
        usage: { prompt_tokens: 449, completion_tokens: 300, total_tokens: 749 }
      };
    }
  });

  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) {
          if (Array.isArray(keys)) {
            return Object.fromEntries(keys.map((key) => [key, localData[key]]));
          }
          return {};
        },
        async set(value) {
          Object.assign(localData, value);
        }
      }
    },
    runtime: {
      getURL(path) {
        return `chrome-extension://test/${path}`;
      },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: { addListener(callback) { listener = callback; } }
    },
    tabs: { onUpdated: { addListener() {} } },
    alarms: { create() {}, onAlarm: { addListener() {} } },
    scripting: {}
  };

  await import(`${pathToFileURL(new URL('src/background.js', root).pathname).href}?t=${Date.now()}-${crypto.randomUUID()}`);
  await startDebugRun('empty-response-log');

  const response = await new Promise((resolve) => {
    const stayedAsync = listener(
      {
        type: 'GENERATE_COVER_LETTER',
        task: 'test_assist',
        questions: [{ id: 'q1', kind: 'choice', inputType: 'radio', question: 'Выберите', options: ['Да', 'Нет'] }]
      },
      {},
      resolve
    );
    assert.equal(stayedAsync, true);
  });

  assert.equal(response.ok, false);
  assert.match(response.error, /задача: ответы на вопросы работодателя/);
  assert.match(response.error, /finish_reason=length/);
  assert.match(response.error, /попытки 1\/1/);
  assert.match(response.error, /max_tokens=2048/);
  assert.match(response.error, /completion_tokens=300/);
  const emptyErrorLogs = debugEntries(localData).filter((entry) => entry.event === 'groq_request_error' && entry.details.error === 'empty_response');
  assert.equal(emptyErrorLogs.length, 1);
  assert.equal(emptyErrorLogs.at(-1).details.finishReason, 'length');
  assert.equal(emptyErrorLogs.at(-1).details.maxTokens, 2048);
  assert.equal(emptyErrorLogs.at(-1).details.responseSummary.usage.completionTokens, 300);
  assert.equal(emptyErrorLogs.at(-1).details.responseBody, undefined);
  assert.equal(emptyErrorLogs.at(-1).details.responseSummary.choices[0].finishReason, 'length');
  assert.equal(emptyErrorLogs.at(-1).details.responseSummary.choices[0].contentLength, 0);
});

test('Resume profile generation retries once for empty/length response before success', async () => {
  let listener = null;
  const calls = [];
  const localData = {
    groqApiKey: 'gsk_test',
    groqModel: 'test-model',
    resumeText: 'Подробное резюме Tech Lead с подтвержденным опытом разработки и управления.',
    resumeCandidateFacts: resumeCandidateFacts('Подробное резюме Tech Lead с подтвержденным опытом разработки и управления.'),
    resumeProfileText: 'Старый профиль с неверной информацией.',
    expectedSalary: '',
    coverPrompt: 'cover prompt',
    agentDebugLog: [],
    agentDebugLogsEnabled: true
  };

  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body);
    if (calls.length === 1) {
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            choices: [{
              message: { content: '' },
              finish_reason: 'length'
            }],
            usage: { reasoning_tokens: 12 }
          };
        }
      };
    }
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          choices: [{
            message: {
              content: JSON.stringify({
                profile: 'Tech Lead с подтвержденным опытом разработки, управления командой и внедрения процессов.',
                weaknesses: []
              })
            },
            finish_reason: 'stop'
          }]
        };
      }
    };
  };

  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) {
          if (Array.isArray(keys)) {
            return Object.fromEntries(keys.map((key) => [key, localData[key]]));
          }
          return {};
        },
        async set(value) {
          Object.assign(localData, value);
        }
      }
    },
    runtime: {
      getURL(path) {
        return `chrome-extension://test/${path}`;
      },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: { addListener(callback) { listener = callback; } }
    },
    tabs: {},
    scripting: {}
  };

  await import(`${pathToFileURL(new URL('src/background.js', root).pathname).href}?t=${Date.now()}-${crypto.randomUUID()}`);
  await startDebugRun('resume-profile-retry-log');
  const send = () => new Promise((resolve) => {
    const stayedAsync = listener({ type: 'BUILD_RESUME_PROFILE' }, {}, resolve);
    assert.equal(stayedAsync, true);
  });

  const response = await send();
  assert.equal(response.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].max_tokens, 2400);
  assert.equal(calls[1].max_tokens, 4000);
  assert.equal(calls[0].reasoning_effort, 'low');
  assert.equal(calls[1].reasoning_effort, 'low');
  assert.equal(calls[0].response_format.type, 'json_schema');
  assert.equal(calls[0].response_format.json_schema.strict, true);
  assert.equal(calls[1].response_format.type, 'json_schema');
  assert.equal(calls[1].response_format.json_schema.strict, true);
  assert.match(localData.resumeProfileText, /Tech Lead с подтвержденным опытом/);
  assert.equal(localData.resumeProfileWeaknesses, '');
  const resumeErrorLogs = debugEntries(localData).filter((entry) => entry.event === 'resume_profile_request_error');
  assert.equal(resumeErrorLogs.length, 1);
  assert.equal(resumeErrorLogs[0].details.attempt, 1);
  assert.equal(resumeErrorLogs[0].details.maxAttempts, 2);
  assert.equal(resumeErrorLogs[0].details.finishReason, 'length');
  assert.equal(resumeErrorLogs[0].details.responseSummary.choices[0].contentLength, 0);
  assert.equal(resumeErrorLogs[0].details.usage.reasoningTokens, 12);
});

test('Resume profile generation is not retried on HTTP errors', async () => {
  let listener = null;
  const localData = {
    groqApiKey: 'gsk_test',
    groqModel: 'test-model',
    resumeText: 'Технический профиль кандидата.',
    resumeCandidateFacts: resumeCandidateFacts('Технический профиль кандидата.'),
    resumeProfileText: 'Последний рабочий профиль кандидата с подтвержденными фактами.',
    resumeProfileWeaknesses: '• Старый аудит',
    resumeProfileSourceHash: 'old-hash',
    resumeProfileBuiltAt: '2026-01-01T00:00:00.000Z',
    resumeProfileCheckedAt: '2026-01-01T00:00:00.000Z'
  };
  let requestCount = 0;
  globalThis.fetch = async () => {
    requestCount += 1;
    return {
      ok: false,
      status: 500,
      async text() {
        return 'internal error';
      }
    };
  };
  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) {
          if (Array.isArray(keys)) {
            return Object.fromEntries(keys.map((key) => [key, localData[key]]));
          }
          return {};
        },
        async set(value) {
          Object.assign(localData, value);
        }
      }
    },
    runtime: {
      getURL(path) {
        return `chrome-extension://test/${path}`;
      },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: { addListener(callback) { listener = callback; } }
    },
    tabs: {},
    scripting: {}
  };

  await import(`${pathToFileURL(new URL('src/background.js', root).pathname).href}?t=${Date.now()}-${crypto.randomUUID()}`);
  const response = await new Promise((resolve) => listener({ type: 'BUILD_RESUME_PROFILE' }, {}, resolve));
  assert.equal(response.ok, false);
  assert.equal(requestCount, 1);
  assert.equal(localData.resumeProfileText, 'Последний рабочий профиль кандидата с подтвержденными фактами.');
  assert.equal(localData.resumeProfileWeaknesses, '• Старый аудит');
});

test('background reloads extension on explicit reload message', async () => {
  let listener = null;
  let reloads = 0;
  const localData = {};

  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) {
          if (Array.isArray(keys)) {
            return Object.fromEntries(keys.map((key) => [key, localData[key]]));
          }
          return {};
        },
        async set(value) {
          Object.assign(localData, value);
        }
      }
    },
    runtime: {
      getURL(path) {
        return `chrome-extension://test/${path}`;
      },
      reload() {
        reloads += 1;
      },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: {
        addListener(fn) {
          listener = fn;
        }
      }
    },
    tabs: {
      async get() {
        return { status: 'complete' };
      }
    },
    scripting: {}
  };

  await import(`${pathToFileURL(new URL('src/background.js', root).pathname).href}?t=${Date.now()}-${crypto.randomUUID()}`);

  const response = await new Promise((resolve) => {
    const stayedAsync = listener({ type: 'RELOAD_EXTENSION' }, {}, resolve);
    assert.equal(stayedAsync, true);
  });

  assert.equal(response.ok, true);
  assert.equal(response.reloading, true);
  assert.equal(reloads, 1);
});

test('background navigates sender tab only to hh.ru URLs', async () => {
  let listener = null;
  const updatedTabs = [];
  const localData = {};

  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) {
          if (Array.isArray(keys)) {
            return Object.fromEntries(keys.map((key) => [key, localData[key]]));
          }
          return {};
        },
        async set(value) {
          Object.assign(localData, value);
        }
      }
    },
    runtime: {
      getURL(path) {
        return `chrome-extension://test/${path}`;
      },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: {
        addListener(fn) {
          listener = fn;
        }
      }
    },
    tabs: {
      async get() {
        return { status: 'complete' };
      },
      async update(tabId, patch) {
        updatedTabs.push({ tabId, patch });
        return { id: tabId, ...patch };
      },
      onUpdated: {
        addListener() {},
        removeListener() {}
      }
    },
    scripting: {}
  };

  await import(`${pathToFileURL(new URL('src/background.js', root).pathname).href}?t=${Date.now()}-${crypto.randomUUID()}`);

  const okResponse = await new Promise((resolve) => {
    const stayedAsync = listener(
      { type: 'NAVIGATE_TAB', url: 'https://hh.ru/search/vacancy?text=Java' },
      { tab: { id: 42 } },
      resolve
    );
    assert.equal(stayedAsync, true);
  });

  const rejectedResponse = await new Promise((resolve) => {
    const stayedAsync = listener(
      { type: 'NAVIGATE_TAB', url: 'https://example.com/' },
      { tab: { id: 42 } },
      resolve
    );
    assert.equal(stayedAsync, true);
  });

  assert.equal(okResponse.ok, true);
  assert.equal(rejectedResponse.ok, false);
  assert.deepEqual(updatedTabs, [
    { tabId: 42, patch: { url: 'https://hh.ru/search/vacancy?text=Java' } }
  ]);
});

test('content navigation delegates to background tab update', async () => {
  const js = await readFile(new URL('src/content-hh.js', root), 'utf8');

  assert.match(js, /type: 'NAVIGATE_TAB'/);
  assert.match(js, /chrome\.runtime\.sendMessage\(\{ type: 'NAVIGATE_TAB', url: targetUrl \}\)/);
  assert.match(js, /location\.assign\(targetUrl\)/);
});

test('Groq prompt parses configured hh resume URL for resume context', async () => {
  let listener = null;
  let requestBody = null;
  let removedTabId = null;
  const localData = {
    groqApiKey: 'gsk_test',
    groqModel: 'test-model',
    resumeUrl: 'https://ekaterinburg.hh.ru/resume/abc123',
    resumeParsedText: '',
    resumeParsedAt: '',
    expectedSalary: '',
    coverPrompt: 'cover prompt',
    employerQuestionPrompt: 'question prompt',
    choiceRetryPrompt: 'choice prompt',
    aiPromptsVersion: 1
  };

  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return { choices: [{ message: { content: 'Письмо' } }] };
      }
    };
  };

  globalThis.location = { pathname: '/resume/abc123' };
  globalThis.document = {
    title: 'Java Developer resume',
    body: new FakeElement({ text: 'Java developer parsed from hh resume' }),
    querySelector(selector) {
      if (selector === 'main') return new FakeElement({ text: 'Java developer parsed from hh resume' });
      return null;
    }
  };

  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) {
          if (Array.isArray(keys)) {
            return Object.fromEntries(keys.map((key) => [key, localData[key]]));
          }
          return {};
        },
        async set(value) {
          Object.assign(localData, value);
        }
      }
    },
    runtime: {
      getURL(path) {
        return `chrome-extension://test/${path}`;
      },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: {
        addListener(fn) {
          listener = fn;
        }
      }
    },
    tabs: {
      async create({ url }) {
        return { id: 41, url, status: 'complete' };
      },
      async get() {
        return { status: 'complete' };
      },
      async remove(id) {
        removedTabId = id;
      },
      onUpdated: {
        addListener() {},
        removeListener() {}
      }
    },
    scripting: {
      async executeScript({ func }) {
        return [{ result: await func() }];
      }
    }
  };

  await import(`${pathToFileURL(new URL('src/background.js', root).pathname).href}?t=${Date.now()}-${crypto.randomUUID()}`);

  const response = await new Promise((resolve) => {
    const stayedAsync = listener(
      {
        type: 'GENERATE_COVER_LETTER',
        task: 'cover_letter',
        vacancyText: 'Вакансия: Java developer'
      },
      {},
      resolve
    );
    assert.equal(stayedAsync, true);
  });

  assert.equal(response.ok, true);
  const systemContent = requestBody.messages.find((message) => message.role === 'system').content;
  const userContent = requestBody.messages.find((message) => message.role === 'user').content;
  assert.equal(systemContent, 'cover prompt');
  assert.doesNotMatch(userContent, /обычный человеческий отклик|Примеры стиля/);
  assert.match(userContent, /Java developer parsed from hh resume/);
  assert.equal(localData.resumeParsedText, 'Java developer parsed from hh resume');
  assert.equal(localData.resumeParsedUrl, 'https://ekaterinburg.hh.ru/resume/abc123');
  assert.equal(localData.resumeGroqBriefText, 'Java developer parsed from hh resume');
  assert.equal(localData.resumeGroqBriefVersion, 'resume-brief-v1');
  assert.ok(localData.resumeGroqBriefSourceHash);
  assert.equal(removedTabId, 41);
});

test('Groq resume cache TTL is configurable in hours', async () => {
  let listener = null;
  let requestBody = null;
  let createdTabs = 0;
  const now = Date.now();
  const localData = {
    groqApiKey: 'gsk_test',
    groqModel: 'test-model',
    resumeUrl: 'https://hh.ru/resume/abc123',
    resumeParsedText: 'stale cached resume text',
    resumeParsedAt: new Date(now - 30 * 60 * 1000).toISOString(),
    resumeCacheTtlHours: 0.25,
    expectedSalary: '',
    coverPrompt: 'cover prompt'
  };

  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return { choices: [{ message: { content: 'Письмо' } }] };
      }
    };
  };

  globalThis.location = { pathname: '/resume/abc123' };
  globalThis.document = {
    title: 'Java Developer resume',
    body: new FakeElement({ text: 'fresh resume text from hh' }),
    querySelector(selector) {
      if (selector === 'main') return new FakeElement({ text: 'fresh resume text from hh' });
      return null;
    }
  };

  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) {
          if (Array.isArray(keys)) {
            return Object.fromEntries(keys.map((key) => [key, localData[key]]));
          }
          return {};
        },
        async set(value) {
          Object.assign(localData, value);
        }
      }
    },
    runtime: {
      getURL(path) {
        return `chrome-extension://test/${path}`;
      },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: {
        addListener(fn) {
          listener = fn;
        }
      }
    },
    tabs: {
      async create() {
        createdTabs += 1;
        return { id: 41, status: 'complete' };
      },
      async get() {
        return { status: 'complete' };
      },
      async remove() {},
      onUpdated: {
        addListener() {},
        removeListener() {}
      }
    },
    scripting: {
      async executeScript({ func }) {
        return [{ result: await func() }];
      }
    }
  };

  await import(`${pathToFileURL(new URL('src/background.js', root).pathname).href}?t=${Date.now()}-${crypto.randomUUID()}`);

  const response = await new Promise((resolve) => {
    const stayedAsync = listener(
      {
        type: 'GENERATE_COVER_LETTER',
        task: 'cover_letter',
        vacancyText: 'Вакансия: Java developer'
      },
      {},
      resolve
    );
    assert.equal(stayedAsync, true);
  });

  assert.equal(response.ok, true);
  assert.equal(createdTabs, 1);
  assert.equal(localData.resumeParsedText, 'fresh resume text from hh');
  assert.equal(localData.resumeGroqBriefText, 'fresh resume text from hh');
  const userContent = requestBody.messages.find((message) => message.role === 'user').content;
  assert.match(userContent, /fresh resume text from hh/);
  assert.doesNotMatch(userContent, /stale cached resume text/);
});

test('[BS:COVERS:HHJA-BR-000011] Groq prompt rebuilds stale resume brief and keeps original parsed resume unchanged', async () => {
  let listener = null;
  let requestBody = null;
  const sourceResume = [
    'Java Team Lead',
    'Spring Boot, PostgreSQL, Kafka',
    'Опыт руководства backend-командой',
    'Лишняя длинная секция '.repeat(200)
  ].join('\n');
  const localData = {
    groqApiKey: 'gsk_test',
    groqModel: 'test-model',
    resumeUrl: 'https://hh.ru/resume/abc123',
    resumeParsedText: sourceResume,
    resumeParsedAt: new Date().toISOString(),
    resumeParsedUrl: 'https://hh.ru/resume/abc123',
    resumeCacheTtlHours: 1,
    resumeGroqBriefText: 'stale cached brief that should be replaced',
    resumeGroqBriefSourceHash: '',
    resumeGroqBriefBuiltAt: '',
    resumeGroqBriefVersion: 'resume-brief-v1',
    expectedSalary: '',
    coverPrompt: 'cover prompt'
  };

  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return { choices: [{ message: { content: 'Письмо' } }] };
      }
    };
  };

  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) {
          if (Array.isArray(keys)) {
            return Object.fromEntries(keys.map((key) => [key, localData[key]]));
          }
          return {};
        },
        async set(value) {
          Object.assign(localData, value);
        }
      }
    },
    runtime: {
      getURL(path) {
        return `chrome-extension://test/${path}`;
      },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: {
        addListener(fn) {
          listener = fn;
        }
      }
    },
    tabs: {
      async get() {
        return { status: 'complete' };
      }
    },
    scripting: {}
  };

  await import(`${pathToFileURL(new URL('src/background.js', root).pathname).href}?t=${Date.now()}-${crypto.randomUUID()}`);

  const response = await new Promise((resolve) => {
    const stayedAsync = listener(
      {
        type: 'GENERATE_COVER_LETTER',
        task: 'cover_letter',
        vacancyText: 'Вакансия: Java developer'
      },
      {},
      resolve
    );
    assert.equal(stayedAsync, true);
  });

  assert.equal(response.ok, true);
  assert.equal(localData.resumeParsedText, sourceResume);
  assert.equal(localData.resumeGroqBriefVersion, 'resume-brief-v1');
  assert.ok(localData.resumeGroqBriefText.length <= 1800);
  const userContent = requestBody.messages.find((message) => message.role === 'user').content;
  assert.match(userContent, /Java Team Lead/);
  assert.doesNotMatch(userContent, /stale cached brief/);
  assert.doesNotMatch(userContent, /Лишняя длинная секция .*Лишняя длинная секция/s);
});

test('[BS:COVERS:HHJA-BR-000013] resume profile build and edit store factual context without changing audit metadata', async () => {
  let listener = null;
  const requests = [];
  const localData = {
    groqApiKey: 'gsk_test',
    groqModel: 'test-model',
    resumeText: 'Tech Lead. Руководил командой 15 FTE, проводил найм, собеседования и онбординг инженеров.',
    resumeCandidateFacts: resumeCandidateFacts('Tech Lead. Руководил командой 15 FTE, проводил найм, собеседования и онбординг инженеров.'),
    resumeProfileText: '',
    resumeProfileWeaknesses: '',
    resumeProfileSourceHash: '',
    resumeProfileBuiltAt: '',
    resumeProfileCheckedAt: '',
    resumeProfileAutoRefreshEnabled: false,
    agentDebugLog: [],
    agentDebugLogsEnabled: true
  };
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    const editing = body.messages[0].content.includes('Отредактируй профиль');
    return {
      ok: true,
      async json() {
        return {
          choices: [{ finish_reason: 'stop', message: { content: editing
            ? JSON.stringify({ profile: 'Tech Lead: руководил командой 15 FTE; отвечал за найм, собеседования и онбординг инженеров.' })
            : JSON.stringify({
                profile: 'Tech Lead. Руководил командой из 15 FTE, проводил найм, собеседования и онбординг инженеров.',
                weaknesses: ['Не описаны performance review и измеримые результаты управления командой.']
              }) } }]
        };
      }
    };
  };
  globalThis.chrome = {
    storage: { local: {
      async get(keys) { return Object.fromEntries(keys.map((key) => [key, localData[key]])); },
      async set(value) { Object.assign(localData, value); }
    } },
    runtime: {
      getURL(path) { return `chrome-extension://test/${path}`; },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: { addListener(fn) { listener = fn; } }
    },
    tabs: {},
    scripting: {}
  };

  await import(`${pathToFileURL(new URL('src/background.js', root).pathname).href}?t=${Date.now()}-${crypto.randomUUID()}`);
  const send = (message) => new Promise((resolve) => {
    assert.equal(listener(message, {}, resolve), true);
  });

  const built = await send({ type: 'BUILD_RESUME_PROFILE' });
  assert.equal(built.ok, true);
  assert.match(localData.resumeProfileText, /15 FTE/);
  assert.match(localData.resumeProfileWeaknesses, /performance review/);
  assert.ok(localData.resumeProfileSourceHash);
  const sourceHash = localData.resumeProfileSourceHash;
  const weaknesses = localData.resumeProfileWeaknesses;

  const edited = await send({ type: 'EDIT_RESUME_PROFILE', comment: 'Убери любые мотивационные программы; подчеркни найм и онбординг.' });
  assert.equal(edited.ok, true);
  assert.match(localData.resumeProfileText, /найм, собеседования и онбординг/);
  assert.doesNotMatch(localData.resumeProfileText, /мотивационн/i);
  assert.equal(localData.resumeProfileWeaknesses, weaknesses);
  assert.equal(localData.resumeProfileSourceHash, sourceHash);
  assert.equal(requests.length, 2);
  assert.doesNotMatch(JSON.stringify(localData.agentDebugLog), /Tech Lead|мотивационн/);
});

test('resume profile invalid build preserves last good profile', async () => {
  let listener = null;
  const localData = {
    groqApiKey: 'gsk_test',
    groqModel: 'test-model',
    resumeText: 'Подробное резюме кандидата с подтвержденным опытом разработки и руководства командой.',
    resumeCandidateFacts: resumeCandidateFacts('Подробное резюме кандидата с подтвержденным опытом разработки и руководства командой.'),
    resumeProfileText: 'Последний рабочий профиль кандидата с подтвержденными фактами.',
    resumeProfileWeaknesses: '• Старый аудит',
    resumeProfileSourceHash: 'old-hash',
    resumeProfileBuiltAt: '2026-01-01T00:00:00.000Z',
    resumeProfileCheckedAt: '2026-01-01T00:00:00.000Z'
  };
  globalThis.fetch = async () => ({
    ok: true,
    async json() { return { choices: [{ finish_reason: 'stop', message: { content: '{invalid json' } }] }; }
  });
  globalThis.chrome = {
    storage: { local: {
      async get(keys) { return Object.fromEntries(keys.map((key) => [key, localData[key]])); },
      async set(value) { Object.assign(localData, value); }
    } },
    runtime: {
      getURL(path) { return `chrome-extension://test/${path}`; },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: { addListener(fn) { listener = fn; } }
    },
    tabs: {},
    scripting: {}
  };
  await import(`${pathToFileURL(new URL('src/background.js', root).pathname).href}?t=${Date.now()}-${crypto.randomUUID()}`);
  const response = await new Promise((resolve) => listener({ type: 'BUILD_RESUME_PROFILE' }, {}, resolve));
  assert.equal(response.ok, false);
  assert.equal(localData.resumeProfileText, 'Последний рабочий профиль кандидата с подтвержденными фактами.');
  assert.equal(localData.resumeProfileWeaknesses, '• Старый аудит');
  assert.equal(localData.resumeProfileSourceHash, 'old-hash');
});

test('resume profile double truncation keeps all last-good profile metadata and returns typed error', async () => {
  let listener = null;
  let requests = 0;
  const localData = {
    groqApiKey: 'gsk_test',
    groqModel: 'test-model',
    resumeText: 'Подробное резюме кандидата с подтвержденным опытом разработки и руководства командой.',
    resumeCandidateFacts: resumeCandidateFacts('Подробное резюме кандидата с подтвержденным опытом разработки и руководства командой.'),
    resumeProfileText: 'Последний рабочий профиль кандидата с подтвержденными фактами.',
    resumeProfileWeaknesses: '• Старый аудит',
    resumeProfileSourceHash: 'old-hash',
    resumeProfileBuiltAt: '2026-01-01T00:00:00.000Z',
    resumeProfileCheckedAt: '2026-01-01T00:00:00.000Z',
    agentDebugLog: [],
    agentDebugLogsEnabled: true
  };
  globalThis.fetch = async () => {
    requests += 1;
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          choices: [{ message: { content: '' }, finish_reason: 'length' }],
          usage: { completion_tokens: 100 }
        };
      }
    };
  };
  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) {
          if (Array.isArray(keys)) {
            return Object.fromEntries(keys.map((key) => [key, localData[key]]));
          }
          return {};
        },
        async set(value) {
          Object.assign(localData, value);
        }
      }
    },
    runtime: {
      getURL(path) {
        return `chrome-extension://test/${path}`;
      },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: { addListener(fn) { listener = fn; } }
    },
    tabs: {},
    scripting: {}
  };

  await import(`${pathToFileURL(new URL('src/background.js', root).pathname).href}?t=${Date.now()}-${crypto.randomUUID()}`);
  await startDebugRun('resume-profile-double-truncation-log');
  const response = await new Promise((resolve) => listener({ type: 'BUILD_RESUME_PROFILE' }, {}, resolve));
  assert.equal(response.ok, false);
  assert.equal(response.errorCode, 'HHJA_GROQ_PROFILE_INVALID_RESPONSE');
  assert.match(response.error, /Groq вернул пустой ответ/);
  assert.match(response.error, /попытки 2\/2/);
  assert.equal(requests, 2);
  assert.equal(localData.resumeProfileText, 'Последний рабочий профиль кандидата с подтвержденными фактами.');
  assert.equal(localData.resumeProfileWeaknesses, '• Старый аудит');
  assert.equal(localData.resumeProfileSourceHash, 'old-hash');
  assert.equal(localData.resumeProfileBuiltAt, '2026-01-01T00:00:00.000Z');
  assert.equal(localData.resumeProfileCheckedAt, '2026-01-01T00:00:00.000Z');
  const truncationErrors = debugEntries(localData).filter((entry) => entry.event === 'resume_profile_request_error');
  assert.equal(truncationErrors.length, 2);
  assert.equal(truncationErrors[0].details.attempt, 1);
  assert.equal(truncationErrors[1].details.attempt, 2);
  assert.equal(truncationErrors[1].details.maxTokens, 4000);
});

test('[BS:COVERS:HHJA-BR-000014] resume profile auto refresh is single-flight and never runs inside each application', async () => {
  let listener = null;
  let profileBuildCalls = 0;
  let profileAttempts = 0;
  let coverCalls = 0;
  const localData = {
    groqApiKey: 'gsk_test',
    groqModel: 'test-model',
    resumeText: 'Обновленное резюме Tech Lead: команда 15 FTE, найм, интервью и онбординг.',
    resumeCandidateFacts: resumeCandidateFacts('Обновленное резюме Tech Lead: команда 15 FTE, найм, интервью и онбординг.'),
    resumeProfileText: 'Старый профиль кандидата с достаточным количеством подтвержденных фактов.',
    resumeProfileWeaknesses: '• Старый аудит',
    resumeProfileSourceHash: 'stale-hash',
    resumeProfileBuiltAt: '2026-01-01T00:00:00.000Z',
    resumeProfileCheckedAt: '2026-01-01T00:00:00.000Z',
    resumeProfileAutoRefreshEnabled: true,
    resumeCacheTtlHours: 1,
    coverPrompt: 'unchanged cover prompt',
    employerQuestionPrompt: 'unchanged employer prompt',
    employmentPreference: [],
    workFormatPreference: []
  };
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.messages[0].content.includes('Преобразуй текст резюме')) {
      profileBuildCalls += 1;
      profileAttempts += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      if (profileAttempts === 1) {
        return {
          ok: true,
          async json() {
            return {
              choices: [{ finish_reason: 'length', message: { content: '' } }],
              usage: { reasoning_tokens: 99 }
            };
          }
        };
      }
      return {
        ok: true,
        async json() {
          return {
            choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
              profile: 'Tech Lead: руководил командой 15 FTE, проводил найм, интервью и онбординг инженеров.',
              weaknesses: []
            }) } }],
            usage: {}
          };
        }
      };
    }
    coverCalls += 1;
    return { ok: true, async json() { return { choices: [{ finish_reason: 'stop', message: { content: 'Откликаюсь на вакансию.' } }] }; } };
  };
  globalThis.chrome = {
    storage: { local: {
      async get(keys) { return Object.fromEntries(keys.map((key) => [key, localData[key]])); },
      async set(value) { Object.assign(localData, value); }
    } },
    runtime: {
      getURL(path) { return `chrome-extension://test/${path}`; },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: { addListener(fn) { listener = fn; } }
    },
    tabs: {},
    scripting: {}
  };
  await import(`${pathToFileURL(new URL('src/background.js', root).pathname).href}?t=${Date.now()}-${crypto.randomUUID()}`);
  const ensure = () => new Promise((resolve) => listener({ type: 'ENSURE_RESUME_PROFILE' }, {}, resolve));
  const send = () => new Promise((resolve) => listener({ type: 'GENERATE_COVER_LETTER', task: 'cover_letter', vacancyText: 'Java' }, {}, resolve));
  const refreshResponses = await Promise.all([ensure(), ensure()]);
  assert.equal(refreshResponses.every((item) => item.ok), true);
  const responses = await Promise.all([send(), send()]);
  assert.equal(responses.every((item) => item.ok), true);
  assert.equal(profileBuildCalls, 2);
  assert.equal(profileAttempts, 2);
  assert.equal(coverCalls, 2);
  assert.match(localData.resumeProfileText, /15 FTE/);

  localData.resumeProfileCheckedAt = '2026-01-01T00:00:00.000Z';
  const next = await send();
  assert.equal(next.ok, true);
  assert.equal(profileBuildCalls, 2);
  assert.equal(coverCalls, 3);
  assert.equal(localData.aiQuotaUsage.models['openai/gpt-oss-120b'].requests, 2);
  assert.equal(localData.aiQuotaUsage.models['openai/gpt-oss-20b'].requests, 3);
});

test('resume access denial at a resume URL preserves cached candidate data and never calls AI', async () => {
  let listener;
  let providerCalls = 0;
  let removedTabs = 0;
  let marker = 'resume-access-denied';
  const preserved = {
    resumeParsedText: 'Java developer, Spring Boot, PostgreSQL',
    resumeParsedAt: '2026-01-01T00:00:00.000Z',
    resumeParsedUrl: 'https://hh.ru/resume/example',
    resumeCandidateFacts: { age: 27, resumeHash: 'cached-source' },
    resumeProfileText: 'Existing verified candidate profile',
    resumeProfileSourceHash: 'cached-source',
    resumeProfileCheckedAt: '2026-01-01T00:00:00.000Z',
    resumeProfileBuiltAt: '2026-01-01T00:00:00.000Z',
    resumeGroqBriefText: 'Existing brief',
    resumeGroqBriefSourceHash: 'cached-source',
    resumeGroqBriefBuiltAt: '2026-01-01T00:00:00.000Z',
    resumeGroqBriefVersion: 'cached-version',
    expectedSalary: '250000'
  };
  const localData = {
    ...structuredClone(preserved),
    groqApiKey: 'gsk_test',
    resumeUrl: 'https://hh.ru/resume/example',
    resumeProfileAutoRefreshEnabled: true,
    resumeCacheTtlHours: 1
  };
  globalThis.fetch = async () => {
    providerCalls += 1;
    throw new Error('Access denial must not reach the AI provider');
  };
  globalThis.location = { pathname: '/resume/example' };
  const gate = new FakeElement({ text: 'Войдите или зарегистрируйтесь\nРезюме могут посмотреть только работодатели — после входа в личный кабинет\nВойти\nЗарегистрироваться' });
  globalThis.document = {
    title: 'hh.ru/resume/example',
    body: gate,
    querySelector(selector) {
      if (selector === 'main' || selector.split(',').some((part) => part.trim() === `[data-qa="${marker}"]`)) return gate;
      return null;
    },
    querySelectorAll() { return []; }
  };
  globalThis.chrome = {
    storage: { local: {
      async get(keys) { return Object.fromEntries(keys.map((key) => [key, localData[key]])); },
      async set(value) { Object.assign(localData, value); }
    } },
    runtime: {
      getURL(path) { return `chrome-extension://test/${path}`; },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: { addListener(fn) { listener = fn; } }
    },
    tabs: {
      async create({ url }) { return { id: 73, url, status: 'complete' }; },
      async get() { return { id: 73, status: 'complete' }; },
      async remove() { removedTabs += 1; },
      onUpdated: { addListener() {}, removeListener() {} }
    },
    scripting: { async executeScript({ func }) { return [{ result: await func() }]; } }
  };
  await import(`${pathToFileURL(new URL('src/background.js', root).pathname).href}?t=${crypto.randomUUID()}`);
  const send = (type) => new Promise((resolve) => listener({ type }, {}, resolve));
  for (const [index, value] of ['resume-access-denied', 'resume-access-denied-signin-button', 'resume-access-denied-signup-button'].entries()) {
    marker = value;
    if (index > 0) gate.innerText = 'Access unavailable: sign in to continue';
    await send('ENSURE_RESUME_PROFILE');
    assert.deepEqual(Object.fromEntries(Object.keys(preserved).map((key) => [key, localData[key]])), preserved);
    const built = await send('BUILD_RESUME_PROFILE');
    assert.equal(built.ok, false);
    assert.match(built.error, /Войдите в hh\.ru/);
    assert.equal(providerCalls, 0);
    assert.equal(removedTabs, (index + 1) * 2);
  }
});

test('[BS:COVERS:HHJA-BR-000012] resume profile auto refresh does not require HH to display exact age', async () => {
  let listener = null;
  let profileRequest = null;
  const resumeText = [
    'Tech Lead',
    '600 000 ₽ на руки',
    'Java 21, Kotlin, Spring Boot, PostgreSQL, Kafka',
    'Руководил двумя командами численностью 15 инженеров.',
    'Телеграм: t.me/example_candidate',
    'Формат работы: Удалённо, Гибрид'
  ].join('\n');
  const localData = {
    groqApiKey: 'gsk_test',
    resumeUrl: 'https://hh.ru/resume/abc123',
    resumeParsedText: '',
    resumeParsedAt: '',
    resumeParsedUrl: '',
    resumeCandidateFacts: null,
    resumeProfileText: '',
    resumeProfileSourceHash: '',
    resumeProfileCheckedAt: '',
    resumeProfileAutoRefreshEnabled: true,
    resumeCacheTtlHours: 1,
    expectedSalary: '500000',
    telegramUsername: '',
    employmentPreference: ['labor_contract'],
    workFormatPreference: ['remote', 'hybrid'],
    dailyLimit: 200,
    agentDebugLogsEnabled: true,
    agentDebugRetentionCount: 20
  };

  globalThis.fetch = async (_url, options) => {
    profileRequest = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return {
          choices: [{
            finish_reason: 'stop',
            message: {
              content: JSON.stringify({
                profile: 'Java/Kotlin Tech Lead: руководил двумя командами из 15 инженеров и развивал высоконагруженные backend-сервисы.',
                weaknesses: []
              })
            }
          }]
        };
      }
    };
  };
  globalThis.location = { pathname: '/resume/abc123' };
  globalThis.document = {
    title: 'Tech Lead resume',
    body: new FakeElement({ text: resumeText }),
    querySelector(selector) {
      if (selector === 'main') return new FakeElement({ text: resumeText });
      return null;
    },
    querySelectorAll() {
      return [];
    }
  };
  globalThis.chrome = {
    storage: { local: {
      async get(keys) { return Object.fromEntries(keys.map((key) => [key, localData[key]])); },
      async set(value) { Object.assign(localData, value); }
    } },
    runtime: {
      getURL(path) { return `chrome-extension://test/${path}`; },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: { addListener(fn) { listener = fn; } }
    },
    tabs: {
      async create({ url }) { return { id: 73, url, status: 'complete' }; },
      async get() { return { id: 73, status: 'complete' }; },
      async remove() {},
      onUpdated: { addListener() {}, removeListener() {} }
    },
    scripting: {
      async executeScript({ func }) { return [{ result: await func() }]; }
    }
  };

  await import(`${pathToFileURL(new URL('src/background.js', root).pathname).href}?t=${Date.now()}-${crypto.randomUUID()}`);
  const send = (message) => new Promise((resolve) => {
    assert.equal(listener(message, {}, resolve), true);
  });

  const refreshed = await send({ type: 'ENSURE_RESUME_PROFILE' });
  assert.equal(refreshed.ok, true);
  assert.equal(refreshed.profileAvailable, true);
  assert.match(localData.resumeProfileText, /Java\/Kotlin Tech Lead/);
  assert.equal(localData.resumeCandidateFacts, null);
  assert.equal(localData.expectedSalary, '600000');
  assert.equal(profileRequest.max_tokens, 2400);
  assert.match(profileRequest.messages[0].content, /не длиннее 6000 символов/);

  const manuallyBuilt = await send({ type: 'BUILD_RESUME_PROFILE' });
  assert.equal(manuallyBuilt.ok, true);
  assert.match(localData.resumeProfileText, /Java\/Kotlin Tech Lead/);
  assert.equal(localData.resumeCandidateFacts, null);

  delete localData.groqApiKey;
  localData.aiProvider = 'qwen';
  localData.aiProviderCredentials = { qwen: { apiKey: 'sk-qwen-test' } };
  localData.aiFallbackProvider = '';
  localData.aiFallbackToGroq = false;
  const audited = await send({ type: 'GET_AUTOMATION_SETTINGS_AUDIT' });
  assert.equal(audited.ok, true);
  assert.equal(audited.audit.checks.resumeProfileAvailable, true);
  assert.equal(audited.audit.checks.resumeProfileFresh, true);
  assert.equal(audited.audit.checks.contactConfigured, true);
  assert.equal(audited.audit.checks.expectedSalaryMatchesResume, true);
  assert.equal(audited.audit.checks.aiProviderKeyConfigured, true);
  assert.equal(audited.audit.checks.fallbackProviderReady, true);
  assert.equal(audited.audit.ready, true);

  localData.expectedSalary = '';
  localData.resumeParsedText = resumeText.replace('600 000 ₽ на руки\n', '');
  const auditedWithoutSalary = await send({ type: 'GET_AUTOMATION_SETTINGS_AUDIT' });
  assert.equal(auditedWithoutSalary.ok, true);
  assert.equal(auditedWithoutSalary.audit.checks.expectedSalaryConfigured, null);
  assert.equal(auditedWithoutSalary.audit.checks.expectedSalaryMatchesResume, null);
  assert.equal(auditedWithoutSalary.audit.ready, true);

  localData.dailyLimit = 2;
  const auditedWithBoundedLimit = await send({ type: 'GET_AUTOMATION_SETTINGS_AUDIT' });
  assert.equal(auditedWithBoundedLimit.ok, true);
  assert.equal(auditedWithBoundedLimit.audit.checks.dailyLimit200, true);
  assert.equal(auditedWithBoundedLimit.audit.ready, true);

  localData.aiFallbackProvider = 'groq';
  localData.aiFallbackToGroq = true;
  const fallbackAudit = await send({ type: 'GET_AUTOMATION_SETTINGS_AUDIT' });
  assert.equal(fallbackAudit.ok, true);
  assert.equal(fallbackAudit.audit.checks.fallbackProviderReady, false);
  assert.ok(fallbackAudit.audit.issues.includes('fallbackProviderReady'));
  assert.equal(fallbackAudit.audit.ready, false);

  localData.aiEnabled = false;
  localData.aiProviderCredentials = {};
  localData.resumeProfileText = '';
  localData.resumeProfileCheckedAt = '';
  const noAiAudit = await send({ type: 'GET_AUTOMATION_SETTINGS_AUDIT' });
  assert.equal(noAiAudit.ok, true);
  assert.equal(noAiAudit.audit.aiEnabled, false);
  assert.equal(noAiAudit.audit.checks.resumeProfileAvailable, true);
  assert.equal(noAiAudit.audit.checks.resumeProfileFresh, true);
  assert.equal(noAiAudit.audit.checks.resumeAutoRefreshEnabled, true);
  assert.equal(noAiAudit.audit.checks.aiProviderKeyConfigured, true);
  assert.equal(noAiAudit.audit.checks.fallbackProviderReady, true);
  assert.equal(noAiAudit.audit.issues.includes('resumeProfileAvailable'), false);
  assert.equal(noAiAudit.audit.issues.includes('resumeProfileFresh'), false);
  assert.equal(noAiAudit.audit.issues.includes('resumeAutoRefreshEnabled'), false);
  assert.equal(noAiAudit.audit.issues.includes('aiProviderKeyConfigured'), false);
  assert.equal(noAiAudit.audit.issues.includes('fallbackProviderReady'), false);

  localData.aiEnabled = true;
  const missingEnabledAiAudit = await send({ type: 'GET_AUTOMATION_SETTINGS_AUDIT' });
  assert.equal(missingEnabledAiAudit.audit.aiEnabled, true);
  assert.equal(missingEnabledAiAudit.audit.checks.aiProviderKeyConfigured, false);
  assert.ok(missingEnabledAiAudit.audit.issues.includes('aiProviderKeyConfigured'));
});

test('Groq prompt caps large payload components', async () => {
  let listener = null;
  let requestBody = null;
  const longResume = [
    'Java Team Lead',
    'Spring Boot PostgreSQL Kafka Kubernetes',
    ...Array.from({ length: 300 }, (_, index) => `Проект ${index}: разработка backend систем и автоматизация процессов`)
  ].join('\n');
  const longVacancy = Array.from({ length: 200 }, (_, index) => `Вакансия строка ${index}: Java Spring SQL Kafka`).join('\n');
  const questions = Array.from({ length: 20 }, (_, index) => ({
    id: `question-${index}`,
    kind: 'text',
    inputType: 'text',
    question: `Расскажите про опыт ${index} ${'x'.repeat(50)}`,
    options: []
  }));
  const localData = {
    groqApiKey: 'gsk_test',
    groqModel: 'test-model',
    resumeText: longResume,
    resumeCandidateFacts: resumeCandidateFacts(longResume.slice(0, 12000)),
    resumeProfileText: longResume,
    expectedSalary: '250000',
    telegramUsername: `@${'x'.repeat(300)}`,
    coverPrompt: 'cover prompt',
    agentDebugLog: [],
    agentDebugLogsEnabled: true
  };

  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        const sent = JSON.parse(requestBody.messages.find((message) => message.role === 'user').content);
        return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
          answers: sent.questions.map((question) => ({ id: question.id, answer: 'Ответ', selectedOptions: [] })),
          coverLetter: ''
        }) } }] };
      }
    };
  };

  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) {
          if (Array.isArray(keys)) {
            return Object.fromEntries(keys.map((key) => [key, localData[key]]));
          }
          return {};
        },
        async set(value) {
          Object.assign(localData, value);
        }
      }
    },
    runtime: {
      getURL(path) {
        return `chrome-extension://test/${path}`;
      },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: {
        addListener(fn) {
          listener = fn;
        }
      }
    },
    tabs: {
      async get() {
        return { status: 'complete' };
      }
    },
    scripting: {}
  };

  await import(`${pathToFileURL(new URL('src/background.js', root).pathname).href}?t=${Date.now()}-${crypto.randomUUID()}`);
  await startDebugRun('large-payload-log');

  const response = await new Promise((resolve) => {
    const stayedAsync = listener(
      {
        type: 'GENERATE_COVER_LETTER',
        task: 'test_assist',
        vacancyText: longVacancy,
        questions
      },
      {},
      resolve
    );
    assert.equal(stayedAsync, true);
  });

  assert.equal(response.ok, true, response.error);
  assert.ok(requestBody.max_tokens >= 700 && requestBody.max_tokens < 2048);
  assert.equal(requestBody.reasoning_effort, 'low');
  const inputBytes = new TextEncoder().encode(JSON.stringify({
    messages: requestBody.messages, response_format: requestBody.response_format
  })).length;
  assert.ok(Math.ceil(inputBytes / 3) + requestBody.max_tokens <= 8000);
  const groqPayloadLog = debugEntries(localData).find((entry) => entry.event === 'groq_request_payload');
  assert.ok(groqPayloadLog.details.componentLengths.resumeBrief <= 6000);
  assert.ok(requestBody.messages.filter((message) => message.role === 'system').some((message) => message.content.includes(`Telegram: @${'x'.repeat(199)}`)));
  assert.ok(groqPayloadLog.details.componentLengths.vacancy <= 2200);
  assert.equal(groqPayloadLog.details.componentLengths.extra, 0);
  assert.equal(JSON.parse(requestBody.messages.find((message) => message.role === 'user').content).questions.length, 20);
  assert.ok(requestBody.messages.reduce((sum, message) => sum + message.content.length, 0) < longResume.length + longVacancy.length + JSON.stringify(questions).length);
});

test('Groq 429 response stores cooldown from retry-after', async () => {
  let listener = null;
  let fetchCalls = 0;
  const localData = {
    groqApiKey: 'gsk_test',
    groqModel: 'test-model',
    resumeText: 'Java developer',
    expectedSalary: '',
    coverPrompt: 'cover prompt',
    agentDebugLog: [],
    agentDebugLogsEnabled: true
  };

  globalThis.fetch = async () => {
    fetchCalls += 1;
    return {
      ok: false,
      status: 429,
      headers: {
        get(name) {
          return String(name).toLowerCase() === 'retry-after' ? '2' : '';
        }
      },
      async text() {
        return 'rate limit';
      }
    };
  };

  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) {
          if (Array.isArray(keys)) {
            return Object.fromEntries(keys.map((key) => [key, localData[key]]));
          }
          return {};
        },
        async set(value) {
          Object.assign(localData, value);
        }
      }
    },
    runtime: {
      getURL(path) {
        return `chrome-extension://test/${path}`;
      },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: {
        addListener(fn) {
          listener = fn;
        }
      }
    },
    tabs: {
      async get() {
        return { status: 'complete' };
      }
    },
    scripting: {}
  };

  await import(`${pathToFileURL(new URL('src/background.js', root).pathname).href}?t=${Date.now()}-${crypto.randomUUID()}`);
  await startDebugRun('rate-limit-log');

  const response = await new Promise((resolve) => {
    const stayedAsync = listener(
      {
        type: 'GENERATE_COVER_LETTER',
        task: 'cover_letter',
        vacancyText: 'Вакансия: Java developer'
      },
      {},
      resolve
    );
    assert.equal(stayedAsync, true);
  });

  assert.equal(response.ok, false);
  assert.equal(fetchCalls, 1);
  assert.ok(Date.parse(localData.groqCooldownUntil) > Date.now());
  assert.ok(debugEntries(localData).some((entry) => entry.event === 'groq_rate_limit_cooldown'));
});

test('content script registers one message listener', async () => {
  const source = await readContentScriptSource();
  let listenerCount = 0;

  globalThis.chrome = {
    runtime: {
      onMessage: {
        addListener() {
          listenerCount += 1;
        }
      },
      sendMessage() {}
    },
    storage: {
      local: {
        async get() {
          return {};
        },
        async set() {}
      }
    }
  };

  await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

  assert.equal(listenerCount, 1);
  assert.match(source, /GET_CONTENT_STATUS/);
  assert.match(source, /authenticated: hasAuthenticatedHhSignal\(\)/);
  assert.match(source, /unsafe: isUnsafePage\(\)/);
  assert.match(source, /hh-job-assistant:start-auto-apply/);
  assert.match(source, /page_trigger_start_auto_apply/);
  assert.match(source, /event\?\.detail\?\.mode === 'dry' \? 'dry' : 'live'/);
  assert.match(source, /mode === 'live' && !await consumeTrustedAutoStartToken/);
  assert.match(source, /hhjaAutoStart/);
  assert.match(source, /hhjaLimit/);
  assert.match(source, /hhjaGroqModel/);
  assert.match(source, /hhjaReloadExtension/);
  assert.match(source, /RELOAD_EXTENSION/);
  assert.match(source, /url_trigger_reload_extension/);
  assert.match(source, /url_trigger_start/);
});

test('repo script opens hh reload URL for extension self reload', async () => {
  const js = await readFile(new URL('scripts/reload-extension.mjs', root), 'utf8');

  assert.match(js, /hhjaReloadExtension/);
  assert.match(js, /HHJA_CHROME_PROFILE/);
  assert.match(js, /--profile-directory/);
  assert.match(js, /https:\/\/hh\.ru\/\?hhjaReloadExtension=1/);
  assert.doesNotMatch(js, /chrome:\/\/extensions/);
});

test('repo script can smoke test extension in an isolated Chromium profile', async () => {
  const js = await readFile(new URL('scripts/chromium-extension-smoke.mjs', root), 'utf8');

  assert.match(js, /HHJA_CHROMIUM_PATH/);
  assert.match(js, /HHJA_CHROMIUM_USER_DATA_DIR/);
  assert.match(js, /mkdtemp/);
  assert.match(js, /--user-data-dir/);
  assert.match(js, /--load-extension/);
  assert.match(js, /--disable-extensions-except/);
  assert.match(js, /chrome\.runtime\.getManifest\(\)/);
  assert.match(js, /Target\.getTargets/);
  assert.doesNotMatch(js, /chrome:\/\/extensions/);
  assert.doesNotMatch(js, /profile-directory/);
});

test('repo script can run hh smoke in a persistent Chromium profile', async () => {
  const js = await readFile(new URL('scripts/chromium-hh-live-smoke.mjs', root), 'utf8');

  assert.match(js, /HHJA_CHROMIUM_USER_DATA_DIR/);
  assert.match(js, /\.hhja-chromium-profile/);
  assert.match(js, /--user-data-dir/);
  assert.match(js, /--load-extension/);
  assert.match(js, /HH_CHROME_CDP_URL/);
  assert.match(js, /hh-live-smoke\.mjs/);
  assert.match(js, /HHJA_CHROMIUM_KEEP_OPEN/);
  assert.match(js, /closePageTargets/);
  assert.match(js, /\/json\/list/);
  assert.match(js, /\/json\/close\//);
  assert.match(js, /'about:blank'/);
  assert.doesNotMatch(js, /\n\s*targetUrl\n\s*\]/);
  assert.doesNotMatch(js, /chrome:\/\/extensions/);
  assert.doesNotMatch(js, /profile-directory/);
});

test('repo script can sync hh auth cookies into the persistent Chromium profile', async () => {
  const packageJson = await readJson('package.json');
  const js = await readFile(new URL('scripts/sync-hh-auth-to-chromium.mjs', root), 'utf8');

  assert.equal(packageJson.scripts['sync:hh:auth'], 'node scripts/sync-hh-auth-to-chromium.mjs');
  assert.match(js, /HHJA_CHROME_COOKIE_PROFILE/);
  assert.match(js, /HHJA_CHROMIUM_USER_DATA_DIR/);
  assert.match(js, /\.hhja-chromium-profile/);
  assert.match(js, /host_key LIKE '%hh\.ru%'/);
  assert.match(js, /INSERT OR REPLACE INTO main\.cookies/);
  assert.match(js, /backupPath/);
  assert.match(js, /hh-auth-sync-last\.json/);
  assert.doesNotMatch(js, /console\.log\(.*encrypted_value/s);
});

test('repo script can configure the persistent Chromium extension storage', async () => {
  const packageJson = await readJson('package.json');
  const js = await readFile(new URL('scripts/chromium-configure-extension.mjs', root), 'utf8');

  assert.equal(packageJson.scripts['configure:hh:chromium'], 'node scripts/chromium-configure-extension.mjs');
  assert.match(js, /HHJA_ENV_FILE/);
  assert.match(js, /HHJA_GROQ_API_KEY/);
  assert.match(js, /GROQ_API_KEY/);
  assert.match(js, /HHJA_RESUME_URL/);
  assert.doesNotMatch(js, /HHJA_CHAT_/);
  assert.match(js, /chrome\.storage\.local\.set\(patch/);
  assert.match(js, /configuredKeys/);
  assert.match(js, /storedEvidence/);
  assert.match(js, /key === 'groqApiKey' \|\| key === 'aiProviderCredentials' \? Boolean/);
  assert.match(js, /HHJA_AI_PROVIDER/);
  assert.match(js, /HHJA_AI_API_KEY/);
  assert.doesNotMatch(js, /console\.log\(.*groqApiKey.*patch/s);
});

test('repo script can run popup-equivalent actions in the persistent Chromium profile', async () => {
  const packageJson = await readJson('package.json');
  const js = await readFile(new URL('scripts/chromium-run-action.mjs', root), 'utf8');

  assert.equal(packageJson.scripts['run:hh:chromium'], 'node scripts/chromium-run-action.mjs');
  assert.match(js, /HHJA_ACTION/);
  assert.match(js, /REFRESH_RESUMES_NOW/);
  assert.doesNotMatch(js, /START_CHAT_ASSIST/);
  assert.match(js, /TEST_GROQ/);
  assert.match(js, /discoverResumeUrl/);
  assert.match(js, /resume_hash/);
  assert.match(js, /\^\\\\\/resume\\\\\/\[\^\/\?#\]\+/);
  assert.match(js, /createExtensionPageSession/);
  assert.match(js, /src\/popup\.html/);
  assert.doesNotMatch(js, /waitForActiveContentScript/);
  assert.match(js, /chrome\.runtime\.sendMessage/);
  assert.doesNotMatch(js, /chatReports/);
  assert.match(js, /resumeUrlPresent/);
  assert.match(js, /process\.exit\(process\.exitCode \|\| 0\)/);
  assert.doesNotMatch(js, /chrome:\/\/extensions/);
});

test('repo script can start auto apply in a persistent Chromium profile', async () => {
  const js = await readFile(new URL('scripts/chromium-start-auto-apply.mjs', root), 'utf8');

  assert.match(js, /HHJA_CHROMIUM_USER_DATA_DIR/);
  assert.match(js, /\.hhja-chromium-profile/);
  assert.match(js, /--user-data-dir/);
  assert.match(js, /--load-extension/);
  assert.match(js, /hhjaAutoStart/);
  assert.match(js, /hhjaAutoStartToken/);
  assert.match(js, /autoApplyAutoStartToken/);
  assert.match(js, /HHJA_LIMIT/);
  assert.match(js, /HHJA_MAX_PROCESSED/);
  assert.match(js, /HHJA_CHROMIUM_RUN_MS/);
  assert.match(js, /HHJA_OUTPUT/);
  assert.match(js, /Math\.min\(Number\(process\.env\.HHJA_LIMIT \|\| 1\) \|\| 1, 200\)/);
  assert.match(js, /hhjaMaxProcessed/);
  assert.match(js, /chrome\.storage\.local\.get\(\['runState', 'runResults'\]/);
  assert.match(js, /readExtensionEvidence/);
  assert.match(js, /URL must be an hh\.ru vacancy search or response form page/);
  assert.doesNotMatch(js, /chrome:\/\/extensions/);
  assert.doesNotMatch(js, /profile-directory/);
});

test('repo script opens hh URL for manual extension auto apply start', async () => {
  const js = await readFile(new URL('scripts/start-extension-auto-apply.mjs', root), 'utf8');

  assert.doesNotMatch(js, /hhjaAutoStart/);
  assert.doesNotMatch(js, /execute targetTab javascript/);
  assert.match(js, /HHJA_CHROME_PROFILE/);
  assert.match(js, /Alt\+Shift\+A/);
  assert.match(js, /--profile-directory/);
  assert.match(js, /URL must be an hh\.ru vacancy search or response form page/);
});

test('extension log inspector reads Chrome profile storage', async () => {
  const packageJson = await readJson('package.json');
  const js = await readFile(new URL('scripts/inspect-extension-log.mjs', root), 'utf8');

  assert.equal(packageJson.scripts['inspect:logs'], 'node scripts/inspect-extension-log.mjs');
  assert.match(js, /Local Extension Settings/);
  assert.match(js, /run_result/);
  assert.match(js, /HHJA_EXTENSION_ID/);
  assert.match(js, /import\('classic-level'\)/);
  assert.match(js, /readExactStorageSnapshot/);
  assert.match(js, /STORAGE_READ_ATTEMPTS = 3/);
  assert.doesNotMatch(js, /extractJsonObjects|strings/);
  assert.match(js, /--file/);
  assert.match(js, /Invalid debug file JSON at line/);
  assert.match(js, /New submitted:/);
  assert.match(js, /Already applied:/);
  assert.match(js, /--private-audit-output/);
  assert.match(js, /mode: 0o600/);
  assert.match(js, /privateQuestionAuditRaw: rawAudit \|\| null/);
  assert.match(js, /result_count_mismatch/);
  assert.match(js, /private_audit_coverage_mismatch/);
});

test('repo script smoke tests Groq cover-letter output without logging secrets', async () => {
  const packageJson = await readJson('package.json');
  const js = await readFile(new URL('scripts/groq-cover-smoke.mjs', root), 'utf8');

  assert.equal(packageJson.scripts['smoke:groq-cover'], 'node scripts/groq-cover-smoke.mjs');
  assert.match(js, /import\('\.\.\/src\/ai-providers\.js'\)/);
  assert.match(js, /getTaskCapability\('groq', 'cover_letter'\)/);
  assert.match(js, /\.\.\.COVER_CAPABILITY\.requestExtras/);
  assert.doesNotMatch(js, /llama-3\.3-70b-versatile/);
  assert.match(js, /validateHumanShortCoverLetter/);
  assert.match(js, /соответствует требованиям/);
  assert.match(js, /HHJA_GROQ_PROXY/);
  assert.match(js, /Local Extension Settings/);
  assert.match(js, /key: \{ length: key\.length, suffix: key\.slice\(-4\) \}/);
  assert.doesNotMatch(js, /console\.log\([^)]*key/);
});

test('README describes purpose, features, and installation without config details', async () => {
  const readme = await readFile(new URL('README.md', root), 'utf8');
  const agents = await readFile(new URL('AGENTS.md', root), 'utf8');
  const checklist = await readFile(new URL('TEST_CHECKLIST_TEMPLATE.md', root), 'utf8');
  const background = await readFile(new URL('src/background.js', root), 'utf8');

  for (const fragment of [
    '# HH Job Assistant',
    '## Зачем нужно приложение',
    'Быстрее обрабатывать длинные списки вакансий.',
    '## Фичи',
    'Запуск откликов со страницы поиска вакансий hh.ru.',
    'Автоматическая подготовка сопроводительных писем.',
    'Подготовка ответов на вопросы работодателей',
    'Поднятие резюме на hh.ru.',
    'обезличенные диагностические логи последних запусков',
    'Скачать .debug',
    '## Как установить',
    'Загрузить распакованное расширение',
    'Войдите в hh.ru'
  ]) {
    assert.match(readme, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  for (const stale of [
    '[English]',
    'Предпросмотр',
    'Save key',
    'Test Groq',
    'Chat reports',
    'default `20`',
    'popup',
    'Reload',
    'fallback',
    'API keys',
    'cookies',
    '## Настройка',
    '## Сценарий кандидата',
    '## Безопасное поведение',
    '## Бизнес-функции',
    '## Границы продукта',
    '## Проверка и логи',
    'npm ',
    'agentDebugLog',
    'scripts/',
    'Модель Groq',
    'Дневной лимит',
    'Кэш резюме',
    'Промпт',
    '1500',
    '3000'
  ]) {
    assert.doesNotMatch(readme, new RegExp(stale.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  assert.match(agents, /Analyze extension logs from a user-provided `\.debug` file/);
  assert.match(agents, /inspect:logs -- --file <path>/);
  assert.match(agents, /agentDebugRunIndex/);
  assert.match(agents, /agentDebugActiveRunId/);
  assert.match(agents, /agentDebugRun:<runId>/);
  assert.match(agents, /authorized hh\.ru profile/);

  assert.doesNotMatch(checklist, /Logs\/debug section|Inspect Agent debug|debug clear|Agent debug shows/);
  assert.doesNotMatch(background, /RESET_AGENT_DEBUG_LOG|SYNC_AGENT_DEBUG_FILE/);
});

test('popup has ordered controls wired to Groq key, version, results, and actions', async () => {
  const html = await readFile(new URL('src/popup.html', root), 'utf8');
  const js = await readFile(new URL('src/popup.js', root), 'utf8');

  for (const id of ['appStatus', 'appStatusDot', 'appStatusTitle', 'appStatusDetail', 'currentAction', 'aiQuotaStatus', 'autoApply', 'continueApply', 'stop', 'refreshResumes', 'openOptions', 'version', 'applied', 'skipped', 'errors', 'recentResults']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /\.copy-button/);
  assert.match(html, /\.result\.copyable/);
  assert.match(html, /\.copy-toast/);
  assert.match(js, /navigator\.clipboard\.writeText/);
  assert.match(js, /data-copy-text/);
  assert.match(js, /Копировать ошибку/);
  assert.match(js, /node\.classList\.add\('copyable'\)/);
  assert.match(js, /node\.append\(copy, text\)/);
  assert.match(js, /showCopyToast\(button\)/);
  assert.match(js, /setTimeout\([^,]+,\s*1000\)/s);
  assert.match(js, /Скопировано/);
  assert.match(js, /nodes\.autoApply\.textContent = view\.buttons\.autoApplyLabel/);
  assert.match(js, /nodes\.continueApply\.disabled = view\.buttons\.continueDisabled/);
  assert.match(js, /async function stopRunNow\(\)/);
  assert.match(js, /chrome\.runtime\.sendMessage\(\{ type: 'STOP_RUN' \}\)/);
  assert.match(js, /if \(!response\?\.alreadyTerminal\)[\s\S]*sendToActiveTab\('STOP_RUN'\)/);
  assert.doesNotMatch(html, /id="copyStatus"|Копировать статус/);
  assert.doesNotMatch(js, /copyStatus|lastStatusCopyText/);
  for (const removedId of ['dryRun', 'groqApiKey', 'saveGroqKey', 'testGroq', 'extensionStatus', 'tabStatus', 'agentDebugLog', 'clearAgentDebugLog', 'currentActionDetail', 'chatAssist', 'chatReportsSection', 'chatReports', 'clearReports']) {
    assert.doesNotMatch(html, new RegExp(`id="${removedId}"`));
  }
  assert.match(html, /\.action-title\s*\{[^}]*font-size:\s*13px/s);
  assert.match(html, /html\s*\{[^}]*width:\s*380px[^}]*height:\s*600px[^}]*overflow:\s*hidden/s);
  assert.match(html, /body\s*\{[^}]*width:\s*380px[^}]*height:\s*600px[^}]*overflow-y:\s*auto/s);
  assert.doesNotMatch(html, /min-height:\s*(?:60[1-9]|6[1-9]\d|[7-9]\d\d|\d{4,})px/);
  assert.doesNotMatch(html, /Технический лог|Технических событий|debug-summary|Расширение выполняет задачу|action-detail/);
  assert.doesNotMatch(js, /GET_AGENT_DEBUG_LOG|CLEAR_AGENT_DEBUG_LOG|renderAgentDebugLog|agentDebugLog|debug-summary|currentActionDetail/);
  assert.doesNotMatch(html, /id="processed"|Обработано/);
  assert.doesNotMatch(js, /nodes\.processed/);
  assert.doesNotMatch(html, /id="found"|Найдено/);
  assert.doesNotMatch(js, /nodes\.found/);

  assert.ok(html.indexOf('id="autoApply"') < html.indexOf('id="stop"'));
  assert.ok(html.indexOf('id="autoApply"') < html.indexOf('id="continueApply"'));
  assert.ok(html.indexOf('id="continueApply"') < html.indexOf('id="stop"'));
  assert.ok(html.indexOf('id="stop"') < html.indexOf('id="refreshResumes"'));
  assert.ok(html.indexOf('id="openOptions"') < html.indexOf('id="appStatus"'));
  assert.ok(html.indexOf('id="currentAction"') < html.indexOf('id="autoApply"'));
  assert.ok(html.indexOf('id="errors"') < html.indexOf('id="recentResults"'));
  assert.match(html, /aria-label="Настройки">⚙<\/button>/);
  assert.doesNotMatch(html, /openWindow|Открыть окном|window-mode/);
  assert.doesNotMatch(js, /OPEN_ASSISTANT_WINDOW|openWindow/);
  assert.match(js, /openOptionsPage/);
  assert.match(js, /getManifest\(\)\.version/);
  assert.match(js, /skipped_missing_groq_key/);
  assert.match(js, /\^skipped/);
  assert.match(js, /item\.error/);
  assert.doesNotMatch(js, /Уже был отклик/);
  assert.match(js, /currentAction/);
  assert.match(js, /nodes\.aiQuotaStatus\.textContent = lastRunState\.aiQuotaStatus/);
  assert.match(js, /START_AUTO_APPLY/);
  assert.match(js, /CONTINUE_AUTO_APPLY/);
  assert.match(js, /GET_CONTENT_STATUS/);
  assert.doesNotMatch(js, /START_CHAT_ASSIST|GET_CHAT_REPORTS|CLEAR_CHAT_REPORTS|chatReports/);
  assert.match(js, /refreshPopup/);
  assert.match(js, /isAutoApplyStartUrl/);
  assert.match(js, /url\?\.protocol === 'https:'/);
  assert.match(js, /url\.hostname === 'hh\.ru' \|\| url\.hostname\.endsWith\('\.hh\.ru'\)/);
  assert.match(js, /url\.pathname === '\/search\/vacancy'/);
  assert.match(js, /url\.search\.length > 0/);
  assert.match(js, /url\.pathname === '\/applicant\/vacancy_response'/);
  assert.match(js, /url\.searchParams\.has\('vacancyId'\)/);
});

test('agent debug log keeps anonymized retained runs outside the popup without extra permissions', async () => {
  const js = await readFile(new URL('src/agent-log.js', root), 'utf8');
  const sanitizer = await readFile(new URL('src/log-sanitize.js', root), 'utf8');
  const background = await readFile(new URL('src/background.js', root), 'utf8');
  const content = await readFile(new URL('src/content-hh.js', root), 'utf8');
  const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));

  assert.match(js, /agentDebugRunIndex/);
  assert.match(js, /agentDebugActiveRunId/);
  assert.match(js, /agentDebugRun:/);
  assert.match(js, /agentDebugRetentionCount/);
  assert.match(js, /agentDebugLogsEnabled/);
  assert.match(js, /current\?\.\[ENABLED_KEY\] !== true/);
  assert.match(js, /function reset/);
  assert.match(js, /DEFAULT_RETENTION = 5/);
  assert.match(js, /MAX_RETENTION = 20/);
  assert.match(js, /redaction: 'anonymized'/);
  assert.match(js, /HHJA_LOG_SANITIZE/);
  assert.match(sanitizer, /SENSITIVE_DETAIL_KEYS/);
  assert.match(sanitizer, /sanitizeUrl/);
  assert.match(js, /buildDebugFile/);
  assert.match(js, /\.debug/);
  assert.match(js, /JSON\.stringify/);
  assert.match(background, /HHJobAssistantLog\?\.reset\?\./);
  assert.match(content, /HHJobAssistantLog\?\.reset\?\./);
  assert.ok(!manifest.permissions.includes('downloads'));
  assert.ok(!manifest.permissions.includes('offscreen'));
});

test('popup view model reports exact readiness and blocker text', async () => {
  const { derivePopupView } = await import(new URL('src/popup-view.js', root));

  assert.deepEqual(
    derivePopupView({
      runState: { state: 'idle' },
      tabState: { kind: 'ready', canStartAutoApply: true },
      aiProviderStatus: { provider: 'groq', configured: true }
    }).status,
    { tone: 'ok', title: 'ГОТОВО', detail: 'hh.ru открыт · Groq подключен' }
  );

  const withoutProviderKey = derivePopupView({
    runState: { state: 'idle' },
    tabState: { kind: 'ready', canStartAutoApply: true },
    aiProviderStatus: { provider: 'qwen', label: 'Qwen', configured: false, enabled: true }
  });
  assert.equal(withoutProviderKey.status.tone, 'warn');
  assert.equal(withoutProviderKey.status.title, 'НЕ НАСТРОЕНО');
  assert.equal(withoutProviderKey.status.detail, 'Укажите ключ Qwen API или выключите ИИ в настройках');

  const withoutAi = derivePopupView({
    runState: { state: 'idle' },
    tabState: { kind: 'ready', canStartAutoApply: true },
    aiProviderStatus: { provider: 'qwen', label: 'Qwen', configured: false, enabled: false }
  });
  assert.equal(withoutAi.status.tone, 'ok');
  assert.equal(withoutAi.status.title, 'ГОТОВО, ИИ выключен');
  assert.equal(withoutAi.status.detail, 'Письма — по шаблону · вакансии с вопросами пропускаются');
  assert.equal(withoutAi.buttons.autoApplyDisabled, false);
  assert.equal(withoutAi.buttons.refreshResumesDisabled, false);

  const wrongHhPage = derivePopupView({
    runState: { state: 'idle' },
    tabState: { kind: 'ready', canStartAutoApply: false },
    hasGroqKey: true
  });
  assert.deepEqual(wrongHhPage.status, {
    tone: 'warn',
    title: 'Откройте поиск или форму отклика',
    detail: 'Запуск откликов доступен со страницы поиска вакансий или формы отклика HH'
  });
  assert.equal(wrongHhPage.buttons.autoApplyDisabled, true);
  assert.equal(wrongHhPage.buttons.stopDisabled, true);

  const runningOffSearchPage = derivePopupView({
    runState: { state: 'idle' },
    tabState: { kind: 'ready', canStartAutoApply: false, autoApplyInProgress: true },
    hasGroqKey: true
  });
  assert.deepEqual(runningOffSearchPage.status, {
    tone: 'ok',
    title: 'Отправка откликов',
    detail: 'Отклики запущены'
  });
  assert.equal(runningOffSearchPage.buttons.autoApplyDisabled, true);
  assert.equal(runningOffSearchPage.buttons.stopDisabled, false);

  assert.equal(
    derivePopupView({
      runState: { state: 'idle' },
      tabState: { kind: 'not_hh' },
      hasGroqKey: true
    }).status.title,
    'Откройте hh.ru'
  );

  assert.equal(
    derivePopupView({
      runState: { state: 'error', lastError: 'hh.ru показал captcha' },
      tabState: { kind: 'ready', canStartAutoApply: true },
      hasGroqKey: true
    }).status.title,
    'Ошибка: hh.ru показал captcha'
  );

  const chromeTransportError = derivePopupView({
    runState: {
      state: 'error',
      lastError: 'Could not establish connection. Receiving end does not exist.'
    },
    tabState: { kind: 'ready', canStartAutoApply: true },
    hasGroqKey: true
  });
  assert.equal(chromeTransportError.status.title, 'Ошибка: Нет связи с вкладкой hh.ru. Обновите страницу и повторите действие.');
  assert.doesNotMatch(chromeTransportError.status.title, /Could not establish connection|Receiving end/i);

  const activeWithStaleAuthError = derivePopupView({
    runState: {
      state: 'applying',
      currentAction: 'Откликаюсь на: Java Developer',
      lastError: 'Требуется авторизация HH. Войдите на hh.ru перед использованием HH Job Assistant.'
    },
    tabState: { kind: 'ready', canStartAutoApply: true },
    hasGroqKey: true
  });
  assert.deepEqual(activeWithStaleAuthError.status, {
    tone: 'ok',
    title: 'Отправка откликов',
    detail: 'Откликаюсь на: Java Developer'
  });
});

test('popup waits for background initialization before reading readiness storage', async () => {
  const source = await readFile(new URL('src/popup.js', root), 'utf8');
  const refreshBody = source.slice(
    source.indexOf('async function refreshPopup()'),
    source.indexOf('async function sendToActiveTab')
  );

  const runtimeRead = refreshBody.indexOf('await readRuntimeState()');
  const storageRead = refreshBody.indexOf('await chrome.storage.local.get');
  assert.ok(runtimeRead >= 0);
  assert.ok(storageRead > runtimeRead);
  assert.doesNotMatch(refreshBody, /Promise\.all/);
});

test('popup view model disables start and enables stop only during active runs', async () => {
  const { derivePopupView } = await import(new URL('src/popup-view.js', root));

  const active = derivePopupView({
    runState: {
      state: 'generating_cover_letter',
      currentAction: 'Составляем сопроводительное письмо'
    },
    tabState: { kind: 'ready', canStartAutoApply: true },
    hasGroqKey: true
  });
  assert.equal(active.currentAction.title, 'Составляем сопроводительное письмо');
  assert.equal(Object.hasOwn(active.currentAction, 'detail'), false);
  assert.equal(active.buttons.autoApplyDisabled, true);
  assert.equal(active.buttons.continueDisabled, true);
  assert.equal(active.buttons.stopDisabled, false);

  const idle = derivePopupView({
    runState: { state: 'idle' },
    tabState: { kind: 'ready', canStartAutoApply: true },
    hasGroqKey: true
  });
  assert.equal(idle.currentAction.title, 'Ожидание');
  assert.equal(idle.buttons.autoApplyDisabled, false);
  assert.equal(idle.buttons.autoApplyLabel, 'Запуск откликов');
  assert.equal(idle.buttons.continueDisabled, true);
  assert.equal(idle.buttons.stopDisabled, true);
});

test('popup view model exposes restart and continue controls after pause', async () => {
  const { derivePopupView } = await import(new URL('src/popup-view.js', root));

  const paused = derivePopupView({
    runState: { state: 'paused' },
    tabState: { kind: 'ready', canStartAutoApply: true, canContinueAutoApply: true },
    hasGroqKey: true
  });
  assert.equal(paused.buttons.autoApplyLabel, 'Запуск');
  assert.equal(paused.buttons.autoApplyDisabled, false);
  assert.equal(paused.buttons.continueDisabled, false);
  assert.equal(paused.buttons.stopDisabled, true);
  assert.equal(paused.buttons.continueTitle, 'Продолжить сохраненный запуск откликов');

  const stopped = derivePopupView({
    runState: { state: 'stopped' },
    tabState: { kind: 'ready', canStartAutoApply: true, canContinueAutoApply: false },
    hasGroqKey: true
  });
  assert.equal(stopped.buttons.autoApplyLabel, 'Запуск');
  assert.equal(stopped.buttons.continueDisabled, true);
  assert.equal(stopped.buttons.continueTitle, 'Нет сохраненного запуска для продолжения');
});

test('popup buttons expose disabled-state reasons', async () => {
  const { derivePopupView } = await import(new URL('src/popup-view.js', root));

  const wrongHhPage = derivePopupView({
    runState: { state: 'idle' },
    tabState: { kind: 'ready', canStartAutoApply: false },
    hasGroqKey: true
  });
  assert.equal(wrongHhPage.buttons.autoApplyTitle, 'Откройте поиск вакансий или форму отклика HH');
  assert.equal(wrongHhPage.buttons.continueTitle, 'Нет сохраненного запуска для продолжения');
  assert.equal(wrongHhPage.buttons.stopTitle, 'Нет активного запуска');

  const active = derivePopupView({
    runState: { state: 'applying' },
    tabState: { kind: 'ready', canStartAutoApply: true },
    hasGroqKey: true
  });
  assert.equal(active.buttons.autoApplyTitle, 'Дождитесь завершения текущего запуска');
  assert.equal(active.buttons.continueTitle, 'Сначала остановите или дождитесь завершения текущего запуска');
  assert.equal(active.buttons.stopTitle, 'Остановить текущий запуск');
});

test('hh page scroll helpers avoid forcing targets to viewport center', async () => {
  const content = await readFile(new URL('src/content-hh.js', root), 'utf8');
  const background = await readFile(new URL('src/background.js', root), 'utf8');

  assert.doesNotMatch(content, /scrollIntoView/);
  assert.doesNotMatch(content, /scrollIntoView\(\{\s*block: 'center'/);
  assert.doesNotMatch(background, /scrollIntoView\?\.\(\{\s*block: 'center'/);
});

test('hh country warning confirmation uses short follow-up timing', async () => {
  const content = await readFile(new URL('src/content-hh.js', root), 'utf8');

  assert.match(content, /FOLLOWUP_CONFIRM_CLICK_DELAY_MIN_MS = 120/);
  assert.match(content, /FOLLOWUP_CONFIRM_CLICK_DELAY_MAX_MS = 300/);
  assert.match(content, /FOLLOWUP_CONFIRM_SETTLE_MS = 300/);
  assert.match(content, /waitBeforeClick\(FOLLOWUP_CONFIRM_CLICK_DELAY_MIN_MS, FOLLOWUP_CONFIRM_CLICK_DELAY_MAX_MS\)/);
  assert.doesNotMatch(content, /sleep\(window\.__HH_JOB_ASSISTANT_TEST_FAST_CLICKS__ \? 0 : 1800\)/);
});

test('content script can clear stale auto-apply queues from URL guard', async () => {
  const content = await readFile(new URL('src/content-hh.js', root), 'utf8');

  assert.match(content, /hhjaStopRun/);
  assert.match(content, /url_trigger_stop_run/);
  assert.match(content, /stale_search_queue_cleared/);
  assert.match(content, /\['complete', 'dry_run_complete', 'stopped', 'idle', 'error'\]\.includes\(runState\?\.state\)/);
});

test('trusted page shortcut shares a single-flight live start guard', async () => {
  const content = await readFile(new URL('src/content-hh.js', root), 'utf8');

  assert.match(content, /event\?\.isTrusted === true/);
  assert.match(content, /event\?\.altKey === true/);
  assert.match(content, /event\?\.shiftKey === true/);
  assert.match(content, /addEventListener\?\.\('keydown', handleTrustedAutoApplyShortcut, true\)/);
  assert.match(content, /startRunSingleFlight\('live', null, \{ entrySource: 'shortcut' \}\)/);
  assert.match(content, /queueStatus\.canContinueAutoApply/);
  assert.match(content, /continueRunSingleFlight\(\{ entrySource: 'shortcut' \}\)/);
  assert.match(content, /trusted_shortcut_continue/);
  assert.match(content, /start_run_duplicate_ignored/);
});

test('[BS:COVERS:HHJA-BR-000004][BS:COVERS:HHJA-BR-000005][BS:COVERS:HHJA-BR-000037] options preserve generic credential drafts and selected fallback provider', async () => {
  const source = await readFile(new URL('src/options.js', root), 'utf8');
  const providersSource = await readFile(new URL('src/ai-providers.js', root), 'utf8');
  vm.runInThisContext(providersSource);
  const handlers = new Map();
  const storage = {
    aiEnabled: true,
    aiProvider: 'qwen',
    aiFallbackProvider: 'groq',
    aiFallbackToGroq: true,
    aiProviderCredentials: {
      qwen: { apiKey: 'sk_qwen_saved' },
      groq: { apiKey: 'gsk_saved' }
    },
    groqApiKey: 'gsk_saved',
    groqModel: 'llama-3.3-70b-versatile',
    fallbackCoverLetterTemplate: 'Мой локальный шаблон.',
    resumeUrl: '',
    resumeCacheTtlHours: 1,
    resumeProfileText: '',
    resumeProfileWeaknesses: '',
    resumeProfileAutoRefreshEnabled: false,
    expectedSalary: '',
    telegramUsername: '',
    employmentPreference: '',
    workFormatPreference: '',
    coverPrompt: '   ',
    employerQuestionPrompt: null,
    choiceRetryPrompt: '',
    dailyLimit: 100,
    delayMinMs: 4000,
    delayMaxMs: 8000,
    scheduledAutoApplyEnabled: true,
    scheduledAutoApplyTimeMsk: '11:25',
    scheduledAutoApplyLateWindowMinutes: 35,
    scheduledAutoApplyFilterUrl: 'https://hh.ru/search/vacancy?text=loaded&excluded_text=QA%2CAQA&experience=moreThan6',
    scheduledAutoApplyMaxRepairAttempts: 2,
    scheduledAutoApplyRepairCutoffMsk: '17:45',
    agentDebugLogsEnabled: false,
    agentDebugRetentionCount: 5
  };

  function makeElement(id) {
    const inputsById = {
      employmentPreference: [
        { value: 'individual_entrepreneur', checked: false, type: 'checkbox' },
        { value: 'labor_contract', checked: false, type: 'checkbox' }
      ],
      workFormatPreference: [
        { value: 'remote', checked: false, type: 'checkbox' },
        { value: 'hybrid', checked: false, type: 'checkbox' },
        { value: 'office', checked: false, type: 'checkbox' }
      ]
    };
    const element = {
      id,
      value: '',
      checked: false,
      inputs: inputsById[id] || [],
      dataset: {},
      style: {},
      textContent: '',
      disabled: false,
      children: [],
      querySelectorAll(selector) {
        return selector === 'input[type="checkbox"]' ? this.inputs : [];
      },
      replaceChildren(...children) {
        this.children = children;
      },
      setCustomValidity(value) {
        this.validationMessage = value;
      },
      reportValidity() {
        this.reported = true;
        return !this.validationMessage;
      },
      addEventListener(type, fn) {
        handlers.set(`${id}:${type}`, fn);
      }
    };
    return element;
  }

  const ids = ['aiEnabled', 'aiProvider', 'credentialProvider', 'aiProviderApiKey', 'aiFallbackProvider', 'aiFallbackSection', 'fallbackCoverLetterTemplate', 'aiProviderModel', 'aiProviderApiKeyLabel', 'aiProviderCredentialHint', 'configuredProviders', 'resumeUrl', 'resumeCacheTtlHours', 'resumeProfileText', 'resumeProfileEditComment', 'resumeProfileAutoRefreshEnabled', 'resumeProfileWeaknesses', 'resumeProfileStatus', 'buildResumeProfile', 'editResumeProfile', 'expectedSalary', 'telegramUsername', 'employmentPreference', 'workFormatPreference', 'coverPrompt', 'employerQuestionPrompt', 'dailyLimit', 'delayMinMs', 'delayMaxMs', 'scheduledAutoApplyEnabled', 'scheduledAutoApplyTimeMsk', 'scheduledAutoApplyLateWindowMinutes', 'scheduledAutoApplyFilterUrl', 'scheduledAutoApplyMaxRepairAttempts', 'scheduledAutoApplyRepairCutoffMsk', 'agentDebugLogsEnabled', 'agentDebugRetentionCount', 'agentDebugRunSelect', 'downloadAgentDebugRun', 'agentDebugStatus', 'status', 'aiProviderStatus', 'save', 'saveProviderCredential', 'deleteProviderCredential', 'testAiProvider'];
  const elements = Object.fromEntries(ids.map((id) => [id, makeElement(id)]));
  let groqKeySeenByTest = null;
  let delayedProviderTestResolver = null;
  let delayNextProviderTest = false;
  let debugRuns = [];
  let storageSetCalls = 0;
  const downloadedRunIds = [];
  const createdLinks = [];

  globalThis.HHJA_DEFAULTS = {
    aiEnabled: true,
    aiProvider: 'qwen',
    aiFallbackProvider: '',
    aiFallbackToGroq: false,
    aiProviderCredentials: {},
    groqModel: 'llama-3.3-70b-versatile',
    fallbackCoverLetterTemplate: 'default local template',
    resumeText: '',
    resumeUrl: '',
    resumeParsedText: '',
    resumeParsedAt: '',
    resumeParsedUrl: '',
    resumeCacheTtlHours: 1,
    resumeProfileText: '',
    resumeProfileWeaknesses: '',
    resumeProfileAutoRefreshEnabled: false,
    expectedSalary: '',
    telegramUsername: '',
    employmentPreference: [],
    workFormatPreference: [],
    coverPrompt: 'default prompt',
    employerQuestionPrompt: 'default employer prompt',
    choiceRetryPrompt: 'default choice prompt',
    dailyLimit: 100,
    delayMinMs: 4000,
    delayMaxMs: 8000,
    scheduledAutoApplyEnabled: false,
    scheduledAutoApplyTimeMsk: '10:40',
    scheduledAutoApplyLateWindowMinutes: 120,
    scheduledAutoApplyFilterUrl: '',
    scheduledAutoApplyMaxRepairAttempts: 3,
    scheduledAutoApplyRepairCutoffMsk: '18:00',
    agentDebugLogsEnabled: false,
    agentDebugRetentionCount: 5,
    runState: {},
    autoApplyStopRequested: false,
    autoApplyStopRequestedAt: '',
    autoApplyStopBeforeSubmit: null,
    runResults: []
  };
  globalThis.HHJA_LOCALIZE_ERROR = (error, fallback) => fallback || String(error);
  globalThis.document = {
    getElementById(id) {
      return elements[id] || null;
    },
    createElement(tagName) {
      const element = makeElement(tagName);
      element.click = () => { element.clicked = true; };
      element.remove = () => { element.removed = true; };
      if (tagName === 'a') createdLinks.push(element);
      return element;
    },
    body: {
      append() {}
    }
  };
  globalThis.HHJobAssistantLog = {
    normalizeRetention(value) {
      return Math.max(1, Math.min(Number.parseInt(value, 10) || 5, 20));
    },
    async listRuns() {
      return debugRuns;
    },
    async trimHistory() {},
    async clearHistory() {},
    async getArtifact(runId) {
      downloadedRunIds.push(runId);
      return {
        available: true,
        name: `${runId}.debug`,
        text: `${JSON.stringify({ event: 'debug_file_created', details: { formatVersion: 2, runId } })}\n`
      };
    }
  };
  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) {
          if (Array.isArray(keys)) {
            return Object.fromEntries(keys.map((key) => [key, storage[key]]));
          }
          return {};
        },
        async set(value) {
          storageSetCalls += 1;
          Object.assign(storage, value);
        },
        async remove(keys) {
          for (const key of keys) {
            delete storage[key];
          }
        }
      }
    },
    runtime: {
      async sendMessage(message) {
        if (message?.type === 'TEST_AI_PROVIDER') {
          groqKeySeenByTest = message.apiKey ||
            storage.aiProviderCredentials?.[message.providerId]?.apiKey ||
            null;
          if (delayNextProviderTest) {
            delayNextProviderTest = false;
            return new Promise((resolve) => {
              delayedProviderTestResolver = () => resolve({
                ok: true,
                provider: message.providerId,
                sampleLength: 2
              });
            });
          }
        }
        return { ok: true, provider: message.providerId, sampleLength: 2 };
      }
    }
  };

  try {
    await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#options-${crypto.randomUUID()}`);
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(elements.coverPrompt.value, 'default prompt');
    assert.equal(elements.employerQuestionPrompt.value, 'default employer prompt');
    assert.equal(elements.aiEnabled.checked, true);
    assert.equal(elements.fallbackCoverLetterTemplate.value, 'Мой локальный шаблон.');
    assert.equal(elements.credentialProvider.value, 'qwen');
    assert.equal(elements.aiProviderApiKey.value, '********');
    assert.equal(elements.aiFallbackProvider.value, 'groq');
    assert.match(elements.configuredProviders.textContent, /Qwen — настроен/);
    assert.match(elements.configuredProviders.textContent, /Groq — настроен/);
    assert.doesNotMatch(elements.configuredProviders.textContent, /sk_qwen_saved|gsk_saved/);
    assert.deepEqual(elements.aiFallbackProvider.children.map((option) => option.value), ['', 'groq']);
    assert.equal(elements.aiFallbackSection.hidden, false);
    assert.equal(elements.scheduledAutoApplyEnabled.checked, true);
    assert.equal(elements.scheduledAutoApplyTimeMsk.value, '11:25');
    assert.equal(elements.scheduledAutoApplyLateWindowMinutes.value, 35);
    assert.equal(
      elements.scheduledAutoApplyFilterUrl.value,
      'https://hh.ru/search/vacancy?text=loaded&excluded_text=QA%2CAQA&experience=moreThan6'
    );
    assert.equal(elements.scheduledAutoApplyMaxRepairAttempts.value, 2);
    assert.equal(elements.scheduledAutoApplyRepairCutoffMsk.value, '17:45');

    const writesBeforeInvalidSchedule = storageSetCalls;
    elements.scheduledAutoApplyEnabled.checked = true;
    elements.scheduledAutoApplyFilterUrl.value = '';
    handlers.get('save:click')();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(storageSetCalls, writesBeforeInvalidSchedule);
    assert.equal(elements.scheduledAutoApplyFilterUrl.reported, true);
    assert.match(elements.scheduledAutoApplyFilterUrl.validationMessage, /укажите ссылку поиска HH/i);

    elements.scheduledAutoApplyFilterUrl.reported = false;
    elements.scheduledAutoApplyFilterUrl.value = 'https://evil.example/search/vacancy?text=java';
    handlers.get('save:click')();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(storageSetCalls, writesBeforeInvalidSchedule);
    assert.equal(elements.scheduledAutoApplyFilterUrl.reported, true);
    assert.match(elements.scheduledAutoApplyFilterUrl.validationMessage, /укажите ссылку поиска HH/i);

    const opaqueScheduledFilter = 'https://hh.ru/search/vacancy?text=opaque&excluded_text=QA%2CAQA&experience=between3And6&experience=moreThan6';
    elements.scheduledAutoApplyFilterUrl.value = opaqueScheduledFilter;
    elements.scheduledAutoApplyTimeMsk.value = '10:40';
    elements.scheduledAutoApplyLateWindowMinutes.value = '0';
    elements.scheduledAutoApplyMaxRepairAttempts.value = '3';
    elements.scheduledAutoApplyRepairCutoffMsk.value = '18:00';
    handlers.get('save:click')();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(storage.scheduledAutoApplyEnabled, true);
    assert.equal(storage.scheduledAutoApplyFilterUrl, opaqueScheduledFilter);
    assert.equal(storage.scheduledAutoApplyTimeMsk, '10:40');
    assert.equal(storage.scheduledAutoApplyLateWindowMinutes, 0);
    assert.equal(storage.scheduledAutoApplyMaxRepairAttempts, 3);
    assert.equal(storage.scheduledAutoApplyRepairCutoffMsk, '18:00');

    elements.credentialProvider.value = 'groq';
    handlers.get('credentialProvider:change')();
    await handlers.get('testAiProvider:click')();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(storage.groqApiKey, 'gsk_saved');
    assert.equal(groqKeySeenByTest, 'gsk_saved');

    handlers.get('aiProviderApiKey:focus')();
    await handlers.get('save:click')();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(storage.groqApiKey, 'gsk_saved');
    assert.equal(storage.dailyLimit, 100);
    assert.equal(storage.telegramUsername, '');
    assert.deepEqual(storage.employmentPreference, []);
    assert.deepEqual(storage.workFormatPreference, []);
    assert.equal(storage.coverPrompt, 'default prompt');
    assert.equal(storage.employerQuestionPrompt, 'default employer prompt');
    assert.equal(elements.agentDebugRetentionCount.value, 5);
    assert.equal(elements.agentDebugRunSelect.disabled, true);
    assert.equal(elements.downloadAgentDebugRun.disabled, true);

    elements.dailyLimit.value = '250';
    elements.resumeCacheTtlHours.value = '999';
    elements.delayMinMs.value = '900';
    elements.delayMaxMs.value = '600';
    elements.scheduledAutoApplyLateWindowMinutes.value = '0';
    elements.agentDebugRetentionCount.value = '99';
    await handlers.get('save:click')();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(storage.dailyLimit, 200);
    assert.equal(storage.resumeCacheTtlHours, 168);
    assert.equal(storage.delayMinMs, 900);
    assert.equal(storage.delayMaxMs, 900);
    assert.equal(storage.scheduledAutoApplyLateWindowMinutes, 0);
    assert.equal(storage.agentDebugRetentionCount, 20);

    elements.employmentPreference.inputs[1].checked = true;
    elements.workFormatPreference.inputs[0].checked = true;
    elements.workFormatPreference.inputs[1].checked = true;
    elements.employerQuestionPrompt.value = 'custom employer prompt';
    elements.telegramUsername.value = '@candidate_tg';
    await handlers.get('save:click')();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(storage.employmentPreference, ['labor_contract']);
    assert.deepEqual(storage.workFormatPreference, ['remote', 'hybrid']);
    assert.equal(storage.employerQuestionPrompt, 'custom employer prompt');
    assert.equal(storage.telegramUsername, '@candidate_tg');

    elements.credentialProvider.value = 'qwen';
    handlers.get('credentialProvider:change')();
    handlers.get('aiProviderApiKey:focus')();
    elements.aiProviderApiKey.value = 'sk_qwen_new';
    handlers.get('aiProviderApiKey:input')();
    elements.credentialProvider.value = 'groq';
    handlers.get('credentialProvider:change')();
    handlers.get('aiProviderApiKey:focus')();
    elements.aiProviderApiKey.value = 'gsk_new';
    handlers.get('aiProviderApiKey:input')();
    elements.credentialProvider.value = 'qwen';
    handlers.get('credentialProvider:change')();
    assert.equal(elements.aiProviderApiKey.value, 'sk_qwen_new');
    elements.credentialProvider.value = 'groq';
    handlers.get('credentialProvider:change')();
    assert.equal(elements.aiProviderApiKey.value, 'gsk_new');
    await handlers.get('saveProviderCredential:click')();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(storage.groqApiKey, 'gsk_new');
    assert.equal(storage.aiProviderCredentials.qwen.apiKey, 'sk_qwen_saved');
    assert.equal(elements.aiProviderApiKey.value, '********');

    elements.credentialProvider.value = 'qwen';
    handlers.get('credentialProvider:change')();
    await handlers.get('saveProviderCredential:click')();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(storage.aiProviderCredentials.qwen.apiKey, 'sk_qwen_new');
    assert.equal(storage.aiProviderCredentials.groq.apiKey, 'gsk_new');

    elements.credentialProvider.value = 'groq';
    handlers.get('credentialProvider:change')();
    await handlers.get('deleteProviderCredential:click')();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(storage.groqApiKey, '');
    assert.equal(storage.aiProviderCredentials.qwen.apiKey, 'sk_qwen_new');
    assert.equal(storage.aiProviderCredentials.groq, undefined);
    assert.equal(storage.aiFallbackProvider, '');
    assert.equal(elements.aiFallbackProvider.value, '');
    assert.deepEqual(elements.aiFallbackProvider.children.map((option) => option.value), ['']);

    elements.credentialProvider.value = 'groq';
    handlers.get('credentialProvider:change')();
    elements.aiProviderApiKey.value = '  gsk_test_before_save  ';
    handlers.get('aiProviderApiKey:input')();
    await handlers.get('testAiProvider:click')();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(storage.groqApiKey, '');
    assert.equal(groqKeySeenByTest, 'gsk_test_before_save');
    assert.equal(elements.aiProviderStatus.textContent, 'Groq работает.');

    elements.aiProvider.value = 'qwen';
    handlers.get('aiProvider:change')();
    assert.equal(elements.aiProviderStatus.textContent, '');
    elements.aiFallbackProvider.value = 'groq';
    await handlers.get('save:click')();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(storage.aiProvider, 'qwen');
    assert.equal(storage.aiFallbackProvider, 'groq');
    assert.equal(storage.aiFallbackToGroq, true);

    elements.aiEnabled.checked = false;
    handlers.get('aiEnabled:change')();
    assert.equal(elements.aiProvider.disabled, true);
    assert.equal(elements.testAiProvider.disabled, true);
    assert.equal(elements.aiFallbackSection.hidden, true);
    assert.equal(elements.credentialProvider.disabled, false);
    assert.equal(elements.saveProviderCredential.disabled, false);
    assert.equal(elements.deleteProviderCredential.disabled, false);
    assert.equal(elements.buildResumeProfile.disabled, true);
    await handlers.get('save:click')();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(storage.aiEnabled, false);
    assert.equal(storage.aiProvider, 'qwen');
    assert.equal(storage.aiFallbackProvider, 'groq');
    assert.equal(storage.aiProviderCredentials.qwen.apiKey, 'sk_qwen_new');
    assert.equal(storage.aiProviderCredentials.groq.apiKey, 'gsk_test_before_save');

    elements.aiEnabled.checked = true;
    handlers.get('aiEnabled:change')();
    await handlers.get('save:click')();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(storage.aiEnabled, true);
    assert.equal(elements.aiFallbackProvider.value, 'groq');
    assert.equal(elements.aiFallbackSection.hidden, false);

    elements.credentialProvider.value = 'groq';
    handlers.get('credentialProvider:change')();
    delayNextProviderTest = true;
    handlers.get('testAiProvider:click')();
    assert.equal(typeof delayedProviderTestResolver, 'function');
    elements.credentialProvider.value = 'qwen';
    handlers.get('credentialProvider:change')();
    delayedProviderTestResolver();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(elements.aiProviderStatus.textContent, '');

    debugRuns = [
      {
        id: 'run-new',
        kind: 'auto_apply',
        status: 'complete',
        inProgress: false,
        createdAt: '2026-07-26T10:00:00.000Z',
        extensionVersion: '0.1.226'
      },
      {
        id: 'run-old',
        kind: 'resume_refresh',
        status: 'error',
        inProgress: false,
        createdAt: '2026-07-25T10:00:00.000Z',
        extensionVersion: '0.1.226'
      }
    ];
    elements.agentDebugLogsEnabled.checked = true;
    elements.agentDebugRetentionCount.value = '2';
    await handlers.get('save:click')();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(storage.agentDebugLogsEnabled, true);
    assert.equal(storage.agentDebugRetentionCount, 2);
    assert.equal(elements.agentDebugRunSelect.value, 'run-new');
    assert.equal(elements.agentDebugRunSelect.children.length, 2);
    assert.equal(elements.downloadAgentDebugRun.disabled, false);
    assert.equal(elements.agentDebugStatus.textContent, 'Настройки логов сохранены.');

    elements.agentDebugRunSelect.value = 'run-old';
    await handlers.get('downloadAgentDebugRun:click')();
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual(downloadedRunIds, ['run-old']);
    assert.equal(createdLinks.at(-1).download, 'run-old.debug');
    assert.equal(createdLinks.at(-1).clicked, true);
    assert.equal(createdLinks.at(-1).removed, true);
    assert.equal(elements.agentDebugStatus.textContent, 'Файл .debug скачан.');
  } finally {
    delete globalThis.HHJA_DEFAULTS;
    delete globalThis.HHJA_AI_PROVIDERS;
    delete globalThis.HHJA_LOCALIZE_ERROR;
    delete globalThis.HHJobAssistantLog;
    delete globalThis.document;
    delete globalThis.chrome;
  }
});

test('options expose editable resume profile, audit, refinement, and auto refresh controls', async () => {
  const html = await readFile(new URL('src/options.html', root), 'utf8');
  const js = await readFile(new URL('src/options.js', root), 'utf8');

  assert.match(html, /id="resumeUrl"/);
  assert.match(html, /id="resumeCacheTtlHours" type="number" min="0.1" step="0.5"/);
  assert.match(html, /id="resumeProfileText"/);
  assert.match(html, /id="buildResumeProfile"/);
  assert.match(html, /id="resumeProfileEditComment"/);
  assert.match(html, /id="editResumeProfile"/);
  assert.match(html, /id="resumeProfileAutoRefreshEnabled"/);
  assert.match(html, /id="resumeProfileWeaknesses"/);
  assert.match(html, /<fieldset class="preference-field" id="employmentPreference">/);
  assert.match(html, /value="individual_entrepreneur">\s*<span>ИП<\/span>/);
  assert.match(html, /value="labor_contract">\s*<span>ТК<\/span>/);
  assert.match(html, /<fieldset class="preference-field" id="workFormatPreference">/);
  assert.doesNotMatch(html, /<select id="employmentPreference"|<select id="workFormatPreference"|multiple size=/);
  assert.match(html, /value="remote">\s*<span>Удаленка<\/span>/);
  assert.match(html, /value="hybrid">\s*<span>Гибрид<\/span>/);
  assert.doesNotMatch(html, /value="any">Любой|<option value="">Не выбрано<\/option>/);
  assert.match(html, /id="agentDebugLogsEnabled"/);
  assert.match(html, /id="agentDebugRetentionCount" type="number" min="1" max="20" step="1"/);
  assert.match(html, /id="agentDebugRunSelect"/);
  assert.match(html, /id="downloadAgentDebugRun"/);
  assert.match(html, /Если «Логи» включены, расширение локально хранит обезличенные логи последних запусков/);
  assert.match(html, /По умолчанию сохраняются 5 запусков/);
  assert.match(html, /выключение настройки очищает всю историю/);
  assert.match(html, /<h2>Промпты<\/h2>/);
  assert.ok(html.indexOf('<h2>AI-провайдер</h2>') < html.indexOf('<h2>Промпты</h2>'));
  assert.match(html, /id="aiEnabled"/);
  assert.match(html, /Использовать ИИ/);
  assert.match(html, /Вакансии с любыми вопросами работодателя пропускаются/);
  assert.match(html, /id="fallbackCoverLetterTemplate" required/);
  assert.match(html, /id="aiFallbackSection" hidden/);
  assert.match(html, /id="coverPrompt"/);
  assert.match(html, /<label for="telegramUsername">Ник в Telegram для ответов<\/label>\s*<input id="telegramUsername" type="text" placeholder="@username">/);
  assert.match(js, /telegramUsername: document\.getElementById\('telegramUsername'\)/);
  assert.match(js, /telegramUsername: fields\.telegramUsername\.value\.trim\(\)/);
  assert.match(html, /id="employerQuestionPrompt"/);
  assert.match(html, /Логи/);
  assert.match(html, /id="saveProviderCredential"/);
  assert.match(html, /id="deleteProviderCredential"/);
  assert.match(html, /id="testAiProvider"/);
  assert.match(html, /id="aiProviderStatus"/);
  assert.ok(html.indexOf('id="testAiProvider"') < html.indexOf('id="aiProviderStatus"'));
  assert.ok(html.indexOf('id="aiProviderStatus"') < html.indexOf('<h2>Промпты</h2>'));
  assert.match(html, /<div class="actions">\s*<button id="save" type="button">Сохранить<\/button>\s*<\/div>/);
  assert.ok(html.indexOf('id="testAiProvider"') < html.indexOf('<div class="actions">'));
  assert.match(html, /\.switch-track/);
  assert.match(html, /id="delayMinMs" type="number" min="500" step="250"/);
  assert.match(html, /id="delayMaxMs" type="number" min="500" step="250"/);
  assert.match(js, /resumeUrl/);
  assert.match(js, /resumeCacheTtlHours/);
  assert.match(js, /BUILD_RESUME_PROFILE/);
  assert.match(js, /EDIT_RESUME_PROFILE/);
  assert.match(js, /resumeProfileAutoRefreshEnabled/);
  assert.match(js, /Укажите ссылку на резюме hh\.ru перед заполнением промпта/);
  assert.match(js, /employmentPreference/);
  assert.match(js, /workFormatPreference/);
  assert.match(js, /employerQuestionPrompt/);
  assert.match(js, /new URL\(normalizedResumeUrl\)/);
  assert.match(js, /setCustomValidity\('Укажите ссылку на резюме hh\.ru вида https:\/\/hh\.ru\/resume\/\.\.\.'\)/);
  assert.match(js, /credentialDrafts/);
  assert.match(js, /fields\.aiProviderApiKey\.dataset\.masked === 'true'/);
  assert.match(js, /aiFallbackProvider/);
  assert.match(js, /aiEnabled: isAiEnabled\(\)/);
  assert.match(js, /fallbackCoverLetterTemplate: fields\.fallbackCoverLetterTemplate\.value\.trim\(\)/);
  assert.match(js, /fields\.aiFallbackSection\.hidden = !isAiEnabled\(\) \|\| options\.length === 0/);
  assert.match(js, /Math\.max\(0\.1/);
  assert.match(js, /agentDebugLogsEnabled/);
  assert.match(js, /fields\.agentDebugLogsEnabled\.checked = values\.agentDebugLogsEnabled === true/);
  assert.match(js, /agentDebugLogsEnabled: fields\.agentDebugLogsEnabled\.checked/);
  assert.match(js, /agentDebugRetentionCount: normalizeDebugRetention/);
  assert.match(js, /debugLogApi\(\)\?\.clearHistory/);
  assert.match(js, /debugLogApi\(\)\?\.trimHistory/);
  assert.match(js, /debugLogApi\(\)\?\.getArtifact/);
  assert.match(js, /new Blob/);
  assert.match(js, /URL\.createObjectURL/);
  assert.match(js, /URL\.revokeObjectURL/);
  assert.match(js, /link\.download = artifact\.name/);
  assert.match(js, /const DEFAULTS = globalThis\.HHJA_DEFAULTS/);
  assert.match(js, /Math\.max\(500/);
  assert.doesNotMatch(html, /id="resumeText"|Resume text|resumeRefreshEnabled|Enable daily resume refresh/);
  assert.doesNotMatch(js, /resumeText|resumeRefreshEnabled/);
  assert.doesNotMatch(
    html,
    /id="chatUnreadOnly"|id="chatReplyMode"|id="chatLimit"|id="experimentalFeaturesEnabled"|Технические логи для разработчика|Экспериментальные функции|chatAssistantSettings/
  );
  assert.doesNotMatch(js, /chatUnreadOnly|chatReplyMode|chatLimit|experimentalFeaturesEnabled|chatAssistantSettings|syncExperimentalSections|auto_send/);
});

test('options expose registry-driven credentials and fallback provider controls', async () => {
  const html = await readFile(new URL('src/options.html', root), 'utf8');
  const js = await readFile(new URL('src/options.js', root), 'utf8');
  const providers = await readFile(new URL('src/ai-providers.js', root), 'utf8');
  const content = await readFile(new URL('src/content-hh.js', root), 'utf8');

  assert.match(html, /<select id="aiProvider">/);
  assert.match(html, /id="aiEnabled"/);
  assert.match(html, /id="fallbackCoverLetterTemplate"/);
  assert.match(html, /<select id="credentialProvider">/);
  assert.match(html, /id="aiProviderApiKey"/);
  assert.match(html, /id="saveProviderCredential"/);
  assert.match(html, /id="deleteProviderCredential"/);
  assert.match(html, /id="configuredProviders"/);
  assert.match(html, /<select id="aiFallbackProvider">/);
  assert.match(html, /id="aiProviderStatus"/);
  assert.doesNotMatch(html, /id="qwenApiKey"|id="groqApiKey"|id="aiFallbackToGroq"|id="groqStatus"/);
  assert.match(js, /Object\.values\(AI_PROVIDERS\.PROVIDERS\)/);
  assert.match(js, /credentialDrafts/);
  assert.match(js, /aiProviderCredentials/);
  assert.match(js, /aiFallbackProvider/);
  assert.match(js, /renderAiModeControls/);
  assert.doesNotMatch(js, /providerKeyFields|qwenApiKey|fields\.groqApiKey/);
  assert.match(js, /provider\.settingsModelSummary/);
  assert.match(providers, /getTaskCapability/);
  assert.match(providers, /getTaskMaxTokens/);
  assert.match(providers, /getRequestChainTimeoutMs/);
  assert.match(content, /Object\.keys\(globalThis\.HHJA_AI_PROVIDERS\?\.PROVIDERS \|\| \{\}\)/);
  assert.match(content, /getRequestChainTimeoutMs\?\.\(/);
});

test('daily scheduled auto apply exposes fail-closed defaults and Settings controls', async () => {
  const defaults = await readFile(new URL('src/defaults.js', root), 'utf8');
  const background = await readFile(new URL('src/background.js', root), 'utf8');
  const html = await readFile(new URL('src/options.html', root), 'utf8');
  const options = await readFile(new URL('src/options.js', root), 'utf8');

  assert.match(defaults, /scheduledAutoApplyEnabled:\s*false/);
  assert.match(defaults, /scheduledAutoApplyTimeMsk:\s*'10:40'/);
  assert.match(defaults, /scheduledAutoApplyLateWindowMinutes:\s*120/);
  assert.match(defaults, /scheduledAutoApplyFilterUrl:\s*''/);
  assert.match(defaults, /scheduledAutoApplyMaxRepairAttempts:\s*3/);
  assert.match(defaults, /scheduledAutoApplyRepairCutoffMsk:\s*'18:00'/);
  assert.match(background, /hh-job-assistant-daily-auto-apply/);
  assert.match(background, /START_SCHEDULED_AUTO_APPLY/);
  assert.match(background, /ACKNOWLEDGE_SCHEDULED_SESSION_REVIEW/);
  assert.match(background, /Europe\/Moscow/);
  assert.match(html, /id="scheduledAutoApplyEnabled"/);
  assert.match(html, /id="scheduledAutoApplyTimeMsk" type="time"/);
  assert.match(html, /id="scheduledAutoApplyFilterUrl" type="url"/);
  assert.match(html, /id="scheduledAutoApplyRepairCutoffMsk" type="time"/);
  assert.match(options, /scheduledAutoApplyEnabled:\s*fields\.scheduledAutoApplyEnabled\.checked/);
  assert.match(options, /scheduledAutoApplyFilterUrl:\s*normalizedScheduledFilterUrl/);
});

test('scheduled time helpers honor Moscow catch-up and repair boundaries without inspecting filter text', async () => {
  let installedListener = null;
  let startupListener = null;
  let alarmListener = null;
  const localData = {};
  vm.runInThisContext(await readFile(new URL('src/defaults.js', root), 'utf8'));
  vm.runInThisContext(await readFile(new URL('src/ai-providers.js', root), 'utf8'));
  globalThis.__HH_JOB_ASSISTANT_EXPOSE_SCHEDULE_TEST_API__ = true;
  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) {
          if (Array.isArray(keys)) return Object.fromEntries(keys.map((key) => [key, localData[key]]));
          return { ...localData };
        },
        async set(value) { Object.assign(localData, value); },
        async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete localData[key]; }
      },
      onChanged: { addListener() {} }
    },
    runtime: {
      getURL(path) { return `chrome-extension://test/${path}`; },
      getManifest() { return { version: '1.2.3' }; },
      onInstalled: { addListener(fn) { installedListener = fn; } },
      onStartup: { addListener(fn) { startupListener = fn; } },
      onMessage: { addListener() {} }
    },
    alarms: {
      async clear() {},
      create() {},
      async get() { return null; },
      onAlarm: { addListener(fn) { alarmListener = fn; } }
    },
    commands: { onCommand: { addListener() {} } },
    tabs: { async get() { return { status: 'complete' }; } },
    scripting: {}
  };
  await import(`${pathToFileURL(new URL('src/background.js', root).pathname).href}?scheduler-helpers=${crypto.randomUUID()}`);
  const api = globalThis.HHJA_SCHEDULE_TEST_API;
  assert.equal(typeof api?.getScheduleDecision, 'function');
  assert.equal(typeof api?.normalizeScheduledFilterUrl, 'function');
  assert.ok(installedListener);
  assert.ok(startupListener);
  assert.ok(alarmListener);

  const settings = {
    timeMsk: '10:40',
    lateWindowMinutes: 120,
    repairCutoffMsk: '18:00'
  };
  assert.equal(api.getScheduleDecision(Date.parse('2026-08-16T07:39:59.000Z'), settings).catchUp, false);
  assert.equal(api.getScheduleDecision(Date.parse('2026-08-16T07:40:00.000Z'), settings).catchUp, true);
  assert.equal(api.getScheduleDecision(Date.parse('2026-08-16T09:40:00.000Z'), settings).catchUp, true);
  assert.equal(api.getScheduleDecision(Date.parse('2026-08-16T09:40:00.001Z'), settings).catchUp, false);
  assert.equal(api.getScheduleDecision(Date.parse('2026-08-16T07:40:00.001Z'), { ...settings, lateWindowMinutes: 0 }).catchUp, false);
  assert.equal(api.getScheduleDecision(Date.parse('2026-08-16T14:59:59.999Z'), settings).beforeRepairCutoff, true);
  assert.equal(api.getScheduleDecision(Date.parse('2026-08-16T15:00:00.000Z'), settings).beforeRepairCutoff, true);
  assert.equal(api.getScheduleDecision(Date.parse('2026-08-16T15:01:00.000Z'), settings).beforeRepairCutoff, false);
  const opaque = 'https://hh.ru/search/vacancy?text=anything&excluded_text=opaque%2Cvalue&experience=moreThan6';
  assert.equal(api.normalizeScheduledFilterUrl(opaque), opaque);
  assert.equal(api.normalizeScheduledFilterUrl('https://hh.ru/search/vacancy'), '');
  assert.equal(api.normalizeScheduledFilterUrl('https://user:pass@hh.ru/search/vacancy?text=java'), '');
  assert.equal(api.normalizeScheduledFilterUrl('https://evil.example/search/vacancy?text=java'), '');
  delete globalThis.__HH_JOB_ASSISTANT_EXPOSE_SCHEDULE_TEST_API__;
});

async function createScheduledBackgroundHarness({
  now = '2026-08-16T08:00:00.000Z',
  version = '1.2.3',
  authenticated = true,
  unsafe = false,
  existingTab = true,
  startBehavior = 'success',
  continueBehavior = 'success',
  localData: overrides = {}
} = {}) {
  const filterUrl = 'https://hh.ru/search/vacancy?text=opaque&excluded_text=QA%2CAQA&experience=moreThan6';
  const localData = {
    scheduledAutoApplyEnabled: true,
    scheduledAutoApplyTimeMsk: '10:40',
    scheduledAutoApplyLateWindowMinutes: 120,
    scheduledAutoApplyFilterUrl: filterUrl,
    scheduledAutoApplyMaxRepairAttempts: 3,
    scheduledAutoApplyRepairCutoffMsk: '18:00',
    automationSettingsAudit: {
      ready: true,
      checkedAt: '2026-08-16T07:30:00.000Z',
      issues: []
    },
    dailyApplicationLedger: {
      date: '2026-08-16',
      legacySubmitted: 0,
      newSubmitted: 0,
      alreadyApplied: 0,
      submittedVacancyIds: [],
      alreadyAppliedVacancyIds: [],
      hhDailyLimitReached: false,
      updatedAt: '2026-08-16T07:30:00.000Z'
    },
    ...structuredClone(overrides)
  };
  const tabs = new Map();
  if (existingTab) tabs.set(71, { id: 71, url: filterUrl, status: 'complete', active: false });
  const starts = [];
  const repairPauses = [];
  const agentLogs = [];
  const createdTabs = [];
  const removedTabs = [];
  const reloadedTabs = [];
  const alarms = new Map();
  let runtimeListener = null;
  let alarmListener = null;
  let removedListener = null;
  let nextTabId = 90;
  let manifestVersion = version;

  vm.runInThisContext(await readFile(new URL('src/defaults.js', root), 'utf8'));
  vm.runInThisContext(await readFile(new URL('src/ai-providers.js', root), 'utf8'));
  globalThis.__HH_JOB_ASSISTANT_EXPOSE_SCHEDULE_TEST_API__ = true;
  globalThis.__HH_JOB_ASSISTANT_TEST_NOW_MS__ = Date.parse(now);

  const invokeRuntime = (message, sender = {}) => new Promise((resolve) => {
    assert.ok(runtimeListener, 'background runtime listener should be installed');
    assert.equal(runtimeListener(message, sender, resolve), true);
  });

  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) {
          if (Array.isArray(keys)) return Object.fromEntries(keys.map((key) => [key, localData[key]]));
          return { ...localData };
        },
        async set(value) { Object.assign(localData, structuredClone(value)); },
        async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete localData[key]; }
      },
      onChanged: { addListener() {} }
    },
    runtime: {
      getURL(path) { return `chrome-extension://test/${path}`; },
      getManifest() { return { version: manifestVersion }; },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: { addListener(fn) { runtimeListener = fn; } },
      reload() {}
    },
    alarms: {
      async clear(name) { return alarms.delete(name); },
      create(name, info) { alarms.set(name, { name, scheduledTime: info.when }); },
      async get(name) { return alarms.get(name) || null; },
      onAlarm: { addListener(fn) { alarmListener = fn; } }
    },
    commands: { onCommand: { addListener() {} } },
    tabs: {
      async query() { return [...tabs.values()]; },
      async get(tabId) {
        const tab = tabs.get(tabId);
        if (!tab) throw new Error('No tab');
        return tab;
      },
      async create(createProperties) {
        const tab = { id: nextTabId++, url: createProperties.url, status: 'complete', active: false };
        tabs.set(tab.id, tab);
        createdTabs.push(structuredClone(tab));
        return tab;
      },
      async update(tabId, patch) {
        const tab = { ...(tabs.get(tabId) || { id: tabId }), ...patch, status: 'complete' };
        tabs.set(tabId, tab);
        return tab;
      },
      async remove(tabId) {
        removedTabs.push(tabId);
        tabs.delete(tabId);
      },
      async reload(tabId) {
        reloadedTabs.push(tabId);
      },
      async sendMessage(tabId, message) {
        const tab = tabs.get(tabId);
        if (!tab) throw new Error('No tab');
        if (message.type === 'GET_CONTENT_STATUS') {
          return { ok: true, authenticated, unsafe, url: tab.url };
        }
        if (message.type === 'START_SCHEDULED_AUTO_APPLY') {
          starts.push(structuredClone(message));
          if (startBehavior === 'throw') throw new Error('start_unreachable');
          if (startBehavior === 'reject') return { ok: false, error: 'start_rejected' };
          const runId = `scheduled-run-${starts.length}`;
          const claim = await invokeRuntime({
            type: 'CLAIM_AUTO_APPLY_RUN',
            runId,
            entrySource: 'scheduled',
            scheduledSessionId: message.sessionId,
            scheduledDateMsk: message.dateMsk
          }, { tab });
          if (startBehavior === 'claim_then_throw' && claim?.claimed) {
            localData.autoApplySearchQueue = {
              active: true,
              runId,
              ownerId: tabId,
              scheduledSessionId: message.sessionId,
              scheduledDateMsk: message.dateMsk,
              sourceUrl: tab.url,
              counters: { found: 1, processed: 0, applied: 0, skipped: 0, errors: 0 }
            };
            throw new Error('message_port_closed_after_claim');
          }
          if (startBehavior === 'claim_then_complete_throw' && claim?.claimed) {
            await invokeRuntime({
              type: 'SET_RUN_STATE',
              runId,
              ownerId: tabId,
              patch: { state: 'complete', processed: 0, applied: 0, skipped: 0, errors: 0 }
            }, { tab });
            throw new Error('message_port_closed_after_completion');
          }
          return claim?.claimed
            ? { ok: true, activeRunId: runId, ownerId: tabId }
            : { ok: false, error: claim?.reason || 'claim_failed' };
        }
        if (message.type === 'PAUSE_SCHEDULED_AUTO_APPLY_FOR_REPAIR') {
          repairPauses.push({ tabId, message: structuredClone(message) });
          return { ok: true, checkpointed: true };
        }
        if (message.type === 'CONTINUE_SCHEDULED_AUTO_APPLY') {
          if (continueBehavior === 'throw') throw new Error('continue_unreachable');
          if (continueBehavior === 'reject_without_checkpoint') {
            localData.autoApplySearchQueue = {
              ...(localData.autoApplySearchQueue || {}),
              active: false
            };
            return { ok: false, continued: false };
          }
          if (continueBehavior === 'reject') return { ok: false, continued: false };
          return { ok: true, continued: true };
        }
        return { ok: true };
      },
      onUpdated: { addListener() {}, removeListener() {} },
      onRemoved: { addListener(fn) { removedListener = fn; } }
    },
    scripting: {
      async executeScript() { return [{ result: 'complete' }]; }
    }
  };

  await import(`${pathToFileURL(new URL('src/background.js', root).pathname).href}?scheduler-runtime=${crypto.randomUUID()}`);
  await new Promise((resolve) => setTimeout(resolve, 0));
  globalThis.HHJobAssistantLog = {
    append(scope, event, details) {
      agentLogs.push({ scope, event, details: structuredClone(details) });
      return Promise.resolve();
    }
  };
  return {
    api: globalThis.HHJA_SCHEDULE_TEST_API,
    localData,
    starts,
    repairPauses,
    agentLogs,
    tabs,
    createdTabs,
    removedTabs,
    reloadedTabs,
    alarms,
    alarmListener,
    closeTab(tabId) {
      tabs.delete(tabId);
      removedListener?.(tabId);
    },
    invokeRuntime,
    filterUrl,
    setVersion(value) { manifestVersion = value; },
    setNow(value) { globalThis.__HH_JOB_ASSISTANT_TEST_NOW_MS__ = Date.parse(value); },
    cleanup() {
      delete globalThis.__HH_JOB_ASSISTANT_EXPOSE_SCHEDULE_TEST_API__;
      delete globalThis.__HH_JOB_ASSISTANT_TEST_NOW_MS__;
      delete globalThis.HHJA_SCHEDULE_TEST_API;
      delete globalThis.HHJobAssistantLog;
    }
  };
}

test('scheduled alarm starts once inside the Moscow window and misses safely after 12:40', async () => {
  const within = await createScheduledBackgroundHarness({ now: '2026-08-16T09:40:00.000Z' });
  try {
    assert.equal((await within.api.runScheduledAutoApply()).ok, true);
    assert.equal(within.starts.length, 1);
    assert.equal(within.localData.scheduledAutoApplySession.state, 'running');
    assert.equal(within.localData.scheduledAutoApplySession.reviewRequired, true);
    const runningSnapshot = await within.invokeRuntime(
      { type: 'GET_SAFE_STATUS_SNAPSHOT' },
      { tab: within.tabs.get(71) }
    );
    assert.equal(runningSnapshot.snapshot.scheduledSession.reviewPending, false);
    assert.equal((await within.api.runScheduledAutoApply()).reason, 'already_attempted_today');
    assert.equal(within.starts.length, 1);
  } finally {
    within.cleanup();
  }

  const late = await createScheduledBackgroundHarness({ now: '2026-08-16T09:40:00.001Z' });
  try {
    assert.equal((await late.api.runScheduledAutoApply()).reason, 'missed_start_window');
    assert.equal(late.starts.length, 0);
    assert.equal(late.localData.scheduledAutoApplySession, undefined);
    const startupSchedule = await late.api.recreateScheduledAutoApplyAlarm({
      catchUp: true,
      reason: 'startup'
    });
    assert.equal(startupSchedule.missed, true);
    assert.ok(startupSchedule.when > Date.parse('2026-08-17T07:39:59.000Z'));
  } finally {
    late.cleanup();
  }

  const parallel = await createScheduledBackgroundHarness({ now: '2026-08-16T08:00:00.000Z' });
  try {
    const results = await Promise.all([
      parallel.api.runScheduledAutoApply(),
      parallel.api.runScheduledAutoApply()
    ]);
    assert.equal(results.filter((result) => result.ok === true).length, 1);
    assert.equal(results.filter((result) => result.reason === 'already_attempted_today').length, 1);
    assert.equal(parallel.starts.length, 1);
  } finally {
    parallel.cleanup();
  }
});

test('scheduled terminal state and owned lease release stay coupled to SET_RUN_STATE', async () => {
  const harness = await createScheduledBackgroundHarness({ now: '2026-08-16T08:00:00.000Z' });
  try {
    assert.equal((await harness.api.runScheduledAutoApply()).ok, true);
    const session = harness.localData.scheduledAutoApplySession;
    harness.localData.runResults = [{ vacancyId: '1', status: 'applied' }];
    harness.localData.autoApplyResponseAttempts = {
      foreign: {
        runId: session.runId,
        ownerId: 999,
        startedAt: '2026-08-16T07:59:00.000Z'
      }
    };
    const response = await harness.invokeRuntime({
      type: 'SET_RUN_STATE',
      runId: session.runId,
      ownerId: session.ownerId,
      patch: { state: 'complete', processed: 1, applied: 1 }
    }, { tab: harness.tabs.get(session.ownerId) });
    assert.equal(response.ok, true);
    assert.equal(harness.localData.scheduledAutoApplySession.state, 'complete');
    assert.equal(harness.localData.scheduledAutoApplySession.reviewRequired, true);
    assert.ok(harness.localData.scheduledAutoApplySession.finishedAt);
    assert.equal(harness.localData.autoApplyRunLease.active, false);
    assert.equal(harness.localData.autoApplyRunLease.releasedState, 'complete');
    assert.equal(harness.localData.autoApplyResponseAttempts.foreign.cancelledAt, undefined);
  } finally {
    harness.cleanup();
  }

  const idle = await createScheduledBackgroundHarness();
  try {
    assert.equal((await idle.api.runScheduledAutoApply()).ok, true);
    const session = idle.localData.scheduledAutoApplySession;
    const response = await idle.invokeRuntime({
      type: 'SET_RUN_STATE',
      runId: session.runId,
      ownerId: session.ownerId,
      patch: { state: 'idle', processed: 0 }
    }, { tab: idle.tabs.get(session.ownerId) });
    assert.equal(response.ok, true);
    assert.equal(idle.localData.scheduledAutoApplySession.state, 'blocked');
    assert.equal(idle.localData.scheduledAutoApplySession.stopReason, 'idle');
    assert.equal(idle.localData.scheduledAutoApplySession.reviewRequired, true);
    assert.equal(idle.localData.autoApplyRunLease.active, false);
  } finally {
    idle.cleanup();
  }
});

test('scheduled terminal transition preserves live provenance and blocks counter divergence', async () => {
  for (const kind of ['pending_submit', 'response_attempt', 'active_queue']) {
    const harness = await createScheduledBackgroundHarness();
    try {
      assert.equal((await harness.api.runScheduledAutoApply()).ok, true);
      const session = harness.localData.scheduledAutoApplySession;
      harness.localData.runResults = [{ vacancyId: '1', status: 'applied' }];
      harness.localData.runState = {
        state: 'applying',
        runId: session.runId,
        ownerId: session.ownerId,
        processed: 1,
        applied: 1
      };
      if (kind === 'pending_submit') {
        harness.localData.autoApplyPendingSubmit = {
          item: { vacancyId: 'pending' },
          runId: session.runId,
          ownerId: session.ownerId
        };
      } else if (kind === 'response_attempt') {
        harness.localData.autoApplyResponseAttempts = {
          pending: {
            runId: session.runId,
            ownerId: session.ownerId,
            startedAt: '2026-08-16T07:59:59.000Z'
          }
        };
      } else {
        harness.localData.autoApplySearchQueue = {
          active: true,
          runId: session.runId,
          ownerId: session.ownerId,
          scheduledSessionId: session.sessionId,
          scheduledDateMsk: session.dateMsk
        };
      }
      const response = await harness.invokeRuntime({
        type: 'SET_RUN_STATE',
        runId: session.runId,
        ownerId: session.ownerId,
        patch: { state: 'complete', processed: 1, applied: 1 }
      }, { tab: harness.tabs.get(session.ownerId) });
      assert.equal(response.ok, true, kind);
      assert.equal(response.terminalDeferred, true, kind);
      assert.equal(harness.localData.scheduledAutoApplySession.state, 'repair_pending', kind);
      assert.equal(harness.localData.autoApplyRunLease.active, true, kind);
      assert.equal(harness.localData.autoApplyRunLease.scheduledRepairPending, true, kind);
      assert.equal(harness.localData.runState.state, 'paused', kind);
      if (kind === 'pending_submit') assert.ok(harness.localData.autoApplyPendingSubmit.item);
      if (kind === 'response_attempt') assert.ok(harness.localData.autoApplyResponseAttempts.pending);
      if (kind === 'active_queue') assert.equal(harness.localData.autoApplySearchQueue.active, true);
    } finally {
      harness.cleanup();
    }
  }

  const mismatch = await createScheduledBackgroundHarness();
  try {
    assert.equal((await mismatch.api.runScheduledAutoApply()).ok, true);
    const session = mismatch.localData.scheduledAutoApplySession;
    mismatch.localData.runResults = [{ vacancyId: '1', status: 'applied' }];
    mismatch.localData.runState = {
      state: 'applying',
      runId: session.runId,
      ownerId: session.ownerId,
      processed: 2,
      applied: 1
    };
    const response = await mismatch.invokeRuntime({
      type: 'SET_RUN_STATE',
      runId: session.runId,
      ownerId: session.ownerId,
      patch: { state: 'complete', processed: 2, applied: 1 }
    }, { tab: mismatch.tabs.get(session.ownerId) });
    assert.equal(response.terminalDeferred, true);
    assert.equal(response.reason, 'counter_result_mismatch');
    assert.equal(mismatch.localData.scheduledAutoApplySession.state, 'blocked');
    assert.equal(mismatch.localData.autoApplyRunLease.active, false);
    assert.equal(mismatch.localData.runState.processed, 1);
  } finally {
    mismatch.cleanup();
  }
});

test('scheduled terminal transition accepts a complete run with a capped 200-result window', async () => {
  const harness = await createScheduledBackgroundHarness();
  try {
    assert.equal((await harness.api.runScheduledAutoApply()).ok, true);
    const session = harness.localData.scheduledAutoApplySession;
    harness.localData.runResults = Array.from({ length: 200 }, (_, index) => ({
      vacancyId: String(index + 2),
      status: 'skipped_no_response_button'
    }));
    harness.localData.runState = {
      state: 'applying',
      runId: session.runId,
      ownerId: session.ownerId,
      found: 201,
      processed: 201,
      applied: 0,
      skipped: 201,
      errors: 0
    };

    const response = await harness.invokeRuntime({
      type: 'SET_RUN_STATE',
      runId: session.runId,
      ownerId: session.ownerId,
      patch: { state: 'complete', found: 201, processed: 201, applied: 0, skipped: 201, errors: 0 }
    }, { tab: harness.tabs.get(session.ownerId) });

    assert.equal(response.ok, true);
    assert.equal(response.terminalDeferred, undefined);
    assert.equal(harness.localData.runResults.length, 200);
    assert.equal(harness.localData.runState.state, 'complete');
    assert.equal(harness.localData.runState.processed, 201);
    assert.equal(harness.localData.scheduledAutoApplySession.state, 'complete');
    assert.equal(harness.localData.autoApplyRunLease.active, false);
  } finally {
    harness.cleanup();
  }
});

test('scheduled repair paths preserve processed counters beyond the retained 200-result window', async () => {
  const retainedResults = Array.from({ length: 200 }, (_, index) => ({
    vacancyId: String(index + 2),
    status: 'skipped_no_response_button'
  }));

  const deferred = await createScheduledBackgroundHarness();
  try {
    assert.equal((await deferred.api.runScheduledAutoApply()).ok, true);
    const session = deferred.localData.scheduledAutoApplySession;
    deferred.localData.runResults = structuredClone(retainedResults);
    deferred.localData.runState = {
      state: 'applying',
      runId: session.runId,
      ownerId: session.ownerId,
      found: 201,
      processed: 201,
      skipped: 201
    };
    deferred.localData.autoApplyPendingSubmit = {
      item: { vacancyId: 'pending' },
      runId: session.runId,
      ownerId: session.ownerId
    };
    const response = await deferred.invokeRuntime({
      type: 'SET_RUN_STATE',
      runId: session.runId,
      ownerId: session.ownerId,
      patch: { state: 'complete', processed: 201, skipped: 201 }
    }, { tab: deferred.tabs.get(session.ownerId) });
    assert.equal(response.terminalDeferred, true);
    assert.equal(deferred.localData.runState.processed, 201);
  } finally {
    deferred.cleanup();
  }

  const checkpoint = await createScheduledBackgroundHarness();
  try {
    assert.equal((await checkpoint.api.runScheduledAutoApply()).ok, true);
    const session = checkpoint.localData.scheduledAutoApplySession;
    checkpoint.localData.runResults = structuredClone(retainedResults);
    checkpoint.localData.runState = {
      state: 'applying',
      runId: session.runId,
      ownerId: session.ownerId,
      found: 201,
      processed: 201,
      skipped: 201
    };
    checkpoint.localData.autoApplySearchQueue = {
      active: true,
      runId: session.runId,
      ownerId: session.ownerId,
      scheduledSessionId: session.sessionId,
      scheduledDateMsk: session.dateMsk
    };
    const response = await checkpoint.api.checkpointScheduledRepair({
      sessionId: session.sessionId,
      runId: session.runId,
      counters: { found: 201, processed: 201, skipped: 201 }
    }, { tab: checkpoint.tabs.get(session.ownerId) });
    assert.equal(response.checkpointed, true);
    assert.equal(checkpoint.localData.runState.processed, 201);
  } finally {
    checkpoint.cleanup();
  }

  const blocked = await createScheduledBackgroundHarness({
    version: '1.2.4',
    localData: {
      scheduledAutoApplySession: {
        sessionId: 'scheduled:2026-08-16:retention',
        dateMsk: '2026-08-16',
        runId: 'retention-run',
        ownerId: 71,
        extensionVersion: '1.2.3',
        repairFromVersion: '1.2.3',
        state: 'repair_pending',
        reviewRequired: true
      },
      autoApplyRunLease: {
        active: true,
        runId: 'retention-run',
        ownerId: 71,
        scheduledRepairPending: true
      },
      runResults: retainedResults,
      runState: {
        state: 'paused',
        runId: 'retention-run',
        ownerId: 71,
        found: 201,
        processed: 201,
        skipped: 201
      }
    }
  });
  try {
    const response = await blocked.api.reserveScheduledRepairResume();
    assert.equal(response.reason, 'missing_checkpoint');
    assert.equal(blocked.localData.runState.processed, 201);
  } finally {
    blocked.cleanup();
  }
});

test('scheduled owner tab close terminalizes the session so review can be acknowledged', async () => {
  const harness = await createScheduledBackgroundHarness();
  try {
    assert.equal((await harness.api.runScheduledAutoApply()).ok, true);
    const session = structuredClone(harness.localData.scheduledAutoApplySession);
    assert.equal(session.state, 'running');
    harness.localData.autoApplyPendingSubmit = {
      item: { vacancyId: 'pending-owner-close', title: 'Pending owner close' },
      runId: session.runId,
      ownerId: session.ownerId,
      counters: { found: 1, processed: 0, applied: 0, skipped: 0, errors: 0 }
    };

    harness.closeTab(session.ownerId);
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(harness.localData.autoApplyRunLease.active, false);
    assert.equal(harness.localData.runState.state, 'error');
    assert.equal(harness.localData.scheduledAutoApplySession.state, 'error');
    assert.equal(harness.localData.scheduledAutoApplySession.stopReason, 'owner_tab_closed');
    assert.equal(harness.localData.scheduledAutoApplySession.reviewRequired, true);
    assert.ok(harness.localData.scheduledAutoApplySession.finishedAt);
    assert.equal(harness.localData.runResults.at(-1).status, 'error_pending_submit_owner_tab_closed');
    assert.equal(
      harness.agentLogs.find((entry) => entry.event === 'run_result')?.details?.status,
      'error_pending_submit_owner_tab_closed'
    );
    assert.equal(harness.agentLogs.find((entry) => entry.event === 'run_state')?.details?.state, 'error');

    const snapshot = await harness.invokeRuntime(
      { type: 'GET_SAFE_STATUS_SNAPSHOT' },
      { tab: { id: 99, url: 'https://hh.ru/?hhjaStatus=1' } }
    );
    assert.equal(snapshot.snapshot.scheduledSession.stopReason, 'owner_tab_closed');

    const acknowledged = await harness.invokeRuntime({
      type: 'ACKNOWLEDGE_SCHEDULED_SESSION_REVIEW',
      sessionId: session.sessionId,
      outcome: 'blocked',
      issues: ['owner_tab_closed'],
      authenticated: true
    }, { tab: { id: 99, url: 'https://hh.ru/?hhjaStatus=1' } });
    assert.equal(acknowledged.ok, true);
    assert.equal(acknowledged.acknowledged, true);
  } finally {
    harness.cleanup();
  }
});

test('authenticated safe status can request repair pause on the owned scheduled tab', async () => {
  const harness = await createScheduledBackgroundHarness();
  try {
    assert.equal((await harness.api.runScheduledAutoApply()).ok, true);
    const sender = { tab: harness.tabs.get(71) };
    const denied = await harness.invokeRuntime({
      type: 'REQUEST_SCHEDULED_REPAIR_PAUSE',
      authenticated: false
    }, sender);
    assert.equal(denied.reason, 'authenticated_safe_status_required');
    assert.equal(harness.repairPauses.length, 0);
    const requested = await harness.invokeRuntime({
      type: 'REQUEST_SCHEDULED_REPAIR_PAUSE',
      authenticated: true
    }, sender);
    assert.equal(requested.ok, true);
    assert.equal(requested.checkpointed, true);
    assert.deepEqual(harness.repairPauses, [{
      tabId: 71,
      message: { type: 'PAUSE_SCHEDULED_AUTO_APPLY_FOR_REPAIR' }
    }]);
  } finally {
    harness.cleanup();
  }
});

test('scheduled start creates a hidden exact-filter tab and fails closed on every preflight blocker', async () => {
  const created = await createScheduledBackgroundHarness({ existingTab: false });
  try {
    assert.equal((await created.api.runScheduledAutoApply()).ok, true);
    assert.equal(created.createdTabs.length, 1);
    assert.equal(created.createdTabs[0].url, created.filterUrl);
    assert.equal(created.createdTabs[0].active, false);
  } finally {
    created.cleanup();
  }

  const failedCreated = await createScheduledBackgroundHarness({ existingTab: false, startBehavior: 'throw' });
  try {
    assert.equal((await failedCreated.api.runScheduledAutoApply()).ok, false);
    assert.deepEqual(failedCreated.removedTabs, [90]);
    assert.equal(failedCreated.localData.scheduledAutoApplySession.state, 'error');
    assert.equal(failedCreated.localData.scheduledAutoApplySession.reviewRequired, true);
    const snapshot = await failedCreated.invokeRuntime(
      { type: 'GET_SAFE_STATUS_SNAPSHOT' },
      { tab: { id: 999, url: failedCreated.filterUrl } }
    );
    assert.equal(snapshot.snapshot.scheduledSession.reviewPending, true);
    failedCreated.setNow('2026-08-17T08:00:00.000Z');
    assert.equal((await failedCreated.api.runScheduledAutoApply()).reason, 'previous_review_required');
    const acknowledgement = await failedCreated.api.acknowledgeScheduledSessionReview({
      sessionId: failedCreated.localData.scheduledAutoApplySession.sessionId,
      outcome: 'passed',
      issues: [],
      authenticated: true
    }, { tab: { id: 999, url: failedCreated.filterUrl } });
    assert.equal(acknowledgement.acknowledged, true);
    assert.ok(failedCreated.localData.scheduledAutoApplySession.reviewedAt);
  } finally {
    failedCreated.cleanup();
  }

  const nonExact = await createScheduledBackgroundHarness();
  try {
    const originalUrl = 'https://hh.ru/search/vacancy?text=another-filter';
    nonExact.tabs.get(71).url = originalUrl;
    assert.equal((await nonExact.api.runScheduledAutoApply()).ok, true);
    assert.equal(nonExact.tabs.get(71).url, originalUrl);
    assert.equal(nonExact.createdTabs.length, 1);
    assert.equal(nonExact.createdTabs[0].url, nonExact.filterUrl);
    assert.equal(nonExact.createdTabs[0].active, false);
  } finally {
    nonExact.cleanup();
  }

  const failedReused = await createScheduledBackgroundHarness({ startBehavior: 'throw' });
  try {
    const originalUrl = 'https://hh.ru/search/vacancy?text=another-filter';
    failedReused.tabs.get(71).url = originalUrl;
    assert.equal((await failedReused.api.runScheduledAutoApply()).ok, false);
    assert.equal(failedReused.tabs.get(71).url, originalUrl);
    assert.deepEqual(failedReused.removedTabs, [90]);
  } finally {
    failedReused.cleanup();
  }

  const failedRejected = await createScheduledBackgroundHarness({ startBehavior: 'reject' });
  try {
    assert.equal((await failedRejected.api.runScheduledAutoApply()).reason, 'scheduled_start_rejected');
    assert.equal(failedRejected.localData.scheduledAutoApplySession.state, 'error');
    assert.equal(failedRejected.localData.scheduledAutoApplySession.reviewRequired, true);
  } finally {
    failedRejected.cleanup();
  }

  const blockerCases = [
    ['disabled', { scheduledAutoApplyEnabled: false }],
    ['invalid_filter_url', { scheduledAutoApplyFilterUrl: 'https://evil.example/search/vacancy?text=java' }],
    ['audit_not_ready', { automationSettingsAudit: { ready: false, checkedAt: '', issues: ['audit_not_ready'] } }],
    ['daily_limit_reached', { dailyApplicationLedger: { date: '2026-08-16', legacySubmitted: 200, submittedVacancyIds: [], alreadyAppliedVacancyIds: [], hhDailyLimitReached: false } }],
    ['daily_limit_reached', { dailyApplicationLedger: { date: '2026-08-16', legacySubmitted: 0, submittedVacancyIds: [], alreadyAppliedVacancyIds: [], hhDailyLimitReached: true } }],
    ['active_run', { autoApplyRunLease: { active: true, runId: 'manual', ownerId: 71 } }],
    ['active_saved_queue', { autoApplyQueue: { active: true, runId: 'stale-response', ownerId: 99 } }],
    ['active_saved_queue', { autoApplySearchQueue: { active: true, runId: 'stale-search', ownerId: 99 } }],
    ['pending_submit', { autoApplyPendingSubmit: { item: { vacancyId: 'secret' } } }],
    ['unresolved_response_attempt', { autoApplyResponseAttempts: { secret: { startedAt: '2026-08-16T07:59:00.000Z' } } }],
    ['previous_review_required', {
      scheduledAutoApplySession: {
        sessionId: 'scheduled:2026-08-15:old',
        dateMsk: '2026-08-15',
        state: 'complete',
        reviewRequired: true,
        reviewedAt: ''
      }
    }]
  ];
  for (const [reason, localData] of blockerCases) {
    const harness = await createScheduledBackgroundHarness({ localData });
    try {
      assert.equal((await harness.api.runScheduledAutoApply()).reason, reason, reason);
      assert.equal(harness.starts.length, 0, reason);
    } finally {
      harness.cleanup();
    }
  }

  const unauthenticated = await createScheduledBackgroundHarness({ authenticated: false, existingTab: false });
  try {
    assert.equal((await unauthenticated.api.runScheduledAutoApply()).reason, 'authentication_required');
    assert.equal(unauthenticated.starts.length, 0);
    assert.deepEqual(unauthenticated.removedTabs, [90]);
  } finally {
    unauthenticated.cleanup();
  }
  const captcha = await createScheduledBackgroundHarness({ authenticated: true, unsafe: true });
  try {
    assert.equal((await captcha.api.runScheduledAutoApply()).reason, 'authentication_required');
    assert.equal(captcha.starts.length, 0);
  } finally {
    captcha.cleanup();
  }
});

test('scheduled start preserves a claimed queued run when its response port closes', async () => {
  const harness = await createScheduledBackgroundHarness({
    existingTab: false,
    startBehavior: 'claim_then_throw'
  });
  try {
    const result = await harness.api.runScheduledAutoApply();
    assert.equal(result.ok, true);
    assert.equal(result.startAcknowledgementLost, true);
    assert.equal(harness.localData.scheduledAutoApplySession.state, 'running');
    assert.equal(harness.localData.autoApplyRunLease.active, true);
    assert.equal(harness.localData.autoApplySearchQueue.active, true);
    assert.deepEqual(harness.removedTabs, []);
    assert.equal(harness.tabs.has(90), true);
  } finally {
    harness.cleanup();
  }
});

test('scheduled start preserves durable completion when its response port closes', async () => {
  const harness = await createScheduledBackgroundHarness({
    existingTab: false,
    startBehavior: 'claim_then_complete_throw'
  });
  try {
    const result = await harness.api.runScheduledAutoApply();
    assert.equal(result.ok, true);
    assert.equal(result.startAcknowledgementLost, true);
    assert.equal(result.completedBeforeAcknowledgement, true);
    assert.equal(harness.localData.scheduledAutoApplySession.state, 'complete');
    assert.equal(harness.localData.autoApplyRunLease.active, false);
    assert.deepEqual(harness.removedTabs, []);
    assert.equal(harness.tabs.has(90), true);
  } finally {
    harness.cleanup();
  }
});

test('missing scheduled owner is terminalized before reservation or manual replacement', async () => {
  const missingOwnerState = {
    scheduledAutoApplySession: {
      sessionId: 'scheduled:2026-08-15:missing-owner',
      dateMsk: '2026-08-15',
      runId: 'orphaned-scheduled-run',
      ownerId: 999,
      extensionVersion: '1.2.3',
      state: 'running',
      reviewRequired: true,
      reviewedAt: ''
    },
    autoApplyRunLease: {
      active: true,
      runId: 'orphaned-scheduled-run',
      ownerId: 999,
      scheduledSessionId: 'scheduled:2026-08-15:missing-owner'
    },
    autoApplySearchQueue: {
      active: true,
      runId: 'orphaned-scheduled-run',
      ownerId: 999,
      scheduledSessionId: 'scheduled:2026-08-15:missing-owner'
    },
    runState: {
      state: 'applying',
      runId: 'orphaned-scheduled-run',
      ownerId: 999,
      processed: 3,
      skipped: 3
    },
    runResults: [
      { vacancyId: '1', status: 'skipped_no_response_button' },
      { vacancyId: '2', status: 'skipped_no_response_button' },
      { vacancyId: '3', status: 'skipped_no_response_button' }
    ]
  };
  const reservation = await createScheduledBackgroundHarness({ localData: missingOwnerState });
  try {
    const result = await reservation.api.runScheduledAutoApply();
    assert.equal(result.reason, 'previous_review_required');
    assert.equal(reservation.localData.autoApplyRunLease.active, false);
    assert.equal(reservation.localData.autoApplySearchQueue.active, false);
    assert.equal(reservation.localData.scheduledAutoApplySession.state, 'error');
    assert.equal(reservation.localData.scheduledAutoApplySession.stopReason, 'owner_tab_closed');
  } finally {
    reservation.cleanup();
  }

  const replacement = await createScheduledBackgroundHarness({
    localData: {
      ...missingOwnerState,
      autoApplySearchQueue: { active: false }
    }
  });
  try {
    const claim = await replacement.invokeRuntime({
      type: 'CLAIM_AUTO_APPLY_RUN',
      runId: 'manual-replacement'
    }, { tab: replacement.tabs.get(71) });
    assert.equal(claim.claimed, true);
    assert.equal(replacement.localData.autoApplyRunLease.runId, 'manual-replacement');
    assert.equal(replacement.localData.scheduledAutoApplySession.state, 'error');
    assert.equal(replacement.localData.scheduledAutoApplySession.stopReason, 'owner_tab_closed');
  } finally {
    replacement.cleanup();
  }
});

test('background stop is idempotent for a completed run with a capped result window', async () => {
  const harness = await createScheduledBackgroundHarness();
  try {
    harness.localData.runState = {
      state: 'complete',
      runId: 'completed-201',
      ownerId: 71,
      found: 201,
      processed: 201,
      applied: 0,
      skipped: 201,
      errors: 0,
      currentAction: 'Отклики завершены',
      lastError: ''
    };
    harness.localData.runResults = Array.from({ length: 200 }, (_, index) => ({
      vacancyId: String(index + 2),
      status: 'skipped_no_response_button'
    }));
    harness.localData.autoApplyRunLease = {
      active: false,
      runId: 'completed-201',
      ownerId: 71,
      releasedState: 'complete'
    };
    harness.localData.autoApplyQueue = { active: false };
    harness.localData.autoApplySearchQueue = { active: false };
    harness.localData.autoApplyPendingSubmit = null;
    harness.localData.autoApplyResponseAttempts = {};
    harness.localData.autoApplyStopRequested = false;
    harness.localData.autoApplyStopRequestedAt = '';
    harness.localData.autoApplyStopReason = '';

    const response = await harness.invokeRuntime({ type: 'STOP_RUN' });

    assert.equal(response.ok, true);
    assert.equal(response.alreadyTerminal, true);
    assert.equal(harness.localData.runState.state, 'complete');
    assert.equal(harness.localData.runState.processed, 201);
    assert.equal(harness.localData.autoApplyStopRequested, false);
  } finally {
    harness.cleanup();
  }
});

test('scheduled review acknowledgement is authenticated, terminal-only, idempotent, and unlocks the gate', async () => {
  const harness = await createScheduledBackgroundHarness({
    localData: {
      scheduledAutoApplySession: {
        sessionId: 'scheduled:2026-08-15:review',
        dateMsk: '2026-08-15',
        runId: 'run-old',
        ownerId: 71,
        extensionVersion: '1.2.3',
        state: 'running',
        reviewRequired: true,
        reviewOutcome: '',
        reviewIssues: [],
        reviewedAt: ''
      }
    }
  });
  const sender = { tab: harness.tabs.get(71) };
  try {
    assert.equal((await harness.api.acknowledgeScheduledSessionReview({
      sessionId: 'scheduled:2026-08-15:wrong', outcome: 'passed', issues: [], authenticated: true
    }, sender)).reason, 'session_mismatch');
    assert.equal((await harness.api.acknowledgeScheduledSessionReview({
      sessionId: 'scheduled:2026-08-15:review', outcome: 'passed', issues: [], authenticated: true
    }, sender)).reason, 'session_not_terminal');
    harness.localData.scheduledAutoApplySession.state = 'complete';
    assert.equal((await harness.api.acknowledgeScheduledSessionReview({
      sessionId: 'scheduled:2026-08-15:review', outcome: 'unknown', issues: [], authenticated: true
    }, sender)).reason, 'invalid_outcome');
    assert.equal((await harness.api.acknowledgeScheduledSessionReview({
      sessionId: 'scheduled:2026-08-15:review', outcome: 'passed', issues: [], authenticated: false
    }, sender)).reason, 'authenticated_safe_status_required');
    const first = await harness.api.acknowledgeScheduledSessionReview({
      sessionId: 'scheduled:2026-08-15:review', outcome: 'passed', issues: ['counter_check'], authenticated: true
    }, sender);
    assert.equal(first.acknowledged, true);
    assert.equal(first.alreadyAcknowledged, false);
    const reviewedAt = harness.localData.scheduledAutoApplySession.reviewedAt;
    const repeat = await harness.api.acknowledgeScheduledSessionReview({
      sessionId: 'scheduled:2026-08-15:review', outcome: 'blocked', issues: [], authenticated: true
    }, sender);
    assert.equal(repeat.alreadyAcknowledged, true);
    assert.equal(harness.localData.scheduledAutoApplySession.reviewedAt, reviewedAt);
    harness.localData.scheduledAutoApplySession.filterUrl = 'https://hh.ru/search/vacancy?secret=filter';
    harness.localData.scheduledAutoApplySession.privateQuestions = [{ answer: 'secret-answer' }];
    const snapshot = await harness.invokeRuntime({ type: 'GET_SAFE_STATUS_SNAPSHOT' }, sender);
    const serialized = JSON.stringify(snapshot);
    assert.doesNotMatch(serialized, /secret=filter|secret-answer|run-old/);
    assert.equal(snapshot.snapshot.scheduledSession.reviewPending, false);
    assert.equal((await harness.api.runScheduledAutoApply()).ok, true);
  } finally {
    harness.cleanup();
  }
});

test('scheduled repair preserves an owned checkpoint and resumes only after every gate passes', async () => {
  const runningSession = {
    sessionId: 'scheduled:2026-08-16:repair',
    dateMsk: '2026-08-16',
    runId: 'repair-run',
    ownerId: 71,
    filterUrl: 'https://hh.ru/search/vacancy?text=opaque',
    extensionVersion: '1.2.3',
    state: 'running',
    repairAttempts: 0,
    reviewRequired: true,
    reviewedAt: ''
  };
  const queue = {
    active: true,
    runId: 'repair-run',
    ownerId: 71,
    scheduledSessionId: runningSession.sessionId,
    scheduledDateMsk: runningSession.dateMsk,
    counters: { processed: 1, applied: 1 }
  };
  const harness = await createScheduledBackgroundHarness({
    version: '1.2.3',
    localData: {
      scheduledAutoApplySession: runningSession,
      autoApplyRunLease: { active: true, runId: 'repair-run', ownerId: 71 },
      autoApplySearchQueue: queue,
      runResults: [{ vacancyId: '1', status: 'applied' }],
      runState: { state: 'applying', runId: 'repair-run', ownerId: 71, processed: 1, applied: 1 }
    }
  });
  try {
    const checkpoint = await harness.api.checkpointScheduledRepair({
      sessionId: runningSession.sessionId,
      runId: 'repair-run',
      counters: {
        found: '5',
        processed: 999,
        applied: -1,
        alreadyApplied: 2.9,
        skipped: '3',
        errors: Number.POSITIVE_INFINITY,
        runId: 'forged-run',
        ownerId: 999,
        injected: 'forged'
      }
    }, { tab: harness.tabs.get(71) });
    assert.equal(checkpoint.checkpointed, true);
    assert.equal(harness.localData.autoApplySearchQueue.active, true);
    assert.equal(harness.localData.autoApplyRunLease.active, true);
    assert.equal(harness.localData.scheduledAutoApplySession.state, 'repair_pending');
    assert.equal(harness.localData.autoApplyStopReason, 'repair_pending');
    assert.equal(harness.localData.runState.runId, 'repair-run');
    assert.equal(harness.localData.runState.ownerId, 71);
    assert.equal(harness.localData.runState.found, 5);
    assert.equal(harness.localData.runState.processed, 1);
    assert.equal(harness.localData.runState.applied, 0);
    assert.equal(harness.localData.runState.alreadyApplied, 2);
    assert.equal(harness.localData.runState.skipped, 3);
    assert.equal(harness.localData.runState.errors, 0);
    assert.equal(harness.localData.runState.injected, undefined);
    harness.setVersion('1.2.4');
    const resumed = await harness.api.resumeScheduledRepair();
    assert.equal(resumed.ok, true, resumed.reason);
    assert.equal(resumed.resumed, true);
    assert.equal(harness.localData.scheduledAutoApplySession.state, 'running');
    assert.equal(harness.localData.scheduledAutoApplySession.repairAttempts, 1);
    assert.equal(harness.localData.autoApplyStopRequested, false);
  } finally {
    harness.cleanup();
  }

  const denialCases = [
    ['version_not_advanced', { version: '1.2.3' }],
    ['repair_cutoff', { now: '2026-08-16T15:01:00.000Z', version: '1.2.4' }],
    ['max_repair_attempts', { version: '1.2.4', repairAttempts: 3 }],
    ['unresolved_submit', { version: '1.2.4', autoApplyPendingSubmit: { item: { vacancyId: 'secret' } } }],
    ['unresolved_response_attempt', { version: '1.2.4', autoApplyResponseAttempts: { secret: { startedAt: '2026-08-16T08:00:00.000Z' } } }],
    ['audit_not_ready', { version: '1.2.4', auditNotReady: true }],
    ['owner_missing', { version: '1.2.4', authenticated: false }],
    ['missing_checkpoint', { version: '1.2.4', missingQueue: true }]
    ,['date_mismatch', { version: '1.2.4', dateMsk: '2026-08-15' }]
    ,['missing_checkpoint', { version: '1.2.4', ownerId: 72 }]
  ];
  for (const [reason, variant] of denialCases) {
    const pendingSession = {
      ...runningSession,
      state: 'repair_pending',
      repairFromVersion: '1.2.3',
      repairAttempts: variant.repairAttempts || 0,
      dateMsk: variant.dateMsk || runningSession.dateMsk,
      ownerId: variant.ownerId || runningSession.ownerId
    };
    const denied = await createScheduledBackgroundHarness({
      now: variant.now || '2026-08-16T08:00:00.000Z',
      version: variant.version,
      authenticated: variant.authenticated !== false,
      localData: {
        scheduledAutoApplySession: pendingSession,
        autoApplyRunLease: { active: true, runId: 'repair-run', ownerId: 71 },
        ...(variant.auditNotReady ? {
          automationSettingsAudit: { ready: false, checkedAt: '', issues: ['audit_not_ready'] }
        } : {}),
        ...(variant.missingQueue ? {} : { autoApplySearchQueue: queue }),
        ...(variant.autoApplyPendingSubmit ? { autoApplyPendingSubmit: variant.autoApplyPendingSubmit } : {}),
        ...(variant.autoApplyResponseAttempts ? { autoApplyResponseAttempts: variant.autoApplyResponseAttempts } : {}),
        runResults: [
          { vacancyId: '1', status: 'applied' },
          { vacancyId: '2', status: 'skipped' }
        ],
        runState: {
          state: 'paused',
          runId: 'repair-run',
          ownerId: 71,
          processed: 99,
          applied: 1
        }
      }
    });
    try {
      assert.equal((await denied.api.reserveScheduledRepairResume()).reason, reason, reason);
      if (
        ['repair_cutoff', 'max_repair_attempts', 'date_mismatch', 'missing_checkpoint'].includes(reason) &&
        variant.ownerId !== 72
      ) {
        assert.equal(denied.localData.autoApplyRunLease.active, false, `${reason}: lease`);
        assert.equal(denied.localData.autoApplySearchQueue?.active, false, `${reason}: queue`);
        assert.equal(denied.localData.runState.processed, 2, `${reason}: processed`);
        assert.equal(denied.localData.scheduledAutoApplySession.state, 'blocked', `${reason}: session`);
        assert.equal(denied.localData.autoApplyStopReason, reason, `${reason}: stop reason`);
      }
    } finally {
      denied.cleanup();
    }
  }
});

test('extension-update repair reload happens only after storage and version gates pass', async () => {
  const baseSession = {
    sessionId: 'scheduled:2026-08-16:update-repair',
    dateMsk: '2026-08-16',
    runId: 'update-repair-run',
    ownerId: 71,
    state: 'repair_pending',
    repairFromVersion: '1.2.3',
    repairAttempts: 0,
    reviewRequired: true
  };
  const baseQueue = {
    active: true,
    runId: baseSession.runId,
    ownerId: baseSession.ownerId,
    scheduledSessionId: baseSession.sessionId,
    scheduledDateMsk: baseSession.dateMsk
  };
  const makeHarness = (version, localData = {}) => createScheduledBackgroundHarness({
    version,
    localData: {
      scheduledAutoApplySession: baseSession,
      autoApplyRunLease: {
        active: true,
        runId: baseSession.runId,
        ownerId: baseSession.ownerId,
        scheduledRepairPending: true
      },
      autoApplySearchQueue: baseQueue,
      ...localData
    }
  });

  const sameVersion = await makeHarness('1.2.3');
  try {
    const result = await sameVersion.api.resumeScheduledRepairAfterExtensionUpdate();
    assert.equal(result.reason, 'version_not_advanced');
    assert.deepEqual(sameVersion.reloadedTabs, []);
  } finally {
    sameVersion.cleanup();
  }

  const unresolved = await makeHarness('1.2.4', {
    autoApplyPendingSubmit: {
      item: { vacancyId: 'pending' },
      runId: baseSession.runId,
      ownerId: baseSession.ownerId
    }
  });
  try {
    const result = await unresolved.api.resumeScheduledRepairAfterExtensionUpdate();
    assert.equal(result.reason, 'unresolved_submit');
    assert.deepEqual(unresolved.reloadedTabs, []);
    assert.ok(unresolved.localData.autoApplyPendingSubmit.item);
  } finally {
    unresolved.cleanup();
  }

  const valid = await makeHarness('1.2.4');
  try {
    const result = await valid.api.resumeScheduledRepairAfterExtensionUpdate();
    assert.equal(result.ok, true, result.reason);
    assert.equal(result.resumed, true);
    assert.deepEqual(valid.reloadedTabs, [71]);
  } finally {
    valid.cleanup();
  }
});

test('repair terminal gates preserve unresolved submission provenance before cleanup', async () => {
  for (const [expectedReason, sideEffect] of [
    ['unresolved_submit', { autoApplyPendingSubmit: { item: { vacancyId: 'pending' } } }],
    ['unresolved_response_attempt', {
      autoApplyResponseAttempts: { pending: { startedAt: '2026-08-16T08:00:00.000Z' } }
    }]
  ]) {
    const session = {
      sessionId: `scheduled:2026-08-15:${expectedReason}`,
      dateMsk: '2026-08-15',
      runId: 'repair-side-effect',
      ownerId: 71,
      state: 'repair_pending',
      repairFromVersion: '1.2.3',
      repairAttempts: 3,
      reviewRequired: true
    };
    const queue = {
      active: true,
      runId: session.runId,
      ownerId: session.ownerId,
      scheduledSessionId: session.sessionId,
      scheduledDateMsk: session.dateMsk
    };
    const harness = await createScheduledBackgroundHarness({
      version: '1.2.4',
      localData: {
        scheduledAutoApplySession: session,
        autoApplyRunLease: { active: true, runId: session.runId, ownerId: session.ownerId },
        autoApplySearchQueue: queue,
        ...sideEffect
      }
    });
    try {
      const result = await harness.api.reserveScheduledRepairResume();
      assert.equal(result.reason, expectedReason);
      assert.equal(harness.localData.scheduledAutoApplySession.state, 'repair_pending');
      assert.equal(harness.localData.autoApplyRunLease.active, true);
      assert.equal(harness.localData.autoApplySearchQueue.active, true);
    } finally {
      harness.cleanup();
    }
  }
});

test('failed scheduled repair continuation atomically restores the repair checkpoint', async () => {
  for (const [continueBehavior, expectedReason] of [
    ['reject', 'continue_rejected'],
    ['throw', 'continue_unreachable']
  ]) {
    const session = {
      sessionId: `scheduled:2026-08-16:${continueBehavior}`,
      dateMsk: '2026-08-16',
      runId: `repair-${continueBehavior}`,
      ownerId: 71,
      filterUrl: 'https://hh.ru/search/vacancy?text=opaque',
      extensionVersion: '1.2.3',
      state: 'repair_pending',
      repairAttempts: 0,
      repairFromVersion: '1.2.3',
      reviewRequired: true,
      reviewedAt: ''
    };
    const queue = {
      active: true,
      runId: session.runId,
      ownerId: session.ownerId,
      scheduledSessionId: session.sessionId,
      scheduledDateMsk: session.dateMsk
    };
    const harness = await createScheduledBackgroundHarness({
      version: '1.2.4',
      continueBehavior,
      localData: {
        scheduledAutoApplySession: session,
        autoApplyRunLease: {
          active: true,
          runId: session.runId,
          ownerId: session.ownerId,
          scheduledRepairPending: true
        },
        autoApplySearchQueue: queue,
        autoApplyStopRequested: true,
        autoApplyStopReason: 'repair_pending'
      }
    });
    try {
      const result = await harness.api.resumeScheduledRepair();
      assert.equal(result.ok, false);
      assert.equal(result.reason, expectedReason);
      assert.equal(harness.localData.scheduledAutoApplySession.state, 'repair_pending');
      assert.equal(harness.localData.scheduledAutoApplySession.stopReason, 'repair_pending');
      assert.equal(harness.localData.autoApplyRunLease.active, true);
      assert.equal(harness.localData.autoApplyRunLease.scheduledRepairPending, true);
      assert.equal(harness.localData.autoApplyStopRequested, true);
      assert.equal(harness.localData.autoApplyStopReason, 'repair_pending');
      assert.equal(harness.localData.autoApplySearchQueue.active, true);
    } finally {
      harness.cleanup();
    }
  }
});

test('failed repair continuation without a checkpoint terminally cleans owned provenance', async () => {
  const session = {
    sessionId: 'scheduled:2026-08-16:lost-checkpoint',
    dateMsk: '2026-08-16',
    runId: 'repair-lost-checkpoint',
    ownerId: 71,
    state: 'repair_pending',
    repairFromVersion: '1.2.3',
    repairAttempts: 0,
    reviewRequired: true
  };
  const harness = await createScheduledBackgroundHarness({
    version: '1.2.4',
    continueBehavior: 'reject_without_checkpoint',
    localData: {
      scheduledAutoApplySession: session,
      autoApplyRunLease: {
        active: true,
        runId: session.runId,
        ownerId: session.ownerId,
        scheduledRepairPending: true
      },
      autoApplySearchQueue: {
        active: true,
        runId: session.runId,
        ownerId: session.ownerId,
        scheduledSessionId: session.sessionId,
        scheduledDateMsk: session.dateMsk
      },
      runResults: [{ vacancyId: '1', status: 'applied' }],
      runState: {
        state: 'paused',
        runId: session.runId,
        ownerId: session.ownerId,
        processed: 99
      }
    }
  });
  try {
    const result = await harness.api.resumeScheduledRepair();
    assert.equal(result.reason, 'continue_rejected');
    assert.equal(harness.localData.scheduledAutoApplySession.state, 'blocked');
    assert.equal(harness.localData.scheduledAutoApplySession.stopReason, 'missing_checkpoint');
    assert.equal(harness.localData.autoApplyRunLease.active, false);
    assert.equal(harness.localData.autoApplySearchQueue.active, false);
    assert.equal(harness.localData.runState.processed, 1);
    assert.equal(harness.localData.autoApplyStopReason, 'missing_checkpoint');
  } finally {
    harness.cleanup();
  }
});
