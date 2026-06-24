(function installDefaults() {
  globalThis.HHJA_DEFAULTS = {
    groqModel: 'openai/gpt-oss-120b',
    resumeText: '',
    resumeUrl: '',
    resumeParsedText: '',
    resumeParsedAt: '',
    resumeCacheTtlHours: 1,
    resumeGroqBriefText: '',
    resumeGroqBriefSourceHash: '',
    resumeGroqBriefBuiltAt: '',
    resumeGroqBriefVersion: '',
    groqCooldownUntil: '',
    expectedSalary: '',
    coverPrompt: 'Напиши сопроводительное письмо на русском: 3-4 коротких предложения, до 450 символов. Без списков, заголовков, markdown, плейсхолдеров, шаблонных скобок, неизвестных имен и выдуманного опыта. Не пересказывай резюме или вакансию. Только готовый текст письма.',
    dailyLimit: 100,
    delayMinMs: 4000,
    delayMaxMs: 8000,
    agentDebugLogsEnabled: false,
    experimentalFeaturesEnabled: false,
    chatUnreadOnly: true,
    chatReplyMode: 'draft',
    chatLimit: 10,
    runState: {
      state: 'idle',
      found: 0,
      processed: 0,
      applied: 0,
      skipped: 0,
      errors: 0,
      lastError: '',
      currentAction: '',
      updatedAt: null
    },
    runResults: [],
    chatReports: []
  };
})();
