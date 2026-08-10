const EMPLOYMENT_PREFERENCE_VALUES = new Set(['individual_entrepreneur', 'labor_contract']);
const WORK_FORMAT_PREFERENCE_VALUES = new Set(['remote', 'hybrid', 'office']);

const CLICK_DELAY_MIN_MS = 900;
const CLICK_DELAY_MAX_MS = 1800;
const FOLLOWUP_CONFIRM_CLICK_DELAY_MIN_MS = 120;
const FOLLOWUP_CONFIRM_CLICK_DELAY_MAX_MS = 300;
const FOLLOWUP_CONFIRM_SETTLE_MS = 300;
const POST_FILL_SETTLE_MS = 1000;
const POST_SUBMIT_SETTLE_MS = 5000;
const SUBMIT_CONFIRM_TIMEOUT_MS = 15000;
const AI_PROVIDER_IDS = Object.keys(globalThis.HHJA_AI_PROVIDERS?.PROVIDERS || {});
const RUNTIME_MESSAGE_TIMEOUT_MS =
  globalThis.HHJA_AI_PROVIDERS?.getRequestChainTimeoutMs?.(
    AI_PROVIDER_IDS.length > 0 ? AI_PROVIDER_IDS : ['qwen', 'groq']
  ) ?? 170000;
const AUTO_APPLY_FLOW_VERSION = 'list-click-return-v12';
const AUTO_APPLY_STOP_BEFORE_SUBMIT_TTL_MS = 15 * 60 * 1000;
const AUTO_START_TOKEN_KEY = 'autoApplyAutoStartToken';
const AUTO_START_TOKEN_EXPIRES_AT_KEY = 'autoApplyAutoStartTokenExpiresAt';
const DAILY_APPLICATION_LEDGER_KEY = 'dailyApplicationLedger';
const PRIVATE_QUESTION_AUDIT_KEY = 'agentPrivateQuestionAudit';
const AUTOMATION_START_DIGEST_KEY = 'automationStartDigest';
const HHJA_STATUS_PARAM = 'hhjaStatus';
const HHJA_STATUS_PANEL_ID = 'hh-job-assistant-status-panel';
const HHJA_STATUS_CONTENT_ID = 'hh-job-assistant-status-content';
const STATUS_PANEL_MESSAGE_TIMEOUT_MS = 5000;
const PRIVATE_QUESTION_AUDIT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const PRIVATE_QUESTION_AUDIT_MAX_ENTRIES = 200;
const MAX_QUESTION_FORM_RESNAPSHOTS = 3;
const VACANCY_GROQ_MAX_CHARS = 2200;
const QUESTION_CONTEXT_GROQ_MAX_CHARS = 2200;
const QUESTION_VISIBLE_FALLBACK_MAX_CHARS = 600;
const HH_DAILY_RESPONSE_LIMIT_ACTION = 'Исчерпан лимит в 200 откликов в день';
const HH_DAILY_RESPONSE_LIMIT_MESSAGE = 'HH временно не дает отправлять новые отклики.';
const {
  cleanText,
  sanitizeGeneratedText,
  stripAnswerLabel,
  getGeneratedTextInvalidReason
} = globalThis.HHJobAssistantText || {};
const { setNativeValue } = globalThis.HHJobAssistantDom || {};
const hhObserver = globalThis.HHJobAssistantHhObserver;
if (!hhObserver || hhObserver.schemaVersion !== 1) {
  throw new Error('HH Job Assistant: incompatible HH DOM observer');
}
const {
  capturePage,
  captureSearch,
  captureResponse,
  captureQuestionForm: captureQuestionFormSnapshot,
  capturePagination,
  readControlState
} = hhObserver;

function getVacancyId(url) {
  return String(url || '').match(/\/vacancy\/(\d+)/)?.[1] || new URL(String(url || location.href), location.href).searchParams.get('vacancyId') || '';
}

function isUnsafeHhUrl(value) {
  try {
    const url = new URL(String(value || ''), location.href);
    return /\/account\/login|\/account\/signup/.test(url.pathname);
  } catch {
    return false;
  }
}

function buildResponseUrlFromVacancyId(vacancyId, baseUrl = location.href) {
  const id = cleanText(vacancyId);
  if (!id) return '';
  const origin = new URL(baseUrl || location.href, location.href).origin;
  if (!origin || origin === 'null') return '';
  const url = new URL('/applicant/vacancy_response', origin);
  url.searchParams.set('vacancyId', id);
  url.searchParams.set('hhtmFrom', 'vacancy_search_list');
  return url.href;
}

function uniqueContextLines(text) {
  const seen = new Set();
  return cleanText(text)
    .split('\n')
    .map((line) => cleanText(line))
    .filter((line) => {
      if (!line || seen.has(line)) return false;
      seen.add(line);
      return true;
    });
}

function joinCappedLines(lines, maxChars) {
  const output = [];
  let length = 0;
  for (const line of lines) {
    const nextLength = length + line.length + (output.length > 0 ? 1 : 0);
    if (nextLength > maxChars) break;
    output.push(line);
    length = nextLength;
  }
  return output.join('\n').slice(0, maxChars);
}

function getBodyText() {
  return capturePage().facts.bodyText;
}

function getHeadingText() {
  return capturePage().facts.headingText;
}

function findDetailResponseButton(root = document) {
  return capturePage({ root }).refs.detailResponseButton;
}

function findCloseButton(root) {
  return captureResponse({ root }).refs.close;
}

function isUnsafePage() {
  return capturePage().facts.unsafe;
}

function hasAuthenticatedHhSignal() {
  return capturePage().facts.authenticated;
}

function isResponseFormPage() {
  return capturePage().facts.responseFormPresent;
}

function scanVacancies() {
  const snapshot = captureSearch();
  return snapshot.facts.vacancies.map((item, index) => ({ ...item, ...snapshot.refs.vacancies[index] }));
}

function findCurrentVacancyResponseButton(item) {
  const expectedKey = getVacancyDedupeKey(item);
  const pageSnapshot = capturePage();
  if (
    pageSnapshot.facts.pageKind === 'vacancy' &&
    expectedKey &&
    pageSnapshot.facts.currentVacancyId === expectedKey &&
    pageSnapshot.refs.detailResponseButton
  ) {
    return pageSnapshot.refs.detailResponseButton;
  }
  const current = scanVacancies().find((candidate) => {
    const candidateKey = getVacancyDedupeKey(candidate);
    return expectedKey ? candidateKey === expectedKey : candidate.index === item?.index;
  });
  if (current?.responseButton) return current.responseButton;
  return readControlState(item?.responseButton).connected ? item.responseButton : null;
}

function getVacancyText(root = document) {
  return captureSearch({ root, scan: false }).facts.vacancyText;
}

function getDialogRoot() {
  return captureResponse().refs.root;
}

function getRootText(root) {
  return captureResponse({ root }).facts.rootText;
}

function detectTest(root) {
  return captureResponse({ root }).facts.testDetected;
}

function isResponseFormRoot(root) {
  return captureResponse({ root }).facts.present;
}

function isAlreadyAppliedPage(root) {
  return captureResponse({ root }).facts.alreadyAppliedPage;
}

function hasNewResponseSuccessText(beforeText, root) {
  return captureResponse({ root, beforeText }).facts.newSuccess;
}

function isAlreadyAppliedForCurrentItem(root, item, options = {}) {
  return captureResponse({ root, item, ...options }).facts.alreadyApplied;
}

function findTextarea(root) {
  return captureResponse({ root }).refs.textarea;
}

function getFieldMarker(field) {
  return readControlState(field).marker;
}

function getFieldLogTarget(field) {
  return readControlState(field).logTarget;
}

function getFieldQuestionText(field) {
  return readControlState(field).question;
}

function findCoverLetterTextarea(root) {
  return captureResponse({ root }).refs.coverLetter;
}

function findQuestionFields(root) {
  return captureQuestionFormSnapshot(root).refs.textFields;
}

function findQuestionControlGroups(root) {
  return captureQuestionFormSnapshot(root).refs.choiceGroups;
}

function findSubmitButton(root) {
  return captureResponse({ root }).refs.submit;
}

function hasSubmitControl(root) {
  return captureResponse({ root }).facts.hasSubmit;
}

function detectBlockedResponseReason(root) {
  return captureResponse({ root }).facts.blockedReason;
}

function detectHhDailyResponseLimit(root) {
  return captureResponse({ root }).facts.dailyLimitReason;
}

function findFollowupConfirmButton(root) {
  return captureResponse({ root }).refs.followup;
}

function getFieldValue(field) {
  return readControlState(field).value;
}

function collectResponseValidationText(root) {
  return captureResponse({ root }).facts.validationText;
}

function validateFilledQuestionFields(questionFields, answers) {
  return questionFields
    .map((field, index) => ({ expected: cleanText(answers[index] || ''), actual: cleanText(readControlState(field).value), index }))
    .filter(({ expected, actual }) => !expected || !actual || (actual !== expected && !actual.includes(expected) && !expected.includes(actual)))
    .map(({ index }) => index + 1);
}

function validateSelectedQuestionControls(groups) {
  return groups
    .map((group, index) => ({ index: index + 1, selected: group.options.some((option) => readControlState(option.control).checked) }))
    .filter((group) => !group.selected)
    .map((group) => group.index);
}

function getNextSearchPageUrl() {
  return capturePagination().facts.nextUrl;
}

let stopRequested = false;
let stopReason = '';
let activeRunId = null;
let queuedResumeStarted = false;
let queuedSearchStarted = false;
let extensionContextInvalidated = false;
let actionOverlay = null;
let startRunPromise = null;
let activeRunEntryKind = '';
let automationStartDigestWrite = Promise.resolve();

class StopRequestedError extends Error {
  constructor() {
    super('HHJA_STOP_REQUESTED');
    this.name = 'StopRequestedError';
  }
}

function createProcessedVacancyIdSet(source = []) {
  return new Set((Array.isArray(source) ? source : []).map((value) => String(value || '').trim()).filter(Boolean));
}

function getVacancyDedupeKey(item) {
  const id = String(item?.vacancyId || '').trim();
  if (id) return id;
  const urlId = getVacancyId(item?.url || item?.responseUrl || '');
  if (urlId) return urlId;
  return '';
}

function serializeProcessedVacancyIds(processedIds) {
  return Array.from(processedIds || []).filter(Boolean);
}

function getMoscowDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);
}

function normalizeDailyApplicationLedger(value, now = new Date()) {
  const date = getMoscowDate(now);
  if (!value || value.date !== date) {
    return {
      date,
      legacySubmitted: 0,
      newSubmitted: 0,
      alreadyApplied: 0,
      submittedVacancyIds: [],
      alreadyAppliedVacancyIds: [],
      hhDailyLimitReached: false,
      updatedAt: now.toISOString()
    };
  }
  const submittedVacancyIds = serializeProcessedVacancyIds(value.submittedVacancyIds);
  const legacySubmitted = Math.max(0, Number(value.legacySubmitted) || 0);
  const alreadyAppliedVacancyIds = serializeProcessedVacancyIds(value.alreadyAppliedVacancyIds)
    .filter((id) => !submittedVacancyIds.includes(id));
  return {
    date,
    legacySubmitted,
    newSubmitted: legacySubmitted + submittedVacancyIds.length,
    alreadyApplied: alreadyAppliedVacancyIds.length,
    submittedVacancyIds,
    alreadyAppliedVacancyIds,
    hhDailyLimitReached: value.hhDailyLimitReached === true,
    updatedAt: String(value.updatedAt || now.toISOString())
  };
}

async function getDailyApplicationLedger() {
  const stored = await storageGet([DAILY_APPLICATION_LEDGER_KEY], { optional: true });
  return normalizeDailyApplicationLedger(stored?.[DAILY_APPLICATION_LEDGER_KEY]);
}

async function recordDailyApplication(item, kind, counters = null) {
  const ledger = await getDailyApplicationLedger();
  const counterBaseline = Math.max(0, Number(counters?.applied) || 0);
  if (counterBaseline > ledger.newSubmitted) {
    ledger.legacySubmitted += counterBaseline - ledger.newSubmitted;
  }
  const vacancyId = getVacancyDedupeKey(item);
  let added = false;
  if (kind === 'submitted' && vacancyId && !ledger.submittedVacancyIds.includes(vacancyId)) {
    ledger.submittedVacancyIds.push(vacancyId);
    ledger.alreadyAppliedVacancyIds = ledger.alreadyAppliedVacancyIds.filter((id) => id !== vacancyId);
    added = true;
  } else if (
    kind === 'already_applied' &&
    vacancyId &&
    !ledger.submittedVacancyIds.includes(vacancyId) &&
    !ledger.alreadyAppliedVacancyIds.includes(vacancyId)
  ) {
    ledger.alreadyAppliedVacancyIds.push(vacancyId);
    added = true;
  } else if (kind === 'hh_daily_limit') {
    ledger.hhDailyLimitReached = true;
    added = true;
  }
  ledger.newSubmitted = ledger.legacySubmitted + ledger.submittedVacancyIds.length;
  ledger.alreadyApplied = ledger.alreadyAppliedVacancyIds.length;
  ledger.updatedAt = new Date().toISOString();
  await storageSet({ [DAILY_APPLICATION_LEDGER_KEY]: ledger }, { optional: true });
  return { ledger, added };
}

function syncCountersFromLedger(counters, ledger) {
  counters.applied = Math.max(Number(counters.applied) || 0, Number(ledger?.newSubmitted) || 0);
  counters.alreadyApplied = Math.max(
    Number(counters.alreadyApplied) || 0,
    Number(ledger?.alreadyApplied) || 0
  );
}

async function recordPrivateQuestionAudit(item, audit) {
  const stored = await storageGet(
    ['agentDebugLogsEnabled', PRIVATE_QUESTION_AUDIT_KEY],
    { optional: true }
  );
  if (stored?.agentDebugLogsEnabled !== true) return;
  const now = new Date();
  const cutoff = now.getTime() - PRIVATE_QUESTION_AUDIT_RETENTION_MS;
  const previous = Array.isArray(stored?.[PRIVATE_QUESTION_AUDIT_KEY]?.entries)
    ? stored[PRIVATE_QUESTION_AUDIT_KEY].entries
    : [];
  const entries = previous
    .filter((entry) => Date.parse(entry?.timestamp || 0) >= cutoff)
    .slice(-(PRIVATE_QUESTION_AUDIT_MAX_ENTRIES - 1));
  entries.push({
    timestamp: now.toISOString(),
    runId: activeRunId || '',
    vacancyId: String(item?.vacancyId || ''),
    url: String(item?.url || ''),
    ...audit
  });
  await storageSet({
    [PRIVATE_QUESTION_AUDIT_KEY]: {
      formatVersion: 1,
      retentionDays: 7,
      entries
    }
  }, { optional: true });
}

function isExtensionContextInvalidatedError(error) {
  return /extension context invalidated|context invalidated/i.test(error instanceof Error ? error.message : String(error));
}

function localizeError(error, fallback) {
  return globalThis.HHJA_LOCALIZE_ERROR?.(error, fallback) || fallback || 'Внутренняя ошибка расширения.';
}

const DEFAULTS = globalThis.HHJA_DEFAULTS;

function getStopBeforeSubmitExpiresAtMs(value = '') {
  const expiresAtMs = Date.parse(String(value || ''));
  return Number.isFinite(expiresAtMs) ? expiresAtMs : NaN;
}

function normalizeAutoApplyStopBeforeSubmit(value) {
  if (typeof value !== 'object' || value === null) return null;
  if (value.armed !== true) return null;
  if (value.runId !== undefined && typeof value.runId !== 'string') return null;
  const runId = String(value.runId || '').trim();
  const expiresAtMs = getStopBeforeSubmitExpiresAtMs(value.expiresAt);
  if (!Number.isFinite(expiresAtMs)) return null;
  return {
    armed: true,
    runId,
    armedAt: String(value.armedAt || ''),
    expiresAt: new Date(expiresAtMs).toISOString(),
    source: String(value.source || 'url')
  };
}

function buildStopBeforeSubmitState(runId = '') {
  const now = new Date();
  return {
    armed: true,
    runId: String(runId || ''),
    armedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + AUTO_APPLY_STOP_BEFORE_SUBMIT_TTL_MS).toISOString(),
    source: 'url_param'
  };
}

async function readAutoApplyStopBeforeSubmit() {
  const { autoApplyStopBeforeSubmit } = await storageGet(['autoApplyStopBeforeSubmit'], { optional: true });
  if (autoApplyStopBeforeSubmit === true || autoApplyStopBeforeSubmit === false) {
    await storageSet({ autoApplyStopBeforeSubmit: null }, { optional: true });
    if (autoApplyStopBeforeSubmit === true) {
      await appendAgentLog('stop_before_submit_guard_discarded', { reason: 'legacy_unscoped' });
    }
    return null;
  }
  const state = normalizeAutoApplyStopBeforeSubmit(autoApplyStopBeforeSubmit);
  if (!state) {
    if (autoApplyStopBeforeSubmit != null) {
      await storageSet({ autoApplyStopBeforeSubmit: null }, { optional: true });
      await appendAgentLog('stop_before_submit_guard_discarded', { reason: 'invalid_state' });
    }
    return null;
  }
  const expiresAtMs = getStopBeforeSubmitExpiresAtMs(state.expiresAt);
  if (!state.runId && (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now())) {
    await storageSet({ autoApplyStopBeforeSubmit: null }, { optional: true });
    await appendAgentLog('stop_before_submit_guard_discarded', { reason: 'pending_expired' });
    return null;
  }
  return state;
}

async function clearStopBeforeSubmitForRun(runId, reason = 'run_terminal') {
  const current = await readAutoApplyStopBeforeSubmit();
  if (!current) return false;
  const normalizedRunId = String(runId || '');
  if (!normalizedRunId || current.runId !== normalizedRunId) return false;
  await storageSet({ autoApplyStopBeforeSubmit: null }, { optional: true });
  await appendAgentLog('stop_before_submit_guard_cleared', {
    runId: normalizedRunId,
    reason
  });
  return true;
}

async function claimStopBeforeSubmitForRun(runId) {
  if (!runId) return false;
  const current = await readAutoApplyStopBeforeSubmit();
  if (!current) return false;
  if (current.runId) {
    if (current.runId === String(runId)) return true;
    await storageSet({ autoApplyStopBeforeSubmit: null }, { optional: true });
    await appendAgentLog('stop_before_submit_guard_discarded', {
      runId: String(runId),
      reason: 'stale_run'
    });
    return false;
  }
  await storageSet({
    autoApplyStopBeforeSubmit: {
      ...current,
      runId: String(runId)
    }
  }, { optional: true });
  await appendAgentLog('stop_before_submit_guard_claimed', { runId: String(runId) });
  return true;
}

function markExtensionContextInvalidated() {
  extensionContextInvalidated = true;
  stopRequested = true;
  stopReason = 'extension_context_invalidated';
  setBusyCursor(false);
}

globalThis.addEventListener?.('unhandledrejection', (event) => {
  if (isExtensionContextInvalidatedError(event?.reason)) {
    markExtensionContextInvalidated();
    event.preventDefault?.();
  }
});

