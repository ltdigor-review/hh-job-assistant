import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
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
  assert.ok(manifest.permissions.includes('tabs'));
  assert.ok(manifest.permissions.includes('scripting'));
  assert.ok(!manifest.permissions.includes('windows'));
  assert.ok(!manifest.permissions.includes('alarms'));
  assert.ok(manifest.host_permissions.includes('https://hh.ru/*'));
  assert.ok(manifest.host_permissions.includes('https://*.hh.ru/*'));
  assert.ok(manifest.host_permissions.includes('https://api.groq.com/*'));
  assert.deepEqual(manifest.content_scripts[0].matches, ['https://hh.ru/*', 'https://*.hh.ru/*']);
  assert.deepEqual(manifest.content_scripts[0].js, ['src/agent-log.js', 'src/content-hh.js']);
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
    'src/background.js',
    'src/content-hh.js',
    'src/options.js',
    'src/popup.js',
    'scripts/inspect-extension-log.mjs',
    'scripts/start-extension-auto-apply.mjs',
    'scripts/hh-live-smoke.mjs'
  ];

  for (const file of files) {
    await execFileAsync(process.execPath, ['--check', file], {
      cwd: new URL('.', root)
    });
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

  assert.equal(localData.groqModel, 'llama-3.3-70b-versatile');
  assert.equal(localData.expectedSalary, '');
  assert.equal(localData.resumeUrl, '');
  assert.equal(localData.dailyLimit, 20);
  assert.equal(localData.delayMinMs, 2500);
  assert.equal(localData.delayMaxMs, 5000);
  assert.equal(localData.chatUnreadOnly, true);
  assert.equal(localData.chatReplyMode, 'draft');
  assert.equal(localData.chatLimit, 10);
  assert.deepEqual(localData.chatReports, []);
  assert.ok(calls.some(([name]) => name === 'runtime.onMessage'));
  assert.ok(calls.some(([name]) => name === 'commands.onCommand'));
});

test('test assistance prompt includes resume, vacancy, question text, and expected salary', async () => {
  let listener = null;
  let requestBody = null;

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
          const data = {
            groqApiKey: 'gsk_test',
            groqModel: 'test-model',
            resumeText: 'Java developer, Spring Boot',
            expectedSalary: '250 000 руб. на руки',
            coverPrompt: 'cover prompt'
          };
          if (Array.isArray(keys)) {
            return Object.fromEntries(keys.map((key) => [key, data[key]]));
          }
          return {};
        },
        async set() {}
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
        vacancyText: 'Вакансия: Java developer',
        extraText: 'Какую зарплату ожидаете?'
      },
      {},
      resolve
    );
    assert.equal(stayedAsync, true);
  });

  assert.equal(response.ok, true);
  assert.equal(requestBody.model, 'test-model');
  const userContent = requestBody.messages.find((message) => message.role === 'user').content;
  assert.match(userContent, /Java developer, Spring Boot/);
  assert.match(userContent, /250 000 руб\. на руки/);
  assert.match(userContent, /Вакансия: Java developer/);
  assert.match(userContent, /Какую зарплату ожидаете\?/);
  const systemContent = requestBody.messages.find((message) => message.role === 'system').content;
  assert.match(systemContent, /Avoid first-person pronouns/);
  assert.match(systemContent, /делал/);
  assert.match(systemContent, /not ultra-short fragments/);
});

test('chat reply prompt includes resume, vacancy, chat question, and expected salary', async () => {
  let listener = null;
  let requestBody = null;

  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return { choices: [{ message: { content: 'Здравствуйте, готов обсудить.' } }] };
      }
    };
  };

  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) {
          const data = {
            groqApiKey: 'gsk_test',
            groqModel: 'test-model',
            resumeText: 'Java developer, Spring Boot',
            expectedSalary: '250 000 руб. на руки',
            coverPrompt: 'cover prompt'
          };
          if (Array.isArray(keys)) {
            return Object.fromEntries(keys.map((key) => [key, data[key]]));
          }
          return {};
        },
        async set() {}
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
        type: 'GENERATE_CHAT_REPLY',
        vacancyText: 'Вакансия: Java developer',
        chatText: 'Работодатель: какие ожидания по зарплате?'
      },
      {},
      resolve
    );
    assert.equal(stayedAsync, true);
  });

  assert.equal(response.ok, true);
  assert.equal(requestBody.model, 'test-model');
  assert.equal(requestBody.max_tokens, 800);
  const userContent = requestBody.messages.find((message) => message.role === 'user').content;
  assert.match(userContent, /Java developer, Spring Boot/);
  assert.match(userContent, /250 000 руб\. на руки/);
  assert.match(userContent, /Вакансия: Java developer/);
  assert.match(userContent, /какие ожидания по зарплате/);
});

