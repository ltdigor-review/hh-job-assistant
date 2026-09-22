import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

const root = new URL('../', import.meta.url);

function hashText(value) {
  let hash = 0x811c9dc5;
  for (const character of String(value || '')) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function candidateFacts(text) {
  return {
    age: 30,
    extractedAt: '2026-07-27T00:00:00.000Z',
    source: 'test',
    resumeHash: hashText(text)
  };
}

function jsonResponse(status, data, headers = {}) {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)])
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return normalizedHeaders[String(name).toLowerCase()] || '';
      }
    },
    async text() {
      return JSON.stringify(data);
    }
  };
}

async function loadBackground(localData, fetchImpl) {
  let listener = null;
  globalThis.fetch = fetchImpl;
  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) {
          if (Array.isArray(keys)) {
            return Object.fromEntries(keys.map((key) => [key, localData[key]]));
          }
          return {};
        },
        async set(value) {
          Object.assign(localData, value);
        },
        async remove(keys) {
          for (const key of keys) delete localData[key];
        }
      }
    },
    runtime: {
      getURL(path) {
        return `chrome-extension://test/${path}`;
      },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: {
        addListener(callback) {
          listener = callback;
        }
      }
    },
    tabs: {},
    scripting: {}
  };
  await import(`${pathToFileURL(new URL('src/background.js', root).pathname).href}?provider-test=${crypto.randomUUID()}`);
  assert.equal(typeof listener, 'function');
  return {
    async send(message) {
      return new Promise((resolve) => {
        assert.equal(listener(message, {}, resolve), true);
      });
    },
    async startLog(runId) {
      await globalThis.HHJobAssistantLog.reset('test', 'auto_apply_started', { runId });
    }
  };
}

function debugEntries(localData) {
  const runId = localData.agentDebugActiveRunId;
  return runId ? localData[`agentDebugRun:${runId}`]?.entries || [] : [];
}

test('[BS:COVERS:HHJA-BR-000042] [BS:RETIRES:HHJA-BR-000006:BY:HHJA-BR-000042] provider registry uses currently available stable Qwen and Groq cover models', async () => {
  delete globalThis.HHJA_AI_PROVIDERS;
  await import(`${pathToFileURL(new URL('src/ai-providers.js', root).pathname).href}?registry-test=${crypto.randomUUID()}`);

  const registry = globalThis.HHJA_AI_PROVIDERS;
  assert.ok(registry);
  assert.deepEqual(
    Object.values(registry.PROVIDERS.qwen.tasks).map((task) => task.model),
    ['qwen3.8-max', 'qwen3.8-max', 'qwen3.8-max', 'qwen3.8-max']
  );
  assert.equal(registry.PROVIDERS.groq.tasks.cover_letter.model, 'openai/gpt-oss-20b');
  assert.deepEqual(
    registry.PROVIDERS.groq.tasks.cover_letter.requestExtras,
    { reasoning_effort: 'low' }
  );
  assert.deepEqual(registry.PROVIDERS.groq.tasks.cover_letter.maxTokens, [2048]);
});

test('Qwen routes structured AI requests with thinking and json_object mode', async () => {
  const resumeText = 'Java Tech Lead with confirmed Spring Boot delivery experience.';
  const requests = [];
  const localData = {
    aiProvider: 'qwen',
    aiProviderCredentials: { qwen: { apiKey: 'sk-qwen-test' } },
    aiFallbackToGroq: false,
    resumeText,
    resumeCandidateFacts: candidateFacts(resumeText),
    resumeProfileText: 'Java Tech Lead with confirmed Spring Boot delivery experience and team leadership.',
    coverPrompt: 'cover prompt',
    employerQuestionPrompt: 'answer prompt',
    agentDebugLogsEnabled: true
  };
  const background = await loadBackground(localData, async (url, options) => {
    requests.push({ url, options, body: JSON.parse(options.body) });
    return jsonResponse(200, {
      model: 'qwen3.8-max',
      usage: {
        prompt_tokens: 120,
        completion_tokens: 30,
        total_tokens: 150,
        completion_tokens_details: { reasoning_tokens: 12 }
      },
      choices: [{
        finish_reason: 'stop',
        message: {
          content: JSON.stringify({
            answers: [{ id: 'q1', answer: '5 лет', selectedOptions: [] }],
            coverLetter: ''
          })
        }
      }]
    });
  });
  await background.startLog('qwen-routing');

  const response = await background.send({
    type: 'GENERATE_COVER_LETTER',
    task: 'test_assist',
    vacancyText: 'Java vacancy',
    questions: [{ id: 'q1', kind: 'text', inputType: 'text', question: 'Сколько лет опыта?', options: [] }]
  });

  assert.equal(response.ok, true);
  assert.equal(response.provider, 'qwen');
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].url,
    'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions'
  );
  assert.equal(requests[0].body.model, 'qwen3.8-max');
  assert.equal(requests[0].body.enable_thinking, true);
  assert.deepEqual(requests[0].body.response_format, { type: 'json_object' });
  assert.equal(requests[0].body.max_tokens, 8192);
  assert.equal(requests[0].options.headers.Authorization, 'Bearer sk-qwen-test');
  assert.equal(localData.aiQuotaUsage.providers.qwen.models['qwen3.8-max'].requests, 1);
  assert.equal(localData.aiQuotaUsage.providers.qwen.models['qwen3.8-max'].totalTokens, 150);
  assert.equal(localData.aiQuotaUsage.providers.qwen.models['qwen3.8-max'].reasoningTokens, 12);
  assert.equal(localData.aiQuotaUsage.models['qwen3.8-max'], undefined);
  assert.doesNotMatch(JSON.stringify(debugEntries(localData)), /sk-qwen-test/);
});

