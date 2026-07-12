import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readContentScriptSource } from './helpers/content-script-source.mjs';
import { FakeElement } from './helpers/fake-element.mjs';

const HH_DAILY_RESPONSE_LIMIT_TEXT = 'В течение 24 часов можно совершить не более 200 откликов. Вы исчерпали лимит откликов, попробуйте отправить отклик позднее.';
const TEST_READY_CONFIG = {
  groqApiKey: 'gsk_test',
  resumeUrl: 'https://hh.ru/resume/test-resume',
  coverPrompt: 'Write a concise cover letter and return only final text.',
  employerQuestionPrompt: 'Answer each employer question and follow Text question N and Choice group N output markers.',
  choiceRetryPrompt: 'Choose exact listed labels and follow Choice group N output markers.'
};

async function runContentAutoApply({
  messageType = 'START_AUTO_APPLY',
  dialogText,
  hasTextarea,
  exactCardSelectorMatches = true,
  broadVacancySelectorIncludesButton = false,
  broadVacancySelectorOnlyButton = false,
  startOnResponseForm = false,
  hasQuestionField = false,
  questionFieldCount = 1,
  hasContentEditableQuestion = false,
  hasContentEditableCoverLetter = false,
  hasCoverLetterField = false,
  questionFieldLabel = '',
  questionFieldLabels = [],
  rejectQuestionFieldWrites = false,
  bodyText = 'HH вакансии',
  responseHref = '',
  responseAttrs = {},
  responseClickOpensDialog = true,
  navigateOnResponseClick = false,
  delayedNavigateOnResponseClick = false,
  bodyTextAfterResponseClick = '',
  expectedSalary = '',
  initialFollowupDialogText = '',
  initialFollowupBodyOnlyText = '',
  followupDialogText = '',
  followupConfirmText = 'Все равно откликнуться',
  submitButtonText = 'Отправить',
  dialogTextAfterCoverInput = '',
  disabledSubmit = false,
  validateRequiredBeforeSubmit = false,
  keepDialogOpenAfterSubmit = false,
  postSubmitDialogText = '',
  submitNavigateHref = '',
  submitBodyTextAfterClick = 'Вы откликнулись',
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
  cardText = 'Java Developer\nООО Test\nОткликнуться',
  sendMessageAfterImport = true,
  authenticated = true,
  stopWhenState = ''
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
  const localStore = { ...TEST_READY_CONFIG,
    groqApiKey: 'gsk_test',
    resumeUrl: 'https://hh.ru/resume/test-resume',
    coverPrompt: 'Write a concise cover letter and return only final text.',
    employerQuestionPrompt: 'Answer each employer question and follow Text question N and Choice group N output markers.',
    choiceRetryPrompt: 'Choose exact listed labels and follow Choice group N output markers.'
  };
  Object.assign(localStore, initialLocalStore || {});
  function setDialogAndBodyText(text) {
    if (!text) return;
    if (dialog) {
      dialog.innerText = text;
      dialog.textContent = text;
    }
    if (bodyNode) {
      bodyNode.innerText = text;
      bodyNode.textContent = text;
    }
  }

  const questionTextareas = Array.from({ length: hasQuestionField ? questionFieldCount : hasTextarea ? 1 : 0 }, (_, index) => new FakeElement({
    text: hasQuestionField ? 'Писать тут' : 'Сопроводительное письмо',
    attrs: hasQuestionField ? { name: `task_${235076159 + index}_text` } : { placeholder: 'Сопроводительное письмо' },
    dispatch(event) {
      if (hasQuestionField && rejectQuestionFieldWrites && event?.type === 'input') {
        this.value = '';
      }
      if (!hasQuestionField && event?.type === 'input') {
        setDialogAndBodyText(dialogTextAfterCoverInput);
      }
    }
  }));
  const textarea = questionTextareas[0] || new FakeElement();
  const effectiveQuestionLabels = questionFieldLabels.length > 0 ? questionFieldLabels : questionFieldLabel ? [questionFieldLabel] : [];
  questionTextareas.forEach((field, index) => {
    if (effectiveQuestionLabels[index]) {
      field.parentElement = new FakeElement({ text: `${effectiveQuestionLabels[index]}\nПисать тут` });
    }
  });
  const contentEditableQuestion = new FakeElement({
    text: hasContentEditableQuestion ? 'Писать тут' : '',
    attrs: hasContentEditableQuestion ? { contenteditable: 'true' } : {}
  });
  const contentEditableCoverLetter = new FakeElement({
    text: hasContentEditableCoverLetter ? 'Сопроводительное письмо' : '',
    attrs: hasContentEditableCoverLetter ? { contenteditable: 'true', role: 'textbox', placeholder: 'Сопроводительное письмо' } : {},
    dispatch(event) {
      if (event?.type === 'input') {
        submitButton.disabled = false;
        setDialogAndBodyText(dialogTextAfterCoverInput);
      }
    }
  });
  const coverTextarea = new FakeElement({
    text: hasCoverLetterField ? 'Сопроводительное письмо обязательное' : '',
    attrs: hasCoverLetterField ? { 'data-qa': 'vacancy-response-letter-input' } : {},
    dispatch(event) {
      if (event?.type === 'input') {
        setDialogAndBodyText(dialogTextAfterCoverInput);
      }
    }
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
    text: submitButtonText,
    disabled: disabledSubmit,
    click() {
      submitClicks += 1;
      if (validateRequiredBeforeSubmit) {
        const hasUncheckedChoice = selectableControls.some((item) => !item.input.checked);
        const hasEmptyTextarea = [...questionTextareas, hasCoverLetterField ? coverTextarea : null]
          .filter(Boolean)
          .some((field) => !String(field.value || field.textContent || '').trim());
        if (hasUncheckedChoice || hasEmptyTextarea) {
          if (bodyNode) {
            bodyNode.innerText = 'Укажите ожидания по окладу минимум и комфорт (gross, до вычета налога)';
            bodyNode.textContent = bodyNode.innerText;
          }
          return;
        }
      }
      if (submitBodyTextAfterClick && bodyNode) {
        bodyNode.innerText = submitBodyTextAfterClick;
        bodyNode.textContent = submitBodyTextAfterClick;
      }
      if (submitNavigateHref) {
        const parsed = new URL(submitNavigateHref);
        globalThis.location.href = parsed.href;
        globalThis.location.pathname = parsed.pathname;
      }
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
        '[data-qa="vacancy-response-popup-form-letter-input"]': hasCoverLetterField ? [coverTextarea] : hasTextarea ? questionTextareas : [],
        '[data-qa="vacancy-response-letter-input"]': hasCoverLetterField ? [coverTextarea] : hasTextarea ? questionTextareas : [],
        '[data-qa="vacancy-response-submit-popup"]': [submitButton],
        '[data-qa="vacancy-response-letter-submit"]': [submitButton],
        '[data-qa*="submit"]': [submitButton],
        'input[type="checkbox"]': selectableControls.filter((item) => item.type === 'checkbox').map((item) => item.input),
        'input[type="radio"]': selectableControls.filter((item) => item.type === 'radio').map((item) => item.input),
        textarea: [...(hasQuestionField || hasTextarea ? questionTextareas : []), hasCoverLetterField ? coverTextarea : null].filter(Boolean),
        '[contenteditable="true"]': [hasContentEditableQuestion ? contentEditableQuestion : null, hasContentEditableCoverLetter ? contentEditableCoverLetter : null].filter(Boolean),
        '[role="textbox"]': hasContentEditableCoverLetter ? [contentEditableCoverLetter] : [],
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
      if (!responseClickOpensDialog) return;
      openResponseDialog();
    }
  });
  const titleLink = new FakeElement({
    text: 'Java Developer',
    href: 'https://hh.ru/vacancy/123'
  });
  const nextLink = nextPageUrl ? new FakeElement({ text: 'дальше', href: nextPageUrl }) : null;
  const card = new FakeElement({
    text: cardText,
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
        if (broadVacancySelectorOnlyButton) return [responseButton];
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
        return [...(hasQuestionField || hasTextarea ? questionTextareas : []), hasCoverLetterField ? coverTextarea : null].filter(Boolean);
      }
      if ((currentResponseForm || startOnResponseForm) && selector === '[contenteditable="true"]') {
        return [hasContentEditableQuestion ? contentEditableQuestion : null, hasContentEditableCoverLetter ? contentEditableCoverLetter : null].filter(Boolean);
      }
      if ((currentResponseForm || startOnResponseForm) && selector === '[role="textbox"]') {
        return hasContentEditableCoverLetter ? [contentEditableCoverLetter] : [];
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
          if (message.patch.state === stopWhenState && listener) {
            listener({ type: 'STOP_RUN' }, {}, () => {});
          }
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
  globalThis.HHJobAssistantLog = {
    async append(scope, event, details = {}) {
      if (localStore.agentDebugLogsEnabled !== true) return;
      const entry = {
        timestamp: new Date().toISOString(),
        scope,
        event,
        details
      };
      localStore.agentDebugLog = [...(Array.isArray(localStore.agentDebugLog) ? localStore.agentDebugLog : []), entry];
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
    textareaValues: questionTextareas.map((field) => field.value),
    contentEditableQuestionText: contentEditableQuestion.textContent,
    contentEditableCoverLetterText: contentEditableCoverLetter.textContent,
    coverTextareaValue: coverTextarea.value,
    checkedLabels: selectableControls.filter((item) => item.input.checked).map((item) => item.label),
    localStore,
    responseButtonTarget: responseButton.getAttribute('target'),
    navigateUrl,
    bodyCursor: globalThis.document.body.style.cursor || '',
    autoApplyCursorCount: bodyNode.children.filter((child) => child.id === 'hh-job-assistant-auto-apply-cursor').length,
    responseButtonHighlighted: responseButton.attrs['data-hh-job-assistant-auto-apply-highlight'] === 'true',
    submitButtonHighlighted: submitButton.attrs['data-hh-job-assistant-auto-apply-highlight'] === 'true',
    dialogOpen: Boolean(dialog)
  };
}

test('start and continue reject incomplete configuration before runtime mutations', async () => {
  for (const messageType of ['START_AUTO_APPLY', 'START_DRY_RUN', 'CONTINUE_AUTO_APPLY']) {
    const result = await runContentAutoApply({
      messageType,
      initialLocalStore: { groqApiKey: '' }
    });
    assert.equal(result.response.ok, false);
    assert.match(result.response.error, /Приложение не настроено/);
    assert.deepEqual(result.states, []);
    assert.deepEqual(result.appended, []);
    assert.equal(result.submitClicks, 0);
    assert.equal(result.navigateUrl, '');
  }
});

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

  const localStore = { ...TEST_READY_CONFIG,
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
        globalThis.document.body.innerText = 'Вы откликнулись';
        globalThis.document.body.textContent = 'Вы откликнулись';
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
            return settle({ ok: true, text: `Text question 1: Подтвержденный ответ ${pageIndex + 1}` });
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
      (textarea.value !== `Подтвержденный ответ ${pageIndex + 1}` ||
        submitClicks < pageIndex + 1 ||
        localStore.autoApplyQueue.index < pageIndex + 1) &&
      Date.now() - started < 3000
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(textarea.value, `Подтвержденный ответ ${pageIndex + 1}`);
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
  assert.match(result.appended.at(-1).error, /ключ Groq API/);
});

test('auto apply stop during cover-letter generation prevents fill and submit', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Добавьте сопроводительное письмо\nОтправить',
    hasTextarea: true,
    groqResponse: { ok: true, text: 'Здравствуйте, хочу откликнуться.' },
    stopWhenState: 'generating_cover_letter'
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.submitClicks, 0);
  assert.equal(result.textareaValue, '');
  assert.equal(result.localStore.autoApplyQueue.active, false);
  assert.equal(result.localStore.autoApplySearchQueue.active, false);
  assert.equal(result.states.at(-1).state, 'stopped');
});

test('auto apply does not count global search already-applied text as current vacancy applied', async () => {
  const result = await runContentAutoApply({
    dialogText: '',
    hasTextarea: false,
    bodyText: 'Java Developer\nОткликнуться\nДругая вакансия\nВы откликнулись',
    bodyTextAfterResponseClick: 'Java Developer\nОткликнуться\nДругая вакансия\nВы откликнулись',
    responseClickOpensDialog: false
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 0);
  assert.equal(result.response.skipped, 0);
  assert.equal(result.response.navigated, true);
  assert.equal(result.submitClicks, 0);
  assert.equal(result.appended.length, 0);
  assert.match(result.navigateUrl, /\/applicant\/vacancy_response\?vacancyId=123/);
});

test('auto apply does not count current card as applied while response button is active', async () => {
  const result = await runContentAutoApply({
    dialogText: '',
    hasTextarea: false,
    cardText: 'Java Developer\nВы откликнулись\nОткликнуться',
    bodyTextAfterResponseClick: 'Java Developer\nВы откликнулись\nОткликнуться',
    responseClickOpensDialog: false
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 0);
  assert.equal(result.response.skipped, 0);
  assert.equal(result.response.navigated, true);
  assert.equal(result.submitClicks, 0);
  assert.equal(result.appended.length, 0);
  assert.match(result.navigateUrl, /\/applicant\/vacancy_response\?vacancyId=123/);
});

test('auto apply does not click detail response twice when hh confirms direct submit', async () => {
  const result = await runContentAutoApply({
    dialogText: '',
    hasTextarea: false,
    responseClickOpensDialog: false,
    bodyText: 'Java Developer\nОткликнуться',
    bodyTextAfterResponseClick: 'Java Developer\nОткликнуться\nОтклик отправлен'
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 1);
  assert.equal(result.response.skipped, 0);
  assert.equal(result.submitClicks, 0);
  assert.equal(result.appended.length, 1);
  assert.equal(result.appended.at(-1).status, 'applied_direct_click');
  assert.equal(result.navigateUrl, '');
});

test('auto apply opens direct response url instead of skipping when search click does not open form', async () => {
  const responseUrl = 'https://hh.ru/applicant/vacancy_response?vacancyId=123&startedWithQuestion=false';
  const result = await runContentAutoApply({
    dialogText: '',
    hasTextarea: false,
    responseHref: responseUrl,
    responseClickOpensDialog: false
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 0);
  assert.equal(result.response.skipped, 0);
  assert.equal(result.response.navigated, true);
  assert.equal(result.submitClicks, 0);
  assert.equal(result.appended.length, 0);
  assert.equal(result.localStore.autoApplyQueue.active, true);
  assert.equal(result.localStore.autoApplyQueue.counters.processed, 1);
  assert.equal(result.navigateUrl, responseUrl);
});

test('auto apply derives response url when live hh broad selector returns response button node', async () => {
  const responseUrl = 'https://hh.ru/applicant/vacancy_response?vacancyId=123&startedWithQuestion=false';
  const result = await runContentAutoApply({
    dialogText: '',
    hasTextarea: false,
    exactCardSelectorMatches: false,
    broadVacancySelectorOnlyButton: true,
    responseHref: responseUrl,
    responseClickOpensDialog: false
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 0);
  assert.equal(result.response.skipped, 0);
  assert.equal(result.response.navigated, true);
  assert.equal(result.appended.length, 0);
  assert.equal(result.localStore.autoApplyQueue.active, true);
  assert.equal(result.localStore.autoApplyQueue.items[0].vacancyId, '123');
  assert.equal(result.localStore.autoApplyQueue.items[0].responseUrl, responseUrl);
  assert.equal(result.navigateUrl, responseUrl);
});

test('auto apply stops before response link that redirects to signup', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Отклик на вакансию',
    hasTextarea: false,
    responseHref: 'https://hh.ru/account/signup?backurl=https%3A%2F%2Fhh.ru%2Fsearch%2Fvacancy%3Ftext%3Djava'
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.appended.at(-1).status, 'error');
  assert.match(result.appended.at(-1).error, /страница входа или регистрации/);
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
  assert.match(result.response.error, /Требуется авторизация HH/);
  assert.equal(result.appended.length, 0);
  assert.equal(result.submitClicks, 0);
  assert.equal(result.states.at(-1).state, 'error');
});

test('auto apply clears stale auth error before starting an authorized run', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Отклик на вакансию',
    hasTextarea: false,
    initialLocalStore: {
      runState: {
        state: 'error',
        lastError: 'Требуется авторизация HH. Войдите на hh.ru перед использованием HH Job Assistant.'
      }
    }
  });

  assert.equal(result.response.ok, true);
  assert.deepEqual(result.states[0], {
    state: 'scanning',
    found: 0,
    processed: 0,
    applied: 0,
    skipped: 0,
    errors: 0,
    currentAction: 'Проверяю страницу HH',
    lastError: ''
  });
  assert.equal(result.states.some((state) => /Требуется авторизация HH/.test(state.lastError || '')), false);
  assert.equal(result.states.at(-1).state, 'complete');
});

test('auto apply shows action cursor while clicking response and submit buttons', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Отклик на вакансию',
    hasTextarea: false
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.submitClicks, 1);
  assert.ok(result.autoApplyCursorCount >= 1);
  assert.equal(result.submitButtonHighlighted, true);
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
  assert.match(result.response.error, /Требуется авторизация HH/);
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
  assert.match(result.appended.at(-1).error, /заполняемые поля HH не найдены/);
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
  assert.match(result.appended.at(-1).error, /видимость резюме/);
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
  assert.match(result.appended.at(-1).error, /^Пропущено: видимость резюме/);
});