async function withExtensionContext(operation, { optional = false } = {}) {
  if (extensionContextInvalidated) {
    if (optional) return null;
    throw new Error('Контекст расширения устарел. Перезагрузите расширение и обновите страницу HH.');
  }

  try {
    return await operation();
  } catch (error) {
    if (isExtensionContextInvalidatedError(error)) {
      markExtensionContextInvalidated();
      if (optional) return null;
      throw new Error('Контекст расширения устарел. Перезагрузите расширение и обновите страницу HH.');
    }
    throw error;
  }
}

async function storageGet(keys, options = {}) {
  return (await withExtensionContext(() => chrome.storage.local.get(keys), options)) || {};
}

async function storageSet(value, options = {}) {
  return withExtensionContext(() => chrome.storage.local.set(value), options);
}

function safeDigestCount(value) {
  const count = Number(value);
  if (!Number.isFinite(count) || count < 0) return 0;
  return Math.min(Math.floor(count), 1000000);
}

function normalizeAutomationStartDigest(value) {
  const lastEvent = String(value?.lastEvent || 'none');
  return {
    starts: safeDigestCount(value?.starts),
    continues: safeDigestCount(value?.continues),
    shortcutStarts: safeDigestCount(value?.shortcutStarts),
    shortcutContinues: safeDigestCount(value?.shortcutContinues),
    duplicates: safeDigestCount(value?.duplicates),
    conflicts: safeDigestCount(value?.conflicts),
    lastEvent: [
      'none',
      'start',
      'continue',
      'duplicate_start',
      'duplicate_continue',
      'conflict_start',
      'conflict_continue'
    ].includes(lastEvent) ? lastEvent : 'none',
    updatedAt: String(value?.updatedAt || '')
  };
}

function enqueueAutomationStartDigestWrite(operation) {
  const pending = automationStartDigestWrite.then(operation, operation);
  automationStartDigestWrite = pending.catch(() => {});
  return pending;
}

async function beginAutomationStartDigest(kind, source = 'runtime') {
  const isContinue = kind === 'continue';
  const shortcut = source === 'shortcut';
  const digest = {
    starts: isContinue ? 0 : 1,
    continues: isContinue ? 1 : 0,
    shortcutStarts: !isContinue && shortcut ? 1 : 0,
    shortcutContinues: isContinue && shortcut ? 1 : 0,
    duplicates: 0,
    conflicts: 0,
    lastEvent: isContinue ? 'continue' : 'start',
    updatedAt: new Date().toISOString()
  };
  return enqueueAutomationStartDigestWrite(async () => {
    await storageSet({ [AUTOMATION_START_DIGEST_KEY]: digest }, { optional: true });
    return digest;
  });
}

async function recordAutomationStartDigestCollision(kind, source = 'runtime', conflict = false) {
  return enqueueAutomationStartDigestWrite(async () => {
    const stored = await storageGet([AUTOMATION_START_DIGEST_KEY], { optional: true });
    const current = normalizeAutomationStartDigest(stored?.[AUTOMATION_START_DIGEST_KEY]);
    const event = `${conflict ? 'conflict' : 'duplicate'}_${kind === 'continue' ? 'continue' : 'start'}`;
    const next = {
      ...current,
      duplicates: current.duplicates + 1,
      conflicts: current.conflicts + (conflict ? 1 : 0),
      lastEvent: event,
      updatedAt: new Date().toISOString()
    };
    if (source === 'shortcut' && kind === 'continue') {
      next.shortcutContinues = Math.max(next.shortcutContinues, 1);
    } else if (source === 'shortcut') {
      next.shortcutStarts = Math.max(next.shortcutStarts, 1);
    }
    await storageSet({ [AUTOMATION_START_DIGEST_KEY]: next }, { optional: true });
    return next;
  });
}

function isStopRequestedError(error) {
  return error instanceof StopRequestedError || /HHJA_STOP_REQUESTED/.test(error instanceof Error ? error.message : String(error));
}

async function setStopRequested(reason = 'user_stop') {
  stopRequested = true;
  stopReason = reason;
  setBusyCursor(false);
  await storageSet({
    autoApplyStopRequested: true,
    autoApplyStopRequestedAt: new Date().toISOString()
  }, { optional: true });
}

async function clearStopRequestedFlag() {
  stopRequested = false;
  stopReason = '';
  await storageSet({
    autoApplyStopRequested: false,
    autoApplyStopRequestedAt: ''
  }, { optional: true });
}

async function syncStopRequestedFromStorage() {
  if (stopRequested) return true;
  const { autoApplyStopRequested = false } = await storageGet(['autoApplyStopRequested'], { optional: true });
  if (autoApplyStopRequested === true) {
    stopRequested = true;
    stopReason = 'user_stop';
    setBusyCursor(false);
    return true;
  }
  return false;
}

function sleep(ms) {
  if (window.__HH_JOB_ASSISTANT_TEST_FAST_CLICKS__) return Promise.resolve();
  const deadline = Date.now() + Math.max(0, Number(ms) || 0);
  return new Promise((resolve) => {
    const tick = async () => {
      if (await syncStopRequestedFromStorage() || Date.now() >= deadline) {
        resolve();
        return;
      }
      setTimeout(tick, Math.min(100, deadline - Date.now()));
    };
    tick();
  });
}

function waitForStopRequest({ signal } = {}) {
  if (window.__HH_JOB_ASSISTANT_TEST_FAST_CLICKS__) return new Promise(() => {});
  return new Promise((resolve) => {
    const tick = async () => {
      if (signal?.aborted) {
        return;
      }
      if (await syncStopRequestedFromStorage()) {
        resolve();
        return;
      }
      setTimeout(tick, 100);
    };
    tick();
  });
}

function getRuntimeMessageTimeoutMs() {
  const testOverride = Number(window.__HH_JOB_ASSISTANT_TEST_RUNTIME_TIMEOUT_MS__);
  if (Number.isFinite(testOverride) && testOverride > 0) {
    return testOverride;
  }
  return RUNTIME_MESSAGE_TIMEOUT_MS;
}

function withTimeout(promise, timeoutMs, message) {
  let timeoutId = null;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

async function appendAgentLog(event, details = {}) {
  await withExtensionContext(() => globalThis.HHJobAssistantLog?.append?.('content', event, details), { optional: true });
}

function randomDelay(minMs, maxMs) {
  const min = Math.max(0, Number(minMs) || 0);
  const max = Math.max(min, Number(maxMs) || min);
  return Math.floor(min + Math.random() * (max - min + 1));
}

async function waitBeforeClick(minMs = CLICK_DELAY_MIN_MS, maxMs = CLICK_DELAY_MAX_MS) {
  if (window.__HH_JOB_ASSISTANT_TEST_FAST_CLICKS__) return;
  await sleep(randomDelay(minMs, maxMs));
}

async function markStopped(counters = {}) {
  await clearPendingSubmit();
  await saveQueue({ active: false });
  await saveSearchQueue({ active: false });
  await setRunState({ state: 'stopped', ...counters, currentAction: 'Остановлено', lastError: '' });
}

async function stopIfRequested(counters = {}) {
  if (!(await syncStopRequestedFromStorage())) return false;
  await markStopped(counters);
  closeDialog();
  return true;
}

function navigateTo(url) {
  if (window.__HH_JOB_ASSISTANT_TEST_NAVIGATE__) {
    window.__HH_JOB_ASSISTANT_TEST_NAVIGATE__(url);
    return;
  }
  const targetUrl = String(url || '');
  let settled = false;
  const fallback = () => {
    if (settled) return;
    settled = true;
    if (typeof location.assign === 'function') {
      location.assign(targetUrl);
      return;
    }
    location.href = targetUrl;
  };

  const fallbackTimer = setTimeout(fallback, 500);
  chrome.runtime.sendMessage({ type: 'NAVIGATE_TAB', url: targetUrl }).then((response) => {
    clearTimeout(fallbackTimer);
    if (response?.ok) {
      settled = true;
      return;
    }
    fallback();
  }).catch(() => {
    clearTimeout(fallbackTimer);
    fallback();
  });
}

function requireAuthenticatedHhPage() {
  if (hasAuthenticatedHhSignal()) return;
  throw new Error('Требуется авторизация HH. Войдите на hh.ru перед использованием HH Job Assistant.');
}

function isAuthenticSafeHhPageUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' &&
      (url.hostname === 'hh.ru' || url.hostname.endsWith('.hh.ru')) &&
      !isUnsafeHhUrl(url.href);
  } catch {
    return false;
  }
}

function hasStatusPanelParam() {
  try {
    return new URL(location.href).searchParams.get(HHJA_STATUS_PARAM) === '1';
  } catch {
    return false;
  }
}

function consumeStatusPanelParamAfterRender() {
  try {
    const url = new URL(location.href);
    if (url.searchParams.get(HHJA_STATUS_PARAM) !== '1') return false;
    url.searchParams.delete(HHJA_STATUS_PARAM);
    window.history?.replaceState?.(null, '', `${url.pathname}${url.search}${url.hash}`);
    return true;
  } catch {
    return false;
  }
}

function isSafeStatusPanelContext() {
  return isAuthenticSafeHhPageUrl(location.href) && !isUnsafePage() && hasAuthenticatedHhSignal();
}

function safeStatusNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.min(Math.floor(number), 1000000);
}

function safeStatusDate(value) {
  const text = String(value || '');
  return /^\d{4}-\d{2}-\d{2}$/.test(text) || /^\d{1,2}[./-]\d{1,2}[./-]\d{4}$/.test(text)
    ? text
    : '—';
}

function safeStatusTimestamp(value) {
  const timestamp = Date.parse(String(value || ''));
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : '—';
}

function normalizeSafeStatusSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const dailyLedger = snapshot.dailyLedger && typeof snapshot.dailyLedger === 'object'
    ? snapshot.dailyLedger
    : {};
  const automationAudit = snapshot.automationAudit && typeof snapshot.automationAudit === 'object'
    ? snapshot.automationAudit
    : {};
  const runState = snapshot.runState && typeof snapshot.runState === 'object'
    ? snapshot.runState
    : {};
  const startDigest = snapshot.startDigest && typeof snapshot.startDigest === 'object'
    ? snapshot.startDigest
    : {};
  const safeRunStates = new Set([
    'idle',
    'scanning',
    'applying',
    'waiting_for_dialog',
    'generating_cover_letter',
    'filling_cover_letter',
    'submitting',
    'refreshing_resumes',
    'complete',
    'dry_run_complete',
    'stopped',
    'paused',
    'error',
    'unknown'
  ]);
  const safeStopStates = new Set(['absent', 'armed', 'current', 'other', 'expired']);
  const safeDigestEvents = new Set([
    'none',
    'start',
    'continue',
    'duplicate_start',
    'duplicate_continue',
    'conflict_start',
    'conflict_continue'
  ]);
  const safeIssueCodes = new Set([
    'resumeUrlConfigured',
    'resumeUrlCurrent',
    'resumeProfileAvailable',
    'resumeProfileFresh',
    'expectedSalaryConfigured',
    'expectedSalaryMatchesResume',
    'contactConfigured',
    'laborContractEnabled',
    'workFormatsMatchResume',
    'dailyLimit200',
    'debugLogsEnabled',
    'debugRetention20',
    'resumeAutoRefreshEnabled',
    'aiProviderKeyConfigured',
    'fallbackProviderReady',
    'audit_unavailable',
    'audit_invalid',
    'audit_not_ready'
  ]);
  const manifestVersion = String(snapshot.manifestVersion || '');
  return {
    manifestVersion: /^\d+(?:\.\d+){0,3}$/.test(manifestVersion) ? manifestVersion : '—',
    dailyLedger: {
      date: safeStatusDate(dailyLedger.date),
      newSubmitted: safeStatusNumber(dailyLedger.newSubmitted),
      alreadyApplied: safeStatusNumber(dailyLedger.alreadyApplied),
      hhDailyLimitReached: dailyLedger.hhDailyLimitReached === true,
      updatedAt: safeStatusTimestamp(dailyLedger.updatedAt)
    },
    automationAudit: {
      ready: automationAudit.ready === true,
      checkedAt: safeStatusTimestamp(automationAudit.checkedAt),
      issues: Array.isArray(automationAudit.issues)
        ? [...new Set(automationAudit.issues.filter((issue) => safeIssueCodes.has(issue)))]
        : []
    },
    stopBeforeSubmit: {
      state: safeStopStates.has(snapshot.stopBeforeSubmit?.state)
        ? snapshot.stopBeforeSubmit.state
        : 'absent'
    },
    runState: {
      state: safeRunStates.has(runState.state) ? runState.state : 'unknown',
      found: safeStatusNumber(runState.found),
      processed: safeStatusNumber(runState.processed),
      applied: safeStatusNumber(runState.applied),
      alreadyApplied: safeStatusNumber(runState.alreadyApplied),
      skipped: safeStatusNumber(runState.skipped),
      errors: safeStatusNumber(runState.errors),
      updatedAt: safeStatusTimestamp(runState.updatedAt)
    },
    startDigest: {
      starts: safeStatusNumber(startDigest.starts),
      continues: safeStatusNumber(startDigest.continues),
      shortcutStarts: safeStatusNumber(startDigest.shortcutStarts),
      shortcutContinues: safeStatusNumber(startDigest.shortcutContinues),
      duplicates: safeStatusNumber(startDigest.duplicates),
      conflicts: safeStatusNumber(startDigest.conflicts),
      lastEvent: safeDigestEvents.has(startDigest.lastEvent) ? startDigest.lastEvent : 'none',
      updatedAt: safeStatusTimestamp(startDigest.updatedAt)
    }
  };
}

function appendStatusPanelLine(container, text) {
  const line = document.createElement('p');
  line.setAttribute('data-qa', 'hhja-status-line');
  line.textContent = text;
  container.append(line);
}

function getOrCreateStatusPanel() {
  if (!document?.body) return null;
  const existing = document.getElementById?.(HHJA_STATUS_PANEL_ID);
  if (existing) return existing;

  const panel = document.createElement('aside');
  panel.setAttribute('id', HHJA_STATUS_PANEL_ID);
  panel.setAttribute('data-qa', 'hhja-status-panel');
  panel.setAttribute('role', 'status');
  panel.setAttribute('aria-live', 'polite');
  panel.setAttribute('aria-labelledby', 'hhja-status-heading');
  panel.style.cssText = [
    'position:fixed',
    'right:16px',
    'bottom:16px',
    'z-index:2147483647',
    'max-width:min(420px,calc(100vw - 32px))',
    'padding:14px',
    'border:1px solid #8aa4bf',
    'border-radius:10px',
    'background:#fff',
    'color:#111827',
    'box-shadow:0 8px 28px rgba(15,23,42,.25)',
    'font:13px/1.4 Arial,sans-serif'
  ].join(';');

  const heading = document.createElement('h2');
  heading.setAttribute('id', 'hhja-status-heading');
  heading.textContent = 'HH Job Assistant: безопасный статус';
  heading.style.cssText = 'margin:0 0 8px;font-size:15px';
  const content = document.createElement('div');
  content.setAttribute('id', HHJA_STATUS_CONTENT_ID);
  content.setAttribute('data-qa', 'hhja-status-content');
  const refresh = document.createElement('button');
  refresh.setAttribute('type', 'button');
  refresh.setAttribute('data-qa', 'hhja-status-refresh');
  refresh.textContent = 'Обновить';
  refresh.style.cssText = 'margin-top:8px';
  refresh.addEventListener('click', () => {
    refreshStatusPanel().catch(() => {});
  });
  panel.append(heading, content, refresh);
  document.body.append(panel);
  return panel;
}

function renderSafeStatusPanel(snapshot) {
  const panel = getOrCreateStatusPanel();
  const content = document.getElementById?.(HHJA_STATUS_CONTENT_ID);
  if (!panel || !content) return false;
  content.replaceChildren?.();

  if (!snapshot) {
    appendStatusPanelLine(content, 'Статус: недоступен. Автоматизация не запускалась.');
    return true;
  }

  const ledger = snapshot.dailyLedger;
  const audit = snapshot.automationAudit;
  const run = snapshot.runState;
  const digest = snapshot.startDigest;
  appendStatusPanelLine(content, `Версия расширения: ${snapshot.manifestVersion}`);
  appendStatusPanelLine(content, `День МСК ${ledger.date}: новых ${ledger.newSubmitted}; уже откликались ${ledger.alreadyApplied}; лимит HH ${ledger.hhDailyLimitReached ? 'достигнут' : 'не достигнут'}; обновлено ${ledger.updatedAt}`);
  appendStatusPanelLine(content, `Проверка настроек: ${audit.ready ? 'готово' : 'не готово'}; проверено ${audit.checkedAt}; коды ${audit.issues.length ? audit.issues.join(', ') : 'нет'}`);
  appendStatusPanelLine(content, `Стоп перед отправкой: ${snapshot.stopBeforeSubmit.state}`);
  appendStatusPanelLine(content, `Запуск: ${run.state}; найдено ${run.found}; обработано ${run.processed}; отправлено ${run.applied}; уже откликались ${run.alreadyApplied}; пропущено ${run.skipped}; ошибок ${run.errors}; обновлено ${run.updatedAt}`);
  appendStatusPanelLine(content, `Дайджест входа: запусков ${digest.starts}; продолжений ${digest.continues}; запусков shortcut ${digest.shortcutStarts}; продолжений shortcut ${digest.shortcutContinues}; дублей ${digest.duplicates}; конфликтов ${digest.conflicts}; последнее ${digest.lastEvent}; обновлено ${digest.updatedAt}`);
  return true;
}

async function refreshStatusPanel({ runPreflight = true } = {}) {
  if (!isSafeStatusPanelContext()) {
    renderSafeStatusPanel(null);
    return false;
  }
  try {
    const response = await sendRuntimeMessage(
      { type: runPreflight ? 'RUN_SAFE_STATUS_PREFLIGHT' : 'GET_SAFE_STATUS_SNAPSHOT' },
      {
        timeoutMs: runPreflight ? getRuntimeMessageTimeoutMs() : STATUS_PANEL_MESSAGE_TIMEOUT_MS,
        timeoutMessage: 'Status unavailable.'
      }
    );
    return renderSafeStatusPanel(response?.ok === true ? normalizeSafeStatusSnapshot(response.snapshot) : null);
  } catch {
    renderSafeStatusPanel(null);
    return false;
  }
}

async function maybeShowStatusPanelFromUrlParam() {
  if (!hasStatusPanelParam()) return false;
  try {
    if (!isSafeStatusPanelContext()) return false;
    if (!renderSafeStatusPanel(null)) return true;
    await refreshStatusPanel({ runPreflight: true });
    consumeStatusPanelParamAfterRender();
    return true;
  } catch {
    // A status-only URL must never fall through into automation on a render failure.
    return true;
  }
}

function isHhSearchPageUrl(value) {
  try {
    const url = new URL(value, location.href);
    return /(^|\.)hh\.ru$/.test(url.hostname) && url.pathname === '/search/vacancy';
  } catch {
    return false;
  }
}

function isVacancyDetailPage() {
  return /\/vacancy\/\d+/.test(location.pathname);
}

