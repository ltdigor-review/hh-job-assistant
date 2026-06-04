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
  runState: {
    state: 'idle',
    found: 0,
    processed: 0,
    applied: 0,
    skipped: 0,
    errors: 0,
    lastError: '',
    updatedAt: null
  },
  runResults: []
};

const OLD_DEFAULT_COVER_PROMPT = 'Напиши короткое сопроводительное письмо для отклика на вакансию. Тон: деловой, уверенный, без выдуманного опыта.';

function nowIso() {
  return new Date().toISOString();
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

function buildGroqMessages({ task, resumeText, expectedSalary, coverPrompt, vacancyText, extraText }) {
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
    if (url.hostname !== 'hh.ru' || !/^\/resume\/[^/?#]+/.test(url.pathname)) {
      return '';
    }
    return url.href;
  } catch {
    return '';
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
      max_tokens: task === 'test_assist' ? 1200 : 900
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

function collectResumeLinksScript() {
  const text = document.body?.innerText || '';
  if (/\/account\/login|\/account\/signup/.test(location.pathname) || /captcha|подтвердите, что вы не робот|не робот/i.test(text)) {
    return { ok: false, error: 'Login or captcha page detected', links: [] };
  }

  const links = [...document.querySelectorAll('a[href*="/resume/"]')]
    .map((link) => link.href)
    .filter((href) => /\/resume\/[^/?#]+/.test(href))
    .filter((href) => !/\/resume\/(?:new|edit|print|download)(?:[/?#]|$)/.test(new URL(href).pathname));

  return { ok: true, links: [...new Set(links)].slice(0, 20) };
}

function clickResumeRefreshScript() {
  const visible = (node) => {
    if (!node) return false;
    if (node.disabled || node.getAttribute?.('aria-disabled') === 'true') return false;
    const style = window.getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
  };

  const textOf = (node) => (node?.innerText || node?.textContent || '').replace(/\s+/g, ' ').trim();
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const findByText = (root, selectors, patterns, rejectPatterns = []) => {
    const nodes = [...root.querySelectorAll(selectors.join(','))].filter(visible);
    return nodes.find((node) => {
      const text = textOf(node);
      if (rejectPatterns.some((pattern) => pattern.test(text))) return false;
      return patterns.some((pattern) => pattern.test(text));
    });
  };

  const isUnsafePage =
    /\/account\/login|\/account\/signup/.test(location.pathname) ||
    /captcha|подтвердите, что вы не робот|не робот/i.test(document.body.innerText || '');

  if (isUnsafePage) {
    return { ok: false, error: 'Login or captcha page detected' };
  }

  return (async () => {
    const button = findByText(document, ['button', 'a', '[role="button"]'], [
      /^обновить$/i,
      /поднять(?:\s+резюме)?(?:\s+в\s+поиске)?/i,
      /обновить\s+(?:дату|резюме)/i,
      /обновить\s+в\s+поиске/i
    ], [
      /редактировать/i,
      /сохранить/i,
      /создать/i
    ]);
    if (!button) return { ok: false, error: 'No resume refresh button found' };
    button.click();
    await sleep(1500);
    return { ok: true, title: document.title, action: 'clicked_resume_button' };
  })();
}

async function runResumeRefresh() {
  await setRunState({ state: 'refreshing_resumes', lastError: '' });

  const tab = await chrome.tabs.create({
    url: 'https://hh.ru/applicant/resumes',
    active: false
  });

  try {
    await waitForTabReady(tab.id);

    const [execution] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: collectResumeLinksScript
    });

    const collected = execution?.result || { ok: false, error: 'No resume links result', links: [] };
    if (!collected.ok) {
      throw new Error(collected.error || 'Resume link collection failed');
    }

    const links = collected.links.length > 0 ? collected.links : ['https://hh.ru/applicant/resumes'];
    const results = [];

    for (const href of links) {
      const resumeTab = await chrome.tabs.create({ url: href, active: false });
      try {
        await waitForTabReady(resumeTab.id, 30000);
        const [resumeExecution] = await chrome.scripting.executeScript({
          target: { tabId: resumeTab.id },
          func: clickResumeRefreshScript
        });
        results.push({
          href,
          ...(resumeExecution?.result || { ok: false, error: 'No resume click result' })
        });
      } catch (error) {
        results.push({
          href,
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      } finally {
        if (resumeTab.id) {
          await chrome.tabs.remove(resumeTab.id).catch(() => {});
        }
      }
    }

    const failed = results.filter((item) => !item.ok);
    const result = {
      ok: failed.length === 0,
      results,
      error: failed.length > 0 ? `${failed.length} resume refresh actions failed` : ''
    };

    await appendRunResult({
      index: 0,
      vacancyId: '',
      title: 'Resume refresh',
      url: tab.url || '',
      status: result.ok ? 'resume_refresh_complete' : 'resume_refresh_error',
      coverLetterUsed: false,
      testDetected: false,
      error: result.ok ? '' : result.error || 'Unknown refresh error'
    });

    if (!result.ok) {
      throw new Error(result.error || 'Resume refresh failed');
    }

    await setRunState({ state: 'idle', lastError: '' });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await setRunState({ state: 'error', errors: 1, lastError: message });
    return { ok: false, error: message };
  } finally {
    if (tab.id) {
      await chrome.tabs.remove(tab.id).catch(() => {});
    }
  }
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
      case 'GENERATE_COVER_LETTER': {
        const text = await callGroq({
          task: message.task || 'cover_letter',
          vacancyText: message.vacancyText || '',
          extraText: message.extraText || ''
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