test('auto apply stops cleanly when hh shows daily response limit after response click', async () => {
  const result = await runContentAutoApply({
    responseClickOpensDialog: false,
    bodyTextAfterResponseClick: HH_DAILY_RESPONSE_LIMIT_TEXT,
    dailyLimit: 2,
    nextPageUrl: 'https://hh.ru/search/vacancy?text=java&page=1'
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 0);
  assert.equal(result.response.skipped, 1);
  assert.equal(result.response.errors, 0);
  assert.equal(result.submitClicks, 0);
  assert.equal(result.navigateUrl, '');
  assert.equal(result.localStore.autoApplyQueue.active, false);
  assert.equal(result.localStore.autoApplySearchQueue.active, false);
  assert.equal(result.appended.at(-1).status, 'skipped_hh_daily_response_limit');
  assert.equal(result.localStore.runResults.at(-1).status, 'skipped_hh_daily_response_limit');
  assert.match(result.appended.at(-1).error, /исчерпали лимит откликов/);
  assert.equal(result.states.at(-1).state, 'complete');
  assert.equal(result.states.at(-1).currentAction, 'Исчерпан лимит в 200 откликов в день');
  assert.equal(result.states.at(-1).lastError, '');
});

test('auto apply stops cleanly when hh shows daily response limit after submit', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Откликнуться',
    hasTextarea: false,
    submitBodyTextAfterClick: HH_DAILY_RESPONSE_LIMIT_TEXT,
    nextPageUrl: 'https://hh.ru/search/vacancy?text=java&page=1'
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 0);
  assert.equal(result.response.skipped, 1);
  assert.equal(result.response.errors, 0);
  assert.equal(result.submitClicks, 1);
  assert.equal(result.navigateUrl, '');
  assert.equal(result.localStore.autoApplyQueue.active, false);
  assert.equal(result.localStore.autoApplySearchQueue.active, false);
  assert.equal(result.localStore.autoApplyPendingSubmit, null);
  assert.equal(result.appended.at(-1).status, 'skipped_hh_daily_response_limit');
  assert.equal(result.localStore.runResults.at(-1).status, 'skipped_hh_daily_response_limit');
  assert.equal(result.states.at(-1).state, 'complete');
  assert.equal(result.states.at(-1).currentAction, 'Исчерпан лимит в 200 откликов в день');
  assert.equal(result.states.at(-1).lastError, '');
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
  assert.equal(result.states.at(-1).currentAction, 'Отклики завершены');
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
  assert.match(result.appended.at(-1).error, /видимость резюме/);
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
  assert.ok(result.states.some((state) => state.currentAction === 'HH предупреждает: отклик может получить отказ — подтверждаю отклик'));
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
  assert.ok(result.states.some((state) => state.currentAction === 'HH предупреждает: отклик может получить отказ — подтверждаю отклик'));
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
  assert.ok(result.states.some((state) => state.currentAction === 'HH предупреждает: отклик может получить отказ — подтверждаю отклик'));
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

test('auto apply fills choice and text questions on open response form before submit', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Откликнуться',
    hasTextarea: true,
    startOnResponseForm: true,
    hasQuestionField: true,
    questionFieldLabel: 'Если ответ да, опишите проект',
    questionControls: [
      { type: 'checkbox', name: 'task_302888680', label: 'да', value: '302888681' },
      { type: 'checkbox', name: 'task_302888680', label: 'нет', value: '302888682' }
    ],
    initialLocalStore: {
      agentDebugLogsEnabled: true,
      agentDebugLog: []
    },
    groqResponse: {
      ok: true,
      text: 'Choice group 1: нет\nText question 1: Релевантного опыта автоматизации государственных услуг на стороне исполнителя нет.'
    }
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 1);
  assert.equal(result.response.skipped, 0);
  assert.equal(result.submitClicks, 1);
  assert.deepEqual(result.checkedLabels, ['нет']);
  assert.equal(
    result.textareaValue,
    'Релевантного опыта автоматизации государственных услуг на стороне исполнителя нет.'
  );
  const questionDetectedLog = result.localStore.agentDebugLog.find((entry) => entry.event === 'question_test_detected');
  const answersAppliedLog = result.localStore.agentDebugLog.find((entry) => entry.event === 'question_test_answers_applied');
  assert.equal(questionDetectedLog.details.questions.textQuestions[0].question, 'Если ответ да, опишите проект');
  assert.equal(questionDetectedLog.details.questions.choiceQuestions[0].options[1].label, 'нет');
  assert.match(questionDetectedLog.details.questionContext, /Text question 1: Если ответ да, опишите проект/);
  assert.match(answersAppliedLog.details.assistance, /Choice group 1: нет/);
  assert.equal(answersAppliedLog.details.answers.textAnswers[0].answer, 'Релевантного опыта автоматизации государственных услуг на стороне исполнителя нет.');
  assert.deepEqual(answersAppliedLog.details.answers.choiceAnswers[0].selectedOptions, ['нет']);
  assert.equal(result.appended.at(-1).status, 'applied_test_assisted');
});

