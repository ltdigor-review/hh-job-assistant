const DEFAULTS = {
  groqModel: 'llama-3.3-70b-versatile',
  resumeText: '',
  resumeUrl: '',
  resumeParsedText: '',
  resumeParsedAt: '',
  expectedSalary: '',
  coverPrompt: 'Напиши сопроводительное письмо на русском: 3-4 коротких предложения, без плейсхолдеров, без шаблонных скобок, без выдуманного опыта. Только готовый текст письма.',
  dailyLimit: 20,
  delayMinMs: 8000,
  delayMaxMs: 15000,
  chatUnreadOnly: true,
  chatReplyMode: 'draft',
  chatLimit: 10,
  runState: {
    state: 'idle',
    found: 0,
    processed: 0,
    applied: 0,
    skipped: 0,
    errors: 0,
    lastError: '',
    currentAction: '',
    updatedAt: null
  },
  runResults: [],
  chatReports: []
};

const OLD_DEFAULT_COVER_PROMPT = 'Напиши короткое сопроводительное письмо для отклика на вакансию. Тон: деловой, уверенный, без выдуманного опыта.';

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  if (globalThis.__HH_JOB_ASSISTANT_TEST_FAST_CLICKS__) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function storageGet(keys) {
  return chrome.storage.local.get(keys);
}

async function storageSet(value) {
  return chrome.storage.local.set(value);
}

async function ensureDefaults() {
  const current = await storageGet(Object.keys(DEFAULTS));
  const patch = {};

  for (const [key, value] of Object.entries(DEFAULTS)) {
    if (current[key] === undefined) {
      patch[key] = value;
    }
  }

  if (current.dailyLimit === 10) {
    patch.dailyLimit = DEFAULTS.dailyLimit;
  }

  if (current.coverPrompt === OLD_DEFAULT_COVER_PROMPT) {
    patch.coverPrompt = DEFAULTS.coverPrompt;
  }

  if (Object.keys(patch).length > 0) {
    await storageSet(patch);
  }
}

async function setRunState(patch) {
  const { runState = DEFAULTS.runState } = await storageGet(['runState']);
  await storageSet({
    runState: {
      ...DEFAULTS.runState,
      ...runState,
      ...patch,
      updatedAt: nowIso()
    }
  });
}

async function appendRunResult(item) {
  const { runResults = [] } = await storageGet(['runResults']);
  await storageSet({
    runResults: [
      ...runResults.slice(-199),
      {
        ...item,
        timestamp: item.timestamp || nowIso()
      }
    ]
  });
}

async function appendChatReport(item) {
  const { chatReports = [] } = await storageGet(['chatReports']);
  await storageSet({
    chatReports: [
      ...chatReports.slice(-199),
      {
        id: item.id || `${Date.now()}:${Math.random().toString(16).slice(2)}`,
        timestamp: item.timestamp || nowIso(),
        chatUrl: item.chatUrl || '',
        employerName: item.employerName || '',
        vacancyTitle: item.vacancyTitle || '',
        vacancyUrl: item.vacancyUrl || '',
        status: item.status || 'reported',
        reason: item.reason || '',
        contactType: item.contactType || '',
        contactText: item.contactText || '',
        questionText: item.questionText || '',
        draftAnswer: item.draftAnswer || '',
        sent: Boolean(item.sent),
        error: item.error || ''
      }
    ]
  });
}

