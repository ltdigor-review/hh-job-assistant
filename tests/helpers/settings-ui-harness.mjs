import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

// Browser-only UI fixture. Provider and run behavior belongs in background tests.
function installChromeFixture(seed, version) {
  const owner = window.top;
  if (!owner.__uiStore) {
    owner.__uiStore = seed;
    owner.__uiListeners = [];
    owner.__uiMessages = [];
    owner.__uiErrors = [];
  }
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const get = async (keys) => {
    const store = owner.__uiStore;
    if (keys == null) return copy(store);
    if (typeof keys === 'string') keys = [keys];
    const output = Array.isArray(keys) ? {} : copy(keys);
    for (const key of Array.isArray(keys) ? keys : Object.keys(keys)) {
      if (key in store) output[key] = copy(store[key]);
    }
    return output;
  };
  const set = async (patch) => {
    const changes = {};
    for (const [key, value] of Object.entries(patch)) {
      changes[key] = { oldValue: owner.__uiStore[key], newValue: copy(value) };
      owner.__uiStore[key] = copy(value);
    }
    for (const listener of owner.__uiListeners) listener(changes, 'local');
  };
  const remove = async (keys) => {
    for (const key of Array.isArray(keys) ? keys : [keys]) delete owner.__uiStore[key];
  };
  const sendMessage = async (message) => {
    owner.__uiMessages.push(copy(message));
    if (message.type === 'GET_STATUS') return { ok: true, runState: copy(owner.__uiStore.runState), runResults: copy(owner.__uiStore.runResults) };
    if (message.type === 'SET_AI_ENABLED') {
      const store = owner.__uiStore;
      if (window.HHJA_AI_MODE.isLocked(store)) {
        return { ok: false, code: 'HHJA_AI_MODE_RUN_ACTIVE', error: 'Остановите запуск перед сменой режима ИИ.' };
      }
      const queueInvalidated = Boolean(store.hasSavedQueue && store.aiEnabled !== message.enabled);
      await set({ aiEnabled: message.enabled, ...(queueInvalidated ? { hasSavedQueue: false } : {}) });
      return { ok: true, aiEnabled: message.enabled, queueInvalidated };
    }
    throw new Error(`Unexpected UI runtime request: ${message.type}`);
  };
  window.chrome = {
    runtime: { getManifest: () => ({ version }), sendMessage, openOptionsPage: async () => {} },
    storage: { local: { get, set, remove }, onChanged: { addListener: (listener) => owner.__uiListeners.push(listener) } },
    tabs: {
      query: async () => [{ id: 1, url: 'https://hh.ru/search/vacancy?text=test' }],
      sendMessage: async (_id, message) => {
        owner.__uiMessages.push(copy(message));
        if (message.type === 'GET_CONTENT_STATUS') return {
          ok: true, authenticated: true, unsafe: false,
          autoApplyInProgress: owner.__uiStore.autoApplyRunLease?.active === true,
          canContinueAutoApply: owner.__uiStore.hasSavedQueue === true
        };
        throw new Error(`Unexpected UI content request: ${message.type}`);
      }
    }
  };
  window.addEventListener('error', (event) => owner.__uiErrors.push(event.message));
  window.addEventListener('unhandledrejection', (event) => owner.__uiErrors.push(String(event.reason)));
}

export async function createSettingsUiHarness(overrides = {}) {
  const root = new URL('../../', import.meta.url);
  const { version } = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  const seed = {
    aiEnabled: true, aiProvider: 'qwen', aiFallbackProvider: 'groq',
    aiProviderCredentials: { qwen: { apiKey: 'synthetic-qwen' }, groq: { apiKey: 'synthetic-groq' } },
    resumeUrl: 'https://hh.ru/resume/synthetic', fallbackCoverLetterTemplate: 'Сохранённое письмо кандидата.',
    agentDebugLogsEnabled: false, runState: { state: 'stopped' }, hasSavedQueue: true,
    runResults: [{ status: 'applied', title: 'История сохранена' }], ...overrides
  };
  const bootstrap = `<script>(${installChromeFixture.toString()})(${JSON.stringify(seed)},${JSON.stringify(version)});</script>`;
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      if (pathname === '/favicon.ico') { response.writeHead(204).end(); return; }
      if (pathname === '/') {
        response.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' });
        response.end(`<!doctype html><title>HH UI fixture</title><iframe id="popup" src="/src/popup.html" style="width:400px;height:650px"></iframe><iframe id="options" src="/src/options.html" style="width:800px;height:900px"></iframe>`);
        return;
      }
      if (!/^\/src\/[a-z0-9.-]+\.(html|js|css)$/.test(pathname)) { response.writeHead(404).end(); return; }
      let source = await readFile(new URL(`.${pathname}`, root), 'utf8');
      if (pathname.endsWith('.html')) source = source.replace('<head>', `<head>${bootstrap}`);
      response.writeHead(200, { 'Content-Type': pathname.endsWith('.html') ? 'text/html;charset=utf-8' : pathname.endsWith('.js') ? 'text/javascript;charset=utf-8' : 'text/css' });
      response.end(source);
    } catch (error) { response.writeHead(500).end(error.message); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}