test('auto apply does not count open response form submit without hh confirmation', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Откликнуться',
    hasTextarea: true,
    startOnResponseForm: true,
    hasQuestionField: true,
    groqResponse: { ok: true, text: '250 000 руб. на руки' },
    submitBodyTextAfterClick: '',
    keepDialogOpenAfterSubmit: true
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 0);
  assert.equal(result.response.skipped, 1);
  assert.equal(result.submitClicks, 1);
  assert.equal(result.appended.at(-1).status, 'skipped_submit_not_confirmed');
  assert.equal(result.localStore.autoApplyPendingSubmit, null);
});

test('auto apply keeps hh validation text when submit remains unconfirmed', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Откликнуться',
    hasTextarea: true,
    startOnResponseForm: true,
    hasQuestionField: true,
    groqResponse: { ok: true, text: '250 000 руб. на руки' },
    submitBodyTextAfterClick: 'Заполните обязательное поле\nОткликнуться',
    keepDialogOpenAfterSubmit: true
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 0);
  assert.equal(result.response.skipped, 1);
  assert.equal(result.appended.at(-1).status, 'skipped_submit_not_confirmed');
  assert.match(result.appended.at(-1).error, /Заполните обязательное поле/);
});

test('auto apply validates question textarea value before submit', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Откликнуться',
    hasTextarea: true,
    startOnResponseForm: true,
    hasQuestionField: true,
    rejectQuestionFieldWrites: true,
    groqResponse: { ok: true, text: '250 000 руб. на руки' }
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 0);
  assert.equal(result.response.skipped, 1);
  assert.equal(result.submitClicks, 0);
  assert.equal(result.appended.at(-1).status, 'skipped_text_fill_not_verified');
});

test('auto apply fills required contenteditable cover letter before submit', async () => {
  const result = await runContentAutoApply({
    dialogText: [
      'Отклик на вакансию',
      'Сопроводительное письмо',
      'Сопроводительное письмо обязательное для этой вакансии',
      'Такой отклик может получить отказ',
      'Откликнуться'
    ].join('\n'),
    hasTextarea: false,
    hasContentEditableCoverLetter: true,
    disabledSubmit: true,
    initialLocalStore: { agentDebugLog: [], agentDebugLogsEnabled: true },
    groqResponse: { ok: true, text: 'Занимался backend API и интеграциями. Откликаюсь.' }
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 1);
  assert.equal(result.response.skipped, 0);
  assert.equal(result.submitClicks, 1);
  assert.equal(result.contentEditableCoverLetterText, 'Занимался backend API и интеграциями. Откликаюсь.');
  assert.equal(result.appended.at(-1).status, 'applied');
});

test('auto apply treats hh attach-cover-letter modal as cover letter, not questions', async () => {
  const result = await runContentAutoApply({
    dialogText: [
      'Сопроводительное письмо',
      'Почему именно ваша кандидатура должна заинтересовать работодателя',
      'Сгенерировать · 1 раз бесплатно',
      'Закрыть',
      'Отправить'
    ].join('\n'),
    hasTextarea: true,
    initialLocalStore: { agentDebugLog: [], agentDebugLogsEnabled: true },
    groqResponse: { ok: true, text: 'Занимался JVM backend и API. Откликаюсь.' }
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 1);
  assert.equal(result.response.skipped, 0);
  assert.equal(result.submitClicks, 1);
  assert.equal(result.groqRequests.length, 1);
  assert.equal(result.groqRequests.at(-1).task, 'cover_letter');
  assert.equal(result.textareaValue, 'Занимался JVM backend и API. Откликаюсь.');
  const coverLog = result.localStore.agentDebugLog.find((entry) => entry.event === 'cover_letter_applied');
  assert.equal(coverLog.details.insertedText, undefined);
  assert.equal(coverLog.details.sourceText, undefined);
  assert.equal(coverLog.details.fieldLength, 'Занимался JVM backend и API. Откликаюсь.'.length);
  assert.equal(coverLog.details.letterLength, 'Занимался JVM backend и API. Откликаюсь.'.length);
  assert.match(coverLog.details.field.marker, /Сопроводительное письмо/);
  assert.equal(result.appended.at(-1).status, 'applied');
});

test('auto apply falls back when Groq cover letter looks like prompt leakage', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Отклик на вакансию\nСопроводительное письмо',
    hasTextarea: true,
    groqResponse: {
      ok: true,
      text: [
        'Резюме кандидата:',
        '- Java',
        '- Kotlin',
        '- Spring Boot',
        '- Kafka',
        'Текст вакансии:',
        'Нужно написать письмо.'
      ].join('\n')
    }
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 1);
  assert.equal(result.response.skipped, 0);
  assert.equal(result.submitClicks, 1);
  assert.equal(result.textareaValue, 'Занимался JVM backend и API. Откликаюсь.');
  assert.equal(result.appended.at(-1).status, 'applied');
});

test('auto apply accepts short human Groq cover letter', async () => {
  const letter = 'Занимался JVM backend и API. Откликаюсь.';
  const result = await runContentAutoApply({
    dialogText: 'Отклик на вакансию\nСопроводительное письмо',
    hasTextarea: true,
    groqResponse: { ok: true, text: letter }
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 1);
  assert.equal(result.response.skipped, 0);
  assert.equal(result.submitClicks, 1);
  assert.equal(result.textareaValue, letter);
  assert.equal(result.appended.at(-1).status, 'applied');
});

test('auto apply falls back when Groq cover letter sounds like corporate template', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Отклик на вакансию\nСопроводительное письмо',
    hasTextarea: true,
    groqResponse: {
      ok: true,
      text: 'Уважаемая команда, меня привлекла возможность работать над масштабными проектами, где ценятся инновации и эффективность. Я готов применять свой опыт в построении надежных микросервисных решений и автоматизации процессов, чтобы ускорять доставку продукта. Гибкий формат работы и открытость к удаленному сотрудничеству позволяют мне быстро включаться в новые задачи и поддерживать высокий уровень качества.'
    }
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 1);
  assert.equal(result.response.skipped, 0);
  assert.equal(result.submitClicks, 1);
  assert.equal(result.textareaValue, 'Занимался JVM backend и API. Откликаюсь.');
  assert.equal(result.appended.at(-1).status, 'applied');
});

