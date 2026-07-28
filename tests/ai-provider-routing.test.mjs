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
      model: 'qwen3.8-max-preview',
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
  assert.equal(requests[0].body.model, 'qwen3.8-max-preview');
  assert.equal(requests[0].body.enable_thinking, true);
  assert.deepEqual(requests[0].body.response_format, { type: 'json_object' });
  assert.equal(requests[0].body.max_tokens, 8192);
  assert.equal(requests[0].options.headers.Authorization, 'Bearer sk-qwen-test');
  assert.equal(localData.aiQuotaUsage.providers.qwen.models['qwen3.8-max-preview'].requests, 1);
  assert.equal(localData.aiQuotaUsage.providers.qwen.models['qwen3.8-max-preview'].totalTokens, 150);
  assert.equal(localData.aiQuotaUsage.providers.qwen.models['qwen3.8-max-preview'].reasoningTokens, 12);
  assert.equal(localData.aiQuotaUsage.models['qwen3.8-max-preview'], undefined);
  assert.doesNotMatch(JSON.stringify(debugEntries(localData)), /sk-qwen-test/);
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
      model: 'qwen3.8-max-preview',
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