function isResumePage() {
  return /^\/resume\/[^/?#]+/.test(location.pathname);
}

function getCurrentVacancyId() {
  return getVacancyId(location.href);
}

function queuedItemMatchesCurrentVacancy(queue) {
  if (!queue?.returnToSearch || !isVacancyDetailPage() || !Array.isArray(queue.items)) {
    return false;
  }

  const item = queue.items[queue.index];
  const currentId = getCurrentVacancyId();
  if (!item || !currentId) {
    return false;
  }

  const queuedIds = [
    item.vacancyId,
    getVacancyId(item.url || ''),
    getVacancyId(item.responseUrl || '')
  ].map((value) => String(value || '').trim()).filter(Boolean);

  return queuedIds.includes(String(currentId));
}

function getQueueSourceUrl() {
  return isHhSearchPageUrl(location.href) ? location.href : '';
}

function getItemResponseUrl(item) {
  return item?.responseUrl || buildResponseUrlFromVacancyId(getVacancyDedupeKey(item) || item?.vacancyId, item?.url || location.href);
}

async function waitForAlreadyAppliedConfirmation(item, { timeoutMs = 5000 } = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    if (
      isAlreadyAppliedForCurrentItem(document, item, { ignoreActiveResponseControl: true }) ||
      /вы\s+откликнулись|отклик\s+отправлен|отклик\s+успешно/i.test(getBodyText())
    ) {
      return true;
    }
    if (window.__HH_JOB_ASSISTANT_TEST_FAST_CLICKS__) break;
    await sleep(500);
  }
  return false;
}

function isContactQuestion(field, contextQuestion = '') {
  const text = cleanText(`${contextQuestion}\n${getFieldQuestionText(field)}\n${getFieldMarker(field)}`);
  const contactChannel = /telegram|телеграм|телеграмм|мессендж|messenger|whatsapp|ватсап|wa\.me|t\.me/i;
  const contactTarget = /ник|username|user\s*name|handle|аккаунт|ссылк|контакт|contact|профил|номер|телефон/i;
  const contactAction = /укажите|напишите|оставьте|сообщите|предоставьте|пришлите|дайте|куда|как\s+с\s+вами\s+связаться/i;
  if (/как\s+с\s+вами\s+связаться|контакт(?:ы|ные)?\s+для\s+связи|contact\s+(?:details|info)/i.test(text)) return true;
  return contactChannel.test(text) && contactTarget.test(text) && contactAction.test(text);
}

function isSalaryQuestion(field, contextQuestion = '') {
  return /зарплат|доход|компенсац|оклад|gross|salary|income/i.test(`${contextQuestion}\n${getFieldQuestionText(field)}\n${getFieldMarker(field)}`);
}

function isAgeQuestion(field, contextQuestion = '') {
  const text = cleanText(`${contextQuestion}\n${getFieldQuestionText(field)}\n${getFieldMarker(field)}`);
  return /(?:^|[^\p{L}\p{N}])(?:возраст|сколько\s+вам\s+лет|ваш\s+возраст|age)(?:[^\p{L}\p{N}]|$)/iu.test(text);
}

function allowsShortNumericQuestionAnswer(field, contextQuestion = '') {
  return /сколько|количеств|число|лет|год|разработчик|команд|зарплат|доход|компенсац|оклад|gross|salary|income/i.test(
    `${contextQuestion}\n${getFieldQuestionText(field)}\n${getFieldMarker(field)}`
  );
}

function extractContactFromText(text) {
  return (
    cleanText(text).match(/(?:https?:\/\/)?t\.me\/[a-z0-9_]+|@[a-z0-9_]{4,}|(?:https?:\/\/)?wa\.me\/\S+/i)?.[0] || ''
  );
}

function getQuestionAnswerInvalidReason(answer, field, contextQuestion = '') {
  const text = cleanText(answer);
  if (text.length < 2 && allowsShortNumericQuestionAnswer(field, contextQuestion) && /\d/.test(text)) {
    return '';
  }
  const genericReason = getGeneratedTextInvalidReason(text, { minLength: 2 });
  if (genericReason) return genericReason;
  const comparable = (value) => cleanText(value).toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const answerComparable = comparable(text);
  const questionComparable = comparable(getFieldQuestionText(field));
  if (
    answerComparable &&
    questionComparable &&
    (answerComparable === questionComparable || (answerComparable.length > 20 && questionComparable.includes(answerComparable)))
  ) {
    return 'Сгенерированный ответ повторяет вопрос работодателя.';
  }
  if (isContactQuestion(field, contextQuestion) && !/(?:^|\s)(?:@[a-z0-9_]{4,}|t\.me\/[a-z0-9_]+|https?:\/\/\S+|телеграм|telegram|whatsapp|wa\.me\/\S+)/i.test(text)) {
    if (!/общение\s+через\s+hh\.ru/i.test(text)) {
      return 'Сгенерированный ответ не похож на контакт для вопроса про мессенджер.';
    }
  }
  if (isSalaryQuestion(field, contextQuestion) && !/\d/.test(text) && !/по\s+договор[её]нности/i.test(text)) {
    return 'Сгенерированный ответ не содержит сумму для вопроса про доход.';
  }
  return '';
}

function createQuestionSnapshot(root) {
  const snapshot = captureQuestionFormSnapshot(root);
  return {
    root: snapshot.refs.root,
    textQuestions: snapshot.facts.textQuestions.map((descriptor, index) => ({
      ...descriptor,
      field: snapshot.refs.textFields[index]
    })),
    choiceQuestions: snapshot.facts.choiceQuestions.map((descriptor, index) => ({
      ...descriptor,
      group: snapshot.refs.choiceGroups[index]
    })),
    signature: snapshot.facts.signature
  };
}

function refreshQuestionSnapshot(snapshot) {
  if (!snapshot?.root) return false;
  if (snapshot.root !== document && !readControlState(snapshot.root).connected) return false;
  const currentFields = findQuestionFields(snapshot.root);
  const currentGroups = findQuestionControlGroups(snapshot.root);
  if (currentFields.length !== snapshot.textQuestions.length || currentGroups.length !== snapshot.choiceQuestions.length) return false;
  const currentSnapshot = createQuestionSnapshot(snapshot.root);
  if (
    currentSnapshot.textQuestions.length !== snapshot.textQuestions.length ||
    currentSnapshot.choiceQuestions.length !== snapshot.choiceQuestions.length
  ) return false;
  const sameTextStructure = currentSnapshot.textQuestions.every((descriptor, index) => (
    descriptor.id === snapshot.textQuestions[index].id ||
    (descriptor.contentEditable && snapshot.textQuestions[index].contentEditable)
  ));
  const sameChoiceStructure = currentSnapshot.choiceQuestions.every((descriptor, index) => (
    descriptor.id === snapshot.choiceQuestions[index].id
  ));
  if (!sameTextStructure || !sameChoiceStructure) return false;
  snapshot.root = currentSnapshot.root;
  snapshot.textQuestions = currentSnapshot.textQuestions.map((descriptor, index) => ({
    ...descriptor,
    id: snapshot.textQuestions[index].id,
    question: snapshot.textQuestions[index].question,
    contextQuestion: snapshot.textQuestions[index].contextQuestion
  }));
  snapshot.choiceQuestions = currentSnapshot.choiceQuestions;
  snapshot.signature = [
    ...snapshot.textQuestions.map((item) => `${item.id}:${item.inputType}:${item.required ? 'required' : 'optional'}`),
    ...snapshot.choiceQuestions.map((item) => `${item.id}:${item.inputType}`)
  ].join('|');
  return true;
}

function toGroqQuestion(descriptor) {
  if (descriptor.kind === 'choice') {
    return {
      id: descriptor.id,
      kind: 'choice',
      inputType: descriptor.inputType,
      question: descriptor.question.slice(0, 600),
      options: descriptor.options.slice(0, 30).map((option) => option.slice(0, 180))
    };
  }
  return {
    id: descriptor.id,
    kind: 'text',
    inputType: descriptor.inputType,
    question: descriptor.question.slice(0, 600),
    options: []
  };
}

function buildEmployerQuestionContext(root, textQuestions, choiceQuestions) {
  const sections = [];
  const fullRootText = getRootText(root);

  if (textQuestions.length > 0) {
    sections.push(
      [
        'Open text questions:',
        ...textQuestions.map((descriptor, index) => {
          const marker = cleanText(descriptor.contextQuestion || descriptor.question).slice(0, 600);
          return `Text question ${index + 1}: ${marker || 'question text not found'}`;
        })
      ].join('\n')
    );
  }

  if (sections.length === 0) {
    const fallbackText = joinCappedLines(uniqueContextLines(fullRootText), QUESTION_VISIBLE_FALLBACK_MAX_CHARS);
    if (fallbackText) {
      sections.push(['Visible HH response form fallback:', fallbackText].join('\n'));
    }
  }

  if (choiceQuestions.length > 0) {
    sections.push(
      [
        'Choice groups:',
        ...choiceQuestions.map((descriptor, index) => {
          const group = descriptor.group;
          const options = group.options.map((option, optionIndex) => `${optionIndex + 1}. ${option.label}`).join('\n');
          return [
            `Choice group ${index + 1} (${group.type}, ${group.type === 'radio' ? 'choose one' : 'choose all matching'}):`,
            group.question ? `Question/context: ${group.question}` : 'Question/context: not found',
            options
          ].join('\n');
        })
      ].join('\n')
    );
  }

  return sections.join('\n\n').slice(0, QUESTION_CONTEXT_GROQ_MAX_CHARS);
}

function summarizeEmployerQuestionInputs(textQuestions, choiceQuestions) {
  return {
    textQuestions: textQuestions.map((descriptor, index) => ({
      index: index + 1,
      question: cleanText(descriptor.contextQuestion || descriptor.question || 'question text not found'),
      target: getFieldLogTarget(descriptor.field)
    })),
    choiceQuestions: choiceQuestions.map((descriptor, index) => {
      const group = descriptor.group;
      return {
      index: index + 1,
      type: group.type,
      question: cleanText(group.question || group.key || 'question text not found'),
      options: group.options.map((option, optionIndex) => ({
        index: optionIndex + 1,
        label: option.label
      }))
    }})
  };
}

function buildQuestionAnswerAudit(textQuestions, choiceQuestions, selectedChoices = { labels: [] }) {
  const selectedLabels = new Set((selectedChoices?.labels || []).map((label) => cleanText(label)));
  return {
    textAnswers: textQuestions.map((descriptor, index) => ({
      index: index + 1,
      question: cleanText(descriptor.contextQuestion || descriptor.question || 'question text not found'),
      answer: cleanText(getFieldValue(descriptor.field))
    })),
    choiceAnswers: choiceQuestions.map((descriptor, index) => {
      const group = descriptor.group;
      return {
      index: index + 1,
      type: group.type,
      question: cleanText(group.question || group.key || 'question text not found'),
      selectedOptions: group.options
        .filter((option) => readControlState(option.control).checked || selectedLabels.has(cleanText(option.label)))
        .map((option) => option.label)
    }})
  };
}

async function clickFollowupConfirmButton(confirmButton, counters) {
  await setRunState({
    state: 'submitting',
    ...counters,
    currentAction: 'HH предупреждает: отклик может получить отказ — подтверждаю отклик',
    lastError: ''
  });
  await waitBeforeClick(FOLLOWUP_CONFIRM_CLICK_DELAY_MIN_MS, FOLLOWUP_CONFIRM_CLICK_DELAY_MAX_MS);
  const freshConfirmButton = findFollowupConfirmButton(getDialogRoot());
  if (!freshConfirmButton) return false;
  clickWithActionCursor(freshConfirmButton);
  await sleep(FOLLOWUP_CONFIRM_SETTLE_MS);
  return true;
}

async function confirmFollowupIfNeeded(previousText, counters) {
  if (window.__HH_JOB_ASSISTANT_TEST_FAST_CLICKS__) {
    const confirmButton = findFollowupConfirmButton(getDialogRoot());
    if (!confirmButton) {
      return false;
    }

    return clickFollowupConfirmButton(confirmButton, counters);
  }

  const root = await waitForDialogOrChange(previousText, 5000);
  const confirmButton = findFollowupConfirmButton(root);
  if (!confirmButton) {
    return false;
  }

  return clickFollowupConfirmButton(confirmButton, counters);
}

async function confirmInitialFollowupIfNeeded(root, previousText, counters) {
  const confirmButton = findFollowupConfirmButton(root);
  if (!confirmButton) {
    return root;
  }

  if (!await clickFollowupConfirmButton(confirmButton, counters)) return getDialogRoot();
  return waitForDialogOrChange(previousText, window.__HH_JOB_ASSISTANT_TEST_FAST_CLICKS__ ? 0 : 7000);
}

function closeDialog() {
  const root = getDialogRoot();
  const close = findCloseButton(root);
  if (close) {
    close.click();
    return;
  }

  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
  document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', bubbles: true }));
  if (root !== document) {
    root.dispatchEvent?.(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
  }
}

function prepareResponseButtonForCurrentTab(button) {
  if (!button) return;
  if (button.getAttribute?.('target')) {
    button.removeAttribute?.('target');
  }
}

function setBusyCursor(active) {
  if (!document?.body?.style) return;
  document.body.style.cursor = active ? 'progress' : '';
}

function getActionOverlay() {
  if (!actionOverlay && globalThis.HHJobAssistantActionOverlay) {
    actionOverlay = new globalThis.HHJobAssistantActionOverlay({
      panelEnabled: false,
      cursorId: 'hh-job-assistant-auto-apply-cursor',
      highlightAttr: 'data-hh-job-assistant-auto-apply-highlight'
    });
  }
  return actionOverlay;
}

function showActionCursorFor(node) {
  getActionOverlay()?.highlight(node);
}

function clickWithActionCursor(node) {
  showActionCursorFor(node);
  node.click();
}

async function sendRuntimeMessage(message, options = {}) {
  const response = withExtensionContext(() => new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (result) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(localizeError(lastError.message || String(lastError))));
        return;
      }
      resolve(result);
    });
  }));
  let pending = response;
  if (options.timeoutMs) {
    pending = withTimeout(pending, options.timeoutMs, options.timeoutMessage || 'Ответ расширения не получен вовремя.');
  }
  if (!options.cancelOnStop) {
    return pending;
  }
  const stopController = new AbortController();
  return Promise.race([
    pending,
    waitForStopRequest({ signal: stopController.signal }).then(() => {
      throw new StopRequestedError();
    })
  ]).finally(() => {
    stopController.abort();
  });
}

async function setRunState(patch) {
  await syncStopRequestedFromStorage();
  const terminalStates = new Set(['complete', 'idle', 'dry_run_complete', 'stopped', 'paused']);
  const stopBeforeSubmitTerminalStates = new Set(['complete', 'dry_run_complete', 'stopped', 'error']);
  const nextPatch = { ...(patch || {}) };
  if (stopRequested && stopReason === 'user_stop' && nextPatch.state && nextPatch.state !== 'stopped' && nextPatch.state !== 'error') {
    nextPatch.state = 'stopped';
    nextPatch.currentAction = 'Остановлено';
  }
  if (stopBeforeSubmitTerminalStates.has(nextPatch.state)) {
    await clearStopBeforeSubmitForRun(activeRunId, `terminal_${nextPatch.state}`);
  }
  if (terminalStates.has(nextPatch.state) && !Object.prototype.hasOwnProperty.call(nextPatch, 'currentAction')) {
    nextPatch.currentAction = nextPatch.state === 'complete' ? 'Отклики завершены' : '';
  }
  if (
    nextPatch.state &&
    nextPatch.state !== 'error' &&
    !Object.prototype.hasOwnProperty.call(nextPatch, 'lastError')
  ) {
    nextPatch.lastError = '';
  }
  const nextState = patch?.state || '';
  if (nextState) {
    setBusyCursor(
      /^(scanning|applying|waiting_for_dialog|generating_cover_letter|filling_cover_letter|submitting|refreshing_resumes)$/.test(
        nextState
      )
    );
  }
  await withExtensionContext(() => chrome.runtime.sendMessage({ type: 'SET_RUN_STATE', patch: nextPatch }), { optional: true });
}

async function appendResult(item) {
  const response = await withExtensionContext(() => chrome.runtime.sendMessage({ type: 'APPEND_RUN_RESULT', item }), { optional: true });
  if (response?.ok) return;
  if (extensionContextInvalidated) return;

  const { runResults = [] } = await storageGet(['runResults'], { optional: true });
  const result = {
    ...item,
    timestamp: item.timestamp || new Date().toISOString()
  };
  await storageSet({ runResults: [...runResults.slice(-199), result] }, { optional: true });
  await appendAgentLog('run_result_storage_fallback', {
    status: result.status || '',
    vacancyId: result.vacancyId || '',
    title: result.title || ''
  });
}

async function ensureRunResultStored(item) {
  if (extensionContextInvalidated) return;
  const { runResults = [] } = await storageGet(['runResults'], { optional: true });
  const exists = runResults.slice(-10).some((result) => (
    result?.status === item.status &&
    String(result?.vacancyId || '') === String(item.vacancyId || '') &&
    result?.timestamp === item.timestamp
  ));
  if (exists) return;
  await storageSet({ runResults: [...runResults.slice(-199), item] }, { optional: true });
}

async function savePendingSubmit({ item, counters, status, coverLetterUsed, testDetected }) {
  const navigationQueue = item.navigationQueue || {};
  const returnToSearchUrl = navigationQueue.returnToSearch && isHhSearchPageUrl(navigationQueue.sourceUrl)
    ? navigationQueue.sourceUrl
    : '';
  await storageSet({
    autoApplyPendingSubmit: {
      runId: activeRunId,
      item: {
        index: item.index,
        vacancyId: item.vacancyId,
        title: item.title,
        url: item.url
      },
      counters: { ...counters },
      status,
      coverLetterUsed,
      testDetected,
      createdAt: new Date().toISOString(),
      sourceUrl: location.href,
      returnToSearchUrl,
      queueLimit: navigationQueue.limit || null,
      queueConfig: navigationQueue.config || null,
      queueMaxProcessed: navigationQueue.maxProcessed || null,
      queueProcessedVacancyIds: Array.isArray(navigationQueue.processedVacancyIds)
        ? navigationQueue.processedVacancyIds
        : []
    }
  });
}

async function clearPendingSubmit() {
  await storageSet({ autoApplyPendingSubmit: null });
}

async function appendSkippedResponse(item, counters, status, error) {
  counters.skipped += 1;
  await appendResult({
    index: item.index,
    vacancyId: item.vacancyId,
    title: item.title,
    url: item.url,
    status,
    coverLetterUsed: false,
    testDetected: item.testDetected,
    error
  });
  await setRunState({ state: 'applying', ...counters, lastError: error });
  closeDialog();
}

async function appendAlreadyAppliedResponse(item, counters, { coverLetterUsed = false, testDetected = item.testDetected } = {}) {
  const { ledger } = await recordDailyApplication(item, 'already_applied', counters);
  syncCountersFromLedger(counters, ledger);
  await appendResult({
    index: item.index,
    vacancyId: item.vacancyId,
    title: item.title,
    url: item.url,
    status: 'applied_already_confirmed',
    coverLetterUsed,
    testDetected,
    error: ''
  });
  closeDialog();
}