test('auto apply falls back when Groq cover letter is a three sentence template', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Отклик на вакансию\nСопроводительное письмо',
    hasTextarea: true,
    groqResponse: {
      ok: true,
      text: 'Работал с backend-сервисами на Java. Делал интеграции и API. Будет интересно применить этот опыт в ваших задачах.'
    }
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 1);
  assert.equal(result.response.skipped, 0);
  assert.equal(result.submitClicks, 1);
  assert.equal(result.textareaValue, 'Занимался JVM backend и API. Откликаюсь.');
  assert.equal(result.appended.at(-1).status, 'applied');
});

test('auto apply falls back when Groq cover letter sounds like formal requirement matching', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Отклик на вакансию\nСопроводительное письмо',
    hasTextarea: true,
    groqResponse: { ok: true, text: 'Опыт проектирования интеграций и микросервисов на Spring Boot соответствует требованиям вакансии.' }
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 1);
  assert.equal(result.response.skipped, 0);
  assert.equal(result.submitClicks, 1);
  assert.equal(result.textareaValue, 'Занимался JVM backend и API. Откликаюсь.');
  assert.equal(result.appended.at(-1).status, 'applied');
});

test('auto apply falls back when Groq cover letter uses stiff overlap wording', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Отклик на вакансию\nСопроводительное письмо',
    hasTextarea: true,
    groqResponse: { ok: true, text: 'Задачи с JVM backend и API близки к моему опыту, поэтому откликаюсь.' }
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 1);
  assert.equal(result.response.skipped, 0);
  assert.equal(result.submitClicks, 1);
  assert.equal(result.textareaValue, 'Занимался JVM backend и API. Откликаюсь.');
  assert.equal(result.appended.at(-1).status, 'applied');
});

test('auto apply counts already-applied cover form update before submit lookup', async () => {
  const coverLetter = 'Занимался JVM backend и API. Откликаюсь.';
  const result = await runContentAutoApply({
    dialogText: [
      'Отклик на вакансию',
      'Сопроводительное письмо',
      'Сопроводительное письмо обязательное для этой вакансии',
      'Откликнуться'
    ].join('\n'),
    hasCoverLetterField: true,
    submitButtonText: 'Закрыть',
    dialogTextAfterCoverInput: 'Отклик на вакансию Вы откликнулись Чат',
    groqResponse: { ok: true, text: coverLetter }
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 1);
  assert.equal(result.response.skipped, 0);
  assert.equal(result.submitClicks, 0);
  assert.equal(result.coverTextareaValue, coverLetter);
  assert.equal(result.appended.at(-1).status, 'applied_already_confirmed');
  assert.equal(result.appended.at(-1).error, '');
});

test('stop before submit preserves generated answers and prevents application submit', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Откликнуться',
    hasTextarea: true,
    startOnResponseForm: true,
    hasQuestionField: true,
    groqResponse: { ok: true, text: '250 000 руб. на руки' },
    stopWhenState: 'submitting'
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.submitClicks, 0);
  assert.equal(result.textareaValue, '250 000 руб. на руки');
  assert.equal(result.appended.some((item) => /^applied/.test(item.status)), false);
  assert.equal(result.states.at(-1).state, 'stopped');
});

test('stop-before-submit flag preserves generated cover letter and prevents submit', async () => {
  const letter = 'Работал со Spring Boot и микросервисами. Откликаюсь.';
  const result = await runContentAutoApply({
    dialogText: 'Откликнуться\nСопроводительное письмо',
    hasTextarea: true,
    startOnResponseForm: true,
    initialLocalStore: {
      autoApplyStopBeforeSubmit: true,
      agentDebugLog: [],
      agentDebugLogsEnabled: true
    },
    groqResponse: { ok: true, text: letter }
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.submitClicks, 0);
  assert.equal(result.textareaValue, letter);
  assert.equal(result.appended.some((item) => /^applied/.test(item.status)), false);
  assert.equal(result.localStore.autoApplyStopBeforeSubmit, false);
  assert.equal(result.localStore.autoApplyStopRequested, true);
  assert.equal(result.states.at(-1).state, 'stopped');
  assert.equal(result.localStore.agentDebugLog.at(-1).event, 'stop_before_submit');
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

test('auto apply skips when generated question answers still look like model garbage', async () => {
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
  assert.equal(result.textareaValue, '');
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

test('auto apply skips when prompt context leaked into generated text answer', async () => {
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
  assert.equal(result.textareaValue, '');
  assert.equal(result.appended.at(-1).status, 'skipped_bad_generated_answer');
});

test('auto apply sends visible messenger question text and skips non-contact answer', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Откликнуться\nУкажите, пожалуйста, ник для связи в телеграмме. Или в ином мессенджере.',
    hasTextarea: true,
    startOnResponseForm: true,
    hasQuestionField: true,
    questionFieldLabel: 'Укажите, пожалуйста, ник для связи в телеграмме. Или в ином мессенджере.',
    groqResponse: {
      ok: true,
      text: 'Text question 1: Опыт работы в банках и финтехе составляет более 6 лет.'
    }
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 0);
  assert.equal(result.response.skipped, 1);
  assert.equal(result.submitClicks, 0);
  assert.match(result.groqRequests.at(-1).extraText, /Укажите, пожалуйста, ник для связи в телеграмме/);
  assert.doesNotMatch(result.groqRequests.at(-1).extraText, /Text question 1: task_235076159_text\s*Писать тут/);
  assert.equal(result.appended.at(-1).status, 'skipped_bad_generated_answer');
  assert.match(result.appended.at(-1).error, /не похож на контакт/);
});

test('auto apply fills messenger question when answer contains contact handle', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Откликнуться\nУкажите, пожалуйста, ник для связи в телеграмме. Или в ином мессенджере.',
    hasTextarea: true,
    startOnResponseForm: true,
    hasQuestionField: true,
    questionFieldLabel: 'Укажите, пожалуйста, ник для связи в телеграмме. Или в ином мессенджере.',
    groqResponse: {
      ok: true,
      text: 'Text question 1: t.me/example_candidate'
    }
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 1);
  assert.equal(result.submitClicks, 1);
  assert.equal(result.textareaValue, 't.me/example_candidate');
  assert.equal(result.appended.at(-1).status, 'applied_test_assisted');
});

test('auto apply does not require contact for messenger experience question', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Откликнуться\nРасскажите про опыт разработки высоконагруженных мессенджеров.',
    hasTextarea: true,
    startOnResponseForm: true,
    hasQuestionField: true,
    questionFieldLabel: 'Расскажите про опыт разработки высоконагруженных мессенджеров.',
    groqResponse: {
      ok: true,
      text: 'Text question 1: Руководил backend-командой, проектировал микросервисы и интеграции для высоконагруженных коммуникационных продуктов.'
    }
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 1);
  assert.equal(result.response.skipped, 0);
  assert.equal(result.submitClicks, 1);
  assert.equal(
    result.textareaValue,
    'Руководил backend-командой, проектировал микросервисы и интеграции для высоконагруженных коммуникационных продуктов.'
  );
  assert.equal(result.appended.at(-1).status, 'applied_test_assisted');
});

test('auto apply asks Groq for salary and messenger fields when salary setting exists', async () => {
  const fullFormText = [
    'Ответьте на вопросы',
    'Был ли у Вас опыт реализации IT проектов в банках или в финтехе?',
    'Да, был опыт в банках или финтехе',
    'Нет, но был опыт в ecom, где тоже высоконагруженные сервисы',
    'Нет, опыт не в банках/финтехе/ecom',
    'Свой вариант',
    'Были ли у Вас в работе проекты, где нужен был распил монолита на микросервисы?',
    'Да',
    'Нет',
    'Свой вариант',
    'Был ли у Вас опыт координации от 5 команд одновременно?',
    'Да',
    'Нет, на проектах было от 1 до 5 команд',
    'Свой вариант',
    'Укажите, пожалуйста, свои зарплатные ожидания по фиксированной части (окладу) до вычета налога (т.е. gross).',
    'Писать тут',
    'Укажите, пожалуйста, ник для связи в телеграмме. Или в ином мессенджере.',
    'Писать тут'
  ].join('\n');
  const result = await runContentAutoApply({
    dialogText: fullFormText,
    bodyText: fullFormText,
    hasTextarea: true,
    startOnResponseForm: true,
    hasQuestionField: true,
    questionFieldCount: 2,
    expectedSalary: '600000',
    initialLocalStore: {
      resumeParsedText: 'Tech Lead\nКонтакт: t.me/example_candidate'
    },
    groqResponse: {
      ok: true,
      text: [
        'Text question 1: 650000 gross',
        'Text question 2: Опыт управления ИТ-проектами включает координацию процесса декомпозиции монолитного ДБО.'
      ].join('\n')
    }
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 1);
  assert.equal(result.submitClicks, 1);
  assert.deepEqual(result.textareaValues, ['650000 gross', 't.me/example_candidate']);
  assert.equal(result.groqRequests.length, 1);
  assert.match(result.groqRequests.at(-1).extraText, /зарплатные ожидания/);
  assert.match(result.groqRequests.at(-1).extraText, /ник для связи/);
});

test('auto apply does not paste expected salary into non-salary employer questions', async () => {
  const result = await runContentAutoApply({
    dialogText: [
      'Ответьте на вопросы',
      'Был ли у Вас опыт управления командой автоматизации?',
      'Писать тут',
      'Опишите опыт построения процессов качества.',
      'Писать тут'
    ].join('\n'),
    hasTextarea: true,
    startOnResponseForm: true,
    hasQuestionField: true,
    questionFieldCount: 2,
    questionFieldLabels: [
      'Был ли у Вас опыт управления командой автоматизации?',
      'Опишите опыт построения процессов качества.'
    ],
    expectedSalary: '350000',
    groqResponse: {
      ok: true,
      text: [
        'Text question 1: Да, руководил командой автоматизации, распределял задачи, ревьюил тестовую архитектуру и синхронизировал качество релизов с разработкой.',
        'Text question 2: Выстраивал регрессионные контуры, CI-проверки и прозрачную приоритизацию дефектов для ускорения стабильных релизов.'
      ].join('\n')
    }
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.submitClicks, 1);
  assert.equal(result.groqRequests.length, 1);
  assert.deepEqual(result.textareaValues, [
    'Да, руководил командой автоматизации, распределял задачи, ревьюил тестовую архитектуру и синхронизировал качество релизов с разработкой.',
    'Выстраивал регрессионные контуры, CI-проверки и прозрачную приоритизацию дефектов для ускорения стабильных релизов.'
  ]);
  assert.doesNotMatch(result.textareaValues.join('\n'), /350000/);
});

test('auto apply keeps distinct valid answers for two employer questions', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Ответьте на вопросы\nОпыт C/C++\nПисать тут\nУровень английского\nПисать тут',
    hasTextarea: true,
    startOnResponseForm: true,
    hasQuestionField: true,
    questionFieldCount: 2,
    questionFieldLabels: ['Расскажите об опыте C/C++.', 'Оцените уровень английского языка.'],
    groqResponse: {
      ok: true,
      text: [
        'Text question 1: Разрабатывал системные компоненты на C++ и готов перейти на чистый C как основной язык.',
        'Text question 2: Английский B2: читаю документацию и комфортно участвую в рабочих обсуждениях.'
      ].join('\n')
    }
  });

  assert.equal(result.response.applied, 1);
  assert.equal(result.submitClicks, 1);
  assert.deepEqual(result.textareaValues, [
    'Разрабатывал системные компоненты на C++ и готов перейти на чистый C как основной язык.',
    'Английский B2: читаю документацию и комфортно участвую в рабочих обсуждениях.'
  ]);
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
  assert.doesNotMatch(result.groqRequests.at(-1).extraText, /Visible HH response form text/);
  assert.ok(result.groqRequests.at(-1).extraText.length <= 2200);
});

