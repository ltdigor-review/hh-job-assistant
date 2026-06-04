const HH_SELECTORS = {
  cards: [
    '[data-qa="vacancy-serp__vacancy"]',
    '[data-qa="serp-item"]',
    '[data-qa*="vacancy-serp"]'
  ],
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

let stopRequested = false;
let stopReason = '';
let activeRunId = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay(minMs, maxMs) {
  const min = Math.max(0, Number(minMs) || 0);
  const max = Math.max(min, Number(maxMs) || min);
  return Math.floor(min + Math.random() * (max - min + 1));
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

function isUnsafePage() {
  const body = textOf(document.body);
  return (
    /\/account\/login|\/account\/signup/.test(location.pathname) ||
    /captcha|подтвердите, что вы не робот|не робот|слишком много запросов/i.test(body)
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
    card,
    responseButton,
    cardText: textOf(card),
    testDetected: /тест|задани[ея]|ответьте на вопросы|вопрос/i.test(textOf(card))
  };
}

function scanVacancies() {
  const cards = queryAll(HH_SELECTORS.cards)
    .filter((card) => card.querySelector('a[href*="/vacancy/"]') || /откликнуться/i.test(textOf(card)))
    .map(getCardInfo);

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

function findTextarea(root = getDialogRoot()) {
  return queryFirst(HH_SELECTORS.textareas, root);
}

function findSubmitButton(root = getDialogRoot()) {
  return (
    queryAll(HH_SELECTORS.submitButtons, root)
      .filter((button) => !button.disabled && !button.getAttribute('aria-disabled'))
      .find((button) => /отправить|откликнуться|продолжить/i.test(textOf(button))) ||
    findClickableByText(root, [/отправить/i, /откликнуться/i, /продолжить/i])
  );
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
    dailyLimit: Number(values.dailyLimit) || 10,
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

  await setRunState({ state: 'waiting_for_dialog', ...counters });
  const beforeText = textOf(document.body);
  item.responseButton.scrollIntoView({ block: 'center', inline: 'center' });
  await sleep(250);
  item.responseButton.click();

  const root = await waitForDialogOrChange(beforeText);
  await sleep(700);

  if (isUnsafePage()) {
    throw new Error('Login, captcha, or anti-bot page detected after click');
  }

  if (detectTest(root)) {
    await setRunState({ state: 'generating_cover_letter', ...counters });
    let assistance;
    try {
      assistance = await generateTestAssistance(getVacancyText(item.card), textOf(root));
    } catch (error) {
      if (!isMissingGroqKeyError(error)) {
        throw error;
      }

      counters.skipped += 1;
      await appendResult({
        index: item.index,
        vacancyId: item.vacancyId,
        title: item.title,
        url: item.url,
        status: 'skipped_test_missing_groq_key',
        coverLetterUsed: false,
        testDetected: true,
        error: 'Groq API key is not configured'
      });
      closeDialog();
      return;
    }

    showAssistantPanel({ title: 'HH test assistance', text: assistance });
    const submitButton = findSubmitButton(root);
    if (!submitButton) {
      throw new Error('Test submit button was not found');
    }

    await setRunState({ state: 'submitting', ...counters });
    submitButton.click();
    await sleep(1800);

    counters.applied += 1;
    await appendResult({
      index: item.index,
      vacancyId: item.vacancyId,
      title: item.title,
      url: item.url,
      status: 'applied_test_assisted',
      coverLetterUsed: false,
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

      counters.skipped += 1;
      await appendResult({
        index: item.index,
        vacancyId: item.vacancyId,
        title: item.title,
        url: item.url,
        status: 'skipped_missing_groq_key',
        coverLetterUsed: false,
        testDetected: false,
        error: 'Groq API key is not configured'
      });
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
  submitButton.click();
  await sleep(1800);

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
  const limit = Math.max(1, Math.min(Number(config.dailyLimit) || 10, 100));
  stopRequested = false;
  stopReason = '';
  activeRunId = `${Date.now()}:${Math.random().toString(16).slice(2)}`;
  await chrome.storage.local.set({ runResults: [] });

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
