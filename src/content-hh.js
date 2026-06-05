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

let stopRequested = false;
let stopReason = '';
let activeRunId = null;
let queuedResumeStarted = false;
let queuedSearchStarted = false;

function sleep(ms) {
  if (window.__HH_JOB_ASSISTANT_TEST_FAST_CLICKS__) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function cleanText(value) {
  return (value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function textOf(node) {
  return cleanText(node?.innerText || node?.textContent || '');
}

function isVisible(node) {
  if (!node) return false;
  const style = window.getComputedStyle(node);
  const rect = node.getBoundingClientRect();
  return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
}

function queryFirst(selectors, root = document) {
  for (const selector of selectors) {
    const node = [...root.querySelectorAll(selector)].find(isVisible);
    if (node) return node;
  }
  return null;
}

function queryAll(selectors, root = document) {
  return selectors.flatMap((selector) => [...root.querySelectorAll(selector)]).filter(isVisible);
}

function findClickableByText(root, patterns) {
  const nodes = [...root.querySelectorAll('button,a,[role="button"]')].filter(isVisible);
  return nodes.find((node) => patterns.some((pattern) => pattern.test(textOf(node))));
}

function isDisabled(node) {
  return Boolean(
    node?.disabled ||
      node?.getAttribute?.('disabled') !== null ||
      node?.getAttribute?.('aria-disabled') === 'true' ||
      /\bdisabled\b/i.test(node?.getAttribute?.('class') || '')
  );
}

function findEnabledClickableByText(root, patterns) {
  const nodes = [...root.querySelectorAll('button,a,[role="button"]')].filter((node) => isVisible(node) && !isDisabled(node));
  return nodes.find((node) => patterns.some((pattern) => pattern.test(textOf(node))));
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
    /\/account\/login|\/account\/signup/.test(location.pathname) ||
    /captcha|подтвердите, что вы не робот|не робот|слишком много запросов/i.test(body)
  );
}

function isResponseFormPage() {
  return (
    /\/applicant\/vacancy_response/.test(location.pathname) ||
    Boolean(queryFirst(HH_SELECTORS.submitButtons.filter((selector) => selector !== 'button'), document))
  );
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
  for (const selectors of [
    ['[data-qa="vacancy-serp__vacancy"]'],
    ['[data-qa="serp-item"]'],
    ['[data-qa*="vacancy-serp"]']
  ]) {
    const cards = queryAll(selectors).filter(
      (card) => card.querySelector('a[href*="/vacancy/"]') || /откликнуться/i.test(textOf(card))
    );
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

function detectTest(root = getDialogRoot()) {
  const text = textOf(root);
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
  return [...root.querySelectorAll('textarea,input:not([type="hidden"])')]
    .filter(isVisible)
    .find((field) => /letter|cover|сопровод/i.test(getFieldMarker(field)));
}

function findQuestionFields(root = getDialogRoot()) {
  return [...root.querySelectorAll('textarea,input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])')]
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
  return cleanText([...new Set([ariaLabel, marker, value].map(cleanText).filter(Boolean))].join('\n'));
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
    const group = byGroup.get(option.groupKey) || { type: option.type, options: [] };
    group.options.push(option);
    byGroup.set(option.groupKey, group);
  }

  return [...byGroup.values()].filter((group) => group.options.length > 0);
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
    return 'Skipped: Resume visibility does not allow this response. Change visibility to "Видно компаниям-клиентам HeadHunter".';
  }
  if (/откликнуться на эту вакансию невозможно|нельзя откликнуться|отклик недоступен/i.test(text)) {
    return 'Skipped: HH disabled the response button for this vacancy.';
  }
  return '';
}

function findFollowupConfirmButton(root = getDialogRoot()) {
  const text = textOf(root);
  if (!/другой стране|такой отклик может получить отказ|скорее всего, будет отказ|получить отказ/i.test(text)) {
    return null;
  }

  return findClickableByText(root, [
    /в[сc]е равно откликнуться/i,
    /откликнуться все равно/i,
    /продолжить отклик/i,
    /подтвердить/i
  ]);
}

async function confirmFollowupIfNeeded(previousText, counters) {
  if (window.__HH_JOB_ASSISTANT_TEST_FAST_CLICKS__) {
    const confirmButton = findFollowupConfirmButton(getDialogRoot());
    if (!confirmButton) {
      return false;
    }

    await setRunState({ state: 'submitting', ...counters });
    confirmButton.click();
    await sleep(0);
    return true;
  }

  const root = await waitForDialogOrChange(previousText, 5000);
  const confirmButton = findFollowupConfirmButton(root);
  if (!confirmButton) {
    return false;
  }

  await setRunState({ state: 'submitting', ...counters });
  await waitBeforeClick();
  confirmButton.click();
  await sleep(1800);
  return true;
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

function setBusyCursor(active) {
  if (!document?.body?.style) return;
  document.body.style.cursor = active ? 'progress' : '';
}

function setNativeValue(element, value) {
  const prototype = Object.getPrototypeOf(element);
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
  if (descriptor?.set) {
    descriptor.set.call(element, value);
  } else {
    element.value = value;
  }
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

function showAssistantPanel({ title, text }) {
  document.getElementById('hh-job-assistant-panel')?.remove();

  const panel = document.createElement('aside');
  panel.id = 'hh-job-assistant-panel';
  panel.style.cssText = [
    'position: fixed',
    'right: 16px',
    'bottom: 16px',
    'z-index: 2147483647',
    'width: min(420px, calc(100vw - 32px))',
    'max-height: 70vh',
    'overflow: auto',
    'background: #fff',
    'border: 1px solid #b6c2d1',
    'box-shadow: 0 16px 48px rgba(0,0,0,.22)',
    'border-radius: 8px',
    'font: 14px/1.45 Arial, sans-serif',
    'color: #1f2937',
    'padding: 14px'
  ].join(';');

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px';

  const heading = document.createElement('strong');
  heading.textContent = title;

  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = 'Close';
  close.style.cssText = 'border:1px solid #cbd5e1;background:#f8fafc;border-radius:6px;padding:4px 8px;cursor:pointer';
  close.addEventListener('click', () => panel.remove());

  const body = document.createElement('pre');
  body.textContent = text;
  body.style.cssText = 'white-space:pre-wrap;margin:0;font:13px/1.45 Arial, sans-serif';

  header.append(heading, close);
  panel.append(header, body);
  document.body.append(panel);
}

async function sendRuntimeMessage(message) {
  return chrome.runtime.sendMessage(message);
}

async function setRunState(patch) {
  await sendRuntimeMessage({ type: 'SET_RUN_STATE', patch });
}

async function appendResult(item) {
  await sendRuntimeMessage({ type: 'APPEND_RUN_RESULT', item });
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
  const blockedReason = detectBlockedResponseReason(root);
  if (blockedReason) {
    await appendSkippedResponse(item, counters, 'skipped_response_unavailable', blockedReason);
    return false;
  }

  if (isAlreadyAppliedPage(root) || isAlreadyAppliedPage(document)) {
    counters.applied += 1;
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

async function appendChatReport(item) {
  await sendRuntimeMessage({ type: 'APPEND_CHAT_REPORT', item });
}

async function getConfig() {
  const values = await chrome.storage.local.get([
    'dailyLimit',
    'delayMinMs',
    'delayMaxMs',
    'runResults',
    'chatUnreadOnly',
    'chatReplyMode',
    'chatLimit'
  ]);
  return {
    dailyLimit: Number(values.dailyLimit) || 20,
    delayMinMs: Number(values.delayMinMs) || 2500,
    delayMaxMs: Number(values.delayMaxMs) || 5000,
    chatUnreadOnly: values.chatUnreadOnly !== false,
    chatReplyMode: values.chatReplyMode === 'auto_send' ? 'auto_send' : 'draft',
    chatLimit: Math.max(1, Math.min(Number(values.chatLimit) || 10, 100))
  };
}

async function generateCoverLetter(vacancyText) {
  const response = await sendRuntimeMessage({
    type: 'GENERATE_COVER_LETTER',
    task: 'cover_letter',
    vacancyText
  });
  if (!response?.ok) {
    throw new Error(response?.error || 'Cover letter generation failed');
  }
  return response.text;
}

function isMissingGroqKeyError(error) {
  return /groq api key is not configured/i.test(error instanceof Error ? error.message : String(error));
}

function missingGroqMessage(kind) {
  if (kind === 'test') {
    return 'Skipped because Groq API key is missing: vacancy needs employer questions/test assistance.';
  }
  return 'Skipped because Groq API key is missing: vacancy needs a cover letter.';
}

async function generateTestAssistance(vacancyText, extraText) {
  const response = await sendRuntimeMessage({
    type: 'GENERATE_COVER_LETTER',
    task: 'test_assist',
    vacancyText,
    extraText
  });
  if (!response?.ok) {
    throw new Error(response?.error || 'Test assistance generation failed');
  }
  return response.text;
}

async function generateChatReply({ vacancyUrl, vacancyText, chatText }) {
  const response = await sendRuntimeMessage({
    type: 'GENERATE_CHAT_REPLY',
    vacancyUrl,
    vacancyText,
    chatText
  });
  if (!response?.ok) {
    throw new Error(response?.error || 'Chat reply generation failed');
  }
  return response.text;
}

async function getExpectedSalary() {
  const { expectedSalary = '' } = await chrome.storage.local.get(['expectedSalary']);
  return String(expectedSalary || '').trim();
}

async function getFallbackCoverLetter() {
  return 'Здравствуйте! Заинтересовала ваша вакансия. Имею релевантный опыт в разработке и управлении IT-продуктами, готов обсудить задачи и пользу для команды.';
}

function splitGeneratedAnswers(text, count) {
  const cleaned = cleanText(text);
  if (!cleaned || count <= 1) return [cleaned];

  const lines = cleaned
    .split(/\n+/)
    .map((line) => line.replace(/^\s*(?:\d+[\).:-]?|[-*])\s*/, '').trim())
    .filter(Boolean);

  if (lines.length >= count) {
    return lines.slice(0, count);
  }

  return Array.from({ length: count }, () => cleaned);
}

function normalizeChoiceText(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[–—-]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function choiceTokens(value) {
  const stopWords = new Set([
    'можно',
    'выбрать',
    'несколько',
    'вариант',
    'варианта',
    'свои',
    'свой',
    'другое',
    'другой',
    'человек',
    'человека',
    'людей',
    'более',
    'менее',
    'нет',
    'да'
  ]);
  return normalizeChoiceText(value)
    .split(/\s+/)
    .filter((token) => (token.length >= 2 || /^\d+$/.test(token)) && !stopWords.has(token));
}

function scoreChoice(label, answerText) {
  const normalizedLabel = normalizeChoiceText(label);
  const normalizedAnswer = normalizeChoiceText(answerText);
  if (!normalizedLabel || !normalizedAnswer || /свой вариант|другое/i.test(label)) return 0;
  if (normalizedAnswer.includes(normalizedLabel)) return 100;

  if (/^да(?:\s+да)*$/.test(normalizedLabel) && normalizeChoiceText(answerText).split(/\s+/).includes('да')) return 90;
  if (/^нет(?:\s+нет)*$/.test(normalizedLabel) && normalizeChoiceText(answerText).split(/\s+/).includes('нет')) return 90;

  const labelTokens = choiceTokens(label);
  if (labelTokens.length === 0) return 0;

  const answerTokens = new Set(choiceTokens(answerText));
  const matches = labelTokens.filter((token) => answerTokens.has(token)).length;
  return matches / labelTokens.length;
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

function fillQuestionControls(groups, answerText) {
  let selected = 0;
  for (const group of groups) {
    const scored = group.options
      .map((option) => ({ ...option, score: scoreChoice(option.label, answerText) }))
      .filter((option) => option.score > 0);

    if (group.type === 'radio') {
      const best = scored.sort((left, right) => right.score - left.score)[0];
      if (best) {
        selectControl(best.control);
        selected += 1;
      }
      continue;
    }

    for (const option of scored) {
      selectControl(option.control);
      selected += 1;
    }
  }
  return selected;
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
    throw new Error('Login, captcha, or anti-bot page detected');
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
  fillChatInput(input, draftAnswer);
  await sleep(500);

  let sent = false;
  if (config.chatReplyMode === 'auto_send') {
    const sendButton = findChatSendButton();
    if (!sendButton) {
      throw new Error('Chat send button was not found');
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
    throw new Error('Login, captcha, or anti-bot page detected');
  }

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
      const message = error instanceof Error ? error.message : String(error);
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
    const currentText = textOf(root);
    if (root !== document && currentText) return root;
    if (currentText && currentText !== previousText && /отправить|сопровод|тест|отклик/i.test(currentText)) {
      return root;
    }
    await sleep(250);
  }
  return getDialogRoot();
}

async function handleDryRun(limit) {
  if (isUnsafePage()) {
    throw new Error('Login, captcha, or anti-bot page detected');
  }

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
        error: 'Skipped: response button was not found.'
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
    item.responseButton.scrollIntoView({ block: 'center', inline: 'center' });
    await sleep(250);
    await waitBeforeClick();
    item.responseButton.click();

    root = await waitForDialogOrChange(beforeText);
    await sleep(700);
  }

  if (isUnsafePage()) {
    throw new Error('Login, captcha, or anti-bot page detected after click');
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
    let coverLetterUsed = false;
    await setRunState({
      state: 'generating_cover_letter',
      ...counters,
      currentAction: 'LLM: generating answers for HH employer questions'
    });
    let assistance;
    setBusyCursor(true);
    try {
      assistance = await generateTestAssistance(getVacancyText(item.card), textOf(root));
    } catch (error) {
      if (!isMissingGroqKeyError(error)) {
        throw error;
      }

      assistance = questionFields.length > 0 && questionControlGroups.length === 0 ? await getExpectedSalary() : '';
      if (assistance) {
        await setRunState({ state: 'filling_cover_letter', ...counters, currentAction: 'Filling HH employer question fields' });
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
      await setRunState({ state: 'filling_cover_letter', ...counters, currentAction: 'Filling HH employer choice fields' });
      setBusyCursor(true);
      try {
        fillQuestionControls(questionControlGroups, assistance);
      } finally {
        setBusyCursor(false);
      }
      await sleep(500);
    }

    if (questionFields.length > 0) {
      await setRunState({ state: 'filling_cover_letter', ...counters, currentAction: 'Filling HH employer question fields' });
      setBusyCursor(true);
      const answers = splitGeneratedAnswers(assistance, questionFields.length);
      try {
        questionFields.forEach((field, index) => {
          field.focus?.();
          setNativeValue(field, answers[index] || assistance);
        });
      } finally {
        setBusyCursor(false);
      }
      await sleep(500);
    } else {
      showAssistantPanel({ title: 'HH test assistance', text: assistance });
    }

    if (coverLetterTextarea && !coverLetterTextarea.value) {
      let letter;
      await setRunState({
        state: 'generating_cover_letter',
        ...counters,
        currentAction: 'LLM: generating required cover letter'
      });
      setBusyCursor(true);
      try {
        letter = await generateCoverLetter(getVacancyText(item.card) || getVacancyText(document));
      } catch (error) {
        if (!isMissingGroqKeyError(error)) {
          throw error;
        }
        letter = await getFallbackCoverLetter();
      } finally {
        setBusyCursor(false);
      }

      await setRunState({ state: 'filling_cover_letter', ...counters, currentAction: 'Filling required cover letter' });
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
      await appendSkippedResponse(item, counters, 'skipped_submit_not_found', 'Skipped: test submit button was not found.');
      return;
    }

    await setRunState({ state: 'submitting', ...counters });
    await waitBeforeClick();
    const beforeSubmitText = textOf(document.body);
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
      currentAction: 'LLM: generating cover letter'
    });
    const vacancyText = getVacancyText(item.card) || getVacancyText(document);
    let letter;
    setBusyCursor(true);
    try {
      letter = await generateCoverLetter(vacancyText);
    } catch (error) {
      if (!isMissingGroqKeyError(error)) {
        throw error;
      }

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
    } finally {
      setBusyCursor(false);
    }

    await setRunState({ state: 'filling_cover_letter', ...counters, currentAction: 'Filling cover letter' });
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
    await appendSkippedResponse(item, counters, 'skipped_submit_not_found', 'Skipped: submit button was not found.');
    return;
  }

  await setRunState({ state: 'submitting', ...counters });
  await waitBeforeClick();
  const beforeSubmitText = textOf(document.body);
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

async function saveQueue(queue) {
  await chrome.storage.local.set({ autoApplyQueue: queue });
}

async function saveSearchQueue(queue) {
  await chrome.storage.local.set({ autoApplySearchQueue: queue });
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
    return;
  }

  const { autoApplyQueue } = await chrome.storage.local.get(['autoApplyQueue']);
  if (!autoApplyQueue?.active || !Array.isArray(autoApplyQueue.items)) {
    return;
  }

  if (!isResponseFormPage()) {
    const counters = autoApplyQueue.counters || {};
    const sourceUrl = autoApplyQueue.sourceUrl || '';
    await saveQueue({ ...autoApplyQueue, active: false, recoveredFromUrl: location.href });
    if (sourceUrl) {
      await saveSearchQueue({ active: false });
      await setRunState({ state: 'complete', ...counters, currentAction: 'Возвращаюсь на страницу поиска HH', lastError: '' });
      navigateTo(sourceUrl);
    }
    return;
  }

  queuedResumeStarted = true;
  const queue = autoApplyQueue;
  const itemData = queue.items[queue.index];
  if (!itemData) {
    await saveQueue({ ...queue, active: false });
    await setRunState({ state: 'complete', ...(queue.counters || {}) });
    return;
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
  const item = buildResponseFormItem(itemData);

  try {
    await applyToVacancy(item, counters);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
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
    await saveQueue({ ...queue, active: false, counters });
    await setRunState({ state: 'error', ...counters, lastError: message });
    return;
  }

  const nextIndex = queue.index + 1;
  if (nextIndex >= queue.items.length || stopRequested) {
    await saveQueue({ ...queue, active: false, index: nextIndex, counters });
    if (!stopRequested && queue.sourceUrl) {
      await saveSearchQueue({ active: false });
      await setRunState({ state: 'complete', ...counters, currentAction: 'Возвращаюсь на страницу поиска HH' });
      navigateTo(queue.sourceUrl);
      return;
    }
    await setRunState({ state: stopRequested ? 'stopped' : 'complete', ...counters });
    return;
  }

  const nextItem = queue.items[nextIndex];
  await saveQueue({ ...queue, index: nextIndex, counters });
  await setRunState({ state: 'applying', ...counters });
  const delayMs = randomDelay(queue.config?.delayMinMs, queue.config?.delayMaxMs);
  await sleep(delayMs);
  navigateTo(nextItem.responseUrl);
}

async function handleAutoApply(limit, existingCounters = null) {
  if (isUnsafePage()) {
    throw new Error('Login, captcha, or anti-bot page detected');
  }

  const config = await getConfig();
  const counters = existingCounters || {
    found: 0,
    processed: 0,
    applied: 0,
    skipped: 0,
    errors: 0
  };
  const remaining = Math.max(0, limit - counters.processed);
  const vacancies = scanVacancies().slice(0, remaining);
  counters.found += vacancies.length;

  if (remaining <= 0) {
    await saveSearchQueue({ active: false });
    await setRunState({ state: 'complete', ...counters, lastError: '' });
    return { ok: true, ...counters };
  }

  if (vacancies.length === 0) {
    const nextPageUrl = getNextSearchPageUrl();
    if (nextPageUrl) {
      await saveSearchQueue({ active: true, runId: activeRunId, limit, counters, config });
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

    if (item.responseUrl) {
      const queuedItems = vacancies
        .slice(vacancies.indexOf(item))
        .filter((queuedItem) => queuedItem.responseUrl)
        .map((queuedItem) => ({
          index: queuedItem.index,
          vacancyId: queuedItem.vacancyId,
          title: queuedItem.title,
          url: queuedItem.url,
          responseUrl: queuedItem.responseUrl,
          testDetected: queuedItem.testDetected
        }));
      await saveQueue({
        active: true,
        runId: activeRunId,
        index: 0,
        items: queuedItems,
        sourceUrl: location.href,
        limit,
        counters,
        config
      });
    }

    counters.processed += 1;

    try {
      await applyToVacancy(item, counters);
      if (item.responseUrl) {
        await saveQueue({ active: false });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
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
      await setRunState({ state: 'error', ...counters, lastError: message });
      stopRequested = true;
      break;
    }

    await setRunState({ state: stopRequested ? 'paused' : 'applying', ...counters });
    if (!stopRequested) {
      await sleep(randomDelay(config.delayMinMs, config.delayMaxMs));
    }
  }

  if (!stopRequested && counters.processed < limit) {
    const nextPageUrl = getNextSearchPageUrl();
    if (nextPageUrl) {
      await saveSearchQueue({ active: true, runId: activeRunId, limit, counters, config });
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

async function continueSearchAutoApply() {
  if (queuedSearchStarted || isResponseFormPage()) {
    return;
  }

  const { autoApplySearchQueue } = await chrome.storage.local.get(['autoApplySearchQueue']);
  if (!autoApplySearchQueue?.active) {
    return;
  }

  queuedSearchStarted = true;
  activeRunId = autoApplySearchQueue.runId || `${Date.now()}:${Math.random().toString(16).slice(2)}`;
  stopRequested = false;
  stopReason = '';

  try {
    await handleAutoApply(autoApplySearchQueue.limit || 20, autoApplySearchQueue.counters || null);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await saveSearchQueue({ active: false });
    await setRunState({ state: 'error', ...(autoApplySearchQueue.counters || {}), lastError: message });
  }
}

async function startRun(mode) {
  const config = await getConfig();
  const limit = Math.max(1, Math.min(Number(config.dailyLimit) || 20, 100));
  stopRequested = false;
  stopReason = '';
  activeRunId = `${Date.now()}:${Math.random().toString(16).slice(2)}`;
  await chrome.storage.local.set({ runResults: [], autoApplyQueue: { active: false }, autoApplySearchQueue: { active: false } });

  if (mode === 'dry') {
    return handleDryRun(limit);
  }
  return handleAutoApply(limit);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case 'GET_CONTENT_STATUS':
        sendResponse({
          ok: true,
          activeRunId,
          stopRequested,
          url: location.href
        });
        break;
      case 'START_DRY_RUN':
        sendResponse(await startRun('dry'));
        break;
      case 'START_AUTO_APPLY':
        sendResponse(await startRun('live'));
        break;
      case 'START_CHAT_ASSIST':
        stopRequested = false;
        stopReason = '';
        activeRunId = `${Date.now()}:${Math.random().toString(16).slice(2)}`;
        sendResponse(await handleChatAssist());
        break;
      case 'STOP_RUN':
        stopRequested = true;
        stopReason = 'user_stop';
        await chrome.storage.local.set({ autoApplyQueue: { active: false }, autoApplySearchQueue: { active: false } });
        await setRunState({ state: 'stopped' });
        sendResponse({ ok: true, activeRunId });
        break;
      default:
        sendResponse({ ok: false, error: `Unknown content message type: ${message?.type || 'empty'}` });
    }
  })().catch(async (error) => {
    const messageText = error instanceof Error ? error.message : String(error);
    await setRunState({ state: 'error', lastError: messageText });
    sendResponse({ ok: false, error: messageText });
  });

  return true;
});

continueQueuedAutoApply().catch(async (error) => {
  const messageText = error instanceof Error ? error.message : String(error);
  await chrome.storage.local.set({ autoApplyQueue: { active: false } });
  await setRunState({ state: 'error', lastError: messageText });
});

continueSearchAutoApply().catch(async (error) => {
  const messageText = error instanceof Error ? error.message : String(error);
  await chrome.storage.local.set({ autoApplySearchQueue: { active: false } });
  await setRunState({ state: 'error', lastError: messageText });
});
