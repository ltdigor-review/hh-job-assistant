# HH Job Assistant

[Русский](#русский) | [English](#english)

Chrome extension for hh.ru. Works only in a Chrome profile where you are already signed in to hh.ru.

![Chrome Developer mode and Load unpacked](https://developer.chrome.com/static/docs/extensions/get-started/tutorial/hello-world/image/extensions-page-e0d64d89a6acf.png)

## Русский

### Что умеет

- Находит вакансии на открытой странице hh.ru.
- Показывает предпросмотр перед откликами.
- Отправляет отклики до лимита, по умолчанию `20`.
- Заполняет сопроводительные письма и вопросы через Groq.
- Может вручную обновить резюме на hh.ru.

### Установка

1. Скачайте репозиторий: `Code` -> `Download ZIP`.
2. Распакуйте ZIP в папку и не удаляйте ее.
3. Откройте в Chrome `chrome://extensions`.
4. Включите `Developer mode` / `Режим разработчика`.
5. Нажмите `Load unpacked` / `Загрузить распакованное расширение`.
6. Выберите папку, где лежит `manifest.json`.
7. Закрепите расширение через значок пазла.

После обновления файлов нажмите `Reload` у расширения на `chrome://extensions`.

### Настройка

1. Нажмите иконку расширения.
2. Вставьте `Groq API key`, если нужны письма и ответы на вопросы.
3. Нажмите `Save key`, затем `Test Groq`.
4. Откройте `Настройки`.
5. Укажите `Resume URL on hh.ru`: ссылку вида `https://hh.ru/resume/...`.
6. Проверьте лимит откликов, задержки и зарплату для вопросов.
7. Нажмите `Save`.

Groq key можно взять в [Groq Console](https://console.groq.com/docs/quickstart).

### Использование

1. Войдите в [hh.ru](https://hh.ru) в Chrome.
2. Откройте страницу с вакансиями.
3. Нажмите `Предпросмотр`.
4. Если все нормально, нажмите `Запустить отклики`.
5. Для остановки нажмите `Стоп`.
6. Для ручного поднятия резюме нажмите `Обновить резюме`.

### Важно

- Расширение не хранит логин и пароль hh.ru.
- Если появилась капча или страница входа, остановите расширение и пройдите проверку вручную.
- Без Groq key обычные отклики работают, но сложные письма, вопросы и тесты могут быть пропущены.
- Не публикуйте Groq key в GitHub, чатах, скриншотах или логах.

## English

### Features

- Finds vacancies on the current hh.ru page.
- Shows a preview before applying.
- Sends applications up to the configured limit, default `20`.
- Fills cover letters and employer questions with Groq.
- Can manually refresh your hh.ru resume.

### Install

1. Download the repository: `Code` -> `Download ZIP`.
2. Unzip it into a folder and keep that folder.
3. Open `chrome://extensions` in Chrome.
4. Enable `Developer mode`.
5. Click `Load unpacked`.
6. Select the folder containing `manifest.json`.
7. Pin the extension with the puzzle icon.

After changing files, click `Reload` for the extension on `chrome://extensions`.

### Setup

1. Click the extension icon.
2. Paste a `Groq API key` if you need letters and question answers.
3. Click `Save key`, then `Test Groq`.
4. Open `Настройки`.
5. Set `Resume URL on hh.ru`: a link like `https://hh.ru/resume/...`.
6. Check the apply limit, delays, and expected salary for questions.
7. Click `Save`.

You can create a Groq key in [Groq Console](https://console.groq.com/docs/quickstart).

### Use

1. Sign in to [hh.ru](https://hh.ru) in Chrome.
2. Open a vacancies page.
3. Click `Предпросмотр`.
4. If the preview looks right, click `Запустить отклики`.
5. Click `Стоп` to stop.
6. Click `Обновить резюме` to manually refresh your resume.

### Important

- The extension does not store your hh.ru login or password.
- If captcha or login appears, stop the extension and complete it manually.
- Without a Groq key, normal applications work, but complex letters, questions, and tests may be skipped.
- Do not publish your Groq key in GitHub, chats, screenshots, or logs.

## Developer Checks

```bash
npm test
```

Live authorized hh.ru smoke test:

```bash
npm run test:hh
```

`test:hh` requires Chrome DevTools Protocol at `http://127.0.0.1:9222`.
