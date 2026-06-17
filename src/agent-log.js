(function initAgentLog(global) {
  const LOG_KEY = 'agentDebugLog';
  const LOG_FILE_KEY = 'agentDebugLogFile';
  const MAX_ENTRIES = 500;
  const SECRET_KEY_PATTERN = /api[_-]?key|token|authorization|password|secret/i;

  function sanitize(value, depth = 0) {
    if (depth > 4) return '[max-depth]';
    if (value == null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitize(item, depth + 1));

    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [
        key,
        SECRET_KEY_PATTERN.test(key) ? '[redacted]' : sanitize(entryValue, depth + 1)
      ])
    );
  }

  function formatTimestampForFile(date) {
    return date.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[:.]/g, '-');
  }

  function createLogFile(runId = '') {
    const now = new Date();
    return {
      name: `hh-job-assistant-${formatTimestampForFile(now)}.debug`,
      createdAt: now.toISOString(),
      runId
    };
  }

  function buildDebugFile(file, entries) {
    const header = {
      timestamp: file.createdAt,
      scope: 'extension',
      event: 'debug_file_created',
      details: {
        fileName: file.name,
        runId: file.runId || ''
      }
    };
    return [header, ...entries].map((entry) => JSON.stringify(entry)).join('\n') + '\n';
  }

  async function syncFile() {
    const chromeApi = global.chrome || globalThis.chrome;
    const storage = chromeApi?.storage?.local;
    if (!storage?.get || !storage?.set) return;
    const current = await storage.get([LOG_KEY, LOG_FILE_KEY]);
    const entries = Array.isArray(current?.[LOG_KEY]) ? current[LOG_KEY] : [];
    const file = current?.[LOG_FILE_KEY] || createLogFile();
    await storage.set({ [LOG_FILE_KEY]: file, agentDebugLogText: buildDebugFile(file, entries) });
  }

  async function appendLocal(scope, event, details = {}) {
    const chromeApi = global.chrome || globalThis.chrome;
    const storage = chromeApi?.storage?.local;
    if (!storage?.get || !storage?.set) return;

    const entry = {
      timestamp: new Date().toISOString(),
      scope,
      event,
      details: sanitize(details)
    };

    try {
      const current = await storage.get([LOG_KEY, LOG_FILE_KEY]);
      const entries = Array.isArray(current?.[LOG_KEY]) ? current[LOG_KEY] : [];
      const file = current?.[LOG_FILE_KEY] || createLogFile();
      const nextEntries = [...entries.slice(-(MAX_ENTRIES - 1)), entry];
      await storage.set({ [LOG_KEY]: nextEntries, [LOG_FILE_KEY]: file });
      await syncFile();
    } catch {
      // Logging must never break the assistant workflow.
    }
  }

  async function reset(scope, event, details = {}) {
    const chromeApi = global.chrome || globalThis.chrome;
    const storage = chromeApi?.storage?.local;

    if (!storage?.get || !storage?.set) return;

    try {
      const file = createLogFile(details?.runId || '');
      await storage.set({
        [LOG_KEY]: [],
        [LOG_FILE_KEY]: file,
        agentDebugLogText: buildDebugFile(file, [])
      });
      await appendLocal(scope, event, details);
    } catch {
      // Logging must never break the assistant workflow.
    }
  }

  global.HHJobAssistantLog = {
    append: appendLocal,
    reset,
    LOG_KEY,
    LOG_FILE_KEY,
    MAX_ENTRIES
  };
})(globalThis);