test('auto apply accepts one digit numeric answers for employer text questions', async () => {
  const result = await runContentAutoApply({
    dialogText: [
      'Отклик на вакансию',
      'Есть ли у вас опыт проектирования интеграций на крупных гос. проектах?',
      'Да',
      'Нет',
      'Был ли у вас опыт управления командой, наставничества в роли техлида/тимлида?',
      'Да',
      'Нет',
      'Каким максимальным количеством разработчиков у вас был опыт руководства?',
      'Писать тут',
      'Сколько лет вы разрабатываете на Java?',
      'Писать тут',
      'В каком городе вы проживаете?',
      'Писать тут',
      'Ваши пожелания по уровню з/п(минимум и комфорт)?',
      'Писать тут'
    ].join('\n'),
    hasTextarea: true,
    startOnResponseForm: true,
    hasQuestionField: true,
    questionFieldCount: 4,
    questionFieldLabels: [
      'Каким максимальным количеством разработчиков у вас был опыт руководства?',
      'Сколько лет вы разрабатываете на Java?',
      'В каком городе вы проживаете?',
      'Ваши пожелания по уровню з/п(минимум и комфорт)?'
    ],
    questionControls: [
      { type: 'radio', name: 'integration', label: 'Да', value: 'yes' },
      { type: 'radio', name: 'integration', label: 'Нет', value: 'no' },
      { type: 'radio', name: 'lead', label: 'Да', value: 'lead_yes' },
      { type: 'radio', name: 'lead', label: 'Нет', value: 'lead_no' }
    ],
    groqResponse: {
      ok: true,
      text: [
        'Choice group 1: Нет',
        'Choice group 2: Да',
        'Text question 1: 5',
        'Text question 2: 9',
        'Text question 3: Москва',
        'Text question 4: 300000 минимум, 350000 комфорт'
      ].join('\n')
    }
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 1);
  assert.equal(result.response.skipped, 0);
  assert.equal(result.submitClicks, 1);
  assert.deepEqual(result.checkedLabels, ['Нет', 'Да']);
  assert.deepEqual(result.textareaValues, ['5', '9', 'Москва', '300000 минимум, 350000 комфорт']);
  assert.equal(result.appended.at(-1).status, 'applied_test_assisted');
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
    initialLocalStore: { workFormatPreference: 'hybrid' },
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
  assert.equal(result.groqRequests.at(-1).task, 'choice_retry');
  assert.equal(result.groqRequests.at(-1).vacancyText, '');
  assert.match(result.groqRequests.at(-1).extraText, /Previous answer:\nПодходит гибридный формат работы/);
  assert.doesNotMatch(result.groqRequests.at(-1).extraText, /Return only exact option labels/);
  assert.doesNotMatch(result.groqRequests.at(-1).extraText, /Вакансия/);
  assert.equal(result.appended.at(-1).status, 'applied_test_assisted');
});

test('auto apply retries and falls back only missing groups after partial AI choice match', async () => {
  const questionControls = Array.from({ length: 18 }, (_, index) => [
    { type: 'radio', name: `group_${index + 1}`, label: `Да ${index + 1}`, value: `yes_${index + 1}` },
    { type: 'radio', name: `group_${index + 1}`, label: `Нет ${index + 1}`, value: `no_${index + 1}` }
  ]).flat();
  const initialAnsweredGroups = [1, 2, 3, 4, 5, 6, 8, 9, 18];
  const result = await runContentAutoApply({
    dialogText: 'Отклик на вакансию\nОтветьте на вопросы работодателя',
    hasTextarea: true,
    hasQuestionField: true,
    questionFieldLabel: 'Ваш город?',
    startOnResponseForm: true,
    questionControls,
    initialLocalStore: { agentDebugLogsEnabled: true },
    groqResponse: [
      {
        ok: true,
        text: [
          ...initialAnsweredGroups.map((index) => `Choice group ${index}: Да ${index}`),
          'Text question 1: Москва'
        ].join('\n')
      },
      { ok: true, text: 'Ответ без точных вариантов.' }
    ]
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 1);
  assert.equal(result.response.skipped, 0);
  assert.equal(result.submitClicks, 1);
  assert.equal(result.checkedLabels.length, 18);
  assert.deepEqual(result.textareaValues, ['Москва']);
  for (const index of initialAnsweredGroups) {
    assert.ok(result.checkedLabels.includes(`Да ${index}`));
  }
  assert.equal(result.groqRequests.length, 2);
  assert.equal(result.groqRequests.at(-1).task, 'choice_retry');
  assert.match(result.groqRequests.at(-1).extraText, /Choice group 7/);
  assert.match(result.groqRequests.at(-1).extraText, /Choice group 17/);
  assert.doesNotMatch(result.groqRequests.at(-1).extraText, /Choice group 1 \(/);
  assert.equal(result.localStore.agentDebugLog.find((entry) => entry.event === 'question_choices_retry')?.details.reason, 'partial_matching_option_labels');
  assert.equal(result.appended.at(-1).status, 'applied_test_assisted');
});

test('auto apply does not send question text as fake HH choice options', async () => {
  const formText = [
    'Отклик на вакансию',
    'Ответьте на вопросы работодателя',
    'Где располагается место работы?',
    'Какой график работы?',
    'Вакансия открыта?'
  ].join('\n');
  const result = await runContentAutoApply({
    dialogText: formText,
    bodyText: formText,
    hasTextarea: false,
    startOnResponseForm: true,
    questionControls: [
      { type: 'radio', name: 'workplace', label: 'Где располагается место работы?', value: 'on' },
      { type: 'radio', name: 'schedule', label: 'Какой график работы?', value: 'short' },
      { type: 'radio', name: 'open', label: 'Вакансия открыта?', value: 'true' }
    ],
    groqResponse: { ok: true, text: 'Choice group 1: Где располагается место работы?' }
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 0);
  assert.equal(result.response.skipped, 1);
  assert.equal(result.submitClicks, 0);
  assert.deepEqual(result.checkedLabels, []);
  assert.equal(result.groqRequests.length, 0);
  assert.equal(result.appended.at(-1).status, 'skipped_question_fields_not_found');
});

test('auto apply accepts exact short code from multiline hh choice label', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Отклик на вакансию\nОтветьте на вопросы работодателя\nВыберите формат описания вакансии',
    hasTextarea: false,
    startOnResponseForm: true,
    questionControls: [
      { type: 'radio', name: 'description', label: 'краткое описания вакансий\nshort', value: 'short' },
      { type: 'radio', name: 'description', label: 'полное описание вакансий\nfull', value: 'full' }
    ],
    groqResponse: { ok: true, text: 'Choice group 1: full' }
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 1);
  assert.equal(result.response.skipped, 0);
  assert.equal(result.submitClicks, 1);
  assert.deepEqual(result.checkedLabels, ['полное описание вакансий\nfull']);
  assert.equal(result.groqRequests.length, 1);
  assert.equal(result.appended.at(-1).status, 'applied_test_assisted');
});

test('auto apply uses fallback choice when Groq returns no matching option labels', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Отклик на вакансию\nОтветьте на вопросы работодателя\nГотовы ли вы работать в гибридном графике?',
    hasTextarea: false,
    startOnResponseForm: true,
    questionControls: [
      { type: 'radio', name: 'hybrid', label: 'Да', value: 'yes' },
      { type: 'radio', name: 'hybrid', label: 'Нет', value: 'no' }
    ],
    initialLocalStore: { workFormatPreference: 'hybrid' },
    groqResponse: [
      { ok: true, text: 'Подходит гибридный формат работы.' },
      { ok: true, text: 'Можно рассмотреть разные варианты.' }
    ]
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 1);
  assert.equal(result.response.skipped, 0);
  assert.equal(result.submitClicks, 1);
  assert.deepEqual(result.checkedLabels, ['Да']);
  assert.equal(result.groqRequests.length, 2);
  assert.equal(result.appended.at(-1).status, 'applied_test_assisted');
});

