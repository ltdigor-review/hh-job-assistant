# HH Job Assistant

Chrome extension for applying to hh.ru vacancies from an already signed-in account.

## Русский

HH Job Assistant помогает:

- находить вакансии на открытой странице hh.ru;
- отправлять отклики до заданного лимита, по умолчанию `20`;
- продолжать отклики через страницы `/applicant/vacancy_response`, когда hh.ru открывает отдельную форму;
- писать сопроводительные письма через Groq;
- отвечать на вопросы работодателя через Groq;
- подставлять `Expected salary for questions` в вопросы про зарплату;
- показывать в popup последние результаты, ошибки и пропуски;
- обновлять резюме вручную или по расписанию, пока Chrome открыт.

### Установка

1. Скачайте проект с GitHub через `Code` -> `Download ZIP`.
2. Распакуйте ZIP в обычную папку. Не удаляйте ее после установки.
3. Откройте в Chrome `chrome://extensions`.
4. Включите `Developer mode` / `Режим разработчика`.
5. Нажмите `Load unpacked` / `Загрузить распакованное расширение`.
6. Выберите папку `hh-job-assistant`, где лежит `manifest.json`.
7. Закрепите расширение через значок пазла в Chrome.

После изменения файлов расширения нажмите reload у расширения на странице `chrome://extensions`, иначе Chrome продолжит использовать старую версию.

### Быстрая настройка в popup

1. Нажмите иконку `HH Job Assistant`.
2. В поле `Groq API key` вставьте ключ вида `gsk_...`.
3. Нажмите `Save key`.
4. Нажмите `Test Groq`.

Если тест успешен, popup покажет `Groq OK`.

### Полная настройка

Откройте `Настройки` расширения и заполните нужные поля:

- `Groq API key` — ключ из [Groq Quickstart](https://console.groq.com/docs/quickstart);
- `Groq model` — модель, по умолчанию `llama-3.3-70b-versatile`;
- `Resume text` — краткий текст резюме;
- `Expected salary for questions` — зарплата для ответов на вопросы работодателя;
- `Cover-letter prompt` — инструкция для сопроводительного письма;
- `Daily apply limit` — лимит откликов, по умолчанию `20`;
- `Delay min/max` — пауза между действиями;
- `Enable daily resume refresh` — ежедневное обновление резюме, пока Chrome открыт.

Нажмите `Save`. Если добавили Groq key, нажмите `Test Groq`.

### Использование

1. Войдите в аккаунт на [hh.ru](https://hh.ru).
2. Откройте страницу с вакансиями, лучше рекомендации по резюме.
3. Нажмите иконку `HH Job Assistant`.
4. Нажмите `Предпросмотр`, чтобы проверить найденные вакансии.
5. Нажмите `Запустить отклики`.
6. Для остановки нажмите `Стоп`.

Popup показывает:

- счетчики найденных, проверенных, отправленных, пропущенных и ошибочных откликов;
- последний статус;
- последние результаты;
- явные предупреждения, например `Skipped: ... needs a cover letter, but Groq API key is missing`.

### Что будет без Groq key

Обычные отклики без письма работают.

Если вакансия задает вопрос про зарплату, расширение использует `Expected salary for questions`.

Если вакансия требует сопроводительное письмо, расширение может вставить короткий fallback-текст. Для нормального письма под конкретную вакансию нужен Groq key.

Если вакансия требует сложные ответы или тест, а ключа Groq нет и fallback невозможен, вакансия пропускается. Popup явно покажет причину пропуска:

`Skipped because Groq API key is missing: vacancy needs employer questions/test assistance.`

### Важно

- Расширение не хранит логин и пароль hh.ru.
- Нужно заранее войти в hh.ru в Chrome.
- Если появилась капча или страница входа, остановите расширение и пройдите проверку вручную.
- Не публикуйте Groq key в GitHub, чатах, скриншотах или логах.
- После обновления кода расширения всегда нажимайте reload в `chrome://extensions`.

---

## English

HH Job Assistant helps you:

- detect vacancies on the current hh.ru page;
- submit applications up to the configured limit, default `20`;
- continue through `/applicant/vacancy_response` pages when hh.ru opens a separate response form;
- write cover letters with Groq;
- answer employer questions with Groq;
- use `Expected salary for questions` for salary questions;
- show recent results, errors, and skipped vacancies in the popup;
- refresh resumes manually or on schedule while Chrome is open.

### Install

1. Download the project from GitHub: `Code` -> `Download ZIP`.
2. Unzip it into a normal folder. Keep this folder after installation.
3. Open `chrome://extensions` in Chrome.
4. Turn on `Developer mode`.
5. Click `Load unpacked`.
6. Select the `hh-job-assistant` folder containing `manifest.json`.
7. Pin the extension through the Chrome puzzle icon.

After changing extension files, click reload for the extension on `chrome://extensions`; otherwise Chrome keeps using the old version.

### Quick Popup Setup

1. Click the `HH Job Assistant` icon.
2. Paste a `gsk_...` key into `Groq API key`.
3. Click `Save key`.
4. Click `Test Groq`.

If the test succeeds, the popup shows `Groq OK`.

### Full Configuration

Open extension `Настройки` and set what you need:

- `Groq API key` — key from [Groq Quickstart](https://console.groq.com/docs/quickstart);
- `Groq model` — default `llama-3.3-70b-versatile`;
- `Resume text` — short resume text;
- `Expected salary for questions` — salary used for employer-question answers;
- `Cover-letter prompt` — cover-letter instruction;
- `Daily apply limit` — application limit, default `20`;
- `Delay min/max` — delay between actions;
- `Enable daily resume refresh` — daily resume refresh while Chrome is open.

Click `Save`. If you added a Groq key, click `Test Groq`.

### Use

1. Sign in at [hh.ru](https://hh.ru).
2. Open a vacancies page, preferably resume recommendations.
3. Click the `HH Job Assistant` icon.
4. Click `Предпросмотр` to check detected vacancies.
5. Click `Запустить отклики`.
6. Click `Стоп` to stop.

The popup shows:

- found, processed, applied, skipped, and error counters;
- the latest status;
- recent results;
- explicit warnings, such as `Skipped: ... needs a cover letter, but Groq API key is missing`.

### Without a Groq Key

Normal applications without a cover letter work.

For salary questions, the extension uses `Expected salary for questions`.

For required cover letters, the extension can insert a short fallback text. For a proper vacancy-specific letter, configure a Groq key.

If a vacancy needs complex employer answers or a test and no fallback is possible, the vacancy is skipped. The popup shows the reason explicitly:

`Skipped because Groq API key is missing: vacancy needs employer questions/test assistance.`

### Important

- The extension does not store your hh.ru login or password.
- You must already be signed in to hh.ru in Chrome.
- If captcha or login appears, stop the extension and complete the check manually.
- Do not publish your Groq key in GitHub, chats, screenshots, or logs.
- After updating extension code, always reload it on `chrome://extensions`.

## Developer Checks

```bash
npm test
```

Live authorized hh.ru smoke test:

```bash
npm run test:hh
```

`test:hh` requires Chrome DevTools Protocol at `http://127.0.0.1:9222`.