function buildGroqMessages({ task, resumeText, expectedSalary, coverPrompt, vacancyText, extraText }) {
  if (task === 'chat_reply') {
    return [
      {
        role: 'system',
        content:
          'You help a job applicant answer hh.ru employer chat questions. Answer in concise Russian. Use only the resume, vacancy, chat context, and expected salary. Do not invent experience, contacts, availability, or certainty when information is missing. Return only the final reply text.'
      },
      {
        role: 'user',
        content: [
          'Резюме кандидата:',
          resumeText || '(резюме не указано)',
          '',
          'Ожидаемая зарплата кандидата:',
          expectedSalary || '(зарплата не указана)',
          '',
          'Вакансия:',
          vacancyText || '(текст вакансии не найден)',
          '',
          'Контекст чата и вопрос работодателя:',
          extraText || '(текст чата не найден)'
        ].join('\n')
      }
    ];
  }

  if (task === 'test_assist') {
    return [
      {
        role: 'system',
        content:
          'You help a job applicant answer hh.ru employer screening questions. Base answers on the resume, vacancy, question text, and expected salary. Give concise Russian draft answers. Do not invent experience or claim certainty when information is missing. Return only useful answer text.'
      },
      {
        role: 'user',
        content: [
          'Резюме кандидата:',
          resumeText || '(резюме не указано)',
          '',
          'Ожидаемая зарплата кандидата:',
          expectedSalary || '(зарплата не указана)',
          '',
          'Текст вакансии или теста:',
          vacancyText || '(текст не найден)',
          '',
          'Дополнительный текст со страницы:',
          extraText || '(нет)'
        ].join('\n')
      }
    ];
  }

  return [
    {
      role: 'system',
      content:
        'Write a very short, honest cover letter in Russian for hh.ru: 3-4 sentences total. Do not invent experience. Do not include placeholders, bracketed template text, labels, greetings with unknown names, or instructions. Return only the final cover letter text.'
    },
    {
      role: 'user',
      content: [
        coverPrompt || DEFAULTS.coverPrompt,
        '',
        'Резюме:',
        resumeText || '(резюме не указано)',
        '',
        'Вакансия:',
        vacancyText || '(текст вакансии не найден)'
      ].join('\n')
    }
  ];
}

function normalizeResumeUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(String(value).trim());
    if ((url.hostname !== 'hh.ru' && !url.hostname.endsWith('.hh.ru')) || !/^\/resume\/[^/?#]+/.test(url.pathname)) {
      return '';
    }
    return url.href;
  } catch {
    return '';
  }
}

function isHhUrl(value) {
  try {
    const hostname = new URL(String(value || '')).hostname;
    return hostname === 'hh.ru' || hostname.endsWith('.hh.ru');
  } catch {
    return false;
  }
}

function extractResumeTextScript() {
  const text = (document.body?.innerText || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (/\/account\/login|\/account\/signup/.test(location.pathname) || /captcha|подтвердите, что вы не робот|не робот/i.test(text)) {
    return { ok: false, error: 'Login or captcha page detected', text: '' };
  }

  const main = document.querySelector('main')?.innerText || text;
  return {
    ok: true,
    title: document.title,
    text: String(main)
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .slice(0, 12000)
  };
}

function extractVacancyTextScript() {
  const text = (document.body?.innerText || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (/\/account\/login|\/account\/signup/.test(location.pathname) || /captcha|подтвердите, что вы не робот|не робот/i.test(text)) {
    return { ok: false, error: 'Login or captcha page detected', text: '' };
  }

  const node =
    document.querySelector('[data-qa="vacancy-description"]') ||
    document.querySelector('[data-qa="vacancy-section"]') ||
    document.querySelector('[data-qa="vacancy-view-description"]') ||
    document.querySelector('main') ||
    document.body;

  return {
    ok: true,
    title: document.title,
    text: String(node?.innerText || text)
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .slice(0, 12000)
  };
}

function normalizeVacancyUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(String(value).trim());
    if ((url.hostname !== 'hh.ru' && !url.hostname.endsWith('.hh.ru')) || !/^\/vacancy\/\d+/.test(url.pathname)) {
      return '';
    }
    return url.href;
  } catch {
    return '';
  }
}