test('auto apply fallback prefers exact positive option over misleading negative label', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Отклик на вакансию\nОтветьте на вопросы работодателя\nГотовы приступить?',
    hasTextarea: false,
    startOnResponseForm: true,
    questionControls: [
      { type: 'radio', name: 'ready', label: 'Никогда', value: 'never' },
      { type: 'radio', name: 'ready', label: 'Да, готов', value: 'yes' },
      { type: 'radio', name: 'ready', label: 'Нет', value: 'no' }
    ],
    groqResponse: [
      { ok: true, text: 'Можно обсудить.' },
      { ok: true, text: 'Без точного варианта.' }
    ]
  });

  assert.equal(result.response.applied, 1);
  assert.deepEqual(result.checkedLabels, ['Да, готов']);
});

test('auto apply uses fallback choice when Groq choice retry is empty', async () => {
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
      {
        ok: false,
        error: 'Groq вернул пустой ответ (задача: уточнение вариантов HH, HTTP 200, finish_reason=length, попытки 2/2, max_tokens=300, completion_tokens=300). Если finish_reason=length, модель уперлась в лимит вывода и не вернула message.content.'
      }
    ]
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 1);
  assert.equal(result.response.skipped, 0);
  assert.equal(result.response.errors, 0);
  assert.equal(result.submitClicks, 1);
  assert.deepEqual(result.checkedLabels, ['Да']);
  assert.equal(result.appended.at(-1).status, 'applied_test_assisted');
});

test('auto apply fallback obeys configured work-format preference', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Отклик на вакансию\nОтветьте на вопросы работодателя\nКакой формат работы вам подходит?',
    hasTextarea: false,
    startOnResponseForm: true,
    questionControls: [
      { type: 'radio', name: 'work_format', label: 'Удаленка', value: 'remote' },
      { type: 'radio', name: 'work_format', label: 'Гибрид', value: 'hybrid' },
      { type: 'radio', name: 'work_format', label: 'Офис', value: 'office' }
    ],
    initialLocalStore: { workFormatPreference: 'remote' },
    groqResponse: { ok: false, error: 'Groq request failed: 429 rate limit' }
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 1);
  assert.equal(result.submitClicks, 1);
  assert.deepEqual(result.checkedLabels, ['Удаленка']);
  assert.equal(result.appended.at(-1).status, 'applied_test_assisted');

  const hybridResult = await runContentAutoApply({
    dialogText: 'Отклик на вакансию\nОтветьте на вопросы работодателя\nКакой формат работы вам подходит?',
    hasTextarea: false,
    startOnResponseForm: true,
    questionControls: [
      { type: 'radio', name: 'work_format', label: 'Удаленка', value: 'remote' },
      { type: 'radio', name: 'work_format', label: 'Гибрид', value: 'hybrid' },
      { type: 'radio', name: 'work_format', label: 'Офис', value: 'office' }
    ],
    initialLocalStore: { workFormatPreference: 'hybrid' },
    groqResponse: { ok: false, error: 'Groq request failed: 429 rate limit' }
  });

  assert.equal(hybridResult.response.ok, true);
  assert.equal(hybridResult.response.applied, 1);
  assert.equal(hybridResult.submitClicks, 1);
  assert.deepEqual(hybridResult.checkedLabels, ['Гибрид']);
  assert.equal(hybridResult.appended.at(-1).status, 'applied_test_assisted');
});

test('auto apply fallback can select multiple configured work formats from checkbox group', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Отклик на вакансию\nОтветьте на вопросы работодателя\nКакие форматы работы вам подходят?',
    hasTextarea: false,
    startOnResponseForm: true,
    questionControls: [
      { type: 'checkbox', name: 'work_format', label: 'Удаленка', value: 'remote' },
      { type: 'checkbox', name: 'work_format', label: 'Гибрид', value: 'hybrid' },
      { type: 'checkbox', name: 'work_format', label: 'Офис', value: 'office' }
    ],
    initialLocalStore: { workFormatPreference: ['remote', 'hybrid'] },
    groqResponse: { ok: false, error: 'Groq request failed: 429 rate limit' }
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 1);
  assert.equal(result.submitClicks, 1);
  assert.deepEqual(result.checkedLabels, ['Удаленка', 'Гибрид']);
  assert.equal(result.appended.at(-1).status, 'applied_test_assisted');
});

test('auto apply fallback obeys configured employment preference', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Отклик на вакансию\nОтветьте на вопросы работодателя\nКакой формат оформления вам подходит: ТК или ИП?',
    hasTextarea: false,
    startOnResponseForm: true,
    questionControls: [
      { type: 'radio', name: 'employment', label: 'ТК', value: 'labor_contract' },
      { type: 'radio', name: 'employment', label: 'ИП', value: 'individual_entrepreneur' }
    ],
    initialLocalStore: { employmentPreference: 'individual_entrepreneur' },
    groqResponse: [
      { ok: true, text: 'Можно рассмотреть разные варианты.' },
      { ok: true, text: 'Можно рассмотреть разные варианты.' }
    ]
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 1);
  assert.equal(result.submitClicks, 1);
  assert.deepEqual(result.checkedLabels, ['ИП']);
  assert.equal(result.appended.at(-1).status, 'applied_test_assisted');

  const laborContractResult = await runContentAutoApply({
    dialogText: 'Отклик на вакансию\nОтветьте на вопросы работодателя\nКакой формат оформления вам подходит: ТК или ИП?',
    hasTextarea: false,
    startOnResponseForm: true,
    questionControls: [
      { type: 'radio', name: 'employment', label: 'ТК', value: 'labor_contract' },
      { type: 'radio', name: 'employment', label: 'ИП', value: 'individual_entrepreneur' }
    ],
    initialLocalStore: { employmentPreference: 'labor_contract' },
    groqResponse: [
      { ok: true, text: 'Можно рассмотреть разные варианты.' },
      { ok: true, text: 'Можно рассмотреть разные варианты.' }
    ]
  });

  assert.equal(laborContractResult.response.ok, true);
  assert.equal(laborContractResult.response.applied, 1);
  assert.equal(laborContractResult.submitClicks, 1);
  assert.deepEqual(laborContractResult.checkedLabels, ['ТК']);
  assert.equal(laborContractResult.appended.at(-1).status, 'applied_test_assisted');
});

test('auto apply fallback can select multiple configured employment formats from checkbox group', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Отклик на вакансию\nОтветьте на вопросы работодателя\nКакие форматы оформления вам подходят?',
    hasTextarea: false,
    startOnResponseForm: true,
    questionControls: [
      { type: 'checkbox', name: 'employment', label: 'ТК', value: 'labor_contract' },
      { type: 'checkbox', name: 'employment', label: 'ИП', value: 'individual_entrepreneur' }
    ],
    initialLocalStore: { employmentPreference: ['individual_entrepreneur', 'labor_contract'] },
    groqResponse: { ok: false, error: 'Groq request failed: 429 rate limit' }
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 1);
  assert.equal(result.submitClicks, 1);
  assert.deepEqual(result.checkedLabels, ['ТК', 'ИП']);
  assert.equal(result.appended.at(-1).status, 'applied_test_assisted');
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
    initialLocalStore: { workFormatPreference: 'hybrid' },
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
    groqResponse: { ok: true, text: 'Занимался JVM backend и API. Откликаюсь.' }
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.errors, 0);
  assert.equal(result.submitClicks, 1);
  assert.equal(result.textareaValue, 'Занимался JVM backend и API. Откликаюсь.');
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
  assert.equal(result.response.skipped, 0);
  assert.equal(result.response.navigated, true);
  assert.equal(result.appended.length, 0);
  assert.match(result.navigateUrl, /\/applicant\/vacancy_response\?vacancyId=123/);
});

test('auto apply unconfirmed submit does not consume successful application quota', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Отклик на вакансию',
    hasTextarea: false,
    dailyLimit: 1,
    keepDialogOpenAfterSubmit: true,
    submitBodyTextAfterClick: '',
    nextPageUrl: 'https://hh.ru/search/vacancy?text=java&page=1'
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 0);
  assert.equal(result.response.skipped, 1);
  assert.equal(result.response.navigated, true);
  assert.equal(result.appended.at(-1).status, 'skipped_submit_not_confirmed');
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
  assert.equal(result.response.skipped, 0);
  assert.equal(result.response.navigated, true);
  assert.match(result.navigateUrl, /\/applicant\/vacancy_response\?vacancyId=123/);
  assert.equal(result.appended.length, 0);
});

