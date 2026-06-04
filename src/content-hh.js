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
    'button[aria-label="Закрыть"]'
  ]
};

const CLICK_DELAY_MIN_MS = 2000;
const CLICK_DELAY_MAX_MS = 4000;

let stopRequested = false;
let stopReason = '';
let activeRunId = null;
let queuedResumeStarted = false;

function sleep(ms) {
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

function getVacancyId(url) {
  return String(url || '').match(/\/vacancy\/(\d+)/)?.[1] || new URL(String(url || location.href), location.href).searchParams.get('vacancyId') || '';
}

function getResponseUrl(item) {
  const href = item?.responseButton?.href || '';
  if (!href) return '';
  const url = new URL(href, location.href);
  return /\/applicant\/vacancy_response/.test(url.pathname) ? url.href : '';
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
  return /\/applicant\/vacancy_response/.test(location.pathname) || Boolean(queryFirst(HH_SELECTORS.submitButtons, document));
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

function findSubmitButton(root = getDialogRoot()) {
  return (
    queryAll(HH_SELECTORS.submitButtons, root)
      .filter((button) => !button.disabled && !button.getAttribute('aria-disabled'))
      .find((button) => /отправить|откликнуться|продолжить/i.test(textOf(button))) ||
    findClickableByText(root, [/отправить/i, /откликнуться/i, /продолжить/i])
  );
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
  const close = queryFirst(HH_SELECTORS.modalClose, root) || findClickableByText(root, [/закрыть|отмена/i]);
  if (close) {
    close.click();
  }
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

async function getConfig() {
  const values = await chrome.storage.local.get([
    'dailyLimit',
    'delayMinMs',
    'delayMaxMs',
    'runResults'
  ]);
  return {
    dailyLimit: Number(values.dailyLimit) || 20,
    delayMinMs: Number(values.delayMinMs) || 8000,
    delayMaxMs: Number(values.delayMaxMs) || 15000
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
    counters.skipped += 1;
    await appendResult({
      index: item.index,
      vacancyId: item.vacancyId,
      title: item.title,
      url: item.url,
      status: 'skipped_no_response_button',
      coverLetterUsed: false,
      testDetected: item.testDetected,
      error: ''
    });
    return;
  }

  let root;
  if (item.responseFormOpen) {
    root = document;
  } else {
    await setRunState({ state: 'waiting_for_dialog', ...counters });
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

  if (detectTest(root) || findQuestionFields(root).length > 0) {
    const questionFields = findQuestionFields(root);
    const coverLetterTextarea = findCoverLetterTextarea(root);
    let coverLetterUsed = false;
    await setRunState({ state: 'generating_cover_letter', ...counters });
    let assistance;
    try {
      assistance = await generateTestAssistance(getVacancyText(item.card), textOf(root));
    } catch (error) {
      if (!isMissingGroqKeyError(error)) {
        throw error;
      }

      assistance = questionFields.length > 0 ? await getExpectedSalary() : '';
      if (assistance) {
        await setRunState({ state: 'filling_cover_letter', ...counters });
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
    }

    if (questionFields.length > 0) {
      const answers = splitGeneratedAnswers(assistance, questionFields.length);
      questionFields.forEach((field, index) => {
        setNativeValue(field, answers[index] || assistance);
      });
      await sleep(500);
    } else {
      showAssistantPanel({ title: 'HH test assistance', text: assistance });
    }

    if (coverLetterTextarea && !coverLetterTextarea.value) {
      let letter;
      try {
        letter = await generateCoverLetter(getVacancyText(item.card) || getVacancyText(document));
      } catch (error) {
        if (!isMissingGroqKeyError(error)) {
          throw error;
        }
        letter = await getFallbackCoverLetter();
      }

      await setRunState({ state: 'filling_cover_letter', ...counters });
      setNativeValue(coverLetterTextarea, letter);
      coverLetterUsed = true;
      await sleep(500);
    }

    const submitButton = findSubmitButton(root);
    if (!submitButton) {
      throw new Error('Test submit button was not found');
    }

    await setRunState({ state: 'submitting', ...counters });
    await waitBeforeClick();
    const beforeSubmitText = textOf(document.body);
    submitButton.click();
    await sleep(1800);
    await confirmFollowupIfNeeded(beforeSubmitText, counters);

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
    await setRunState({ state: 'generating_cover_letter', ...counters });
    const vacancyText = getVacancyText(item.card) || getVacancyText(document);
    let letter;
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
    }

    await setRunState({ state: 'filling_cover_letter', ...counters });
    setNativeValue(textarea, letter);
    coverLetterUsed = true;
    await sleep(500);
  }

  const submitButton = findSubmitButton(root);
  if (!submitButton) {
    throw new Error('Submit button was not found');
  }

  await setRunState({ state: 'submitting', ...counters });
  await waitBeforeClick();
  const beforeSubmitText = textOf(document.body);
  submitButton.click();
  await sleep(1800);
  await confirmFollowupIfNeeded(beforeSubmitText, counters);

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

function serializeQueueItem(item) {
  return {
    index: item.index,
    vacancyId: item.vacancyId,
    title: item.title,
    url: item.url,
    responseUrl: getResponseUrl(item),
    testDetected: item.testDetected
  };
}

function buildResponseFormItem(queueItem) {
  return {
    index: queueItem.index,
    vacancyId: queueItem.vacancyId || getVacancyId(location.href),
    title: queueItem.title || cleanText(document.querySelector('h1')?.textContent) || document.title || 'Отклик на вакансию',
    url: queueItem.url || location.href,
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

async function startQueuedAutoApply(vacancies, counters, config) {
  const items = vacancies.map(serializeQueueItem).filter((item) => item.responseUrl);
  if (items.length === 0) {
    return false;
  }

  const queue = {
    active: true,
    runId: activeRunId,
    index: 0,
    items,
    counters,
    config: {
      delayMinMs: config.delayMinMs,
      delayMaxMs: config.delayMaxMs
    }
  };

  await saveQueue(queue);
  await setRunState({ state: 'applying', ...counters, found: items.length, lastError: '' });
  navigateTo(items[0].responseUrl);
  return true;
}

async function continueQueuedAutoApply() {
  if (queuedResumeStarted || !isResponseFormPage()) {
    return;
  }

  const { autoApplyQueue } = await chrome.storage.local.get(['autoApplyQueue']);
  if (!autoApplyQueue?.active || !Array.isArray(autoApplyQueue.items)) {
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

async function handleAutoApply(limit) {
  if (isUnsafePage()) {
    throw new Error('Login, captcha, or anti-bot page detected');
  }

  const config = await getConfig();
  const vacancies = scanVacancies().slice(0, limit);
  const counters = {
    found: vacancies.length,
    processed: 0,
    applied: 0,
    skipped: 0,
    errors: 0
  };

  await setRunState({ state: 'applying', ...counters, lastError: '' });

  if (await startQueuedAutoApply(vacancies, counters, config)) {
    return { ok: true, queued: true, ...counters };
  }

  for (const item of vacancies) {
    if (stopRequested) break;
    counters.processed += 1;

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
      await setRunState({ state: 'error', ...counters, lastError: message });
      stopRequested = true;
      break;
    }

    await setRunState({ state: stopRequested ? 'paused' : 'applying', ...counters });
    if (!stopRequested) {
      await sleep(randomDelay(config.delayMinMs, config.delayMaxMs));
    }
  }

  const finalState = stopRequested && stopReason === 'test_detected' ? 'paused' : stopRequested ? 'stopped' : 'complete';
  await setRunState({ state: finalState, ...counters });
  return { ok: true, ...counters };
}

async function startRun(mode) {
  const config = await getConfig();
  const limit = Math.max(1, Math.min(Number(config.dailyLimit) || 20, 100));
  stopRequested = false;
  stopReason = '';
  activeRunId = `${Date.now()}:${Math.random().toString(16).slice(2)}`;
  await chrome.storage.local.set({ runResults: [], autoApplyQueue: { active: false } });

  if (mode === 'dry') {
    return handleDryRun(limit);
  }
  return handleAutoApply(limit);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case 'START_DRY_RUN':
        sendResponse(await startRun('dry'));
        break;
      case 'START_AUTO_APPLY':
        sendResponse(await startRun('live'));
        break;
      case 'STOP_RUN':
        stopRequested = true;
        stopReason = 'user_stop';
        await chrome.storage.local.set({ autoApplyQueue: { active: false } });
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
