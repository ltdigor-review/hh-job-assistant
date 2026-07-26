(function initAgentLog(global) {
  const ENABLED_KEY = 'agentDebugLogsEnabled';
  const RETENTION_KEY = 'agentDebugRetentionCount';
  const INDEX_KEY = 'agentDebugRunIndex';
  const ACTIVE_RUN_KEY = 'agentDebugActiveRunId';
  const RUN_KEY_PREFIX = 'agentDebugRun:';
  const LEGACY_KEYS = ['agentDebugLog', 'agentDebugLogFile', 'agentDebugLogText'];
  const DEFAULT_RETENTION = 5;
  const MIN_RETENTION = 1;
  const MAX_RETENTION = 20;
  const MAX_ENTRIES = 1000;
  const FORMAT_VERSION = 2;

  const SECRET_KEY_PATTERN = /api[_-]?key|authorization|password|secret|access[_-]?token|refresh[_-]?token|bearer/i;
  const SECRET_QUERY_PATTERN = /([?&](?:api[_-]?key|key|token|access[_-]?token|refresh[_-]?token|secret|password|authorization)=)[^&#\s]+/gi;
  const SECRET_ASSIGNMENT_PATTERN = /\b((?:api[_-]?key|token|access[_-]?token|refresh[_-]?token|secret|password|authorization)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,}]+)/gi;
  const BEARER_VALUE_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
  const URL_KEY_PATTERN = /(?:^|_)(?:url|uri|endpoint)(?:$|_)/i;
  const SENSITIVE_DETAIL_KEYS = new Set([
    'age',
    'answer',
    'answers',
    'assistance',
    'body',
    'candidateFacts',
    'content',
    'coverLetter',
    'coverPrompt',
    'currentAction',
    'employerQuestionPrompt',
    'expectedSalary',
    'extraText',
    'label',
    'lastError',
    'letter',
    'message',
    'messages',
    'option',
    'options',
    'prompt',
    'question',
    'questionContext',
    'questions',
    'requestBody',
    'responseBody',
    'responseText',
    'resumeCandidateFacts',
    'resumeProfileText',
    'resumeText',
    'telegramUsername',
    'text',
    'title',
    'validationText',
    'value',
    'vacancyText'
  ]);
  const SAFE_TEXT_KEYS = new Set([
    'action',
    'attempt',
    'errorCode',
    'event',
    'extensionVersion',
    'fieldType',
    'finishReason',
    'flowVersion',
    'inputType',
    'kind',
    'method',
    'mode',
    'model',
    'role',
    'runId',
    'scope',
    'source',
    'state',
    'status',
    'task',
    'timestamp',
    'type',
    'vacancyId'
  ]);
  const ACTIVE_STATES = new Set([
    'scanning',
    'applying',
    'waiting_for_dialog',
    'generating_cover_letter',
    'filling_cover_letter',
    'submitting',
    'refreshing_resumes'
  ]);

  let writeQueue = Promise.resolve();

  function storageApi() {
    const chromeApi = global.chrome || globalThis.chrome;
    return chromeApi?.storage?.local || null;
  }

  function runtimeVersion() {
    try {
      return String((global.chrome || globalThis.chrome)?.runtime?.getManifest?.().version || '');
    } catch {
      return '';
    }
  }

  function enqueueWrite(operation) {
    const next = writeQueue.then(operation, operation);
    writeQueue = next.catch(() => {});
    return next;
  }

  function normalizeRetention(value) {
    return Math.max(
      MIN_RETENTION,
      Math.min(Number.parseInt(value, 10) || DEFAULT_RETENTION, MAX_RETENTION)
    );
  }

  function redactSecretString(value) {
    return String(value)
      .replace(BEARER_VALUE_PATTERN, 'Bearer [redacted]')
      .replace(SECRET_QUERY_PATTERN, '$1[redacted]')
      .replace(SECRET_ASSIGNMENT_PATTERN, '$1[redacted]');
  }

  function fingerprint(value) {
    let hash = 0x811c9dc5;
    for (const character of String(value || '')) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function anonymizedText(value) {
    const text = String(value || '');
    return {
      redacted: true,
      length: text.length,
      fingerprint: fingerprint(text)
    };
  }

  function sanitizeUrl(value) {
    try {
      const url = new URL(redactSecretString(value));
      if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        return anonymizedText(value);
      }
      return `${url.protocol}//${url.host}${url.pathname}`;
    } catch {
      return anonymizedText(value);
    }
  }

  function sanitize(value, key = '', depth = 0, parentKey = '') {
    if (depth > 8) return '[max-depth]';
    if (SECRET_KEY_PATTERN.test(key)) return '[redacted]';
    if (
      SENSITIVE_DETAIL_KEYS.has(key) &&
      !(typeof value === 'number' && /lengths?$/i.test(parentKey))
    ) {
      return anonymizedText(value);
    }
    if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      if (URL_KEY_PATTERN.test(key) || /^https?:\/\//i.test(value)) return sanitizeUrl(value);
      const redacted = redactSecretString(value);
      if (key === 'error' || key === 'reason') {
        return /^[A-Za-z0-9_.:-]{1,160}$/.test(redacted)
          ? redacted
          : anonymizedText(redacted);
      }
      if (
        SAFE_TEXT_KEYS.has(key) ||
        /(?:^|_)(?:hash|fingerprint|id|version|timestamp)(?:$|_)/i.test(key) ||
        /(?:Hash|Fingerprint|Id|Version|Timestamp)$/.test(key)
      ) {
        return redacted.slice(0, 500);
      }
      return anonymizedText(redacted);
    }
    if (Array.isArray(value)) {
      return value.slice(0, 50).map((item) => sanitize(item, '', depth + 1, key));
    }
    if (typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([entryKey, entryValue]) => [
          entryKey,
          sanitize(entryValue, entryKey, depth + 1, key)
        ])
      );
    }
    return anonymizedText(value);
  }

  function formatTimestampForFile(date) {
    return date.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[:.]/g, '-');
  }

  function safeRunId(value) {
    const normalized = String(value || '').replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 128);
    return normalized || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function runStorageKey(runId) {
    return `${RUN_KEY_PREFIX}${safeRunId(runId)}`;
  }

  function deriveRunKind(event, details = {}) {
    if (event === 'resume_refresh_started' || details.action === 'refresh_resumes') {
      return 'resume_refresh';
    }
    return 'auto_apply';
  }

  function createRunMeta(scope, event, details = {}) {
    const now = new Date();
    const kind = deriveRunKind(event, details);
    const id = safeRunId(details.runId);
    return {
      id,
      runId: id,
      kind,
      name: `hh-job-assistant-${kind.replaceAll('_', '-')}-${formatTimestampForFile(now)}.debug`,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      extensionVersion: runtimeVersion(),
      status: 'running',
      inProgress: true,
      scope,
      entryCount: 0,
      droppedEntries: 0
    };
  }

  function buildEntry(scope, event, details = {}) {
    return {
      timestamp: new Date().toISOString(),
      scope: String(scope || 'extension').slice(0, 50),
      event: String(event || 'unknown').slice(0, 120),
      details: sanitize(details)
    };
  }

  function normalizeIndex(value) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    return value
      .filter((item) => item && typeof item === 'object' && item.id)
      .filter((item) => {
        const id = safeRunId(item.id);
        if (seen.has(id)) return false;
        seen.add(id);
        item.id = id;
        item.runId = id;
        return true;
      })
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  }

  function buildDebugFile(record) {
    const meta = record.meta || {};
    const exportedAt = new Date().toISOString();
    const header = {
      timestamp: exportedAt,
      scope: 'extension',
      event: 'debug_file_created',
      details: {
        formatVersion: FORMAT_VERSION,
        redaction: 'anonymized',
        fileName: meta.name || '',
        runId: meta.runId || meta.id || '',
        kind: meta.kind || 'unknown',
        createdAt: meta.createdAt || '',
        exportedAt,
        extensionVersion: meta.extensionVersion || '',
        status: meta.status || 'unknown',
        inProgress: meta.inProgress === true,
        incomplete: meta.inProgress === true || ['running', 'interrupted', 'paused'].includes(meta.status),
        truncated: Number(record.droppedEntries || meta.droppedEntries || 0) > 0,
        droppedEntries: Number(record.droppedEntries || meta.droppedEntries || 0)
      }
    };
    const entries = Array.isArray(record.entries) ? record.entries : [];
    return [header, ...entries].map((entry) => JSON.stringify(entry)).join('\n') + '\n';
  }

  async function removeKeys(storage, keys) {
    const unique = [...new Set(keys.filter(Boolean))];
    if (unique.length > 0 && storage?.remove) {
      await storage.remove(unique);
    }
  }

  async function markPreviousRunInterrupted(storage, index, activeRunId, now) {
    if (!activeRunId) return index;
    const currentMeta = index.find((item) => item.id === activeRunId);
    if (!currentMeta?.inProgress) return index;
    const nextMeta = {
      ...currentMeta,
      status: 'interrupted',
      inProgress: false,
      updatedAt: now
    };
    const recordKey = runStorageKey(activeRunId);
    const stored = await storage.get([recordKey]);
    if (stored?.[recordKey]) {
      await storage.set({
        [recordKey]: {
          ...stored[recordKey],
          meta: nextMeta
        }
      });
    }
    return index.map((item) => item.id === activeRunId ? nextMeta : item);
  }

  async function resetNow(scope, event, details = {}) {
    const storage = storageApi();
    if (!storage?.get || !storage?.set) return null;
    const current = await storage.get([
      ENABLED_KEY,
      RETENTION_KEY,
      INDEX_KEY,
      ACTIVE_RUN_KEY
    ]);
    if (current?.[ENABLED_KEY] !== true) return null;

    const now = new Date().toISOString();
    let index = normalizeIndex(current?.[INDEX_KEY]);
    index = await markPreviousRunInterrupted(storage, index, current?.[ACTIVE_RUN_KEY], now);

    const meta = createRunMeta(scope, event, details);
    const firstEntry = buildEntry(scope, event, { ...details, runId: meta.runId });
    meta.entryCount = 1;
    const record = {
      meta,
      entries: [firstEntry],
      droppedEntries: 0
    };
    const retention = normalizeRetention(current?.[RETENTION_KEY]);
    const nextIndex = [meta, ...index.filter((item) => item.id !== meta.id)];
    const kept = nextIndex.slice(0, retention);
    const removed = nextIndex.slice(retention);

    await storage.set({
      [RETENTION_KEY]: retention,
      [INDEX_KEY]: kept,
      [ACTIVE_RUN_KEY]: meta.id,
      [runStorageKey(meta.id)]: record
    });
    await removeKeys(storage, [
      ...LEGACY_KEYS,
      ...removed.map((item) => runStorageKey(item.id))
    ]);
    return meta;
  }

  async function appendNow(scope, event, details = {}) {
    const storage = storageApi();
    if (!storage?.get || !storage?.set) return;
    const current = await storage.get([ENABLED_KEY, ACTIVE_RUN_KEY, INDEX_KEY]);
    if (current?.[ENABLED_KEY] !== true || !current?.[ACTIVE_RUN_KEY]) return;

    const runId = safeRunId(current[ACTIVE_RUN_KEY]);
    const recordKey = runStorageKey(runId);
    const stored = await storage.get([recordKey]);
    const record = stored?.[recordKey];
    if (!record?.meta || !Array.isArray(record.entries)) return;

    const entry = buildEntry(scope, event, details);
    const overflow = Math.max(0, record.entries.length + 1 - MAX_ENTRIES);
    const entries = [...record.entries, entry].slice(-MAX_ENTRIES);
    const droppedEntries = Number(record.droppedEntries || 0) + overflow;
    const rawState = event === 'run_state' ? String(details?.state || '') : '';
    const meta = {
      ...record.meta,
      updatedAt: entry.timestamp,
      entryCount: entries.length,
      droppedEntries
    };
    if (rawState) {
      meta.status = rawState;
      meta.inProgress = ACTIVE_STATES.has(rawState);
    }

    const index = normalizeIndex(current?.[INDEX_KEY]).map((item) => (
      item.id === runId ? meta : item
    ));
    await storage.set({
      [INDEX_KEY]: index,
      [recordKey]: {
        meta,
        entries,
        droppedEntries
      }
    });
  }

  async function listRuns() {
    const storage = storageApi();
    if (!storage?.get) return [];
    const current = await storage.get([ENABLED_KEY, INDEX_KEY]);
    if (current?.[ENABLED_KEY] !== true) return [];
    return normalizeIndex(current?.[INDEX_KEY]).map((item) => ({ ...item }));
  }

  async function getArtifact(runId) {
    const storage = storageApi();
    if (!storage?.get) return { available: false, name: '', text: '' };
    const id = safeRunId(runId);
    const current = await storage.get([ENABLED_KEY, INDEX_KEY, runStorageKey(id)]);
    const index = normalizeIndex(current?.[INDEX_KEY]);
    const record = current?.[runStorageKey(id)];
    if (
      current?.[ENABLED_KEY] !== true ||
      !index.some((item) => item.id === id) ||
      !record?.meta
    ) {
      return { available: false, name: '', text: '' };
    }
    return {
      available: true,
      name: record.meta.name,
      text: buildDebugFile(record)
    };
  }

  async function trimHistoryNow(value) {
    const storage = storageApi();
    if (!storage?.get || !storage?.set) return [];
    const retention = normalizeRetention(value);
    const current = await storage.get([INDEX_KEY, ACTIVE_RUN_KEY]);
    const index = normalizeIndex(current?.[INDEX_KEY]);
    const kept = index.slice(0, retention);
    const removed = index.slice(retention);
    const activeRunId = current?.[ACTIVE_RUN_KEY];
    const patch = {
      [RETENTION_KEY]: retention,
      [INDEX_KEY]: kept
    };
    if (activeRunId && !kept.some((item) => item.id === activeRunId)) {
      patch[ACTIVE_RUN_KEY] = '';
    }
    await storage.set(patch);
    await removeKeys(storage, removed.map((item) => runStorageKey(item.id)));
    return kept;
  }

  async function clearHistoryNow() {
    const storage = storageApi();
    if (!storage?.get) return;
    const current = await storage.get(null);
    const dynamicKeys = Object.keys(current || {}).filter((key) => key.startsWith(RUN_KEY_PREFIX));
    await removeKeys(storage, [
      INDEX_KEY,
      ACTIVE_RUN_KEY,
      ...LEGACY_KEYS,
      ...dynamicKeys
    ]);
  }

  async function migrateLegacyNow() {
    const storage = storageApi();
    if (!storage?.get) return;
    await removeKeys(storage, LEGACY_KEYS);
  }

  function append(scope, event, details = {}) {
    return enqueueWrite(() => appendNow(scope, event, details)).catch(() => {
      // Logging must never break the assistant workflow.
    });
  }

  function reset(scope, event, details = {}) {
    return enqueueWrite(() => resetNow(scope, event, details)).catch(() => null);
  }

  function trimHistory(value) {
    return enqueueWrite(() => trimHistoryNow(value));
  }

  function clearHistory() {
    return enqueueWrite(clearHistoryNow);
  }

  function migrateLegacy() {
    return enqueueWrite(migrateLegacyNow);
  }

  global.HHJobAssistantLog = {
    append,
    reset,
    listRuns,
    getArtifact,
    trimHistory,
    clearHistory,
    migrateLegacy,
    buildDebugFile,
    normalizeRetention,
    ENABLED_KEY,
    RETENTION_KEY,
    INDEX_KEY,
    ACTIVE_RUN_KEY,
    RUN_KEY_PREFIX,
    LEGACY_KEYS,
    DEFAULT_RETENTION,
    MIN_RETENTION,
    MAX_RETENTION,
    MAX_ENTRIES,
    FORMAT_VERSION
  };
})(globalThis);
