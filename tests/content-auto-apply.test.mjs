import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { FakeElement } from './helpers/fake-element.mjs';

const root = new URL('../', import.meta.url);

async function runContentAutoApply({
  dialogText,
  hasTextarea,
  startOnResponseForm = false,
  hasQuestionField = false,
  hasCoverLetterField = false,
  bodyText = 'HH вакансии',
  responseHref = '',
  expectedSalary = '',
  followupDialogText = '',
  followupConfirmText = 'Все равно откликнуться',
  disabledSubmit = false,
  keepDialogOpenAfterSubmit = false,
  postSubmitDialogText = '',
  hideDialogReadsAfterSubmit = 0,
  nextPageUrl = '',
  dailyLimit = 1,
  questionControls = [],
  groqResponse = { ok: false, error: 'Groq API key is not configured' }
}) {
  const source = await readFile(new URL('src/content-hh.js', root), 'utf8');
  const appended = [];
  const states = [];
  let submitClicks = 0;
  let followupClicks = 0;
  let navigateUrl = '';
  let listener = null;
  let dialog = null;
  let hiddenDialogReads = 0;
  const localStore = {};

  const textarea = new FakeElement({
    text: hasQuestionField ? 'Писать тут' : '',
    attrs: hasQuestionField ? { name: 'task_235076159_text' } : {}
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
  const responseButton = new FakeElement({
    text: 'Откликнуться',
    href: responseHref,
    click() {
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
    __HH_JOB_ASSISTANT_TEST_FAST_CLICKS__: true,
    __HH_JOB_ASSISTANT_TEST_NAVIGATE__(url) {
      navigateUrl = url;
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
    title: 'HH test page',
    body: new FakeElement({ text: bodyText }),
    querySelectorAll(selector) {
      if (selector.includes(',')) {
        return selector.split(',').flatMap((part) => this.querySelectorAll(part.trim()));
      }
      if (selector === '[data-qa="vacancy-serp__vacancy"]') return startOnResponseForm ? [] : [card];
      if (selector === '[data-qa="serp-item"]') return [];
      if (selector === '[data-qa*="vacancy-serp"]') return startOnResponseForm ? [] : [card];
      if (selector === 'a[data-qa="pager-next"]') return nextLink ? [nextLink] : [];
      if (selector === '[data-qa="pager-next"] a') return [];
      if (selector === 'a[rel="next"]') return [];
      if (selector === 'a[href*="page="]') return nextLink ? [nextLink] : [];
      if (startOnResponseForm && selector === '[data-qa="vacancy-response-submit-popup"]') return [submitButton];
      if (startOnResponseForm && selector === '[data-qa="vacancy-response-letter-submit"]') return [submitButton];
      if (startOnResponseForm && selector === '[data-qa*="submit"]') return [submitButton];
      if (startOnResponseForm && selector === 'textarea') {
        return [hasQuestionField || hasTextarea ? textarea : null, hasCoverLetterField ? coverTextarea : null].filter(Boolean);
      }
      if (startOnResponseForm && selector === 'input[type="checkbox"]') {
        return selectableControls.filter((item) => item.type === 'checkbox').map((item) => item.input);
      }
      if (startOnResponseForm && selector === 'input[type="radio"]') {
        return selectableControls.filter((item) => item.type === 'radio').map((item) => item.input);
      }
      if (startOnResponseForm && selector === 'button') return [submitButton];
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
      onMessage: {
        addListener(fn) {
          listener = fn;
        }
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
        if (message.type === 'GENERATE_COVER_LETTER') {
          return Promise.resolve(groqResponse);
        }
        return Promise.resolve({ ok: true });
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

  const response = await new Promise((resolve) => {
    const stayedAsync = listener({ type: 'START_AUTO_APPLY' }, {}, resolve);
    assert.equal(stayedAsync, true);
  });

  return {
    response,
    appended,
    states,
    submitClicks,
    followupClicks,
    textareaValue: textarea.value,
    coverTextareaValue: coverTextarea.value,
    checkedLabels: selectableControls.filter((item) => item.input.checked).map((item) => item.label),
    localStore,
    navigateUrl,
    bodyCursor: globalThis.document.body.style.cursor || '',
    dialogOpen: Boolean(dialog)
  };
}

async function runQueuedResponsePages({ count = 20, expectedSalary = '250 000 руб. на руки' } = {}) {
  const source = await readFile(new URL('src/content-hh.js', root), 'utf8');
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
        onMessage: {
          addListener() {}
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
          if (message.type === 'GENERATE_COVER_LETTER') {
            return Promise.resolve({ ok: false, error: 'Groq API key is not configured' });
          }
          return Promise.resolve({ ok: true });
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

test('auto apply skips test vacancy when Groq key is missing', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Тест\nОтветьте на вопросы работодателя',
    hasTextarea: false
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 0);
  assert.equal(result.response.skipped, 1);
  assert.equal(result.appended.at(-1).status, 'skipped_test_missing_groq_key');
  assert.equal(result.appended.at(-1).testDetected, true);
  assert.match(result.appended.at(-1).error, /Groq API key is missing/);
});

test('auto apply submits test vacancy after Groq assistance', async () => {
  const result = await runContentAutoApply({
    dialogText: 'Тест\nОтветьте на вопросы работодателя\nОтправить',
    hasTextarea: false,
    groqResponse: { ok: true, text: 'Краткая подсказка по тесту' }
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.applied, 1);
  assert.equal(result.response.skipped, 0);
  assert.equal(result.submitClicks, 1);
  assert.equal(result.appended.at(-1).status, 'applied_test_assisted');
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
  assert.ok(result.states.some((state) => state.currentAction === 'LLM: generating answers for HH employer questions'));
  assert.ok(result.states.some((state) => state.currentAction === 'Filling HH employer question fields'));
  assert.equal(result.bodyCursor, '');
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
  assert.ok(result.states.some((state) => state.currentAction === 'Filling HH employer choice fields'));
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

test('auto apply clicks hh response button before using response link recovery queue', async () => {
  const responseHref = 'https://hh.ru/applicant/vacancy_response?vacancyId=123&hhtmFrom=vacancy_search_list';
  const result = await runContentAutoApply({
    dialogText: 'Откликнуться',
    hasTextarea: false,
    responseHref
  });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.queued, undefined);
  assert.equal(result.response.navigated, undefined);
  assert.equal(result.submitClicks, 1);
  assert.equal(result.navigateUrl, '');
  assert.equal(result.localStore.autoApplyQueue.active, false);
  assert.equal(result.appended.at(-1).status, 'applied');
  assert.ok(result.states.some((state) => /Открываю форму отклика: Java Developer/.test(state.currentAction || '')));
  assert.ok(!result.states.some((state) => /Открываю страницу вопросов HH/.test(state.currentAction || '')));
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
  const source = await readFile(new URL('src/content-hh.js', root), 'utf8');
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