test('auto apply processed cap completes after employer-question fallback without stale action', async () => {
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
  assert.equal(result.response.applied, 1);
  assert.equal(result.response.processed, 1);
  assert.equal(result.response.skipped, 0);
  assert.equal(result.appended.at(-1).status, 'applied_test_assisted');
  assert.equal(result.states.at(-1).state, 'complete');
  assert.equal(result.states.at(-1).currentAction, 'Отклики завершены');
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

test('auto apply returns to search after assisted question submit opens vacancy detail at processed cap', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Откликнуться\nНа какой уровень дохода вы ориентируетесь?',
    hasTextarea: true,
    hasQuestionField: true,
    responseHref: 'https://hh.ru/applicant/vacancy_response?vacancyId=123',
    responseAttrs: { href: 'https://hh.ru/applicant/vacancy_response?vacancyId=123' },
    navigateOnResponseClick: true,
    submitNavigateHref: 'https://hh.ru/vacancy/123',
    submitBodyTextAfterClick: 'Вы откликнулись на вакансию',
    expectedSalary: '250 000 руб. на руки',
    dailyLimit: 1,
    message: { type: 'START_AUTO_APPLY', limitOverride: 1, maxProcessed: 1 }
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.submitClicks, 1);
  assert.equal(result.textareaValue, '250 000 руб. на руки');
  assert.equal(result.appended.at(-1).status, 'applied_test_assisted');
  assert.equal(result.navigateUrl, 'https://hh.ru/search/vacancy?text=java');
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
  assert.equal(result.localStore.autoApplyQueue.counters.applied, 0);
  assert.equal(result.localStore.autoApplyQueue.counters.skipped, 1);
  assert.equal(result.appended.at(-1).status, 'skipped_no_response_button');
  assert.equal(result.navigateUrl, '');
  assert.equal(result.states.at(-1).state, 'complete');
});

test('auto apply uses expected salary for salary question when Groq key is missing', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Укажите зарплатные ожидания',
    hasTextarea: true,
    startOnResponseForm: true,
    hasQuestionField: true,
    questionFieldLabel: 'Укажите зарплатные ожидания',
    expectedSalary: '250 000 руб. на руки'
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 1);
  assert.equal(result.response.skipped, 0);
  assert.equal(result.submitClicks, 1);
  assert.equal(result.textareaValue, '250 000 руб. на руки');
  assert.equal(result.appended.at(-1).status, 'applied_test_assisted');
});

test('auto apply skips non-salary question without Groq key', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Опишите опыт управления тестированием',
    hasTextarea: true,
    startOnResponseForm: true,
    hasQuestionField: true,
    hasCoverLetterField: true,
    questionFieldLabel: 'Опишите опыт управления тестированием',
    expectedSalary: '250 000 руб. на руки'
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 0);
  assert.equal(result.response.skipped, 1);
  assert.equal(result.submitClicks, 0);
  assert.equal(result.textareaValue, '');
  assert.equal(result.coverTextareaValue, '');
  assert.equal(result.appended.at(-1).status, 'skipped_test_missing_groq_key');
  assert.equal(result.appended.at(-1).coverLetterUsed, false);
});

