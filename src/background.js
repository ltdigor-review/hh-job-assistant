const DEFAULTS = {
  groqModel: 'llama-3.3-70b-versatile',
  resumeText: '',
  expectedSalary: '',
  coverPrompt: 'Напиши короткое сопроводительное письмо для отклика на вакансию. Тон: деловой, уверенный, без выдуманного опыта.',
  dailyLimit: 20,
  delayMinMs: 8000,
  delayMaxMs: 15000,
  resumeRefreshEnabled: true,
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

const RESUME_REFRESH_ALARM = 'daily_resume_refresh';
let assistantWindowId = null;

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
        'Write a concise, honest cover letter in Russian for hh.ru. Do not invent experience. Return only the cover letter text.'
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

async function callGroq({ task = 'cover_letter', vacancyText = '', extraText = '' }) {
  const {
    groqApiKey,
    groqModel = DEFAULTS.groqModel,
    resumeText = '',
    expectedSalary = '',
    coverPrompt = DEFAULTS.coverPrompt
  } = await storageGet(['groqApiKey', 'groqModel', 'resumeText', 'expectedSalary', 'coverPrompt']);

  if (!groqApiKey) {
    throw new Error('Groq API key is not configured');
  }

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

async function waitForTabComplete(tabId, timeoutMs = 30000) {
  const currentTab = await chrome.tabs.get(tabId).catch(() => null);
  if (currentTab?.status === 'complete') {
    return;
  }

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Tab load timed out'));
    }, timeoutMs);

    function listener(updatedTabId, info) {
      if (updatedTabId === tabId && info.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(listener);
  });
}

function collectResumeLinksScript() {
  const text = document.body?.innerText || '';
  if (/\/account\/login|\/account\/signup/.test(location.pathname) || /captcha|подтвердите, что вы не робот|не робот/i.test(text)) {
    return { ok: false, error: 'Login or captcha page detected', links: [] };
  }

  const links = [...document.querySelectorAll('a[href*="/resume/"]')]
    .map((link) => link.href)
    .filter((href) => /\/resume\//.test(href));

  return { ok: true, links: [...new Set(links)].slice(0, 20) };
}

function clickResumeRefreshScript() {
  const visible = (node) => {
    if (!node) return false;
    const style = window.getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
  };

  const textOf = (node) => (node?.innerText || node?.textContent || '').replace(/\s+/g, ' ').trim();
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const findByText = (root, tags, patterns) => {
    const nodes = [...root.querySelectorAll(tags.join(','))].filter(visible);
    return nodes.find((node) => patterns.some((pattern) => pattern.test(textOf(node))));
  };

  const isUnsafePage =
    /\/account\/login|\/account\/signup/.test(location.pathname) ||
    /captcha|подтвердите, что вы не робот|не робот/i.test(document.body.innerText || '');

  if (isUnsafePage) {
    return { ok: false, error: 'Login or captcha page detected' };
  }

  return (async () => {
    const button = findByText(document, ['button', 'a'], [
      /обновить/i,
      /поднять/i,
      /редактировать/i,
      /сохранить/i
    ]);
    if (!button) return { ok: false, error: 'No update/edit/save button found' };
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
    await waitForTabComplete(tab.id);

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
        await waitForTabComplete(resumeTab.id, 30000);
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

async function openAssistantWindow() {
  if (assistantWindowId !== null) {
    const existingWindow = await chrome.windows.get(assistantWindowId).catch(() => null);
    if (existingWindow) {
      await chrome.windows.update(assistantWindowId, { focused: true });
      return { ok: true, windowId: assistantWindowId };
    }
    assistantWindowId = null;
  }

  const createdWindow = await chrome.windows.create({
    url: chrome.runtime.getURL('src/popup.html?mode=window'),
    type: 'popup',
    width: 420,
    height: 620,
    focused: true
  });
  assistantWindowId = createdWindow.id ?? null;
  return { ok: true, windowId: assistantWindowId };
}

chrome.runtime.onInstalled.addListener(async () => {
  await ensureDefaults();
  await chrome.alarms.create(RESUME_REFRESH_ALARM, {
    delayInMinutes: 5,
    periodInMinutes: 24 * 60
  });
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureDefaults();
  await chrome.alarms.create(RESUME_REFRESH_ALARM, {
    delayInMinutes: 5,
    periodInMinutes: 24 * 60
  });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== RESUME_REFRESH_ALARM) return;
  const { resumeRefreshEnabled = true } = await storageGet(['resumeRefreshEnabled']);
  if (resumeRefreshEnabled) {
    await runResumeRefresh();
  }
});

chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === assistantWindowId) {
    assistantWindowId = null;
  }
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
      case 'OPEN_ASSISTANT_WINDOW': {
        const result = await openAssistantWindow();
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