async function appendDirectClickResponse(item, counters, { status = 'applied_direct_click', coverLetterUsed = false, testDetected = item.testDetected } = {}) {
  const { ledger } = await recordDailyApplication(item, 'submitted', counters);
  syncCountersFromLedger(counters, ledger);
  await setRunState({ state: 'applying', ...counters, currentAction: 'Отклик отправлен' });
  await clearPendingSubmit();
  await appendResult({
    index: item.index,
    vacancyId: item.vacancyId,
    title: item.title,
    url: item.url,
    status,
    coverLetterUsed,
    testDetected,
    error: ''
  });
  closeDialog();
}

async function completeHhDailyResponseLimit(item, counters, reason = '') {
  counters.skipped += 1;
  const { ledger } = await recordDailyApplication(item, 'hh_daily_limit', counters);
  syncCountersFromLedger(counters, ledger);
  await clearPendingSubmit();
  await saveQueue({ active: false });
  await saveSearchQueue({ active: false });
  const result = {
    index: item.index,
    vacancyId: item.vacancyId,
    title: item.title,
    url: item.url,
    status: 'skipped_hh_daily_response_limit',
    coverLetterUsed: false,
    testDetected: item.testDetected,
    error: reason || `${HH_DAILY_RESPONSE_LIMIT_ACTION}. ${HH_DAILY_RESPONSE_LIMIT_MESSAGE}`,
    timestamp: new Date().toISOString()
  };
  await appendResult(result);
  await ensureRunResultStored(result);
  await setRunState({
    state: 'complete',
    ...counters,
    currentAction: HH_DAILY_RESPONSE_LIMIT_ACTION,
    lastError: ''
  });
  closeDialog();
  return { terminal: true, reason: 'hh_daily_response_limit' };
}

async function stopBeforeSubmitIfRequested(counters) {
  if (await stopIfRequested(counters)) return true;
  const armedState = await readAutoApplyStopBeforeSubmit();
  if (!armedState) return false;
  const runId = String(activeRunId || '');
  if (!runId) return false;
  if (armedState.runId && armedState.runId !== runId) return false;
  if (!armedState.runId) {
    await storageSet({ autoApplyStopBeforeSubmit: { ...armedState, runId } }, { optional: true });
  }
  await clearStopBeforeSubmitForRun(runId, 'before_submit');
  await setStopRequested('stop_before_submit');
  await appendAgentLog('stop_before_submit', { url: location.href });
  await markStopped(counters);
  return true;
}

async function verifySubmitConfirmed({ item, counters, status, coverLetterUsed, testDetected }) {
  const started = Date.now();
  const timeoutMs = window.__HH_JOB_ASSISTANT_TEST_FAST_CLICKS__ ? 0 : SUBMIT_CONFIRM_TIMEOUT_MS;
  while (Date.now() - started <= timeoutMs) {
    const root = getDialogRoot();
    if (
      isAlreadyAppliedForCurrentItem(root, item, { ignoreActiveResponseControl: true }) ||
      isAlreadyAppliedForCurrentItem(document, item, { ignoreActiveResponseControl: true }) ||
      detectHhDailyResponseLimit(root) ||
      detectHhDailyResponseLimit(document) ||
      detectBlockedResponseReason(root) ||
      findFollowupConfirmButton(root) ||
      (!hasSubmitControl(root) && !hasSubmitControl(document))
    ) {
      break;
    }
    await sleep(500);
  }

  const root = getDialogRoot();
  const followupConfirmButton = findFollowupConfirmButton(root);
  if (followupConfirmButton) {
    await clickFollowupConfirmButton(followupConfirmButton, counters);
    await sleep(POST_FILL_SETTLE_MS);
    return verifySubmitConfirmed({ item, counters, status, coverLetterUsed, testDetected });
  }

  const dailyLimitReason = detectHhDailyResponseLimit(root) || detectHhDailyResponseLimit(document);
  if (dailyLimitReason) {
    return completeHhDailyResponseLimit(item, counters, dailyLimitReason);
  }

  const blockedReason = detectBlockedResponseReason(root);
  if (blockedReason) {
    await clearPendingSubmit();
    await appendSkippedResponse(item, counters, 'skipped_response_unavailable', blockedReason);
    return false;
  }

  if (
    isAlreadyAppliedForCurrentItem(root, item, { ignoreActiveResponseControl: true }) ||
    isAlreadyAppliedForCurrentItem(document, item, { ignoreActiveResponseControl: true })
  ) {
    const { ledger } = await recordDailyApplication(item, 'submitted', counters);
    syncCountersFromLedger(counters, ledger);
    await setRunState({ state: 'applying', ...counters, currentAction: 'Отклик отправлен' });
    await clearPendingSubmit();
    await appendResult({
      index: item.index,
      vacancyId: item.vacancyId,
      title: item.title,
      url: item.url,
      status,
      coverLetterUsed,
      testDetected,
      error: ''
    });
    closeDialog();
    return false;
  }

  if (hasSubmitControl(root) || hasSubmitControl(document)) {
    const fields = findQuestionFields(root);
    const validationText = collectResponseValidationText(root);
    await appendAgentLog('submit_not_confirmed_diagnostics', {
      vacancyId: item.vacancyId,
      status,
      url: location.href,
      hasSubmitInDialog: hasSubmitControl(root),
      hasSubmitInDocument: hasSubmitControl(document),
      textFields: fields.length,
      textFieldLengths: fields.map((field) => cleanText(getFieldValue(field)).length),
      validationText
    });
    await clearPendingSubmit();
    await appendSkippedResponse(
      item,
      counters,
      'skipped_submit_not_confirmed',
      validationText || 'HH response dialog stayed open after submit; response was not confirmed.'
    );
    return false;
  }

  return true;
}

async function finalizePendingSubmit() {
  const { autoApplyPendingSubmit, autoApplyQueue } = await storageGet(['autoApplyPendingSubmit', 'autoApplyQueue']);
  if (!autoApplyPendingSubmit?.item) {
    return false;
  }

  if (!isAlreadyAppliedPage(document)) {
    return false;
  }

  const counters = {
    found: 1,
    processed: 1,
    applied: 0,
    skipped: 0,
    errors: 0,
    ...(autoApplyPendingSubmit.counters || {})
  };
  const { ledger } = await recordDailyApplication(autoApplyPendingSubmit.item, 'submitted', counters);
  syncCountersFromLedger(counters, ledger);
  await clearPendingSubmit();
  await appendResult({
    ...autoApplyPendingSubmit.item,
    status: autoApplyPendingSubmit.status || 'applied',
    coverLetterUsed: Boolean(autoApplyPendingSubmit.coverLetterUsed),
    testDetected: Boolean(autoApplyPendingSubmit.testDetected),
    error: ''
  });
  await appendAgentLog('pending_submit_finalized', {
    vacancyId: autoApplyPendingSubmit.item.vacancyId,
    status: autoApplyPendingSubmit.status || 'applied',
    sourceUrl: autoApplyPendingSubmit.sourceUrl || ''
  });
  const activeQueueReturnUrl = autoApplyQueue?.active && autoApplyQueue.returnToSearch && isHhSearchPageUrl(autoApplyQueue.sourceUrl)
    ? autoApplyQueue.sourceUrl
    : '';
  const pendingReturnUrl = isHhSearchPageUrl(autoApplyPendingSubmit.returnToSearchUrl || '')
    ? autoApplyPendingSubmit.returnToSearchUrl
    : '';
  const returnToSearchUrl = activeQueueReturnUrl || pendingReturnUrl;
  if (returnToSearchUrl) {
    const nextIndex = (Number(autoApplyQueue?.index) || 0) + 1;
    await saveQueue({ ...(autoApplyQueue || {}), active: false, index: nextIndex, counters });
    await saveSearchQueue({
      active: true,
      runId: autoApplyQueue?.runId || autoApplyPendingSubmit.runId || activeRunId,
      limit: autoApplyQueue?.limit || autoApplyPendingSubmit.queueLimit || 20,
      counters,
      config: autoApplyQueue?.config || autoApplyPendingSubmit.queueConfig || null,
      maxProcessed: autoApplyQueue?.maxProcessed || autoApplyPendingSubmit.queueMaxProcessed || null,
      processedVacancyIds: autoApplyQueue?.processedVacancyIds || autoApplyPendingSubmit.queueProcessedVacancyIds || []
    });
    await setRunState({ state: 'applying', ...counters, currentAction: 'Возвращаюсь на страницу поиска HH', lastError: '' });
    navigateTo(returnToSearchUrl);
    return true;
  }
  await setRunState({ state: 'complete', ...counters, lastError: '' });
  return true;
}

async function finalizePendingSubmitFromSearchReturn(counters, runId = activeRunId) {
  const { autoApplyPendingSubmit } = await storageGet(['autoApplyPendingSubmit']);
  if (!autoApplyPendingSubmit?.item) {
    return false;
  }
  if (runId && autoApplyPendingSubmit.runId && autoApplyPendingSubmit.runId !== runId) {
    return false;
  }

  const pendingCounters = autoApplyPendingSubmit.counters || {};
  for (const key of ['found', 'processed', 'applied', 'skipped', 'errors']) {
    counters[key] = Math.max(Number(counters[key]) || 0, Number(pendingCounters[key]) || 0);
  }
  if (!Number.isFinite(Number(pendingCounters.processed))) {
    counters.processed += 1;
  }
  const { ledger } = await recordDailyApplication(autoApplyPendingSubmit.item, 'submitted', counters);
  syncCountersFromLedger(counters, ledger);
  await clearPendingSubmit();
  await appendResult({
    ...autoApplyPendingSubmit.item,
    status: autoApplyPendingSubmit.status || 'applied',
    coverLetterUsed: Boolean(autoApplyPendingSubmit.coverLetterUsed),
    testDetected: Boolean(autoApplyPendingSubmit.testDetected),
    error: ''
  });
  await appendAgentLog('pending_submit_finalized_from_search_return', {
    vacancyId: autoApplyPendingSubmit.item.vacancyId,
    status: autoApplyPendingSubmit.status || 'applied',
    sourceUrl: autoApplyPendingSubmit.sourceUrl || '',
    returnUrl: location.href
  });
  return true;
}

async function getConfig() {
  const values = await storageGet([
    'dailyLimit',
    'delayMinMs',
    'delayMaxMs',
    'employmentPreference',
    'workFormatPreference',
    'expectedSalary',
    'aiEnabled',
    'aiProvider',
    'aiProviderCredentials',
    'groqApiKey',
    'resumeUrl',
    'fallbackCoverLetterTemplate',
    'coverPrompt',
    'employerQuestionPrompt'
  ]);
  return {
    dailyLimit: Number(values.dailyLimit) || DEFAULTS.dailyLimit,
    delayMinMs: Number(values.delayMinMs) || DEFAULTS.delayMinMs,
    delayMaxMs: Number(values.delayMaxMs) || DEFAULTS.delayMaxMs,
    employmentPreference: normalizeMultiPreference(values.employmentPreference, EMPLOYMENT_PREFERENCE_VALUES),
    workFormatPreference: normalizeMultiPreference(values.workFormatPreference, WORK_FORMAT_PREFERENCE_VALUES),
    expectedSalary: String(values.expectedSalary || '').trim(),
    aiEnabled: values.aiEnabled !== false,
    aiProvider: values.aiProvider,
    aiProviderCredentials: values.aiProviderCredentials,
    groqApiKey: values.groqApiKey,
    resumeUrl: values.resumeUrl,
    fallbackCoverLetterTemplate:
      cleanText(values.fallbackCoverLetterTemplate) || DEFAULTS.fallbackCoverLetterTemplate,
    coverPrompt: values.coverPrompt,
    employerQuestionPrompt: values.employerQuestionPrompt
  };
}

function normalizeMultiPreference(value, allowedValues) {
  const values = Array.isArray(value)
    ? value
    : value === 'any'
      ? [...allowedValues]
      : value
        ? [value]
        : [];
  return [...new Set(values.filter((item) => allowedValues.has(item)))];
}

async function generateCoverLetter(vacancyText, options = {}) {
  const { aiEnabled = true, fallbackTemplate = '' } = options;
  if (!aiEnabled) {
    return getFallbackCoverLetter(vacancyText, fallbackTemplate);
  }
  const response = await sendRuntimeMessage({
    type: 'GENERATE_COVER_LETTER',
    task: 'cover_letter',
    vacancyText
  }, {
    timeoutMs: getRuntimeMessageTimeoutMs(),
    timeoutMessage: 'Запрос сопроводительного письма к AI-провайдеру не уложился во время.',
    cancelOnStop: true
  });
  if (!response?.ok) {
    throw new Error(localizeError(response?.error, 'Не удалось сгенерировать сопроводительное письмо'));
  }
  const text = sanitizeGeneratedText(response.text);
  const invalidReason = getCoverLetterInvalidReason(text);
  if (invalidReason) {
    throw new Error(`AI-провайдер вернул неподходящее сопроводительное письмо: ${invalidReason}`);
  }
  return text;
}

function isFatalAutoApplyError(error) {
  return /login|captcha|anti-bot|слишком много запросов|не робот|страница входа|антибот/i.test(
    error instanceof Error ? error.message : String(error)
  );
}

async function generateTestAssistance(vacancyText, questions, coverLetterRequested) {
  const response = await sendRuntimeMessage({
    type: 'GENERATE_COVER_LETTER',
    task: 'test_assist',
    vacancyText,
    questions,
    coverLetterRequested
  }, {
    timeoutMs: getRuntimeMessageTimeoutMs(),
    timeoutMessage: 'Запрос помощи с вопросами к AI-провайдеру не уложился во время.',
    cancelOnStop: true
  });
  if (!response?.ok) {
    throw new Error(localizeError(response?.error, 'Не удалось подготовить ответы на вопросы работодателя'));
  }
  return response;
}

async function getExpectedSalary() {
  const { expectedSalary = '' } = await storageGet(['expectedSalary']);
  return String(expectedSalary || '').trim();
}

async function getQuestionPreferences() {
  const {
    employmentPreference = DEFAULTS.employmentPreference,
    workFormatPreference = DEFAULTS.workFormatPreference
  } = await storageGet(['employmentPreference', 'workFormatPreference'], { optional: true });
  return {
    employmentPreference: normalizeMultiPreference(employmentPreference, EMPLOYMENT_PREFERENCE_VALUES),
    workFormatPreference: normalizeMultiPreference(workFormatPreference, WORK_FORMAT_PREFERENCE_VALUES)
  };
}

function isNumericOnlyQuestionField(field) {
  const state = readControlState(field);
  const type = cleanText(state.type).toLowerCase();
  const inputMode = cleanText(state.inputMode).toLowerCase();
  return type === 'number' || /numeric|decimal/.test(inputMode);
}

async function getDeterministicStructuredAnswers(snapshot) {
  const {
    expectedSalary = '',
    telegramUsername = '',
    resumeText = '',
    resumeParsedText = '',
    resumeCache = null,
    resumeCandidateFacts = null
  } = await storageGet(
    ['expectedSalary', 'telegramUsername', 'resumeText', 'resumeParsedText', 'resumeCache', 'resumeCandidateFacts'],
    { optional: true }
  );
  const preferences = await getQuestionPreferences();
  const resumeSource = [resumeParsedText, resumeText, resumeCache?.text].filter(Boolean).join('\n');
  const contact = cleanText(telegramUsername) || extractContactFromText(resumeSource);
  const answers = new Map();
  let blockedReason = '';
  let blockedStatus = '';

  for (const descriptor of snapshot.textQuestions) {
    if (isAgeQuestion(descriptor.field, descriptor.contextQuestion)) {
      const age = Number(resumeCandidateFacts?.age);
      if (Number.isInteger(age) && age >= 18 && age <= 80) {
        answers.set(descriptor.id, { id: descriptor.id, answer: String(age), selectedOptions: [] });
      } else {
        blockedReason = 'Пропущено: точный возраст не извлечён из резюме HH.';
        blockedStatus = 'skipped_required_candidate_fact_missing';
      }
      continue;
    }
    if (isSalaryQuestion(descriptor.field, descriptor.contextQuestion)) {
      if (cleanText(expectedSalary)) {
        answers.set(descriptor.id, { id: descriptor.id, answer: cleanText(expectedSalary), selectedOptions: [] });
      } else if (isNumericOnlyQuestionField(descriptor.field) && descriptor.required) {
        blockedReason = 'Пропущено: обязательное числовое поле зарплаты не заполнено в настройках.';
        blockedStatus = 'skipped_required_numeric_salary_missing';
      } else {
        answers.set(descriptor.id, { id: descriptor.id, answer: 'По договорённости', selectedOptions: [] });
      }
      continue;
    }
    if (isContactQuestion(descriptor.field, descriptor.contextQuestion)) {
      answers.set(descriptor.id, {
        id: descriptor.id,
        answer: contact || 'Предпочту общение через hh.ru',
        selectedOptions: []
      });
    }
  }

  for (const descriptor of snapshot.choiceQuestions) {
    const preferred = getPreferredChoiceOptions(descriptor.group, preferences).map((option) => cleanText(option.label));
    const onlyOption = descriptor.group.options.length === 1 ? cleanText(descriptor.group.options[0].label) : '';
    const selectedOptions = preferred.length > 0 ? preferred : [onlyOption].filter(Boolean);
    if (selectedOptions.length > 0) {
      answers.set(descriptor.id, { id: descriptor.id, answer: '', selectedOptions });
    }
  }
  return { answers, blockedReason, blockedStatus };
}

async function buildSafeStructuredFallback(snapshot, existingAnswers = new Map()) {
  const answers = new Map(existingAnswers);
  const preferences = await getQuestionPreferences();
  for (const descriptor of snapshot.choiceQuestions) {
    if (answers.has(descriptor.id)) continue;
    const preferred = getPreferredChoiceOptions(descriptor.group, preferences);
    const ownOption = descriptor.group.options.find((option) => /^(?:свой вариант|другое|other)$/i.test(cleanText(option.label)));
    const selected = (preferred.length > 0 ? preferred : [ownOption].filter(Boolean)).map((option) => cleanText(option.label));
    if (selected.length > 0) {
      answers.set(descriptor.id, { id: descriptor.id, answer: '', selectedOptions: selected });
    }
  }
  return answers;
}

function parseLegacyStructuredAnswers(text, expectedDescriptors) {
  const source = String(text || '');
  if (expectedDescriptors.length === 1 && !/(?:^|\n)\s*(?:Text question|Choice group)\s+\d+\s*:/i.test(source)) {
    const descriptor = expectedDescriptors[0];
    const value = sanitizeGeneratedText(source);
    return [{
      id: descriptor.id,
      answer: descriptor.kind === 'text' ? value : '',
      selectedOptions: descriptor.kind === 'choice' ? [value].filter(Boolean) : []
    }];
  }
  const result = [];
  for (const descriptor of expectedDescriptors) {
    const legacyIndex = descriptor.legacyIndex;
    const label = descriptor.kind === 'choice' ? 'Choice group' : 'Text question';
    const marker = new RegExp(`(?:^|\\n)\\s*${label}\\s+${legacyIndex}\\s*:\\s*`, 'ig');
    const matches = [...source.matchAll(marker)];
    if (matches.length !== 1) throw new Error('AI-провайдер вернул неоднозначные или пропущенные метки ответов');
    const start = matches[0].index + matches[0][0].length;
    const remaining = source.slice(start);
    const end = remaining.search(/\n\s*(?:Text question|Choice group)\s+\d+\s*:/i);
    const value = cleanText(end >= 0 ? remaining.slice(0, end) : remaining);
    result.push({
      id: descriptor.id,
      answer: descriptor.kind === 'text' ? stripAnswerLabel(value) : '',
      selectedOptions: descriptor.kind === 'choice'
        ? value.split(/\s*;\s*|\n+/).map(cleanText).filter(Boolean)
        : []
    });
  }
  return result;
}

