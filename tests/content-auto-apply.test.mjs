import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readContentScriptSource } from './helpers/content-script-source.mjs';
import { FakeElement } from './helpers/fake-element.mjs';

async function runContentAutoApply({
  messageType = 'START_AUTO_APPLY',
  dialogText,
  hasTextarea,
  exactCardSelectorMatches = true,
  broadVacancySelectorIncludesButton = false,
  startOnResponseForm = false,
  hasQuestionField = false,
  hasContentEditableQuestion = false,
  hasCoverLetterField = false,
  bodyText = 'HH вакансии',
  responseHref = '',
  responseAttrs = {},
  navigateOnResponseClick = false,
  delayedNavigateOnResponseClick = false,
  bodyTextAfterResponseClick = '',
  expectedSalary = '',
  initialFollowupDialogText = '',
  initialFollowupBodyOnlyText = '',
  followupDialogText = '',
  followupConfirmText = 'Все равно откликнуться',
  disabledSubmit = false,
  keepDialogOpenAfterSubmit = false,
  postSubmitDialogText = '',
  hideDialogReadsAfterSubmit = 0,
  nextPageUrl = '',
  dailyLimit = 1,
  questionControls = [],
  groqResponse = { ok: false, error: 'Groq API key is not configured' },
  runtimeMessageTimeoutMs = 0,
  runtimeSendErrors = {},
  runtimeCallbackOnly = false,
  message = null,
  initialLocalStore = null,
  sendMessageAfterImport = true,
  authenticated = true
}) {
  const source = await readContentScriptSource();
  const appended = [];
  const states = [];
  const groqRequests = [];
  let submitClicks = 0;
  let followupClicks = 0;
  let navigateUrl = '';
  let listener = null;
  let dialog = null;
  let bodyOnlyFollowupOpen = false;
  let bodyNode = null;
  let hiddenDialogReads = 0;
  const localStore = {};
  Object.assign(localStore, initialLocalStore || {});

  const textarea = new FakeElement({
    text: hasQuestionField ? 'Писать тут' : '',
    attrs: hasQuestionField ? { name: 'task_235076159_text' } : {}
  });
  const contentEditableQuestion = new FakeElement({
    text: hasContentEditableQuestion ? 'Писать тут' : '',
    attrs: hasContentEditableQuestion ? { contenteditable: 'true' } : {}
  });
  const coverTextarea = new FakeElement({
    text: hasCoverLetterField ? 'Сопроводительное письмо обязательное' : '',
    attrs: hasCoverLetterField ? { 'data-qa': 'vacancy-response-letter-input' } : {}
  });
  const selectableControls = questionControls.map((item) => {
    const input = new FakeElement({
      type: item.type,
      value: item.value || item.label,
      attrs: { type: item.type, name: item.name || '', value: item.value || item.label }
    });
    input.parentElement = new FakeElement({ text: item.label });
    return { ...item, input };
  });
  const closeButton = new FakeElement({
    text: 'Закрыть',
    attrs: { 'aria-label': 'Закрыть' },
    click() {
      dialog = null;
    }
  });
  const followupConfirmButton = new FakeElement({
    text: followupConfirmText,
    click() {
      followupClicks += 1;
      dialog = null;
    }
  });
  const submitButton = new FakeElement({
    text: 'Отправить',
    disabled: disabledSubmit,
    click() {
      submitClicks += 1;
      if (followupDialogText) {
        dialog = new FakeElement({
          text: followupDialogText,
          selectorMap: {
            '[data-qa="bloko-modal-close"]': [closeButton],
            button: [followupConfirmButton, closeButton]
          }
        });
        hiddenDialogReads = hideDialogReadsAfterSubmit;
      } else if (postSubmitDialogText) {
        dialog = new FakeElement({
          text: postSubmitDialogText,
          selectorMap: {
            '[data-qa="vacancy-response-submit-popup"]': [submitButton],
            '[data-qa="vacancy-response-letter-submit"]': [submitButton],
            '[data-qa*="submit"]': [submitButton],
            '[data-qa="bloko-modal-close"]': [closeButton],
            button: [submitButton, closeButton]
          }
        });
        hiddenDialogReads = hideDialogReadsAfterSubmit;
      } else if (!keepDialogOpenAfterSubmit) {
        dialog = null;
      }
    }
  });
  function openResponseDialog() {
    dialog = new FakeElement({
      text: dialogText,
      selectorMap: {
        '[data-qa="vacancy-response-popup-form-letter-input"]': hasCoverLetterField ? [coverTextarea] : hasTextarea ? [textarea] : [],
        '[data-qa="vacancy-response-letter-input"]': hasCoverLetterField ? [coverTextarea] : hasTextarea ? [textarea] : [],
        '[data-qa="vacancy-response-submit-popup"]': [submitButton],
        '[data-qa="vacancy-response-letter-submit"]': [submitButton],
        '[data-qa*="submit"]': [submitButton],
        'input[type="checkbox"]': selectableControls.filter((item) => item.type === 'checkbox').map((item) => item.input),
        'input[type="radio"]': selectableControls.filter((item) => item.type === 'radio').map((item) => item.input),
        textarea: [hasQuestionField || hasTextarea ? textarea : null, hasCoverLetterField ? coverTextarea : null].filter(Boolean),
        '[data-qa="bloko-modal-close"]': [closeButton],
        button: [submitButton, closeButton]
      }
    });
  }
  const initialFollowupConfirmButton = new FakeElement({
    text: followupConfirmText,
    click() {
      followupClicks += 1;
      bodyOnlyFollowupOpen = false;
      if (bodyNode) {
        bodyNode.innerText = bodyText;
        bodyNode.textContent = bodyText;
      }
      openResponseDialog();
    }
  });
  const responseButton = new FakeElement({
    text: 'Откликнуться',
    href: responseHref,
    attrs: responseAttrs,
    click() {
      if (bodyTextAfterResponseClick && bodyNode) {
        bodyNode.innerText = bodyTextAfterResponseClick;
        bodyNode.textContent = bodyTextAfterResponseClick;
      }
      if (navigateOnResponseClick && responseHref) {
        const parsed = new URL(responseHref);
        globalThis.location.href = parsed.href;
        globalThis.location.pathname = parsed.pathname;
      }
      if (delayedNavigateOnResponseClick && responseHref) {
        queueMicrotask(() => {
          const parsed = new URL(responseHref);
          globalThis.location.href = parsed.href;
          globalThis.location.pathname = parsed.pathname;
        });
      }
      if (initialFollowupBodyOnlyText) {
        bodyOnlyFollowupOpen = true;
        if (bodyNode) {
          bodyNode.innerText = initialFollowupBodyOnlyText;
          bodyNode.textContent = initialFollowupBodyOnlyText;
        }
        return;
      }
      if (initialFollowupDialogText) {
        dialog = new FakeElement({
          text: initialFollowupDialogText,
          selectorMap: {
            '[data-qa="bloko-modal-close"]': [closeButton],
            button: [initialFollowupConfirmButton, closeButton]
          }
        });
        return;
      }
      openResponseDialog();
    }
  });
  const titleLink = new FakeElement({
    text: 'Java Developer',
    href: 'https://hh.ru/vacancy/123'
  });
  const nextLink = nextPageUrl ? new FakeElement({ text: 'дальше', href: nextPageUrl }) : null;
  const card = new FakeElement({
    text: 'Java Developer\nООО Test\nОткликнуться',
    selectorMap: {
      '[data-qa="serp-item__title"]': [titleLink],
      'a[href*="/vacancy/"]': [titleLink],
      '[data-qa="vacancy-serp__vacancy_response"]': [responseButton],
      '[data-qa="vacancy-response-link-top"]': [],
      '[data-qa="vacancy-response-link-bottom"]': [],
      'a[href*="vacancy_response"]': [],
      button: [responseButton]
    }
  });
  responseButton.parentElement = card;
  titleLink.parentElement = card;

  globalThis.location = startOnResponseForm
    ? {
        href: 'https://hh.ru/applicant/vacancy_response?vacancyId=123',
        pathname: '/applicant/vacancy_response'
      }
    : {
        href: 'https://hh.ru/search/vacancy?text=java',
        pathname: '/search/vacancy'
      };
  globalThis.window = {
    __HH_JOB_ASSISTANT_TEST_AUTHENTICATED__: authenticated,
    __HH_JOB_ASSISTANT_TEST_FAST_CLICKS__: true,
    __HH_JOB_ASSISTANT_TEST_RUNTIME_TIMEOUT_MS__: runtimeMessageTimeoutMs,
    __HH_JOB_ASSISTANT_TEST_NAVIGATE__(url) {
      navigateUrl = url;
    },
    getComputedStyle() {
      return { visibility: 'visible', display: 'block' };
    }
  };
  globalThis.__HH_JOB_ASSISTANT_TEST_AUTHENTICATED__ = authenticated;
  globalThis.getComputedStyle = globalThis.window.getComputedStyle;
  bodyNode = new FakeElement({ text: bodyText });
  globalThis.Event = class Event {
    constructor(type) {
      this.type = type;
    }
  };
  globalThis.KeyboardEvent = class KeyboardEvent extends globalThis.Event {
    constructor(type, options = {}) {
      super(type);
      Object.assign(this, options);
    }
  };
  globalThis.document = {
    title: 'HH test page',
    body: bodyNode,
    querySelectorAll(selector) {
      const currentResponseForm = /\/applicant\/vacancy_response/.test(globalThis.location?.pathname || '');
      if (selector.includes(',')) {
        return selector.split(',').flatMap((part) => this.querySelectorAll(part.trim()));
      }
      if (selector === '[data-qa="vacancy-serp__vacancy"]') return currentResponseForm || startOnResponseForm || !exactCardSelectorMatches ? [] : [card];
      if (selector === '[data-qa="serp-item"]') return [];
      if (selector === '[data-qa*="vacancy-serp"]') {
        if (currentResponseForm || startOnResponseForm) return [];
        return broadVacancySelectorIncludesButton ? [card, responseButton] : [card];
      }
      if (selector === 'a[data-qa="pager-next"]') return nextLink ? [nextLink] : [];
      if (selector === '[data-qa="pager-next"] a') return [];
      if (selector === 'a[rel="next"]') return [];
      if (selector === 'a[href*="page="]') return nextLink ? [nextLink] : [];
      if ((currentResponseForm || startOnResponseForm) && selector === '[data-qa="vacancy-response-submit-popup"]') return [submitButton];
      if ((currentResponseForm || startOnResponseForm) && selector === '[data-qa="vacancy-response-letter-submit"]') return [submitButton];
      if ((currentResponseForm || startOnResponseForm) && selector === '[data-qa*="submit"]') return [submitButton];
      if ((currentResponseForm || startOnResponseForm) && selector === 'textarea') {
        return [hasQuestionField || hasTextarea ? textarea : null, hasCoverLetterField ? coverTextarea : null].filter(Boolean);
      }
      if ((currentResponseForm || startOnResponseForm) && selector === '[contenteditable="true"]') {
        return hasContentEditableQuestion ? [contentEditableQuestion] : [];
      }
      if ((currentResponseForm || startOnResponseForm) && selector === 'input[type="checkbox"]') {
        return selectableControls.filter((item) => item.type === 'checkbox').map((item) => item.input);
      }
      if ((currentResponseForm || startOnResponseForm) && selector === 'input[type="radio"]') {
        return selectableControls.filter((item) => item.type === 'radio').map((item) => item.input);
      }
      if ((currentResponseForm || startOnResponseForm) && selector === 'button') return [submitButton];
      if (bodyOnlyFollowupOpen && selector === 'button') return [initialFollowupConfirmButton];
      if (selector === '[role="dialog"]') {
        if (dialog && hiddenDialogReads > 0) {
          hiddenDialogReads -= 1;
          return [];
        }
        return dialog ? [dialog] : [];
      }
      if (selector === '[data-qa*="modal"]') return [];
      if (selector === '.bloko-modal') return [];
      if (selector === '.magritte-modal') return [];
      return [];
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    },
    getElementById() {
      return null;
    },
    dispatchEvent(event) {
      if (event.key === 'Escape') {
        dialog = null;
      }
    },
    createElement() {
      return new FakeElement();
    }
  };
  globalThis.chrome = {
    runtime: {
      lastError: null,
      onMessage: {
        addListener(fn) {
          listener = fn;
        }
      },
      sendMessage(message, callback) {
        const settle = (response) => {
          if (typeof callback === 'function') {
            Promise.resolve(response).then((value) => callback(value));
            return undefined;
          }
          return Promise.resolve(response);
        };
        if (runtimeSendErrors[message.type]) {
          throw new Error(runtimeSendErrors[message.type]);
        }
        if (message.type === 'SET_RUN_STATE') {
          states.push(message.patch);
          return settle({ ok: true });
        }
        if (message.type === 'APPEND_RUN_RESULT') {
          appended.push(message.item);
          return settle({ ok: true });
        }
        if (message.type === 'GENERATE_COVER_LETTER') {
          groqRequests.push(message);
          if (Array.isArray(groqResponse)) {
            return settle(groqResponse[Math.min(groqRequests.length - 1, groqResponse.length - 1)]);
          }
          if (runtimeCallbackOnly) {
            queueMicrotask(() => callback?.(groqResponse));
            return undefined;
          }
          return settle(groqResponse);
        }
        return settle({ ok: true });
      }
    },
    storage: {
      local: {
        async get() {
          return { dailyLimit, delayMinMs: 1, delayMaxMs: 1, expectedSalary, ...localStore };
        },
        async set(value) {
          Object.assign(localStore, value);
        }
      }
    }
  };

  await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${crypto.randomUUID()}`);
  assert.ok(listener, 'content script should register a listener');

  let response = null;
  if (sendMessageAfterImport) {
    response = await new Promise((resolve) => {
      const stayedAsync = listener(message || { type: messageType }, {}, resolve);
      assert.equal(stayedAsync, true);
    });
  } else {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return {
    response,
    appended,
    states,
    groqRequests,
    submitClicks,
    followupClicks,
    textareaValue: textarea.value,
    contentEditableQuestionText: contentEditableQuestion.textContent,
    coverTextareaValue: coverTextarea.value,
    checkedLabels: selectableControls.filter((item) => item.input.checked).map((item) => item.label),
    localStore,
    responseButtonTarget: responseButton.getAttribute('target'),
    navigateUrl,
    bodyCursor: globalThis.document.body.style.cursor || '',
    dialogOpen: Boolean(dialog)
  };
}

async function runQueuedResponsePages({ count = 20, expectedSalary = '250 000 руб. на руки' } = {}) {
  const source = await readContentScriptSource();
  const appended = [];
  const states = [];
  const navigations = [];
  let submitClicks = 0;

  const items = Array.from({ length: count }, (_, index) => {
    const vacancyId = String(1000 + index);
    return {
      index: index + 1,
      vacancyId,
      title: `Vacancy ${index + 1}`,
      url: `https://hh.ru/vacancy/${vacancyId}`,
      responseUrl: `https://hh.ru/applicant/vacancy_response?vacancyId=${vacancyId}`,
      testDetected: true
    };
  });

  const localStore = {
    expectedSalary,
    autoApplyQueue: {
      active: true,
      runId: 'test-run',
      index: 0,
      items,
      sourceUrl: 'https://hh.ru/search/vacancy?text=java',
      limit: count,
      counters: {
        found: count,
        processed: 0,
        applied: 0,
        skipped: 0,
        errors: 0
      },
      config: {
        delayMinMs: 1,
        delayMaxMs: 1
      }
    }
  };

  for (let pageIndex = 0; pageIndex < count; pageIndex += 1) {
    globalThis.__HH_JOB_ASSISTANT_TEST_AUTHENTICATED__ = true;
    const textarea = new FakeElement({
      text: 'Писать тут',
      attrs: { name: `task_${pageIndex}_text` }
    });
    const submitButton = new FakeElement({
      text: 'Откликнуться',
      click() {
        submitClicks += 1;
      }
    });

    globalThis.location = {
      href: items[pageIndex].responseUrl,
      pathname: '/applicant/vacancy_response'
    };
    globalThis.window = {
      __HH_JOB_ASSISTANT_TEST_AUTHENTICATED__: true,
      __HH_JOB_ASSISTANT_TEST_FAST_CLICKS__: true,
      __HH_JOB_ASSISTANT_TEST_NAVIGATE__(url) {
        navigations.push(url);
      },
      getComputedStyle() {
        return { visibility: 'visible', display: 'block' };
      }
    };
    globalThis.getComputedStyle = globalThis.window.getComputedStyle;
    globalThis.Event = class Event {
      constructor(type) {
        this.type = type;
      }
    };
    globalThis.KeyboardEvent = class KeyboardEvent extends globalThis.Event {
      constructor(type, options = {}) {
        super(type);
        Object.assign(this, options);
      }
    };
    globalThis.document = {
      title: 'HH queued response page',
      body: new FakeElement({ text: 'Отклик на вакансию Ответьте на вопросы Писать тут Откликнуться' }),
      querySelectorAll(selector) {
        if (selector.includes(',')) {
          return selector.split(',').flatMap((part) => this.querySelectorAll(part.trim()));
        }
        if (selector === '[data-qa="vacancy-serp__vacancy"]') return [];
        if (selector === '[data-qa="serp-item"]') return [];
        if (selector === '[data-qa*="vacancy-serp"]') return [];
        if (selector === '[data-qa="vacancy-response-submit-popup"]') return [submitButton];
        if (selector === '[data-qa="vacancy-response-letter-submit"]') return [submitButton];
        if (selector === '[data-qa*="submit"]') return [submitButton];
        if (selector === 'textarea') return [textarea];
        if (selector === 'button') return [submitButton];
        if (selector === '[role="dialog"]') return [];
        if (selector === '[data-qa*="modal"]') return [];
        if (selector === '.bloko-modal') return [];
        if (selector === '.magritte-modal') return [];
        return [];
      },
      querySelector(selector) {
        return this.querySelectorAll(selector)[0] || null;
      },
      getElementById() {
        return null;
      },
      dispatchEvent() {},
      createElement() {
        return new FakeElement();
      }
    };
    globalThis.chrome = {
      runtime: {
        lastError: null,
        onMessage: {
          addListener() {}
        },
        sendMessage(message, callback) {
          const settle = (response) => {
            if (typeof callback === 'function') {
              Promise.resolve(response).then((value) => callback(value));
              return undefined;
            }
            return Promise.resolve(response);
          };
          if (message.type === 'SET_RUN_STATE') {
            states.push(message.patch);
            return settle({ ok: true });
          }
          if (message.type === 'APPEND_RUN_RESULT') {
            appended.push(message.item);
            return settle({ ok: true });
          }
          if (message.type === 'GENERATE_COVER_LETTER') {
            return settle({ ok: false, error: 'Groq API key is not configured' });
          }
          return settle({ ok: true });
        }
      },
      storage: {
        local: {
          async get() {
            return { dailyLimit: count, delayMinMs: 1, delayMaxMs: 1, expectedSalary, ...localStore };
          },
          async set(value) {
            Object.assign(localStore, value);
          }
        }
      }
    };

    await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#queued-${pageIndex}-${crypto.randomUUID()}`);
    const started = Date.now();
    while (
      (textarea.value !== expectedSalary ||
        submitClicks < pageIndex + 1 ||
        localStore.autoApplyQueue.index < pageIndex + 1) &&
      Date.now() - started < 3000
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(textarea.value, expectedSalary);
    assert.equal(submitClicks, pageIndex + 1);
    assert.equal(localStore.autoApplyQueue.index, pageIndex + 1);
  }

  return { appended, states, navigations, submitClicks, localStore };
}

