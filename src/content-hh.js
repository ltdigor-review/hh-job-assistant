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
    'textarea'
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
  chatItems: [
    '[data-qa="chat-list-item"]',
    '[data-qa*="chat-item"]',
    'a[href*="/chat"]',
    '[role="listitem"]'
  ],
  chatMessageInput: [
    '[data-qa="chat-message-input"] textarea',
    '[data-qa="chat-message-input"] [contenteditable="true"]',
    'textarea',
    '[contenteditable="true"]',
    '[role="textbox"]'
  ],
  chatSendButtons: [
    '[data-qa="chat-send-message"]',
    '[data-qa*="send"]',
    'button'
  ],
  nextPageLinks: [
    'a[data-qa="pager-next"]',
    '[data-qa="pager-next"] a',
    'a[rel="next"]'
  ]
};

const CLICK_DELAY_MIN_MS = 500;
const CLICK_DELAY_MAX_MS = 1200;
const RUNTIME_MESSAGE_TIMEOUT_MS = 45000;
const AUTO_APPLY_FLOW_VERSION = 'list-click-return-v12';
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
  return withExtensionContext(() => chrome.storage.local.get(keys), options) || {};
}

async function storageSet(value, options = {}) {
  return withExtensionContext(() => chrome.storage.local.set(value), options);
}

