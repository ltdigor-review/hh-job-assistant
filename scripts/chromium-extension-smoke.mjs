#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const manifest = JSON.parse(await readFile(join(repoRoot, 'manifest.json'), 'utf8'));
const expectedVersion = process.env.HHJA_EXPECTED_VERSION || manifest.version;
const configuredProfileDir = process.env.HHJA_CHROMIUM_USER_DATA_DIR
  ? resolve(process.env.HHJA_CHROMIUM_USER_DATA_DIR)
  : '';
const keepProfile = process.env.HHJA_KEEP_CHROMIUM_PROFILE === '1';
const timeoutMs = Number(process.env.HHJA_CHROMIUM_TIMEOUT_MS || 30000);
const browserPath = process.env.HHJA_CHROMIUM_PATH || process.argv[2] || await findBrowserPath();

function fail(message) {
  console.error(`Chromium extension smoke failed: ${message}`);
  process.exit(1);
}

async function findBrowserPath() {
  const candidates = [
    ...await findPlaywrightChromeForTestingPaths(),
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ];

  for (const candidate of candidates) {
    try {
      await import('node:fs/promises').then(({ access }) => access(candidate, constants.X_OK));
      return candidate;
    } catch {
      // Try the next local browser.
    }
  }

  throw new Error('No Chromium-compatible browser found. Set HHJA_CHROMIUM_PATH.');
}

async function findPlaywrightChromeForTestingPaths() {
  const cacheDir = join(homedir(), 'Library/Caches/ms-playwright');
  try {
    const entries = await readdir(cacheDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('chromium-'))
      .sort((a, b) => b.name.localeCompare(a.name))
      .map((entry) =>
        join(
          cacheDir,
          entry.name,
          'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
        )
      );
  } catch {
    return [];
  }
}

function connectWebSocket(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.addEventListener('open', () => resolve(socket), { once: true });
    socket.addEventListener('error', () => reject(new Error('Could not connect to DevTools websocket')), {
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
    const { resolve: resolvePending, reject } = pending.get(data.id);
    pending.delete(data.id);
    if (data.error) {
      reject(new Error(data.error.message || JSON.stringify(data.error)));
    } else {
      resolvePending(data.result);
    }
  });

  return {
    send(method, params = {}, options = {}) {
      const id = nextId;
      nextId += 1;
      socket.send(JSON.stringify({ id, method, params, sessionId: options.sessionId }));
      return new Promise((resolvePending, reject) => {
        pending.set(id, { resolve: resolvePending, reject });
      });
    },
    close() {
      socket.close();
    }
  };
}

function waitForDevToolsUrl(child) {
  return new Promise((resolveDevTools, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for DevTools websocket after ${timeoutMs}ms`));
    }, timeoutMs);

    const onData = (chunk) => {
      const text = chunk.toString('utf8');
      const match = text.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (!match) return;
      clearTimeout(timer);
      resolveDevTools(match[1]);
    };

    child.stderr?.on('data', onData);
    child.stdout?.on('data', onData);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`Browser exited before DevTools was ready: code=${code} signal=${signal}`));
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function evaluateTargetManifest(session, targetId) {
  const { sessionId } = await session.send('Target.attachToTarget', {
    targetId,
    flatten: true
  });

  try {
    const evaluation = await session.send('Runtime.evaluate', {
      expression: 'chrome.runtime.getManifest()',
      returnByValue: true
    }, { sessionId });
    return { sessionId, manifest: evaluation.result?.value || null };
  } catch (error) {
    await session.send('Target.detachFromTarget', { sessionId }).catch(() => {});
    throw error;
  }
}

async function waitForExtensionTarget(session) {
  const started = Date.now();
  let lastUrls = [];
  let observedManifests = [];

  while (Date.now() - started < timeoutMs) {
    const { targetInfos = [] } = await session.send('Target.getTargets');
    lastUrls = targetInfos.map((target) => `${target.type}:${target.url}`).filter(Boolean);
    const extensionTargets = targetInfos.filter((target) =>
      ['service_worker', 'background_page'].includes(target.type) &&
      target.url.startsWith('chrome-extension://')
    );

    for (const extensionTarget of extensionTargets) {
      const inspected = await evaluateTargetManifest(session, extensionTarget.targetId);
      const loadedManifest = inspected.manifest;
      observedManifests.push({
        name: loadedManifest?.name,
        version: loadedManifest?.version,
        url: extensionTarget.url
      });

      if (loadedManifest?.name === manifest.name && loadedManifest?.version === expectedVersion) {
        return { ...extensionTarget, sessionId: inspected.sessionId, manifest: loadedManifest };
      }

      await session.send('Target.detachFromTarget', { sessionId: inspected.sessionId }).catch(() => {});
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }

  throw new Error(
    `Expected extension worker/background was not discovered. Targets: ${lastUrls.join(', ') || 'none'}. ` +
    `Observed manifests: ${JSON.stringify(observedManifests)}`
  );
}

let profileDir = '';
let browser = null;
let browserSession = null;
let browserOutput = '';

try {
  profileDir = configuredProfileDir || await mkdtemp(join(tmpdir(), 'hhja-chromium-profile-'));
  browser = spawn(browserPath, [
    `--user-data-dir=${profileDir}`,
    `--disable-extensions-except=${repoRoot}`,
    `--load-extension=${repoRoot}`,
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--window-position=-32000,-32000',
    '--window-size=800,600',
    'about:blank'
  ], {
    stdio: ['ignore', 'pipe', 'pipe']
  });
  browser.stdout?.on('data', (chunk) => {
    browserOutput = `${browserOutput}${chunk.toString('utf8')}`.slice(-8000);
  });
  browser.stderr?.on('data', (chunk) => {
    browserOutput = `${browserOutput}${chunk.toString('utf8')}`.slice(-8000);
  });

  const devToolsUrl = await waitForDevToolsUrl(browser);
  browserSession = await createCdpSession(devToolsUrl);
  await browserSession.send('Target.createTarget', {
    url: 'https://hh.ru/?hhjaExtensionSmoke=1'
  });
  const target = await waitForExtensionTarget(browserSession);
  const actualVersion = target.manifest.version;

  console.log(JSON.stringify({
    ok: true,
    browserPath,
    extensionId: target.url.match(/^chrome-extension:\/\/([^/]+)/)?.[1] || '',
    extensionVersion: actualVersion,
    profileDir: keepProfile ? profileDir : undefined
  }, null, 2));
} catch (error) {
  const baseMessage = error instanceof Error ? error.message : String(error);
  const details = [
    baseMessage,
    (keepProfile || configuredProfileDir) && profileDir ? `Kept profile: ${profileDir}` : '',
    browserOutput.trim() ? `Browser output:\n${browserOutput.trim()}` : ''
  ].filter(Boolean).join('\n');
  fail(details);
} finally {
  browserSession?.close();
  if (browser && !browser.killed) {
    browser.kill('SIGTERM');
  }
  if (profileDir && !keepProfile && !configuredProfileDir) {
    await rm(profileDir, { recursive: true, force: true }).catch(() => {});
  }
}