test('auto apply skips cover-letter vacancy when Groq key is missing', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Добавьте сопроводительное письмо\nОтправить',
    hasTextarea: true
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 0);
  assert.equal(result.response.skipped, 1);
  assert.equal(result.appended.at(-1).status, 'skipped_missing_groq_key');
  assert.match(result.appended.at(-1).error, /Groq API key is missing/);
});

test('auto apply stops before response link that redirects to signup', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Отклик на вакансию',
    hasTextarea: false,
    responseHref: 'https://hh.ru/account/signup?backurl=https%3A%2F%2Fhh.ru%2Fsearch%2Fvacancy%3Ftext%3Djava'
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.appended.at(-1).status, 'error');
  assert.match(result.appended.at(-1).error, /Login or signup page detected/);
  assert.equal(result.states.some((state) => state.state === 'error'), true);
});

test('auto apply requires hh authorization before scanning vacancies', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Отклик на вакансию',
    hasTextarea: false,
    bodyText: 'HH вакансии\nВойти\nЗарегистрироваться',
    authenticated: false
  });

  assert.equal(result.response.ok, false);
  assert.match(result.response.error, /authorization required/i);
  assert.equal(result.appended.length, 0);
  assert.equal(result.submitClicks, 0);
  assert.equal(result.states.at(-1).state, 'error');
});

