# HH Job Assistant

[Русский](#русский) | [English](#english)

Chrome extension for hh.ru. Works only in a Chrome profile where you are already signed in to hh.ru.

## Русский

### Что умеет

- Находит вакансии на открытой странице hh.ru.
- Показывает предпросмотр перед откликами.
- Отправляет отклики до лимита, по умолчанию `20`.
- Заполняет сопроводительные письма и вопросы через Groq.
- Разгребает `https://hh.ru/chat`: по умолчанию обрабатывает только непрочитанные чаты, готовит ответы на вопросы и сохраняет отчеты по приглашениям созвониться или перейти в другой канал связи.
- Может вручную обновить резюме на hh.ru.

### Установка

1. Скачайте репозиторий: `Code` -> `Download ZIP`.
2. Распакуйте ZIP в папку и не удаляйте ее.
3. Откройте в Chrome `chrome://extensions`.
4. Включите `Developer mode` / `Режим разработчика`.
5. Нажмите `Load unpacked` / `Загрузить распакованное расширение`.
6. Выберите папку с расширением (не архив).

<details>
<summary>Скриншот страницы расширений Chrome</summary>

![Chrome Developer mode and Load unpacked](https://developer.chrome.com/static/docs/extensions/get-started/tutorial/hello-world/image/extensions-page-e0d64d89a6acf.png)

</details>

После обновления файлов нажмите `Reload` у расширения на `chrome://extensions`.

### Настройка

1. Нажмите иконку расширения.
2. Вставьте `Groq API key`, если нужны письма и ответы на вопросы.
3. Нажмите `Save key`, затем `Test Groq`.
4. Откройте `Настройки`.
5. Выберите `Groq model`. По умолчанию используется `llama-3.3-70b-versatile`.
6. Укажите `Resume URL on hh.ru`: ссылку вида `https://hh.ru/resume/...`.
7. Проверьте лимит откликов, задержки и зарплату для вопросов.
8. Для чатов проверьте `Chat assistant`: по умолчанию включены `Process unread chats only`, `Draft only`, лимит `10`.
9. Нажмите `Save`.

Groq key можно взять в [Groq Console](https://console.groq.com/docs/quickstart).

### Использование

1. Войдите в [hh.ru](https://hh.ru) в Chrome.
2. Сначала настройте расширение через `Настройки`.
3. Откройте страницу с вакансиями.
4. Нажмите `Предпросмотр`.
5. Если все нормально, нажмите `Запустить отклики`.
6. Для остановки нажмите `Стоп`.
7. Для ручного поднятия резюме нажмите `Обновить резюме`.
8. Для обработки чатов нажмите `Обработка чатов`. Расширение откроет `https://hh.ru/chat`, пройдет по видимым чатам до лимита и в режиме `Draft only` только заполнит черновик ответа.
9. Отчеты по чатам отображаются в popup в блоке `Chat reports`. Каждый отчет содержит прямую ссылку на чат.

### Важно

- Авторизацию нужно проходить самостоятельно. Если расширение не видит признаки
  авторизованного аккаунта hh.ru, предпросмотр, отклики и обработка чатов не
  запускаются.
- Если появилась капча или страница входа, остановите расширение и пройдите проверку вручную.
- Без Groq key обычные отклики работают, но сложные письма, вопросы и тесты будут пропущены.
- Если работодатель просит позвонить, перейти в Telegram/WhatsApp/email или другой внешний канал, расширение сохраняет отчет и не отвечает автоматически.
- `Auto-send` для чатов отправляет сгенерированный ответ без ручной проверки. Используйте только если готовы к этому риску.

## English

### Features

- Finds vacancies on the current hh.ru page.
- Shows a preview before applying.
- Sends applications up to the configured limit, default `20`.
- Fills cover letters and employer questions with Groq.
- Processes `https://hh.ru/chat`: unread chats by default, drafts answers to employer questions, and saves reports for call or external-contact invitations.
- Can manually refresh your hh.ru resume.

### Install

1. Download the repository: `Code` -> `Download ZIP`.
2. Unzip it into a folder and keep that folder.
3. Open `chrome://extensions` in Chrome.
4. Enable `Developer mode`.
5. Click `Load unpacked`.
6. Select the folder containing `manifest.json`.
7. Pin the extension with the puzzle icon.

<details>
<summary>Chrome extensions page screenshot</summary>

![Chrome Developer mode and Load unpacked](https://developer.chrome.com/static/docs/extensions/get-started/tutorial/hello-world/image/extensions-page-e0d64d89a6acf.png)

</details>

After changing files, click `Reload` for the extension on `chrome://extensions`.

No-ping extension smoke test:

```bash
npm run test:extension
```

This launches a temporary Chromium-compatible browser profile, loads the
unpacked extension directly from this repository, checks
`chrome.runtime.getManifest().version`, and deletes the temp profile. It does
not use your normal Chrome profile and does not require `chrome://extensions`.
Set `HHJA_CHROMIUM_PATH` to force a specific Chromium/Chrome executable.

Authorized hh.ru checks need an authenticated browser profile. Use a dedicated
persistent Chromium profile instead of the normal Chrome profile:

```bash
npm run sync:hh:auth
```

This copies only hh.ru cookie rows from Chrome Profile 1 into
`.hhja-chromium-profile/Default`, writes a backup beside the target cookie DB,
and stores non-secret sync evidence in `.hhja-chromium-profile/hh-auth-sync-last.json`.
Override paths with `HHJA_CHROME_COOKIE_PROFILE`,
`HHJA_CHROMIUM_USER_DATA_DIR`, or `HHJA_CHROMIUM_COOKIE_PROFILE`.

Configure the dedicated Chromium extension storage without opening extension UI:

```bash
HHJA_ENV_FILE=/path/to/.env npm run configure:hh:chromium
```

Supported keys include `GROQ_API_KEY`, `GROQ_MODEL`, `HHJA_RESUME_URL`,
`HHJA_EXPECTED_SALARY`, and related `HHJA_*` overrides. The command reports only
configured key names and boolean Groq-key presence, not the secret value.

```bash
npm run test:hh:chromium
```

By default this uses `.hhja-chromium-profile/`, loads the unpacked extension
from this repository, opens hh.ru, and runs the existing live smoke check over
CDP. If hh.ru is not logged in in that profile, the check fails with the
login/captcha evidence. To keep the browser open for the one-time login:

```bash
HHJA_CHROMIUM_KEEP_OPEN=1 npm run test:hh:chromium
```

After that profile is authorized, future `npm run test:hh:chromium` runs reuse
the same hh.ru session and do not need Chrome Profile 1.

Bounded live auto-apply through the dedicated Chromium profile:

```bash
HHJA_LIMIT=1 HHJA_MAX_PROCESSED=1 HHJA_CHROMIUM_RUN_MS=60000 npm run start:hh:chromium
```

This opens an hh.ru search page with `hhjaAutoStart=live`, loads the current
worktree extension from disk, waits for the configured run window, and closes
the browser unless `HHJA_CHROMIUM_KEEP_OPEN=1` is set. `HHJA_LIMIT` still means
successful applications; `HHJA_MAX_PROCESSED` is a test harness guard that stops
after the requested number of handled vacancies, including skipped vacancies.
Set `HHJA_OUTPUT=run-logs/file.json` to save the fresh `runState` and recent
result statuses captured from extension storage before the browser closes.

Popup-equivalent actions through the dedicated Chromium profile:

```bash
HHJA_ACTION=TEST_GROQ npm run run:hh:chromium
HHJA_ACTION=REFRESH_RESUMES_NOW npm run run:hh:chromium
HHJA_ACTION=START_CHAT_ASSIST npm run run:hh:chromium
```

Use `HHJA_OUTPUT=run-logs/file.json` to save fresh storage evidence. Resume
refresh discovers a resume link from the authenticated hh.ru page when
`resumeUrl` is not configured.

Developer reload helper after the next manual reload:

```bash
node scripts/reload-extension.mjs
```

This opens `https://hh.ru/?hhjaReloadExtension=1` in the configured Chrome
profile. The installed extension catches that URL trigger and calls
`chrome.runtime.reload()`. If the installed extension is older than `0.1.36`,
reload it once manually on `chrome://extensions` first.

### Setup

1. Click the extension icon.
2. Paste a `Groq API key` if you need letters and question answers.
3. Click `Save key`, then `Test Groq`.
4. Open `Настройки`.
5. Select `Groq model`. The default is `llama-3.3-70b-versatile`.
6. Set `Resume URL on hh.ru`: a link like `https://hh.ru/resume/...`.
7. Check the apply limit, delays, and expected salary for questions.
8. Check `Chat assistant`: defaults are `Process unread chats only`, `Draft only`, and limit `10`.
9. Click `Save`.

You can create a Groq key in [Groq Console](https://console.groq.com/docs/quickstart).

### Use

1. Sign in to [hh.ru](https://hh.ru) in Chrome.
2. First configure the extension through `Настройки`.
3. Open a vacancies page.
4. Click `Предпросмотр`.
5. If the preview looks right, click `Запустить отклики`.
6. Click `Стоп` to stop.
7. Click `Обновить резюме` to manually refresh your resume.
8. Click `Обработка чатов` to process chats. The extension opens `https://hh.ru/chat`, processes visible chats up to the configured limit, and in `Draft only` mode only fills a draft reply.
9. Review saved chat reports in the popup `Chat reports` section. Every report includes a direct chat link.

### Important

- The extension does not store your hh.ru login or password. If it cannot detect
  an authenticated hh.ru account, preview, auto-apply, and chat processing do
  not start.
- If captcha or login appears, stop the extension and complete it manually.
- Without a Groq key, normal applications work, but complex letters, questions, and tests may be skipped.
- Do not publish your Groq key in GitHub, chats, screenshots, or logs.
- If an employer asks to call or move to Telegram, WhatsApp, email, or another external channel, the extension saves a report and skips the reply.
- Chat `Auto-send` sends generated text without manual review. Use only when you accept that risk.

## Developer Checks

```bash
npm test
```

Isolated unpacked-extension smoke test:

```bash
npm run test:extension
```

Authorized Chromium-profile hh.ru smoke test:

```bash
npm run test:hh:chromium
```

Live authorized hh.ru smoke test:

```bash
npm run test:hh
```

`test:extension` launches a temporary profile and does not touch the normal
Chrome profile. `test:hh:chromium` launches a dedicated persistent profile at
`.hhja-chromium-profile/`. `test:hh` requires Chrome DevTools Protocol at
`http://127.0.0.1:9222`.

## Test Checklist Template

Use `TEST_CHECKLIST_TEMPLATE.md` as the reusable QA template for post-install
testing. Before testing, copy it or create a separate test-run record from it.
Fill `Test Run Metadata` and live side-effect permissions in the copy first,
then go through the checklist and mark every relevant item as `Pass`, `Fail`,
`Blocked`, `Skipped`, or `N/A`.

Run `npm test` and `npm run test:extension` before manual checks. Run
`npm run test:hh:chromium` or `npm run test:hh` only when an authorized hh.ru
profile is available and live hh.ru side effects are explicitly allowed.
For bounded live automation evidence, use `HHJA_MAX_PROCESSED=1` with
`npm run start:hh:chromium` so no-Groq/question vacancies can end cleanly after
one handled vacancy.