function validateStructuredAssistance(response, expectedDescriptors, { coverLetterRequested = false } = {}) {
  if (!Array.isArray(response?.answers) && !window.__HH_JOB_ASSISTANT_TEST_FAST_CLICKS__) {
    throw new Error('AI-провайдер не вернул обязательный структурированный массив answers');
  }
  const sourceAnswers = Array.isArray(response?.answers)
    ? response.answers
    : parseLegacyStructuredAnswers(response?.text, expectedDescriptors);
  if (sourceAnswers.length !== expectedDescriptors.length) {
    throw new Error('AI-провайдер вернул неправильное количество структурированных ответов');
  }
  const expectedById = new Map(expectedDescriptors.map((descriptor) => [descriptor.id, descriptor]));
  const seen = new Set();
  const answers = new Map();
  for (const item of sourceAnswers) {
    const id = cleanText(item?.id);
    const descriptor = expectedById.get(id);
    if (!descriptor || seen.has(id) || typeof item.answer !== 'string' || !Array.isArray(item.selectedOptions)) {
      throw new Error('AI-провайдер вернул неизвестный или дублирующийся идентификатор ответа');
    }
    seen.add(id);
    const selectedOptions = item.selectedOptions.map(cleanText).filter(Boolean);
    if (descriptor.kind === 'text' && selectedOptions.length > 0) {
      throw new Error('AI-провайдер смешал текстовый ответ и варианты выбора');
    }
    if (descriptor.kind === 'choice') {
      if (selectedOptions.some((option) => !descriptor.options.includes(option))) {
        throw new Error('AI-провайдер вернул вариант, которого нет в форме HH');
      }
      if ((descriptor.inputType === 'radio' && selectedOptions.length !== 1) || selectedOptions.length === 0) {
        throw new Error('AI-провайдер не выбрал допустимый вариант формы HH');
      }
    }
    answers.set(id, {
      id,
      answer: cleanText(item.answer),
      selectedOptions
    });
  }
  if (seen.size !== expectedById.size) throw new Error('AI-провайдер пропустил обязательный идентификатор ответа');
  const coverLetter = cleanText(response?.coverLetter || '');
  if (!coverLetterRequested && coverLetter) throw new Error('AI-провайдер вернул лишнее сопроводительное письмо');
  return { answers, coverLetter };
}

function serializeStructuredAssistance(snapshot, answers) {
  const lines = [];
  snapshot.textQuestions.forEach((descriptor, index) => {
    const answer = answers.get(descriptor.id)?.answer;
    if (answer) lines.push(`Text question ${index + 1}: ${answer}`);
  });
  snapshot.choiceQuestions.forEach((descriptor, index) => {
    const selected = answers.get(descriptor.id)?.selectedOptions || [];
    if (selected.length > 0) lines.push(`Choice group ${index + 1}: ${selected.join('; ')}`);
  });
  return lines.join('\n');
}

async function recordLocalAiFallback(task, reason) {
  await sendRuntimeMessage({
    type: 'RECORD_AI_FALLBACK',
    task,
    reason: cleanText(reason || 'local_fallback').slice(0, 100)
  }, { timeoutMs: 5000 }).catch(() => {});
}

async function getFallbackCoverLetter(vacancyText = '', templateOverride = '') {
  void vacancyText;
  const directTemplate = cleanText(templateOverride);
  if (directTemplate) return directTemplate;
  const stored = await storageGet(['fallbackCoverLetterTemplate']);
  return cleanText(stored.fallbackCoverLetterTemplate) || DEFAULTS.fallbackCoverLetterTemplate;
}

function getCoverLetterInvalidReason(value) {
  const text = cleanText(value);
  const genericReason = getGeneratedTextInvalidReason(text, { minLength: 20 });
  if (genericReason) return genericReason;
  if (text.length > 220) return 'cover_letter_too_long';
  if (text.split(/\n+/).filter(Boolean).length > 4) return 'cover_letter_multiline_report';
  if (/^\s*(?:[-*]|\d+[.)])\s+/m.test(text)) return 'cover_letter_list';
  const sentenceCount = text.split(/[.!?]+/).map(cleanText).filter(Boolean).length;
  if (sentenceCount > 2) return 'cover_letter_too_many_sentences';
  if (sentenceCount > 1 && text.length > 180) {
    return 'cover_letter_long_template';
  }
  if (hasCoverLetterCliche(text)) {
    return 'cover_letter_cliche';
  }
  if (hasCoverLetterProtocolLeak(text)) {
    return 'cover_letter_protocol_leak';
  }
  return '';
}

function hasCoverLetterCliche(value) {
  const text = cleanText(value);
  return /(?:уважаем(?:ая|ые)\s+(?:команда|коллеги|работодатель)|меня\s+привлекла\s+возможность|ценятся\s+инновации|инновации\s+и\s+эффективность|масштабн(?:ыми|ые|ых)\s+проект|над[её]жн(?:ых|ые|ыми)\s+микросервисн(?:ых|ые|ыми)\s+решени|соответству(?:ет|ю)\s+требованиям|требования\s+вакансии|проявлял(?:а)?\s+интерес|готов(?:а)?\s+(?:обсудить|применять)\b|релевантн(?:ый|ого|ом)\s+опыт|ускорять\s+доставку\s+продукта|гибк(?:ий|ого)\s+формат\s+работы|открытость\s+к\s+удал[её]нному\s+сотрудничеству|быстро\s+включаться\s+в\s+новые\s+задачи|поддерживать\s+высокий\s+уровень\s+качества|буду\s+рад(?:а)?\s+стать\s+частью\s+команды|с\s+энтузиазмом\s+готов(?:а)?|динамично\s+развивающ(?:ейся|аяся)\s+команд|внести\s+вклад\s+в\s+развитие\s+компании|чем\s+могу\s+быть\s+полезен|близк(?:ий|ая|ое|ие|о|и|а)?\s+к\s+моему\s+опыту|вакансия\s+выглядит\s+близко|вижу\s+пересечение)/i.test(text);
}

function hasCoverLetterProtocolLeak(value) {
  return /(?:резюме кандидата|текст вакансии|структурированные вопросы|choice group|text question|ответы на вопросы работодателя)/i.test(cleanText(value));
}

async function sanitizeCoverLetterDraft(value, fallbackFactory = getFallbackCoverLetter, { allowStructuredAnswers = false } = {}) {
  const reason = allowStructuredAnswers && isStructuredCoverLetterAnswer(value) && !hasCoverLetterProtocolLeak(value)
    ? ''
    : getCoverLetterInvalidReason(value);
  if (!reason) return { text: value, fallbackUsed: false, reason: '' };
  return {
    text: await fallbackFactory(),
    fallbackUsed: true,
    reason
  };
}

function isStructuredCoverLetterAnswer(value) {
  const lines = cleanText(value).split(/\n+/).map(cleanText).filter(Boolean);
  return lines.length > 0 && lines.every((line) => /^\d+[.)]\s+/.test(line));
}

function selectControl(control) {
  control.focus?.();
  if (!readControlState(control).checked) {
    control.click?.();
  }
  control.checked = true;
  control.dispatchEvent?.(new Event('input', { bubbles: true }));
  control.dispatchEvent?.(new Event('change', { bubbles: true }));
}

function fillStructuredQuestionControls(choiceDescriptors, answers) {
  let selected = 0;
  const labels = [];
  for (const descriptor of choiceDescriptors) {
    const selectedOptions = answers.get(descriptor.id)?.selectedOptions || [];
    for (const selectedLabel of selectedOptions) {
      const option = descriptor.group.options.find((candidate) => cleanText(candidate.label) === cleanText(selectedLabel));
      if (!option) continue;
      selectControl(option.control);
      selected += 1;
      labels.push(option.label);
      if (descriptor.inputType === 'radio') break;
    }
  }
  return { selected, labels };
}

function findOptionByPattern(options, pattern) {
  return options.find((option) => pattern.test(cleanText(option.label)));
}

function findYesNoOption(options, wantYes) {
  const boundary = '[\\s,.;:!?—-]|$';
  const yesPattern = new RegExp(`^(?:да(?:${boundary})|yes\\b|готов(?:а|ы)?(?:${boundary})|соглас(?:ен|на|ны)(?:${boundary})|подходит(?:${boundary})|могу(?:${boundary}))`, 'i');
  const noPattern = new RegExp(`^(?:нет(?:${boundary})|no\\b|не\\s+(?:готов|готова|готовы|могу|подходит|рассматриваю)(?:${boundary}))`, 'i');
  return findOptionByPattern(options, wantYes ? yesPattern : noPattern);
}

function preferenceListIncludes(preferences, key, value) {
  return normalizeMultiPreference(preferences[key], key === 'employmentPreference' ? EMPLOYMENT_PREFERENCE_VALUES : WORK_FORMAT_PREFERENCE_VALUES).includes(value);
}

function getPreferredChoiceOptions(group, preferences = {}) {
  const options = Array.isArray(group?.options) ? group.options.filter((option) => option?.control) : [];
  if (options.length === 0) return [];
  const optionMarkers = options.map((option) => {
    const state = readControlState(option.control);
    return [option.label, state.name, state.value].join('\n');
  }).join('\n');
  const questionText = cleanText(`${group?.question || ''}\n${group?.key || ''}\n${optionMarkers}`);
  const preferred = [];

  if (/ип|индивидуальн|самозан|тк|трудов|договор|оформлен/i.test(questionText)) {
    if (preferenceListIncludes(preferences, 'employmentPreference', 'individual_entrepreneur')) {
      const option = findOptionByPattern(options, /(^|\b)(ип|индивидуальн|самозан)/i);
      if (option) preferred.push(option);
    }
    if (preferenceListIncludes(preferences, 'employmentPreference', 'labor_contract')) {
      const option = findOptionByPattern(options, /(^|\b)(тк|трудов|штат)/i);
      if (option) preferred.push(option);
    }
  }

  if (/удален|удалён|remote|гибрид|hybrid|офис|office/i.test(questionText)) {
    if (preferenceListIncludes(preferences, 'workFormatPreference', 'remote')) {
      const option = findOptionByPattern(options, /удален|удалён|remote/i);
      if (option) preferred.push(option);
    }
    if (preferenceListIncludes(preferences, 'workFormatPreference', 'hybrid')) {
      const option = findOptionByPattern(options, /гибрид|hybrid/i);
      if (option) preferred.push(option);
    }
    if (preferenceListIncludes(preferences, 'workFormatPreference', 'office')) {
      const option = findOptionByPattern(options, /офис|office/i);
      if (option) preferred.push(option);
    }
    if (preferred.length === 0 && /гибрид|hybrid/i.test(questionText)) {
      const configuredFormats = normalizeMultiPreference(preferences.workFormatPreference, WORK_FORMAT_PREFERENCE_VALUES);
      const option = configuredFormats.length > 0
        ? findYesNoOption(options, configuredFormats.includes('hybrid'))
        : null;
      if (option) preferred.push(option);
    } else if (preferred.length === 0 && /офис|office/i.test(questionText)) {
      const configuredFormats = normalizeMultiPreference(preferences.workFormatPreference, WORK_FORMAT_PREFERENCE_VALUES);
      const option = configuredFormats.length > 0
        ? findYesNoOption(options, configuredFormats.includes('office'))
        : null;
      if (option) preferred.push(option);
    }
  }

  return [...new Map(preferred.map((option) => [option.control, option])).values()];
}

async function waitForDialogOrChange(previousText, timeoutMs = 7000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (stopRequested) return getDialogRoot();
    const root = getDialogRoot();
    if (detectHhDailyResponseLimit(root) || detectHhDailyResponseLimit(document)) {
      return root;
    }
    const currentText = getRootText(root);
    if (root !== document && currentText) return root;
    if (
      root !== document &&
      currentText &&
      currentText !== previousText &&
      /отправить|сопровод|тест|отклик|ответить|ответьте|вопрос|работодател/i.test(currentText)
    ) {
      return root;
    }
    if (isResponseFormPage()) {
      return document;
    }
    await sleep(250);
  }
  return getDialogRoot();
}

async function waitForNavigationQueueSettle(beforeUrl, currentRoot) {
  const timeoutMs = window.__HH_JOB_ASSISTANT_TEST_FAST_CLICKS__ ? 0 : 5000;
  const started = Date.now();
  let attempts = 0;

  while (Date.now() - started <= timeoutMs || (window.__HH_JOB_ASSISTANT_TEST_FAST_CLICKS__ && attempts < 3)) {
    attempts += 1;
    if (stopRequested) return currentRoot;
    if (location.href !== beforeUrl || isResponseFormPage()) {
      return isResponseFormPage() ? document : getDialogRoot();
    }

    const nextRoot = getDialogRoot();
    if (nextRoot !== document) {
      return nextRoot;
    }

    await sleep(250);
  }

  return currentRoot;
}

async function handleDryRun(limit) {
  if (isUnsafePage()) {
    throw new Error('Обнаружена страница входа, captcha или антибот-проверка');
  }
  requireAuthenticatedHhPage();

  const vacancies = scanVacancies().slice(0, limit);
  await setRunState({
    state: 'dry_run_complete',
    found: vacancies.length,
    processed: vacancies.length,
    applied: 0,
    skipped: vacancies.filter((item) => !item.responseButton || item.testDetected).length,
    errors: 0,
    lastError: ''
  });

  for (const item of vacancies) {
    await appendResult({
      index: item.index,
      vacancyId: item.vacancyId,
      title: item.title,
      url: item.url,
      status: item.responseButton ? 'dry_run_ready' : 'dry_run_no_button',
      coverLetterUsed: false,
      testDetected: item.testDetected,
      error: ''
    });
  }

  return { ok: true, found: vacancies.length };
}

