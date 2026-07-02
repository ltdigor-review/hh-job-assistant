import assert from 'node:assert/strict';
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

test('manifest is valid MV3 and exposes popup UI', async () => {
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
  assert.deepEqual(manifest.content_scripts[0].matches, ['https://hh.ru/*', 'https://*.hh.ru/*']);
  assert.deepEqual(manifest.content_scripts[0].js, [
    'src/agent-log.js',
    'src/error-text.js',
    'src/action-overlay.js',
    'src/defaults.js',
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

  assert.match(defaultsSource, /dailyLimit:\s*100/);
  assert.match(defaultsSource, /delayMinMs:\s*4000/);
  assert.match(defaultsSource, /delayMaxMs:\s*8000/);
  assert.match(defaultsSource, /employmentPreference:\s*\[\]/);
  assert.match(defaultsSource, /workFormatPreference:\s*\[\]/);
  assert.match(defaultsSource, /agentDebugLogsEnabled:\s*false/);
  assert.doesNotMatch(defaultsSource, /experimentalFeaturesEnabled|chatUnreadOnly|chatReplyMode|chatLimit|chatReports/);
  assert.match(defaultsSource, /globalThis\.HHJA_DEFAULTS/);

  assert.match(backgroundSource, /import '\.\/defaults\.js'/);
  assert.match(backgroundSource, /const DEFAULTS = globalThis\.HHJA_DEFAULTS/);
  assert.match(optionsHtml, /<script src="defaults\.js"><\/script>\s*<script src="options\.js"><\/script>/);
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

test('background service worker avoids top-level await', async () => {
  const js = await readFile(new URL('src/background.js', root), 'utf8');

  assert.doesNotMatch(js.trim(), /await\s+ensureDefaults\(\);?$/);
  assert.match(js, /ensureDefaults\(\)\.catch/);
});

test('background initializes defaults and registers required listeners', async () => {
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
  assert.equal(localData.dailyLimit, 100);
  assert.equal(localData.delayMinMs, 4000);
  assert.equal(localData.delayMaxMs, 8000);
  assert.match(localData.coverPrompt, /до 450 символов/);
  assert.match(localData.coverPrompt, /Не пересказывай резюме или вакансию/);
  assert.match(localData.employerQuestionPrompt, /не пиши, что опыта нет/);
  assert.match(localData.employerQuestionPrompt, /близкого опыта/);
  assert.deepEqual(localData.employmentPreference, []);
  assert.deepEqual(localData.workFormatPreference, []);
  assert.equal(localData.autoApplyStopRequested, false);
  assert.equal(localData.autoApplyStopRequestedAt, '');
  assert.ok(calls.some(([name]) => name === 'runtime.onMessage'));
  assert.ok(calls.some(([name]) => name === 'commands.onCommand'));
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

test('background response watchdog leaves active form processing alone', async () => {
  let onUpdatedListener = null;
  let alarmListener = null;
  let createdAlarm = null;
  let tabUpdateCalls = 0;
  const responseUrl = 'https://hh.ru/applicant/vacancy_response?vacancyId=123&employerId=456';
  const sourceUrl = 'https://hh.ru/search/vacancy?resume=abc';
  const localData = {
    autoApplyQueue: {
      active: true,
      returnToSearch: true,
      sourceUrl,
      index: 0,
      items: [{ index: 1, vacancyId: '123', title: 'QA', url: 'https://hh.ru/vacancy/123' }],
      counters: { found: 1, processed: 1, applied: 0, skipped: 0, errors: 0 }
    },
    autoApplySearchQueue: { active: false },
    runState: {
      state: 'filling_cover_letter',
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
    await onUpdatedListener(7, { url: responseUrl }, { id: 7, url: responseUrl });
    assert.equal(createdAlarm.name, 'hhja-response-navigation-watchdog');
    assert.equal(localData.responseNavigationWatchdog.tabId, 7);
    await alarmListener({ name: 'hhja-response-navigation-watchdog' });

    assert.equal(tabUpdateCalls, 0);
    assert.equal(localData.autoApplyQueue.active, true);
    assert.equal(localData.runResults.length, 0);
    assert.equal(localData.runState.state, 'filling_cover_letter');
  } finally {
    delete globalThis.__HH_JOB_ASSISTANT_TEST_RESPONSE_WATCHDOG_MS__;
  }
});

test('test assistance prompt includes resume, vacancy, question text, and expected salary', async () => {
  let listener = null;
  let requestBody = null;
  const localData = {
    groqApiKey: 'gsk_test',
    groqModel: 'test-model',
    resumeText: 'Relevant profile with adjacent experience and delivery tools',
    expectedSalary: '250 000 руб. на руки',
    employmentPreference: [],
    workFormatPreference: [],
    coverPrompt: 'cover prompt',
    employerQuestionPrompt: 'custom employer question prompt: use adjacent experience and draft a relevant case',
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
          choices: [{ finish_reason: 'stop', message: { content: 'Ответ' } }],
          usage: { prompt_tokens: 1234, completion_tokens: 63, total_tokens: 1297 }
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
        extraText: 'Какую зарплату ожидаете?'
      },
      {},
      resolve
    );
    assert.equal(stayedAsync, true);
  });

  assert.equal(response.ok, true);
  assert.equal(requestBody.model, 'test-model');
  assert.equal(requestBody.max_tokens, 700);
  const userContent = requestBody.messages.find((message) => message.role === 'user').content;
  assert.match(userContent, /Relevant profile with adjacent experience and delivery tools/);
  assert.match(userContent, /250 000 руб\. на руки/);
  assert.match(userContent, /Оформление: предпочтение не выбрано/);
  assert.match(userContent, /Формат работы: предпочтение не выбрано/);
  assert.match(userContent, /Вакансия: роль со смежными требованиями/);
  assert.match(userContent, /Какую зарплату ожидаете\?/);
  const systemContent = requestBody.messages.find((message) => message.role === 'system').content;
  assert.match(systemContent, /custom employer question prompt/);
  assert.match(systemContent, /adjacent experience/);
  assert.match(systemContent, /draft a relevant case/);
  assert.match(systemContent, /avoid generic lists of learning methods\/tools/);
  assert.match(systemContent, /Avoid first-person pronouns/);
  assert.match(systemContent, /exact option label/);
  assert.doesNotMatch(systemContent, /Do not invent facts/);
  assert.match(systemContent, /Do not end text drafts with a period/);
  const groqPayloadLog = localData.agentDebugLog.find((entry) => entry.event === 'groq_request_payload');
  const groqResponseLog = localData.agentDebugLog.find((entry) => entry.event === 'groq_response_payload');
  assert.equal(groqPayloadLog.details.task, 'test_assist');
  assert.equal(groqPayloadLog.details.model, 'test-model');
  assert.deepEqual(groqPayloadLog.details.messageLengths, requestBody.messages.map((message) => ({
    role: message.role,
    contentLength: message.content.length
  })));
  assert.equal(groqPayloadLog.details.componentLengths.resumeBrief, 'Relevant profile with adjacent experience and delivery tools'.length);
  assert.equal(groqPayloadLog.details.componentLengths.employerQuestionPrompt, 'custom employer question prompt: use adjacent experience and draft a relevant case'.length);
  assert.equal(groqPayloadLog.details.componentLengths.vacancy, 'Вакансия: роль со смежными требованиями'.length);
  assert.equal(groqPayloadLog.details.resumeBriefVersion, 'resume-brief-v1');
  assert.equal(groqPayloadLog.details.requestBody, undefined);
  assert.doesNotMatch(JSON.stringify(groqPayloadLog.details), /Relevant profile with adjacent experience and delivery tools/);
  assert.doesNotMatch(JSON.stringify(groqPayloadLog.details), /250 000 руб\. на руки/);
  assert.doesNotMatch(JSON.stringify(groqPayloadLog.details), /custom employer question prompt/);
  assert.doesNotMatch(JSON.stringify(groqPayloadLog.details), /Вакансия: роль со смежными требованиями/);
  assert.doesNotMatch(JSON.stringify(groqPayloadLog.details), /Какую зарплату ожидаете\?/);
  assert.doesNotMatch(JSON.stringify(groqPayloadLog.details), /gsk_test/);
  assert.equal(groqResponseLog.details.responseLength, 'Ответ'.length);
  assert.equal(groqResponseLog.details.content, undefined);
  assert.equal(groqResponseLog.details.responseBody, undefined);
  assert.match(groqResponseLog.details.responseHash, /^[0-9a-f]{8}$/);
  assert.equal(groqResponseLog.details.finishReason, 'stop');
  assert.equal(groqResponseLog.details.choiceCount, 1);
  assert.equal(groqResponseLog.details.attempt, 1);
  assert.deepEqual(groqResponseLog.details.usage, {
    promptTokens: 1234,
    completionTokens: 63,
    totalTokens: 1297
  });
  assert.doesNotMatch(JSON.stringify(groqResponseLog.details), /gsk_test|rawResponse|responsePreview/);
});

test('default employer question prompt tells Groq to synthesize case from adjacent experience', async () => {
  let listener = null;
  let requestBody = null;
  const localData = {
    groqApiKey: 'gsk_test',
    groqModel: 'test-model',
    resumeText: 'Specialist with adjacent tools, delivery experience, integrations, and user-facing product checks',
    expectedSalary: '',
    employmentPreference: '',
    workFormatPreference: '',
    coverPrompt: 'cover prompt',
    employerQuestionPrompt: '',
    agentDebugLog: [],
    agentDebugLogsEnabled: true
  };

  globalThis.fetch = async (url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return {
          choices: [{ finish_reason: 'stop', message: { content: 'Text question 1: Работал с похожими задачами через смежный опыт, инструменты кандидата, проверки пользовательских сценариев и интеграций' } }]
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
        extraText: 'Text question 1: Опишите релевантный опыт в похожем направлении'
      },
      {},
      resolve
    );
    assert.equal(stayedAsync, true);
  });

  assert.equal(response.ok, true);
  const systemContent = requestBody.messages.find((message) => message.role === 'system').content;
  const userContent = requestBody.messages.find((message) => message.role === 'user').content;
  assert.match(systemContent, /не пиши, что опыта нет/);
  assert.match(systemContent, /придумай уверенный релевантный кейс/);
  assert.match(systemContent, /близкого опыта/);
  assert.doesNotMatch(systemContent, /QA|Selenium|Playwright|игр|игров/i);
  assert.match(systemContent, /Text question N: <draft>/);
  assert.match(userContent, /adjacent tools/);
  assert.match(userContent, /релевантный опыт/);
});

test('Groq empty 200 response is retried once before returning text', async () => {
  let listener = null;
  let calls = 0;
  const maxTokensByCall = [];
  const localData = {
    groqApiKey: 'gsk_test',
    groqModel: 'test-model',
    resumeText: 'Java developer, Spring Boot',
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
          choices: [{ message: { content: calls === 1 ? '' : 'Ответ после повтора' }, finish_reason: calls === 1 ? 'length' : 'stop' }]
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

  const response = await new Promise((resolve) => {
    const stayedAsync = listener({ type: 'GENERATE_COVER_LETTER', vacancyText: 'Вакансия: Java developer' }, {}, resolve);
    assert.equal(stayedAsync, true);
  });

  assert.equal(response.ok, true);
  assert.equal(response.text, 'Ответ после повтора');
  assert.equal(calls, 2);
  assert.deepEqual(maxTokensByCall, [500, 800]);
  const emptyErrorLog = localData.agentDebugLog.find((entry) => entry.event === 'groq_request_error' && entry.details.error === 'empty_response');
  const responseLog = localData.agentDebugLog.find((entry) => entry.event === 'groq_response_payload');
  assert.equal(emptyErrorLog.details.attempt, 1);
  assert.equal(emptyErrorLog.details.maxTokens, 500);
  assert.equal(emptyErrorLog.details.maxAttempts, 2);
  assert.equal(responseLog.details.finishReason, 'stop');
  assert.equal(responseLog.details.attempt, 2);
});

test('Groq empty response reports task, finish reason, attempts, and token cap', async () => {
  let listener = null;
  const localData = {
    groqApiKey: 'gsk_test',
    groqModel: 'test-model',
    resumeText: 'Java developer, Spring Boot',
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

  const response = await new Promise((resolve) => {
    const stayedAsync = listener(
      { type: 'GENERATE_COVER_LETTER', task: 'choice_retry', extraText: 'Choice group 1:\n1. Да\n2. Нет' },
      {},
      resolve
    );
    assert.equal(stayedAsync, true);
  });

  assert.equal(response.ok, false);
  assert.match(response.error, /задача: уточнение вариантов HH/);
  assert.match(response.error, /finish_reason=length/);
  assert.match(response.error, /попытки 2\/2/);
  assert.match(response.error, /max_tokens=300/);
  assert.match(response.error, /completion_tokens=300/);
  const emptyErrorLogs = localData.agentDebugLog.filter((entry) => entry.event === 'groq_request_error' && entry.details.error === 'empty_response');
  assert.equal(emptyErrorLogs.length, 2);
  assert.equal(emptyErrorLogs.at(-1).details.finishReason, 'length');
  assert.equal(emptyErrorLogs.at(-1).details.maxTokens, 300);
  assert.equal(emptyErrorLogs.at(-1).details.usage.completionTokens, 300);
  assert.equal(emptyErrorLogs.at(-1).details.responseBody, undefined);
  assert.equal(emptyErrorLogs.at(-1).details.responseSummary.choices[0].finishReason, 'length');
  assert.equal(emptyErrorLogs.at(-1).details.responseSummary.choices[0].contentLength, 0);
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
  const userContent = requestBody.messages.find((message) => message.role === 'user').content;
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

test('Groq prompt rebuilds stale resume brief and keeps original parsed resume unchanged', async () => {
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

test('Groq prompt caps large payload components', async () => {
  let listener = null;
  let requestBody = null;
  const longResume = [
    'Java Team Lead',
    'Spring Boot PostgreSQL Kafka Kubernetes',
    ...Array.from({ length: 300 }, (_, index) => `Проект ${index}: разработка backend систем и автоматизация процессов`)
  ].join('\n');
  const longVacancy = Array.from({ length: 200 }, (_, index) => `Вакансия строка ${index}: Java Spring SQL Kafka`).join('\n');
  const longExtra = Array.from({ length: 200 }, (_, index) => `Text question ${index}: Расскажите про опыт`).join('\n');
  const localData = {
    groqApiKey: 'gsk_test',
    groqModel: 'test-model',
    resumeText: longResume,
    expectedSalary: '250000',
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
        return { choices: [{ message: { content: 'Ответ' } }] };
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
        vacancyText: longVacancy,
        extraText: longExtra
      },
      {},
      resolve
    );
    assert.equal(stayedAsync, true);
  });

  assert.equal(response.ok, true);
  assert.equal(requestBody.max_tokens, 700);
  const groqPayloadLog = localData.agentDebugLog.find((entry) => entry.event === 'groq_request_payload');
  assert.ok(groqPayloadLog.details.componentLengths.resumeBrief <= 1800);
  assert.ok(groqPayloadLog.details.componentLengths.vacancy <= 2200);
  assert.ok(groqPayloadLog.details.componentLengths.extra <= 2200);
  assert.ok(requestBody.messages.reduce((sum, message) => sum + message.content.length, 0) < longResume.length + longVacancy.length + longExtra.length);
});

test('Groq 429 response stores cooldown from retry-after', async () => {
  let listener = null;
  const localData = {
    groqApiKey: 'gsk_test',
    groqModel: 'test-model',
    resumeText: 'Java developer',
    expectedSalary: '',
    coverPrompt: 'cover prompt',
    agentDebugLog: [],
    agentDebugLogsEnabled: true
  };

  globalThis.fetch = async () => ({
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

  assert.equal(response.ok, false);
  assert.ok(Date.parse(localData.groqCooldownUntil) > Date.now());
  assert.ok(localData.agentDebugLog.some((entry) => entry.event === 'groq_rate_limit_cooldown'));
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
  assert.match(js, /key === 'groqApiKey' \? Boolean/);
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
  assert.match(js, /agentDebugLogText/);
  assert.match(js, /agentDebugLogFile/);
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

  assert.match(agents, /Analyze extension logs from local Chrome\/Chromium profile storage/);
  assert.match(agents, /agentDebugLogFile/);
  assert.match(agents, /agentDebugLogText/);
  assert.match(agents, /authorized hh\.ru profile/);

  assert.doesNotMatch(checklist, /Logs\/debug section|Inspect Agent debug|debug clear|Agent debug shows/);
  assert.doesNotMatch(background, /RESET_AGENT_DEBUG_LOG|SYNC_AGENT_DEBUG_FILE/);
});

test('popup has ordered controls wired to Groq key, version, results, and actions', async () => {
  const html = await readFile(new URL('src/popup.html', root), 'utf8');
  const js = await readFile(new URL('src/popup.js', root), 'utf8');

  for (const id of ['appStatus', 'appStatusDot', 'appStatusTitle', 'appStatusDetail', 'currentAction', 'autoApply', 'continueApply', 'stop', 'refreshResumes', 'openOptions', 'version', 'applied', 'skipped', 'errors', 'recentResults']) {
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
  assert.doesNotMatch(html, /id="copyStatus"|Копировать статус/);
  assert.doesNotMatch(js, /copyStatus|lastStatusCopyText/);
  for (const removedId of ['dryRun', 'groqApiKey', 'saveGroqKey', 'testGroq', 'extensionStatus', 'tabStatus', 'agentDebugLog', 'clearAgentDebugLog', 'currentActionDetail', 'chatAssist', 'chatReportsSection', 'chatReports', 'clearReports']) {
    assert.doesNotMatch(html, new RegExp(`id="${removedId}"`));
  }
  assert.match(html, /\.action-title\s*\{[^}]*font-size:\s*13px/s);
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
});

test('agent debug log is a timestamped local profile artifact outside the popup', async () => {
  const js = await readFile(new URL('src/agent-log.js', root), 'utf8');
  const background = await readFile(new URL('src/background.js', root), 'utf8');
  const content = await readFile(new URL('src/content-hh.js', root), 'utf8');
  const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));

  assert.match(js, /agentDebugLogFile/);
  assert.match(js, /agentDebugLogText/);
  assert.match(js, /agentDebugLogsEnabled/);
  assert.match(js, /setting\?\.\[ENABLED_KEY\] !== true/);
  assert.match(js, /function reset/);
  assert.match(js, /hh-job-assistant-\$\{formatTimestampForFile/);
  assert.match(js, /\.debug/);
  assert.match(js, /JSON\.stringify/);
  assert.doesNotMatch(js, /chromeApi\?\.downloads|removeFile|conflictAction|offscreen|downloadId/);
  assert.match(background, /HHJobAssistantLog\?\.reset\?\./);
  assert.match(content, /HHJobAssistantLog\?\.reset\?\./);
  assert.ok(!manifest.permissions.includes('downloads'));
  assert.ok(!manifest.permissions.includes('offscreen'));
});

test('agent debug log writes only when explicitly enabled', async () => {
  const source = await readFile(new URL('src/agent-log.js', root), 'utf8');
  const storage = { agentDebugLogsEnabled: false };
  const writes = [];
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
          writes.push(value);
          Object.assign(storage, value);
        }
      }
    }
  };

  try {
    await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#agent-log-disabled-${crypto.randomUUID()}`);
    await globalThis.HHJobAssistantLog.append('test', 'disabled_append', { value: 1 });
    await globalThis.HHJobAssistantLog.reset('test', 'disabled_reset', { runId: 'run-1' });

    assert.deepEqual(writes, []);
    assert.equal(storage.agentDebugLog, undefined);
    assert.equal(storage.agentDebugLogFile, undefined);
    assert.equal(storage.agentDebugLogText, undefined);

    storage.agentDebugLogsEnabled = true;
    await globalThis.HHJobAssistantLog.append('test', 'enabled_append', {
      value: 2,
      message: 'Authorization: Bearer gsk_value_token',
      url: 'https://api.example.test/path?key=gsk_query_token&safe=1',
      nested: { apiKey: 'gsk_key_token' }
    });

    assert.equal(Array.isArray(storage.agentDebugLog), true);
    assert.equal(storage.agentDebugLog[0].event, 'enabled_append');
    assert.match(storage.agentDebugLogText, /enabled_append/);
    assert.doesNotMatch(storage.agentDebugLogText, /gsk_value_token|gsk_query_token|gsk_key_token/);
    assert.match(storage.agentDebugLogText, /\[redacted\]/);
    assert.doesNotMatch(JSON.stringify(storage.agentDebugLog), /gsk_value_token|gsk_query_token|gsk_key_token/);
    assert.match(JSON.stringify(storage.agentDebugLog), /\[redacted\]/);
  } finally {
    delete globalThis.chrome;
    delete globalThis.HHJobAssistantLog;
  }
});

test('popup view model reports exact readiness and blocker text', async () => {
  const { derivePopupView } = await import(new URL('src/popup-view.js', root));

  assert.deepEqual(
    derivePopupView({
      runState: { state: 'idle' },
      tabState: { kind: 'ready', canStartAutoApply: true },
      hasGroqKey: true
    }).status,
    { tone: 'ok', title: 'ГОТОВО', detail: 'hh.ru открыт · Groq подключен' }
  );

  const withoutGroq = derivePopupView({
    runState: { state: 'idle' },
    tabState: { kind: 'ready', canStartAutoApply: true },
    hasGroqKey: false
  });
  assert.equal(withoutGroq.status.tone, 'warn');
  assert.equal(withoutGroq.status.title, 'ГОТОВО, без автоответов');
  assert.equal(withoutGroq.status.detail, 'Вакансии с письмами/вопросами будут пропущены');
  assert.equal(withoutGroq.buttons.autoApplyDisabled, false);
  assert.equal(withoutGroq.buttons.refreshResumesDisabled, false);

  const wrongHhPage = derivePopupView({
    runState: { state: 'idle' },
    tabState: { kind: 'ready', canStartAutoApply: false },
    hasGroqKey: true
  });
  assert.deepEqual(wrongHhPage.status, {
    tone: 'warn',
    title: 'Откройте поиск вакансий',
    detail: 'Запуск откликов доступен со страницы https://hh.ru/search/vacancy?...'
  });
  assert.equal(wrongHhPage.buttons.autoApplyDisabled, true);
  assert.equal(wrongHhPage.buttons.stopDisabled, true);

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
  assert.equal(wrongHhPage.buttons.autoApplyTitle, 'Откройте страницу https://hh.ru/search/vacancy?...');
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

test('options preserve masked Groq key unless user edits the key field', async () => {
  const source = await readFile(new URL('src/options.js', root), 'utf8');
  const handlers = new Map();
  const storage = {
    groqApiKey: 'gsk_saved',
    groqModel: 'llama-3.3-70b-versatile',
    resumeUrl: '',
    resumeCacheTtlHours: 1,
    expectedSalary: '',
    employmentPreference: '',
    workFormatPreference: '',
    coverPrompt: '',
    employerQuestionPrompt: '',
    dailyLimit: 100,
    delayMinMs: 4000,
    delayMaxMs: 8000,
    agentDebugLogsEnabled: false
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
      querySelectorAll(selector) {
        return selector === 'input[type="checkbox"]' ? this.inputs : [];
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

  const ids = ['groqApiKey', 'groqModel', 'resumeUrl', 'resumeCacheTtlHours', 'expectedSalary', 'employmentPreference', 'workFormatPreference', 'coverPrompt', 'employerQuestionPrompt', 'dailyLimit', 'delayMinMs', 'delayMaxMs', 'agentDebugLogsEnabled', 'status', 'save', 'testGroq'];
  const elements = Object.fromEntries(ids.map((id) => [id, makeElement(id)]));

  globalThis.HHJA_DEFAULTS = {
    groqModel: 'llama-3.3-70b-versatile',
    resumeText: '',
    resumeUrl: '',
    resumeParsedText: '',
    resumeParsedAt: '',
    resumeParsedUrl: '',
    resumeCacheTtlHours: 1,
    expectedSalary: '',
    employmentPreference: [],
    workFormatPreference: [],
    coverPrompt: 'default prompt',
    employerQuestionPrompt: 'default employer prompt',
    dailyLimit: 100,
    delayMinMs: 4000,
    delayMaxMs: 8000,
    agentDebugLogsEnabled: false,
    runState: {},
    autoApplyStopRequested: false,
    autoApplyStopRequestedAt: '',
    runResults: []
  };
  globalThis.HHJA_LOCALIZE_ERROR = (error, fallback) => fallback || String(error);
  globalThis.document = {
    getElementById(id) {
      return elements[id] || null;
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
      async sendMessage() {
        return { ok: true, sampleLength: 2 };
      }
    }
  };

  try {
    await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#options-${crypto.randomUUID()}`);
    await new Promise((resolve) => setTimeout(resolve, 0));

    handlers.get('groqApiKey:focus')();
    await handlers.get('save:click')();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(storage.groqApiKey, 'gsk_saved');
    assert.equal(storage.dailyLimit, 100);
    assert.deepEqual(storage.employmentPreference, []);
    assert.deepEqual(storage.workFormatPreference, []);
    assert.equal(storage.employerQuestionPrompt, 'default employer prompt');

    elements.dailyLimit.value = '250';
    await handlers.get('save:click')();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(storage.dailyLimit, 200);

    elements.employmentPreference.inputs[1].checked = true;
    elements.workFormatPreference.inputs[0].checked = true;
    elements.workFormatPreference.inputs[1].checked = true;
    elements.employerQuestionPrompt.value = 'custom employer prompt';
    await handlers.get('save:click')();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(storage.employmentPreference, ['labor_contract']);
    assert.deepEqual(storage.workFormatPreference, ['remote', 'hybrid']);
    assert.equal(storage.employerQuestionPrompt, 'custom employer prompt');

    handlers.get('groqApiKey:focus')();
    elements.groqApiKey.value = 'gsk_new';
    handlers.get('groqApiKey:input')();
    await handlers.get('save:click')();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(storage.groqApiKey, 'gsk_new');

    handlers.get('groqApiKey:focus')();
    elements.groqApiKey.value = '';
    handlers.get('groqApiKey:input')();
    await handlers.get('save:click')();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(storage.groqApiKey, '');
  } finally {
    delete globalThis.HHJA_DEFAULTS;
    delete globalThis.HHJA_LOCALIZE_ERROR;
    delete globalThis.document;
    delete globalThis.chrome;
  }
});

test('options use hh resume URL instead of pasted resume text or daily refresh toggle', async () => {
  const html = await readFile(new URL('src/options.html', root), 'utf8');
  const js = await readFile(new URL('src/options.js', root), 'utf8');

  assert.match(html, /id="resumeUrl"/);
  assert.match(html, /id="resumeCacheTtlHours" type="number" min="0.1" step="0.5"/);
  assert.match(html, /<fieldset class="preference-field" id="employmentPreference">/);
  assert.match(html, /value="individual_entrepreneur">\s*<span>ИП<\/span>/);
  assert.match(html, /value="labor_contract">\s*<span>ТК<\/span>/);
  assert.match(html, /<fieldset class="preference-field" id="workFormatPreference">/);
  assert.doesNotMatch(html, /<select id="employmentPreference"|<select id="workFormatPreference"|multiple size=/);
  assert.match(html, /value="remote">\s*<span>Удаленка<\/span>/);
  assert.match(html, /value="hybrid">\s*<span>Гибрид<\/span>/);
  assert.doesNotMatch(html, /value="any">Любой|<option value="">Не выбрано<\/option>/);
  assert.match(html, /id="agentDebugLogsEnabled"/);
  assert.match(html, /<h2>Промпты<\/h2>/);
  assert.ok(html.indexOf('<h2>Groq API</h2>') < html.indexOf('<h2>Промпты</h2>'));
  assert.match(html, /id="coverPrompt"/);
  assert.match(html, /id="employerQuestionPrompt"/);
  assert.match(html, /Логи/);
  assert.match(html, /<div class="field-action">\s*<button id="testGroq" class="secondary" type="button">Проверить Groq<\/button>\s*<\/div>/);
  assert.match(html, /<div class="actions">\s*<button id="save" type="button">Сохранить<\/button>\s*<\/div>/);
  assert.ok(html.indexOf('id="testGroq"') < html.indexOf('<div class="actions">'));
  assert.match(html, /\.switch-track/);
  assert.match(html, /id="delayMinMs" type="number" min="500" step="250"/);
  assert.match(html, /id="delayMaxMs" type="number" min="500" step="250"/);
  assert.match(js, /resumeUrl/);
  assert.match(js, /resumeCacheTtlHours/);
  assert.match(js, /employmentPreference/);
  assert.match(js, /workFormatPreference/);
  assert.match(js, /employerQuestionPrompt/);
  assert.match(js, /new URL\(normalizedResumeUrl\)/);
  assert.match(js, /setCustomValidity\('Укажите ссылку на резюме hh\.ru вида https:\/\/hh\.ru\/resume\/\.\.\.'\)/);
  assert.match(js, /savedGroqKeyMasked/);
  assert.match(js, /groqKeyDirty/);
  assert.match(js, /fields\.groqApiKey\.dataset\.masked !== 'true' && \(!savedGroqKeyMasked \|\| groqKeyDirty\)/);
  assert.match(js, /Math\.max\(0\.1/);
  assert.match(js, /agentDebugLogsEnabled/);
  assert.match(js, /fields\.agentDebugLogsEnabled\.checked = values\.agentDebugLogsEnabled === true/);
  assert.match(js, /agentDebugLogsEnabled: fields\.agentDebugLogsEnabled\.checked/);
  assert.match(js, /chrome\.storage\.local\.remove\(\['agentDebugLog', 'agentDebugLogFile', 'agentDebugLogText'\]\)/);
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

test('options expose Groq production text model choices', async () => {
  const html = await readFile(new URL('src/options.html', root), 'utf8');
  const js = await readFile(new URL('src/options.js', root), 'utf8');

  assert.match(html, /<select id="groqModel">/);
  for (const model of [
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
    'openai/gpt-oss-120b',
    'openai/gpt-oss-20b'
  ]) {
    assert.match(html, new RegExp(`value="${model.replace('/', '\\/')}"`));
    assert.match(js, new RegExp(model.replace('/', '\\/')));
  }
  assert.doesNotMatch(html, /<input id="groqModel"/);
});