test('[BS:COVERS:HHJA-BR-000048] [BS:RETIRES:HHJA-BR-000041:BY:HHJA-BR-000048] Ollama runs all AI task formats locally without credentials or cloud fallback', async () => {
  const requests = [];
  const localData = {
    aiProvider: 'ollama', ollamaModel: 'qwen3:8b', aiFallbackProvider: 'groq', aiFallbackEnabled: true,
    aiProviderCredentials: { groq: { apiKey: 'gsk-never-send' } }, resumeText: 'Java developer, 3 years Spring Boot and SQL.',
    resumeProfileText: 'Java developer, 3 years Spring Boot and SQL.', resumeCandidateFacts: candidateFacts('Java developer, 3 years Spring Boot and SQL.'),
    coverPrompt: 'Return a short Russian cover letter.', employerQuestionPrompt: 'Use only confirmed facts.'
  };
  const bg = await loadBackground(localData, async (url, options = {}) => {
    requests.push({ url, options, body: options.body ? JSON.parse(options.body) : null });
    if (url.endsWith('/api/tags')) return jsonResponse(200, { models: [{ name: 'qwen3:8b' }, { name: 'qwen3:4b' }, { name: 'remote:cloud', remote_model: 'cloud' }] });
    const body = JSON.parse(options.body);
    const content = body.format?.properties?.answers
      ? JSON.stringify({ answers: [{ id: JSON.stringify(body.messages).includes('experience') ? 'experience' : 'q1', answer: '3 года', selectedOptions: [] }], coverLetter: '' })
      : body.format?.properties?.profile
        ? JSON.stringify({ profile: 'Java developer with 3 years of Spring Boot and SQL experience.', weaknesses: [] })
        : 'Работал с Java и Spring Boot. Откликаюсь.';
    return jsonResponse(200, { model: 'qwen3:8b', done: true, done_reason: 'stop', prompt_eval_count: 12, eval_count: 8, message: { role: 'assistant', content } });
  });
  const probe = await bg.send({ type: 'TEST_AI_PROVIDER', providerId: 'ollama', ollamaModel: 'qwen3:4b' });
  assert.equal(probe.ok, true);
  const question = await bg.send({ type: 'GENERATE_COVER_LETTER', task: 'test_assist', vacancyText: 'Java', questions: [{ id: 'q1', kind: 'text', inputType: 'text', question: 'Опыт?', options: [] }] });
  assert.equal(question.ok, true);
  const cover = await bg.send({ type: 'GENERATE_COVER_LETTER', task: 'cover_letter', vacancyText: 'Java' });
  assert.equal(cover.ok, true);
  const edit = await bg.send({ type: 'EDIT_RESUME_PROFILE', comment: 'Keep Java and Spring Boot facts.' });
  assert.equal(edit.ok, true);
  const chats = requests.filter((request) => request.url.endsWith('/api/chat'));
  assert.ok(chats.length >= 5);
  assert.ok(chats.some((request) => request.body.model === 'qwen3:4b'));
  assert.equal(localData.ollamaModel, 'qwen3:8b');
  assert.ok(chats.every((request) => request.url === 'http://127.0.0.1:11434/api/chat'));
  assert.ok(chats.every((request) => request.body.stream === false && request.body.think === false && !('response_format' in request.body)));
  assert.ok(chats.every((request) => Number.isFinite(request.body.options?.temperature) && Number.isInteger(request.body.options?.num_predict)));
  assert.ok(chats.some((request) => request.body.format?.properties?.answers));
  assert.ok(chats.some((request) => request.body.format?.properties?.profile));
  assert.ok(chats.every((request) => !request.options.headers.Authorization));
  assert.ok(requests.filter((request) => request.url.endsWith('/api/tags')).every((request) => request.url === 'http://127.0.0.1:11434/api/tags'));
  assert.ok(localData.aiQuotaUsage.providers.ollama.models['qwen3:8b'].totalTokens >= 20);
  assert.equal(localData.aiFallbackProvider, '');
  assert.ok(requests.every((request) => request.url.startsWith('http://127.0.0.1:11434/')));
});

test('Ollama unavailable, missing model, invalid response, and timeout never invoke a cloud provider', async () => {
  const base = { aiProvider: 'ollama', ollamaModel: 'qwen3:8b', aiFallbackProvider: 'groq', aiProviderCredentials: { groq: { apiKey: 'gsk-never-send' } }, resumeText: 'Java developer.', resumeProfileText: 'Java developer.' };
  for (const scenario of ['unavailable', 'missing', 'broken', 'null_body', 'timeout']) {
    const urls = [];
    const bg = await loadBackground({ ...base }, async (url, options = {}) => {
      urls.push(url);
      if (scenario === 'unavailable') throw new Error('failed to fetch');
      if (url.endsWith('/api/tags')) return scenario === 'missing' ? jsonResponse(200, { models: [] }) : jsonResponse(200, { models: [{ name: 'qwen3:8b' }] });
      if (scenario === 'broken') return jsonResponse(200, { done: true, message: { content: '' } });
      if (scenario === 'null_body') return jsonResponse(200, null);
      return new Promise(() => {});
    });
    const result = await bg.send({ type: 'GENERATE_COVER_LETTER', task: 'cover_letter', deadlineAt: scenario === 'timeout' ? Date.now() + 5 : undefined });
    assert.equal(result.ok, false, scenario);
    if (scenario === 'broken' || scenario === 'null_body') assert.equal(result.errorCode, 'HHJA_AI_PROVIDER_INVALID_OUTPUT');
    assert.ok(urls.every((url) => url.startsWith('http://127.0.0.1:11434/')), scenario);
  }
});