test('dry run scans vacancies without clicking response buttons', async () => {
  const result = await runContentAutoApply({
    messageType: 'START_DRY_RUN',
    dialogText: 'Отклик на вакансию',
    hasTextarea: false
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.found, 1);
  assert.equal(result.submitClicks, 0);
  assert.equal(result.appended.at(-1).status, 'dry_run_ready');
  assert.equal(result.states.at(-1).state, 'dry_run_complete');
});

test('dry run requires hh authorization before scanning vacancies', async () => {
  const result = await runContentAutoApply({
    messageType: 'START_DRY_RUN',
    dialogText: 'Отклик на вакансию',
    hasTextarea: false,
    bodyText: 'HH вакансии\nВойти',
    authenticated: false
  });

  assert.equal(result.response.ok, false);
  assert.match(result.response.error, /authorization required/i);
  assert.equal(result.appended.length, 0);
  assert.equal(result.states.at(-1).state, 'error');
});

test('dry run ignores standalone response buttons from broad hh vacancy selector', async () => {
  const result = await runContentAutoApply({
    messageType: 'START_DRY_RUN',
    dialogText: 'Отклик на вакансию',
    hasTextarea: false,
    exactCardSelectorMatches: false,
    broadVacancySelectorIncludesButton: true
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.found, 1);
  assert.equal(result.appended.length, 1);
  assert.equal(result.appended.at(-1).vacancyId, '123');
  assert.equal(result.appended.at(-1).url, 'https://hh.ru/vacancy/123');
  assert.equal(result.appended.at(-1).status, 'dry_run_ready');
});

test('content script tolerates extension context invalidated during status update', async () => {
  const result = await runContentAutoApply({
    messageType: 'START_DRY_RUN',
    dialogText: 'Отклик на вакансию',
    hasTextarea: false,
    runtimeSendErrors: {
      SET_RUN_STATE: 'Extension context invalidated.'
    }
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.found, 1);
  assert.equal(result.submitClicks, 0);
});

test('auto apply skips test vacancy when no fillable question fields are found', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Тест\nОтветьте на вопросы работодателя',
    hasTextarea: false
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 0);
  assert.equal(result.response.skipped, 1);
  assert.equal(result.appended.at(-1).status, 'skipped_question_fields_not_found');
  assert.equal(result.appended.at(-1).testDetected, true);
  assert.match(result.appended.at(-1).error, /no fillable HH question fields/);
});

test('auto apply does not submit test vacancy when Groq answers but no fields are found', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Тест\nОтветьте на вопросы работодателя\nОтправить',
    hasTextarea: false,
    groqResponse: { ok: true, text: 'Краткая подсказка по тесту' }
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 0);
  assert.equal(result.response.skipped, 1);
  assert.equal(result.submitClicks, 0);
  assert.equal(result.appended.at(-1).status, 'skipped_question_fields_not_found');
  assert.equal(result.appended.at(-1).testDetected, true);
});

test('auto apply skips vacancy when hh disables response because resume visibility is wrong', async () => {
  const result = await runContentAutoApply({
    dialogText: [
      'Чтобы откликнуться на эту вакансию, поменяйте видимость резюме на «Видно компаниям-клиентам HeadHunter»',
      'Откликнуться'
    ].join('\n'),
    hasTextarea: false,
    disabledSubmit: true
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 0);
  assert.equal(result.response.skipped, 1);
  assert.equal(result.response.errors, 0);
  assert.equal(result.submitClicks, 0);
  assert.equal(result.dialogOpen, false);
  assert.equal(result.appended.at(-1).status, 'skipped_response_unavailable');
  assert.match(result.appended.at(-1).error, /Resume visibility/);
});

test('auto apply skips open response form when blocked text is only in document body', async () => {
  const result = await runContentAutoApply({
    dialogText: '',
    hasTextarea: false,
    startOnResponseForm: true,
    disabledSubmit: true,
    bodyText: 'Чтобы откликнуться на эту вакансию, поменяйте видимость резюме на «Видно компаниям-клиентам HeadHunter»'
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 0);
  assert.equal(result.response.skipped, 1);
  assert.equal(result.response.errors, 0);
  assert.equal(result.submitClicks, 0);
  assert.equal(result.dialogOpen, false);
  assert.equal(result.appended.at(-1).status, 'skipped_response_unavailable');
  assert.match(result.appended.at(-1).error, /^Skipped: Resume visibility/);
});

test('auto apply counts already applied open response form without submit button as confirmed', async () => {
  const result = await runContentAutoApply({
    dialogText: '',
    hasTextarea: false,
    startOnResponseForm: true,
    bodyText: 'Отклик на вакансию Вы откликнулись Чат'
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 1);
  assert.equal(result.response.skipped, 0);
  assert.equal(result.submitClicks, 0);
  assert.equal(result.appended.at(-1).status, 'applied_already_confirmed');
  assert.equal(result.states.at(-1).state, 'complete');
  assert.equal(result.states.at(-1).currentAction, '');
});

test('auto apply closes blocked response dialog and continues to next hh page', async () => {
  const result = await runContentAutoApply({
    dialogText: [
      'Чтобы откликнуться на эту вакансию, поменяйте видимость резюме на «Видно компаниям-клиентам HeadHunter»',
      'Откликнуться'
    ].join('\n'),
    hasTextarea: false,
    disabledSubmit: true,
    dailyLimit: 2,
    nextPageUrl: 'https://hh.ru/search/vacancy?text=java&page=1'
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 0);
  assert.equal(result.response.skipped, 1);
  assert.equal(result.response.errors, 0);
  assert.equal(result.submitClicks, 0);
  assert.equal(result.dialogOpen, false);
  assert.equal(result.navigateUrl, 'https://hh.ru/search/vacancy?text=java&page=1');
  assert.equal(result.localStore.autoApplySearchQueue.active, true);
  assert.equal(result.appended.at(-1).status, 'skipped_response_unavailable');
});

test('auto apply does not count submit as sent when hh keeps response dialog open', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Откликнуться',
    hasTextarea: false,
    postSubmitDialogText: [
      'Чтобы откликнуться на эту вакансию, поменяйте видимость резюме на «Видно компаниям-клиентам HeadHunter»',
      'Откликнуться'
    ].join('\n')
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 0);
  assert.equal(result.response.skipped, 1);
  assert.equal(result.response.errors, 0);
  assert.equal(result.submitClicks, 1);
  assert.equal(result.dialogOpen, false);
  assert.equal(result.appended.at(-1).status, 'skipped_response_unavailable');
  assert.match(result.appended.at(-1).error, /Resume visibility/);
});

test('auto apply confirms country warning follow-up modal', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Откликнуться',
    hasTextarea: false,
    followupDialogText: [
      'Вы откликаетесь на вакансию в другой стране',
      'Если это не удалённая работа и вы не указали, что хотите переехать, скорее всего, будет отказ',
      'Все равно откликнуться',
      'Отменить'
    ].join('\n')
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 1);
  assert.equal(result.response.skipped, 0);
  assert.equal(result.submitClicks, 1);
  assert.equal(result.followupClicks, 1);
  assert.equal(result.appended.at(-1).status, 'applied');
});

test('auto apply confirms country warning before response form opens', async () => {
  const result = await runContentAutoApply({
    initialFollowupDialogText: [
      'Вы откликаетесь на вакансию в другой стране',
      'Если это не удалённая работа и вы не указали, что хотите переехать, скорее всего, будет отказ',
      'Все равно откликнуться',
      'Отменить'
    ].join('\n'),
    dialogText: 'Откликнуться',
    hasTextarea: false
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 1);
  assert.equal(result.response.skipped, 0);
  assert.equal(result.submitClicks, 1);
  assert.equal(result.followupClicks, 1);
  assert.equal(result.appended.at(-1).status, 'applied');
});

test('auto apply confirms country warning when hh modal is only in document body', async () => {
  const result = await runContentAutoApply({
    initialFollowupBodyOnlyText: [
      'CTO / Chief Technology Officer',
      'Вы откликаетесь на вакансию в другой стране',
      'Если это не удалённая работа и вы не указали, что хотите переехать, скорее всего, будет отказ',
      'Всё равно откликнуться',
      'Отменить'
    ].join('\n'),
    followupConfirmText: 'Всё равно откликнуться',
    dialogText: 'Откликнуться',
    hasTextarea: false
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 1);
  assert.equal(result.response.skipped, 0);
  assert.equal(result.submitClicks, 1);
  assert.equal(result.followupClicks, 1);
  assert.equal(result.appended.at(-1).status, 'applied');
});

test('auto apply confirms country warning that remains open during submit verification', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Откликнуться',
    hasTextarea: false,
    followupDialogText: [
      'Вы откликаетесь на вакансию в другой стране',
      'Если это не удалённая работа и вы не указали, что хотите переехать, скорее всего, будет отказ',
      'Все равно откликнуться',
      'Отменить'
    ].join('\n'),
    hideDialogReadsAfterSubmit: 1
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 1);
  assert.equal(result.response.skipped, 0);
  assert.equal(result.submitClicks, 1);
  assert.equal(result.followupClicks, 1);
  assert.equal(result.dialogOpen, false);
  assert.equal(result.appended.at(-1).status, 'applied');
});

test('auto apply fills required question on open response form', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Откликнуться',
    hasTextarea: true,
    startOnResponseForm: true,
    hasQuestionField: true,
    groqResponse: { ok: true, text: '250 000 руб. на руки' }
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 1);
  assert.equal(result.response.skipped, 0);
  assert.equal(result.submitClicks, 1);
  assert.equal(result.textareaValue, '250 000 руб. на руки');
  assert.equal(result.appended.at(-1).status, 'applied_test_assisted');
  assert.ok(result.states.some((state) => state.currentAction === 'ИИ: отвечаю на вопросы работодателя'));
  assert.ok(result.states.some((state) => state.currentAction === 'Заполняю вопросы работодателя'));
  assert.equal(result.bodyCursor, '');
});

test('auto apply strips markdown from generated question answers before submit', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Откликнуться\nНа какой уровень дохода вы ориентируетесь?',
    hasTextarea: true,
    startOnResponseForm: true,
    hasQuestionField: true,
    groqResponse: { ok: true, text: '**250 000 руб. на руки**' }
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 1);
  assert.equal(result.submitClicks, 1);
  assert.equal(result.textareaValue, '250 000 руб. на руки');
  assert.equal(result.appended.at(-1).status, 'applied_test_assisted');
});