async function applyToVacancy(item, counters, config = null) {
  const applyConfig = config || await getConfig();
  const aiEnabled = applyConfig.aiEnabled !== false;

  if (await stopIfRequested(counters)) return;

  const initialDailyLimitReason = detectHhDailyResponseLimit(document);
  if (initialDailyLimitReason) {
    return completeHhDailyResponseLimit(item, counters, initialDailyLimitReason);
  }

  if (item.responseFormOpen && isAlreadyAppliedForCurrentItem(document, item)) {
    await appendAlreadyAppliedResponse(item, counters);
    return;
  }

  if (isAlreadyAppliedForCurrentItem(item.card, item)) {
    await appendAlreadyAppliedResponse(item, counters);
    return;
  }

  async function fallbackToDirectResponse(reason) {
    const responseUrl = getItemResponseUrl(item);
    if (!responseUrl || !item.navigationQueue?.returnToSearch || isResponseFormPage()) {
      return null;
    }
    if (location.href === responseUrl) {
      return null;
    }
    const navigationQueue = {
      ...item.navigationQueue,
      items: item.navigationQueue.items?.map((queueItem, index) => index === 0 ? { ...queueItem, responseUrl } : queueItem),
      active: true,
      index: 0,
      counters: { ...counters }
    };
    await saveQueue(navigationQueue);
    await setRunState({
      state: 'waiting_for_dialog',
      ...counters,
      currentAction: 'Открываю прямую форму отклика HH',
      lastError: ''
    });
    await appendAgentLog('response_form_direct_fallback', {
      vacancyId: item.vacancyId,
      responseUrl,
      sourceUrl: navigationQueue.sourceUrl || '',
      reason
    });
    navigateTo(responseUrl);
    return { navigated: true, nextPageUrl: responseUrl };
  }

  if (!item.responseButton) {
    if (isVacancyDetailPage() && queuedItemMatchesCurrentVacancy({ returnToSearch: true, index: 0, items: [item] })) {
      await sleep(5000);
      const settledText = getBodyText();
      if (
        isAlreadyAppliedForCurrentItem(document, item, { ignoreActiveResponseControl: true }) ||
        /вы\s+откликнулись|отклик\s+отправлен|отклик\s+успешно/i.test(settledText)
      ) {
        await appendAlreadyAppliedResponse(item, counters, { coverLetterUsed: false, testDetected: item.testDetected });
        return;
      }
      const detailResponseButton = findDetailResponseButton(document);
      if (detailResponseButton) {
        item.responseButton = detailResponseButton;
      }
    }
  }

  if (!item.responseButton) {
    const blockedReason = detectBlockedResponseReason(document);
    if (blockedReason) {
      await appendSkippedResponse(item, counters, 'skipped_response_unavailable', blockedReason);
    } else {
      const fallback = await fallbackToDirectResponse('no_response_button');
      if (fallback) return fallback;
      if (isAlreadyAppliedForCurrentItem(document, item, { ignoreActiveResponseControl: true })) {
        await appendAlreadyAppliedResponse(item, counters, { coverLetterUsed: false, testDetected: item.testDetected });
        return;
      }
      counters.skipped += 1;
      await appendResult({
        index: item.index,
        vacancyId: item.vacancyId,
        title: item.title,
        url: item.url,
        status: 'skipped_no_response_button',
        coverLetterUsed: false,
        testDetected: item.testDetected,
        error: 'Пропущено: кнопка отклика не найдена.'
      });
    }
    return;
  }

  let root;
  let beforeUrl = location.href;
  let beforeText = getBodyText();
  if (item.responseFormOpen) {
    root = document;
  } else {
    await setRunState({
      state: 'waiting_for_dialog',
      ...counters,
      currentAction: `Откликаюсь на: ${item.title || item.vacancyId || 'вакансия'}`
    });
    beforeText = getBodyText();
    beforeUrl = location.href;
    if (item.navigationQueue) {
      await saveQueue(item.navigationQueue);
    }
    await sleep(250);
    if (await stopIfRequested(counters)) return;
    await waitBeforeClick();
    if (await stopIfRequested(counters)) return;
    const responseButton = findCurrentVacancyResponseButton(item);
    if (!responseButton) {
      const fallback = await fallbackToDirectResponse('response_button_replaced');
      if (fallback) return fallback;
      throw new Error('Кнопка отклика HH исчезла перед нажатием.');
    }
    if (isUnsafeHhUrl(readControlState(responseButton).href)) {
      throw new Error('Перед нажатием отклика обнаружена страница входа или регистрации');
    }
    prepareResponseButtonForCurrentTab(responseButton);
    clickWithActionCursor(responseButton);

    root = await waitForDialogOrChange(beforeText);
    if (await stopIfRequested(counters)) return;
    if (item.navigationQueue && root === document && location.href === beforeUrl && !isResponseFormPage()) {
      root = await waitForNavigationQueueSettle(beforeUrl, root);
    }
    if (await stopIfRequested(counters)) return;
    if (item.navigationQueue && location.href === beforeUrl && !isResponseFormPage()) {
      await saveQueue({ active: false });
    }
    await setRunState({ state: 'applying', ...counters, currentAction: `Проверяю форму отклика: ${item.title || item.vacancyId || 'вакансия'}` });
    await sleep(700);
    if (await stopIfRequested(counters)) return;
    root = await confirmInitialFollowupIfNeeded(root, beforeText, counters);
  }

  if (await stopIfRequested(counters)) return;

  const dailyLimitReason = detectHhDailyResponseLimit(root) || detectHhDailyResponseLimit(document);
  if (dailyLimitReason) {
    return completeHhDailyResponseLimit(item, counters, dailyLimitReason);
  }

  if (!item.responseFormOpen && root === document && !isResponseFormPage() && hasNewResponseSuccessText(beforeText, document)) {
    await appendDirectClickResponse(item, counters, { testDetected: item.testDetected });
    return;
  }

  if (isUnsafePage()) {
    throw new Error('После нажатия обнаружена страница входа, captcha или антибот-проверка');
  }

  if (isAlreadyAppliedForCurrentItem(root, item)) {
    await appendAlreadyAppliedResponse(item, counters);
    return;
  }

  const blockedReason = detectBlockedResponseReason(root);
  if (blockedReason) {
    await appendSkippedResponse(item, counters, 'skipped_response_unavailable', blockedReason);
    return;
  }

  if (!isResponseFormRoot(root)) {
    const fallback = await fallbackToDirectResponse('root_not_response_form');
    if (fallback) return fallback;
    await appendSkippedResponse(item, counters, 'skipped_submit_not_found', 'Пропущено: форма отклика HH не открылась.');
    return;
  }

  const initialQuestionFields = findQuestionFields(root);
  const initialQuestionControlGroups = findQuestionControlGroups(root);
  if (detectTest(root) || initialQuestionFields.length > 0 || initialQuestionControlGroups.length > 0) {
    const questionFields = findQuestionFields(root);
    const questionControlGroups = findQuestionControlGroups(root);
    const coverLetterTextarea = findCoverLetterTextarea(root);
    let questionSnapshot = createQuestionSnapshot(root, questionFields, questionControlGroups);
    const questionContext = buildEmployerQuestionContext(
      root,
      questionSnapshot.textQuestions,
      questionSnapshot.choiceQuestions
    );
    const vacancyText = getVacancyText(item.card) || getVacancyText(document);
    const questionAudit = summarizeEmployerQuestionInputs(
      questionSnapshot.textQuestions,
      questionSnapshot.choiceQuestions
    );
    let coverLetterUsed = false;
    const skipQuestionForm = async (status, message) => {
      counters.skipped += 1;
      await appendResult({
        index: item.index,
        vacancyId: item.vacancyId,
        title: item.title,
        url: item.url,
        status,
        coverLetterUsed: false,
        testDetected: true,
        error: message
      });
      await setRunState({ state: 'applying', ...counters, lastError: message });
      closeDialog();
    };
    if (!aiEnabled) {
      const message = 'Пропущено: ИИ выключен, вакансии с вопросами работодателя не обрабатываются.';
      await skipQuestionForm('skipped_ai_disabled_questions', message);
      return;
    }
    if (questionFields.length === 0 && questionControlGroups.length === 0 && !coverLetterTextarea) {
      const message = 'Пропущено: обнаружены вопросы работодателя, но заполняемые поля HH не найдены.';
      await skipQuestionForm('skipped_question_fields_not_found', message);
      return;
    }

    let structuredAnswers = new Map();
    let letter = '';
    const coverLetterRequested = Boolean(coverLetterTextarea && !cleanText(getFieldValue(coverLetterTextarea)));
    const initialDescriptors = [...questionSnapshot.textQuestions, ...questionSnapshot.choiceQuestions];

    await appendAgentLog('question_context_extracted', {
      vacancyId: item.vacancyId,
      textFields: questionFields.length,
      choiceGroups: questionControlGroups.length,
      contextLength: questionContext.length,
      coverLetterRequested
    });
    await appendAgentLog('question_test_detected', {
      vacancyId: item.vacancyId,
      title: item.title,
      url: item.url,
      questions: questionAudit,
      questionContext,
      questionIds: initialDescriptors.map((descriptor) => descriptor.id)
    });

    let selectedChoices = { selected: 0, labels: [] };
    let resnapshotCount = 0;
    while (true) {
      const deterministic = await getDeterministicStructuredAnswers(questionSnapshot);
      if (deterministic.blockedReason) {
        await skipQuestionForm(
          deterministic.blockedStatus || 'skipped_bad_generated_answer',
          deterministic.blockedReason
        );
        return;
      }
      structuredAnswers = new Map(deterministic.answers);
      const descriptors = [...questionSnapshot.textQuestions, ...questionSnapshot.choiceQuestions];
      const aiDescriptors = descriptors.filter((descriptor) => !structuredAnswers.has(descriptor.id));
      const requestCoverLetter = coverLetterRequested && !letter;
      const aiNeeded = aiDescriptors.length > 0 || requestCoverLetter;

      if (aiNeeded) {
        await setRunState({
          state: 'generating_cover_letter',
          ...counters,
          currentAction: 'ИИ: готовлю один структурированный ответ для формы'
        });
        setBusyCursor(true);
        try {
          const response = await generateTestAssistance(
            vacancyText,
            aiDescriptors.map(toGroqQuestion),
            requestCoverLetter
          );
          const validated = validateStructuredAssistance(response, aiDescriptors, {
            coverLetterRequested: requestCoverLetter
          });
          for (const [id, answer] of validated.answers) structuredAnswers.set(id, answer);
          if (validated.coverLetter) letter = validated.coverLetter;
        } catch (error) {
          if (isStopRequestedError(error)) {
            await markStopped(counters);
            closeDialog();
            return;
          }
          await recordLocalAiFallback('test_assist', error?.code || localizeError(error));
          structuredAnswers = await buildSafeStructuredFallback(questionSnapshot, structuredAnswers);
          if (requestCoverLetter) letter = await getFallbackCoverLetter(vacancyText);
          await appendAgentLog('question_structured_fallback', {
            vacancyId: item.vacancyId,
            reason: localizeError(error),
            answers: structuredAnswers.size,
            coverLetterRequested: requestCoverLetter
          });
        } finally {
          setBusyCursor(false);
        }
      }

      if (await stopIfRequested(counters)) return;

      let invalidReason = '';
      for (const descriptor of questionSnapshot.textQuestions) {
        const answer = structuredAnswers.get(descriptor.id)?.answer || '';
        const reason = getQuestionAnswerInvalidReason(answer, descriptor.field, descriptor.contextQuestion);
        if (!reason) continue;
        invalidReason ||= reason;
        structuredAnswers.delete(descriptor.id);
      }
      if (invalidReason) {
        await recordLocalAiFallback('test_assist', 'semantic_answer_rejected');
        structuredAnswers = await buildSafeStructuredFallback(questionSnapshot, structuredAnswers);
        await appendAgentLog('question_text_rejected_bad_answer', {
          vacancyId: item.vacancyId,
          error: invalidReason,
          fields: questionSnapshot.textQuestions.length
        });
      }

      if (!refreshQuestionSnapshot(questionSnapshot)) {
        resnapshotCount += 1;
        if (resnapshotCount > MAX_QUESTION_FORM_RESNAPSHOTS) {
          await skipQuestionForm('skipped_question_form_changed', 'Пропущено: форма HH слишком часто менялась во время заполнения.');
          return;
        }
        questionSnapshot = createQuestionSnapshot(getDialogRoot());
        await appendAgentLog('question_form_resnapshot', {
          vacancyId: item.vacancyId,
          attempt: resnapshotCount,
          textFields: questionSnapshot.textQuestions.length,
          choiceGroups: questionSnapshot.choiceQuestions.length
        });
        continue;
      }

      selectedChoices = { selected: 0, labels: [] };
      if (questionSnapshot.choiceQuestions.length > 0) {
        await setRunState({ state: 'filling_cover_letter', ...counters, currentAction: 'Выбираю точные варианты работодателя' });
        if (!refreshQuestionSnapshot(questionSnapshot)) {
          resnapshotCount += 1;
          if (resnapshotCount > MAX_QUESTION_FORM_RESNAPSHOTS) {
            await skipQuestionForm('skipped_question_form_changed', 'Пропущено: форма HH слишком часто менялась во время заполнения.');
            return;
          }
          questionSnapshot = createQuestionSnapshot(getDialogRoot());
          await appendAgentLog('question_form_resnapshot', {
            vacancyId: item.vacancyId,
            attempt: resnapshotCount,
            textFields: questionSnapshot.textQuestions.length,
            choiceGroups: questionSnapshot.choiceQuestions.length
          });
          continue;
        }
        setBusyCursor(true);
        try {
          selectedChoices = fillStructuredQuestionControls(questionSnapshot.choiceQuestions, structuredAnswers);
        } finally {
          setBusyCursor(false);
        }
        const missingChoiceGroupIndexes = validateSelectedQuestionControls(
          questionSnapshot.choiceQuestions.map((descriptor) => descriptor.group)
        );
        if (missingChoiceGroupIndexes.length > 0) {
          const message = `Пропущено: безопасный вариант HH не найден (${missingChoiceGroupIndexes.join(', ')}).`;
          await skipQuestionForm('skipped_choice_fill_not_verified', message);
          return;
        }
        await sleep(POST_FILL_SETTLE_MS);
        if (await stopIfRequested(counters)) return;
      }

      if (refreshQuestionSnapshot(questionSnapshot)) break;
      resnapshotCount += 1;
      if (resnapshotCount > MAX_QUESTION_FORM_RESNAPSHOTS) {
        await skipQuestionForm('skipped_question_form_changed', 'Пропущено: форма HH слишком часто менялась во время заполнения.');
        return;
      }
      questionSnapshot = createQuestionSnapshot(getDialogRoot());
      await appendAgentLog('question_form_resnapshot', {
        vacancyId: item.vacancyId,
        attempt: resnapshotCount,
        textFields: questionSnapshot.textQuestions.length,
        choiceGroups: questionSnapshot.choiceQuestions.length
      });
    }

    if (questionSnapshot.choiceQuestions.length > 0) {
      const currentChoiceGroups = questionSnapshot.choiceQuestions.map((descriptor) => descriptor.group);
      const missingChoiceGroupIndexes = validateSelectedQuestionControls(currentChoiceGroups);
      if (missingChoiceGroupIndexes.length > 0) {
        const message = `Пропущено: ответы HH не сохранились после обновления формы (${missingChoiceGroupIndexes.join(', ')}).`;
        await skipQuestionForm('skipped_choice_fill_not_verified', message);
        return;
      }
    }

    const textAnswers = questionSnapshot.textQuestions.map((descriptor) => structuredAnswers.get(descriptor.id)?.answer || '');
    if (textAnswers.some((answer) => !answer)) {
      await skipQuestionForm('skipped_bad_generated_answer', 'Пропущено: для одного из полей HH нет безопасного ответа.');
      return;
    }
    if (questionSnapshot.textQuestions.length > 0) {
      await setRunState({ state: 'filling_cover_letter', ...counters, currentAction: 'Заполняю вопросы работодателя' });
      questionSnapshot.root = getDialogRoot();
      if (!refreshQuestionSnapshot(questionSnapshot)) {
        await skipQuestionForm('skipped_question_form_changed', 'Пропущено: форма HH изменилась перед заполнением текстовых ответов.');
        return;
      }
      setBusyCursor(true);
      try {
        questionSnapshot.textQuestions.forEach((descriptor, index) => {
          descriptor.field.focus?.();
          setNativeValue(descriptor.field, textAnswers[index]);
        });
      } finally {
        setBusyCursor(false);
      }
      await sleep(POST_FILL_SETTLE_MS);
      questionSnapshot.root = getDialogRoot();
      if (!refreshQuestionSnapshot(questionSnapshot)) {
        await skipQuestionForm('skipped_question_form_changed', 'Пропущено: форма HH изменилась после заполнения текстовых ответов.');
        return;
      }
      const currentQuestionFields = questionSnapshot.textQuestions.map((descriptor) => descriptor.field);
      const missingTextFields = validateFilledQuestionFields(currentQuestionFields, textAnswers);
      if (missingTextFields.length > 0) {
        const message = `Пропущено: ответы HH не записались в поля (${missingTextFields.join(', ')}).`;
        await skipQuestionForm('skipped_text_fill_not_verified', message);
        return;
      }
    }

    const assistance = serializeStructuredAssistance(questionSnapshot, structuredAnswers);
    await appendAgentLog('question_test_answers_applied', {
      vacancyId: item.vacancyId,
      title: item.title,
      url: item.url,
      assistance,
      answers: buildQuestionAnswerAudit(
        questionSnapshot.textQuestions,
        questionSnapshot.choiceQuestions,
        selectedChoices
      )
    });
    if (coverLetterRequested) {
      const fallbackContext = [vacancyText, questionContext, assistance, letter].map(cleanText).filter(Boolean).join('\n');
      const sanitizedLetter = await sanitizeCoverLetterDraft(letter, () => getFallbackCoverLetter(fallbackContext));
      if (sanitizedLetter.fallbackUsed) {
        await recordLocalAiFallback('test_assist', sanitizedLetter.reason || 'invalid_cover_letter');
        await appendAgentLog('mandatory_cover_letter_fallback_after_bad_text', {
          vacancyId: item.vacancyId,
          reason: sanitizedLetter.reason,
          rejectedTextLength: cleanText(letter).length
        });
        letter = sanitizedLetter.text;
      }

      await setRunState({ state: 'filling_cover_letter', ...counters, currentAction: 'Заполняю обязательное сопроводительное письмо' });
      const currentCoverLetterTextarea = findCoverLetterTextarea(getDialogRoot());
      if (!currentCoverLetterTextarea) {
        await skipQuestionForm('skipped_cover_letter_fill_not_verified', 'Пропущено: поле сопроводительного письма HH исчезло перед заполнением.');
        return;
      }
      setBusyCursor(true);
      setNativeValue(currentCoverLetterTextarea, letter);
      setBusyCursor(false);
      if (!cleanText(getFieldValue(currentCoverLetterTextarea))) {
        await skipQuestionForm('skipped_cover_letter_fill_not_verified', 'Пропущено: сопроводительное письмо не записалось в поле HH.');
        return;
      }
      coverLetterUsed = true;
      await sleep(POST_FILL_SETTLE_MS);
      if (await stopIfRequested(counters)) return;
      await appendAgentLog('mandatory_cover_letter_applied', {
        vacancyId: item.vacancyId,
        title: item.title,
        url: item.url,
        field: getFieldLogTarget(findCoverLetterTextarea(getDialogRoot())),
        fieldLength: cleanText(getFieldValue(findCoverLetterTextarea(getDialogRoot()))).length,
        letterLength: cleanText(letter).length
      });
    }
    await recordPrivateQuestionAudit(item, {
      questions: buildQuestionAnswerAudit(
        questionSnapshot.textQuestions,
        questionSnapshot.choiceQuestions,
        selectedChoices
      ),
      coverLetter: coverLetterRequested ? cleanText(getFieldValue(findCoverLetterTextarea(getDialogRoot()))) : ''
    });

    const submitButton = findSubmitButton(root);
    if (!submitButton) {
      if (
        isAlreadyAppliedForCurrentItem(root, item) ||
        isAlreadyAppliedForCurrentItem(document, item) ||
        await waitForAlreadyAppliedConfirmation(item)
      ) {
        await appendAlreadyAppliedResponse(item, counters, { coverLetterUsed, testDetected: true });
        return;
      }
      const blockedReason = detectBlockedResponseReason(root);
      if (blockedReason) {
        await appendSkippedResponse(item, counters, 'skipped_response_unavailable', blockedReason);
        return;
      }
      const fallback = await fallbackToDirectResponse('test_submit_not_found');
      if (fallback) return fallback;
      await appendSkippedResponse(item, counters, 'skipped_submit_not_found', 'Пропущено: кнопка отправки теста не найдена.');
      return;
    }

    await setRunState({ state: 'submitting', ...counters });
    await waitBeforeClick();
    if (await stopBeforeSubmitIfRequested(counters)) {
      return;
    }
    const beforeSubmitText = getBodyText();
    await savePendingSubmit({
      item,
      counters,
      status: 'applied_test_assisted',
      coverLetterUsed,
      testDetected: true
    });
    if (await stopBeforeSubmitIfRequested(counters)) {
      return;
    }
    const currentSubmitButton = findSubmitButton(getDialogRoot());
    if (!currentSubmitButton) {
      await clearPendingSubmit();
      await appendSkippedResponse(item, counters, 'skipped_submit_not_found', 'Пропущено: кнопка отправки теста исчезла перед нажатием.');
      return;
    }
    clickWithActionCursor(currentSubmitButton);
    await sleep(POST_SUBMIT_SETTLE_MS);
    if (await stopIfRequested(counters)) return;
    await confirmFollowupIfNeeded(beforeSubmitText, counters);
    if (await stopIfRequested(counters)) return;

    const confirmed = await verifySubmitConfirmed({
      item,
      counters,
      status: 'applied_test_assisted',
      coverLetterUsed,
      testDetected: true
    });
    if (confirmed?.terminal) {
      return confirmed;
    }
    if (!confirmed) {
      return;
    }

    const { ledger } = await recordDailyApplication(item, 'submitted', counters);
    syncCountersFromLedger(counters, ledger);
    await setRunState({ state: 'applying', ...counters, currentAction: 'Отклик отправлен' });
    await clearPendingSubmit();
    await appendResult({
      index: item.index,
      vacancyId: item.vacancyId,
      title: item.title,
      url: item.url,
      status: 'applied_test_assisted',
      coverLetterUsed,
      testDetected: true,
      error: ''
    });
    closeDialog();
    return;
  }

  let coverLetterUsed = false;
  const textarea = findTextarea(root);

  if (root === document && !isResponseFormPage() && !hasSubmitControl(document) && !textarea) {
    if (location.href === beforeUrl && isHhSearchPageUrl(location.href)) {
      const fallback = await fallbackToDirectResponse('search_page_without_submit');
      if (fallback) return fallback;
      await appendSkippedResponse(item, counters, 'skipped_submit_not_found', 'Пропущено: форма отклика HH не открылась.');
      return;
    }
    await appendDirectClickResponse(item, counters, { testDetected: false });
    return;
  }

  if (textarea) {
    await setRunState({
      state: 'generating_cover_letter',
      ...counters,
      currentAction: aiEnabled ? 'ИИ: готовлю сопроводительное письмо' : 'Готовлю сопроводительное письмо по шаблону'
    });
    const vacancyText = getVacancyText(item.card) || getVacancyText(document);
    let letter;
    setBusyCursor(true);
    try {
      letter = await generateCoverLetter(vacancyText, {
        aiEnabled,
        fallbackTemplate: applyConfig.fallbackCoverLetterTemplate
      });
    } catch (error) {
      if (isStopRequestedError(error)) {
        await markStopped(counters);
        closeDialog();
        return;
      }
      await recordLocalAiFallback('cover_letter', error?.code || localizeError(error));
      letter = await getFallbackCoverLetter(vacancyText);
    } finally {
      setBusyCursor(false);
    }

    if (await stopIfRequested(counters)) return;

    await setRunState({ state: 'filling_cover_letter', ...counters, currentAction: 'Заполняю сопроводительное письмо' });
    const currentTextarea = findTextarea(getDialogRoot());
    if (!currentTextarea) {
      await appendSkippedResponse(item, counters, 'skipped_submit_not_found', 'Пропущено: поле сопроводительного письма HH исчезло перед заполнением.');
      return;
    }
    setBusyCursor(true);
    currentTextarea.focus?.();
    setNativeValue(currentTextarea, letter);
    setBusyCursor(false);
    coverLetterUsed = true;
    await sleep(500);
    if (await stopIfRequested(counters)) return;
    await appendAgentLog('cover_letter_applied', {
      vacancyId: item.vacancyId,
      title: item.title,
      url: item.url,
      field: getFieldLogTarget(findTextarea(getDialogRoot())),
      fieldLength: cleanText(getFieldValue(findTextarea(getDialogRoot()))).length,
      letterLength: cleanText(letter).length
    });
  }

  const submitButton = findSubmitButton(root);
  if (!submitButton) {
    if (
      isAlreadyAppliedForCurrentItem(root, item) ||
      isAlreadyAppliedForCurrentItem(document, item) ||
      await waitForAlreadyAppliedConfirmation(item)
    ) {
      await appendAlreadyAppliedResponse(item, counters, { coverLetterUsed, testDetected: false });
      return;
    }
    const blockedReason = detectBlockedResponseReason(root);
    if (blockedReason) {
      await appendSkippedResponse(item, counters, 'skipped_response_unavailable', blockedReason);
      return;
    }
    const fallback = await fallbackToDirectResponse('submit_not_found');
    if (fallback) return fallback;
    await appendSkippedResponse(item, counters, 'skipped_submit_not_found', 'Пропущено: кнопка отправки не найдена.');
    return;
  }

  await setRunState({ state: 'submitting', ...counters });
  await waitBeforeClick();
  if (await stopBeforeSubmitIfRequested(counters)) {
    return;
  }
  const beforeSubmitText = getBodyText();
  await savePendingSubmit({
    item,
    counters,
    status: 'applied',
    coverLetterUsed,
    testDetected: false
  });
  if (await stopBeforeSubmitIfRequested(counters)) {
    return;
  }
  const currentSubmitButton = findSubmitButton(getDialogRoot());
  if (!currentSubmitButton) {
    await clearPendingSubmit();
    await appendSkippedResponse(item, counters, 'skipped_submit_not_found', 'Пропущено: кнопка отправки исчезла перед нажатием.');
    return;
  }
  clickWithActionCursor(currentSubmitButton);
  await sleep(POST_SUBMIT_SETTLE_MS);
  if (await stopIfRequested(counters)) return;
  await confirmFollowupIfNeeded(beforeSubmitText, counters);
  if (await stopIfRequested(counters)) return;

  const confirmed = await verifySubmitConfirmed({
    item,
    counters,
    status: 'applied',
    coverLetterUsed,
    testDetected: false
  });
  if (confirmed?.terminal) {
    return confirmed;
  }
  if (!confirmed) {
    return;
  }

  const { ledger } = await recordDailyApplication(item, 'submitted', counters);
  syncCountersFromLedger(counters, ledger);
  await setRunState({ state: 'applying', ...counters, currentAction: 'Отклик отправлен' });
  await clearPendingSubmit();
  await appendResult({
    index: item.index,
    vacancyId: item.vacancyId,
    title: item.title,
    url: item.url,
    status: 'applied',
    coverLetterUsed,
    testDetected: false,
    error: ''
  });

  closeDialog();
}