test('Ollama classifies an empty access-denied tags response and rejects remote metadata', async () => {
  const config = { aiProvider: 'ollama', ollamaModel: 'qwen3:8b', resumeText: 'Java developer.', resumeProfileText: 'Java developer.' };
  const denied = await loadBackground(config, async () => ({ ...jsonResponse(403, {}), async text() { return ''; } }));
  const deniedResult = await denied.send({ type: 'LIST_OLLAMA_MODELS' });
  assert.equal(deniedResult.ok, false);
  assert.equal(deniedResult.errorCode, 'HHJA_OLLAMA_HTTP');
  const urls = [];
  const remote = await loadBackground(config, async (url) => { urls.push(url); return jsonResponse(200, { models: [{ name: 'qwen3:8b', remote_model: 'cloud.example' }] }); });
  const remoteResult = await remote.send({ type: 'GENERATE_COVER_LETTER', task: 'cover_letter' });
  assert.equal(remoteResult.errorCode, 'HHJA_OLLAMA_MODEL_MISSING');
  assert.deepEqual(urls, ['http://127.0.0.1:11434/api/tags']);
});

test('[BS:COVERS:HHJA-BR-000008] selected fallback provider retries one eligible Qwen failure through Groq', async () => {
  const requests = [];
  const localData = {
    aiProvider: 'qwen',
    aiProviderCredentials: {
      qwen: { apiKey: 'sk-qwen-test' },
      groq: { apiKey: 'gsk-groq-test' }
    },
    groqApiKey: 'gsk-groq-test',
    aiFallbackProvider: 'groq',
    resumeText: 'Java developer with Spring Boot experience.',
    coverPrompt: 'cover prompt',
    agentDebugLogsEnabled: true
  };
  const background = await loadBackground(localData, async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    if (requests.length === 1) {
      return jsonResponse(429, { error: { message: 'rate limited' } }, { 'retry-after': '1' });
    }
    return jsonResponse(200, {
      choices: [{
        finish_reason: 'stop',
        message: { content: 'Работал со Spring Boot и API. Откликаюсь.' }
      }]
    });
  });
  await background.startLog('qwen-fallback');

  const response = await background.send({
    type: 'GENERATE_COVER_LETTER',
    task: 'cover_letter',
    vacancyText: 'Java vacancy'
  });

  assert.equal(response.ok, true);
  assert.equal(response.provider, 'groq');
  assert.equal(response.fallbackReason, 'HHJA_AI_PROVIDER_HTTP');
  assert.deepEqual(requests.map((item) => item.url), [
    'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions',
    'https://api.groq.com/openai/v1/chat/completions'
  ]);
  assert.ok(Date.parse(localData.aiProviderCooldowns.qwen) > Date.now());
  const logs = debugEntries(localData);
  assert.equal(logs.filter((entry) => entry.event === 'ai_provider_fallback_start').length, 1);
  assert.equal(logs.filter((entry) => entry.event === 'ai_provider_fallback_complete').length, 1);
  assert.doesNotMatch(JSON.stringify(logs), /sk-qwen-test|gsk-groq-test/);
  assert.ok(
    globalThis.HHJA_AI_PROVIDERS.getRequestChainTimeoutMs(['qwen', 'groq']) >
      globalThis.HHJA_AI_PROVIDERS.getProvider('qwen').timeoutMs +
      globalThis.HHJA_AI_PROVIDERS.getProvider('groq').timeoutMs
  );
});

test('selected fallback provider retries one eligible Groq failure through Qwen', async () => {
  const requests = [];
  const localData = {
    aiProvider: 'groq',
    aiFallbackProvider: 'qwen',
    aiProviderCredentials: {
      qwen: { apiKey: 'sk-qwen-test' },
      groq: { apiKey: 'gsk-groq-test' }
    },
    resumeText: 'Java developer with Spring Boot experience.',
    coverPrompt: 'cover prompt',
    agentDebugLogsEnabled: true
  };
  const background = await loadBackground(localData, async (url) => {
    requests.push(url);
    if (requests.length === 1) {
      return jsonResponse(429, { error: { message: 'quota exhausted' } }, { 'retry-after': '1' });
    }
    return jsonResponse(200, {
      choices: [{
        finish_reason: 'stop',
        message: { content: 'Работал со Spring Boot и API. Откликаюсь.' }
      }]
    });
  });
  await background.startLog('groq-fallback');

  const response = await background.send({
    type: 'GENERATE_COVER_LETTER',
    task: 'cover_letter',
    vacancyText: 'Java vacancy'
  });

  assert.equal(response.ok, true);
  assert.equal(response.provider, 'qwen');
  assert.equal(response.fallbackReason, 'HHJA_AI_PROVIDER_HTTP');
  assert.deepEqual(requests, [
    'https://api.groq.com/openai/v1/chat/completions',
    'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions'
  ]);
});

test('fallback provider migration prefers authoritative generic storage', async () => {
  await loadBackground({
    aiProvider: 'qwen',
    aiProviderCredentials: {}
  }, async () => jsonResponse(200, {}));
  const providers = globalThis.HHJA_AI_PROVIDERS;

  assert.equal(providers.normalizeFallbackProvider({
    aiFallbackProvider: '',
    aiFallbackEnabled: true,
    aiFallbackToGroq: true
  }, 'qwen'), '');
  assert.equal(providers.normalizeFallbackProvider({
    aiFallbackEnabled: true
  }, 'qwen'), 'groq');
  assert.equal(providers.normalizeFallbackProvider({
    aiFallbackToGroq: true
  }, 'qwen'), 'groq');
  assert.equal(providers.normalizeFallbackProvider({
    aiFallbackProvider: undefined,
    aiFallbackEnabled: undefined,
    aiFallbackToGroq: true
  }, 'qwen'), 'groq');
  assert.equal(providers.normalizeFallbackProvider({
    aiFallbackProvider: 'qwen',
    aiFallbackEnabled: true
  }, 'groq'), 'qwen');
});

