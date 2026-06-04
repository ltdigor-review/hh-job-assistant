import { readFile } from 'node:fs/promises';

const cdpUrl = process.env.HH_CHROME_CDP_URL || 'http://127.0.0.1:9222';
const targetUrl = process.env.HH_TEST_URL || 'https://hh.ru/search/vacancy?text=java';

function fail(message) {
  console.error(`HH live smoke failed: ${message}`);
  process.exit(1);
}

async function cdpFetch(path, options = {}) {
  const response = await fetch(`${cdpUrl}${path}`, options);
  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`);
  }
  return response.json();
}

async function createPage(url) {
  try {
    return await cdpFetch(`/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  } catch {
    return cdpFetch(`/json/new?${encodeURIComponent(url)}`);
  }
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

async function waitForLoad(session) {
  const started = Date.now();
  while (Date.now() - started < 30000) {
    const result = await session.send('Runtime.evaluate', {
      expression: 'document.readyState',
      returnByValue: true
    });
    if (result.result?.value === 'complete') return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('HH page load timed out');
}

function buildInjection(contentScriptSource) {
  return `
    (async () => {
      const messages = [];
      let listener = null;
      const chrome = {
        runtime: {
          onMessage: {
            addListener(fn) {
              listener = fn;
            }
          },
          sendMessage(message) {
            messages.push(message);
            return Promise.resolve({ ok: true });
          }
        },
        storage: {
          local: {
            get() {
              return Promise.resolve({ dailyLimit: 5, delayMinMs: 1000, delayMaxMs: 1000 });
            },
            set() {
              return Promise.resolve();
            }
          }
        }
      };
      ${contentScriptSource}
      if (!listener) throw new Error('Content script did not register a listener');
      const response = await new Promise((resolve) => {
        const maybeAsync = listener({ type: 'START_DRY_RUN' }, {}, resolve);
        if (maybeAsync !== true) {
          setTimeout(() => resolve({ ok: false, error: 'Listener did not stay async' }), 0);
        }
      });
      return { response, messages, href: location.href, title: document.title, bodyText: document.body.innerText.slice(0, 1000) };
    })()
  `;
}

let target;
let session;

try {
  await cdpFetch('/json/version');
} catch (error) {
  fail(`Chrome DevTools is not reachable at ${cdpUrl}. Start Chrome with remote debugging or set HH_CHROME_CDP_URL. Original error: ${error.message}`);
}

try {
  target = await createPage(targetUrl);
  if (!target.webSocketDebuggerUrl) {
    fail('Chrome did not return a websocket debugger URL for the HH page');
  }

  session = await createCdpSession(target.webSocketDebuggerUrl);
  await session.send('Runtime.enable');
  await waitForLoad(session);

  const contentScriptSource = await readFile(new URL('../src/content-hh.js', import.meta.url), 'utf8');
  const evaluation = await session.send('Runtime.evaluate', {
    expression: buildInjection(contentScriptSource),
    awaitPromise: true,
    returnByValue: true,
    timeout: 30000
  });

  if (evaluation.exceptionDetails) {
    throw new Error(evaluation.exceptionDetails.text || 'Runtime exception while evaluating content script');
  }

  const value = evaluation.result?.value;
  if (!value?.response?.ok) {
    throw new Error(value?.response?.error || 'Check-only run returned an unsuccessful response');
  }

  if (/\/account\/login|captcha|подтвердите, что вы не робот|не робот/i.test(value.href + '\n' + value.bodyText)) {
    throw new Error('HH page is login/captcha/anti-bot, not an authorized vacancy page');
  }

  if (!value.response.found || value.response.found < 1) {
    throw new Error(`Check-only run found no vacancies on ${value.href}`);
  }

  const stateMessages = value.messages.filter((message) => message.type === 'SET_RUN_STATE');
  if (!stateMessages.length) {
    throw new Error('Content script did not report run state');
  }

  console.log(JSON.stringify({
    ok: true,
    url: value.href,
    title: value.title,
    found: value.response.found,
    stateMessages: stateMessages.length
  }, null, 2));
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  session?.close();
  if (target?.id) {
    await fetch(`${cdpUrl}/json/close/${target.id}`).catch(() => {});
  }
}
