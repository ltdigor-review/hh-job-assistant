(function initHhJobAssistantText(global) {
  function cleanText(value) {
    return (value || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function sanitizeGeneratedText(value) {
    return cleanText(value)
      .replace(/^\s*```[a-zа-я0-9_-]*\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .replace(/(^|\s)([*_]{1,3})(?=\S)/g, '$1')
      .replace(/(?<=\S)([*_]{1,3})(?=\s|$|[.,!?;:])/g, '')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/^\s{0,3}#{1,6}\s+/gm, '')
      .replace(/^\s*[-*]\s+/gm, '')
      .trim();
  }

  function stripAnswerLabel(value) {
    return sanitizeGeneratedText(value)
      .replace(/^(?:text\s+question|question|answer|ответ|вопрос)\s*\d+\s*[:.)-]\s*/i, '')
      .replace(/^(?:open\s+text\s+question|text\s+field|input\s+field|field)\s*\d*\s*[:.)-]\s*/i, '')
      .replace(/^choice\s+group\s*\d+\s*[:.)-]\s*/i, '')
      .trim();
  }

  function getGeneratedTextInvalidReason(value, { minLength = 3 } = {}) {
    const text = cleanText(value);
    if (text.length < minLength) return 'Сгенерированный ответ слишком короткий.';
    if (/(?:^|\n)\s*(?:text\s+question|choice\s+group|question|answer|text\s+field|input\s+field|field)\s*\d+\s*[:.)-]/i.test(text)) {
      return 'Сгенерированный ответ содержит служебные метки промпта вместо готового ответа.';
    }
    if (/(?:^|\n)\s*(?:open\s+text\s+questions?|choice\s+questions?|return exact option labels|question\/context|visible hh response form text)\s*:/i.test(text)) {
      return 'Сгенерированный ответ содержит контекст промпта вместо готового ответа.';
    }
    if (/[*_`#]{2,}|```/.test(text)) {
      return 'Сгенерированный ответ содержит лишнюю markdown-разметку.';
    }
    if (/^\s*[{[]|["']role["']\s*:|["']content["']\s*:/.test(text)) {
      return 'Сгенерированный ответ содержит JSON или служебные данные промпта.';
    }
    if (/^(?:не могу|невозможно|как ии|as an ai|i cannot|cannot answer)/i.test(text)) {
      return 'Сгенерированный ответ похож на отказ модели или пустую отписку.';
    }
    if (/(?:резюме кандидата|текст вакансии|структурированные вопросы|visible hh response form text)/i.test(text)) {
      return 'Сгенерированный ответ копирует контекст промпта вместо ответа.';
    }
    if (/(?:^|\s)(?:task_\d+|question text not found|писать тут)(?:\s|$)/i.test(text)) {
      return 'Сгенерированный ответ копирует служебные данные поля HH вместо ответа.';
    }
    return '';
  }

  function splitLabeledTextAnswers(cleaned, count) {
    const answers = [];
    const labelPattern = /(?:^|\n)\s*(?:[-*]\s*)?(?:\d+[\).:-]\s*)?(?:text\s+question|question|answer|ответ|вопрос|open\s+text\s+question|text\s+field|input\s+field|field)\s*(\d+)\s*[:.)-]\s*/ig;
    const matches = [...cleaned.matchAll(labelPattern)];
    if (matches.length === 0) return [];

    for (let index = 0; index < matches.length; index += 1) {
      const match = matches[index];
      const answerIndex = Math.max(0, Number(match[1]) - 1);
      if (answerIndex >= count) continue;
      const start = match.index + match[0].length;
      const end = index + 1 < matches.length ? matches[index + 1].index : cleaned.length;
      const answer = cleanText(cleaned.slice(start, end).replace(/\n\s*choice\s+group\s+\d+\s*[:.)-][\s\S]*$/i, ''));
      if (answer) {
        answers[answerIndex] = stripAnswerLabel(answer);
      }
    }

    return answers.filter(Boolean).length > 0 ? answers : [];
  }

  function splitGeneratedAnswers(text, count) {
    const cleaned = cleanText(text);
    if (!cleaned) return [''];

    const labeledTextAnswers = splitLabeledTextAnswers(cleaned, count);
    if (labeledTextAnswers.length > 0) {
      return Array.from({ length: count }, (_, index) => labeledTextAnswers[index] || '');
    }

    if (count <= 1) return [stripAnswerLabel(cleaned)];

    const lines = cleaned
      .split(/\n+/)
      .filter((line) => !/^\s*(?:[-*]\s*)?(?:\d+[\).:-]\s*)?choice\s+group\s*\d+\s*[:.)-]/i.test(line))
      .map((line) => stripAnswerLabel(line.replace(/^\s*(?:\d+[\).:-]?|[-*])\s*/, '').trim()))
      .filter(Boolean);

    if (lines.length >= count) {
      return lines.slice(0, count);
    }

    return Array.from({ length: count }, () => stripAnswerLabel(cleaned));
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

  global.HHJobAssistantText = {
    cleanText,
    sanitizeGeneratedText,
    stripAnswerLabel,
    getGeneratedTextInvalidReason,
    splitGeneratedAnswers,
    normalizeChoiceText,
    choiceTokens,
    scoreChoice
  };
})(globalThis);