test('[BS:COVERS:HHJA-BR-000007] explicit empty provider test key does not reuse the stored credential', async () => {
  const requests = [];
  const localData = {
    aiProvider: 'qwen',
    aiProviderCredentials: { qwen: { apiKey: 'sk-qwen-stored' } },
    aiFallbackProvider: '',
    resumeText: 'Java developer with Spring Boot experience.',
    coverPrompt: 'cover prompt'
  };
  const background = await loadBackground(localData, async (url) => {
    requests.push(url);
    return jsonResponse(200, {});
  });

  const result = await background.send({
    type: 'TEST_AI_PROVIDER',
    providerId: 'qwen',
    apiKey: ''
  });

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'HHJA_AI_PROVIDER_NOT_CONFIGURED');
  assert.equal(requests.length, 0);
});

test('[BS:COVERS:HHJA-BR-000010] explicit no-AI mode blocks every background AI command before network access', async () => {
  const requests = [];
  const localData = {
    aiEnabled: false,
    aiProvider: 'qwen',
    aiProviderCredentials: {
      qwen: { apiKey: 'sk-qwen-saved' },
      groq: { apiKey: 'gsk-groq-saved' }
    },
    groqApiKey: 'gsk-groq-saved',
    resumeText: 'Java developer',
    resumeProfileText: 'Saved candidate profile',
    fallbackCoverLetterTemplate: 'Saved local template'
  };
  const background = await loadBackground(localData, async (...args) => {
    requests.push(args);
    return jsonResponse(200, {});
  });

  for (const message of [
    { type: 'GENERATE_COVER_LETTER', task: 'cover_letter', vacancyText: 'Java vacancy' },
    { type: 'TEST_AI_PROVIDER', providerId: 'qwen' },
    { type: 'BUILD_RESUME_PROFILE' },
    { type: 'ENSURE_RESUME_PROFILE' },
    { type: 'EDIT_RESUME_PROFILE', comment: 'Shorten it' }
  ]) {
    const result = await background.send(message);
    assert.equal(result.ok, false, message.type);
    assert.equal(result.errorCode, 'HHJA_AI_DISABLED', message.type);
  }

  assert.equal(requests.length, 0);
  assert.equal(localData.aiEnabled, false);
  assert.equal(localData.aiProviderCredentials.qwen.apiKey, 'sk-qwen-saved');
  assert.equal(localData.aiProviderCredentials.groq.apiKey, 'gsk-groq-saved');
  assert.equal(localData.aiProvider, 'qwen');
});

test('fallback stays off for unchecked, missing-key, and resume-validation failures', async () => {
  const uncheckedRequests = [];
  const uncheckedData = {
    aiProvider: 'qwen',
    aiProviderCredentials: {
      qwen: { apiKey: 'sk-qwen-test' },
      groq: { apiKey: 'gsk-groq-test' }
    },
    groqApiKey: 'gsk-groq-test',
    aiFallbackProvider: '',
    resumeText: 'Java developer with Spring Boot experience.',
    coverPrompt: 'cover prompt'
  };
  const unchecked = await loadBackground(uncheckedData, async (url) => {
    uncheckedRequests.push(url);
    return jsonResponse(500, { error: 'provider down' });
  });
  const failed = await unchecked.send({
    type: 'GENERATE_COVER_LETTER',
    task: 'cover_letter',
    vacancyText: 'Java vacancy'
  });
  assert.equal(failed.ok, false);
  assert.equal(uncheckedRequests.length, 1);

  const missingRequests = [];
  const missing = await loadBackground({
    aiProvider: 'qwen',
    aiProviderCredentials: { groq: { apiKey: 'gsk-groq-test' } },
    groqApiKey: 'gsk-groq-test',
    aiFallbackProvider: 'groq',
    resumeText: 'Java developer'
  }, async (url) => {
    missingRequests.push(url);
    return jsonResponse(200, {});
  });
  const missingResult = await missing.send({
    type: 'GENERATE_COVER_LETTER',
    task: 'cover_letter'
  });
  assert.equal(missingResult.ok, false);
  assert.equal(missingResult.errorCode, 'HHJA_AI_PROVIDER_NOT_CONFIGURED');
  assert.equal(missingRequests.length, 0);

  const noAgeRequests = [];
  const noAge = await loadBackground({
    aiProvider: 'qwen',
    aiProviderCredentials: {
      qwen: { apiKey: 'sk-qwen-test' },
      groq: { apiKey: 'gsk-groq-test' }
    },
    groqApiKey: 'gsk-groq-test',
    aiFallbackProvider: 'groq',
    resumeText: 'Java developer',
    resumeProfileText: 'Java developer with confirmed backend experience.'
  }, async (url, options) => {
    noAgeRequests.push({ url, body: JSON.parse(options.body) });
    return jsonResponse(200, {
      model: 'qwen3.8-max',
      choices: [{
        finish_reason: 'stop',
        message: {
          content: JSON.stringify({
            answers: [{ id: 'q1', answer: 'Разрабатывал backend-сервисы на Java.', selectedOptions: [] }],
            coverLetter: ''
          })
        }
      }]
    });
  });
  const noAgeResult = await noAge.send({
    type: 'GENERATE_COVER_LETTER',
    task: 'test_assist',
    questions: [{ id: 'q1', kind: 'text', inputType: 'text', question: 'Опишите опыт Java?', options: [] }]
  });
  assert.equal(noAgeResult.ok, true);
  assert.equal(noAgeResult.provider, 'qwen');
  assert.equal(noAgeRequests.length, 1);
});

