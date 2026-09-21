(function installAiValidation() {
  const { cleanText, getGeneratedTextInvalidReason } = globalThis.HHJobAssistantText;
function coverLetterInvalidReason(value) {
  const text = cleanText(value);
  const genericReason = getGeneratedTextInvalidReason(text, { minLength: 20 });
  if (genericReason) return genericReason;
  if (!/[А-Яа-яЁё]/.test(text)) return 'cover_letter_not_russian';
  if (text.length > 220) return 'cover_letter_too_long';
  if (text.split(/\n+/).filter(Boolean).length > 4) return 'cover_letter_multiline_report';
  if (/^\s*(?:[-*]|\d+[.)])\s+/m.test(text)) return 'cover_letter_list';
  const sentenceCount = text.split(/[.!?]+/).map(cleanText).filter(Boolean).length;
  if (sentenceCount > 2) return 'cover_letter_too_many_sentences';
  if (sentenceCount > 1 && text.length > 180) {
    return 'cover_letter_long_template';
  }
  if (hasCoverLetterCliche(text)) {
    return 'cover_letter_cliche';
  }
  if (hasCoverLetterProtocolLeak(text)) {
    return 'cover_letter_protocol_leak';
  }
  return '';
}

function hasCoverLetterCliche(value) {
  const text = cleanText(value);
  return /(?:уважаем(?:ая|ые)\s+(?:команда|коллеги|работодатель)|меня\s+привлекла\s+возможность|ценятся\s+инновации|инновации\s+и\s+эффективность|масштабн(?:ыми|ые|ых)\s+проект|над[её]жн(?:ых|ые|ыми)\s+микросервисн(?:ых|ые|ыми)\s+решени|соответству(?:ет|ю)\s+требованиям|требования\s+вакансии|проявлял(?:а)?\s+интерес|готов(?:а)?\s+(?:обсудить|применять)\b|релевантн(?:ый|ого|ом)\s+опыт|ускорять\s+доставку\s+продукта|гибк(?:ий|ого)\s+формат\s+работы|открытость\s+к\s+удал[её]нному\s+сотрудничеству|быстро\s+включаться\s+в\s+новые\s+задачи|поддерживать\s+высокий\s+уровень\s+качества|буду\s+рад(?:а)?\s+стать\s+частью\s+команды|с\s+энтузиазмом\s+готов(?:а)?|динамично\s+развивающ(?:ейся|аяся)\s+команд|внести\s+вклад\s+в\s+развитие\s+компании|чем\s+могу\s+быть\s+полезен|близк(?:ий|ая|ое|ие|о|и|а)?\s+к\s+моему\s+опыту|вакансия\s+выглядит\s+близко|вижу\s+пересечение)/i.test(text);
}

function hasCoverLetterProtocolLeak(value) {
  return /(?:резюме кандидата|текст вакансии|структурированные вопросы|choice group|text question|ответы на вопросы работодателя)/i.test(cleanText(value));
}


  globalThis.HHJA_AI_VALIDATION = { coverLetterInvalidReason };
})();