test('auto apply fills contenteditable employer question fields', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Откликнуться\nНа какой уровень дохода вы ориентируетесь?',
    hasTextarea: false,
    startOnResponseForm: true,
    hasContentEditableQuestion: true,
    groqResponse: { ok: true, text: '250 000 руб. на руки' }
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 1);
  assert.equal(result.submitClicks, 1);
  assert.equal(result.contentEditableQuestionText, '250 000 руб. на руки');
  assert.equal(result.appended.at(-1).status, 'applied_test_assisted');
});

test('auto apply skips generated question answers that still look like model garbage', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Откликнуться\nРасскажите про релевантный опыт',
    hasTextarea: true,
    startOnResponseForm: true,
    hasQuestionField: true,
    groqResponse: { ok: true, text: '{"role":"assistant","content":"делал проекты"}' }
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 0);
  assert.equal(result.response.skipped, 1);
  assert.equal(result.submitClicks, 0);
  assert.equal(result.appended.at(-1).status, 'skipped_bad_generated_answer');
});

test('auto apply puts only labeled free-text answer into question field', async () => {
  const result = await runContentAutoApply({
    dialogText: [
      'Отклик на вакансию',
      'Готовы ли вы работать в гибридном графике?',
      'Да',
      'Нет',
      'Готовы ли пройти тестовое задание?',
      'Да',
      'Нет',
      'Расскажите про релевантный опыт'
    ].join('\n'),
    hasTextarea: true,
    startOnResponseForm: true,
    hasQuestionField: true,
    questionControls: [
      { type: 'radio', name: 'hybrid', label: 'Да', value: 'hybrid_yes' },
      { type: 'radio', name: 'hybrid', label: 'Нет', value: 'hybrid_no' },
      { type: 'radio', name: 'test_task', label: 'Да', value: 'task_yes' },
      { type: 'radio', name: 'test_task', label: 'Нет', value: 'task_no' }
    ],
    groqResponse: {
      ok: true,
      text: [
        'Choice group 1: Да',
        'Choice group 2: Да',
        'Text question 1: Работал с Java, Spring Boot и SQL, делал backend-сервисы и интеграции.'
      ].join('\n')
    }
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 1);
  assert.equal(result.submitClicks, 1);
  assert.deepEqual(result.checkedLabels, ['Да', 'Да']);
  assert.equal(result.textareaValue, 'Работал с Java, Spring Boot и SQL, делал backend-сервисы и интеграции.');
  assert.equal(result.appended.at(-1).status, 'applied_test_assisted');
});

test('auto apply skips prompt context leaked into generated text answer', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Откликнуться\nРасскажите про релевантный опыт',
    hasTextarea: true,
    startOnResponseForm: true,
    hasQuestionField: true,
    groqResponse: {
      ok: true,
      text: [
        'Visible HH response form text:',
        'Откликнуться',
        'Open text questions:',
        'Text question 1: name task_235076159_text Писать тут'
      ].join('\n')
    }
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 0);
  assert.equal(result.response.skipped, 1);
  assert.equal(result.submitClicks, 0);
  assert.equal(result.appended.at(-1).status, 'skipped_bad_generated_answer');
  assert.match(result.appended.at(-1).error, /prompt context|prompt labels|field metadata/);
});

test('auto apply fills mixed checkbox radio and open employer questions', async () => {
  const result = await runContentAutoApply({
    dialogText: [
      'Отклик на вакансию',
      'Для отклика необходимо ответить на несколько вопросов работодателя',
      'Какой у вас основной опыт за последние 2-3 года?',
      'Можно выбрать несколько вариантов:',
      'управление продуктом / внутренним продуктом',
      'автоматизация бизнес-процессов',
      'разработка и внедрение AI / ML / LLM-решений',
      'Командой какого размера вы управляли напрямую?',
      '4-7 человек',
      'Какие AI-инструменты или подходы вы использовали на практике?',
      'AI-агенты',
      'поиск по базе знаний / RAG',
      'Опишите один самый показательный кейс',
      'Готовы ли вы работать в гибридном графике с посещением офиса у м. Нагатинская?',
      'Да',
      'На какой уровень дохода вы ориентируетесь?'
    ].join('\n'),
    hasTextarea: true,
    startOnResponseForm: true,
    hasQuestionField: true,
    questionControls: [
      { type: 'checkbox', name: 'experience', label: 'управление продуктом / внутренним продуктом', value: '361448749' },
      { type: 'checkbox', name: 'experience', label: 'автоматизация бизнес-процессов', value: '361448750' },
      { type: 'checkbox', name: 'experience', label: 'разработка и внедрение AI / ML / LLM-решений', value: '361448751' },
      { type: 'radio', name: 'team_size', label: 'не управлял(а) командой', value: '361448754' },
      { type: 'radio', name: 'team_size', label: '4-7 человек', value: '361448756' },
      { type: 'checkbox', name: 'ai_tools', label: 'AI-агенты', value: '361448761' },
      { type: 'checkbox', name: 'ai_tools', label: 'поиск по базе знаний / RAG', value: '361448762' },
      { type: 'checkbox', name: 'ai_delivery', label: 'да, руководил(а) командой внедрения', value: '361448768' },
      { type: 'checkbox', name: 'ai_delivery', label: 'был опыт пилотов / тестирования, но без внедрения в регулярную работу', value: '361448770' },
      { type: 'checkbox', name: 'ai_delivery', label: 'нет, но есть опыт автоматизации без AI', value: '361448771' },
      { type: 'radio', name: 'hybrid', label: 'Да', value: '361448774' },
      { type: 'radio', name: 'hybrid', label: 'Свой вариант' }
    ],
    groqResponse: {
      ok: true,
      text: [
        'Основной опыт: управление продуктом / внутренним продуктом; автоматизация бизнес-процессов; разработка и внедрение AI / ML / LLM-решений.',
        'Команда: 4-7 человек.',
        'AI-инструменты: AI-агенты; поиск по базе знаний / RAG.',
        'Внедрение AI / ML / LLM: да, руководил(а) командой внедрения.',
        'Кейс: проблема бизнеса -> решение -> команда -> результат: автоматизировал обработку документов, сократил ручную работу.',
        'Гибридный график: Да.',
        'Доход: 250 000 руб. на руки.'
      ].join('\n')
    }
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 1);
  assert.equal(result.response.skipped, 0);
  assert.equal(result.submitClicks, 1);
  assert.deepEqual(result.checkedLabels, [
    'управление продуктом / внутренним продуктом',
    'автоматизация бизнес-процессов',
    'разработка и внедрение AI / ML / LLM-решений',
    '4-7 человек',
    'AI-агенты',
    'поиск по базе знаний / RAG',
    'да, руководил(а) командой внедрения',
    'Да'
  ]);
  assert.match(result.textareaValue, /Основной опыт|Доход/);
  assert.equal(result.appended.at(-1).status, 'applied_test_assisted');
  assert.ok(result.states.some((state) => state.currentAction === 'Выбираю ответы на вопросы работодателя'));
  assert.equal(result.groqRequests.at(-1).task, 'test_assist');
  assert.match(result.groqRequests.at(-1).extraText, /Choice group 1/);
  assert.match(result.groqRequests.at(-1).extraText, /управление продуктом \/ внутренним продуктом/);
  assert.match(result.groqRequests.at(-1).extraText, /Choice group 4/);
  assert.match(result.groqRequests.at(-1).extraText, /Text question 1/);
});

test('auto apply retries Groq when choice answer does not match options', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Отклик на вакансию\nОтветьте на вопросы работодателя\nГотовы ли вы работать в гибридном графике?',
    hasTextarea: false,
    startOnResponseForm: true,
    questionControls: [
      { type: 'radio', name: 'hybrid', label: 'Да', value: 'yes' },
      { type: 'radio', name: 'hybrid', label: 'Нет', value: 'no' }
    ],
    groqResponse: [
      { ok: true, text: 'Подходит гибридный формат работы.' },
      { ok: true, text: 'Choice group 1: Да' }
    ]
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 1);
  assert.equal(result.submitClicks, 1);
  assert.deepEqual(result.checkedLabels, ['Да']);
  assert.equal(result.groqRequests.length, 2);
  assert.match(result.groqRequests.at(-1).extraText, /Previous answer did not match any available HH choice labels/);
  assert.equal(result.appended.at(-1).status, 'applied_test_assisted');
});

test('auto apply skips choice questions when Groq returns no matching option labels', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Отклик на вакансию\nОтветьте на вопросы работодателя\nГотовы ли вы работать в гибридном графике?',
    hasTextarea: false,
    startOnResponseForm: true,
    questionControls: [
      { type: 'radio', name: 'hybrid', label: 'Да', value: 'yes' },
      { type: 'radio', name: 'hybrid', label: 'Нет', value: 'no' }
    ],
    groqResponse: [
      { ok: true, text: 'Подходит гибридный формат работы.' },
      { ok: true, text: 'Можно рассмотреть разные варианты.' }
    ]
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 0);
  assert.equal(result.response.skipped, 1);
  assert.equal(result.submitClicks, 0);
  assert.deepEqual(result.checkedLabels, []);
  assert.equal(result.groqRequests.length, 2);
  assert.equal(result.appended.at(-1).status, 'skipped_choice_answer_unmatched');
});

test('auto apply uses fallback choice answers after recoverable Groq error', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Отклик на вакансию\nОтветьте на вопросы работодателя\nГотовы ли вы работать в гибридном графике?',
    hasTextarea: false,
    dailyLimit: 2,
    nextPageUrl: 'https://hh.ru/search/vacancy?text=java&page=1',
    questionControls: [
      { type: 'radio', name: 'hybrid', label: 'Да', value: 'yes' },
      { type: 'radio', name: 'hybrid', label: 'Нет', value: 'no' }
    ],
    groqResponse: { ok: false, error: 'Groq request failed: 429 rate limit' }
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.errors, 0);
  assert.equal(result.response.navigated, true);
  assert.equal(result.submitClicks, 1);
  assert.deepEqual(result.checkedLabels, ['Да']);
  assert.equal(result.appended.at(-1).status, 'applied_test_assisted');
  assert.equal(result.navigateUrl, 'https://hh.ru/search/vacancy?text=java&page=1');
});

test('auto apply uses fallback cover letter after hung Groq runtime message', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Отклик на вакансию\nСопроводительное письмо',
    hasTextarea: true,
    dailyLimit: 2,
    nextPageUrl: 'https://hh.ru/search/vacancy?text=java&page=1',
    runtimeMessageTimeoutMs: 5,
    groqResponse: new Promise(() => {})
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.errors, 0);
  assert.equal(result.response.navigated, true);
  assert.equal(result.submitClicks, 1);
  assert.equal(result.appended.at(-1).status, 'applied');
  assert.equal(result.appended.at(-1).coverLetterUsed, true);
  assert.equal(result.navigateUrl, 'https://hh.ru/search/vacancy?text=java&page=1');
});

