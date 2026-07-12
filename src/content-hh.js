const HH_SELECTORS = {
  responseButtons: [
    '[data-qa="vacancy-serp__vacancy_response"]',
    '[data-qa="vacancy-response-link-top"]',
    '[data-qa="vacancy-response-link-bottom"]',
    'a[href*="vacancy_response"]',
    'button'
  ],
  titleLinks: ['[data-qa="serp-item__title"]', 'a[href*="/vacancy/"]'],
  vacancyText: [
    '[data-qa="vacancy-description"]',
    '[data-qa="vacancy-section"]',
    '[data-qa="vacancy-view-description"]',
    'main'
  ],
  textareas: [
    '[data-qa="vacancy-response-popup-form-letter-input"]',
    '[data-qa="vacancy-response-letter-input"]',
    'textarea',
    '[contenteditable="true"]',
    '[role="textbox"]'
  ],
  submitButtons: [
    '[data-qa="vacancy-response-submit-popup"]',
    '[data-qa="vacancy-response-letter-submit"]',
    '[data-qa*="submit"]',
    'button'
  ],
  modalClose: [
    '[data-qa="bloko-modal-close"]',
    '[data-qa="modal-close"]',
    '[data-qa*="modal-close"]',
    '[data-qa*="modal"] button[aria-label*="Закрыть"]',
    'button[aria-label="Закрыть"]'
  ],
  nextPageLinks: [
    'a[data-qa="pager-next"]',
    '[data-qa="pager-next"] a',
    'a[rel="next"]'
  ]
};
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
const RUNTIME_MESSAGE_TIMEOUT_MS = 45000;
const AUTO_APPLY_FLOW_VERSION = 'list-click-return-v12';
const AUTO_START_TOKEN_KEY = 'autoApplyAutoStartToken';
const AUTO_START_TOKEN_EXPIRES_AT_KEY = 'autoApplyAutoStartTokenExpiresAt';
const VACANCY_GROQ_MAX_CHARS = 2200;
const QUESTION_CONTEXT_GROQ_MAX_CHARS = 2200;
const QUESTION_VISIBLE_FALLBACK_MAX_CHARS = 600;
const HH_DAILY_RESPONSE_LIMIT_ACTION = 'Исчерпан лимит в 200 откликов в день';
const HH_DAILY_RESPONSE_LIMIT_MESSAGE = 'HH временно не дает отправлять новые отклики.';
const {
  cleanText,
  sanitizeGeneratedText,
  stripAnswerLabel,
  getGeneratedTextInvalidReason,
  splitGeneratedAnswers,
  normalizeChoiceText,
  choiceTokens,
  scoreChoice
} = globalThis.HHJobAssistantText || {};
const {
  textOf,
  isVisible,
  queryFirst,
  queryAll,
  findClickableByText,
  isDisabled,
  findEnabledClickableByText,
  setNativeValue
} = globalThis.HHJobAssistantDom || {};

let stopRequested = false;
let stopReason = '';
let activeRunId = null;
let queuedResumeStarted = false;
let queuedSearchStarted = false;
let extensionContextInvalidated = false;
let actionOverlay = null;

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

function isExtensionContextInvalidatedError(error) {
  return /extension context invalidated|context invalidated/i.test(error instanceof Error ? error.message : String(error));
}

function localizeError(error, fallback) {
  return globalThis.HHJA_LOCALIZE_ERROR?.(error, fallback) || fallback || 'Внутренняя ошибка расширения.';
}

const DEFAULTS = globalThis.HHJA_DEFAULTS;

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