test('provider 429 is reported as quota or rate limiting, never an invalid key', async () => {
  const background = await loadBackground({
    aiProvider: 'qwen',
    aiProviderCredentials: { qwen: { apiKey: 'sk-qwen-test' } },
    resumeText: 'Java developer',
    coverPrompt: 'cover prompt'
  }, async () => jsonResponse(429, { error: { message: 'quota exhausted' } }));

  const result = await background.send({
    type: 'TEST_AI_PROVIDER',
    providerId: 'qwen'
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /429|квот|лимит/i);
  assert.doesNotMatch(result.error, /неверн(?:ый|ого)\s+ключ/i);
});

test('Qwen unpurchased response is actionable and never exposes raw provider JSON', async () => {
  const background = await loadBackground({
    aiProvider: 'qwen',
    aiProviderCredentials: { qwen: { apiKey: 'sk-sp-qwen-test' } },
    resumeText: 'Java developer',
    coverPrompt: 'cover prompt'
  }, async () => jsonResponse(403, {
    code: 'AccessDenied.Unpurchased',
    message: 'Access to model denied. Please make sure you are eligible for using the model.',
    request_id: 'mock-provider-request-secret'
  }));

  const result = await background.send({
    type: 'TEST_AI_PROVIDER',
    providerId: 'qwen'
  });

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'HHJA_AI_PROVIDER_HTTP');
  assert.match(result.error, /Model Studio.*не активирован|активируйте.*Model Studio/i);
  assert.match(result.error, /Groq/i);
  assert.doesNotMatch(result.error, /AccessDenied|Unpurchased|request_id|mock-provider|Access to model denied|Please make sure you are eligible|\{/i);
});

test('Groq preserves all nine questionnaire answers with a bounded reasoning budget', async () => {
  const questions = Array.from({ length: 8 }, (_, index) => ({
    id: `choice-${index}`,
    kind: 'choice',
    inputType: 'checkbox',
    question: `Подтверждённые технологии ${index}?`,
    options: ['Java', 'Kafka', 'Свой вариант']
  }));
  questions.push({ id: 'salary', kind: 'text', inputType: 'textarea', question: 'Ожидания по зарплате?', options: [] });
  const expected = questions.map((question) => ({
    id: question.id,
    answer: question.kind === 'text' ? '300000 рублей' : '',
    selectedOptions: question.kind === 'choice' ? ['Java', 'Kafka'] : []
  }));
  const requests = [];
  const background = await loadBackground({
    aiProvider: 'groq', groqApiKey: 'gsk-test',
    resumeText: 'Synthetic Java developer with Kafka experience.',
    resumeProfileText: 'Synthetic Java developer with Kafka experience.',
    expectedSalary: '300000 рублей'
  }, async (url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    assert.equal(body.reasoning_effort, 'low');
    assert.equal(body.max_tokens, 2048);
    assert.deepEqual(JSON.parse(body.messages.find((message) => message.role === 'user').content).questions, questions);
    return jsonResponse(200, {
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ answers: expected, coverLetter: '' }) } }],
      usage: { prompt_tokens: 1100, completion_tokens: 836, total_tokens: 1936,
        completion_tokens_details: { reasoning_tokens: 509 } }
    });
  });
  const result = await background.send({
    type: 'GENERATE_COVER_LETTER', task: 'test_assist', questions, coverLetterRequested: false
  });
  assert.equal(result.ok, true);
  assert.equal(requests.length, 1);
  assert.deepEqual(result.answers, expected);
  assert.equal(result.coverLetter, '');
});

const regressionSettings = () => ({ aiEnabled: true, aiProvider: 'groq', aiFallbackProvider: 'qwen', aiProviderCredentials: { groq: { apiKey: 'gsk-test' }, qwen: { apiKey: 'sk-test' } }, resumeText: 'Java developer experienced with Spring Boot and SQL.', resumeProfileText: 'Java developer experienced with Spring Boot and SQL.' });
const validCover = 'Пишу сервисы на Java и Spring Boot, работаю с SQL.';

test('[BS:COVERS:HHJA-BR-000046] local Groq daily quota triggers configured provider fallback without a Groq request', async () => {
  const localData = { ...regressionSettings(), aiQuotaUsage: { utcDay: new Date().toISOString().slice(0,10), models: { 'openai/gpt-oss-20b': { requests: 1000 } } } };
  const urls = [];
  const bg = await loadBackground(localData, async (url) => { urls.push(url); return jsonResponse(200, { choices: [{ message: { content: validCover } }] }); });
  const result = await bg.send({ type: 'GENERATE_COVER_LETTER' });
  assert.equal(result.ok, true);
  assert.equal(result.provider, 'qwen');
  assert.equal(urls.length, 1);
  assert.match(urls[0], /aliyuncs/);
});

test('rejected Groq HTTP does not invent token usage and retains safe error metadata', async () => {
  const localData = { ...regressionSettings(), aiFallbackProvider: '' };
  const bg = await loadBackground(localData, async () => jsonResponse(403, { error: { code: 'access_denied', message: 'private provider detail' } }));
  const result = await bg.send({ type: 'GENERATE_COVER_LETTER' });
  assert.equal(result.ok, false);
  assert.equal(localData.aiQuotaUsage.models['openai/gpt-oss-20b'].rateTokens, 0);
  assert.equal(result.provider, 'groq');
  assert.equal(result.task, 'cover_letter');
  assert.equal(result.httpStatus, 403);
  assert.doesNotMatch(result.error, /private provider detail/);
});