test('auto apply handles callback-style Groq runtime response', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Отклик на вакансию\nСопроводительное письмо',
    hasTextarea: true,
    dailyLimit: 1,
    nextPageUrl: 'https://hh.ru/search/vacancy?text=java&page=1',
    runtimeCallbackOnly: true,
    groqResponse: { ok: true, text: 'Здравствуйте! Готов обсудить вакансию и пользу для команды.' }
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.errors, 0);
  assert.equal(result.submitClicks, 1);
  assert.equal(result.textareaValue, 'Здравствуйте! Готов обсудить вакансию и пользу для команды.');
  assert.equal(result.appended.at(-1).status, 'applied');
});

test('auto apply limit targets successful applications, not skipped cards', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Отклик на вакансию',
    hasTextarea: false,
    dailyLimit: 1,
    disabledSubmit: true,
    nextPageUrl: 'https://hh.ru/search/vacancy?text=java&page=1'
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 0);
  assert.equal(result.response.skipped, 1);
  assert.equal(result.response.navigated, true);
  assert.equal(result.appended.at(-1).status, 'skipped_submit_not_found');
  assert.equal(result.navigateUrl, 'https://hh.ru/search/vacancy?text=java&page=1');
});

test('auto apply processed cap stops after skipped card for bounded live smoke', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Отклик на вакансию',
    hasTextarea: false,
    dailyLimit: 1,
    disabledSubmit: true,
    nextPageUrl: 'https://hh.ru/search/vacancy?text=java&page=1',
    message: { type: 'START_AUTO_APPLY', limitOverride: 1, maxProcessed: 1 }
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 0);
  assert.equal(result.response.processed, 1);
  assert.equal(result.response.skipped, 1);
  assert.equal(result.response.navigated, undefined);
  assert.equal(result.navigateUrl, '');
  assert.equal(result.states.at(-1).state, 'complete');
  assert.equal(result.states.at(-1).currentAction, '');
});

test('auto apply processed cap completes after employer-question skip without stale action', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Откликнуться\nГотовы ли пройти тестовое задание?\nДа\nНет',
    hasTextarea: false,
    questionControls: [
      { type: 'radio', name: 'task', label: 'Да', value: 'yes' },
      { type: 'radio', name: 'task', label: 'Нет', value: 'no' }
    ],
    message: { type: 'START_AUTO_APPLY', limitOverride: 1, maxProcessed: 1 }
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 0);
  assert.equal(result.response.processed, 1);
  assert.equal(result.response.skipped, 1);
  assert.equal(result.appended.at(-1).status, 'skipped_test_missing_groq_key');
  assert.equal(result.states.at(-1).state, 'complete');
  assert.equal(result.states.at(-1).currentAction, '');
});

test('auto apply processed cap stops after skipped navigation response form', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Отклик на вакансию',
    hasTextarea: false,
    dailyLimit: 1,
    disabledSubmit: true,
    responseHref: 'https://hh.ru/applicant/vacancy_response?vacancyId=123',
    navigateOnResponseClick: true,
    nextPageUrl: 'https://hh.ru/search/vacancy?text=java&page=1',
    message: { type: 'START_AUTO_APPLY', limitOverride: 1, maxProcessed: 1 }
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 0);
  assert.equal(result.response.processed, 1);
  assert.equal(result.response.skipped, 1);
  assert.equal(result.response.navigated, undefined);
  assert.equal(result.navigateUrl, '');
  assert.equal(result.localStore.autoApplySearchQueue.active, false);
  assert.equal(result.states.at(-1).state, 'complete');
});

test('auto apply keeps navigation queue while hh response URL settles after transitional body', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Отклик на вакансию',
    hasTextarea: true,
    hasQuestionField: true,
    dailyLimit: 1,
    responseHref: 'https://hh.ru/applicant/vacancy_response?vacancyId=123',
    delayedNavigateOnResponseClick: true,
    bodyTextAfterResponseClick: 'Отклик на вакансию\nДля отклика необходимо ответить на вопросы работодателя',
    groqResponse: { ok: true, text: '250 000 руб. на руки' }
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 1);
  assert.equal(result.submitClicks, 1);
  assert.equal(result.textareaValue, '250 000 руб. на руки');
  assert.equal(result.appended.at(-1).status, 'applied_test_assisted');
  assert.equal(result.localStore.autoApplyQueue.active, false);
});

test('queued search recovery preserves processed cap when resuming auto apply', async () => {
  const source = await readContentScriptSource();

  assert.match(
    source,
    /handleAutoApply\(\s*autoApplyQueue\.limit \|\| 20,\s*counters,\s*autoApplyQueue\.processedVacancyIds \|\| \[\],\s*\{ maxProcessed: autoApplyQueue\.maxProcessed \|\| null \}\s*\)/
  );
});

test('queued response form processed cap completes without returning to search', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Отклик на вакансию',
    hasTextarea: false,
    startOnResponseForm: true,
    disabledSubmit: true,
    initialLocalStore: {
      autoApplyQueue: {
        active: true,
        runId: 'run-1',
        index: 0,
        items: [{
          index: 1,
          vacancyId: '123',
          title: 'Java Developer',
          url: 'https://hh.ru/vacancy/123',
          responseUrl: 'https://hh.ru/applicant/vacancy_response?vacancyId=123'
        }],
        sourceUrl: 'https://hh.ru/search/vacancy?text=java',
        limit: 1,
        maxProcessed: 1,
        counters: { found: 1, processed: 0, applied: 0, skipped: 0, errors: 0 },
        returnToSearch: true,
        processedVacancyIds: ['123']
      }
    },
    sendMessageAfterImport: false
  });

  assert.equal(result.localStore.autoApplyQueue.active, false);
  assert.equal(result.localStore.autoApplySearchQueue.active, false);
  assert.equal(result.localStore.autoApplyQueue.counters.processed, 1);
  assert.equal(result.localStore.autoApplyQueue.counters.skipped, 1);
  assert.equal(result.navigateUrl, '');
  assert.equal(result.states.at(-1).state, 'complete');
});

test('auto apply uses expected salary for required question when Groq key is missing', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Откликнуться',
    hasTextarea: true,
    startOnResponseForm: true,
    hasQuestionField: true,
    expectedSalary: '250 000 руб. на руки'
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 1);
  assert.equal(result.response.skipped, 0);
  assert.equal(result.submitClicks, 1);
  assert.equal(result.textareaValue, '250 000 руб. на руки');
  assert.equal(result.appended.at(-1).status, 'applied_test_assisted');
});

test('auto apply fills question and mandatory cover letter without Groq key', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Откликнуться',
    hasTextarea: true,
    startOnResponseForm: true,
    hasQuestionField: true,
    hasCoverLetterField: true,
    expectedSalary: '250 000 руб. на руки'
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 1);
  assert.equal(result.response.skipped, 0);
  assert.equal(result.submitClicks, 1);
  assert.equal(result.textareaValue, '250 000 руб. на руки');
  assert.match(result.coverTextareaValue, /Здравствуйте!/);
  assert.equal(result.appended.at(-1).status, 'applied_test_assisted');
  assert.equal(result.appended.at(-1).coverLetterUsed, true);
});

test('auto apply counts already confirmed response page as applied', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Откликнуться',
    hasTextarea: false,
    startOnResponseForm: true,
    bodyText: 'Отклик на вакансию Вы откликнулись Чат'
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 1);
  assert.equal(result.response.skipped, 0);
  assert.equal(result.submitClicks, 0);
  assert.equal(result.appended.at(-1).status, 'applied_already_confirmed');
});

test('auto apply clicks hh list response button even when it has a response link', async () => {
  const responseHref = 'https://hh.ru/applicant/vacancy_response?vacancyId=123&hhtmFrom=vacancy_search_list';
  const result = await runContentAutoApply({
    dialogText: 'Откликнуться',
    hasTextarea: false,
    responseHref
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 1);
  assert.equal(result.submitClicks, 1);
  assert.equal(result.navigateUrl, '');
  assert.equal(result.localStore.autoApplyQueue.active, false);
  assert.equal(result.appended.at(-1).status, 'applied');
  assert.ok(result.states.some((state) => /Открываю форму отклика: Java Developer/.test(state.currentAction || '')));
  assert.ok(!result.states.some((state) => /Открываю страницу вопросов HH/.test(state.currentAction || '')));
});

test('auto apply forces response link to current tab before clicking', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Отклик на вакансию',
    hasTextarea: false,
    responseHref: 'https://hh.ru/applicant/vacancy_response?vacancyId=123&hhtmFrom=vacancy_search_list',
    responseAttrs: { target: '_blank', rel: 'noopener' }
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.submitClicks, 1);
  assert.equal(result.appended.at(-1).status, 'applied');
  assert.equal(result.localStore.autoApplyQueue.active, false);
  assert.equal(result.responseButtonTarget, null);
});

test('auto apply navigates to next hh search page when limit remains', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Откликнуться',
    hasTextarea: false,
    dailyLimit: 2,
    nextPageUrl: 'https://hh.ru/search/vacancy?text=java&page=1'
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.navigated, true);
  assert.equal(result.response.processed, 1);
  assert.equal(result.navigateUrl, 'https://hh.ru/search/vacancy?text=java&page=1');
  assert.equal(result.localStore.autoApplySearchQueue.active, true);
  assert.equal(result.localStore.autoApplySearchQueue.counters.processed, 1);
});