function getVacancyId(url) {
  return String(url || '').match(/\/vacancy\/(\d+)/)?.[1] || new URL(String(url || location.href), location.href).searchParams.get('vacancyId') || '';
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

function isUnsafePage() {
  const body = textOf(document.body);
  return (
    isUnsafeHhUrl(location.href) ||
    /captcha|подтвердите, что вы не робот|не робот|слишком много запросов/i.test(body)
  );
}

function hasAuthenticatedHhSignal() {
  if (globalThis.__HH_JOB_ASSISTANT_TEST_AUTHENTICATED__ === false || window.__HH_JOB_ASSISTANT_TEST_AUTHENTICATED__ === false) {
    return false;
  }
  if (globalThis.__HH_JOB_ASSISTANT_TEST_AUTHENTICATED__ === true || window.__HH_JOB_ASSISTANT_TEST_AUTHENTICATED__ === true) {
    return true;
  }
  if (window.__HH_JOB_ASSISTANT_TEST_FAST_CLICKS__) return true;
  if (isUnsafePage()) return false;

  const authLinks = queryAll([
    'a[href*="/applicant/"]',
    'a[href*="/resume/"]',
    'a[href*="/negotiations"]'
  ]);
  if (authLinks.some((link) => /^https:\/\/([^/]+\.)?hh\.ru\//.test(link.href || ''))) {
    return true;
  }

  const body = textOf(document.body);
  return /мои резюме|отклики|сообщения|профиль|личный кабинет/i.test(body) && !/войти|зарегистрироваться/i.test(body);
}

function requireAuthenticatedHhPage() {
  if (hasAuthenticatedHhSignal()) return;
  throw new Error('Требуется авторизация HH. Войдите на hh.ru перед использованием HH Job Assistant.');
}

function isUnsafeHhUrl(value) {
  try {
    const url = new URL(String(value || ''), location.href);
    return /\/account\/login|\/account\/signup/.test(url.pathname);
  } catch {
    return false;
  }
}

function isResponseFormPage() {
  return (
    /\/applicant\/vacancy_response/.test(location.pathname) ||
    Boolean(queryFirst(HH_SELECTORS.submitButtons.filter((selector) => selector !== 'button'), document))
  );
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

function getElementHref(node) {
  return node?.href || node?.getAttribute?.('href') || '';
}

function getResponseUrlFromControl(node) {
  const href = getElementHref(node);
  return /\/applicant\/vacancy_response/.test(href) ? href : '';
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

function getItemResponseUrl(item) {
  return item?.responseUrl || buildResponseUrlFromVacancyId(getVacancyDedupeKey(item) || item?.vacancyId, item?.url || location.href);
}

function getCardInfo(card, index) {
  const titleLink = queryFirst(HH_SELECTORS.titleLinks, card) || card.querySelector('a[href*="/vacancy/"]');
  const responseButton =
    queryAll(HH_SELECTORS.responseButtons, card).find((node) => /откликнуться/i.test(textOf(node))) ||
    findClickableByText(card, [/откликнуться/i]) ||
    (/откликнуться/i.test(textOf(card)) ? card : null);
  const responseHref = getResponseUrlFromControl(responseButton) || getResponseUrlFromControl(card);
  const href = getElementHref(titleLink) || getElementHref(card.querySelector?.('a[href*="/vacancy/"]')) || responseHref || location.href;
  const vacancyId = getVacancyId(href) || getVacancyId(responseHref);
  const title = textOf(titleLink) || textOf(card).split('\n').find(Boolean) || document.title;

  return {
    index: index + 1,
    vacancyId,
    title,
    url: /\/applicant\/vacancy_response/.test(href) && vacancyId ? `${location.origin}/vacancy/${vacancyId}` : href,
    responseUrl: responseHref || buildResponseUrlFromVacancyId(vacancyId, href),
    card,
    responseButton,
    cardText: textOf(card),
    testDetected: /тест|задани[ея]|ответьте на вопросы|вопрос/i.test(textOf(card))
  };
}

function getVacancyCardNodes() {
  function hasVacancyLink(node) {
    return Boolean(
      node?.querySelector?.('a[href*="/vacancy/"]') ||
        (node?.matches?.('a[href*="/vacancy/"]') ? node : null)
    );
  }

  function hasResponseControl(node) {
    return Boolean(
      queryAll(HH_SELECTORS.responseButtons, node).find((control) => /откликнуться/i.test(textOf(control))) ||
        (/откликнуться/i.test(textOf(node)) && getResponseUrlFromControl(node))
    );
  }

  function normalizeVacancyCardNode(node) {
    let current = node;
    let fallback = null;
    while (current && current !== document && current !== document.body) {
      const hasLink = hasVacancyLink(current);
      const hasResponse = hasResponseControl(current);
      if (hasLink && hasResponse) {
        return current;
      }
      if (!fallback && (hasLink || hasResponse)) {
        fallback = current;
      }
      current = current.parentElement;
    }
    return fallback;
  }

  for (const selectors of [
    ['[data-qa="vacancy-serp__vacancy"]'],
    ['[data-qa="serp-item"]'],
    ['[data-qa*="vacancy-serp"]']
  ]) {
    const seenNodes = new Set();
    const cards = queryAll(selectors)
      .map(normalizeVacancyCardNode)
      .filter((card) => {
        if (!card || seenNodes.has(card)) return false;
        seenNodes.add(card);
        return card.querySelector('a[href*="/vacancy/"]') || /откликнуться/i.test(textOf(card));
      });
    if (cards.length > 0) {
      return cards;
    }
  }

  return [];
}

function scanVacancies() {
  const cards = getVacancyCardNodes().map(getCardInfo);

  const seen = new Set();
  const uniqueCards = cards.filter((item) => {
    const key = item.vacancyId || item.url || `${item.title}:${item.index}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (uniqueCards.length > 0) {
    return uniqueCards;
  }

  if (isResponseFormPage()) {
    const submitButton = findSubmitButton(document);
    return [
      {
        index: 1,
        vacancyId: getVacancyId(location.href),
        title: cleanText(document.querySelector('h1')?.textContent) || document.title || 'Отклик на вакансию',
        url: location.href,
        card: document,
        responseButton: submitButton,
        responseFormOpen: true,
        cardText: getVacancyText(),
        testDetected: /тест|задани[ея]|ответьте на вопросы|вопрос/i.test(textOf(document.body)) || findQuestionFields(document).length > 0
      }
    ];
  }

  const detailButton = findClickableByText(document, [/откликнуться/i]);
  if (!detailButton || !/\/vacancy\//.test(location.href)) {
    return [];
  }

  return [
    {
      index: 1,
      vacancyId: getVacancyId(location.href),
      title: cleanText(document.querySelector('h1')?.textContent) || document.title,
      url: location.href,
      card: document,
      responseButton: detailButton,
      cardText: getVacancyText(),
      testDetected: /тест|задани[ея]|ответьте на вопросы|вопрос/i.test(textOf(document.body))
    }
  ];
}

function getVacancyText(root = document) {
  const node = queryFirst(HH_SELECTORS.vacancyText, root) || root;
  return compactVacancyText(textOf(node));
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

function compactVacancyText(text, maxChars = VACANCY_GROQ_MAX_CHARS) {
  const noisePattern = /^(?:откликнуться|показать контакты|в избранное|скрыть|пожаловаться|поделиться|назад|далее|похожие вакансии|вакансии компании|hh\.ru|headhunter)$/i;
  const lines = uniqueContextLines(text)
    .filter((line) => line.length <= 700)
    .filter((line) => !noisePattern.test(line))
    .filter((line) => !/^(?:откликнуться|показать|скрыть)\b/i.test(line));
  return joinCappedLines(lines, maxChars);
}

function getDialogRoot() {
  const candidates = [
    ...document.querySelectorAll('[role="dialog"], [data-qa*="modal"], .bloko-modal, .magritte-modal')
  ].filter(isVisible);
  return candidates.at(-1) || document;
}

function getRootText(root = getDialogRoot()) {
  return textOf(root) || textOf(root?.body) || (root === document ? textOf(document.body) : '');
}

function detectTest(root = getDialogRoot()) {
  const text = getRootText(root);
  return /тест|задани[ея]|контрольн|ответьте на вопросы|вопрос \d|пройти тест/i.test(text);
}

function isResponseFormRoot(root) {
  return root !== document || isResponseFormPage();
}

function isAlreadyAppliedPage(root = document) {
  return /вы откликнулись|отклик отправлен|отклик успешно|отклик на вакансию отправлен/i.test(
    textOf(root) || textOf(root.body)
  );
}

function hasNewResponseSuccessText(beforeText, root = document) {
  const before = cleanText(beforeText);
  const current = cleanText(textOf(root) || textOf(root?.body) || textOf(document.body));
  if (!current || current === before) return false;
  const successPattern = /отклик\s+отправлен|отклик\s+успешно|отклик\s+на\s+вакансию\s+отправлен/i;
  return successPattern.test(current) && !successPattern.test(before);
}

function hasActiveResponseControl(root = document, item = null) {
  if (root === item?.card && !item?.responseFormOpen && item?.responseButton && !isDisabled(item.responseButton)) return true;

  const itemVacancyId = getVacancyDedupeKey(item);
  const responseControlSelectors = HH_SELECTORS.responseButtons.filter((selector) => selector !== 'button');
  return queryAll(responseControlSelectors, root).some((node) => {
    if (isDisabled(node)) return false;
    const nodeVacancyId = getVacancyId(node.href || '');
    return !itemVacancyId || !nodeVacancyId || nodeVacancyId === itemVacancyId;
  });
}

function isAlreadyAppliedForCurrentItem(root = document, item = null, { ignoreActiveResponseControl = false } = {}) {
  if (!ignoreActiveResponseControl && hasActiveResponseControl(root, item)) return false;
  if (!isAlreadyAppliedPage(root)) return false;
  if (root !== document) return true;
  if (isResponseFormPage()) return true;

  const currentVacancyId = getVacancyId(location.href);
  const itemVacancyId = getVacancyDedupeKey(item);
  return Boolean(currentVacancyId && (!itemVacancyId || currentVacancyId === itemVacancyId));
}

async function waitForAlreadyAppliedConfirmation(item, { timeoutMs = 5000 } = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    if (
      isAlreadyAppliedForCurrentItem(document, item, { ignoreActiveResponseControl: true }) ||
      /вы\s+откликнулись|отклик\s+отправлен|отклик\s+успешно/i.test(textOf(document.body))
    ) {
      return true;
    }
    if (window.__HH_JOB_ASSISTANT_TEST_FAST_CLICKS__) break;
    await sleep(500);
  }
  return false;
}

function findTextarea(root = getDialogRoot()) {
  const fields = queryAll(HH_SELECTORS.textareas, root);
  return fields.find((field) => /letter|cover|сопровод/i.test(getFieldMarker(field))) || fields[0] || null;
}

function getFieldMarker(field) {
  const name = field.getAttribute('name') || '';
  const dataQa = field.getAttribute('data-qa') || '';
  const placeholder = field.getAttribute('placeholder') || '';
  const ariaLabel = field.getAttribute('aria-label') || '';
  const label = typeof field.closest === 'function' ? field.closest('label') : null;
  const nearText = textOf(label || field.parentElement || field);
  return `${name}\n${dataQa}\n${placeholder}\n${ariaLabel}\n${nearText}`;
}

function getFieldLogTarget(field) {
  if (!field) return {};
  return {
    tagName: String(field.tagName || '').toLowerCase(),
    type: field.getAttribute?.('type') || '',
    name: field.getAttribute?.('name') || '',
    dataQa: field.getAttribute?.('data-qa') || '',
    placeholder: field.getAttribute?.('placeholder') || '',
    ariaLabel: field.getAttribute?.('aria-label') || '',
    marker: getFieldMarker(field)
  };
}

function getTaskBody(node) {
  return typeof node?.closest === 'function' ? node.closest('[data-qa="task-body"]') : null;
}

function getTaskBodyQuestionText(node) {
  const taskBody = getTaskBody(node);
  if (!taskBody) return '';
  return (
    cleanText(textOf(taskBody))
      .split('\n')
      .map((line) => cleanText(line))
      .find((line) => line && !/^(?:да|нет|свой вариант|писать тут|\d+\s+из\s+\d+)$/i.test(line)) || ''
  );
}

function getMeaningfulQuestionText(field) {
  const technicalMarkers = [
    field.getAttribute('name') || '',
    field.getAttribute('data-qa') || '',
    field.getAttribute('id') || ''
  ].filter(Boolean);
  const candidates = [
    getTaskBodyQuestionText(field),
    field.getAttribute('aria-label') || '',
    field.getAttribute('placeholder') || '',
    textOf(typeof field.closest === 'function' ? field.closest('label') : null),
    textOf(field.parentElement || null),
    textOf(field)
  ];

  const cleaned = candidates
    .map((candidate) => {
      let text = cleanText(candidate);
      for (const marker of technicalMarkers) {
        text = cleanText(text.replaceAll(marker, ' '));
      }
      return text
        .split('\n')
        .map((line) => cleanText(line))
        .filter((line) => line && !/^(?:task_\d+(?:_text)?|писать тут|answer|ответ)$/i.test(line))
        .join('\n');
    })
    .find((candidate) => {
      if (!candidate) return false;
      if (/^(?:task_\d+(?:_text)?|писать тут)$/i.test(candidate)) return false;
      return /[а-яa-z]{3,}/i.test(candidate);
    });

  return cleanText(cleaned || '');
}

function getFieldQuestionText(field) {
  return cleanText(field?.__hhjaQuestionText || getMeaningfulQuestionText(field));
}

function extractVisibleQuestionLabels(text, { textOnly = false } = {}) {
  const lines = cleanText(text)
    .split('\n')
    .map((line) => cleanText(line))
    .filter(Boolean);
  const labels = [];
  for (const line of lines) {
    if (line.length < 12 || line.length > 500) continue;
    if (/^(?:да|нет|ecom|\/ecom|отправить|откликнуться|писать тут)$/i.test(line)) continue;
    if (/task_\d+/i.test(line)) continue;
    const isTextFieldLabel = /укажите|напишите|опишите|расскажите|зарплат|доход|оклад|gross|телеграм|telegram|мессендж|messenger|ник для связи|контакт/i.test(line);
    if (textOnly && !isTextFieldLabel) continue;
    if (
      /[?]$/.test(line) ||
      /^(?:укажите|расскажите|опишите|напишите|какие|какой|какую|сколько|готовы|есть ли|имеется ли|на какой|почему|были ли|был ли)\b/i.test(line) ||
      /зарплат|доход|оклад|gross|телеграм|telegram|мессендж|messenger|ник для связи|контакт/i.test(line)
    ) {
      if (!labels.includes(line)) labels.push(line);
    }
  }
  return labels;
}

function isContactQuestion(field) {
  const text = cleanText(`${getFieldQuestionText(field)}\n${getFieldMarker(field)}`);
  const contactChannel = /telegram|телеграм|телеграмм|мессендж|messenger|whatsapp|ватсап|wa\.me|t\.me/i;
  const contactTarget = /ник|username|user\s*name|handle|аккаунт|ссылк|контакт|contact|профил|номер|телефон/i;
  const contactAction = /укажите|напишите|оставьте|сообщите|предоставьте|пришлите|дайте|куда|как\s+с\s+вами\s+связаться/i;
  if (/как\s+с\s+вами\s+связаться|контакт(?:ы|ные)?\s+для\s+связи|contact\s+(?:details|info)/i.test(text)) return true;
  return contactChannel.test(text) && contactTarget.test(text) && contactAction.test(text);
}

function isSalaryQuestion(field) {
  return /зарплат|доход|компенсац|оклад|gross|salary|income/i.test(`${getFieldQuestionText(field)}\n${getFieldMarker(field)}`);
}

function allowsShortNumericQuestionAnswer(field) {
  return /сколько|количеств|число|лет|год|разработчик|команд|зарплат|доход|компенсац|оклад|gross|salary|income/i.test(
    `${getFieldQuestionText(field)}\n${getFieldMarker(field)}`
  );
}

function extractContactFromText(text) {
  return (
    cleanText(text).match(/(?:https?:\/\/)?t\.me\/[a-z0-9_]+|@[a-z0-9_]{4,}|(?:https?:\/\/)?wa\.me\/\S+/i)?.[0] || ''
  );
}

function getQuestionAnswerInvalidReason(answer, field) {
  const text = cleanText(answer);
  if (text.length < 2 && allowsShortNumericQuestionAnswer(field) && /\d/.test(text)) {
    return '';
  }
  const genericReason = getGeneratedTextInvalidReason(text, { minLength: 2 });
  if (genericReason) return genericReason;
  if (isContactQuestion(field) && !/(?:^|\s)(?:@[a-z0-9_]{4,}|t\.me\/[a-z0-9_]+|https?:\/\/\S+|телеграм|telegram|whatsapp|wa\.me\/\S+)/i.test(text)) {
    return 'Сгенерированный ответ не похож на контакт для вопроса про мессенджер.';
  }
  if (isSalaryQuestion(field) && !/\d/.test(text)) {
    return 'Сгенерированный ответ не содержит сумму для вопроса про доход.';
  }
  return '';
}

async function normalizeQuestionAnswers(answers, questionFields) {
  const { resumeText = '', resumeParsedText = '', resumeCache = null } = await storageGet(
    ['resumeText', 'resumeParsedText', 'resumeCache'],
    { optional: true }
  );
  const resumeSource = [resumeParsedText, resumeText, resumeCache?.text].filter(Boolean).join('\n');
  const contact = extractContactFromText(resumeSource);
  return answers.map((answer, index) => {
    const field = questionFields[index];
    if (isContactQuestion(field) && contact) {
      return contact;
    }
    return answer;
  });
}

async function buildDeterministicQuestionAssistance(questionFields, { includeSalary = false } = {}) {
  if (questionFields.length === 0) return '';
  const { resumeText = '', resumeParsedText = '', resumeCache = null } = await storageGet(
    ['resumeText', 'resumeParsedText', 'resumeCache'],
    { optional: true }
  );
  const resumeSource = [resumeParsedText, resumeText, resumeCache?.text].filter(Boolean).join('\n');
  const contact = extractContactFromText(resumeSource);
  const expectedSalary = await getExpectedSalary();
  const answers = questionFields.map((field, index) => {
    if (isContactQuestion(field) && contact) {
      return `Text question ${index + 1}: ${contact}`;
    }
    if (includeSalary && isSalaryQuestion(field) && expectedSalary) {
      return `Text question ${index + 1}: ${expectedSalary}`;
    }
    return '';
  });
  return answers.every(Boolean) ? answers.join('\n') : '';
}

function findCoverLetterTextarea(root = getDialogRoot()) {
  const fields = [...root.querySelectorAll('textarea,input:not([type="hidden"]),[contenteditable="true"],[role="textbox"]')]
    .filter(isVisible)
    .filter((field) => !/task_|question|answer|вопрос|ответ|писать тут|зарплат|доход/i.test(getFieldMarker(field)));
  const marked = fields.find((field) => /letter|cover|сопровод/i.test(getFieldMarker(field)));
  if (marked) return marked;
  const rootText = getRootText(root);
  if (fields.length === 1 && /сопроводительное\s+письмо|cover\s+letter/i.test(rootText)) {
    return fields[0];
  }
  return null;
}

function findQuestionFields(root = getDialogRoot()) {
  return [...root.querySelectorAll('textarea,input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]),[contenteditable="true"]')]
    .filter(isVisible)
    .filter((field) => {
      const marker = getFieldMarker(field);
      if (/letter|cover|сопровод/i.test(marker)) return false;
      return /task_|question|answer|вопрос|ответ|писать тут|зарплат|доход/i.test(marker);
    });
}

function getControlType(control) {
  return String(control?.type || control?.getAttribute?.('type') || '').toLowerCase();
}

function isQuestionLikeChoiceLine(line) {
  const text = cleanText(line);
  if (!text) return false;
  return (
    /[?]$/.test(text) ||
    /^(?:где|какой|какая|какое|какие|сколько|готовы|есть ли|имеется ли|вакансия открыта|на какой|почему|были ли|был ли)\b/i.test(text)
  );
}

function isUsableChoiceValue(value) {
  const text = cleanText(value);
  if (!text || text.length > 120) return false;
  if (/^\d+$/.test(text)) return false;
  if (/^task[_-]?\d+/i.test(text)) return false;
  return /[а-яa-z]/i.test(text);
}

function extractOptionMarker(marker) {
  let hasQuestionLikeLine = false;
  const lines = cleanText(marker)
    .split('\n')
    .map((line) => cleanText(line))
    .filter(Boolean)
    .filter((line) => {
      if (!isQuestionLikeChoiceLine(line)) return true;
      hasQuestionLikeLine = true;
      return false;
    })
    .filter((line) => !/^(?:писать тут|ответить|отправить|откликнуться|\d+\s+из\s+\d+)$/i.test(line));
  return {
    text: lines.join('\n'),
    hasQuestionLikeLine
  };
}

function getOptionLabel(control) {
  const label = typeof control.closest === 'function' ? control.closest('label') : null;
  const ariaLabel = control.getAttribute?.('aria-label') || '';
  const marker = textOf(label || control.parentElement || control);
  const value = control.value || control.getAttribute?.('value') || '';
  const markerOption = extractOptionMarker(marker);
  const fallbackValue = !markerOption.text && !markerOption.hasQuestionLikeLine && isUsableChoiceValue(value) ? value : '';
  return cleanText([...new Set([ariaLabel, markerOption.text, fallbackValue].map(cleanText).filter(Boolean))].join('\n'));
}

function getControlGroupKey(control, index) {
  const type = getControlType(control);
  const name = String(control.getAttribute?.('name') || control.name || '').replace(/\[\]$/, '');
  if (name) return `${type}:${name}`;

  const group = typeof control.closest === 'function' ? control.closest('fieldset,[role="group"],[data-qa*="task"]') : null;
  const groupMarker = cleanText(
    [group?.getAttribute?.('data-qa') || '', textOf(group).slice(0, 160)].filter(Boolean).join('\n')
  );
  return groupMarker ? `${type}:${groupMarker}` : `${type}:control-${index}`;
}

function getControlQuestionText(control) {
  const taskText = getTaskBodyQuestionText(control);
  if (taskText) return taskText;
  const group = typeof control.closest === 'function' ? control.closest('fieldset,[role="group"],[data-qa*="task"]') : null;
  return cleanText(textOf(group).split('\n').find((line) => /[?]$/.test(cleanText(line))) || '');
}

function isSelectableQuestionControl(control) {
  if (!control || isDisabled(control)) return false;
  const type = getControlType(control);
  if (type !== 'checkbox' && type !== 'radio') return false;

  const label = typeof control.closest === 'function' ? control.closest('label') : null;
  const parent = control.parentElement || null;
  return isVisible(control) || isVisible(label) || isVisible(parent);
}

function findQuestionControlGroups(root = getDialogRoot()) {
  const controls = [...root.querySelectorAll('input[type="checkbox"],input[type="radio"]')]
    .filter(isSelectableQuestionControl)
    .map((control, index) => ({
      control,
      type: getControlType(control),
      label: getOptionLabel(control),
      groupKey: getControlGroupKey(control, index)
    }))
    .filter((option) => option.label);

  const byGroup = new Map();
  for (const option of controls) {
    const group = byGroup.get(option.groupKey) || {
      type: option.type,
      key: option.groupKey,
      question: getControlQuestionText(option.control) || cleanText(option.groupKey.replace(/^(checkbox|radio):/, '')),
      options: []
    };
    group.options.push(option);
    byGroup.set(option.groupKey, group);
  }

  return [...byGroup.values()].filter((group) => group.options.length > 0);
}

function buildEmployerQuestionContext(root, questionFields, questionControlGroups) {
  const sections = [];
  const fullRootText = getRootText(root);
  const visibleQuestionLabels = extractVisibleQuestionLabels(fullRootText, { textOnly: true });

  if (questionFields.length > 0) {
    sections.push(
      [
        'Open text questions:',
        ...questionFields.map((field, index) => {
          const marker = cleanText(getMeaningfulQuestionText(field) || visibleQuestionLabels[index] || getFieldMarker(field)).slice(0, 600);
          field.__hhjaQuestionText = marker;
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

  if (questionControlGroups.length > 0) {
    sections.push(
      [
        'Choice groups:',
        ...questionControlGroups.map((group, index) => {
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

function buildChoiceRetryContext(questionControlGroups) {
  return [
    'Choice groups:',
    ...questionControlGroups.map((group, index) => {
      const groupIndex = Number(group.originalIndex ?? index) + 1;
      const options = group.options.map((option, optionIndex) => `${optionIndex + 1}. ${option.label}`).join('\n');
      return [
        `Choice group ${groupIndex} (${group.type}, ${group.type === 'radio' ? 'choose one' : 'choose all matching'}):`,
        group.question ? `Question/context: ${group.question}` : 'Question/context: not found',
        options
      ].join('\n');
    })
  ].join('\n').slice(0, QUESTION_CONTEXT_GROQ_MAX_CHARS);
}

function summarizeEmployerQuestionInputs(questionFields, questionControlGroups) {
  return {
    textQuestions: questionFields.map((field, index) => ({
      index: index + 1,
      question: cleanText(field.__hhjaQuestionText || getMeaningfulQuestionText(field) || getFieldMarker(field) || 'question text not found'),
      target: getFieldLogTarget(field)
    })),
    choiceQuestions: questionControlGroups.map((group, index) => ({
      index: index + 1,
      type: group.type,
      question: cleanText(group.question || group.key || 'question text not found'),
      options: group.options.map((option, optionIndex) => ({
        index: optionIndex + 1,
        label: option.label
      }))
    }))
  };
}

function buildQuestionAnswerAudit(questionFields, questionControlGroups, selectedChoices = { labels: [] }) {
  const selectedLabels = new Set((selectedChoices?.labels || []).map((label) => cleanText(label)));
  return {
    textAnswers: questionFields.map((field, index) => ({
      index: index + 1,
      question: cleanText(field.__hhjaQuestionText || getMeaningfulQuestionText(field) || getFieldMarker(field) || 'question text not found'),
      answer: cleanText(getFieldValue(field))
    })),
    choiceAnswers: questionControlGroups.map((group, index) => ({
      index: index + 1,
      type: group.type,
      question: cleanText(group.question || group.key || 'question text not found'),
      selectedOptions: group.options
        .filter((option) => option.control?.checked || selectedLabels.has(cleanText(option.label)))
        .map((option) => option.label)
    }))
  };
}

const SUBMIT_ACTION_PATTERN = /отправить|откликнуться|продолжить|сгенерировать\s+резюме/i;

function findSubmitButton(root = getDialogRoot()) {
  return (
    queryAll(HH_SELECTORS.submitButtons, root)
      .filter((button) => !isDisabled(button))
      .find((button) => SUBMIT_ACTION_PATTERN.test(textOf(button))) ||
    findEnabledClickableByText(root, [/отправить/i, /откликнуться/i, /продолжить/i, /сгенерировать\s+резюме/i])
  );
}

function hasSubmitControl(root = getDialogRoot()) {
  return queryAll(HH_SELECTORS.submitButtons, root).some((button) => SUBMIT_ACTION_PATTERN.test(textOf(button)));
}

function detectBlockedResponseReason(root = getDialogRoot()) {
  const text = textOf(root) || textOf(root?.body) || textOf(document.body);
  if (/поменяйте видимость резюме|видно компаниям-клиентам headhunter/i.test(text)) {
    return 'Пропущено: видимость резюме не позволяет отправить этот отклик. Измените видимость на "Видно компаниям-клиентам HeadHunter".';
  }
  if (/откликнуться на эту вакансию невозможно|нельзя откликнуться|отклик недоступен/i.test(text)) {
    return 'Пропущено: HH отключил кнопку отклика для этой вакансии.';
  }
  return '';
}

function isHhDailyResponseLimitText(text) {
  return /в\s+течение\s+24\s+час(?:ов|а)?.{0,160}не\s+более\s+200\s+откликов|исчерпали\s+лимит\s+откликов/i.test(cleanText(text));
}

function detectHhDailyResponseLimit(root = getDialogRoot()) {
  const notificationSelectors = [
    '[data-qa="vacancy-response-error-notification"][role="status"]',
    '[data-qa="vacancy-response-error-notification"]'
  ];
  const notification = queryFirst(notificationSelectors, document) || (root !== document ? queryFirst(notificationSelectors, root) : null);
  const notificationText = textOf(notification);
  if (isHhDailyResponseLimitText(notificationText)) {
    return cleanText(notificationText);
  }

  const text = textOf(root) || textOf(root?.body) || textOf(document.body);
  return isHhDailyResponseLimitText(text) ? cleanText(text) : '';
}

function findFollowupConfirmButton(root = getDialogRoot()) {
  const text = getRootText(root);
  if (!/другой стране|такой отклик может получить отказ|скорее всего, будет отказ|получить отказ/i.test(text)) {
    return null;
  }

  return findClickableByText(root, [
    /в[сc][её]\s+равно\s+откликнуться/i,
    /откликнуться все равно/i,
    /откликнуться всё равно/i,
    /продолжить отклик/i,
    /подтвердить/i
  ]);
}

async function clickFollowupConfirmButton(confirmButton, counters) {
  await setRunState({
    state: 'submitting',
    ...counters,
    currentAction: 'HH предупреждает: отклик может получить отказ — подтверждаю отклик',
    lastError: ''
  });
  await waitBeforeClick(FOLLOWUP_CONFIRM_CLICK_DELAY_MIN_MS, FOLLOWUP_CONFIRM_CLICK_DELAY_MAX_MS);
  clickWithActionCursor(confirmButton);
  await sleep(FOLLOWUP_CONFIRM_SETTLE_MS);
}

async function confirmFollowupIfNeeded(previousText, counters) {
  if (window.__HH_JOB_ASSISTANT_TEST_FAST_CLICKS__) {
    const confirmButton = findFollowupConfirmButton(getDialogRoot());
    if (!confirmButton) {
      return false;
    }

    await clickFollowupConfirmButton(confirmButton, counters);
    return true;
  }

  const root = await waitForDialogOrChange(previousText, 5000);
  const confirmButton = findFollowupConfirmButton(root);
  if (!confirmButton) {
    return false;
  }

  await clickFollowupConfirmButton(confirmButton, counters);
  return true;
}

async function confirmInitialFollowupIfNeeded(root, previousText, counters) {
  const confirmButton = findFollowupConfirmButton(root);
  if (!confirmButton) {
    return root;
  }

  await clickFollowupConfirmButton(confirmButton, counters);
  return waitForDialogOrChange(previousText, window.__HH_JOB_ASSISTANT_TEST_FAST_CLICKS__ ? 0 : 7000);
}

function closeDialog() {
  const root = getDialogRoot();
  const ariaClose = [...root.querySelectorAll('button,[role="button"]')]
    .filter(isVisible)
    .find((node) => /закрыть|close/i.test(node.getAttribute?.('aria-label') || ''));
  const close = queryFirst(HH_SELECTORS.modalClose, root) || ariaClose || findClickableByText(root, [/закрыть|отмена/i]);
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
  const nextPatch = { ...(patch || {}) };
  if (stopRequested && stopReason === 'user_stop' && nextPatch.state && nextPatch.state !== 'stopped' && nextPatch.state !== 'error') {
    nextPatch.state = 'stopped';
    nextPatch.currentAction = 'Остановлено';
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
  counters.applied += 1;
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
  counters.applied += 1;
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
  const { autoApplyStopBeforeSubmit = false } = await storageGet(['autoApplyStopBeforeSubmit'], { optional: true });
  if (autoApplyStopBeforeSubmit !== true) return false;
  await storageSet({ autoApplyStopBeforeSubmit: false }, { optional: true });
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
    counters.applied += 1;
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

function getFieldValue(field) {
  if (!field) return '';
  if (field.isContentEditable || String(field.getAttribute?.('contenteditable') || '').toLowerCase() === 'true') {
    return field.textContent || '';
  }
  return field.value || '';
}

function collectResponseValidationText(root = getDialogRoot()) {
  const text = cleanText(textOf(root) || textOf(document.body));
  const lines = text.split('\n').map(cleanText).filter(Boolean);
  const validationLines = lines.filter((line) => (
    /обязатель|заполн|укажите|выберите|некоррект|ошиб|слишком\s+корот|минимум|не\s+менее|проверьте/i.test(line) &&
    !SUBMIT_ACTION_PATTERN.test(line)
  ));
  return [...new Set(validationLines)].slice(0, 4).join(' ');
}

function validateFilledQuestionFields(questionFields, answers) {
  const missing = [];
  for (const [index, field] of questionFields.entries()) {
    const expected = cleanText(answers[index] || '');
    const actual = cleanText(getFieldValue(field));
    if (!expected || !actual) {
      missing.push(index + 1);
      continue;
    }
    if (actual !== expected && !actual.includes(expected) && !expected.includes(actual)) {
      missing.push(index + 1);
    }
  }
  return missing;
}

function validateSelectedQuestionControls(groups) {
  return groups
    .map((group, index) => ({
      index: index + 1,
      selected: group.options.filter((option) => Boolean(option.control?.checked)).length
    }))
    .filter((group) => group.selected === 0)
    .map((group) => group.index);
}

function getUnselectedQuestionControlGroups(groups) {
  return groups
    .map((group, index) => ({ ...group, originalIndex: Number(group.originalIndex ?? index) }))
    .filter((group) => !group.options.some((option) => Boolean(option.control?.checked)));
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
  counters.applied += 1;
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
  counters.applied += 1;
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
    'groqApiKey',
    'resumeUrl',
    'coverPrompt',
    'employerQuestionPrompt',
    'choiceRetryPrompt'
  ]);
  return {
    dailyLimit: Number(values.dailyLimit) || DEFAULTS.dailyLimit,
    delayMinMs: Number(values.delayMinMs) || DEFAULTS.delayMinMs,
    delayMaxMs: Number(values.delayMaxMs) || DEFAULTS.delayMaxMs,
    employmentPreference: normalizeMultiPreference(values.employmentPreference, EMPLOYMENT_PREFERENCE_VALUES),
    workFormatPreference: normalizeMultiPreference(values.workFormatPreference, WORK_FORMAT_PREFERENCE_VALUES),
    groqApiKey: values.groqApiKey,
    resumeUrl: values.resumeUrl,
    coverPrompt: values.coverPrompt,
    employerQuestionPrompt: values.employerQuestionPrompt,
    choiceRetryPrompt: values.choiceRetryPrompt
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

async function generateCoverLetter(vacancyText) {
  const response = await sendRuntimeMessage({
    type: 'GENERATE_COVER_LETTER',
    task: 'cover_letter',
    vacancyText
  }, {
    timeoutMs: getRuntimeMessageTimeoutMs(),
    timeoutMessage: 'Запрос сопроводительного письма Groq не уложился во время.',
    cancelOnStop: true
  });
  if (!response?.ok) {
    throw new Error(localizeError(response?.error, 'Не удалось сгенерировать сопроводительное письмо'));
  }
  const text = sanitizeGeneratedText(response.text);
  const invalidReason = getCoverLetterInvalidReason(text);
  if (invalidReason) {
    throw new Error(`Groq вернул неподходящее сопроводительное письмо: ${invalidReason}`);
  }
  return text;
}

function isMissingGroqKeyError(error) {
  return /groq api key is not configured|ключ groq api не настроен/i.test(error instanceof Error ? error.message : String(error));
}

function isRecoverableGroqError(error) {
  return /groq request failed: 429|groq .*timed out|rate limit|запрос groq завершился ошибкой: 429|запрос groq не уложился|запрос .* groq не уложился|groq временно ограничил запросы|пауза до|cooldown|groq вернул (?:пустой ответ|неподходящее сопроводительное письмо)/i.test(error instanceof Error ? error.message : String(error));
}

function isEmptyGroqResponseError(error) {
  return /groq вернул пустой ответ/i.test(error instanceof Error ? error.message : String(error));
}

function isFatalAutoApplyError(error) {
  return /login|captcha|anti-bot|слишком много запросов|не робот|страница входа|антибот/i.test(
    error instanceof Error ? error.message : String(error)
  );
}

function missingGroqMessage(kind) {
  if (kind === 'test') {
    return 'Пропущено: не указан ключ Groq API, а вакансия требует ответы на вопросы работодателя или тест.';
  }
  return 'Пропущено: не указан ключ Groq API, а вакансия требует сопроводительное письмо.';
}

async function generateTestAssistance(vacancyText, extraText) {
  const response = await sendRuntimeMessage({
    type: 'GENERATE_COVER_LETTER',
    task: 'test_assist',
    vacancyText,
    extraText
  }, {
    timeoutMs: getRuntimeMessageTimeoutMs(),
    timeoutMessage: 'Запрос помощи с вопросами Groq не уложился во время.',
    cancelOnStop: true
  });
  if (!response?.ok) {
    throw new Error(localizeError(response?.error, 'Не удалось подготовить ответы на вопросы работодателя'));
  }
  return sanitizeGeneratedText(response.text);
}

async function generateChoiceRetryAssistance(vacancyText, questionContext, previousAnswer) {
  const response = await sendRuntimeMessage({
    type: 'GENERATE_COVER_LETTER',
    task: 'choice_retry',
    vacancyText: '',
    extraText: [
      questionContext,
      '',
      'Previous answer:',
      previousAnswer
    ].join('\n')
  }, {
    timeoutMs: getRuntimeMessageTimeoutMs(),
    timeoutMessage: 'Запрос уточнения вариантов Groq не уложился во время.',
    cancelOnStop: true
  });
  if (!response?.ok) {
    throw new Error(localizeError(response?.error, 'Не удалось уточнить варианты ответов HH'));
  }
  return sanitizeGeneratedText(response.text);
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

async function getFallbackCoverLetter(vacancyText = '') {
  const text = cleanText(vacancyText);
  if (/(?:kotlin|java|jvm|backend|api|микросервис)/i.test(text)) {
    return 'Занимался JVM backend и API. Откликаюсь.';
  }
  if (/(?:qa|тестирован|автоматизац|selenium|playwright|junit)/i.test(text)) {
    return 'Занимался автотестами backend. Откликаюсь.';
  }
  return 'Похоже на мой опыт. Откликаюсь.';
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

async function getFallbackQuestionAssistance(questionFields, questionControlGroups) {
  const preferences = await getQuestionPreferences();
  const lines = [];
  questionControlGroups.forEach((group, index) => {
    const preferredOptions = getPreferredChoiceOptions(group, preferences);
    const positiveOptions = group.type === 'checkbox' && preferredOptions.length > 0
      ? preferredOptions
      : [
          getPreferredChoiceOption(group, preferences) ||
          group.options.find((option) => /да|готов|готова|соглас|можно|full|полная|удален|remote/i.test(option.label)) ||
          group.options.find((option) => !/нет|не готов|не готова|no\b/i.test(option.label)) ||
          group.options[0]
        ].filter(Boolean);
    const labels = positiveOptions.map((option) => option.label).filter(Boolean);
    if (labels.length > 0) {
      lines.push(`Choice group ${index + 1}: ${labels.join('; ')}`);
    }
  });
  const deterministicText = await buildDeterministicQuestionAssistance(questionFields, { includeSalary: true });
  if (deterministicText) lines.push(deterministicText);
  return lines.join('\n');
}

function hasCompleteLabeledTextAnswers(value, count) {
  if (count === 0) return true;
  const text = String(value || '');
  return Array.from({ length: count }, (_, index) => new RegExp(`(?:^|\\n)\\s*Text question ${index + 1}\\s*:`, 'i').test(text))
    .every(Boolean);
}

async function buildNumberedCoverLetterAnswers(questionContext) {
  const context = cleanText(questionContext);
  if (!/скопируйте|пронумерованные вопросы|ответьте,?\s+пожалуйста/i.test(context)) return '';
  const expectedSalary = await getExpectedSalary();
  const salary = expectedSalary || 'минимум 250 000 руб. gross, комфорт 300 000 руб. gross';
  const answers = [];
  if (/АБС\s*ЦФТ|ИБСО|ЦФТ-Банк|ЦФТ-Ритейл/i.test(context)) {
    answers.push('1. С АБС ЦФТ / ИБСО / ЦФТ-Банк / ЦФТ-Ритейл коммерческого опыта не было; есть опыт функционального, регрессионного и интеграционного тестирования, анализа требований, тест-кейсов и баг-репортов.');
  }
  if (/оклад|доход|зарплат|gross|гросс|вычета/i.test(context)) {
    answers.push(`${answers.length + 1}. Ожидания по окладу: ${salary}.`);
  }
  if (/военный билет|приписное/i.test(context)) {
    answers.push(`${answers.length + 1}. Военный билет или приписное: есть, детали готов обсудить.`);
  }
  return answers.join('\n');
}

function selectControl(control) {
  control.focus?.();
  if (!control.checked) {
    control.click?.();
  }
  control.checked = true;
  control.dispatchEvent?.(new Event('input', { bubbles: true }));
  control.dispatchEvent?.(new Event('change', { bubbles: true }));
}

function extractGroupAnswer(answerText, group, index) {
  const lines = cleanText(answerText).split(/\n+/).filter(Boolean);
  const numberedPattern = new RegExp(`(?:choice\\s+group|group|вариант(?:ы)?|вопрос)\\s*${index + 1}\\b`, 'i');
  const numbered = lines.filter((line) => numberedPattern.test(line));
  if (numbered.length > 0) {
    return numbered.join('\n');
  }

  const groupTokens = new Set(choiceTokens(group.question || group.key || ''));
  if (groupTokens.size > 0) {
    const contextual = lines.filter((line) => {
      const lineTokens = new Set(choiceTokens(line));
      return [...groupTokens].filter((token) => lineTokens.has(token)).length >= Math.min(2, groupTokens.size);
    });
    if (contextual.length > 0) {
      return contextual.join('\n');
    }
  }

  const optionLabels = group.options.map((option) => normalizeChoiceText(option.label)).filter(Boolean);
  const withOptions = lines.filter((line) => {
    const normalizedLine = normalizeChoiceText(line);
    return optionLabels.some((label) => label && normalizedLine.includes(label));
  });
  return withOptions.length > 0 ? withOptions.join('\n') : answerText;
}

function fillQuestionControls(groups, answerText) {
  let selected = 0;
  const labels = [];
  for (const [index, group] of groups.entries()) {
    const groupAnswer = extractGroupAnswer(answerText, group, Number(group.originalIndex ?? index));
    const scored = group.options
      .map((option) => ({ ...option, score: scoreChoice(option.label, groupAnswer) }))
      .filter((option) => option.score >= 0.5);

    if (group.type === 'radio') {
      const best = scored.sort((left, right) => right.score - left.score)[0];
      if (best) {
        selectControl(best.control);
        selected += 1;
        labels.push(best.label);
      }
      continue;
    }

    for (const option of scored) {
      selectControl(option.control);
      selected += 1;
      labels.push(option.label);
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
  const optionMarkers = options.map((option) => [
    option.label,
    option.control?.name || '',
    option.control?.value || '',
    option.control?.getAttribute?.('name') || '',
    option.control?.getAttribute?.('value') || ''
  ].join('\n')).join('\n');
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
      const option = findYesNoOption(options, preferenceListIncludes(preferences, 'workFormatPreference', 'hybrid'));
      if (option) preferred.push(option);
    } else if (preferred.length === 0 && /офис|office/i.test(questionText)) {
      const option = findYesNoOption(options, preferenceListIncludes(preferences, 'workFormatPreference', 'office'));
      if (option) preferred.push(option);
    }
  }

  return [...new Map(preferred.map((option) => [option.control, option])).values()];
}

function getPreferredChoiceOption(group, preferences = {}) {
  return getPreferredChoiceOptions(group, preferences)[0] || null;
}

function getFallbackChoiceOption(group, preferences = {}) {
  const options = Array.isArray(group?.options) ? group.options.filter((option) => option?.control) : [];
  if (options.length === 0) return null;
  return (
    getPreferredChoiceOption(group, preferences) ||
    findYesNoOption(options, true) ||
    options.find((option) => /(?:^|\s)(?:соглас|подходит|рассматриваю|agree|available)/i.test(option.label)) ||
    options.find((option) => !/нет|не готов|не готова|не могу|не подходит|не рассматриваю|no\b|not\b|отказ/i.test(option.label)) ||
    options[0]
  );
}

async function fillFallbackQuestionControls(groups) {
  const preferences = await getQuestionPreferences();
  let selected = 0;
  const labels = [];
  for (const group of groups) {
    const preferredOptions = getPreferredChoiceOptions(group, preferences);
    const options = group.type === 'checkbox' && preferredOptions.length > 0
      ? preferredOptions
      : [getFallbackChoiceOption(group, preferences)].filter(Boolean);
    for (const option of options) {
      selectControl(option.control);
      selected += 1;
      labels.push(option.label);
    }
  }
  return { selected, labels };
}

function truncateForStatus(value, maxLength = 180) {
  const text = cleanText(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function formatChoiceOptionSummary(groups) {
  return groups
    .slice(0, 3)
    .map((group, index) => {
      const options = group.options
        .map((option) => cleanText(option.label))
        .filter(Boolean)
        .slice(0, 6)
        .join(' / ');
      const suffix = group.options.length > 6 ? ' / …' : '';
      return `группа ${index + 1}: ${options}${suffix}`;
    })
    .filter(Boolean)
    .join('; ');
}

function formatChoiceUnmatchedMessage(groups, answerText, retryError = '') {
  const optionSummary = formatChoiceOptionSummary(groups);
  const answerSummary = truncateForStatus(answerText, 180);
  const details = [
    optionSummary ? `ожидались точные варианты: ${optionSummary}` : '',
    answerSummary ? `Groq ответил: ${answerSummary}` : '',
    retryError ? `ошибка уточнения: ${truncateForStatus(retryError, 220)}` : ''
  ].filter(Boolean);
  return [
    'Пропущено: Groq не вернул подходящие варианты ответов HH.',
    details.length > 0 ? `Нет совпадения с вариантами HH (${details.join('; ')}).` : ''
  ].filter(Boolean).join(' ');
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

async function applyToVacancy(item, counters) {
  if (await stopIfRequested(counters)) return;

  const initialDailyLimitReason = detectHhDailyResponseLimit(document);
  if (initialDailyLimitReason) {
    return completeHhDailyResponseLimit(item, counters, initialDailyLimitReason);
  }

  if (item.responseFormOpen && isAlreadyAppliedForCurrentItem(document, item)) {
    counters.applied += 1;
    await appendResult({
      index: item.index,
      vacancyId: item.vacancyId,
      title: item.title,
      url: item.url,
      status: 'applied_already_confirmed',
      coverLetterUsed: false,
      testDetected: item.testDetected,
      error: ''
    });
    return;
  }

  if (isAlreadyAppliedForCurrentItem(item.card, item)) {
    counters.applied += 1;
    await appendResult({
      index: item.index,
      vacancyId: item.vacancyId,
      title: item.title,
      url: item.url,
      status: 'applied_already_confirmed',
      coverLetterUsed: false,
      testDetected: item.testDetected,
      error: ''
    });
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
      const settledText = textOf(document.body);
      if (
        isAlreadyAppliedForCurrentItem(document, item, { ignoreActiveResponseControl: true }) ||
        /вы\s+откликнулись|отклик\s+отправлен|отклик\s+успешно/i.test(settledText)
      ) {
        await appendAlreadyAppliedResponse(item, counters, { coverLetterUsed: false, testDetected: item.testDetected });
        return;
      }
      const detailResponseButton = findEnabledClickableByText(document, [/откликнуться/i]) || findClickableByText(document, [/откликнуться/i]);
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
  let beforeText = textOf(document.body);
  if (item.responseFormOpen) {
    root = document;
  } else {
    await setRunState({
      state: 'waiting_for_dialog',
      ...counters,
      currentAction: `Откликаюсь на: ${item.title || item.vacancyId || 'вакансия'}`
    });
    beforeText = textOf(document.body);
    beforeUrl = location.href;
    if (item.navigationQueue) {
      await saveQueue(item.navigationQueue);
    }
    await sleep(250);
    if (await stopIfRequested(counters)) return;
    await waitBeforeClick();
    if (await stopIfRequested(counters)) return;
    if (isUnsafeHhUrl(item.responseButton.href)) {
      throw new Error('Перед нажатием отклика обнаружена страница входа или регистрации');
    }
    prepareResponseButtonForCurrentTab(item.responseButton);
    clickWithActionCursor(item.responseButton);

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
    counters.applied += 1;
    await appendResult({
      index: item.index,
      vacancyId: item.vacancyId,
      title: item.title,
      url: item.url,
      status: 'applied_already_confirmed',
      coverLetterUsed: false,
      testDetected: item.testDetected,
      error: ''
    });
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
    const questionContext = buildEmployerQuestionContext(root, questionFields, questionControlGroups);
    const vacancyText = getVacancyText(item.card) || getVacancyText(document);
    const questionAudit = summarizeEmployerQuestionInputs(questionFields, questionControlGroups);
    const deterministicAssistance = await buildDeterministicQuestionAssistance(questionFields);
    let coverLetterUsed = false;
    if (questionFields.length === 0 && questionControlGroups.length === 0 && !coverLetterTextarea) {
      const message = 'Пропущено: обнаружены вопросы работодателя, но заполняемые поля HH не найдены.';
      counters.skipped += 1;
      await appendResult({
        index: item.index,
        vacancyId: item.vacancyId,
        title: item.title,
        url: item.url,
        status: 'skipped_question_fields_not_found',
        coverLetterUsed: false,
        testDetected: true,
        error: message
      });
      await setRunState({ state: 'applying', ...counters, lastError: message });
      closeDialog();
      return;
    }

    await setRunState({
      state: 'generating_cover_letter',
      ...counters,
      currentAction: 'ИИ: отвечаю на вопросы работодателя'
    });
    let assistance;
    setBusyCursor(true);
    try {
      await appendAgentLog('question_context_extracted', {
        vacancyId: item.vacancyId,
        textFields: questionFields.length,
        choiceGroups: questionControlGroups.length,
        contextLength: questionContext.length,
        deterministicTextFields: deterministicAssistance ? questionFields.length : 0
      });
      await appendAgentLog('question_test_detected', {
        vacancyId: item.vacancyId,
        title: item.title,
        url: item.url,
        questions: questionAudit,
        questionContext,
        deterministicAssistance: deterministicAssistance || ''
      });
      if (deterministicAssistance && questionControlGroups.length === 0) {
        assistance = deterministicAssistance;
      } else {
        assistance = await generateTestAssistance(getVacancyText(item.card), questionContext || textOf(root));
      }
    } catch (error) {
      if (isStopRequestedError(error)) {
        await markStopped(counters);
        closeDialog();
        return;
      }
      if (!isMissingGroqKeyError(error) && !isRecoverableGroqError(error)) {
        throw error;
      }

      assistance = deterministicAssistance || await getFallbackQuestionAssistance(questionFields, questionControlGroups);
      if (assistance && hasCompleteLabeledTextAnswers(assistance, questionFields.length)) {
        await setRunState({ state: 'filling_cover_letter', ...counters, currentAction: 'Заполняю вопросы работодателя' });
      } else {
        const message = isMissingGroqKeyError(error)
          ? missingGroqMessage('test')
          : `Пропущено: Groq не подготовил безопасные ответы на вопросы работодателя: ${localizeError(error)}`;
        counters.skipped += 1;
        await appendResult({
          index: item.index,
          vacancyId: item.vacancyId,
          title: item.title,
          url: item.url,
          status: isMissingGroqKeyError(error) ? 'skipped_test_missing_groq_key' : 'skipped_test_ai_answer_unavailable',
          coverLetterUsed: false,
          testDetected: true,
          error: message
        });
        await setRunState({ state: 'applying', ...counters, lastError: message });
        closeDialog();
        return;
      }
    } finally {
      setBusyCursor(false);
    }

    if (await stopIfRequested(counters)) return;

    let selectedChoices = { selected: 0, labels: [] };
    if (questionControlGroups.length > 0) {
      await setRunState({ state: 'filling_cover_letter', ...counters, currentAction: 'Выбираю ответы на вопросы работодателя' });
      setBusyCursor(true);
      let choiceRetryError = '';
      try {
        selectedChoices = fillQuestionControls(questionControlGroups, assistance);
      } finally {
        setBusyCursor(false);
      }
      if (await stopIfRequested(counters)) return;
      let missingChoiceGroups = getUnselectedQuestionControlGroups(questionControlGroups);
      if (missingChoiceGroups.length > 0) {
        await appendAgentLog('question_choices_retry', {
          vacancyId: item.vacancyId,
          groups: missingChoiceGroups.length,
          missingGroups: missingChoiceGroups.map((group) => group.originalIndex + 1),
          reason: selectedChoices.selected === 0 ? 'no_matching_option_labels' : 'partial_matching_option_labels'
        });
        await setRunState({
          state: 'generating_cover_letter',
          ...counters,
          currentAction: 'ИИ: уточняю варианты ответов HH'
        });
        setBusyCursor(true);
        const previousAssistance = assistance;
        try {
          const choiceRetryAssistance = await generateChoiceRetryAssistance('', buildChoiceRetryContext(missingChoiceGroups), previousAssistance);
          const retryChoices = fillQuestionControls(missingChoiceGroups, choiceRetryAssistance);
          assistance = [choiceRetryAssistance, previousAssistance].filter(Boolean).join('\n');
          selectedChoices = {
            selected: selectedChoices.selected + retryChoices.selected,
            labels: [...selectedChoices.labels, ...retryChoices.labels]
          };
        } catch (error) {
          if (isStopRequestedError(error)) {
            await markStopped(counters);
            closeDialog();
            return;
          }
          if (isEmptyGroqResponseError(error)) {
            choiceRetryError = localizeError(error);
            await appendAgentLog('question_choices_retry_empty', {
              vacancyId: item.vacancyId,
              error: choiceRetryError
            });
            // Keep choices already selected from the initial AI answer.
          } else if (!isRecoverableGroqError(error)) {
            throw error;
          } else {
            const fallbackAssistance = await getFallbackQuestionAssistance(questionFields, missingChoiceGroups);
            const retryChoices = fillQuestionControls(missingChoiceGroups, fallbackAssistance);
            assistance = [fallbackAssistance, previousAssistance].filter(Boolean).join('\n');
            selectedChoices = {
              selected: selectedChoices.selected + retryChoices.selected,
              labels: [...selectedChoices.labels, ...retryChoices.labels]
            };
          }
        } finally {
          setBusyCursor(false);
        }
        if (await stopIfRequested(counters)) return;
      }
      await appendAgentLog('question_choices_applied', {
        vacancyId: item.vacancyId,
        title: item.title,
        url: item.url,
        groups: questionControlGroups.length,
        selected: selectedChoices.selected,
        labels: selectedChoices.labels.slice(0, 20),
        expectedOptions: selectedChoices.selected === 0 ? formatChoiceOptionSummary(questionControlGroups) : '',
        rejectedAnswerLength: selectedChoices.selected === 0 ? cleanText(assistance).length : 0,
        retryError: selectedChoices.selected === 0 ? choiceRetryError : ''
      });
      missingChoiceGroups = getUnselectedQuestionControlGroups(questionControlGroups);
      if (missingChoiceGroups.length > 0) {
        const fallbackChoices = await fillFallbackQuestionControls(missingChoiceGroups);
        selectedChoices = {
          selected: selectedChoices.selected + fallbackChoices.selected,
          labels: [...selectedChoices.labels, ...fallbackChoices.labels]
        };
        await appendAgentLog('question_choices_fallback_applied', {
          vacancyId: item.vacancyId,
          title: item.title,
          url: item.url,
          groups: missingChoiceGroups.length,
          missingGroups: missingChoiceGroups.map((group) => group.originalIndex + 1),
          selected: fallbackChoices.selected,
          labels: fallbackChoices.labels.slice(0, 20),
          expectedOptions: formatChoiceOptionSummary(missingChoiceGroups),
          rejectedAnswerLength: cleanText(assistance).length,
          retryError: choiceRetryError
        });
      }
      const missingChoiceGroupIndexes = validateSelectedQuestionControls(questionControlGroups);
      if (missingChoiceGroupIndexes.length > 0) {
        const message = `Пропущено: ответы на варианты HH не были выбраны (${missingChoiceGroupIndexes.join(', ')}).`;
        counters.skipped += 1;
        await appendResult({
          index: item.index,
          vacancyId: item.vacancyId,
          title: item.title,
          url: item.url,
          status: 'skipped_choice_fill_not_verified',
          coverLetterUsed: false,
          testDetected: true,
          error: message
        });
        await setRunState({ state: 'applying', ...counters, lastError: message });
        closeDialog();
        return;
      }
      await sleep(POST_FILL_SETTLE_MS);
      if (await stopIfRequested(counters)) return;
    }

    if (questionFields.length > 0) {
      if (await stopIfRequested(counters)) return;
      await setRunState({ state: 'filling_cover_letter', ...counters, currentAction: 'Заполняю вопросы работодателя' });
      setBusyCursor(true);
      let answers = await normalizeQuestionAnswers(splitGeneratedAnswers(assistance, questionFields.length), questionFields);
      let invalidReason = answers
        .map((answer, index) => getQuestionAnswerInvalidReason(answer, questionFields[index]))
        .find(Boolean);
      if (invalidReason) {
        await appendAgentLog('question_text_rejected_bad_answer', {
          vacancyId: item.vacancyId,
          error: invalidReason,
          fields: questionFields.length
        });
        setBusyCursor(false);
        counters.skipped += 1;
        await appendResult({
          index: item.index,
          vacancyId: item.vacancyId,
          title: item.title,
          url: item.url,
          status: 'skipped_bad_generated_answer',
          coverLetterUsed: false,
          testDetected: true,
          error: invalidReason
        });
        await setRunState({ state: 'applying', ...counters, lastError: invalidReason });
        closeDialog();
        return;
      }
      if (await stopIfRequested(counters)) return;
      try {
        questionFields.forEach((field, index) => {
          field.focus?.();
          setNativeValue(field, answers[index] || assistance);
        });
      } finally {
        setBusyCursor(false);
      }
      await appendAgentLog('question_text_fields_applied', {
        vacancyId: item.vacancyId,
        title: item.title,
        url: item.url,
        fields: questionFields.length,
        fieldTargets: questionFields.map((field) => getFieldLogTarget(field)),
        insertedTextLengths: questionFields.map((field) => cleanText(getFieldValue(field)).length),
        sourceAnswerLengths: answers.slice(0, questionFields.length).map((answer) => cleanText(answer).length),
        answerLengths: answers.slice(0, questionFields.length).map((answer) => String(answer || '').length)
      });
      await sleep(POST_FILL_SETTLE_MS);
      if (await stopIfRequested(counters)) return;
      const missingTextFields = validateFilledQuestionFields(questionFields, answers);
      if (missingTextFields.length > 0) {
        const message = `Пропущено: ответы HH не записались в поля (${missingTextFields.join(', ')}).`;
        await appendAgentLog('question_text_fields_not_verified', {
          vacancyId: item.vacancyId,
          fields: questionFields.length,
          missing: missingTextFields,
          actualLengths: questionFields.map((field) => cleanText(getFieldValue(field)).length)
        });
        counters.skipped += 1;
        await appendResult({
          index: item.index,
          vacancyId: item.vacancyId,
          title: item.title,
          url: item.url,
          status: 'skipped_text_fill_not_verified',
          coverLetterUsed: false,
          testDetected: true,
          error: message
        });
        await setRunState({ state: 'applying', ...counters, lastError: message });
        closeDialog();
        return;
      }
    }

    await appendAgentLog('question_test_answers_applied', {
      vacancyId: item.vacancyId,
      title: item.title,
      url: item.url,
      assistance,
      answers: buildQuestionAnswerAudit(questionFields, questionControlGroups, selectedChoices)
    });

    if (coverLetterTextarea && !cleanText(getFieldValue(coverLetterTextarea))) {
      let letter;
      await setRunState({
        state: 'generating_cover_letter',
        ...counters,
        currentAction: 'ИИ: готовлю обязательное сопроводительное письмо'
      });
      setBusyCursor(true);
      try {
        if (/скопируйте|сопроводительное письмо|пронумерованные вопросы|ответьте,?\s+пожалуйста/i.test(questionContext)) {
          letter = await buildNumberedCoverLetterAnswers(questionContext)
            || assistance;
        } else {
          letter = await generateCoverLetter(vacancyText);
        }
      } catch (error) {
        if (isStopRequestedError(error)) {
          await markStopped(counters);
          closeDialog();
          return;
        }
        if (!isMissingGroqKeyError(error) && !isRecoverableGroqError(error)) {
          throw error;
        }
        const fallbackContext = [vacancyText, questionContext, assistance].map(cleanText).filter(Boolean).join('\n');
        letter = /скопируйте|сопроводительное письмо|пронумерованные вопросы|ответьте,?\s+пожалуйста/i.test(questionContext)
          ? (await buildNumberedCoverLetterAnswers(questionContext) || assistance)
          : await getFallbackCoverLetter(fallbackContext);
      } finally {
        setBusyCursor(false);
      }

      if (await stopIfRequested(counters)) return;

      const fallbackContext = [vacancyText, questionContext, assistance, letter].map(cleanText).filter(Boolean).join('\n');
      const sanitizedLetter = await sanitizeCoverLetterDraft(letter, () => getFallbackCoverLetter(fallbackContext), { allowStructuredAnswers: true });
      if (sanitizedLetter.fallbackUsed) {
        await appendAgentLog('mandatory_cover_letter_fallback_after_bad_text', {
          vacancyId: item.vacancyId,
          reason: sanitizedLetter.reason,
          rejectedTextLength: cleanText(letter).length
        });
        letter = sanitizedLetter.text;
      }

      await setRunState({ state: 'filling_cover_letter', ...counters, currentAction: 'Заполняю обязательное сопроводительное письмо' });
      setBusyCursor(true);
      setNativeValue(coverLetterTextarea, letter);
      setBusyCursor(false);
      coverLetterUsed = true;
      await sleep(POST_FILL_SETTLE_MS);
      if (await stopIfRequested(counters)) return;
      await appendAgentLog('mandatory_cover_letter_applied', {
        vacancyId: item.vacancyId,
        title: item.title,
        url: item.url,
        field: getFieldLogTarget(coverLetterTextarea),
        fieldLength: cleanText(getFieldValue(coverLetterTextarea)).length,
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
    const beforeSubmitText = textOf(document.body);
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
  clickWithActionCursor(submitButton);
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

    counters.applied += 1;
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
      currentAction: 'ИИ: готовлю сопроводительное письмо'
    });
    const vacancyText = getVacancyText(item.card) || getVacancyText(document);
    let letter;
    setBusyCursor(true);
    try {
      letter = await generateCoverLetter(vacancyText);
    } catch (error) {
      if (isStopRequestedError(error)) {
        await markStopped(counters);
        closeDialog();
        return;
      }
      if (!isMissingGroqKeyError(error) && !isRecoverableGroqError(error)) {
        throw error;
      }

      if (isRecoverableGroqError(error)) {
        letter = await getFallbackCoverLetter(vacancyText);
      } else {
        const message = missingGroqMessage('cover');
        counters.skipped += 1;
        await appendResult({
          index: item.index,
          vacancyId: item.vacancyId,
          title: item.title,
          url: item.url,
          status: 'skipped_missing_groq_key',
          coverLetterUsed: false,
          testDetected: false,
          error: message
        });
        await setRunState({ state: 'applying', ...counters, lastError: message });
        closeDialog();
        return;
      }
    } finally {
      setBusyCursor(false);
    }

    if (await stopIfRequested(counters)) return;

    await setRunState({ state: 'filling_cover_letter', ...counters, currentAction: 'Заполняю сопроводительное письмо' });
    setBusyCursor(true);
    textarea.focus?.();
    setNativeValue(textarea, letter);
    setBusyCursor(false);
    coverLetterUsed = true;
    await sleep(500);
    if (await stopIfRequested(counters)) return;
    await appendAgentLog('cover_letter_applied', {
      vacancyId: item.vacancyId,
      title: item.title,
      url: item.url,
      field: getFieldLogTarget(textarea),
      fieldLength: cleanText(getFieldValue(textarea)).length,
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
  const beforeSubmitText = textOf(document.body);
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
  clickWithActionCursor(submitButton);
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

  counters.applied += 1;
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
    title: queueItem.title || cleanText(document.querySelector('h1')?.textContent) || document.title || 'Отклик на вакансию',
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
  const title = cleanText(document.querySelector('h1')?.textContent) || queueItem.title || document.title || 'Вакансия';
  return {
    index: queueItem.index,
    vacancyId: queueItem.vacancyId || getVacancyId(location.href),
    title,
    url: queueItem.url || location.href,
    responseUrl: queueItem.responseUrl || '',
    card: document,
    responseButton: findEnabledClickableByText(document, [/откликнуться/i]) || findClickableByText(document, [/откликнуться/i]),
    responseFormOpen: false,
    cardText: getVacancyText(),
    testDetected: queueItem.testDetected || /тест|задани[ея]|ответьте на вопросы|вопрос/i.test(textOf(document.body))
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

function getNextSearchPageUrl() {
  const selectorLink = queryFirst(HH_SELECTORS.nextPageLinks);
  if (selectorLink?.href && !isDisabled(selectorLink)) {
    return selectorLink.href;
  }

  const textLink = findEnabledClickableByText(document, [/дальше/i, /следующ/i, /^>$/, /^›$/, /^→$/]);
  if (textLink?.href) {
    return textLink.href;
  }

  const current = new URL(location.href);
  const currentPage = Number(current.searchParams.get('page') || 0);
  const pageLinks = queryAll(['a[href*="page="]'])
    .map((link) => {
      try {
        const url = new URL(link.href, location.href);
        return {
          url,
          page: Number(url.searchParams.get('page')),
          link
        };
      } catch {
        return null;
      }
    })
    .filter((item) => item && Number.isFinite(item.page) && item.page > currentPage && !isDisabled(item.link))
    .sort((a, b) => a.page - b.page);

  return pageLinks[0]?.url.href || '';
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
  if (await stopIfRequested(counters)) return true;

  try {
    const outcome = await applyToVacancy(item, counters);
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
      const outcome = await applyToVacancy(item, counters);
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
  globalThis.HHJA_CONFIG_READINESS.assertReady(await getConfig());
  if (['complete', 'dry_run_complete', 'stopped', 'idle', 'error'].includes(runState?.state)) {
    await saveSearchQueue({ active: false });
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
  activeRunId = autoApplySearchQueue.runId || `${Date.now()}:${Math.random().toString(16).slice(2)}`;
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

async function startRun(mode, limitOverride = null, options = {}) {
  const config = await getConfig();
  globalThis.HHJA_CONFIG_READINESS.assertReady(config);
  const limitSource = limitOverride == null ? config.dailyLimit : limitOverride;
  const limit = Math.max(1, Math.min(Number(limitSource) || 20, 200));
  const maxProcessed = normalizeMaxProcessed(options.maxProcessed);
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
  await storageSet({
    runResults: [],
    autoApplyQueue: { active: false },
    autoApplySearchQueue: { active: false },
    autoApplyPendingSubmit: null
  });
  await setRunState({
    state: 'scanning',
    found: 0,
    processed: 0,
    applied: 0,
    skipped: 0,
    errors: 0,
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
  return handleAutoApply(limit, null, [], { maxProcessed });
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

  await storageSet({ autoApplyStopBeforeSubmit: true }, { optional: true });
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
    await startRun(mode === 'dry' ? 'dry' : 'live', limit, { maxProcessed });
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
        sendResponse(await startRun('dry', message.limitOverride ?? null, { maxProcessed: message.maxProcessed }));
        break;
      case 'START_AUTO_APPLY':
        sendResponse(await startRun('live', message.limitOverride ?? null, { maxProcessed: message.maxProcessed }));
        break;
      case 'CONTINUE_AUTO_APPLY':
        sendResponse(await continueSavedAutoApply());
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
    await startRun(mode);
  } catch (error) {
    const messageText = localizeError(error);
    await appendAgentLog('page_trigger_error', { event: 'start-auto-apply', error: messageText, url: location.href });
    await setRunState({ state: 'error', lastError: messageText });
  }
});

async function initializeContentScript() {
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
