(function installAiProviders() {
  const EMPLOYER_ANSWER_RESPONSE_FORMAT = Object.freeze({
    type: 'json_schema',
    json_schema: Object.freeze({
      name: 'hh_employer_answers',
      strict: true,
      schema: Object.freeze({
        type: 'object',
        properties: Object.freeze({
          answers: Object.freeze({
            type: 'array',
            items: Object.freeze({
              type: 'object',
              properties: Object.freeze({
                id: Object.freeze({ type: 'string' }),
                answer: Object.freeze({ type: 'string' }),
                selectedOptions: Object.freeze({ type: 'array', items: Object.freeze({ type: 'string' }) })
              }),
              required: Object.freeze(['id', 'answer', 'selectedOptions']),
              additionalProperties: false
            })
          }),
          coverLetter: Object.freeze({ type: 'string' })
        }),
        required: Object.freeze(['answers', 'coverLetter']),
        additionalProperties: false
      })
    })
  });
  const RESUME_PROFILE_RESPONSE_FORMAT = Object.freeze({
    type: 'json_schema',
    json_schema: Object.freeze({
      name: 'hh_resume_profile',
      strict: true,
      schema: Object.freeze({
        type: 'object',
        properties: Object.freeze({
          profile: Object.freeze({ type: 'string' }),
          weaknesses: Object.freeze({ type: 'array', items: Object.freeze({ type: 'string' }) })
        }),
        required: Object.freeze(['profile', 'weaknesses']),
        additionalProperties: false
      })
    })
  });
  const JSON_OBJECT_RESPONSE_FORMAT = Object.freeze({ type: 'json_object' });

  function taskCapability({ model, maxTokens, responseFormat = null, requestExtras = {}, validateCoverLetter = false }) {
    return Object.freeze({
      model,
      maxTokens: Object.freeze([...maxTokens]),
      responseFormat,
      requestExtras: Object.freeze({ ...requestExtras }),
      validateCoverLetter
    });
  }

  const PROVIDERS = Object.freeze({
    qwen: Object.freeze({
      id: 'qwen',
      label: 'Qwen',
      credentialLabel: 'Ключ Qwen API',
      credentialPlaceholder: 'sk-...',
      endpoint: 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions',
      timeoutMs: 120000,
      quotaPolicy: 'provider',
      settingsModelSummary: 'Все AI-задачи: qwen3.8-max',
      requestExtras: Object.freeze({ enable_thinking: true }),
      tasks: Object.freeze({
        cover_letter: taskCapability({
          model: 'qwen3.8-max',
          maxTokens: [4096],
          validateCoverLetter: true
        }),
        test_assist: taskCapability({
          model: 'qwen3.8-max',
          maxTokens: [8192],
          responseFormat: JSON_OBJECT_RESPONSE_FORMAT
        }),
        resume_profile_build: taskCapability({
          model: 'qwen3.8-max',
          maxTokens: [8192, 16384],
          responseFormat: JSON_OBJECT_RESPONSE_FORMAT
        }),
        resume_profile_edit: taskCapability({
          model: 'qwen3.8-max',
          maxTokens: [8192, 16384],
          responseFormat: JSON_OBJECT_RESPONSE_FORMAT
        })
      })
    }),
    groq: Object.freeze({
      id: 'groq',
      label: 'Groq',
      credentialLabel: 'Ключ Groq API',
      credentialPlaceholder: 'gsk_...',
      endpoint: 'https://api.groq.com/openai/v1/chat/completions',
      timeoutMs: 35000,
      quotaPolicy: 'groq',
      settingsModelSummary: 'Вопросы: OpenAI GPT-OSS 120B · письма: OpenAI GPT-OSS 20B',
      requestExtras: Object.freeze({}),
      tasks: Object.freeze({
        cover_letter: taskCapability({
          model: 'openai/gpt-oss-20b',
          maxTokens: [2048],
          requestExtras: { reasoning_effort: 'low' }
        }),
        test_assist: taskCapability({
          model: 'openai/gpt-oss-120b',
          maxTokens: [2048],
          requestExtras: { reasoning_effort: 'low' },
          responseFormat: EMPLOYER_ANSWER_RESPONSE_FORMAT
        }),
        resume_profile_build: taskCapability({
          model: 'openai/gpt-oss-120b',
          maxTokens: [2400, 4000],
          responseFormat: RESUME_PROFILE_RESPONSE_FORMAT,
          requestExtras: { reasoning_effort: 'low' }
        }),
        resume_profile_edit: taskCapability({
          model: 'openai/gpt-oss-120b',
          maxTokens: [2400, 4000],
          responseFormat: RESUME_PROFILE_RESPONSE_FORMAT,
          requestExtras: { reasoning_effort: 'low' }
        })
      })
    })
  });

  function normalizeProviderId(value, fallback = 'qwen') {
    const id = String(value || '').trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(PROVIDERS, id) ? id : fallback;
  }

  function normalizeFallbackProvider(config = {}, primaryProviderId = config.aiProvider) {
    const primaryId = normalizeProviderId(primaryProviderId);
    const firstAlternative = Object.keys(PROVIDERS).find((providerId) => providerId !== primaryId) || '';
    if (
      Object.prototype.hasOwnProperty.call(config, 'aiFallbackProvider') &&
      config.aiFallbackProvider !== undefined
    ) {
      const providerId = String(config.aiFallbackProvider || '').trim().toLowerCase();
      return Object.prototype.hasOwnProperty.call(PROVIDERS, providerId) && providerId !== primaryId
        ? providerId
        : '';
    }
    if (
      Object.prototype.hasOwnProperty.call(config, 'aiFallbackEnabled') &&
      config.aiFallbackEnabled !== undefined
    ) {
      return config.aiFallbackEnabled === true ? firstAlternative : '';
    }
    if (
      config.aiFallbackToGroq === true &&
      primaryId !== 'groq' &&
      Object.prototype.hasOwnProperty.call(PROVIDERS, 'groq')
    ) {
      return 'groq';
    }
    return '';
  }

  function getProvider(value) {
    return PROVIDERS[normalizeProviderId(value)];
  }

  function getTaskCapability(providerId, task) {
    const provider = getProvider(providerId);
    const capability = provider.tasks?.[task];
    if (!capability) {
      throw new Error(`AI provider ${provider.id} does not support task ${task}`);
    }
    return capability;
  }

  function getTaskMaxTokens(providerId, task, attempt = 1) {
    const values = getTaskCapability(providerId, task).maxTokens;
    return values[Math.min(Math.max(1, Number(attempt) || 1) - 1, values.length - 1)];
  }

  function getRequestChainTimeoutMs(providerIds, marginMs = 15000) {
    const requestMs = providerIds.reduce((total, providerId) => total + getProvider(providerId).timeoutMs, 0);
    return requestMs + Math.max(0, Number(marginMs) || 0);
  }

  const QUEUE_WAIT_MAX_MS = 30000;
  const QUOTA_WAIT_MAX_MS = 60000;

  function getOperationBudgetMs(config = {}, task = 'cover_letter') {
    const primary = normalizeProviderId(config.aiProvider);
    const fallback = normalizeFallbackProvider(config, primary);
    const attempts = task.startsWith('resume_profile_') ? 2 : 1;
    return [primary, fallback].filter(Boolean).reduce((total, id) => {
      const provider = getProvider(id);
      return total + attempts * (QUEUE_WAIT_MAX_MS + provider.timeoutMs + (provider.quotaPolicy === 'groq' ? QUOTA_WAIT_MAX_MS : 0));
    }, 15000);
  }

  function createOperationDeadline(config, task, now = Date.now()) {
    return now + getOperationBudgetMs(config, task);
  }

  function normalizeCredentials(value, legacyGroqApiKey = '') {
    const source = value && typeof value === 'object' ? value : {};
    const credentials = {};
    for (const providerId of Object.keys(PROVIDERS)) {
      const apiKey = String(source?.[providerId]?.apiKey || '').trim();
      if (apiKey) credentials[providerId] = { apiKey };
    }
    if (!credentials.groq?.apiKey && String(legacyGroqApiKey || '').trim()) {
      credentials.groq = { apiKey: String(legacyGroqApiKey).trim() };
    }
    return credentials;
  }

  function getApiKey(config = {}, providerId = config.aiProvider) {
    const id = normalizeProviderId(providerId);
    const credentials = normalizeCredentials(config.aiProviderCredentials, config.groqApiKey);
    return String(credentials[id]?.apiKey || '').trim();
  }

  function setApiKey(value, providerId, apiKey) {
    const id = normalizeProviderId(providerId);
    const credentials = normalizeCredentials(value);
    const normalizedKey = String(apiKey || '').trim();
    if (normalizedKey) {
      credentials[id] = { apiKey: normalizedKey };
    } else {
      delete credentials[id];
    }
    return credentials;
  }

  globalThis.HHJA_AI_PROVIDERS = {
    PROVIDERS,
    getProvider,
    getTaskCapability,
    getTaskMaxTokens,
    getRequestChainTimeoutMs,
    getOperationBudgetMs,
    createOperationDeadline,
    QUEUE_WAIT_MAX_MS,
    QUOTA_WAIT_MAX_MS,
    normalizeProviderId,
    normalizeFallbackProvider,
    normalizeCredentials,
    getApiKey,
    setApiKey
  };
})();