test('auto apply falls back when mandatory cover letter sounds like corporate template', async () => {
  const result = await runContentAutoApply({
    dialogText: [
      'Отклик на вакансию',
      'Для отклика необходимо ответить на несколько вопросов работодателя',
      'Опишите опыт управления тестированием',
      'Сопроводительное письмо обязательное для этой вакансии'
    ].join('\n'),
    hasTextarea: true,
    startOnResponseForm: true,
    hasQuestionField: true,
    questionFieldLabel: 'Опишите опыт управления тестированием',
    hasCoverLetterField: true,
    groqResponse: [
      { ok: true, text: 'Text question 1: Готов обсудить детали и выполнить требования вакансии.' },
      {
        ok: true,
        text: 'Уважаемая команда, меня привлекла возможность работать над масштабными проектами, где ценятся инновации и эффективность. Я готов применять свой опыт, чтобы ускорять доставку продукта и поддерживать высокий уровень качества.'
      }
    ]
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 1);
  assert.equal(result.response.skipped, 0);
  assert.equal(result.submitClicks, 1);
  assert.equal(result.coverTextareaValue, 'Занимался автотестами backend. Откликаюсь.');
  assert.equal(result.appended.at(-1).status, 'applied_test_assisted');
  assert.equal(result.appended.at(-1).coverLetterUsed, true);
});

test('auto apply does not paste question protocol into mandatory cover letter', async () => {
  const protocolAnswer = [
    'Choice group 1: Да',
    'Choice group 2: Да',
    'Choice group 3: B2',
    'Choice group 4: Гибридный',
    'Choice group 5: Сразу',
    '',
    'Text question 1: 350000',
    'Text question 2: 5 лет в автоматизации тестирования Java, включая проекты в банковском секторе',
    'Text question 3: Опыт работы с Docker-Compose, Kafka, Camunda, Selenium, Playwright, Gatling, WireMock, Allure, JUnit, PostgreSQL, MongoDB, ClickHouse, Elasticsearch, Grafana',
    'Text question 4: Настроил локальное окружение с 30+ зависимостями, сократив время подготовки с 2ч до 25мин',
    'Text question 5: Выстроил тестовую стратегию, позволившую команде проходить полный цикл проверок за 1день вместо 3дней',
    'Text question 6: Спроектировал нагрузочный профиль до 12000 RPS и реализовал Gatling-тесты для критичных API'
  ].join('\n');
  const result = await runContentAutoApply({
    dialogText: [
      'Отклик на вакансию',
      'Для отклика необходимо ответить на несколько вопросов работодателя',
      'Сопроводительное письмо обязательное для этой вакансии',
      'Откликнуться'
    ].join('\n'),
    hasTextarea: true,
    startOnResponseForm: true,
    hasQuestionField: true,
    questionFieldCount: 6,
    questionFieldLabel: 'Ответьте, пожалуйста, на вопросы ниже и скопируйте ответы в сопроводительное письмо',
    hasCoverLetterField: true,
    initialLocalStore: { agentDebugLog: [], agentDebugLogsEnabled: true },
    questionControls: [
      { type: 'radio', name: 'relocation', label: 'Да', value: 'yes' },
      { type: 'radio', name: 'remote', label: 'Да', value: 'yes' },
      { type: 'radio', name: 'english', label: 'B2', value: 'b2' },
      { type: 'radio', name: 'schedule', label: 'Гибридный', value: 'hybrid' },
      { type: 'radio', name: 'start', label: 'Сразу', value: 'now' }
    ],
    groqResponse: { ok: true, text: protocolAnswer }
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 1);
  assert.equal(result.response.skipped, 0);
  assert.equal(result.submitClicks, 1);
  assert.deepEqual(result.checkedLabels, ['Да', 'Да', 'B2', 'Гибридный', 'Сразу']);
  assert.match(result.textareaValues.join('\n'), /350000/);
  assert.equal(result.coverTextareaValue, 'Занимался JVM backend и API. Откликаюсь.');
  assert.doesNotMatch(result.coverTextareaValue, /Choice group|Text question/i);
  assert.equal(result.appended.at(-1).status, 'applied_test_assisted');
  assert.equal(result.appended.at(-1).coverLetterUsed, true);
});

test('auto apply fills live-style confirmation radio and mandatory cover letter', async () => {
  const liveQuestionText = [
    'Отклик на вакансию',
    'Для отклика необходимо ответить на несколько вопросов работодателя',
    'Ответьте, пожалуйста, на несколько вопросов ниже и пронумерованные вопросы и ответы скопируйте в сопроводительное письмо.',
    'Укажите, пожалуйста, функционал и период работы с АБС ЦФТ / ИБСО / ЦФТ-Банк / ЦФТ-Ритейл',
    'Укажите, пожалуйста, ожидания по окладу минимум и комфорт (gross, до вычета налога)',
    'Для мужчин: У Вас есть военный билет или приписное?',
    'Сопроводительное письмо обязательное для этой вакансии'
  ].join('\n');
  const result = await runContentAutoApply({
    dialogText: liveQuestionText,
    bodyText: liveQuestionText,
    hasTextarea: true,
    startOnResponseForm: true,
    validateRequiredBeforeSubmit: true,
    questionControls: [
      {
        type: 'radio',
        name: 'task_286962850',
        label: 'да, я ответил на вопросы и скопировал ответы в сопроводительное письмо',
        value: '286962851'
      }
    ],
    expectedSalary: '250 000 руб. gross'
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 1);
  assert.equal(result.response.skipped, 0);
  assert.equal(result.submitClicks, 1);
  assert.equal(result.appended.at(-1).status, 'applied_test_assisted');
  assert.equal(result.appended.at(-1).coverLetterUsed, true);
  assert.match(result.textareaValue, /АБС ЦФТ|250 000 руб\. gross|Военный билет/);
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

test('auto apply clicks generate resume submit button in hh response dialog', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Откликнуться\nСгенерировать резюме',
    hasTextarea: false,
    submitButtonText: 'Сгенерировать резюме'
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 1);
  assert.equal(result.response.skipped, 0);
  assert.equal(result.submitClicks, 1);
  assert.equal(result.appended.at(-1).status, 'applied');
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
  assert.ok(result.states.some((state) => /Откликаюсь на: Java Developer/.test(state.currentAction || '')));
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
  const pauseIndex = result.states.findIndex((state) => state.currentAction === 'Пауза перед следующим откликом');
  const nextPageIndex = result.states.findIndex((state) => state.currentAction === 'Переход на следующую страницу HH');
  assert.ok(pauseIndex >= 0);
  assert.ok(nextPageIndex > pauseIndex);
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
  const localStore = { ...TEST_READY_CONFIG,
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
  const localStore = { ...TEST_READY_CONFIG,
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

test('auto apply resumes search queue after hh redirects queued response to root page', async () => {
  const source = await readContentScriptSource();
  const navigations = [];
  const states = [];
  const localStore = { ...TEST_READY_CONFIG,
    autoApplyQueue: {
      active: true,
      runId: 'test-run',
      index: 0,
      sourceUrl: 'https://hh.ru/search/vacancy?resume=abc&hhtmFrom=main',
      limit: 100,
      maxProcessed: null,
      returnToSearch: true,
      items: [
        {
          index: 1,
          vacancyId: '134794526',
          title: 'Senior QA',
          url: 'https://hh.ru/vacancy/134794526',
          responseUrl: 'https://hh.ru/applicant/vacancy_response?vacancyId=134794526',
          testDetected: false
        }
      ],
      counters: {
        found: 50,
        processed: 1,
        applied: 0,
        skipped: 0,
        errors: 0
      },
      config: {
        delayMinMs: 1,
        delayMaxMs: 1
      },
      processedVacancyIds: ['134794526']
    }
  };

  globalThis.location = {
    href: 'https://sochi.hh.ru/',
    pathname: '/'
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
    title: 'HH root page',
    body: new FakeElement({ text: 'HeadHunter' }),
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

  await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#recover-root-${crypto.randomUUID()}`);
  const started = Date.now();
  while (navigations.length === 0 && Date.now() - started < 1000) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  assert.deepEqual(navigations, ['https://hh.ru/search/vacancy?resume=abc&hhtmFrom=main']);
  assert.equal(localStore.autoApplyQueue.active, false);
  assert.equal(localStore.autoApplyQueue.recoveredFromUrl, 'https://sochi.hh.ru/');
  assert.equal(localStore.autoApplySearchQueue.active, true);
  assert.equal(localStore.autoApplySearchQueue.runId, 'test-run');
  assert.equal(localStore.autoApplySearchQueue.limit, 100);
  assert.deepEqual(localStore.autoApplySearchQueue.processedVacancyIds, ['134794526']);
  assert.equal(states.at(-1).state, 'applying');
  assert.equal(states.at(-1).currentAction, 'Возвращаюсь на страницу поиска HH');
});

test('auto apply ignores hidden resume parser page while response queue is active', async () => {
  const source = await readContentScriptSource();
  const navigations = [];
  const states = [];
  const localStore = { ...TEST_READY_CONFIG,
    autoApplyQueue: {
      active: true,
      runId: 'test-run',
      index: 0,
      sourceUrl: 'https://hh.ru/search/vacancy?resume=abc&hhtmFrom=main',
      limit: 10,
      returnToSearch: true,
      items: [
        {
          index: 1,
          vacancyId: '134785168',
          title: 'QA manual',
          url: 'https://hh.ru/vacancy/134785168',
          responseUrl: 'https://hh.ru/applicant/vacancy_response?vacancyId=134785168',
          testDetected: true
        }
      ],
      counters: {
        found: 19,
        processed: 2,
        applied: 1,
        skipped: 0,
        errors: 0
      },
      config: {
        delayMinMs: 1,
        delayMaxMs: 1
      },
      processedVacancyIds: ['134798917', '134785168']
    }
  };

  globalThis.location = {
    href: 'https://sochi.hh.ru/resume/64582d4dff10b1c29d0039ed1f6b56307a4652',
    pathname: '/resume/64582d4dff10b1c29d0039ed1f6b56307a4652'
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
    title: 'HH resume page',
    body: new FakeElement({ text: 'Resume text' }),
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

  await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#resume-parser-queue-${crypto.randomUUID()}`);
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.deepEqual(navigations, []);
  assert.deepEqual(states, []);
  assert.equal(localStore.autoApplyQueue.active, true);
  assert.equal(localStore.autoApplyQueue.recoveredFromUrl, undefined);
  assert.equal(localStore.autoApplySearchQueue, undefined);
});

test('auto apply does not recover queued response pages back to a response form url', async () => {
  const source = await readContentScriptSource();
  const navigations = [];
  const states = [];
  const localStore = { ...TEST_READY_CONFIG,
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
  const localStore = { ...TEST_READY_CONFIG,
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
  const localStore = { ...TEST_READY_CONFIG,
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

test('auto apply resumes search from pending submit when response queue was cleared early', async () => {
  const source = await readContentScriptSource();
  const appended = [];
  const states = [];
  const logs = [];
  const navigations = [];
  const localStore = { ...TEST_READY_CONFIG,
    autoApplyQueue: {
      active: false,
      index: 0,
      counters: {
        found: 50,
        processed: 3,
        applied: 2,
        skipped: 0,
        errors: 0
      }
    },
    autoApplyPendingSubmit: {
      runId: 'test-run',
      item: {
        index: 3,
        vacancyId: '134134596',
        title: 'Head of FinTech',
        url: 'https://hh.ru/vacancy/134134596'
      },
      counters: {
        found: 50,
        processed: 3,
        applied: 2,
        skipped: 0,
        errors: 0
      },
      status: 'applied_test_assisted',
      coverLetterUsed: false,
      testDetected: true,
      createdAt: new Date().toISOString(),
      sourceUrl: 'https://hh.ru/applicant/vacancy_response?vacancyId=134134596&startedWithQuestion=false',
      returnToSearchUrl: 'https://hh.ru/search/vacancy?text=java',
      queueLimit: 100,
      queueConfig: {
        delayMinMs: 1,
        delayMaxMs: 1
      },
      queueMaxProcessed: null,
      queueProcessedVacancyIds: ['134319918', '129604875', '134134596']
    }
  };

  globalThis.location = {
    href: 'https://hh.ru/applicant/vacancy_response?vacancyId=134134596&startedWithQuestion=false',
    pathname: '/applicant/vacancy_response'
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
    title: 'HH response confirmation page',
    body: new FakeElement({ text: 'Вы откликнулись\nОтклик отправлен' }),
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

  await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#pending-cleared-queue-${crypto.randomUUID()}`);
  const started = Date.now();
  while (navigations.length === 0 && Date.now() - started < 1000) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  assert.equal(appended.length, 1);
  assert.equal(appended.at(-1).status, 'applied_test_assisted');
  assert.equal(localStore.autoApplyPendingSubmit, null);
  assert.equal(localStore.autoApplySearchQueue.active, true);
  assert.equal(localStore.autoApplySearchQueue.limit, 100);
  assert.deepEqual(localStore.autoApplySearchQueue.processedVacancyIds, ['134319918', '129604875', '134134596']);
  assert.equal(localStore.autoApplySearchQueue.counters.applied, 3);
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
  const localStore = { ...TEST_READY_CONFIG,
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
  const localStore = { ...TEST_READY_CONFIG,
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
      globalThis.document.body.innerText = 'Вы откликнулись';
      globalThis.document.body.textContent = 'Вы откликнулись';
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
    getElementById() {
      return null;
    },
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
  const localStore = { ...TEST_READY_CONFIG,
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
  const localStore = { ...TEST_READY_CONFIG,
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
  assert.equal(localStore.autoApplyStopRequested, true);
  assert.match(localStore.autoApplyStopRequestedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(states.at(-1).state, 'stopped');
  assert.equal(logs.at(-1).event, 'stop_run');
  assert.equal(logs.at(-1).details.url, 'https://hh.ru/search/vacancy?text=java');
});

test('content script enables stop-before-submit from hh url parameter', async () => {
  const source = await readContentScriptSource();
  const logs = [];
  const localStore = { ...TEST_READY_CONFIG,};
  let listener = null;
  const historyUrls = [];

  globalThis.location = {
    href: 'https://hh.ru/?hhjaStopBeforeSubmit=1',
    pathname: '/',
    search: '?hhjaStopBeforeSubmit=1',
    hash: ''
  };
  globalThis.window = {
    history: {
      replaceState(_state, _title, url) {
        historyUrls.push(url);
        globalThis.location.href = `https://hh.ru${url}`;
        const parsed = new URL(globalThis.location.href);
        globalThis.location.pathname = parsed.pathname;
        globalThis.location.search = parsed.search;
        globalThis.location.hash = parsed.hash;
      }
    },
    getComputedStyle() {
      return { visibility: 'visible', display: 'block' };
    }
  };
  globalThis.getComputedStyle = globalThis.window.getComputedStyle;
  globalThis.document = {
    title: 'HH test page',
    body: new FakeElement({ text: 'HH вакансии' }),
    querySelectorAll() {
      return [];
    },
    querySelector() {
      return null;
    },
    addEventListener() {},
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
      sendMessage() {
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
  globalThis.HHJobAssistantLog = {
    async append(scope, event, details = {}) {
      logs.push({ scope, event, details });
    }
  };

  try {
    await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#stop-before-submit-${crypto.randomUUID()}`);
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.ok(listener, 'content script should register a listener');
    assert.equal(localStore.autoApplyStopBeforeSubmit, true);
    assert.equal(logs.at(-1).event, 'url_trigger_stop_before_submit');
    assert.deepEqual(historyUrls, ['/']);
  } finally {
    delete globalThis.location;
    delete globalThis.window;
    delete globalThis.getComputedStyle;
    delete globalThis.document;
    delete globalThis.chrome;
    delete globalThis.HHJobAssistantLog;
  }
});

test('content status reports resumable auto-apply queue', async () => {
  const result = await runContentAutoApply({
    startOnResponseForm: true,
    message: { type: 'GET_CONTENT_STATUS' },
    initialLocalStore: {
      autoApplySearchQueue: { active: true },
      runState: { state: 'idle' }
    }
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.canContinueAutoApply, true);
  assert.equal(result.response.autoApplyInProgress, true);
});

test('continue auto apply reports missing saved queue', async () => {
  const result = await runContentAutoApply({
    message: { type: 'CONTINUE_AUTO_APPLY' }
  });

  assert.equal(result.response.ok, false);
  assert.match(result.response.error, /Нет сохраненного запуска/);
});