test('auto apply search resume skips already processed vacancy ids', async () => {
  const source = await readContentScriptSource();
  const appended = [];
  const states = [];
  const clickedVacancyIds = [];
  let dialog = null;
  let listener = null;
  let submitClicks = 0;

  const submitButton = new FakeElement({
    text: 'Отправить',
    click() {
      submitClicks += 1;
      dialog = null;
    }
  });

  function makeCard(vacancyId) {
    const titleLink = new FakeElement({
      text: `Vacancy ${vacancyId}`,
      href: `https://hh.ru/vacancy/${vacancyId}`
    });
    const responseButton = new FakeElement({
      text: 'Откликнуться',
      click() {
        clickedVacancyIds.push(vacancyId);
        dialog = new FakeElement({
          text: 'Отклик на вакансию Отправить',
          selectorMap: {
            '[data-qa="vacancy-response-submit-popup"]': [submitButton],
            '[data-qa="vacancy-response-letter-submit"]': [submitButton],
            '[data-qa*="submit"]': [submitButton],
            button: [submitButton]
          }
        });
      }
    });
    const card = new FakeElement({
      text: `Vacancy ${vacancyId}\nОткликнуться`,
      selectorMap: {
        '[data-qa="serp-item__title"]': [titleLink],
        'a[href*="/vacancy/"]': [titleLink],
        '[data-qa="vacancy-serp__vacancy_response"]': [responseButton],
        '[data-qa="vacancy-response-link-top"]': [],
        '[data-qa="vacancy-response-link-bottom"]': [],
        'a[href*="vacancy_response"]': [],
        button: [responseButton]
      }
    });
    titleLink.parentElement = card;
    responseButton.parentElement = card;
    return card;
  }

  const cards = ['111', '222', '333'].map(makeCard);
  const localStore = {
    dailyLimit: 3,
    delayMinMs: 1,
    delayMaxMs: 1,
    autoApplySearchQueue: {
      active: true,
      runId: 'test-run',
      limit: 3,
      counters: {
        found: 3,
        processed: 2,
        applied: 0,
        skipped: 0,
        errors: 0
      },
      config: {
        delayMinMs: 1,
        delayMaxMs: 1
      },
      processedVacancyIds: ['111', '222']
    }
  };

  globalThis.location = {
    href: 'https://hh.ru/search/vacancy?text=java',
    pathname: '/search/vacancy'
  };
  globalThis.window = {
    __HH_JOB_ASSISTANT_TEST_FAST_CLICKS__: true,
    getComputedStyle() {
      return { visibility: 'visible', display: 'block' };
    }
  };
  globalThis.getComputedStyle = globalThis.window.getComputedStyle;
  globalThis.Event = class Event {
    constructor(type) {
      this.type = type;
    }
  };
  globalThis.KeyboardEvent = class KeyboardEvent extends globalThis.Event {
    constructor(type, options = {}) {
      super(type);
      Object.assign(this, options);
    }
  };
  globalThis.document = {
    title: 'HH search page',
    body: new FakeElement({ text: 'HH вакансии Vacancy 111 Vacancy 222 Vacancy 333' }),
    querySelectorAll(selector) {
      if (selector.includes(',')) {
        return selector.split(',').flatMap((part) => this.querySelectorAll(part.trim()));
      }
      if (selector === '[data-qa="vacancy-serp__vacancy"]') return cards;
      if (selector === '[data-qa="serp-item"]') return [];
      if (selector === '[data-qa*="vacancy-serp"]') return cards;
      if (selector === '[role="dialog"]') return dialog ? [dialog] : [];
      if (selector === '[data-qa*="modal"]') return [];
      if (selector === '.bloko-modal') return [];
      if (selector === '.magritte-modal') return [];
      if (selector === 'a[data-qa="pager-next"]') return [];
      if (selector === '[data-qa="pager-next"] a') return [];
      if (selector === 'a[rel="next"]') return [];
      if (selector === 'a[href*="page="]') return [];
      return [];
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    },
    getElementById() {
      return null;
    },
    dispatchEvent() {},
    createElement() {
      return new FakeElement();
    }
  };
  globalThis.chrome = {
    runtime: {
      onMessage: {
        addListener(fn) {
          listener = fn;
        }
      },
      getManifest() {
        return { version: 'test' };
      },
      sendMessage(message) {
        if (message.type === 'SET_RUN_STATE') {
          states.push(message.patch);
          return Promise.resolve({ ok: true });
        }
        if (message.type === 'APPEND_RUN_RESULT') {
          appended.push(message.item);
          return Promise.resolve({ ok: true });
        }
        return Promise.resolve({ ok: true });
      }
    },
    storage: {
      local: {
        async get() {
          return localStore;
        },
        async set(value) {
          Object.assign(localStore, value);
        }
      }
    }
  };

  await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#search-dedupe-${crypto.randomUUID()}`);
  assert.ok(listener, 'content script should register a listener');

  const started = Date.now();
  while (submitClicks === 0 && Date.now() - started < 3000) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  assert.deepEqual(clickedVacancyIds, ['333']);
  assert.equal(submitClicks, 1);
  assert.equal(appended.at(-1).vacancyId, '333');
  assert.equal(localStore.autoApplySearchQueue.active, false);
  assert.ok(!states.some((state) => /Vacancy 111|Vacancy 222/.test(state.currentAction || '')));
});

test('auto apply continues queued response pages for 30 applications', async () => {
  const result = await runQueuedResponsePages({ count: 30 });

  assert.equal(result.submitClicks, 30);
  assert.equal(result.appended.length, 30);
  assert.equal(result.appended.every((item) => item.status === 'applied_test_assisted'), true);
  assert.equal(result.navigations.length, 30);
  assert.equal(result.navigations.at(-1), 'https://hh.ru/search/vacancy?text=java');
  assert.equal(result.localStore.autoApplyQueue.active, false);
  assert.equal(result.localStore.autoApplyQueue.index, 30);
  assert.equal(result.localStore.autoApplyQueue.counters.applied, 30);
  assert.equal(result.localStore.autoApplyQueue.counters.processed, 30);
  assert.equal(result.localStore.autoApplyQueue.counters.errors, 0);
  assert.equal(result.states.at(-1).state, 'complete');
  assert.equal(result.states.at(-1).applied, 30);
});

test('auto apply recovers from hh vacancy redirect back to original search page', async () => {
  const source = await readContentScriptSource();
  const navigations = [];
  const states = [];
  const localStore = {
    autoApplyQueue: {
      active: true,
      runId: 'test-run',
      index: 0,
      sourceUrl: 'https://hh.ru/search/vacancy?text=java',
      limit: 20,
      items: [
        {
          index: 1,
          vacancyId: '123',
          title: 'Chief Product Officer/CPO Data',
          url: 'https://hh.ru/vacancy/123',
          responseUrl: 'https://hh.ru/applicant/vacancy_response?vacancyId=123',
          testDetected: true
        }
      ],
      counters: {
        found: 1,
        processed: 0,
        applied: 0,
        skipped: 0,
        errors: 0
      },
      config: {
        delayMinMs: 1,
        delayMaxMs: 1
      }
    }
  };

  globalThis.location = {
    href: 'https://hh.ru/vacancy/123',
    pathname: '/vacancy/123'
  };
  globalThis.window = {
    __HH_JOB_ASSISTANT_TEST_FAST_CLICKS__: true,
    __HH_JOB_ASSISTANT_TEST_NAVIGATE__(url) {
      navigations.push(url);
    },
    getComputedStyle() {
      return { visibility: 'visible', display: 'block' };
    }
  };
  globalThis.getComputedStyle = globalThis.window.getComputedStyle;
  globalThis.document = {
    title: 'HH vacancy page',
    body: new FakeElement({ text: 'Chief Product Officer/CPO Data' }),
    querySelectorAll() {
      return [];
    },
    querySelector() {
      return null;
    }
  };
  globalThis.chrome = {
    runtime: {
      onMessage: { addListener() {} },
      sendMessage(message) {
        if (message.type === 'SET_RUN_STATE') {
          states.push(message.patch);
        }
        return Promise.resolve({ ok: true });
      }
    },
    storage: {
      local: {
        async get() {
          return localStore;
        },
        async set(value) {
          Object.assign(localStore, value);
        }
      }
    }
  };

  await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#recover-${crypto.randomUUID()}`);
  const started = Date.now();
  while (navigations.length === 0 && Date.now() - started < 1000) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  assert.deepEqual(navigations, ['https://hh.ru/search/vacancy?text=java']);
  assert.equal(localStore.autoApplyQueue.active, false);
  assert.equal(localStore.autoApplyQueue.recoveredFromUrl, 'https://hh.ru/vacancy/123');
  assert.equal(localStore.autoApplySearchQueue.active, false);
  assert.equal(states.at(-1).state, 'complete');
  assert.equal(states.at(-1).currentAction, 'Возвращаюсь на страницу поиска HH');
});

test('auto apply does not recover queued response pages back to a response form url', async () => {
  const source = await readContentScriptSource();
  const navigations = [];
  const states = [];
  const localStore = {
    autoApplyQueue: {
      active: true,
      runId: 'test-run',
      index: 0,
      sourceUrl: 'https://hh.ru/applicant/vacancy_response?vacancyId=133918651&startedWithQuestion=false',
      limit: 20,
      items: [
        {
          index: 1,
          vacancyId: '133918651',
          title: 'Java',
          url: 'https://hh.ru/vacancy/133918651',
          responseUrl: 'https://hh.ru/applicant/vacancy_response?vacancyId=133918651',
          testDetected: true
        }
      ],
      counters: {
        found: 1,
        processed: 0,
        applied: 0,
        skipped: 0,
        errors: 0
      },
      config: {
        delayMinMs: 1,
        delayMaxMs: 1
      }
    }
  };

  globalThis.location = {
    href: 'https://hh.ru/vacancy/133918651',
    pathname: '/vacancy/133918651'
  };
  globalThis.window = {
    __HH_JOB_ASSISTANT_TEST_FAST_CLICKS__: true,
    __HH_JOB_ASSISTANT_TEST_NAVIGATE__(url) {
      navigations.push(url);
    },
    getComputedStyle() {
      return { visibility: 'visible', display: 'block' };
    }
  };
  globalThis.getComputedStyle = globalThis.window.getComputedStyle;
  globalThis.document = {
    title: 'HH vacancy page',
    body: new FakeElement({ text: 'Java' }),
    querySelectorAll() {
      return [];
    },
    querySelector() {
      return null;
    }
  };
  globalThis.chrome = {
    runtime: {
      onMessage: { addListener() {} },
      sendMessage(message) {
        if (message.type === 'SET_RUN_STATE') {
          states.push(message.patch);
        }
        return Promise.resolve({ ok: true });
      }
    },
    storage: {
      local: {
        async get() {
          return localStore;
        },
        async set(value) {
          Object.assign(localStore, value);
        }
      }
    }
  };

  await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#recover-response-url-${crypto.randomUUID()}`);
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.deepEqual(navigations, []);
  assert.equal(localStore.autoApplyQueue.active, false);
  assert.equal(localStore.autoApplyQueue.recoveredFromUrl, 'https://hh.ru/vacancy/133918651');
  assert.equal(states.at(-1).state, 'complete');
});

