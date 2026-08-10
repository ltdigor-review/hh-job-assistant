(function initHhJobAssistantObserver(global) {
  const { cleanText } = global.HHJobAssistantText || {};
  const {
    textOf,
    isVisible,
    queryFirst,
    queryAll,
    findClickableByText,
    isDisabled,
    findEnabledClickableByText
  } = global.HHJobAssistantDom || {};
  const VACANCY_GROQ_MAX_CHARS = 2200;
  const SUBMIT_ACTION_PATTERN = /отправить|откликнуться|продолжить|сгенерировать\s+резюме/i;

  function extractVisibleQuestionLabels(text, { textOnly = false } = {}) {
    const lines = cleanText(text)
      .split('\n')
      .map((line) => cleanText(line))
      .filter(Boolean);
    const labels = [];
    for (const line of lines) {
      if (line.length < 12 || line.length > 500) continue;
      if (/^(?:да|нет|ecom|\/ecom|отправить|откликнуться|писать тут)$/i.test(line)) continue;
      if (/task_\d+/i.test(line)) continue;
      const isTextFieldLabel = /укажите|напишите|опишите|расскажите|зарплат|доход|оклад|gross|телеграм|telegram|мессендж|messenger|ник для связи|контакт/i.test(line);
      if (textOnly && !isTextFieldLabel) continue;
      if (
        /[?]$/.test(line) ||
        /^(?:укажите|расскажите|опишите|напишите|какие|какой|какую|сколько|готовы|есть ли|имеется ли|на какой|почему|были ли|был ли)\b/i.test(line) ||
        /зарплат|доход|оклад|gross|телеграм|telegram|мессендж|messenger|ник для связи|контакт/i.test(line)
      ) {
        if (!labels.includes(line)) labels.push(line);
      }
    }
    return labels;
  }

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
      'textarea',
      '[contenteditable="true"]',
      '[role="textbox"]'
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
    nextPageLinks: [
      'a[data-qa="pager-next"]',
      '[data-qa="pager-next"] a',
      'a[rel="next"]'
    ]
  };

  function getVacancyId(url) {
    return String(url || '').match(/\/vacancy\/(\d+)/)?.[1] || new URL(String(url || location.href), location.href).searchParams.get('vacancyId') || '';
  }

  function getVacancyDedupeKey(item) {
    return cleanText(item?.vacancyId) || getVacancyId(item?.url || '') || getVacancyId(item?.responseUrl || '');
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
      'a[href*="/negotiations"]'
    ]);
    if (authLinks.some((link) => /^https:\/\/([^/]+\.)?hh\.ru\//.test(link.href || ''))) {
      return true;
    }

    const body = textOf(document.body);
    return /мои резюме|отклики|сообщения|профиль|личный кабинет/i.test(body) && !/войти|зарегистрироваться/i.test(body);
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

  function getElementHref(node) {
    return node?.href || node?.getAttribute?.('href') || '';
  }

  function getResponseUrlFromControl(node) {
    const href = getElementHref(node);
    return /\/applicant\/vacancy_response/.test(href) ? href : '';
  }

  function buildResponseUrlFromVacancyId(vacancyId, baseUrl = location.href) {
    const id = cleanText(vacancyId);
    if (!id) return '';
    const origin = new URL(baseUrl || location.href, location.href).origin;
    if (!origin || origin === 'null') return '';
    const url = new URL('/applicant/vacancy_response', origin);
    url.searchParams.set('vacancyId', id);
    url.searchParams.set('hhtmFrom', 'vacancy_search_list');
    return url.href;
  }

  function getCardInfo(card, index) {
    const titleLink = queryFirst(HH_SELECTORS.titleLinks, card) || card.querySelector('a[href*="/vacancy/"]');
    const responseButton =
      queryAll(HH_SELECTORS.responseButtons, card).find((node) => /откликнуться/i.test(textOf(node))) ||
      findClickableByText(card, [/откликнуться/i]) ||
      (/откликнуться/i.test(textOf(card)) ? card : null);
    const responseHref = getResponseUrlFromControl(responseButton) || getResponseUrlFromControl(card);
    const href = getElementHref(titleLink) || getElementHref(card.querySelector?.('a[href*="/vacancy/"]')) || responseHref || location.href;
    const vacancyId = getVacancyId(href) || getVacancyId(responseHref);
    const title = textOf(titleLink) || textOf(card).split('\n').find(Boolean) || document.title;

    return {
      index: index + 1,
      vacancyId,
      title,
      url: /\/applicant\/vacancy_response/.test(href) && vacancyId ? `${location.origin}/vacancy/${vacancyId}` : href,
      responseUrl: responseHref || buildResponseUrlFromVacancyId(vacancyId, href),
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

    function hasResponseControl(node) {
      return Boolean(
        queryAll(HH_SELECTORS.responseButtons, node).find((control) => /откликнуться/i.test(textOf(control))) ||
          (/откликнуться/i.test(textOf(node)) && getResponseUrlFromControl(node))
      );
    }

    function normalizeVacancyCardNode(node) {
      let current = node;
      let fallback = null;
      while (current && current !== document && current !== document.body) {
        const hasLink = hasVacancyLink(current);
        const hasResponse = hasResponseControl(current);
        if (hasLink && hasResponse) {
          return current;
        }
        if (!fallback && (hasLink || hasResponse)) {
          fallback = current;
        }
        current = current.parentElement;
      }
      return fallback;
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
    return compactVacancyText(textOf(node));
  }

  function uniqueContextLines(text) {
    const seen = new Set();
    return cleanText(text)
      .split('\n')
      .map((line) => cleanText(line))
      .filter((line) => {
        if (!line || seen.has(line)) return false;
        seen.add(line);
        return true;
      });
  }

  function joinCappedLines(lines, maxChars) {
    const output = [];
    let length = 0;
    for (const line of lines) {
      const nextLength = length + line.length + (output.length > 0 ? 1 : 0);
      if (nextLength > maxChars) break;
      output.push(line);
      length = nextLength;
    }
    return output.join('\n').slice(0, maxChars);
  }

  function compactVacancyText(text, maxChars = VACANCY_GROQ_MAX_CHARS) {
    const noisePattern = /^(?:откликнуться|показать контакты|в избранное|скрыть|пожаловаться|поделиться|назад|далее|похожие вакансии|вакансии компании|hh\.ru|headhunter)$/i;
    const lines = uniqueContextLines(text)
      .filter((line) => line.length <= 700)
      .filter((line) => !noisePattern.test(line))
      .filter((line) => !/^(?:откликнуться|показать|скрыть)\b/i.test(line));
    return joinCappedLines(lines, maxChars);
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

  function isResponseFormRoot(root) {
    return root !== document || isResponseFormPage();
  }

  function isAlreadyAppliedPage(root = document) {
    return /вы откликнулись|отклик отправлен|отклик успешно|отклик на вакансию отправлен/i.test(
      textOf(root) || textOf(root.body)
    );
  }

  function hasNewResponseSuccessText(beforeText, root = document) {
    const before = cleanText(beforeText);
    const current = cleanText(textOf(root) || textOf(root?.body) || textOf(document.body));
    if (!current || current === before) return false;
    const successPattern = /отклик\s+отправлен|отклик\s+успешно|отклик\s+на\s+вакансию\s+отправлен/i;
    return successPattern.test(current) && !successPattern.test(before);
  }

  function hasActiveResponseControl(root = document, item = null) {
    if (root === item?.card && !item?.responseFormOpen && item?.responseButton && !isDisabled(item.responseButton)) return true;

    const itemVacancyId = getVacancyDedupeKey(item);
    const responseControlSelectors = HH_SELECTORS.responseButtons.filter((selector) => selector !== 'button');
    return queryAll(responseControlSelectors, root).some((node) => {
      if (isDisabled(node)) return false;
      const nodeVacancyId = getVacancyId(node.href || '');
      return !itemVacancyId || !nodeVacancyId || nodeVacancyId === itemVacancyId;
    });
  }

  function isAlreadyAppliedForCurrentItem(root = document, item = null, { ignoreActiveResponseControl = false } = {}) {
    if (!ignoreActiveResponseControl && hasActiveResponseControl(root, item)) return false;
    if (!isAlreadyAppliedPage(root)) return false;
    if (root !== document) return true;
    if (isResponseFormPage()) return true;

    const currentVacancyId = getVacancyId(location.href);
    const itemVacancyId = getVacancyDedupeKey(item);
    return Boolean(currentVacancyId && (!itemVacancyId || currentVacancyId === itemVacancyId));
  }

  function findTextarea(root = getDialogRoot()) {
    const fields = queryAll(HH_SELECTORS.textareas, root);
    return fields.find((field) => /letter|cover|сопровод/i.test(getFieldMarker(field))) || fields[0] || null;
  }

  function getFieldMarker(field) {
    const name = field.getAttribute('name') || '';
    const dataQa = field.getAttribute('data-qa') || '';
    const placeholder = field.getAttribute('placeholder') || '';
    const ariaLabel = field.getAttribute('aria-label') || '';
    const label = typeof field.closest === 'function' ? field.closest('label') : null;
    let nearText = textOf(label || field.parentElement || field);
    const currentValue = cleanText(field.value || (field.isContentEditable ? field.textContent : ''));
    const isNativeTaskTextarea = (
      /^task_\d+_text$/i.test(name) &&
      field.parentElement?.getAttribute?.('data-qa') === 'textarea-native-wrapper'
    );
    if (isNativeTaskTextarea && currentValue && nearText.includes(currentValue)) {
      const labelledBy = field.getAttribute('aria-labelledby') || '';
      nearText = textOf(document.getElementById?.(labelledBy)) || 'Писать тут';
    }
    return `${name}\n${dataQa}\n${placeholder}\n${ariaLabel}\n${nearText}`;
  }

  function getFieldLogTarget(field) {
    if (!field) return {};
    return {
      tagName: String(field.tagName || '').toLowerCase(),
      type: field.getAttribute?.('type') || '',
      name: field.getAttribute?.('name') || '',
      dataQa: field.getAttribute?.('data-qa') || '',
      placeholder: field.getAttribute?.('placeholder') || '',
      ariaLabel: field.getAttribute?.('aria-label') || '',
      marker: getFieldMarker(field)
    };
  }

  function getTaskBody(node) {
    return typeof node?.closest === 'function' ? node.closest('[data-qa="task-body"]') : null;
  }

  function getTaskBodyQuestionText(node) {
    const taskBody = getTaskBody(node);
    if (!taskBody) return '';
    return (
      cleanText(textOf(taskBody))
        .split('\n')
        .map((line) => cleanText(line))
        .find((line) => line && !/^(?:да|нет|свой вариант|писать тут|\d+\s+из\s+\d+)$/i.test(line)) || ''
    );
  }

  function getMeaningfulQuestionText(field) {
    const currentValue = cleanText(field.value || (field.isContentEditable ? field.textContent : ''));
    const technicalMarkers = [
      field.getAttribute('name') || '',
      field.getAttribute('data-qa') || '',
      field.getAttribute('id') || ''
    ].filter(Boolean);
    const candidates = [
      getTaskBodyQuestionText(field),
      field.getAttribute('aria-label') || '',
      field.getAttribute('placeholder') || '',
      textOf(typeof field.closest === 'function' ? field.closest('label') : null),
      textOf(field.parentElement || null),
      textOf(field)
    ];

    const cleaned = candidates
      .map((candidate, index) => {
        let text = cleanText(candidate);
        for (const marker of technicalMarkers) {
          text = cleanText(text.replaceAll(marker, ' '));
        }
        if (index >= 3 && currentValue) {
          text = cleanText(text.replaceAll(currentValue, ' '));
        }
        return text
          .split('\n')
          .map((line) => cleanText(line))
          .filter((line) => line && !/^(?:task_\d+(?:_text)?|писать тут|answer|ответ)$/i.test(line))
          .join('\n');
      })
      .find((candidate) => {
        if (!candidate) return false;
        if (/^(?:task_\d+(?:_text)?|писать тут)$/i.test(candidate)) return false;
        return /[а-яa-z]{3,}/i.test(candidate);
      });

    return cleanText(cleaned || '');
  }

  function getFieldQuestionText(field) {
    return cleanText(getMeaningfulQuestionText(field));
  }

  function findCoverLetterTextarea(root = getDialogRoot()) {
    const fields = [...root.querySelectorAll('textarea,input:not([type="hidden"]),[contenteditable="true"],[role="textbox"]')]
      .filter(isVisible)
      .filter((field) => !/task_|question|answer|вопрос|ответ|писать тут|зарплат|доход/i.test(getFieldMarker(field)));
    const marked = fields.find((field) => /letter|cover|сопровод/i.test(getFieldMarker(field)));
    if (marked) return marked;
    const rootText = getRootText(root);
    if (fields.length === 1 && /сопроводительное\s+письмо|cover\s+letter/i.test(rootText)) {
      return fields[0];
    }
    return null;
  }

  function getQuestionScopes(root = getDialogRoot()) {
    const taskBodies = [...root.querySelectorAll('[data-qa="task-body"]')].filter(isVisible);
    return taskBodies.length > 0 ? taskBodies : [root];
  }

  function findQuestionFields(root = getDialogRoot()) {
    return getQuestionScopes(root)
      .flatMap((scope) => [...scope.querySelectorAll('textarea,input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]),[contenteditable="true"]')])
      .filter(isVisible)
      .filter((field) => {
        const marker = getFieldMarker(field);
        if (/letter|cover|сопровод/i.test(marker)) return false;
        if (field.isContentEditable || String(field.getAttribute?.('contenteditable') || '').toLowerCase() === 'true') return true;
        return /task_|question|answer|вопрос|ответ|писать тут|зарплат|доход/i.test(marker);
      });
  }

  function getControlType(control) {
    return String(control?.type || control?.getAttribute?.('type') || '').toLowerCase();
  }

  function isQuestionLikeChoiceLine(line) {
    const text = cleanText(line);
    if (!text) return false;
    return (
      /[?]$/.test(text) ||
      /^(?:где|какой|какая|какое|какие|сколько|готовы|есть ли|имеется ли|вакансия открыта|на какой|почему|были ли|был ли)\b/i.test(text)
    );
  }

  function isUsableChoiceValue(value) {
    const text = cleanText(value);
    if (!text || text.length > 120) return false;
    if (/^\d+$/.test(text)) return false;
    if (/^(?:on|true|false|short|long|yes|no)$/i.test(text)) return false;
    if (/^task[_-]?\d+/i.test(text)) return false;
    if (isQuestionLikeChoiceLine(text)) return false;
    return /[а-яa-z]/i.test(text);
  }

  function extractOptionMarker(marker) {
    let hasQuestionLikeLine = false;
    const lines = cleanText(marker)
      .split('\n')
      .map((line) => cleanText(line))
      .filter(Boolean)
      .filter((line) => {
        if (!isQuestionLikeChoiceLine(line)) return true;
        hasQuestionLikeLine = true;
        return false;
      })
      .filter((line) => !/^(?:писать тут|ответить|отправить|откликнуться|\d+\s+из\s+\d+)$/i.test(line));
    return {
      text: lines.join('\n'),
      hasQuestionLikeLine
    };
  }

  function getOptionLabel(control) {
    const label = typeof control.closest === 'function' ? control.closest('label') : null;
    const ariaLabel = control.getAttribute?.('aria-label') || '';
    const marker = textOf(label || control.parentElement || control);
    const value = control.value || control.getAttribute?.('value') || '';
    const markerOption = extractOptionMarker(marker);
    const ariaOption = isQuestionLikeChoiceLine(ariaLabel) ? '' : ariaLabel;
    const fallbackValue = !markerOption.text && !markerOption.hasQuestionLikeLine && isUsableChoiceValue(value) ? value : '';
    return cleanText([...new Set([ariaOption, markerOption.text, fallbackValue].map(cleanText).filter(Boolean))].join('\n'));
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

  function getControlQuestionText(control) {
    const taskText = getTaskBodyQuestionText(control);
    if (taskText) return taskText;
    const group = typeof control.closest === 'function' ? control.closest('fieldset,[role="group"],[data-qa*="task"]') : null;
    return cleanText(textOf(group).split('\n').find((line) => /[?]$/.test(cleanText(line))) || '');
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
    const controls = getQuestionScopes(root)
      .flatMap((scope) => [...scope.querySelectorAll('input[type="checkbox"],input[type="radio"]')])
      .filter(isSelectableQuestionControl)
      .map((control, index) => ({
        control,
        type: getControlType(control),
        label: getOptionLabel(control),
        groupKey: getControlGroupKey(control, index)
      }))
      .filter((option) => option.label);

    const byGroup = new Map();
    for (const option of controls) {
      const group = byGroup.get(option.groupKey) || {
        type: option.type,
        key: option.groupKey,
        question: getControlQuestionText(option.control) || cleanText(option.groupKey.replace(/^(checkbox|radio):/, '')),
        options: []
      };
      group.options.push(option);
      byGroup.set(option.groupKey, group);
    }

    return [...byGroup.values()].filter((group) => group.options.length > 0);
  }

  function stableQuestionHash(value) {
    let hash = 0x811c9dc5;
    for (const character of String(value || '')) {
      hash ^= character.codePointAt(0);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function findSubmitButton(root = getDialogRoot()) {
    return (
      queryAll(HH_SELECTORS.submitButtons, root)
        .filter((button) => !isDisabled(button))
        .find((button) => SUBMIT_ACTION_PATTERN.test(textOf(button))) ||
      findEnabledClickableByText(root, [/отправить/i, /откликнуться/i, /продолжить/i, /сгенерировать\s+резюме/i])
    );
  }

  function hasSubmitControl(root = getDialogRoot()) {
    return queryAll(HH_SELECTORS.submitButtons, root).some((button) => SUBMIT_ACTION_PATTERN.test(textOf(button)));
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

  function isHhDailyResponseLimitText(text) {
    return /в\s+течение\s+24\s+час(?:ов|а)?.{0,160}не\s+более\s+200\s+откликов|исчерпали\s+лимит\s+откликов/i.test(cleanText(text));
  }

  function detectHhDailyResponseLimit(root = getDialogRoot()) {
    const notificationSelectors = [
      '[data-qa="vacancy-response-error-notification"][role="status"]',
      '[data-qa="vacancy-response-error-notification"]'
    ];
    const notification = queryFirst(notificationSelectors, document) || (root !== document ? queryFirst(notificationSelectors, root) : null);
    const notificationText = textOf(notification);
    if (isHhDailyResponseLimitText(notificationText)) {
      return cleanText(notificationText);
    }

    const text = textOf(root) || textOf(root?.body) || textOf(document.body);
    return isHhDailyResponseLimitText(text) ? cleanText(text) : '';
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

  function getFieldValue(field) {
    if (!field) return '';
    if (field.isContentEditable || String(field.getAttribute?.('contenteditable') || '').toLowerCase() === 'true') {
      return field.textContent || '';
    }
    return field.value || '';
  }

  function collectResponseValidationText(root = getDialogRoot()) {
    const text = cleanText(textOf(root) || textOf(document.body));
    const lines = text.split('\n').map(cleanText).filter(Boolean);
    const validationLines = lines.filter((line) => (
      /обязатель|заполн|укажите|выберите|некоррект|ошиб|слишком\s+корот|минимум|не\s+менее|проверьте/i.test(line) &&
      !SUBMIT_ACTION_PATTERN.test(line)
    ));
    return [...new Set(validationLines)].slice(0, 4).join(' ');
  }

  function validateFilledQuestionFields(questionFields, answers) {
    const missing = [];
    for (const [index, field] of questionFields.entries()) {
      const expected = cleanText(answers[index] || '');
      const actual = cleanText(getFieldValue(field));
      if (!expected || !actual) {
        missing.push(index + 1);
        continue;
      }
      if (actual !== expected && !actual.includes(expected) && !expected.includes(actual)) {
        missing.push(index + 1);
      }
    }
    return missing;
  }

  function validateSelectedQuestionControls(groups) {
    return groups
      .map((group, index) => ({
        index: index + 1,
        selected: group.options.filter((option) => Boolean(option.control?.checked)).length
      }))
      .filter((group) => group.selected === 0)
      .map((group) => group.index);
  }

  function getUnselectedQuestionControlGroups(groups) {
    return groups
      .map((group, index) => ({ ...group, originalIndex: Number(group.originalIndex ?? index) }))
      .filter((group) => !group.options.some((option) => Boolean(option.control?.checked)));
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

  function getBodyText() {
    return textOf(document.body);
  }

  function getHeadingText() {
    return cleanText(document.querySelector('h1')?.textContent) || document.title || '';
  }

  function findDetailResponseButton(root = document) {
    const structural = queryAll([
      '[data-qa="vacancy-response-link-top"]',
      '[data-qa="vacancy-response-link-bottom"]'
    ], root).find((node) => !isDisabled(node));
    return structural || findEnabledClickableByText(root, [/откликнуться/i]) || findClickableByText(root, [/откликнуться/i]);
  }

  function findCloseButton(root = getDialogRoot()) {
    const ariaClose = [...root.querySelectorAll('button,[role="button"]')]
      .filter(isVisible)
      .find((node) => /закрыть|close/i.test(node.getAttribute?.('aria-label') || ''));
    return queryFirst(HH_SELECTORS.modalClose, root) || ariaClose || findClickableByText(root, [/закрыть|отмена/i]);
  }

  function capturePage({ root = document } = {}) {
    const href = location.href;
    const bodyText = getBodyText();
    const pageKind = isResponseFormPage()
      ? 'response'
      : /\/search\/vacancy/.test(location.pathname)
        ? 'search'
        : /\/vacancy\/\d+/.test(location.pathname)
          ? 'vacancy'
          : /^\/resume\/[^/?#]+/.test(location.pathname)
            ? 'resume'
            : 'other';
    return {
      facts: {
        href,
        kind: pageKind,
        pageKind,
        unsafe: isUnsafePage(),
        authenticated: hasAuthenticatedHhSignal(),
        currentVacancyId: getVacancyId(href),
        responseFormPresent: isResponseFormPage(),
        bodyText,
        rootText: getRootText(root),
        title: document.title || '',
        headingText: getHeadingText()
      },
      refs: {
        document,
        body: document.body,
        detailResponseButton: findDetailResponseButton(root)
      }
    };
  }

  function captureSearch({ root = document, scan = true } = {}) {
    const vacancies = scan ? scanVacancies() : [];
    const nextUrl = getNextSearchPageUrl();
    return {
      facts: {
        vacancyCount: vacancies.length,
        nextUrl,
        vacancyText: getVacancyText(root),
        vacancies: vacancies.map(({ card, responseButton, ...item }) => item)
      },
      refs: {
        vacancies: vacancies.map(({ card, responseButton }) => ({ card, responseButton }))
      }
    };
  }

  function captureResponse({
    root = getDialogRoot(),
    item = null,
    beforeText = '',
    ignoreActiveResponseControl = false
  } = {}) {
    const coverLetter = findCoverLetterTextarea(root);
    const questions = captureQuestionForm(root);
    const submit = findSubmitButton(root);
    return {
      facts: {
        present: isResponseFormRoot(root),
        kind: questions.facts.textQuestions.length > 0 || questions.facts.choiceQuestions.length > 0
          ? 'questions'
          : coverLetter
            ? 'cover-letter'
            : submit
              ? 'ordinary'
              : 'none',
        testDetected: detectTest(root),
        rootText: getRootText(root),
        alreadyAppliedPage: isAlreadyAppliedPage(root),
        alreadyApplied: isAlreadyAppliedForCurrentItem(root, item, { ignoreActiveResponseControl }),
        newSuccess: hasNewResponseSuccessText(beforeText, root),
        blockedReason: detectBlockedResponseReason(root),
        dailyLimitReason: detectHhDailyResponseLimit(root),
        hasSubmit: hasSubmitControl(root),
        validationText: collectResponseValidationText(root)
      },
      refs: {
        root,
        textarea: findTextarea(root),
        coverLetter,
        submit,
        followup: findFollowupConfirmButton(root),
        close: findCloseButton(root),
        textQuestions: questions.refs.textFields,
        choiceQuestions: questions.refs.choiceGroups
      }
    };
  }

  function captureQuestionForm(root = getDialogRoot(), suppliedFields, suppliedGroups) {
    const fields = suppliedFields || findQuestionFields(root);
    const groups = suppliedGroups || findQuestionControlGroups(root);
    const visibleQuestionLabels = extractVisibleQuestionLabels(getRootText(root), { textOnly: true });
    const textQuestions = fields.map((field, index) => {
      const marker = getFieldMarker(field);
      const meaningfulQuestion = getMeaningfulQuestionText(field);
      const question = cleanText(meaningfulQuestion || marker || 'question text not found');
      const contextQuestion = cleanText(meaningfulQuestion || visibleQuestionLabels[index] || marker || 'question text not found');
      const id = `text-${index + 1}-${stableQuestionHash(`${question}\n${marker}`)}`;
      return {
        id,
        legacyIndex: index + 1,
        kind: 'text',
        question,
        contextQuestion,
        inputType: cleanText(field.getAttribute?.('type') || field.type || 'text').toLowerCase(),
        contentEditable: Boolean(field.isContentEditable || String(field.getAttribute?.('contenteditable') || '').toLowerCase() === 'true'),
        required: Boolean(field.required || field.getAttribute?.('aria-required') === 'true'),
        marker: getFieldMarker(field),
        logTarget: getFieldLogTarget(field)
      };
    });
    const choiceQuestions = groups.map((group, index) => {
      const question = cleanText(group.question || group.key || 'question text not found');
      const labels = group.options.map((option) => cleanText(option.label)).filter(Boolean);
      const id = `choice-${index + 1}-${stableQuestionHash(`${question}\n${group.type}\n${labels.join('\n')}`)}`;
      return {
        id,
        legacyIndex: index + 1,
        kind: 'choice',
        inputType: group.type,
        question,
        options: labels
      };
    });
    return {
      facts: {
        textQuestions,
        choiceQuestions,
        signature: [
          ...textQuestions.map((item) => `${item.id}:${item.inputType}:${item.required ? 'required' : 'optional'}`),
          ...choiceQuestions.map((item) => `${item.id}:${item.inputType}`)
        ].join('|')
      },
      refs: {
        root,
        textFields: fields,
        choiceGroups: groups
      }
    };
  }

  function capturePagination() {
    const nextUrl = getNextSearchPageUrl();
    return { facts: { nextUrl }, refs: {} };
  }

  function readControlState(ref) {
    return {
      value: getFieldValue(ref),
      checked: Boolean(ref?.checked),
      disabled: isDisabled(ref),
      connected: Boolean(ref) && ref.isConnected !== false,
      href: getElementHref(ref),
      name: ref?.getAttribute?.('name') || ref?.name || '',
      type: ref?.getAttribute?.('type') || ref?.type || '',
      inputMode: ref?.getAttribute?.('inputmode') || ref?.inputMode || '',
      marker: ref ? getFieldMarker(ref) : '',
      question: ref ? getFieldQuestionText(ref) : '',
      logTarget: getFieldLogTarget(ref)
    };
  }

  global.HHJobAssistantHhObserver = Object.freeze({
    schemaVersion: 1,
    capturePage,
    captureSearch,
    captureResponse,
    captureQuestionForm,
    capturePagination,
    readControlState
  });
})(globalThis);