async function getVacancyContextByUrl(vacancyUrl) {
  const normalizedUrl = normalizeVacancyUrl(vacancyUrl);
  if (!normalizedUrl) return '';

  const tab = await chrome.tabs.create({ url: normalizedUrl, active: false });
  try {
    await waitForTabReady(tab.id, 30000);
    const [execution] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractVacancyTextScript
    });
    const result = execution?.result || { ok: false, error: 'No vacancy parse result', text: '' };
    if (!result.ok) {
      throw new Error(result.error || 'Vacancy parse failed');
    }
    return String(result.text || '').slice(0, 12000);
  } finally {
    if (tab.id) {
      await chrome.tabs.remove(tab.id).catch(() => {});
    }
  }
}

async function getResumeContext() {
  const {
    resumeUrl = '',
    resumeParsedText = '',
    resumeParsedAt = '',
    resumeText = ''
  } = await storageGet(['resumeUrl', 'resumeParsedText', 'resumeParsedAt', 'resumeText']);
  const normalizedUrl = normalizeResumeUrl(resumeUrl);
  if (!normalizedUrl) {
    return String(resumeText || '').slice(0, 12000);
  }

  const cacheAgeMs = Date.now() - Date.parse(resumeParsedAt || 0);
  if (resumeParsedText && Number.isFinite(cacheAgeMs) && cacheAgeMs < 24 * 60 * 60 * 1000) {
    return String(resumeParsedText).slice(0, 12000);
  }

  const tab = await chrome.tabs.create({ url: normalizedUrl, active: false });
  try {
    await waitForTabReady(tab.id, 30000);
    const [execution] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractResumeTextScript
    });
    const result = execution?.result || { ok: false, error: 'No resume parse result', text: '' };
    if (!result.ok) {
      throw new Error(result.error || 'Resume parse failed');
    }
    const text = String(result.text || '').slice(0, 12000);
    await storageSet({
      resumeParsedText: text,
      resumeParsedAt: nowIso()
    });
    return text;
  } finally {
    if (tab.id) {
      await chrome.tabs.remove(tab.id).catch(() => {});
    }
  }
}

async function callGroq({ task = 'cover_letter', vacancyText = '', extraText = '' }) {
  const {
    groqApiKey,
    groqModel = DEFAULTS.groqModel,
    expectedSalary = '',
    coverPrompt = DEFAULTS.coverPrompt
  } = await storageGet(['groqApiKey', 'groqModel', 'expectedSalary', 'coverPrompt']);

  if (!groqApiKey) {
    throw new Error('Groq API key is not configured');
  }

  const resumeText = await getResumeContext();

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${groqApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: groqModel || DEFAULTS.groqModel,
      messages: buildGroqMessages({
        task,
        resumeText: String(resumeText).slice(0, 12000),
        expectedSalary: String(expectedSalary).slice(0, 1000),
        coverPrompt: String(coverPrompt).slice(0, 4000),
        vacancyText: String(vacancyText).slice(0, 12000),
        extraText: String(extraText).slice(0, 8000)
      }),
      temperature: task === 'test_assist' ? 0.2 : 0.35,
      max_tokens: task === 'test_assist' ? 1200 : task === 'chat_reply' ? 800 : 900
    })
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Groq request failed: ${response.status} ${text.slice(0, 200)}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error('Groq returned an empty response');
  }
  return content;
}

async function generateChatReply({ vacancyUrl = '', vacancyText = '', chatText = '' }) {
  const parsedVacancyText = vacancyText || await getVacancyContextByUrl(vacancyUrl);
  return callGroq({
    task: 'chat_reply',
    vacancyText: parsedVacancyText,
    extraText: chatText
  });
}

async function testGroq() {
  const text = await callGroq({
    task: 'cover_letter',
    vacancyText: 'Вакансия: Java developer. Требуется знание Spring Boot и SQL.'
  });
  return { ok: true, sampleLength: text.length };
}

async function getTabDocumentReadyState(tabId) {
  try {
    const [execution] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => document.readyState
    });
    return execution?.result || '';
  } catch {
    return '';
  }
}