function buildResponseFormItem(queueItem) {
  const questionFields = findQuestionFields(document);
  const questionControlGroups = findQuestionControlGroups(document);
  return {
    index: queueItem.index,
    vacancyId: queueItem.vacancyId || getVacancyId(location.href),
    title: queueItem.title || getHeadingText() || 'Отклик на вакансию',
    url: queueItem.url || location.href,
    responseUrl: queueItem.responseUrl || location.href,
    card: document,
    responseButton: findSubmitButton(document),
    responseFormOpen: true,
    cardText: getVacancyText(),
    testDetected: queueItem.testDetected || detectTest(document) || questionFields.length > 0 || questionControlGroups.length > 0
  };
}

function buildQueuedVacancyDetailItem(queueItem) {
  const title = getHeadingText() || queueItem.title || 'Вакансия';
  return {
    index: queueItem.index,
    vacancyId: queueItem.vacancyId || getVacancyId(location.href),
    title,
    url: queueItem.url || location.href,
    responseUrl: queueItem.responseUrl || '',
    card: document,
    responseButton: findDetailResponseButton(document),
    responseFormOpen: false,
    cardText: getVacancyText(),
    testDetected: queueItem.testDetected || /тест|задани[ея]|ответьте на вопросы|вопрос/i.test(getBodyText())
  };
}

async function saveQueue(queue) {
  await storageSet({ autoApplyQueue: queue });
}

async function saveSearchQueue(queue) {
  await storageSet({ autoApplySearchQueue: queue });
}

async function getAutoApplyQueueStatus() {
  const { autoApplyQueue, autoApplySearchQueue } = await storageGet(['autoApplyQueue', 'autoApplySearchQueue'], { optional: true });
  const hasResponseQueue = autoApplyQueue?.active === true && Array.isArray(autoApplyQueue.items);
  const hasSearchQueue = autoApplySearchQueue?.active === true;
  return {
    canContinueAutoApply: hasResponseQueue || hasSearchQueue,
    hasResponseQueue,
    hasSearchQueue
  };
}

async function continueQueuedAutoApply() {
  if (queuedResumeStarted) {
    return false;
  }

  const { autoApplyQueue } = await storageGet(['autoApplyQueue']);
  if (!autoApplyQueue?.active || !Array.isArray(autoApplyQueue.items)) {
    return false;
  }
  globalThis.HHJA_CONFIG_READINESS.assertReady(await getConfig());
  if (isResumePage()) {
    return false;
  }
  activeRunId = autoApplyQueue.runId || activeRunId || `${Date.now()}:${Math.random().toString(16).slice(2)}`;
  await claimStopBeforeSubmitForRun(activeRunId);
  if (stopRequested) {
    await markStopped(autoApplyQueue.counters || {});
    return true;
  }
  requireAuthenticatedHhPage();

  if (autoApplyQueue.returnToSearch && isVacancyDetailPage() && !queuedItemMatchesCurrentVacancy(autoApplyQueue)) {
    return false;
  }

  const canProcessQueuedDetailPage = queuedItemMatchesCurrentVacancy(autoApplyQueue);
  if (!isResponseFormPage() && !canProcessQueuedDetailPage) {
    const counters = autoApplyQueue.counters || {};
    const sourceUrl = autoApplyQueue.sourceUrl || '';
    await saveQueue({ ...autoApplyQueue, active: false, recoveredFromUrl: location.href });
    if (autoApplyQueue.returnToSearch && isHhSearchPageUrl(location.href)) {
      activeRunId = autoApplyQueue.runId || activeRunId;
      stopReason = '';
      await finalizePendingSubmitFromSearchReturn(counters, autoApplyQueue.runId || activeRunId);
      if (await stopIfRequested(counters)) return true;
      await handleAutoApply(
        autoApplyQueue.limit || 20,
        counters,
        autoApplyQueue.processedVacancyIds || [],
        { maxProcessed: autoApplyQueue.maxProcessed || null }
      );
      return true;
    }
    if (isHhSearchPageUrl(sourceUrl)) {
      if (autoApplyQueue.returnToSearch) {
        await saveSearchQueue({
          active: true,
          runId: autoApplyQueue.runId || activeRunId,
          limit: autoApplyQueue.limit || 20,
          counters,
          config: autoApplyQueue.config || null,
          maxProcessed: autoApplyQueue.maxProcessed || null,
          processedVacancyIds: autoApplyQueue.processedVacancyIds || []
        });
        await setRunState({ state: 'applying', ...counters, currentAction: 'Возвращаюсь на страницу поиска HH', lastError: '' });
      } else {
        await saveSearchQueue({ active: false });
        await setRunState({ state: 'complete', ...counters, currentAction: 'Возвращаюсь на страницу поиска HH', lastError: '' });
      }
      navigateTo(sourceUrl);
      return true;
    }
    await setRunState({ state: 'complete', ...counters, lastError: '' });
    return true;
  }

  queuedResumeStarted = true;
  const queue = autoApplyQueue;
  const itemData = queue.items[queue.index];
  if (!itemData) {
    if (await stopIfRequested(queue.counters || {})) return true;
    await saveQueue({ ...queue, active: false });
    await setRunState({ state: 'complete', ...(queue.counters || {}) });
    return true;
  }

  const counters = {
    found: queue.items.length,
    processed: 0,
    applied: 0,
    skipped: 0,
    errors: 0,
    ...(queue.counters || {})
  };

  if (!queue.processedCounted) {
    counters.processed += 1;
  }
  const item = isResponseFormPage() ? buildResponseFormItem(itemData) : buildQueuedVacancyDetailItem(itemData);
  const queueConfig = queue.config || await getConfig();
  if (await stopIfRequested(counters)) return true;

  try {
    const outcome = await applyToVacancy(item, counters, queueConfig);
    if (outcome?.terminal) {
      return true;
    }
  } catch (error) {
    const message = localizeError(error);
    counters.errors += 1;
    await appendResult({
      index: item.index,
      vacancyId: item.vacancyId,
      title: item.title,
      url: item.url,
      status: 'error',
      coverLetterUsed: false,
      testDetected: item.testDetected,
      error: message
    });
    if (isFatalAutoApplyError(error)) {
      await saveQueue({ ...queue, active: false, counters });
      await setRunState({ state: 'error', ...counters, lastError: message });
      return true;
    }
  }

  const nextIndex = queue.index + 1;
  if (queue.returnToSearch && !stopRequested && isHhSearchPageUrl(queue.sourceUrl)) {
    await saveQueue({ ...queue, active: false, index: nextIndex, counters });
    if (normalizeMaxProcessed(queue.maxProcessed) != null && counters.processed >= normalizeMaxProcessed(queue.maxProcessed)) {
      await saveSearchQueue({ active: false });
      await setRunState({ state: 'complete', ...counters, lastError: '' });
      return true;
    }
    await saveSearchQueue({
      active: true,
      runId: queue.runId,
      limit: queue.limit || 20,
      counters,
      config: queue.config,
      maxProcessed: queue.maxProcessed || null,
      processedVacancyIds: queue.processedVacancyIds || []
    });
    await setRunState({ state: 'applying', ...counters, currentAction: 'Возвращаюсь на страницу поиска HH', lastError: '' });
    navigateTo(queue.sourceUrl);
    return true;
  }

  if (nextIndex >= queue.items.length || stopRequested) {
    await saveQueue({ ...queue, active: false, index: nextIndex, counters });
    if (!stopRequested && isHhSearchPageUrl(queue.sourceUrl)) {
      await saveSearchQueue({ active: false });
      await setRunState({ state: 'complete', ...counters, currentAction: 'Возвращаюсь на страницу поиска HH' });
      navigateTo(queue.sourceUrl);
      return true;
    }
    await setRunState({ state: stopRequested ? 'stopped' : 'complete', ...counters });
    return true;
  }

  const nextItem = queue.items[nextIndex];
  await saveQueue({ ...queue, index: nextIndex, counters });
  await setRunState({ state: 'applying', ...counters, currentAction: 'Пауза перед следующим откликом', lastError: '' });
  const delayMs = randomDelay(queue.config?.delayMinMs, queue.config?.delayMaxMs);
  await sleep(delayMs);
  if (await stopIfRequested(counters)) return true;
  await setRunState({ state: 'applying', ...counters, currentAction: 'Открываю следующую форму отклика HH', lastError: '' });
  if (await stopIfRequested(counters)) return true;
  navigateTo(nextItem.responseUrl);
  return true;
}

async function handleAutoApply(limit, existingCounters = null, existingProcessedVacancyIds = [], options = {}) {
  if (await stopIfRequested(existingCounters || {})) {
    return { ok: true, ...(existingCounters || {}) };
  }
  if (isUnsafePage()) {
    throw new Error('Обнаружена страница входа, captcha или антибот-проверка');
  }
  requireAuthenticatedHhPage();

  const config = await getConfig();
  const maxProcessed = normalizeMaxProcessed(options.maxProcessed);
  const counters = existingCounters || {
    found: 0,
    processed: 0,
    applied: 0,
    skipped: 0,
    errors: 0
  };
  const processedVacancyIds = createProcessedVacancyIdSet(existingProcessedVacancyIds);
  const remaining = Math.max(0, limit - counters.applied);
  const processedRemaining = maxProcessed == null ? remaining : Math.max(0, maxProcessed - counters.processed);
  const vacancies = scanVacancies()
    .filter((item) => {
      const key = getVacancyDedupeKey(item);
      return !key || !processedVacancyIds.has(key);
    })
    .slice(0, Math.min(remaining, processedRemaining));
  counters.found += vacancies.length;

  if (remaining <= 0 || processedRemaining <= 0) {
    await saveSearchQueue({ active: false });
    await setRunState({ state: 'complete', ...counters, currentAction: 'Квота исчерпана', lastError: '' });
    return { ok: true, ...counters };
  }

  if (vacancies.length === 0) {
    const nextPageUrl = getNextSearchPageUrl();
    if (nextPageUrl) {
      await saveSearchQueue({
        active: true,
        runId: activeRunId,
        limit,
        counters,
        config,
        maxProcessed,
        processedVacancyIds: serializeProcessedVacancyIds(processedVacancyIds)
      });
      await setRunState({ state: 'applying', ...counters, currentAction: 'Переход на следующую страницу HH', lastError: '' });
      navigateTo(nextPageUrl);
      return { ok: true, ...counters, navigated: true, nextPageUrl };
    }

    await saveSearchQueue({ active: false });
    await setRunState({ state: 'complete', ...counters, currentAction: 'Вакансии закончились', lastError: '' });
    return { ok: true, ...counters };
  }

  await setRunState({ state: 'applying', ...counters, lastError: '' });

  for (const item of vacancies) {
    if (await stopIfRequested(counters)) break;

    const sourceUrl = getQueueSourceUrl();
    const vacancyKey = getVacancyDedupeKey(item);
    if (vacancyKey) {
      processedVacancyIds.add(vacancyKey);
    }
    item.responseUrl = getItemResponseUrl(item);
    if (sourceUrl) {
      item.navigationQueue = {
        active: true,
        runId: activeRunId,
        index: 0,
        items: [
          {
            index: item.index,
            vacancyId: item.vacancyId,
            title: item.title,
            url: item.url,
            responseUrl: item.responseUrl || '',
            testDetected: item.testDetected
          }
        ],
        sourceUrl,
        limit,
        counters: { ...counters },
        config,
        maxProcessed,
        processedCounted: false,
        returnToSearch: true,
        processedVacancyIds: serializeProcessedVacancyIds(processedVacancyIds)
      };
    }

    counters.processed += 1;
    if (item.navigationQueue) {
      item.navigationQueue.counters = { ...counters };
      item.navigationQueue.processedCounted = true;
    }
    const appliedBeforeItem = counters.applied;
    try {
      if (sourceUrl && item.responseUrl && !window.__HH_JOB_ASSISTANT_TEST_FAST_CLICKS__) {
        await saveQueue(item.navigationQueue);
        await setRunState({
          state: 'waiting_for_dialog',
          ...counters,
          currentAction: 'Открываю прямую форму отклика HH',
          lastError: ''
        });
        await appendAgentLog('response_form_direct_open', {
          vacancyId: item.vacancyId,
          responseUrl: item.responseUrl,
          sourceUrl
        });
        navigateTo(item.responseUrl);
        return { ok: true, ...counters, navigated: true, nextPageUrl: item.responseUrl };
      }
      const outcome = await applyToVacancy(item, counters, config);
      if (outcome?.terminal) {
        return { ok: true, ...counters };
      }
      if (outcome?.navigated) {
        return { ok: true, ...counters, navigated: true, nextPageUrl: outcome.nextPageUrl };
      }
      if (item.responseUrl && !item.navigationQueue?.returnToSearch) {
        await saveQueue({ active: false });
      }
    } catch (error) {
      const message = localizeError(error);
      counters.errors += 1;
      if (item.responseUrl && !item.navigationQueue?.returnToSearch) {
        await saveQueue({ active: false });
      }
      await appendResult({
        index: item.index,
        vacancyId: item.vacancyId,
        title: item.title,
        url: item.url,
        status: 'error',
        coverLetterUsed: false,
        testDetected: item.testDetected,
        error: message
      });
      await setRunState({ state: isFatalAutoApplyError(error) ? 'error' : 'applying', ...counters, lastError: message });
      if (isFatalAutoApplyError(error)) {
        stopRequested = true;
        break;
      }
      closeDialog();
    }

    await setRunState({ state: stopRequested ? 'paused' : 'applying', ...counters });
    const processedCapReached = maxProcessed != null && counters.processed >= maxProcessed;
    const appliedThisItem = counters.applied > appliedBeforeItem;
    if (!stopRequested && sourceUrl && !isHhSearchPageUrl(location.href) && (!processedCapReached || appliedThisItem)) {
      await saveQueue({ active: false });
      if (processedCapReached) {
        await saveSearchQueue({ active: false });
      } else {
        await saveSearchQueue({
          active: true,
          runId: activeRunId,
          limit,
          counters,
          config,
          maxProcessed,
          processedVacancyIds: serializeProcessedVacancyIds(processedVacancyIds)
        });
      }
      await setRunState({
        state: processedCapReached ? 'complete' : 'applying',
        ...counters,
        currentAction: 'Возвращаюсь на страницу поиска HH',
        lastError: ''
      });
      closeDialog();
      navigateTo(sourceUrl);
      return { ok: true, ...counters, navigated: true, nextPageUrl: sourceUrl };
    }
    if (!stopRequested && processedCapReached) {
      break;
    }
    if (!stopRequested) {
      await setRunState({ state: 'applying', ...counters, currentAction: 'Пауза перед следующим откликом', lastError: '' });
      await sleep(randomDelay(config.delayMinMs, config.delayMaxMs));
      if (await stopIfRequested(counters)) break;
      await setRunState({ state: 'applying', ...counters, currentAction: 'Продолжаю отклики', lastError: '' });
    }
  }

  if (!(await stopIfRequested(counters)) && counters.applied < limit && (maxProcessed == null || counters.processed < maxProcessed)) {
    const nextPageUrl = getNextSearchPageUrl();
    if (nextPageUrl) {
      await saveSearchQueue({
        active: true,
        runId: activeRunId,
        limit,
        counters,
        config,
        maxProcessed,
        processedVacancyIds: serializeProcessedVacancyIds(processedVacancyIds)
      });
      if (await stopIfRequested(counters)) return { ok: true, ...counters };
      await setRunState({ state: 'applying', ...counters, currentAction: 'Переход на следующую страницу HH' });
      if (await stopIfRequested(counters)) return { ok: true, ...counters };
      navigateTo(nextPageUrl);
      return { ok: true, ...counters, navigated: true, nextPageUrl };
    }
  }

  await saveSearchQueue({ active: false });
  const finalState = stopRequested && stopReason === 'test_detected' ? 'paused' : stopRequested ? 'stopped' : 'complete';
  await setRunState({
    state: finalState,
    ...counters,
    ...(finalState === 'complete' ? { currentAction: 'Отклики завершены' } : {})
  });
  return { ok: true, ...counters };
}