test('auto apply finalizes pending response when hh returns to search page after submit', async () => {
  const source = await readContentScriptSource();
  const appended = [];
  const states = [];
  const logs = [];
  const localStore = {
    autoApplyQueue: {
      active: true,
      runId: 'test-run',
      index: 0,
      sourceUrl: 'https://hh.ru/search/vacancy?text=java',
      limit: 20,
      returnToSearch: true,
      items: [
        {
          index: 1,
          vacancyId: '123',
          title: 'Java Developer',
          url: 'https://hh.ru/vacancy/123',
          responseUrl: 'https://hh.ru/applicant/vacancy_response?vacancyId=123',
          testDetected: true
        }
      ],
      counters: {
        found: 20,
        processed: 0,
        applied: 0,
        skipped: 0,
        errors: 0
      },
      config: {
        delayMinMs: 1,
        delayMaxMs: 1
      }
    },
    autoApplyPendingSubmit: {
      runId: 'test-run',
      item: {
        index: 1,
        vacancyId: '123',
        title: 'Java Developer',
        url: 'https://hh.ru/vacancy/123'
      },
      counters: {
        found: 20,
        processed: 1,
        applied: 0,
        skipped: 0,
        errors: 0
      },
      status: 'applied_test_assisted',
      coverLetterUsed: true,
      testDetected: true,
      createdAt: new Date().toISOString(),
      sourceUrl: 'https://hh.ru/applicant/vacancy_response?vacancyId=123'
    }
  };

  globalThis.location = {
    href: 'https://hh.ru/search/vacancy?text=java',
    pathname: '/search/vacancy'
  };
  globalThis.window = {
    __HH_JOB_ASSISTANT_TEST_FAST_CLICKS__: true,
    getComputedStyle() {
      return { visibility: 'visible', display: 'block' };
    }
  };
  globalThis.getComputedStyle = globalThis.window.getComputedStyle;
  globalThis.document = {
    title: 'HH search page',
    body: new FakeElement({ text: 'HH вакансии' }),
    querySelectorAll() {
      return [];
    },
    querySelector() {
      return null;
    },
    dispatchEvent() {},
    createElement() {
      return new FakeElement();
    }
  };
  globalThis.HHJobAssistantLog = {
    append(scope, event, details) {
      logs.push({ scope, event, details });
      return Promise.resolve();
    }
  };
  globalThis.chrome = {
    runtime: {
      onMessage: { addListener() {} },
      sendMessage(message) {
        if (message.type === 'SET_RUN_STATE') {
          states.push(message.patch);
        }
        if (message.type === 'APPEND_RUN_RESULT') {
          appended.push(message.item);
        }
        return Promise.resolve({ ok: true });
      }
    },
    storage: {
      local: {
        async get() {
          return localStore;
        },
        async set(value) {
          Object.assign(localStore, value);
        }
      }
    }
  };

  await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#search-return-${crypto.randomUUID()}`);
  const started = Date.now();
  while (appended.length === 0 && Date.now() - started < 1000) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  assert.equal(appended.length, 1);
  assert.equal(appended.at(-1).status, 'applied_test_assisted');
  assert.equal(appended.at(-1).coverLetterUsed, true);
  assert.equal(localStore.autoApplyPendingSubmit, null);
  assert.equal(localStore.autoApplyQueue.active, false);
  assert.equal(states.at(-1).state, 'complete');
  assert.equal(states.at(-1).applied, 1);
  assert.equal(states.at(-1).processed, 1);
  assert.equal(logs.some((item) => item.event === 'pending_submit_finalized_from_search_return'), true);
});

test('auto apply finalizes pending response on detail confirmation page and returns to search', async () => {
  const source = await readContentScriptSource();
  const appended = [];
  const states = [];
  const logs = [];
  const navigations = [];
  const localStore = {
    autoApplyQueue: {
      active: true,
      runId: 'test-run',
      index: 0,
      sourceUrl: 'https://hh.ru/search/vacancy?text=java',
      limit: 20,
      returnToSearch: true,
      items: [
        {
          index: 3,
          vacancyId: '133983014',
          title: 'Senior Java-разработчик',
          url: 'https://hh.ru/vacancy/133983014',
          responseUrl: '',
          testDetected: true
        }
      ],
      counters: {
        found: 20,
        processed: 2,
        applied: 1,
        skipped: 1,
        errors: 0
      },
      config: {
        delayMinMs: 1,
        delayMaxMs: 1
      }
    },
    autoApplyPendingSubmit: {
      runId: 'test-run',
      item: {
        index: 3,
        vacancyId: '133983014',
        title: 'Senior Java-разработчик',
        url: 'https://hh.ru/vacancy/133983014'
      },
      counters: {
        found: 20,
        processed: 3,
        applied: 1,
        skipped: 1,
        errors: 0
      },
      status: 'applied_test_assisted',
      coverLetterUsed: false,
      testDetected: true,
      createdAt: new Date().toISOString(),
      sourceUrl: 'https://hh.ru/vacancy/133983014'
    }
  };

  globalThis.location = {
    href: 'https://hh.ru/vacancy/133983014',
    pathname: '/vacancy/133983014'
  };
  globalThis.window = {
    __HH_JOB_ASSISTANT_TEST_FAST_CLICKS__: true,
    __HH_JOB_ASSISTANT_TEST_NAVIGATE__(url) {
      navigations.push(url);
    },
    getComputedStyle() {
      return { visibility: 'visible', display: 'block' };
    }
  };
  globalThis.getComputedStyle = globalThis.window.getComputedStyle;
  globalThis.document = {
    title: 'HH vacancy confirmation page',
    body: new FakeElement({ text: 'Вы откликнулись\nРезюме доставлено' }),
    querySelectorAll() {
      return [];
    },
    querySelector() {
      return null;
    },
    dispatchEvent() {},
    createElement() {
      return new FakeElement();
    }
  };
  globalThis.HHJobAssistantLog = {
    append(scope, event, details) {
      logs.push({ scope, event, details });
      return Promise.resolve();
    }
  };
  globalThis.chrome = {
    runtime: {
      onMessage: { addListener() {} },
      sendMessage(message) {
        if (message.type === 'SET_RUN_STATE') {
          states.push(message.patch);
        }
        if (message.type === 'APPEND_RUN_RESULT') {
          appended.push(message.item);
        }
        return Promise.resolve({ ok: true });
      }
    },
    storage: {
      local: {
        async get() {
          return localStore;
        },
        async set(value) {
          Object.assign(localStore, value);
        }
      }
    }
  };

  await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#detail-return-${crypto.randomUUID()}`);
  const started = Date.now();
  while (navigations.length === 0 && Date.now() - started < 1000) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  assert.equal(appended.length, 1);
  assert.equal(appended.at(-1).status, 'applied_test_assisted');
  assert.equal(localStore.autoApplyPendingSubmit, null);
  assert.equal(localStore.autoApplyQueue.active, false);
  assert.equal(localStore.autoApplySearchQueue.active, true);
  assert.equal(localStore.autoApplySearchQueue.counters.applied, 2);
  assert.equal(localStore.autoApplySearchQueue.counters.processed, 3);
  assert.equal(states.at(-1).state, 'applying');
  assert.equal(navigations.at(-1), 'https://hh.ru/search/vacancy?text=java');
  assert.equal(logs.some((item) => item.event === 'pending_submit_finalized'), true);
});

test('auto apply returns from already applied queued detail page without response button', async () => {
  const source = await readContentScriptSource();
  const appended = [];
  const states = [];
  const navigations = [];
  const localStore = {
    autoApplyQueue: {
      active: true,
      runId: 'test-run',
      index: 0,
      sourceUrl: 'https://hh.ru/search/vacancy?text=java',
      limit: 20,
      returnToSearch: true,
      items: [
        {
          index: 7,
          vacancyId: '133109567',
          title: 'Senior Backend Engineer',
          url: 'https://hh.ru/vacancy/133109567',
          responseUrl: '',
          testDetected: false
        }
      ],
      counters: {
        found: 20,
        processed: 6,
        applied: 5,
        skipped: 1,
        errors: 0
      },
      config: {
        delayMinMs: 1,
        delayMaxMs: 1
      },
      processedVacancyIds: ['133109567']
    }
  };

  globalThis.location = {
    href: 'https://hh.ru/vacancy/133109567',
    pathname: '/vacancy/133109567'
  };
  globalThis.window = {
    __HH_JOB_ASSISTANT_TEST_FAST_CLICKS__: true,
    __HH_JOB_ASSISTANT_TEST_NAVIGATE__(url) {
      navigations.push(url);
    },
    getComputedStyle() {
      return { visibility: 'visible', display: 'block' };
    }
  };
  globalThis.getComputedStyle = globalThis.window.getComputedStyle;
  globalThis.document = {
    title: 'HH vacancy confirmation page',
    body: new FakeElement({ text: 'Senior Backend Engineer\nВы откликнулись\nЧат' }),
    querySelectorAll() {
      return [];
    },
    querySelector() {
      return null;
    },
    dispatchEvent() {},
    createElement() {
      return new FakeElement();
    }
  };
  globalThis.chrome = {
    runtime: {
      onMessage: { addListener() {} },
      sendMessage(message) {
        if (message.type === 'SET_RUN_STATE') {
          states.push(message.patch);
        }
        if (message.type === 'APPEND_RUN_RESULT') {
          appended.push(message.item);
        }
        return Promise.resolve({ ok: true });
      }
    },
    storage: {
      local: {
        async get() {
          return localStore;
        },
        async set(value) {
          Object.assign(localStore, value);
        }
      }
    }
  };

  await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#already-applied-detail-${crypto.randomUUID()}`);
  const started = Date.now();
  while (navigations.length === 0 && Date.now() - started < 1000) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  assert.equal(appended.length, 1);
  assert.equal(appended.at(-1).status, 'applied_already_confirmed');
  assert.equal(localStore.autoApplyQueue.active, false);
  assert.equal(localStore.autoApplySearchQueue.active, true);
  assert.equal(localStore.autoApplySearchQueue.counters.applied, 6);
  assert.equal(localStore.autoApplySearchQueue.counters.processed, 7);
  assert.equal(states.at(-1).state, 'applying');
  assert.equal(navigations.at(-1), 'https://hh.ru/search/vacancy?text=java');
});