async function waitForTabReady(tabId, timeoutMs = 30000) {
  const currentTab = await chrome.tabs.get(tabId).catch(() => null);
  if (currentTab?.status === 'complete') {
    return;
  }

  const currentReadyState = await getTabDocumentReadyState(tabId);
  if (currentReadyState === 'interactive' || currentReadyState === 'complete') {
    return;
  }

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      clearInterval(poll);
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Tab ready timed out'));
    }, timeoutMs);

    function finish() {
      clearTimeout(timeout);
      clearInterval(poll);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }

    async function checkReady() {
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      if (tab?.status === 'complete') {
        finish();
        return;
      }

      const readyState = await getTabDocumentReadyState(tabId);
      if (readyState === 'interactive' || readyState === 'complete') {
        finish();
      }
    }

    function listener(updatedTabId, info) {
      if (updatedTabId === tabId && (info.status === 'complete' || info.status === 'loading')) {
        checkReady().catch(() => {});
      }
    }

    const poll = setInterval(() => {
      checkReady().catch(() => {});
    }, 500);

    chrome.tabs.onUpdated.addListener(listener);
    checkReady().catch((error) => {
      if (error instanceof Error && /No tab/.test(error.message)) {
        clearTimeout(timeout);
        clearInterval(poll);
        chrome.tabs.onUpdated.removeListener(listener);
        reject(error);
      }
    });
  });
}