function normalizeMaxProcessed(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.max(1, Math.min(Math.floor(parsed), 1000));
}

async function continueSearchAutoApply() {
  if (queuedSearchStarted || isResponseFormPage() || !isHhSearchPageUrl(location.href)) {
    return false;
  }

  const { autoApplySearchQueue, runState } = await storageGet(['autoApplySearchQueue', 'runState']);
  if (!autoApplySearchQueue?.active) {
    return false;
  }
  activeRunId = autoApplySearchQueue.runId || activeRunId || `${Date.now()}:${Math.random().toString(16).slice(2)}`;
  globalThis.HHJA_CONFIG_READINESS.assertReady(await getConfig());
  if (['complete', 'dry_run_complete', 'stopped', 'idle', 'error'].includes(runState?.state)) {
    await saveSearchQueue({ active: false });
    await clearStopBeforeSubmitForRun(activeRunId, 'stale_search_queue');
    await appendAgentLog('stale_search_queue_cleared', {
      state: runState?.state || '',
      url: location.href
    });
    return false;
  }
  if (stopRequested) {
    await markStopped(autoApplySearchQueue.counters || {});
    return true;
  }
  requireAuthenticatedHhPage();

  queuedSearchStarted = true;
  await claimStopBeforeSubmitForRun(activeRunId);
  await clearStopRequestedFlag();

  try {
    await handleAutoApply(
      autoApplySearchQueue.limit || 20,
      autoApplySearchQueue.counters || null,
      autoApplySearchQueue.processedVacancyIds || [],
      { maxProcessed: autoApplySearchQueue.maxProcessed || null }
    );
    return true;
  } catch (error) {
    const message = localizeError(error);
    await saveSearchQueue({ active: false });
    await setRunState({ state: 'error', ...(autoApplySearchQueue.counters || {}), lastError: message });
    return true;
  }
}

async function continueSavedAutoApply() {
  globalThis.HHJA_CONFIG_READINESS.assertReady(await getConfig());
  const status = await getAutoApplyQueueStatus();
  if (!status.canContinueAutoApply) {
    throw new Error('Нет сохраненного запуска для продолжения.');
  }
  await clearStopRequestedFlag();
  activeRunId = activeRunId || `${Date.now()}:${Math.random().toString(16).slice(2)}`;

  const continuedQueue = await continueQueuedAutoApply();
  if (continuedQueue) {
    return { ok: true, continued: true };
  }

  const continuedSearch = await continueSearchAutoApply();
  if (continuedSearch) {
    return { ok: true, continued: true };
  }

  throw new Error('Откройте вкладку hh.ru с сохраненной очередью откликов.');
}

function throwAutomationAuditNotReady(response) {
  const audit = response?.audit;
  const issues = Array.isArray(audit?.issues)
    ? audit.issues.filter((issue) => typeof issue === 'string' && issue.trim())
    : [];
  const error = new Error(
    audit && audit.ready === false
      ? `Автоматические отклики заблокированы: проверка настроек не пройдена${issues.length ? ` (${issues.join(', ')})` : ''}.`
      : 'Автоматические отклики заблокированы: проверка настроек недоступна.'
  );
  error.code = 'HHJA_CONFIG_NOT_READY';
  error.readiness = { missing: issues.map((code) => ({ code, label: code })) };
  throw error;
}

async function ensureLiveAutomationSettings(config) {
  if (config.aiEnabled) {
    const profile = await sendRuntimeMessage(
      { type: 'ENSURE_RESUME_PROFILE' },
      { timeoutMs: getRuntimeMessageTimeoutMs() }
    );
    if (profile?.ok !== true) throwAutomationAuditNotReady(null);
  }
  const response = await sendRuntimeMessage(
    { type: 'GET_AUTOMATION_SETTINGS_AUDIT' },
    { timeoutMs: getRuntimeMessageTimeoutMs() }
  );
  if (response?.ok !== true || !response?.audit || response.audit.ready !== true) {
    throwAutomationAuditNotReady(response);
  }
  return response.audit;
}

async function startRun(mode, limitOverride = null, options = {}) {
  const config = await getConfig();
  globalThis.HHJA_CONFIG_READINESS.assertReady(config);
  const limitSource = limitOverride == null ? config.dailyLimit : limitOverride;
  const limit = Math.max(1, Math.min(Number(limitSource) || 20, 200));
  const maxProcessed = normalizeMaxProcessed(options.maxProcessed);
  const dailyLedger = await getDailyApplicationLedger();
  const initialCounters = {
    found: 0,
    processed: 0,
    applied: dailyLedger.newSubmitted,
    alreadyApplied: dailyLedger.alreadyApplied,
    skipped: 0,
    errors: 0
  };
  await clearStopRequestedFlag();
  activeRunId = `${Date.now()}:${Math.random().toString(16).slice(2)}`;
  await globalThis.HHJobAssistantLog?.reset?.('content', 'auto_apply_started', {
    mode,
    limit,
    limitOverride: limitOverride == null ? null : limit,
    maxProcessed,
    runId: activeRunId,
    url: location.href
  });
  if (mode === 'live') {
    await claimStopBeforeSubmitForRun(activeRunId);
  }
  await storageSet({
    runResults: [],
    autoApplyQueue: { active: false },
    autoApplySearchQueue: { active: false },
    autoApplyPendingSubmit: null
  });
  await setRunState({
    state: 'scanning',
    ...initialCounters,
    currentAction: 'Проверяю страницу HH',
    lastError: ''
  });
  await appendAgentLog('start_run', {
    mode,
    limit,
    limitOverride: limitOverride == null ? null : limit,
    maxProcessed,
    flowVersion: AUTO_APPLY_FLOW_VERSION,
    extensionVersion: chrome.runtime?.getManifest?.().version || '',
    url: location.href
  });

  if (mode === 'dry') {
    return handleDryRun(limit);
  }
  await ensureLiveAutomationSettings(config);
  return handleAutoApply(limit, initialCounters, [], { maxProcessed });
}

async function startRunSingleFlight(mode, limitOverride = null, options = {}) {
  const source = options.entrySource || 'runtime';
  if (startRunPromise) {
    await recordAutomationStartDigestCollision('start', source, activeRunEntryKind === 'continue');
    await appendAgentLog('start_run_duplicate_ignored', {
      mode,
      activeRunId,
      reason: 'same_page_start_in_progress'
    });
    return { ok: true, alreadyRunning: true, activeRunId };
  }

  const pending = (async () => {
    await beginAutomationStartDigest('start', source);
    const queueStatus = await getAutoApplyQueueStatus();
    if (queueStatus.hasResponseQueue || queueStatus.hasSearchQueue) {
      await recordAutomationStartDigestCollision('start', source, true);
      await appendAgentLog('start_run_duplicate_ignored', {
        mode,
        activeRunId,
        reason: 'saved_queue_active'
      });
      return { ok: true, alreadyRunning: true, activeRunId };
    }
    return startRun(mode, limitOverride, options);
  })();
  startRunPromise = pending;
  activeRunEntryKind = 'start';
  try {
    return await pending;
  } finally {
    if (startRunPromise === pending) {
      startRunPromise = null;
      activeRunEntryKind = '';
    }
  }
}

async function continueRunSingleFlight(options = {}) {
  const source = options.entrySource || 'runtime';
  if (startRunPromise) {
    await recordAutomationStartDigestCollision('continue', source, activeRunEntryKind === 'start');
    await appendAgentLog('continue_run_duplicate_ignored', {
      activeRunId,
      reason: 'same_page_run_in_progress'
    });
    return { ok: true, alreadyRunning: true, activeRunId };
  }

  const pending = (async () => {
    await beginAutomationStartDigest('continue', source);
    return continueSavedAutoApply();
  })();
  startRunPromise = pending;
  activeRunEntryKind = 'continue';
  try {
    return await pending;
  } finally {
    if (startRunPromise === pending) {
      startRunPromise = null;
      activeRunEntryKind = '';
    }
  }
}

function isTrustedAutoApplyShortcut(event) {
  return (
    event?.isTrusted === true &&
    event?.repeat !== true &&
    event?.altKey === true &&
    event?.shiftKey === true &&
    event?.ctrlKey !== true &&
    event?.metaKey !== true &&
    cleanText(event?.key).toLowerCase() === 'a'
  );
}

async function handleTrustedAutoApplyShortcut(event) {
  if (!isTrustedAutoApplyShortcut(event)) {
    return { handled: false };
  }
  event.preventDefault?.();
  event.stopPropagation?.();

  if (!isHhSearchPageUrl(location.href) || isUnsafePage() || !hasAuthenticatedHhSignal()) {
    await appendAgentLog('trusted_shortcut_rejected', {
      reason: !isHhSearchPageUrl(location.href)
        ? 'not_search_page'
        : isUnsafePage()
          ? 'unsafe_page'
          : 'authentication_required'
    });
    return { handled: true, started: false };
  }

  const queueStatus = await getAutoApplyQueueStatus();
  if (queueStatus.canContinueAutoApply) {
    const hadRunInProgress = startRunPromise != null;
    const resultPromise = continueRunSingleFlight({ entrySource: 'shortcut' });
    if (!hadRunInProgress) {
      await appendAgentLog('trusted_shortcut_continue', { mode: 'live' });
    }
    const result = await resultPromise;
    return { handled: true, continued: result?.alreadyRunning !== true, ...result };
  }
  const hadRunInProgress = startRunPromise != null;
  const resultPromise = startRunSingleFlight('live', null, { entrySource: 'shortcut' });
  if (!hadRunInProgress) {
    await appendAgentLog('trusted_shortcut_start', { mode: 'live' });
  }
  const result = await resultPromise;
  return { handled: true, started: result?.alreadyRunning !== true, ...result };
}

function consumeAutoStartParam() {
  try {
    const url = new URL(location.href);
    const mode = url.searchParams.get('hhjaAutoStart');
    if (mode !== 'live' && mode !== 'dry') {
      return null;
    }
    const limit = url.searchParams.get('hhjaLimit');
    const maxProcessed = url.searchParams.get('hhjaMaxProcessed');
    const groqModel = url.searchParams.get('hhjaGroqModel') || '';
    const token = url.searchParams.get('hhjaAutoStartToken') || '';
    url.searchParams.delete('hhjaAutoStart');
    url.searchParams.delete('hhjaAutoStartToken');
    url.searchParams.delete('hhjaLimit');
    url.searchParams.delete('hhjaMaxProcessed');
    url.searchParams.delete('hhjaGroqModel');
    window.history?.replaceState?.(null, '', `${url.pathname}${url.search}${url.hash}`);
    return {
      mode,
      limit: limit ? Number(limit) : null,
      maxProcessed: maxProcessed ? Number(maxProcessed) : null,
      groqModel,
      token
    };
  } catch {
    return null;
  }
}

async function consumeTrustedAutoStartToken(token) {
  if (!token) return false;
  const stored = await storageGet([AUTO_START_TOKEN_KEY, AUTO_START_TOKEN_EXPIRES_AT_KEY], { optional: true });
  const expectedToken = stored?.[AUTO_START_TOKEN_KEY] || '';
  const expiresAtMs = Date.parse(stored?.[AUTO_START_TOKEN_EXPIRES_AT_KEY] || '');
  if (!expectedToken || !Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
    await storageSet({
      [AUTO_START_TOKEN_KEY]: '',
      [AUTO_START_TOKEN_EXPIRES_AT_KEY]: ''
    }, { optional: true });
    return false;
  }
  if (expectedToken !== token) return false;
  await storageSet({
    [AUTO_START_TOKEN_KEY]: '',
    [AUTO_START_TOKEN_EXPIRES_AT_KEY]: ''
  }, { optional: true });
  return true;
}

function consumeReloadExtensionParam() {
  try {
    const url = new URL(location.href);
    if (url.searchParams.get('hhjaReloadExtension') !== '1') {
      return false;
    }
    url.searchParams.delete('hhjaReloadExtension');
    window.history?.replaceState?.(null, '', `${url.pathname}${url.search}${url.hash}`);
    return true;
  } catch {
    return false;
  }
}

function consumeStopRunParam() {
  try {
    const url = new URL(location.href);
    if (url.searchParams.get('hhjaStopRun') !== '1') {
      return false;
    }
    url.searchParams.delete('hhjaStopRun');
    window.history?.replaceState?.(null, '', `${url.pathname}${url.search}${url.hash}`);
    return true;
  } catch {
    return false;
  }
}

function consumeStopBeforeSubmitParam() {
  try {
    const url = new URL(location.href);
    if (url.searchParams.get('hhjaStopBeforeSubmit') !== '1') {
      return false;
    }
    url.searchParams.delete('hhjaStopBeforeSubmit');
    window.history?.replaceState?.(null, '', `${url.pathname}${url.search}${url.hash}`);
    return true;
  } catch {
    return false;
  }
}

async function maybeReloadExtensionFromUrlParam() {
  if (!consumeReloadExtensionParam()) {
    return false;
  }

  await appendAgentLog('url_trigger_reload_extension', { url: location.href });
  await withExtensionContext(
    () => chrome.runtime.sendMessage({ type: 'RELOAD_EXTENSION', reason: 'hhjaReloadExtension', url: location.href }),
    { optional: true }
  );
  return true;
}

async function maybeEnableStopBeforeSubmitFromUrlParam() {
  if (!consumeStopBeforeSubmitParam()) {
    return false;
  }

  const nextState = buildStopBeforeSubmitState(activeRunId || '');
  await storageSet({ autoApplyStopBeforeSubmit: nextState }, { optional: true });
  await appendAgentLog('stop_before_submit_guard_armed', {
    runId: nextState.runId,
    expiresAt: nextState.expiresAt
  });
  await appendAgentLog('url_trigger_stop_before_submit', { url: location.href });
  return true;
}

async function maybeStopFromUrlParam() {
  if (!consumeStopRunParam()) {
    return false;
  }

  await setStopRequested('url_stop');
  const { runState = {} } = await storageGet(['runState']);
  const counters = {
    found: Number(runState.found) || 0,
    processed: Number(runState.processed) || 0,
    applied: Number(runState.applied) || 0,
    skipped: Number(runState.skipped) || 0,
    errors: Number(runState.errors) || 0
  };
  await appendAgentLog('url_trigger_stop_run', { url: location.href });
  await markStopped(counters);
  return true;
}

async function maybeStartFromUrlParam() {
  const trigger = consumeAutoStartParam();
  if (!trigger) {
    return false;
  }
  const { mode, limit, maxProcessed, groqModel, token } = trigger;

  try {
    if (mode === 'live' && !await consumeTrustedAutoStartToken(token)) {
      throw new Error('Live auto-start URL is disabled without an extension-issued token.');
    }
    if (groqModel) {
      await storageSet({ groqModel });
    }
    await appendAgentLog('url_trigger_start', { mode, limit, maxProcessed, groqModel, url: location.href });
    await startRunSingleFlight(mode === 'dry' ? 'dry' : 'live', limit, {
      maxProcessed,
      entrySource: 'url'
    });
  } catch (error) {
    const messageText = localizeError(error);
    await appendAgentLog('url_trigger_error', { mode, error: messageText, url: location.href });
    await setRunState({ state: 'error', lastError: messageText });
  }
  return true;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case 'GET_CONTENT_STATUS': {
        const queueStatus = await getAutoApplyQueueStatus();
        const { runState = {} } = await storageGet(['runState'], { optional: true });
        const activeState = /^(scanning|applying|waiting_for_dialog|generating_cover_letter|filling_cover_letter|submitting|refreshing_resumes)$/.test(runState?.state || '');
        sendResponse({
          ok: true,
          authenticated: hasAuthenticatedHhSignal(),
          unsafe: isUnsafePage(),
          activeRunId,
          stopRequested,
          autoApplyInProgress: activeState || queueStatus.hasResponseQueue || queueStatus.hasSearchQueue,
          canContinueAutoApply: queueStatus.canContinueAutoApply,
          url: location.href
        });
        break;
      }
      case 'START_DRY_RUN':
        sendResponse(await startRunSingleFlight('dry', message.limitOverride ?? null, {
          maxProcessed: message.maxProcessed,
          entrySource: 'runtime'
        }));
        break;
      case 'START_AUTO_APPLY':
        sendResponse(await startRunSingleFlight('live', message.limitOverride ?? null, {
          maxProcessed: message.maxProcessed,
          entrySource: 'runtime'
        }));
        break;
      case 'CONTINUE_AUTO_APPLY':
        sendResponse(await continueRunSingleFlight({ entrySource: 'runtime' }));
        break;
      case 'STOP_RUN':
        await setStopRequested('user_stop');
        await appendAgentLog('stop_run', { activeRunId, url: location.href });
        await markStopped();
        sendResponse({ ok: true, activeRunId });
        break;
      default:
        sendResponse({ ok: false, error: `Неизвестный тип сообщения контент-скрипта: ${message?.type || 'пусто'}` });
    }
  })().catch(async (error) => {
    const messageText = localizeError(error);
    if (error?.code === 'HHJA_CONFIG_NOT_READY') {
      sendResponse({ ok: false, error: error.message, missing: error.readiness?.missing || [] });
      return;
    }
    await appendAgentLog('content_message_error', { type: message?.type || '', error: messageText, url: location.href });
    await setRunState({ state: 'error', lastError: messageText });
    sendResponse({ ok: false, error: messageText });
  });

  return true;
});

globalThis.window?.addEventListener?.('hh-job-assistant:start-auto-apply', async (event) => {
  try {
    const mode = event?.detail?.mode === 'dry' ? 'dry' : 'live';
    const token = event?.detail?.token || '';
    if (mode === 'live' && !await consumeTrustedAutoStartToken(token)) {
      throw new Error('Live auto-start DOM event is disabled without an extension-issued token.');
    }
    await appendAgentLog('page_trigger_start_auto_apply', { mode, url: location.href });
    await startRunSingleFlight(mode, null, { entrySource: 'page' });
  } catch (error) {
    const messageText = localizeError(error);
    await appendAgentLog('page_trigger_error', { event: 'start-auto-apply', error: messageText, url: location.href });
    await setRunState({ state: 'error', lastError: messageText });
  }
});

globalThis.window?.addEventListener?.('keydown', handleTrustedAutoApplyShortcut, true);

async function initializeContentScript() {
  const showedStatusPanel = await maybeShowStatusPanelFromUrlParam();
  if (showedStatusPanel) {
    return;
  }
  const reloadedFromUrl = await maybeReloadExtensionFromUrlParam();
  if (reloadedFromUrl) {
    return;
  }
  await maybeEnableStopBeforeSubmitFromUrlParam();
  const stoppedFromUrl = await maybeStopFromUrlParam();
  if (stoppedFromUrl) {
    return;
  }
  const startedFromUrl = await maybeStartFromUrlParam();
  if (startedFromUrl) {
    return;
  }
  const finalizedPendingSubmit = await finalizePendingSubmit();
  if (finalizedPendingSubmit) {
    return;
  }
  const continuedQueue = await continueQueuedAutoApply();
  if (continuedQueue) {
    return;
  }
  await continueSearchAutoApply();
}

initializeContentScript().catch(async (error) => {
  const messageText = localizeError(error);
  await storageSet({ autoApplyQueue: { active: false }, autoApplySearchQueue: { active: false } }, { optional: true });
  await setRunState({ state: 'error', lastError: messageText });
});