test('auto apply continues queued flow on hh vacancy detail page instead of completing early', async () => {
  const source = await readContentScriptSource();
  const appended = [];
  const states = [];
  const navigations = [];
  let responseClicks = 0;
  let submitClicks = 0;
  let dialog = null;
  const localStore = {
    autoApplyQueue: {
      active: true,
      runId: 'test-run',
      index: 0,
      sourceUrl: 'https://hh.ru/search/vacancy?text=java',
      limit: 20,
      returnToSearch: true,
      items: [
        {
          index: 7,
          vacancyId: '133919189',
          title: 'CTO / Chief Technology Officer',
          url: 'https://hh.ru/vacancy/133919189',
          responseUrl: 'https://hh.ru/applicant/vacancy_response?vacancyId=133919189',
          testDetected: false
        }
      ],
      counters: {
        found: 20,
        processed: 6,
        applied: 5,
        skipped: 1,
        errors: 0
      },
      config: {
        delayMinMs: 1,
        delayMaxMs: 1
      }
    }
  };
  const submitButton = new FakeElement({
    text: 'Откликнуться',
    click() {
      submitClicks += 1;
      dialog = null;
    }
  });
  const responseButton = new FakeElement({
    text: 'Откликнуться',
    click() {
      responseClicks += 1;
      dialog = new FakeElement({
        text: 'Отклик на вакансию\nОткликнуться',
        selectorMap: {
          '[data-qa="vacancy-response-submit-popup"]': [submitButton],
          '[data-qa="vacancy-response-letter-submit"]': [submitButton],
          '[data-qa*="submit"]': [submitButton],
          button: [submitButton]
        }
      });
    }
  });

  globalThis.location = {
    href: 'https://hh.ru/vacancy/133919189',
    pathname: '/vacancy/133919189'
  };
  globalThis.window = {
    __HH_JOB_ASSISTANT_TEST_FAST_CLICKS__: true,
    __HH_JOB_ASSISTANT_TEST_NAVIGATE__(url) {
      navigations.push(url);
    },
    getComputedStyle() {
      return { visibility: 'visible', display: 'block' };
    }
  };
  globalThis.getComputedStyle = globalThis.window.getComputedStyle;
  globalThis.Event = class Event {
    constructor(type) {
      this.type = type;
    }
  };
  globalThis.KeyboardEvent = class KeyboardEvent extends globalThis.Event {
    constructor(type, options = {}) {
      super(type);
      Object.assign(this, options);
    }
  };
  globalThis.document = {
    title: 'HH vacancy detail page',
    body: new FakeElement({ text: 'CTO / Chief Technology Officer Откликнуться' }),
    querySelectorAll(selector) {
      if (selector.includes(',')) {
        return selector.split(',').flatMap((part) => this.querySelectorAll(part.trim()));
      }
      if (selector === 'h1') return [new FakeElement({ text: 'CTO / Chief Technology Officer' })];
      if (selector === '[data-qa="vacancy-description"]') return [new FakeElement({ text: 'Vacancy text' })];
      if (selector === '[data-qa="vacancy-section"]') return [];
      if (selector === '[data-qa="vacancy-view-description"]') return [];
      if (selector === 'main') return [];
      if (selector === 'button') return [responseButton];
      if (selector === '[role="dialog"]') return dialog ? [dialog] : [];
      if (selector === '[data-qa*="modal"]') return [];
      if (selector === '.bloko-modal') return [];
      if (selector === '.magritte-modal') return [];
      if (selector === '[data-qa="vacancy-response-submit-popup"]') return [];
      if (selector === '[data-qa="vacancy-response-letter-submit"]') return [];
      if (selector === '[data-qa*="submit"]') return [];
      if (selector === 'textarea') return [];
      if (selector === 'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])') return [];
      if (selector === '[contenteditable="true"]') return [];
      return [];
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    },
    dispatchEvent() {},
    createElement() {
      return new FakeElement();
    }
  };
  globalThis.chrome = {
    runtime: {
      onMessage: { addListener() {} },
      sendMessage(message) {
        if (message.type === 'SET_RUN_STATE') {
          states.push(message.patch);
        }
        if (message.type === 'APPEND_RUN_RESULT') {
          appended.push(message.item);
        }
        return Promise.resolve({ ok: true });
      }
    },
    storage: {
      local: {
        async get() {
          return localStore;
        },
        async set(value) {
          Object.assign(localStore, value);
        }
      }
    }
  };

  await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#queued-detail-${crypto.randomUUID()}`);
  const started = Date.now();
  while (navigations.length === 0 && Date.now() - started < 1000) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  assert.equal(responseClicks, 1);
  assert.equal(submitClicks, 1);
  assert.equal(appended.at(-1).status, 'applied');
  assert.equal(localStore.autoApplyQueue.active, false);
  assert.equal(localStore.autoApplySearchQueue.active, true);
  assert.equal(localStore.autoApplySearchQueue.counters.applied, 6);
  assert.equal(localStore.autoApplySearchQueue.counters.processed, 7);
  assert.deepEqual(navigations, ['https://hh.ru/search/vacancy?text=java']);
  assert.ok(!states.some((state) => state.state === 'complete' && state.processed === 6 && state.applied === 5));
});

test('auto apply ignores queued detail flow on non-matching vacancy tab', async () => {
  const source = await readContentScriptSource();
  const appended = [];
  const states = [];
  const navigations = [];
  let responseClicks = 0;
  const localStore = {
    autoApplyQueue: {
      active: true,
      runId: 'test-run',
      index: 0,
      sourceUrl: 'https://hh.ru/search/vacancy?text=java',
      limit: 20,
      returnToSearch: true,
      items: [
        {
          index: 7,
          vacancyId: '133919189',
          title: 'CTO / Chief Technology Officer',
          url: 'https://hh.ru/vacancy/133919189',
          responseUrl: 'https://hh.ru/applicant/vacancy_response?vacancyId=133919189',
          testDetected: false
        }
      ],
      counters: {
        found: 20,
        processed: 6,
        applied: 5,
        skipped: 1,
        errors: 0
      },
      config: {
        delayMinMs: 1,
        delayMaxMs: 1
      }
    },
    autoApplySearchQueue: {
      active: true,
      runId: 'test-run',
      sourceUrl: 'https://hh.ru/search/vacancy?text=java',
      limit: 20,
      counters: {
        found: 20,
        processed: 6,
        applied: 5,
        skipped: 1,
        errors: 0
      },
      config: {
        delayMinMs: 1,
        delayMaxMs: 1
      }
    }
  };
  const responseButton = new FakeElement({
    text: 'Откликнуться',
    click() {
      responseClicks += 1;
    }
  });

  globalThis.location = {
    href: 'https://hh.ru/vacancy/999999999',
    pathname: '/vacancy/999999999'
  };
  globalThis.window = {
    __HH_JOB_ASSISTANT_TEST_AUTHENTICATED__: true,
    __HH_JOB_ASSISTANT_TEST_FAST_CLICKS__: true,
    __HH_JOB_ASSISTANT_TEST_NAVIGATE__(url) {
      navigations.push(url);
    },
    getComputedStyle() {
      return { visibility: 'visible', display: 'block' };
    }
  };
  globalThis.__HH_JOB_ASSISTANT_TEST_AUTHENTICATED__ = true;
  globalThis.getComputedStyle = globalThis.window.getComputedStyle;
  globalThis.document = {
    title: 'Wrong HH vacancy detail page',
    body: new FakeElement({ text: 'Wrong vacancy Откликнуться' }),
    querySelectorAll(selector) {
      if (selector.includes(',')) {
        return selector.split(',').flatMap((part) => this.querySelectorAll(part.trim()));
      }
      if (selector === 'button') return [responseButton];
      if (selector === '[role="dialog"]') return [];
      if (selector === '[data-qa*="modal"]') return [];
      if (selector === '.bloko-modal') return [];
      if (selector === '.magritte-modal') return [];
      if (selector === '[data-qa="vacancy-response-submit-popup"]') return [];
      if (selector === '[data-qa="vacancy-response-letter-submit"]') return [];
      if (selector === '[data-qa*="submit"]') return [];
      if (selector === 'textarea') return [];
      if (selector === 'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])') return [];
      if (selector === '[contenteditable="true"]') return [];
      return [];
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    },
    dispatchEvent() {},
    createElement() {
      return new FakeElement();
    }
  };
  globalThis.chrome = {
    runtime: {
      onMessage: { addListener() {} },
      sendMessage(message) {
        if (message.type === 'SET_RUN_STATE') {
          states.push(message.patch);
        }
        if (message.type === 'APPEND_RUN_RESULT') {
          appended.push(message.item);
        }
        return Promise.resolve({ ok: true });
      }
    },
    storage: {
      local: {
        async get() {
          return localStore;
        },
        async set(value) {
          Object.assign(localStore, value);
        }
      }
    }
  };

  await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#wrong-detail-${crypto.randomUUID()}`);
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.equal(responseClicks, 0);
  assert.equal(appended.length, 0);
  assert.deepEqual(navigations, []);
  assert.equal(localStore.autoApplyQueue.active, true);
  assert.equal(localStore.autoApplySearchQueue.active, true);
  assert.equal(states.length, 0);
});

test('stop run clears queues, reports stopped state, and appends debug log event', async () => {
  const source = await readContentScriptSource();
  const states = [];
  const logs = [];
  let listener = null;
  const localStore = {
    autoApplyQueue: { active: true },
    autoApplySearchQueue: { active: true }
  };

  globalThis.location = {
    href: 'https://hh.ru/search/vacancy?text=java',
    pathname: '/search/vacancy'
  };
  globalThis.window = {
    __HH_JOB_ASSISTANT_TEST_FAST_CLICKS__: true,
    getComputedStyle() {
      return { visibility: 'visible', display: 'block' };
    }
  };
  globalThis.getComputedStyle = globalThis.window.getComputedStyle;
  globalThis.document = {
    title: 'HH search page',
    body: new FakeElement({ text: 'HH вакансии' }),
    querySelectorAll() {
      return [];
    },
    querySelector() {
      return null;
    },
    dispatchEvent() {}
  };
  globalThis.HHJobAssistantLog = {
    append(scope, event, details) {
      logs.push({ scope, event, details });
      return Promise.resolve();
    }
  };
  globalThis.chrome = {
    runtime: {
      onMessage: {
        addListener(fn) {
          listener = fn;
        }
      },
      sendMessage(message) {
        if (message.type === 'SET_RUN_STATE') {
          states.push(message.patch);
        }
        return Promise.resolve({ ok: true });
      }
    },
    storage: {
      local: {
        async get() {
          return localStore;
        },
        async set(value) {
          Object.assign(localStore, value);
        }
      }
    }
  };

  await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#stop-${crypto.randomUUID()}`);
  assert.ok(listener, 'content script should register a listener');

  const response = await new Promise((resolve) => {
    const stayedAsync = listener({ type: 'STOP_RUN' }, {}, resolve);
    assert.equal(stayedAsync, true);
  });

  assert.equal(response.ok, true);
  assert.equal(localStore.autoApplyQueue.active, false);
  assert.equal(localStore.autoApplySearchQueue.active, false);
  assert.equal(states.at(-1).state, 'stopped');
  assert.equal(logs.at(-1).event, 'stop_run');
  assert.equal(logs.at(-1).details.url, 'https://hh.ru/search/vacancy?text=java');
});