function resumeRefreshPageActionScript(kind, actionText = '', status = 'running') {
  const PANEL_ID = 'hh-job-assistant-resume-refresh-panel';
  const CURSOR_ID = 'hh-job-assistant-resume-refresh-cursor';
  const HIGHLIGHT_ATTR = 'data-hh-job-assistant-highlight';

  const visible = (node) => {
    if (!node) return false;
    if (node.disabled || node.getAttribute?.('aria-disabled') === 'true') return false;
    const style = window.getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
  };

  const textOf = (node) =>
    (
      node?.innerText ||
      node?.textContent ||
      node?.value ||
      node?.getAttribute?.('aria-label') ||
      node?.getAttribute?.('title') ||
      ''
    )
      .replace(/\s+/g, ' ')
      .trim();
  const sleep = (ms) => {
    if (window.__HH_JOB_ASSISTANT_TEST_FAST_CLICKS__) return Promise.resolve();
    return new Promise((resolve) => setTimeout(resolve, ms));
  };

  const ensureOverlay = (text, state = 'running') => {
    let panel = document.getElementById(PANEL_ID);
    if (!panel) {
      panel = document.createElement('aside');
      panel.id = PANEL_ID;
      panel.style.cssText = [
        'position:fixed',
        'right:16px',
        'top:16px',
        'z-index:2147483647',
        'width:min(360px,calc(100vw - 32px))',
        'background:#fff',
        'border:1px solid #b6c2d1',
        'box-shadow:0 16px 48px rgba(0,0,0,.22)',
        'border-radius:8px',
        'font:14px/1.45 Arial,sans-serif',
        'color:#1f2937',
        'padding:12px'
      ].join(';');

      const title = document.createElement('strong');
      title.textContent = 'HH Job Assistant';
      title.style.cssText = 'display:block;margin-bottom:6px';

      const body = document.createElement('div');
      body.id = `${PANEL_ID}-body`;
      body.style.cssText = 'white-space:pre-wrap';

      panel.append(title, body);
      document.body.append(panel);
    }

    const body = document.getElementById(`${PANEL_ID}-body`);
    if (body) {
      body.textContent = text || 'Обновление резюме';
      body.style.color = state === 'error' ? '#b91c1c' : '#1f2937';
    }
    panel.style.borderColor = state === 'error' ? '#f2a1a1' : state === 'complete' ? '#86efac' : '#b6c2d1';
  };

  const clearHighlights = () => {
    for (const node of [...document.querySelectorAll(`[${HIGHLIGHT_ATTR}]`)]) {
      node.style.outline = '';
      node.style.boxShadow = '';
      node.removeAttribute?.(HIGHLIGHT_ATTR);
    }
  };

  const showCursorFor = (node) => {
    let cursor = document.getElementById(CURSOR_ID);
    if (!cursor) {
      cursor = document.createElement('div');
      cursor.id = CURSOR_ID;
      cursor.style.cssText = [
        'position:fixed',
        'z-index:2147483647',
        'width:14px',
        'height:14px',
        'border:2px solid #2563eb',
        'border-radius:999px',
        'background:#fff',
        'box-shadow:0 4px 14px rgba(37,99,235,.35)',
        'pointer-events:none',
        'transition:left .15s ease,top .15s ease'
      ].join(';');
      document.body.append(cursor);
    }

    const rect = node.getBoundingClientRect();
    cursor.style.left = `${Math.max(8, rect.left + Math.min(rect.width - 8, 16))}px`;
    cursor.style.top = `${Math.max(8, rect.top + Math.min(rect.height - 8, 12))}px`;
  };

  const highlight = (node) => {
    clearHighlights();
    node.setAttribute?.(HIGHLIGHT_ATTR, 'true');
    node.style.outline = '3px solid #2563eb';
    node.style.boxShadow = '0 0 0 6px rgba(37,99,235,.18)';
    node.scrollIntoView?.({ block: 'center', inline: 'center', behavior: 'smooth' });
    showCursorFor(node);
  };

  const findByText = (root, selectors, patterns, rejectPatterns = []) => {
    const nodes = [...root.querySelectorAll(selectors.join(','))].filter(visible);
    return nodes.find((node) => {
      const text = textOf(node);
      if (rejectPatterns.some((pattern) => pattern.test(text))) return false;
      return patterns.some((pattern) => pattern.test(text));
    });
  };

  const findControl = (patterns, rejectPatterns = []) =>
    findByText(document, ['button', 'a', '[role="button"]', 'input[type="submit"]'], patterns, rejectPatterns);

  const isUnsafePage =
    /\/account\/login|\/account\/signup/.test(location.pathname) ||
    /captcha|подтвердите, что вы не робот|не робот/i.test(document.body.innerText || '');

  return (async () => {
    if (kind === 'status') {
      ensureOverlay(actionText, status);
      return { ok: true, title: document.title, action: 'status' };
    }

    if (kind === 'complete') {
      clearHighlights();
      ensureOverlay(actionText || 'Готово', 'complete');
      return { ok: true, title: document.title, action: 'complete' };
    }

    if (kind === 'error') {
      ensureOverlay(actionText || 'Ошибка', 'error');
      return { ok: true, title: document.title, action: 'error' };
    }

    if (isUnsafePage) {
      ensureOverlay('Login or captcha page detected', 'error');
      return { ok: false, error: 'Login or captcha page detected' };
    }

    if (kind === 'click_edit') {
      ensureOverlay(actionText || 'Нажимаю Редактировать');
      const button = findControl([/редактировать/i, /изменить/i], [/видимость/i, /настро/i]);
      if (!button) return { ok: false, error: 'Edit button not found' };
      highlight(button);
      await sleep(500);
      button.click();
      await sleep(1000);
      return { ok: true, title: document.title, action: 'clicked_edit', href: button.href || '' };
    }

    if (kind === 'click_save') {
      ensureOverlay(actionText || 'Сохраняю без изменений');
      const button = findControl([/сохранить/i, /^готово$/i, /save/i], [/отмена/i, /cancel/i]);
      if (!button) return { ok: false, error: 'Save button not found' };
      highlight(button);
      await sleep(500);
      button.click();
      await sleep(1500);
      return { ok: true, title: document.title, action: 'clicked_save' };
    }

    if (kind === 'find_raise' || kind === 'click_raise') {
      ensureOverlay(actionText || 'Проверяю возможность поднятия');
      const button = findControl(
        [
          /^обновить$/i,
          /поднять(?:\s+резюме)?(?:\s+в\s+поиске)?/i,
          /обновить\s+(?:дату|резюме)/i,
          /обновить\s+в\s+поиске/i
        ],
        [/редактировать/i, /сохранить/i, /создать/i]
      );
      if (!button) {
        return { ok: true, title: document.title, action: 'raise_not_available', raiseSkipped: true };
      }
      highlight(button);
      if (kind === 'find_raise') {
        return { ok: true, title: document.title, action: 'raise_available', raiseSkipped: false };
      }
      await sleep(500);
      button.click();
      await sleep(1500);
      return { ok: true, title: document.title, action: 'clicked_raise', raiseSkipped: false };
    }

    return { ok: false, error: `Unknown resume refresh action: ${kind || 'empty'}` };
  })();
}

