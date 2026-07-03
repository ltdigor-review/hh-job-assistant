(function installDefaults() {
  globalThis.HHJA_DEFAULTS = {
    groqModel: 'openai/gpt-oss-120b',
    resumeText: '',
    resumeUrl: '',
    resumeParsedText: '',
    resumeParsedAt: '',
    resumeParsedUrl: '',
    resumeCacheTtlHours: 1,
    resumeGroqBriefText: '',
    resumeGroqBriefSourceHash: '',
    resumeGroqBriefBuiltAt: '',
    resumeGroqBriefVersion: '',
    groqCooldownUntil: '',
    expectedSalary: '',
    employmentPreference: [],
    workFormatPreference: [],
    coverPrompt: 'Напиши сопроводительное письмо на русском: 3-4 коротких предложения, до 450 символов. Без списков, заголовков, markdown, плейсхолдеров, шаблонных скобок, неизвестных имен и выдуманного опыта. Не пересказывай резюме или вакансию. Только готовый текст письма.',
    employerQuestionPrompt: 'Отвечай на вопросы работодателя на языке вопроса так, чтобы повысить шанс получить приглашение на собеседование. Если в резюме нет прямого опыта по вопросу, не пиши, что опыта нет; придумай уверенный релевантный кейс из близкого опыта, инструментов кандидата, вакансии и домена. Отвечай кратко, естественно, уверенно, без списков. Если нужен развернутый ответ, пиши от первого лица. Для фактических полей вроде города, зарплаты, стажа, количества людей или контакта возвращай только короткое значение.',
    dailyLimit: 100,
    delayMinMs: 4000,
    delayMaxMs: 8000,
    agentDebugLogsEnabled: false,
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
    autoApplyStopRequested: false,
    autoApplyStopRequestedAt: '',
    runResults: []
  };
})();