test('[BS:COVERS:HHJA-BR-000044] [BS:RETIRES:HHJA-BR-000007:BY:HHJA-BR-000044] provider probe checks both Groq models using synthetic content without saved resume', async () => {
  const bodies = [];
  const bg = await loadBackground({ aiProvider: 'groq', aiProviderCredentials: { groq: { apiKey: 'gsk-test' } } }, async (_url, options) => {
    const body = JSON.parse(options.body); bodies.push(body);
    const content = body.response_format?.json_schema?.name === 'hh_resume_profile' ? JSON.stringify({profile:'Java developer experienced with Spring Boot and SQL.', weaknesses:[]}) : body.response_format ? JSON.stringify({answers:[{id:'experience',answer:'3 года',selectedOptions:[]}],coverLetter:''}) : validCover;
    return jsonResponse(200, { choices: [{ message: { content } }] });
  });
  const result = await bg.send({ type: 'TEST_AI_PROVIDER', providerId: 'groq' });
  assert.equal(result.ok, true);
  assert.deepEqual(new Set(bodies.map(body => body.model)), new Set(['openai/gpt-oss-20b','openai/gpt-oss-120b']));
  assert.equal(result.checks.length, 3);
  assert.equal(bodies[0].messages[0].content, globalThis.HHJA_DEFAULTS.coverPrompt);
});

test('invalid selected options trigger provider fallback before returning questionnaire answers', async () => {
  const localData = regressionSettings();
  let requests = 0;
  const bg = await loadBackground(localData, async () => jsonResponse(200, { choices: [{ message: { content: JSON.stringify({answers:[{id:'tech',answer:'',selectedOptions:[++requests === 1 ? 'invented' : 'Java']}],coverLetter:''}) } }] }));
  const result = await bg.send({ type: 'GENERATE_COVER_LETTER', task:'test_assist', questions:[{id:'tech',kind:'choice',inputType:'radio',question:'Technology?',options:['Java','SQL']}] });
  assert.equal(result.ok, true);
  assert.equal(result.provider, 'qwen');
  assert.equal(requests, 2);
});

test('[BS:COVERS:HHJA-BR-000046] stalled response body times out and frees the shared AI queue', async () => {
  globalThis.__HH_JOB_ASSISTANT_TEST_AI_TIMEOUT_MS__ = 25;
  const localData = { ...regressionSettings(), aiFallbackProvider: '' };
  let requests = 0;
  const bg = await loadBackground(localData, async () => ++requests === 1
    ? { ok:true, status:200, text: () => new Promise(() => {}) }
    : jsonResponse(200, {choices:[{message:{content:validCover}}]}));
  try {
    const [first, next] = await Promise.all([bg.send({type:'GENERATE_COVER_LETTER'}), bg.send({type:'GENERATE_COVER_LETTER'})]);
    assert.equal(first.errorCode, 'HHJA_AI_PROVIDER_TIMEOUT');
    assert.equal(next.ok, true);
    assert.equal(requests, 2);
  } finally { delete globalThis.__HH_JOB_ASSISTANT_TEST_AI_TIMEOUT_MS__; }
});

test('body read errors use the configured fallback and do not become an empty success', async () => {
  const bg = await loadBackground(regressionSettings(), async url => url.includes('groq')
    ? { ok:true, status:200, async text() { throw new Error('read failed'); } }
    : jsonResponse(200, {choices:[{message:{content:validCover}}]}));
  const result = await bg.send({type:'GENERATE_COVER_LETTER'});
  assert.equal(result.ok,true);
  assert.equal(result.provider,'qwen');
  assert.equal(result.fallbackReason,'HHJA_AI_PROVIDER_NETWORK');
});

test('expired queued operations cannot make a late request or return late output', async () => {
  let requests=0;
  const bg = await loadBackground({...regressionSettings(), aiFallbackProvider:''}, async () => {
    requests++;
    await new Promise(resolve => setTimeout(resolve,60));
    return jsonResponse(200,{choices:[{message:{content:validCover}}]});
  });
  const first=bg.send({type:'GENERATE_COVER_LETTER'});
  await new Promise(resolve => setTimeout(resolve,5));
  const expired=await bg.send({type:'GENERATE_COVER_LETTER',deadlineAt:Date.now()+10});
  assert.equal(expired.ok,false);
  assert.ok(['HHJA_AI_QUEUE_TIMEOUT','HHJA_AI_OPERATION_TIMEOUT'].includes(expired.errorCode));
  assert.equal((await first).ok,true);
  assert.equal(requests,1);
  const late=await bg.send({type:'GENERATE_COVER_LETTER',deadlineAt:Date.now()+10});
  assert.equal(late.ok,false);
  assert.ok(['HHJA_AI_PROVIDER_TIMEOUT','HHJA_AI_OPERATION_TIMEOUT'].includes(late.errorCode));
});

test('failed profile refresh reports HTTP 403 without blessing the cached profile as fresh', async () => {
  const localData={...regressionSettings(),aiFallbackProvider:'',resumeProfileSourceHash:'old',resumeProfileCheckedAt:'2020-01-01T00:00:00Z',resumeProfileAutoRefreshEnabled:true};
  const bg=await loadBackground(localData,async()=>jsonResponse(403,{error:{code:'access_denied'}}));
  const result=await bg.send({type:'ENSURE_RESUME_PROFILE'});
  assert.equal(result.ok,false);
  assert.equal(result.httpStatus,403);
  assert.equal(result.task,'resume_profile_build');
  assert.equal(localData.resumeProfileCheckedAt,'2020-01-01T00:00:00Z');
  assert.equal(localData.resumeProfileText,regressionSettings().resumeProfileText);
});