async function getActiveHhTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !isHhUrl(tab.url)) {
    throw new Error('Откройте вкладку hh.ru и повторите');
  }
  return tab;
}

async function executeResumeRefreshPageAction(tabId, kind, actionText = '', status = 'running') {
  const [execution] = await chrome.scripting.executeScript({
    target: { tabId },
    func: resumeRefreshPageActionScript,
    args: [kind, actionText, status]
  });
  return execution?.result || { ok: false, error: 'No resume refresh page action result' };
}

async function setResumeRefreshAction(tabId, currentAction, status = 'running') {
  await setRunState({ state: 'refreshing_resumes', currentAction, lastError: '' });
  await executeResumeRefreshPageAction(tabId, 'status', currentAction, status).catch(() => {});
}

async function runCheckedResumePageAction(tabId, kind, currentAction) {
  await setResumeRefreshAction(tabId, currentAction);
  const result = await executeResumeRefreshPageAction(tabId, kind, currentAction);
  if (!result.ok) {
    throw new Error(result.error || `${currentAction} failed`);
  }
  return result;
}

async function runResumeRefresh() {
  let tabId = null;
  let currentAction = 'Открываю резюме';
  let normalizedUrl = '';

  try {
    const { resumeUrl = '' } = await storageGet(['resumeUrl']);
    normalizedUrl = normalizeResumeUrl(resumeUrl);
    if (!normalizedUrl) {
      throw new Error('Укажите Resume URL в настройках');
    }

    const tab = await getActiveHhTab();
    tabId = tab.id;

    await setRunState({
      state: 'refreshing_resumes',
      found: 1,
      processed: 0,
      skipped: 0,
      errors: 0,
      currentAction,
      lastError: ''
    });
    await executeResumeRefreshPageAction(tabId, 'status', currentAction).catch(() => {});

    await chrome.tabs.update(tabId, { url: normalizedUrl });
    await waitForTabReady(tabId, 30000);
    await sleep(1000);
    await executeResumeRefreshPageAction(tabId, 'status', currentAction).catch(() => {});

    currentAction = 'Нажимаю Редактировать';
    const editResult = await runCheckedResumePageAction(tabId, 'click_edit', currentAction);
    await waitForTabReady(tabId, 30000);
    await sleep(1000);

    currentAction = 'Сохраняю без изменений';
    const saveResult = await runCheckedResumePageAction(tabId, 'click_save', currentAction);
    await waitForTabReady(tabId, 30000);
    await sleep(1500);

    currentAction = 'Проверяю возможность поднятия';
    await setResumeRefreshAction(tabId, currentAction);
    const raiseCheck = await executeResumeRefreshPageAction(tabId, 'find_raise', currentAction);
    if (!raiseCheck.ok) {
      throw new Error(raiseCheck.error || 'Raise check failed');
    }

    let raiseResult = raiseCheck;
    if (!raiseCheck.raiseSkipped) {
      currentAction = 'Поднимаю резюме';
      raiseResult = await runCheckedResumePageAction(tabId, 'click_raise', currentAction);
      await waitForTabReady(tabId, 30000);
      await sleep(1000);
    }

    const result = {
      ok: true,
      results: [
        {
          href: normalizedUrl,
          edit: editResult.action,
          save: saveResult.action,
          raise: raiseResult.action,
          raiseSkipped: Boolean(raiseResult.raiseSkipped)
        }
      ],
      raiseSkipped: Boolean(raiseResult.raiseSkipped),
      error: ''
    };

    await appendRunResult({
      index: 0,
      vacancyId: '',
      title: 'Resume refresh',
      url: normalizedUrl,
      status: result.raiseSkipped ? 'resume_refresh_saved' : 'resume_refresh_complete',
      coverLetterUsed: false,
      testDetected: false,
      error: ''
    });

    await setRunState({ state: 'idle', processed: 1, currentAction: 'Готово', lastError: '' });
    await executeResumeRefreshPageAction(tabId, 'complete', 'Готово', 'complete').catch(() => {});
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await setRunState({ state: 'error', errors: 1, currentAction, lastError: message });
    if (tabId) {
      await executeResumeRefreshPageAction(tabId, 'error', `${currentAction}\n${message}`, 'error').catch(() => {});
    }
    return { ok: false, error: message };
  }
}