test('background stores capped chat reports with direct chat links', async () => {
  let listener = null;
  const localData = {
    chatReports: Array.from({ length: 205 }, (_, index) => ({
      id: `old-${index}`,
      chatUrl: `https://hh.ru/chat/${index}`,
      status: 'drafted'
    }))
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

  const appendResponse = await new Promise((resolve) => {
    const stayedAsync = listener(
      {
        type: 'APPEND_CHAT_REPORT',
        item: {
          chatUrl: 'https://hh.ru/chat/new',
          employerName: 'ООО Test',
          status: 'reported_external_contact',
          contactType: 'telegram',
          contactText: '@test'
        }
      },
      {},
      resolve
    );
    assert.equal(stayedAsync, true);
  });

  const getResponse = await new Promise((resolve) => {
    listener({ type: 'GET_CHAT_REPORTS' }, {}, resolve);
  });

  assert.equal(appendResponse.ok, true);
  assert.equal(getResponse.ok, true);
  assert.equal(getResponse.chatReports.length, 200);
  assert.equal(getResponse.chatReports.at(-1).chatUrl, 'https://hh.ru/chat/new');
  assert.equal(getResponse.chatReports.at(-1).sent, false);
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
  assert.equal(removedTabId, 41);
});

test('content script registers one message listener', async () => {
  const source = await readFile(new URL('src/content-hh.js', root), 'utf8');
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
  assert.match(source, /hh-job-assistant:start-auto-apply/);
  assert.match(source, /page_trigger_start_auto_apply/);
  assert.match(source, /hhjaAutoStart/);
  assert.match(source, /url_trigger_start/);
});

test('repo script opens hh auto-start URL for extension auto apply', async () => {
  const js = await readFile(new URL('scripts/start-extension-auto-apply.mjs', root), 'utf8');

  assert.match(js, /hhjaAutoStart/);
  assert.doesNotMatch(js, /execute targetTab javascript/);
  assert.match(js, /HHJA_CHROME_PROFILE/);
  assert.match(js, /--profile-directory/);
  assert.match(js, /URL must be an hh\.ru vacancy search page/);
});

test('extension log inspector reads Chrome profile storage', async () => {
  const js = await readFile(new URL('scripts/inspect-extension-log.mjs', root), 'utf8');

  assert.match(js, /Local Extension Settings/);
  assert.match(js, /run_result/);
  assert.match(js, /HHJA_EXTENSION_ID/);
});

test('popup has ordered controls wired to Groq key, version, results, and actions', async () => {
  const html = await readFile(new URL('src/popup.html', root), 'utf8');
  const js = await readFile(new URL('src/popup.js', root), 'utf8');

  for (const id of ['dryRun', 'autoApply', 'stop', 'refreshResumes', 'chatAssist', 'openOptions', 'groqApiKey', 'saveGroqKey', 'testGroq', 'version', 'extensionStatus', 'tabStatus', 'recentResults', 'chatReports', 'clearReports', 'agentDebugLog', 'clearAgentDebugLog']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.doesNotMatch(html, /id="processed"|Обработано/);
  assert.doesNotMatch(js, /nodes\.processed/);

  assert.ok(html.indexOf('id="dryRun"') < html.indexOf('id="autoApply"'));
  assert.ok(html.indexOf('id="autoApply"') < html.indexOf('id="stop"'));
  assert.ok(html.indexOf('id="stop"') < html.indexOf('id="refreshResumes"'));
  assert.ok(html.indexOf('id="openOptions"') < html.indexOf('id="dryRun"'));
  assert.ok(html.indexOf('id="statusLine"') < html.indexOf('id="lastError"'));
  assert.ok(html.indexOf('id="lastError"') < html.indexOf('id="recentResults"'));
  assert.ok(html.indexOf('id="chatReports"') < html.indexOf('id="groqApiKey"'));
  assert.match(html, /aria-label="Настройки">⚙<\/button>/);
  assert.doesNotMatch(html, /openWindow|Открыть окном|window-mode/);
  assert.doesNotMatch(js, /OPEN_ASSISTANT_WINDOW|openWindow/);
  assert.match(js, /openOptionsPage/);
  assert.match(js, /TEST_GROQ/);
  assert.match(js, /getManifest\(\)\.version/);
  assert.match(js, /skipped_missing_groq_key/);
  assert.match(js, /\^skipped/);
  assert.match(js, /item\.error/);
  assert.match(js, /currentAction/);
  assert.match(js, /START_AUTO_APPLY/);
  assert.match(js, /START_CHAT_ASSIST/);
  assert.match(js, /GET_CHAT_REPORTS/);
  assert.match(js, /GET_AGENT_DEBUG_LOG/);
  assert.match(js, /CLEAR_AGENT_DEBUG_LOG/);
  assert.match(js, /GET_CONTENT_STATUS/);
  assert.match(js, /CLEAR_CHAT_REPORTS/);
  assert.match(js, /chatReports/);
  assert.match(js, /refreshHealth/);
  assert.match(js, /isAutoApplyStartUrl/);
  assert.match(js, /url\?\.protocol === 'https:'/);
  assert.match(js, /url\.hostname === 'hh\.ru'/);
  assert.match(js, /url\.pathname === '\/search\/vacancy'/);
  assert.match(js, /url\.search\.length > 0/);
});

test('options use hh resume URL instead of pasted resume text or daily refresh toggle', async () => {
  const html = await readFile(new URL('src/options.html', root), 'utf8');
  const js = await readFile(new URL('src/options.js', root), 'utf8');

  assert.match(html, /id="resumeUrl"/);
  assert.match(html, /id="chatUnreadOnly"/);
  assert.match(html, /id="chatReplyMode"/);
  assert.match(html, /id="chatLimit"/);
  assert.match(html, /id="delayMinMs" type="number" min="500" step="250"/);
  assert.match(html, /id="delayMaxMs" type="number" min="500" step="250"/);
  assert.match(js, /resumeUrl/);
  assert.match(js, /chatUnreadOnly/);
  assert.match(js, /chatReplyMode/);
  assert.match(js, /chatLimit/);
  assert.match(js, /delayMinMs: 2500/);
  assert.match(js, /delayMaxMs: 5000/);
  assert.match(js, /Math\.max\(500/);
  assert.match(js, /auto_send/);
  assert.doesNotMatch(html, /id="resumeText"|Resume text|resumeRefreshEnabled|Enable daily resume refresh/);
  assert.doesNotMatch(js, /resumeText|resumeRefreshEnabled/);
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