test('provider probe reports partial structured-model failure without fallback', async () => {
  const urls=[];
  const bg=await loadBackground(regressionSettings(),async(url,options)=>{
    urls.push(url);
    return JSON.parse(options.body).model === 'openai/gpt-oss-20b'
      ? jsonResponse(200,{choices:[{message:{content:validCover}}]})
      : jsonResponse(403,{error:{code:'access_denied'}});
  });
  const result=await bg.send({type:'TEST_AI_PROVIDER',providerId:'groq'});
  assert.equal(result.ok,false);
  assert.deepEqual(result.checks.map(c=>c.ok),[true,false,false]);
  assert.ok(urls.every(url=>url.includes('groq')));
  assert.equal(result.httpStatus,403);
});

test('[BS:COVERS:HHJA-BR-000045] AI mode changes atomically reject active work and invalidate stale queues while retaining history', async () => {
  const localData={...regressionSettings(),autoApplyRunLease:{active:true},runResults:[{status:'sent'}],autoApplyQueue:{active:true,aiEnabled:true,vacancies:['v1']},autoApplySearchQueue:{active:false,aiEnabled:true,links:['s1']}};
  const bg=await loadBackground(localData,async()=>{throw new Error('No network expected');});
  assert.equal((await bg.send({type:'SET_AI_ENABLED',enabled:false})).errorCode,'HHJA_AI_MODE_RUN_ACTIVE');
  assert.equal(localData.aiEnabled,true);
  localData.autoApplyRunLease.active=false;
  localData.runState={state:'generating_cover_letter'};
  assert.equal((await bg.send({type:'SET_AI_ENABLED',enabled:false})).errorCode,'HHJA_AI_MODE_RUN_ACTIVE');
  localData.runState={state:'stopped'};
  const result=await bg.send({type:'SET_AI_ENABLED',enabled:false});
  assert.equal(result.ok,true);
  assert.equal(result.queueInvalidated,true);
  assert.equal(localData.autoApplyQueue.active,false);
  assert.equal(localData.autoApplySearchQueue.active,false);
  assert.deepEqual(localData.runResults,[{status:'sent'}]);
  assert.equal(localData.aiProviderCredentials.groq.apiKey,'gsk-test');
});

test('semantic cover rejection retries configured fallback for both providers', async () => {
  for (const primary of ['groq','qwen']) {
    let calls=0;
    const bg=await loadBackground({...regressionSettings(),aiProvider:primary,aiFallbackProvider:primary==='groq'?'qwen':'groq'},async()=>jsonResponse(200,{choices:[{message:{content:++calls===1?'Готов обсудить релевантный опыт и требования вакансии.':validCover}}]}));
    const result=await bg.send({type:'GENERATE_COVER_LETTER'});
    assert.equal(result.ok,true);
    assert.equal(result.fallbackReason,'HHJA_AI_PROVIDER_INVALID_OUTPUT');
    assert.equal(calls,2);
  }
});

test('both providers fail once with safe diagnostics preserved in exported log metadata', async () => {
  const localData={...regressionSettings(),agentDebugLogsEnabled:true};
  let calls=0;
  const bg=await loadBackground(localData,async()=>{calls++;return jsonResponse(503,{error:{code:'service_unavailable',message:'private server text'}});});
  await bg.startLog('terminal-provider-failure');
  const result=await bg.send({type:'GENERATE_COVER_LETTER'});
  assert.equal(result.ok,false);
  assert.equal(result.provider,'qwen');
  assert.equal(result.httpStatus,503);
  assert.equal(calls,2);
  const logs=JSON.stringify(debugEntries(localData));
  assert.match(logs,/"provider":"groq"/);
  assert.match(logs,/"provider":"qwen"/);
  assert.match(logs,/"providerErrorCode":"service_unavailable"/);
  assert.match(logs,/"httpStatus":503/);
  assert.doesNotMatch(logs,/gsk-test|sk-test|private server text/);
});

test('shared operation budget includes profile retries and Groq quota waits for fallback', async () => {
  const registry=globalThis.HHJA_AI_PROVIDERS;
  const config={aiProvider:'qwen',aiFallbackProvider:'groq'};
  assert.equal(registry.getOperationBudgetMs(config,'cover_letter'),290000);
  assert.equal(registry.getOperationBudgetMs(config,'resume_profile_build'),565000);
  assert.equal(registry.createOperationDeadline(config,'cover_letter',1000),291000);
});

test('numbered cover answers require an explicit acknowledgement-form request', async () => {
  const settings={...regressionSettings(),aiFallbackProvider:''};
  const bg=await loadBackground(settings,async()=>jsonResponse(200,{choices:[{message:{content:JSON.stringify({answers:[],coverLetter:'1. Работал со Spring Boot\n2. 300000 рублей'})}}]}));
  const message={type:'GENERATE_COVER_LETTER',task:'test_assist',questions:[],coverLetterRequested:true};
  assert.equal((await bg.send(message)).ok,false);
  const result=await bg.send({...message,allowStructuredCoverLetter:true});
  assert.equal(result.ok,true);
  assert.match(result.coverLetter,/^1\./);
});

