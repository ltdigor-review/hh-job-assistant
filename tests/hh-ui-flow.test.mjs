import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { once } from 'node:events';
import { readContentScriptSource } from './helpers/content-script-source.mjs';

const root = new URL('../', import.meta.url);

function chromePath() {
  const candidates = [
    process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium'
  ].filter(Boolean);
  return candidates.find((path) => existsSync(path));
}

async function waitForJson(url, timeoutMs = 10000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
      lastError = new Error(`${response.status} ${await response.text()}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

async function cdpFetch(port, path, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, options);
  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`);
  }
  return response.json();
}

function connectWebSocket(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.addEventListener('open', () => resolve(socket), { once: true });
    socket.addEventListener('error', () => reject(new Error('Could not connect to Chrome DevTools websocket')), {
      once: true
    });
  });
}

async function createCdpSession(wsUrl) {
  const socket = await connectWebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();

  socket.addEventListener('message', (event) => {
    const data = JSON.parse(event.data);
    if (!data.id || !pending.has(data.id)) return;
    const { resolve, reject } = pending.get(data.id);
    pending.delete(data.id);
    if (data.error) {
      reject(new Error(data.error.message || JSON.stringify(data.error)));
    } else {
      resolve(data.result);
    }
  });

  return {
    send(method, params = {}) {
      const id = nextId;
      nextId += 1;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
      });
    },
    close() {
      socket.close();
    }
  };
}

async function waitForComplete(session) {
  const started = Date.now();
  while (Date.now() - started < 10000) {
    const result = await session.send('Runtime.evaluate', {
      expression: 'document.readyState',
      returnByValue: true
    });
    if (result.result?.value === 'complete') return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Page load timed out');
}

function hhBlockedFixture() {
  return `<!doctype html>
    <html lang="ru">
      <head>
        <meta charset="utf-8">
        <title>HH fixture</title>
        <style>
          body { font-family: Arial, sans-serif; }
          [role="dialog"] {
            position: fixed;
            inset: 12% 18%;
            padding: 24px;
            background: white;
            border: 1px solid #ccd6e2;
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0,0,0,.25);
          }
          .close { float: right; }
        </style>
      </head>
      <body>
        <main>
          <article data-qa="vacancy-serp__vacancy">
            <a data-qa="serp-item__title" href="https://hh.ru/vacancy/123">Chief Product Officer/CPO Data</a>
            <button data-qa="vacancy-serp__vacancy_response">Откликнуться</button>
          </article>
          <a data-qa="pager-next" href="https://hh.ru/search/vacancy?text=java&page=1">дальше</a>
        </main>
        <script>
          document.querySelector('[data-qa="vacancy-serp__vacancy_response"]').addEventListener('click', () => {
            const dialog = document.createElement('section');
            dialog.setAttribute('role', 'dialog');
            dialog.innerHTML = \`
              <button class="close" aria-label="Закрыть">×</button>
              <h1>Отклик на вакансию</h1>
              <h2>Chief Product Officer/CPO Data</h2>
              <p>Чтобы откликнуться на эту вакансию, поменяйте видимость резюме на «Видно компаниям-клиентам HeadHunter»</p>
              <button data-qa="vacancy-response-submit-popup" disabled>Откликнуться</button>
            \`;
            dialog.querySelector('[aria-label="Закрыть"]').addEventListener('click', () => dialog.remove());
            document.body.append(dialog);
          });
        </script>
      </body>
    </html>`;
}

function buildInjection(contentScriptSource) {
  return `
    (async () => {
      window.__HH_JOB_ASSISTANT_TEST_FAST_CLICKS__ = true;
      const messages = [];
      const storage = {};
      let listener = null;
      window.__HH_JOB_ASSISTANT_TEST_NAVIGATE__ = (url) => {
        window.__hhJobAssistantNavigatedTo = url;
      };
      window.chrome = {
        runtime: {
          onMessage: {
            addListener(fn) {
              listener = fn;
            }
          },
          sendMessage(message) {
            messages.push(message);
            return Promise.resolve({ ok: true });
          },
          getManifest() {
            return { version: 'test' };
          }
        },
        storage: {
          local: {
            get() {
              return Promise.resolve({ dailyLimit: 2, delayMinMs: 1, delayMaxMs: 1, ...storage });
            },
            set(value) {
              Object.assign(storage, value);
              return Promise.resolve();
            }
          }
        }
      };
      ${contentScriptSource}
      if (!listener) throw new Error('Content script did not register listener');
      const response = await new Promise((resolve) => {
        const stayedAsync = listener({ type: 'START_AUTO_APPLY' }, {}, resolve);
        if (stayedAsync !== true) resolve({ ok: false, error: 'listener not async' });
      });
      return {
        response,
        messages,
        dialogCount: document.querySelectorAll('[role="dialog"]').length,
        navigatedTo: window.__hhJobAssistantNavigatedTo || '',
        bodyText: document.body.innerText
      };
    })()
  `;
}

test('real browser UI closes blocked hh response modal and continues', { timeout: 30000 }, async (t) => {
  const browser = chromePath();
  if (!browser) {
    t.skip('Chrome/Chromium not found');
    return;
  }

  const userDataDir = await mkdtemp(join(tmpdir(), 'hh-job-assistant-chrome-'));
  const port = 9339;
  const chrome = spawn(browser, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    'about:blank'
  ], {
    stdio: 'ignore'
  });

  let target;
  let session;
  try {
    await waitForJson(`http://127.0.0.1:${port}/json/version`);
    target = await cdpFetch(port, `/json/new?${encodeURIComponent(`data:text/html;charset=utf-8,${encodeURIComponent(hhBlockedFixture())}`)}`, {
      method: 'PUT'
    });
    session = await createCdpSession(target.webSocketDebuggerUrl);
    await session.send('Runtime.enable');
    await waitForComplete(session);

    const contentScriptSource = await readContentScriptSource();
    const evaluation = await session.send('Runtime.evaluate', {
      expression: buildInjection(contentScriptSource),
      awaitPromise: true,
      returnByValue: true,
      timeout: 15000
    });

    if (evaluation.exceptionDetails) {
      throw new Error(evaluation.exceptionDetails.text || 'Browser evaluation failed');
    }

    const value = evaluation.result.value;
    const states = value.messages.filter((message) => message.type === 'SET_RUN_STATE').map((message) => message.patch);
    const results = value.messages.filter((message) => message.type === 'APPEND_RUN_RESULT').map((message) => message.item);

    assert.equal(value.response.ok, true);
    assert.equal(value.response.skipped, 1);
    assert.equal(value.response.errors, 0);
    assert.equal(value.dialogCount, 0);
    assert.equal(value.navigatedTo, 'https://hh.ru/search/vacancy?text=java&page=1');
    assert.equal(results.at(-1).status, 'skipped_response_unavailable');
    assert.match(results.at(-1).error, /Resume visibility/);
    assert.ok(states.some((state) => state.currentAction === 'Переход на следующую страницу HH'));
  } finally {
    session?.close();
    if (target?.id) {
      await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`).catch(() => {});
    }
    if (!chrome.killed) {
      chrome.kill('SIGTERM');
    }
    await Promise.race([
      once(chrome, 'exit'),
      new Promise((resolve) => setTimeout(resolve, 2000))
    ]);
    await rm(userDataDir, { recursive: true, force: true });
  }
});