function sleep(ms) {
  if (window.__HH_JOB_ASSISTANT_TEST_FAST_CLICKS__) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function waitBeforeClick() {
  if (window.__HH_JOB_ASSISTANT_TEST_FAST_CLICKS__) return;
  await sleep(randomDelay(CLICK_DELAY_MIN_MS, CLICK_DELAY_MAX_MS));
}

function getVacancyId(url) {
  return String(url || '').match(/\/vacancy\/(\d+)/)?.[1] || new URL(String(url || location.href), location.href).searchParams.get('vacancyId') || '';
}

function navigateTo(url) {
  if (window.__HH_JOB_ASSISTANT_TEST_NAVIGATE__) {
    window.__HH_JOB_ASSISTANT_TEST_NAVIGATE__(url);
    return;
  }
  location.href = url;
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
    'a[href*="/chat"]',
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

function getCardInfo(card, index) {
  const titleLink = queryFirst(HH_SELECTORS.titleLinks, card) || card.querySelector('a[href*="/vacancy/"]');
  const responseButton =
    queryAll(HH_SELECTORS.responseButtons, card).find((node) => /откликнуться/i.test(textOf(node))) ||
    findClickableByText(card, [/откликнуться/i]);
  const href = titleLink?.href || card.querySelector('a[href*="/vacancy/"]')?.href || location.href;
  const title = textOf(titleLink) || textOf(card).split('\n').find(Boolean) || document.title;

  return {
    index: index + 1,
    vacancyId: getVacancyId(href),
    title,
    url: href,
    responseUrl: /\/applicant\/vacancy_response/.test(responseButton?.href || '') ? responseButton.href : '',
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

  function normalizeVacancyCardNode(node) {
    let current = node;
    while (current && current !== document && current !== document.body) {
      if (hasVacancyLink(current)) {
        return current;
      }
      current = current.parentElement;
    }
    return hasVacancyLink(node) ? node : null;
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
  return textOf(node).slice(0, 12000);
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

function isAlreadyAppliedPage(root = document) {
  return /вы откликнулись|отклик отправлен|отклик успешно|отклик на вакансию отправлен/i.test(
    textOf(root) || textOf(root.body)
  );
}

function findTextarea(root = getDialogRoot()) {
  return queryFirst(HH_SELECTORS.textareas, root);
}

function getFieldMarker(field) {
  const name = field.getAttribute('name') || '';
  const dataQa = field.getAttribute('data-qa') || '';
  const placeholder = field.getAttribute('placeholder') || '';
  const label = typeof field.closest === 'function' ? field.closest('label') : null;
  const nearText = textOf(label || field.parentElement || field);
  return `${name}\n${dataQa}\n${placeholder}\n${nearText}`;
}

function findCoverLetterTextarea(root = getDialogRoot()) {
  return [...root.querySelectorAll('textarea,input:not([type="hidden"]),[contenteditable="true"]')]
    .filter(isVisible)
    .find((field) => /letter|cover|сопровод/i.test(getFieldMarker(field)));
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

function getOptionLabel(control) {
  const label = typeof control.closest === 'function' ? control.closest('label') : null;
  const ariaLabel = control.getAttribute?.('aria-label') || '';
  const marker = textOf(label || control.parentElement || control);
  const value = control.value || control.getAttribute?.('value') || '';
  return cleanText([...new Set([ariaLabel, marker, marker ? '' : value].map(cleanText).filter(Boolean))].join('\n'));
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
    .filter((option) => option.label && !/letter|cover|сопровод/i.test(option.label));

  const byGroup = new Map();
  for (const option of controls) {
    const group = byGroup.get(option.groupKey) || {
      type: option.type,
      key: option.groupKey,
      question: cleanText(option.groupKey.replace(/^(checkbox|radio):/, '')),
      options: []
    };
    group.options.push(option);
    byGroup.set(option.groupKey, group);
  }

  return [...byGroup.values()].filter((group) => group.options.length > 0);
}

function buildEmployerQuestionContext(root, questionFields, questionControlGroups) {
  const sections = [];
  const pageText = cleanText(textOf(root)).slice(0, 5000);
  if (pageText) {
    sections.push(['Visible HH response form text:', pageText].join('\n'));
  }

  if (questionFields.length > 0) {
    sections.push(
      [
        'Open text questions:',
        ...questionFields.map((field, index) => {
          const marker = cleanText(getFieldMarker(field)).slice(0, 600);
          return `Text question ${index + 1}: ${marker || 'question text not found'}`;
        })
      ].join('\n')
    );
  }

  if (questionControlGroups.length > 0) {
    sections.push(
      [
        'Choice questions. Return exact option labels for these groups:',
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

  return sections.join('\n\n').slice(0, 8000);
}

function findSubmitButton(root = getDialogRoot()) {
  return (
    queryAll(HH_SELECTORS.submitButtons, root)
      .filter((button) => !isDisabled(button))
      .find((button) => /отправить|откликнуться|продолжить/i.test(textOf(button))) ||
    findEnabledClickableByText(root, [/отправить/i, /откликнуться/i, /продолжить/i])
  );
}

function hasSubmitControl(root = getDialogRoot()) {
  return queryAll(HH_SELECTORS.submitButtons, root).some((button) => /отправить|откликнуться|продолжить/i.test(textOf(button)));
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
  await setRunState({ state: 'submitting', ...counters });
  await waitBeforeClick();
  confirmButton.click();
  await sleep(window.__HH_JOB_ASSISTANT_TEST_FAST_CLICKS__ ? 0 : 1800);
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
  if (!options.timeoutMs) {
    return response;
  }
  return withTimeout(response, options.timeoutMs, options.timeoutMessage || 'Ответ расширения не получен вовремя.');
}

async function setRunState(patch) {
  const terminalStates = new Set(['complete', 'idle', 'dry_run_complete', 'stopped', 'paused']);
  const nextPatch = { ...(patch || {}) };
  if (terminalStates.has(nextPatch.state) && !Object.prototype.hasOwnProperty.call(nextPatch, 'currentAction')) {
    nextPatch.currentAction = '';
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
      /^(scanning|applying|waiting_for_dialog|generating_cover_letter|filling_cover_letter|submitting|refreshing_resumes|scanning_chat|processing_chat|generating_chat_reply|sending_chat_reply)$/.test(
        nextState
      )
    );
  }
  await withExtensionContext(() => chrome.runtime.sendMessage({ type: 'SET_RUN_STATE', patch: nextPatch }), { optional: true });
}

async function appendResult(item) {
  await withExtensionContext(() => chrome.runtime.sendMessage({ type: 'APPEND_RUN_RESULT', item }), { optional: true });
}

async function savePendingSubmit({ item, counters, status, coverLetterUsed, testDetected }) {
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
      sourceUrl: location.href
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

async function verifySubmitConfirmed({ item, counters, status, coverLetterUsed, testDetected }) {
  const root = getDialogRoot();
  const followupConfirmButton = findFollowupConfirmButton(root);
  if (followupConfirmButton) {
    await clickFollowupConfirmButton(followupConfirmButton, counters);
    return true;
  }

  const blockedReason = detectBlockedResponseReason(root);
  if (blockedReason) {
    await clearPendingSubmit();
    await appendSkippedResponse(item, counters, 'skipped_response_unavailable', blockedReason);
    return false;
  }

  if (isAlreadyAppliedPage(root) || isAlreadyAppliedPage(document)) {
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

  if (root !== document && hasSubmitControl(root)) {
    await clearPendingSubmit();
    await appendSkippedResponse(
      item,
      counters,
      'skipped_submit_not_confirmed',
      'HH response dialog stayed open after submit; response was not confirmed.'
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
  if (autoApplyQueue?.active && autoApplyQueue.returnToSearch && isHhSearchPageUrl(autoApplyQueue.sourceUrl)) {
    const nextIndex = (Number(autoApplyQueue.index) || 0) + 1;
    await saveQueue({ ...autoApplyQueue, active: false, index: nextIndex, counters });
    await saveSearchQueue({
      active: true,
      runId: autoApplyQueue.runId || autoApplyPendingSubmit.runId || activeRunId,
      limit: autoApplyQueue.limit || 20,
      counters,
      config: autoApplyQueue.config,
      maxProcessed: autoApplyQueue.maxProcessed || null,
      processedVacancyIds: autoApplyQueue.processedVacancyIds || []
    });
    await setRunState({ state: 'applying', ...counters, currentAction: 'Возвращаюсь на страницу поиска HH', lastError: '' });
    navigateTo(autoApplyQueue.sourceUrl);
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

async function appendChatReport(item) {
  await withExtensionContext(() => chrome.runtime.sendMessage({ type: 'APPEND_CHAT_REPORT', item }), { optional: true });
}

async function getConfig() {
  const values = await storageGet([
    'dailyLimit',
    'delayMinMs',
    'delayMaxMs',
    'runResults',
    'chatUnreadOnly',
    'chatReplyMode',
    'chatLimit'
  ]);
  return {
    dailyLimit: Number(values.dailyLimit) || DEFAULTS.dailyLimit,
    delayMinMs: Number(values.delayMinMs) || DEFAULTS.delayMinMs,
    delayMaxMs: Number(values.delayMaxMs) || DEFAULTS.delayMaxMs,
    chatUnreadOnly: values.chatUnreadOnly !== false,
    chatReplyMode: values.chatReplyMode === 'auto_send' ? 'auto_send' : DEFAULTS.chatReplyMode,
    chatLimit: Math.max(1, Math.min(Number(values.chatLimit) || DEFAULTS.chatLimit, 100))
  };
}

async function generateCoverLetter(vacancyText) {
  const response = await sendRuntimeMessage({
    type: 'GENERATE_COVER_LETTER',
    task: 'cover_letter',
    vacancyText
  }, {
    timeoutMs: getRuntimeMessageTimeoutMs(),
    timeoutMessage: 'Запрос сопроводительного письма Groq не уложился во время.'
  });
  if (!response?.ok) {
    throw new Error(localizeError(response?.error, 'Не удалось сгенерировать сопроводительное письмо'));
  }
  return sanitizeGeneratedText(response.text);
}

function isMissingGroqKeyError(error) {
  return /groq api key is not configured|ключ groq api не настроен/i.test(error instanceof Error ? error.message : String(error));
}

function isRecoverableGroqError(error) {
  return /groq request failed: 429|groq .*timed out|rate limit|запрос groq завершился ошибкой: 429|запрос groq не уложился|запрос .* groq не уложился|groq временно ограничил запросы/i.test(error instanceof Error ? error.message : String(error));
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
    timeoutMessage: 'Запрос помощи с вопросами Groq не уложился во время.'
  });
  if (!response?.ok) {
    throw new Error(localizeError(response?.error, 'Не удалось подготовить ответы на вопросы работодателя'));
  }
  return sanitizeGeneratedText(response.text);
}

async function generateChoiceRetryAssistance(vacancyText, questionContext, previousAnswer) {
  return generateTestAssistance(
    vacancyText,
    [
      questionContext,
      '',
      'Previous answer did not match any available HH choice labels. Return only exact option labels from the listed Choice groups.',
      'Format:',
      'Choice group 1: <exact option label>',
      'Choice group 2: <exact option label>',
      '',
      'Previous answer:',
      previousAnswer
    ].join('\n')
  );
}

async function generateChatReply({ vacancyUrl, vacancyText, chatText }) {
  const response = await sendRuntimeMessage({
    type: 'GENERATE_CHAT_REPLY',
    vacancyUrl,
    vacancyText,
    chatText
  }, {
    timeoutMs: getRuntimeMessageTimeoutMs(),
    timeoutMessage: 'Запрос ответа в чат Groq не уложился во время.'
  });
  if (!response?.ok) {
    throw new Error(localizeError(response?.error, 'Не удалось сгенерировать ответ в чат'));
  }
  return sanitizeGeneratedText(response.text);
}

async function getExpectedSalary() {
  const { expectedSalary = '' } = await storageGet(['expectedSalary']);
  return String(expectedSalary || '').trim();
}

async function getFallbackCoverLetter() {
  return 'Здравствуйте! Заинтересовала ваша вакансия. Имею релевантный опыт в разработке и управлении IT-продуктами, готов обсудить задачи и пользу для команды.';
}

async function getFallbackQuestionAssistance(questionFields, questionControlGroups) {
  const expectedSalary = await getExpectedSalary();
  const textAnswer = expectedSalary || 'Готов обсудить детали и выполнить требования вакансии.';
  const lines = [];
  questionControlGroups.forEach((group, index) => {
    const positiveOption =
      group.options.find((option) => /да|готов|готова|соглас|можно|full|полная|удален|remote/i.test(option.label)) ||
      group.options.find((option) => !/нет|не готов|не готова|no\b/i.test(option.label)) ||
      group.options[0];
    if (positiveOption?.label) {
      lines.push(`Choice group ${index + 1}: ${positiveOption.label}`);
    }
  });
  questionFields.forEach((_, index) => {
    lines.push(`Text question ${index + 1}: ${textAnswer}`);
  });
  return lines.join('\n') || textAnswer;
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
    const groupAnswer = extractGroupAnswer(answerText, group, index);
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

function getChatUrl(value = location.href) {
  try {
    return new URL(value || location.href, location.href).href;
  } catch {
    return location.href;
  }
}

function isUnreadChatItem(node) {
  const marker = [
    textOf(node),
    node?.getAttribute?.('aria-label') || '',
    node?.getAttribute?.('class') || '',
    node?.getAttribute?.('data-qa') || ''
  ].join('\n');

  if (/непрочитан|unread|новое сообщение/i.test(marker)) return true;
  if (node?.querySelector?.('[data-qa*="unread"], [class*="unread"]')) return true;
  return Boolean([...(node.querySelectorAll?.('*') || [])].find((child) => /непрочитан|unread/i.test(
    `${child.getAttribute?.('aria-label') || ''}\n${child.getAttribute?.('class') || ''}\n${textOf(child)}`
  )));
}

function getChatItemNodes() {
  const nodes = queryAll(HH_SELECTORS.chatItems).filter((node) => /\/chat|чат|сообщени|message|отклик/i.test(
    `${node.href || ''}\n${textOf(node)}`
  ));
  const seen = new Set();
  return nodes.filter((node) => {
    const key = node.href || textOf(node).slice(0, 120);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getChatItemInfo(node, index) {
  const text = textOf(node);
  const vacancyLink = node.querySelector?.('a[href*="/vacancy/"]') || (/\/vacancy\//.test(node.href || '') ? node : null);
  const href = node.href || node.querySelector?.('a[href*="/chat"]')?.href || location.href;
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);

  return {
    index: index + 1,
    node,
    chatUrl: getChatUrl(href),
    employerName: lines[0] || '',
    vacancyTitle: lines.find((line) => /developer|разработчик|инженер|manager|менеджер|аналитик/i.test(line)) || '',
    vacancyUrl: vacancyLink?.href || '',
    previewText: text,
    unread: isUnreadChatItem(node)
  };
}

async function openChatItem(item) {
  item.node.scrollIntoView?.({ block: 'center', inline: 'center' });
  await sleep(250);
  await waitBeforeClick();
  const beforeUrl = location.href;
  item.node.click?.();
  await sleep(1000);
  return getChatUrl(location.href === beforeUrl ? item.chatUrl : location.href);
}

function getCurrentChatText() {
  const main = document.querySelector('main') || document.body;
  return textOf(main).slice(0, 12000);
}

function getCurrentChatMeta(fallback = {}) {
  const chatText = getCurrentChatText();
  const vacancyLink = document.querySelector('a[href*="/vacancy/"]');
  const heading = cleanText(document.querySelector('h1')?.textContent || '');
  const lines = chatText.split('\n').map((line) => line.trim()).filter(Boolean);

  return {
    chatUrl: getChatUrl(location.href || fallback.chatUrl),
    employerName: fallback.employerName || heading || lines[0] || '',
    vacancyTitle: fallback.vacancyTitle || textOf(vacancyLink) || lines.find((line) => /ваканси|developer|разработчик|инженер/i.test(line)) || '',
    vacancyUrl: fallback.vacancyUrl || vacancyLink?.href || '',
    chatText
  };
}

function detectExternalContactInvite(text) {
  const cleaned = cleanText(text);
  const patterns = [
    { type: 'phone', pattern: /(?:\+?\d[\d\s().-]{7,}\d)|позвон|созвон|звонк/i },
    { type: 'telegram', pattern: /telegram|телеграм|@\w{4,}|t\.me\//i },
    { type: 'whatsapp', pattern: /whats?app|вацап|ватсап/i },
    { type: 'email', pattern: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i },
    { type: 'external_link', pattern: /напишите\s+в|перейдите|свяжитесь|zoom|meet\.google|skype|discord|slack/i }
  ];
  const hit = patterns.find(({ pattern }) => pattern.test(cleaned));
  if (!hit) return null;

  const lines = cleaned.split('\n').filter(Boolean);
  const contactLine = lines.find((line) => hit.pattern.test(line)) || lines.at(-1) || cleaned;
  return {
    contactType: hit.type,
    contactText: contactLine.slice(0, 1000)
  };
}

function findChatInput() {
  return queryFirst(HH_SELECTORS.chatMessageInput);
}

function findChatSendButton() {
  return (
    queryAll(HH_SELECTORS.chatSendButtons)
      .filter((button) => !isDisabled(button))
      .find((button) => /отправить|send/i.test(textOf(button))) ||
    findEnabledClickableByText(document, [/отправить/i, /send/i])
  );
}

function fillChatInput(input, text) {
  if (input.getAttribute?.('contenteditable') === 'true' || input.isContentEditable) {
    input.textContent = text;
    input.innerText = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }

  setNativeValue(input, text);
}

async function processChatItem(item, config, counters) {
  await setRunState({ state: 'processing_chat', ...counters, currentAction: `Чат: ${item.employerName || item.index}` });
  const openedChatUrl = await openChatItem(item);
  if (isUnsafePage()) {
    throw new Error('Обнаружена страница входа, captcha или антибот-проверка');
  }

  const meta = getCurrentChatMeta({ ...item, chatUrl: openedChatUrl });
  const invite = detectExternalContactInvite(meta.chatText);
  if (invite) {
    counters.skipped += 1;
    await appendChatReport({
      chatUrl: meta.chatUrl,
      employerName: meta.employerName,
      vacancyTitle: meta.vacancyTitle,
      vacancyUrl: meta.vacancyUrl,
      status: 'reported_external_contact',
      reason: 'external_contact_or_call_invite',
      contactType: invite.contactType,
      contactText: invite.contactText,
      questionText: meta.chatText,
      sent: false
    });
    return;
  }

  const input = findChatInput();
  if (!input) {
    counters.skipped += 1;
    await appendChatReport({
      chatUrl: meta.chatUrl,
      employerName: meta.employerName,
      vacancyTitle: meta.vacancyTitle,
      vacancyUrl: meta.vacancyUrl,
      status: 'skipped_no_input',
      reason: 'message_input_not_found',
      questionText: meta.chatText,
      sent: false
    });
    return;
  }

  await setRunState({ state: 'generating_chat_reply', ...counters });
  const draftAnswer = await generateChatReply({
    vacancyUrl: meta.vacancyUrl,
    vacancyText: '',
    chatText: meta.chatText
  });
  const invalidDraftReason = getGeneratedTextInvalidReason(draftAnswer, { minLength: 10 });
  if (invalidDraftReason) {
    counters.skipped += 1;
    await appendChatReport({
      chatUrl: meta.chatUrl,
      employerName: meta.employerName,
      vacancyTitle: meta.vacancyTitle,
      vacancyUrl: meta.vacancyUrl,
      status: 'skipped_bad_generated_reply',
      reason: invalidDraftReason,
      questionText: meta.chatText,
      draftAnswer,
      sent: false
    });
    return;
  }
  fillChatInput(input, draftAnswer);
  await sleep(500);

  let sent = false;
  if (config.chatReplyMode === 'auto_send') {
    const sendButton = findChatSendButton();
    if (!sendButton) {
      throw new Error('Кнопка отправки сообщения в чате не найдена');
    }
    await setRunState({ state: 'sending_chat_reply', ...counters });
    await waitBeforeClick();
    sendButton.click();
    sent = true;
    await sleep(800);
  }

  counters.applied += 1;
  await appendChatReport({
    chatUrl: meta.chatUrl,
    employerName: meta.employerName,
    vacancyTitle: meta.vacancyTitle,
    vacancyUrl: meta.vacancyUrl,
    status: sent ? 'sent' : 'drafted',
    reason: sent ? 'auto_sent_reply' : 'draft_reply',
    questionText: meta.chatText,
    draftAnswer,
    sent
  });
}

async function handleChatAssist() {
  if (isUnsafePage()) {
    throw new Error('Обнаружена страница входа, captcha или антибот-проверка');
  }
  requireAuthenticatedHhPage();

  if (location.pathname !== '/chat') {
    navigateTo('https://hh.ru/chat');
    return { ok: true, navigated: true };
  }

  const config = await getConfig();
  const allItems = getChatItemNodes().map(getChatItemInfo);
  const items = allItems
    .filter((item) => !config.chatUnreadOnly || item.unread)
    .slice(0, config.chatLimit);
  const counters = {
    found: items.length,
    processed: 0,
    applied: 0,
    skipped: 0,
    errors: 0
  };

  await setRunState({ state: 'scanning_chat', ...counters, currentAction: 'Проверяю чат', lastError: '' });

  for (const item of items) {
    if (stopRequested) break;
    counters.processed += 1;
    try {
      await processChatItem(item, config, counters);
    } catch (error) {
      const message = localizeError(error);
      counters.errors += 1;
      await appendChatReport({
        chatUrl: item.chatUrl,
        employerName: item.employerName,
        vacancyTitle: item.vacancyTitle,
        vacancyUrl: item.vacancyUrl,
        status: 'error',
        reason: 'chat_processing_error',
        questionText: item.previewText,
        sent: false,
        error: message
      });
      await setRunState({ state: 'error', ...counters, lastError: message });
      stopRequested = true;
      break;
    }

    await setRunState({ state: stopRequested ? 'stopped' : 'processing_chat', ...counters });
    if (!stopRequested) {
      await sleep(randomDelay(config.delayMinMs, config.delayMaxMs));
    }
  }

  const finalState = stopRequested ? 'stopped' : 'complete';
  await setRunState({ state: finalState, ...counters, currentAction: stopRequested ? 'Остановлено' : 'Чат обработан' });
  return { ok: true, ...counters };
}

async function waitForDialogOrChange(previousText, timeoutMs = 7000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const root = getDialogRoot();
    const currentText = getRootText(root);
    if (root !== document && currentText) return root;
    if (
      currentText &&
      currentText !== previousText &&
      /отправить|сопровод|тест|отклик|ответить|ответьте|вопрос|работодател/i.test(currentText)
    ) {
      return root;
    }
    if (isResponseFormPage() || findQuestionFields(document).length > 0 || findQuestionControlGroups(document).length > 0) {
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
  if (item.responseFormOpen && isAlreadyAppliedPage(document)) {
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

  if (isAlreadyAppliedPage(item.card)) {
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

  if (!item.responseButton) {
    const blockedReason = detectBlockedResponseReason(document);
    if (blockedReason) {
      await appendSkippedResponse(item, counters, 'skipped_response_unavailable', blockedReason);
    } else {
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
  if (item.responseFormOpen) {
    root = document;
  } else {
    await setRunState({
      state: 'waiting_for_dialog',
      ...counters,
      currentAction: `Открываю форму отклика: ${item.title || item.vacancyId || 'вакансия'}`
    });
    const beforeText = textOf(document.body);
    const beforeUrl = location.href;
    if (item.navigationQueue) {
      await saveQueue(item.navigationQueue);
    }
    item.responseButton.scrollIntoView({ block: 'center', inline: 'center' });
    await sleep(250);
    await waitBeforeClick();
    if (isUnsafeHhUrl(item.responseButton.href)) {
      throw new Error('Перед нажатием отклика обнаружена страница входа или регистрации');
    }
    prepareResponseButtonForCurrentTab(item.responseButton);
    item.responseButton.click();

    root = await waitForDialogOrChange(beforeText);
    if (item.navigationQueue && root === document && location.href === beforeUrl && !isResponseFormPage()) {
      root = await waitForNavigationQueueSettle(beforeUrl, root);
    }
    if (item.navigationQueue && location.href === beforeUrl && !isResponseFormPage()) {
      await saveQueue({ active: false });
    }
    await setRunState({ state: 'applying', ...counters, currentAction: `Проверяю форму отклика: ${item.title || item.vacancyId || 'вакансия'}` });
    await sleep(700);
    root = await confirmInitialFollowupIfNeeded(root, beforeText, counters);
  }

  if (isUnsafePage()) {
    throw new Error('После нажатия обнаружена страница входа, captcha или антибот-проверка');
  }

  if (isAlreadyAppliedPage(root)) {
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

  const initialQuestionFields = findQuestionFields(root);
  const initialQuestionControlGroups = findQuestionControlGroups(root);
  if (detectTest(root) || initialQuestionFields.length > 0 || initialQuestionControlGroups.length > 0) {
    const questionFields = findQuestionFields(root);
    const questionControlGroups = findQuestionControlGroups(root);
    const coverLetterTextarea = findCoverLetterTextarea(root);
    const questionContext = buildEmployerQuestionContext(root, questionFields, questionControlGroups);
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
        contextLength: questionContext.length
      });
      assistance = await generateTestAssistance(getVacancyText(item.card), questionContext || textOf(root));
    } catch (error) {
      if (!isMissingGroqKeyError(error) && !isRecoverableGroqError(error)) {
        throw error;
      }

      assistance = isRecoverableGroqError(error)
        ? await getFallbackQuestionAssistance(questionFields, questionControlGroups)
        : questionFields.length > 0 && questionControlGroups.length === 0
          ? await getExpectedSalary()
          : '';
      if (assistance) {
        await setRunState({ state: 'filling_cover_letter', ...counters, currentAction: 'Заполняю вопросы работодателя' });
      } else {
        const message = missingGroqMessage('test');
        counters.skipped += 1;
        await appendResult({
          index: item.index,
          vacancyId: item.vacancyId,
          title: item.title,
          url: item.url,
          status: 'skipped_test_missing_groq_key',
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

    if (questionControlGroups.length > 0) {
      await setRunState({ state: 'filling_cover_letter', ...counters, currentAction: 'Выбираю ответы на вопросы работодателя' });
      setBusyCursor(true);
      let selectedChoices = { selected: 0, labels: [] };
      try {
        selectedChoices = fillQuestionControls(questionControlGroups, assistance);
      } finally {
        setBusyCursor(false);
      }
      if (selectedChoices.selected === 0) {
        await appendAgentLog('question_choices_retry', {
          vacancyId: item.vacancyId,
          groups: questionControlGroups.length,
          reason: 'no_matching_option_labels'
        });
        await setRunState({
          state: 'generating_cover_letter',
          ...counters,
          currentAction: 'ИИ: уточняю варианты ответов HH'
        });
        setBusyCursor(true);
        try {
          assistance = await generateChoiceRetryAssistance(getVacancyText(item.card), questionContext, assistance);
          selectedChoices = fillQuestionControls(questionControlGroups, assistance);
        } catch (error) {
          if (!isRecoverableGroqError(error)) {
            throw error;
          }
          assistance = await getFallbackQuestionAssistance(questionFields, questionControlGroups);
          selectedChoices = fillQuestionControls(questionControlGroups, assistance);
        } finally {
          setBusyCursor(false);
        }
      }
      await appendAgentLog('question_choices_applied', {
        vacancyId: item.vacancyId,
        groups: questionControlGroups.length,
        selected: selectedChoices.selected,
        labels: selectedChoices.labels.slice(0, 20)
      });
      if (selectedChoices.selected === 0) {
        const message = 'Пропущено: Groq не вернул подходящие варианты ответов HH.';
        counters.skipped += 1;
        await appendResult({
          index: item.index,
          vacancyId: item.vacancyId,
          title: item.title,
          url: item.url,
          status: 'skipped_choice_answer_unmatched',
          coverLetterUsed: false,
          testDetected: true,
          error: message
        });
        await setRunState({ state: 'applying', ...counters, lastError: message });
        closeDialog();
        return;
      }
      await sleep(500);
    }

    if (questionFields.length > 0) {
      await setRunState({ state: 'filling_cover_letter', ...counters, currentAction: 'Заполняю вопросы работодателя' });
      setBusyCursor(true);
      const answers = splitGeneratedAnswers(assistance, questionFields.length);
      const invalidAnswer = answers.find((answer) => getGeneratedTextInvalidReason(answer, { minLength: 2 }));
      if (invalidAnswer) {
        setBusyCursor(false);
        const message = getGeneratedTextInvalidReason(invalidAnswer, { minLength: 2 });
        counters.skipped += 1;
        await appendResult({
          index: item.index,
          vacancyId: item.vacancyId,
          title: item.title,
          url: item.url,
          status: 'skipped_bad_generated_answer',
          coverLetterUsed: false,
          testDetected: true,
          error: message
        });
        await setRunState({ state: 'applying', ...counters, lastError: message });
        closeDialog();
        return;
      }
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
        fields: questionFields.length,
        answerLengths: answers.slice(0, questionFields.length).map((answer) => String(answer || '').length)
      });
      await sleep(500);
    }

    if (coverLetterTextarea && !coverLetterTextarea.value) {
      let letter;
      await setRunState({
        state: 'generating_cover_letter',
        ...counters,
        currentAction: 'ИИ: готовлю обязательное сопроводительное письмо'
      });
      setBusyCursor(true);
      try {
        letter = await generateCoverLetter(getVacancyText(item.card) || getVacancyText(document));
      } catch (error) {
        if (!isMissingGroqKeyError(error) && !isRecoverableGroqError(error)) {
          throw error;
        }
        letter = await getFallbackCoverLetter();
      } finally {
        setBusyCursor(false);
      }

      await setRunState({ state: 'filling_cover_letter', ...counters, currentAction: 'Заполняю обязательное сопроводительное письмо' });
      setBusyCursor(true);
      setNativeValue(coverLetterTextarea, letter);
      setBusyCursor(false);
      coverLetterUsed = true;
      await sleep(500);
    }

    const submitButton = findSubmitButton(root);
    if (!submitButton) {
      const blockedReason = detectBlockedResponseReason(root);
      if (blockedReason) {
        await appendSkippedResponse(item, counters, 'skipped_response_unavailable', blockedReason);
        return;
      }
      await appendSkippedResponse(item, counters, 'skipped_submit_not_found', 'Пропущено: кнопка отправки теста не найдена.');
      return;
    }

    await setRunState({ state: 'submitting', ...counters });
    await waitBeforeClick();
    const beforeSubmitText = textOf(document.body);
    await savePendingSubmit({
      item,
      counters,
      status: 'applied_test_assisted',
      coverLetterUsed,
      testDetected: true
    });
    submitButton.click();
    await sleep(1800);
    await confirmFollowupIfNeeded(beforeSubmitText, counters);

    const confirmed = await verifySubmitConfirmed({
      item,
      counters,
      status: 'applied_test_assisted',
      coverLetterUsed,
      testDetected: true
    });
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

  if (root === document && !textarea) {
    counters.applied += 1;
    await appendResult({
      index: item.index,
      vacancyId: item.vacancyId,
      title: item.title,
      url: item.url,
      status: 'applied_direct_click',
      coverLetterUsed: false,
      testDetected: false,
      error: ''
    });
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
      if (!isMissingGroqKeyError(error) && !isRecoverableGroqError(error)) {
        throw error;
      }

      if (isRecoverableGroqError(error)) {
        letter = await getFallbackCoverLetter();
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

    await setRunState({ state: 'filling_cover_letter', ...counters, currentAction: 'Заполняю сопроводительное письмо' });
    setBusyCursor(true);
    textarea.focus?.();
    setNativeValue(textarea, letter);
    setBusyCursor(false);
    coverLetterUsed = true;
    await sleep(500);
  }

  const submitButton = findSubmitButton(root);
  if (!submitButton) {
    const blockedReason = detectBlockedResponseReason(root);
    if (blockedReason) {
      await appendSkippedResponse(item, counters, 'skipped_response_unavailable', blockedReason);
      return;
    }
    await appendSkippedResponse(item, counters, 'skipped_submit_not_found', 'Пропущено: кнопка отправки не найдена.');
    return;
  }

  await setRunState({ state: 'submitting', ...counters });
  await waitBeforeClick();
  const beforeSubmitText = textOf(document.body);
  await savePendingSubmit({
    item,
    counters,
    status: 'applied',
    coverLetterUsed,
    testDetected: false
  });
  submitButton.click();
  await sleep(1800);
  await confirmFollowupIfNeeded(beforeSubmitText, counters);

  const confirmed = await verifySubmitConfirmed({
    item,
    counters,
    status: 'applied',
    coverLetterUsed,
    testDetected: false
  });
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
    testDetected: queueItem.testDetected || detectTest(document) || findQuestionFields(document).length > 0
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
      stopRequested = false;
      stopReason = '';
      await finalizePendingSubmitFromSearchReturn(counters, autoApplyQueue.runId || activeRunId);
      await handleAutoApply(
        autoApplyQueue.limit || 20,
        counters,
        autoApplyQueue.processedVacancyIds || [],
        { maxProcessed: autoApplyQueue.maxProcessed || null }
      );
      return true;
    }
    if (isHhSearchPageUrl(sourceUrl)) {
      await saveSearchQueue({ active: false });
      await setRunState({ state: 'complete', ...counters, currentAction: 'Возвращаюсь на страницу поиска HH', lastError: '' });
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

  counters.processed += 1;
  const item = isResponseFormPage() ? buildResponseFormItem(itemData) : buildQueuedVacancyDetailItem(itemData);

  try {
    await applyToVacancy(item, counters);
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
  await setRunState({ state: 'applying', ...counters });
  const delayMs = randomDelay(queue.config?.delayMinMs, queue.config?.delayMaxMs);
  await sleep(delayMs);
  navigateTo(nextItem.responseUrl);
  return true;
}

async function handleAutoApply(limit, existingCounters = null, existingProcessedVacancyIds = [], options = {}) {
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
    await setRunState({ state: 'complete', ...counters, lastError: '' });
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
    await setRunState({ state: 'complete', ...counters, lastError: '' });
    return { ok: true, ...counters };
  }

  await setRunState({ state: 'applying', ...counters, lastError: '' });

  for (const item of vacancies) {
    if (stopRequested) break;

    const sourceUrl = getQueueSourceUrl();
    const vacancyKey = getVacancyDedupeKey(item);
    if (vacancyKey) {
      processedVacancyIds.add(vacancyKey);
    }
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
        returnToSearch: true,
        processedVacancyIds: serializeProcessedVacancyIds(processedVacancyIds)
      };
    }

    counters.processed += 1;
    const appliedBeforeItem = counters.applied;

    try {
      await applyToVacancy(item, counters);
      if (item.responseUrl) {
        await saveQueue({ active: false });
      }
    } catch (error) {
      const message = localizeError(error);
      counters.errors += 1;
      if (item.responseUrl) {
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
      await sleep(randomDelay(config.delayMinMs, config.delayMaxMs));
    }
  }

  if (!stopRequested && counters.applied < limit && (maxProcessed == null || counters.processed < maxProcessed)) {
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
      await setRunState({ state: 'applying', ...counters, currentAction: 'Переход на следующую страницу HH' });
      navigateTo(nextPageUrl);
      return { ok: true, ...counters, navigated: true, nextPageUrl };
    }
  }

  await saveSearchQueue({ active: false });
  const finalState = stopRequested && stopReason === 'test_detected' ? 'paused' : stopRequested ? 'stopped' : 'complete';
  await setRunState({ state: finalState, ...counters });
  return { ok: true, ...counters };
}

function normalizeMaxProcessed(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.max(1, Math.min(Math.floor(parsed), 1000));
}

async function continueSearchAutoApply() {
  if (queuedSearchStarted || isResponseFormPage() || !isHhSearchPageUrl(location.href)) {
    return;
  }

  const { autoApplySearchQueue } = await storageGet(['autoApplySearchQueue']);
  if (!autoApplySearchQueue?.active) {
    return;
  }
  requireAuthenticatedHhPage();

  queuedSearchStarted = true;
  activeRunId = autoApplySearchQueue.runId || `${Date.now()}:${Math.random().toString(16).slice(2)}`;
  stopRequested = false;
  stopReason = '';

  try {
    await handleAutoApply(
      autoApplySearchQueue.limit || 20,
      autoApplySearchQueue.counters || null,
      autoApplySearchQueue.processedVacancyIds || [],
      { maxProcessed: autoApplySearchQueue.maxProcessed || null }
    );
  } catch (error) {
    const message = localizeError(error);
    await saveSearchQueue({ active: false });
    await setRunState({ state: 'error', ...(autoApplySearchQueue.counters || {}), lastError: message });
  }
}

async function startRun(mode, limitOverride = null, options = {}) {
  const config = await getConfig();
  const limitSource = limitOverride == null ? config.dailyLimit : limitOverride;
  const limit = Math.max(1, Math.min(Number(limitSource) || 20, 100));
  const maxProcessed = normalizeMaxProcessed(options.maxProcessed);
  stopRequested = false;
  stopReason = '';
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
    url.searchParams.delete('hhjaAutoStart');
    url.searchParams.delete('hhjaLimit');
    url.searchParams.delete('hhjaMaxProcessed');
    url.searchParams.delete('hhjaGroqModel');
    window.history?.replaceState?.(null, '', `${url.pathname}${url.search}${url.hash}`);
    return {
      mode,
      limit: limit ? Number(limit) : null,
      maxProcessed: maxProcessed ? Number(maxProcessed) : null,
      groqModel
    };
  } catch {
    return null;
  }
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

async function maybeStartFromUrlParam() {
  const trigger = consumeAutoStartParam();
  if (!trigger) {
    return false;
  }
  const { mode, limit, maxProcessed, groqModel } = trigger;

  try {
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
      case 'GET_CONTENT_STATUS':
        sendResponse({
          ok: true,
          authenticated: hasAuthenticatedHhSignal(),
          unsafe: isUnsafePage(),
          activeRunId,
          stopRequested,
          url: location.href
        });
        break;
      case 'START_DRY_RUN':
        sendResponse(await startRun('dry', message.limitOverride ?? null, { maxProcessed: message.maxProcessed }));
        break;
      case 'START_AUTO_APPLY':
        sendResponse(await startRun('live', message.limitOverride ?? null, { maxProcessed: message.maxProcessed }));
        break;
      case 'START_CHAT_ASSIST':
        stopRequested = false;
        stopReason = '';
        activeRunId = `${Date.now()}:${Math.random().toString(16).slice(2)}`;
        await globalThis.HHJobAssistantLog?.reset?.('content', 'chat_assist_content_started', {
          runId: activeRunId,
          url: location.href
        });
        sendResponse(await handleChatAssist());
        break;
      case 'STOP_RUN':
        stopRequested = true;
        stopReason = 'user_stop';
        await storageSet({ autoApplyQueue: { active: false }, autoApplySearchQueue: { active: false } });
        await appendAgentLog('stop_run', { activeRunId, url: location.href });
        await setRunState({ state: 'stopped' });
        sendResponse({ ok: true, activeRunId });
        break;
      default:
        sendResponse({ ok: false, error: `Неизвестный тип сообщения контент-скрипта: ${message?.type || 'пусто'}` });
    }
  })().catch(async (error) => {
    const messageText = localizeError(error);
    await appendAgentLog('content_message_error', { type: message?.type || '', error: messageText, url: location.href });
    await setRunState({ state: 'error', lastError: messageText });
    sendResponse({ ok: false, error: messageText });
  });

  return true;
});

globalThis.window?.addEventListener?.('hh-job-assistant:start-auto-apply', async () => {
  try {
    await appendAgentLog('page_trigger_start_auto_apply', { url: location.href });
    await startRun('live');
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