test('GET_STATUS recovers only a stale quiescent stopped lease and preserves unresolved accounting', async () => {
  const fixture=()=>({
    aiEnabled:true,runState:{state:'stopped',runId:'old-run',ownerId:123},autoApplyStopRequested:true,
    autoApplyRunLease:{active:true,runId:'old-run',ownerId:123,updatedAt:'2020-01-01T00:00:00Z'},
    autoApplyQueue:{active:false},autoApplySearchQueue:{active:false},runResults:[{status:'sent'}]
  });
  for (const variant of [
    {},
    {autoApplyPendingSubmit:{item:{vacancyId:'1'}}},
    {autoApplyResponseAttempts:{one:{runId:'old-run',startedAt:'2020-01-01T00:00:00Z'}}},
    {autoApplyQueue:{active:true}},
    {autoApplySearchQueue:{active:true}},
    {autoApplyStopRequested:false},
    {scheduledAutoApplySession:{runId:'old-run',state:'repair_pending'}},
    {runState:{state:'applying',runId:'old-run',ownerId:123}},
    {runState:{state:'stopped',runId:'different-run',ownerId:123}},
    {autoApplyRunLease:{active:true,runId:'old-run',ownerId:123,updatedAt:new Date().toISOString()}}
  ]) {
    const localData={...fixture(),...variant};
    const bg=await loadBackground(localData,async()=>{throw new Error('No network expected');});
    const result=await bg.send({type:'GET_STATUS'});
    assert.equal(result.ok,true);
    assert.equal(localData.autoApplyRunLease.active,Object.keys(variant).length>0,JSON.stringify(variant));
    assert.deepEqual(localData.runResults,[{status:'sent'}]);
    if (!Object.keys(variant).length) assert.equal((await bg.send({type:'SET_AI_ENABLED',enabled:false})).ok,true);
  }
});

test('stopped lease recovery cancels stale attempts only away from their matching HH destination', async () => {
  for (const scenario of [
    {url:'https://hh.ru/search/vacancy?text=java',recover:true},
    {url:'https://hh.ru/vacancy/12346',recover:true},
    {url:'https://hh.ru/applicant/profile/me',recover:true},
    {url:'https://example.com/applicant/profile/me',recover:false},
    {url:'https://hh.ru/vacancy/12345',recover:false},
    {url:'https://hh.ru/applicant/vacancy_response?vacancyId=12345',recover:false},
    {url:'https://hh.ru/search/vacancy?text=java',fresh:true,recover:false},
    {url:'https://example.com/',recover:false},
    {url:'https://hh.ru/search/vacancy?text=java',pending:true,recover:false}
  ]) {
    const attempt={runId:'old-run',ownerId:123,vacancyId:'12345',responseUrl:'https://hh.ru/applicant/vacancy_response?vacancyId=12345',startedAt:scenario.fresh?new Date().toISOString():'2020-01-01T00:00:00Z'};
    const localData={aiEnabled:true,runState:{state:'stopped',runId:'old-run',ownerId:123},autoApplyStopRequested:true,autoApplyRunLease:{active:true,runId:'old-run',ownerId:123,updatedAt:'2020-01-01T00:00:00Z'},autoApplyQueue:{active:false},autoApplySearchQueue:{active:false},autoApplyResponseAttempts:{one:attempt},autoApplyPendingSubmit:scenario.pending?{item:{vacancyId:'12345'}}:null,runResults:[{status:'sent'}]};
    const bg=await loadBackground(localData,async()=>{throw new Error('No network expected');});
    globalThis.chrome.tabs.get=async id=>({id,url:scenario.url});
    assert.equal((await bg.send({type:'GET_STATUS'})).ok,true);
    assert.equal(localData.autoApplyRunLease.active,!scenario.recover,scenario.url);
    assert.equal(Boolean(localData.autoApplyResponseAttempts.one.cancelledAt),scenario.recover,scenario.url);
    if (scenario.recover) assert.equal(localData.autoApplyResponseAttempts.one.cancelReason,'run_stopped');
    assert.deepEqual(localData.runResults,[{status:'sent'}]);
  }
});

test('GET_STATUS recovers a closed owner only for old stopped quiescent work and preserves history', async () => {
  for (const scenario of [{recover:true},{fresh:true,recover:false},{pending:true,recover:false},{running:true,recover:false}]) {
    const localData={
      aiEnabled:true,
      runState:{state:scenario.running?'applying':'stopped',runId:'closed-run',ownerId:234,applied:7,processed:9,errors:1},
      autoApplyStopRequested:true,
      autoApplyRunLease:{active:true,runId:'closed-run',ownerId:234,updatedAt:scenario.fresh?new Date().toISOString():'2020-01-01T00:00:00Z'},
      autoApplyQueue:{active:false,runId:'closed-run',ownerId:234},
      autoApplySearchQueue:{active:false},
      autoApplyResponseAttempts:{old:{runId:'closed-run',ownerId:234,startedAt:'2020-01-01T00:00:00Z'}},
      autoApplyPendingSubmit:scenario.pending?{runId:'closed-run',ownerId:234,item:{vacancyId:'12345'}}:null,
      runResults:[{status:'sent',vacancyId:'finished'}]
    };
    const bg=await loadBackground(localData,async()=>{throw new Error('No network expected');});
    globalThis.chrome.tabs.get=async()=>{throw new Error('No tab with id: 234.');};
    const result=await bg.send({type:'GET_STATUS'});
    assert.equal(result.ok,true);
    assert.equal(localData.autoApplyRunLease.active,!scenario.recover);
    assert.equal(Boolean(localData.autoApplyResponseAttempts.old.cancelledAt),scenario.recover);
    assert.deepEqual(localData.runResults,[{status:'sent',vacancyId:'finished'}]);
    assert.equal(localData.runState.applied,7);
    assert.equal(localData.runState.errors,1);
    if (scenario.recover) {
      assert.equal(localData.autoApplyResponseAttempts.old.cancelReason,'owner_tab_closed');
      assert.equal(result.runState.state,'error');
      assert.equal((await bg.send({type:'SET_AI_ENABLED',enabled:false})).ok,true);
    }
  }
});
