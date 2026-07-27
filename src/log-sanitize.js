(function initLogSanitizer(global) {
  const SECRET_KEY_PATTERN = /api[_-]?key|authorization|password|secret|access[_-]?token|refresh[_-]?token|bearer/i;
  const SECRET_QUERY_PATTERN = /([?&](?:api[_-]?key|key|token|access[_-]?token|refresh[_-]?token|secret|password|authorization)=)[^&#\s]+/gi;
  const SECRET_ASSIGNMENT_PATTERN = /\b((?:api[_-]?key|token|access[_-]?token|refresh[_-]?token|secret|password|authorization)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,}]+)/gi;
  const BEARER_VALUE_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
  const URL_KEY_PATTERN = /(?:^|_)(?:url|uri|endpoint)(?:$|_)/i;
  const SENSITIVE_DETAIL_KEYS = new Set([
    'age',
    'answer',
    'answers',
    'assistance',
    'body',
    'candidateFacts',
    'content',
    'coverLetter',
    'coverPrompt',
    'currentAction',
    'employerQuestionPrompt',
    'expectedSalary',
    'extraText',
    'label',
    'lastError',
    'letter',
    'message',
    'messages',
    'option',
    'options',
    'prompt',
    'question',
    'questionContext',
    'questions',
    'requestBody',
    'responseBody',
    'responseText',
    'resumeCandidateFacts',
    'resumeProfileText',
    'resumeText',
    'telegramUsername',
    'text',
    'title',
    'validationText',
    'value',
    'vacancyText'
  ]);
  const SAFE_TEXT_KEYS = new Set([
    'action',
    'attempt',
    'errorCode',
    'event',
    'extensionVersion',
    'fieldType',
    'finishReason',
    'flowVersion',
    'inputType',
    'kind',
    'method',
    'mode',
    'model',
    'name',
    'fileName',
    'role',
    'runId',
    'scope',
    'source',
    'state',
    'status',
    'task',
    'timestamp',
    'type',
    'vacancyId'
  ]);

  function redactSecretString(value) {
    return String(value)
      .replace(BEARER_VALUE_PATTERN, 'Bearer [redacted]')
      .replace(SECRET_QUERY_PATTERN, '$1[redacted]')
      .replace(SECRET_ASSIGNMENT_PATTERN, '$1[redacted]');
  }

  function fingerprint(value) {
    let hash = 0x811c9dc5;
    for (const character of String(value || '')) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function anonymizedText(value) {
    const text = String(value || '');
    return {
      redacted: true,
      length: text.length,
      fingerprint: fingerprint(text)
    };
  }

  function sanitizeUrl(value) {
    try {
      const url = new URL(redactSecretString(value));
      if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        return anonymizedText(value);
      }
      return `${url.protocol}//${url.host}${url.pathname}`;
    } catch {
      return anonymizedText(value);
    }
  }

  function sanitize(value, key = '', depth = 0, parentKey = '') {
    if (depth > 8) return '[max-depth]';
    if (SECRET_KEY_PATTERN.test(key)) return '[redacted]';
    if (
      SENSITIVE_DETAIL_KEYS.has(key) &&
      !(typeof value === 'number' && /lengths?$/i.test(parentKey))
    ) {
      return anonymizedText(value);
    }
    if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      if (URL_KEY_PATTERN.test(key) || /^https?:\/\//i.test(value)) return sanitizeUrl(value);
      const redacted = redactSecretString(value);
      if (key === 'error' || key === 'reason') {
        return /^[A-Za-z0-9_.:-]{1,160}$/.test(redacted)
          ? redacted
          : anonymizedText(redacted);
      }
      if (
        SAFE_TEXT_KEYS.has(key) ||
        /(?:^|_)(?:hash|fingerprint|id|version|timestamp)(?:$|_)/i.test(key) ||
        /(?:Hash|Fingerprint|Id|Version|Timestamp)$/.test(key)
      ) {
        return redacted.slice(0, 500);
      }
      if (/(?:At|Date)$/.test(key) && Number.isFinite(Date.parse(redacted))) {
        return redacted.slice(0, 100);
      }
      return anonymizedText(redacted);
    }
    if (Array.isArray(value)) {
      return value.slice(0, 50).map((item) => sanitize(item, '', depth + 1, key));
    }
    if (typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([entryKey, entryValue]) => [
          entryKey,
          sanitize(entryValue, entryKey, depth + 1, key)
        ])
      );
    }
    return anonymizedText(value);
  }

  global.HHJA_LOG_SANITIZE = Object.freeze({
    anonymizedText,
    fingerprint,
    redactSecretString,
    sanitize,
    sanitizeUrl
  });
})(globalThis);
