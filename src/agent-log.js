(function initAgentLog(global) {
  const LOG_KEY = 'agentDebugLog';
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

  async function append(scope, event, details = {}) {
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
      const current = await storage.get([LOG_KEY]);
      const entries = Array.isArray(current?.[LOG_KEY]) ? current[LOG_KEY] : [];
      await storage.set({ [LOG_KEY]: [...entries.slice(-(MAX_ENTRIES - 1)), entry] });
    } catch {
      // Logging must never break the assistant workflow.
    }
  }

  global.HHJobAssistantLog = {
    append,
    LOG_KEY,
    MAX_ENTRIES
  };
})(globalThis);
