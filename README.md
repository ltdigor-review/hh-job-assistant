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

- Авторизацию нужно проходить самостоятельно
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

- The extension does not store your hh.ru login or password.
- If captcha or login appears, stop the extension and complete it manually.
- Without a Groq key, normal applications work, but complex letters, questions, and tests may be skipped.
- Do not publish your Groq key in GitHub, chats, screenshots, or logs.
- If an employer asks to call or move to Telegram, WhatsApp, email, or another external channel, the extension saves a report and skips the reply.
- Chat `Auto-send` sends generated text without manual review. Use only when you accept that risk.

## Developer Checks

```bash
npm test
```

Live authorized hh.ru smoke test:

```bash
npm run test:hh
```

`test:hh` requires Chrome DevTools Protocol at `http://127.0.0.1:9222`.