async function runChatAssistFromActiveTab() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let tab = activeTab;

  if (!tab?.id || !isHhUrl(tab.url)) {
    tab = await chrome.tabs.create({ url: 'https://hh.ru/chat', active: true });
  }

  let tabId = tab.id;
  const tabUrl = new URL(tab.url || 'https://hh.ru/chat');

  if (tabUrl.pathname !== '/chat') {
    const updatedTab = await chrome.tabs.update(tabId, { url: 'https://hh.ru/chat' });
    tabId = updatedTab?.id || tabId;
    await waitForTabReady(tabId, 30000);
    await sleep(1000);
  }

  return chrome.tabs.sendMessage(tabId, { type: 'START_CHAT_ASSIST' });
}

chrome.runtime.onInstalled.addListener(async () => {
  await ensureDefaults();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureDefaults();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    await ensureDefaults();

    switch (message?.type) {
      case 'GET_STATUS': {
        const state = await storageGet(['runState', 'runResults']);
        sendResponse({ ok: true, ...state });
        break;
      }
      case 'GET_CHAT_REPORTS': {
        const { chatReports = [] } = await storageGet(['chatReports']);
        sendResponse({ ok: true, chatReports });
        break;
      }
      case 'CLEAR_CHAT_REPORTS': {
        await storageSet({ chatReports: [] });
        sendResponse({ ok: true });
        break;
      }
      case 'SET_RUN_STATE': {
        await setRunState(message.patch || {});
        sendResponse({ ok: true });
        break;
      }
      case 'APPEND_RUN_RESULT': {
        await appendRunResult(message.item || {});
        sendResponse({ ok: true });
        break;
      }
      case 'APPEND_CHAT_REPORT': {
        await appendChatReport(message.item || {});
        sendResponse({ ok: true });
        break;
      }
      case 'GENERATE_COVER_LETTER': {
        const text = await callGroq({
          task: message.task || 'cover_letter',
          vacancyText: message.vacancyText || '',
          extraText: message.extraText || ''
        });
        sendResponse({ ok: true, text });
        break;
      }
      case 'GENERATE_CHAT_REPLY': {
        const text = await generateChatReply({
          vacancyUrl: message.vacancyUrl || '',
          vacancyText: message.vacancyText || '',
          chatText: message.chatText || ''
        });
        sendResponse({ ok: true, text });
        break;
      }
      case 'TEST_GROQ': {
        const result = await testGroq();
        sendResponse(result);
        break;
      }
      case 'REFRESH_RESUMES_NOW': {
        const result = await runResumeRefresh();
        sendResponse(result);
        break;
      }
      case 'START_CHAT_ASSIST': {
        const result = await runChatAssistFromActiveTab();
        sendResponse(result);
        break;
      }
      default:
        sendResponse({ ok: false, error: `Unknown message type: ${message?.type || 'empty'}` });
    }
  })().catch((error) => {
    sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
  });

  return true;
});

ensureDefaults().catch((error) => {
  console.error('HH Job Assistant initialization failed:', error);
});
