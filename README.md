# HH Job Assistant

## Русский

HH Job Assistant — расширение для Google Chrome, которое помогает откликаться на вакансии на hh.ru из уже авторизованного аккаунта.

Что умеет:

- видеть вакансии на открытой странице hh.ru;
- отправлять обычные отклики до заданного лимита;
- писать короткие сопроводительные письма через Groq;
- обновлять резюме вручную или по расписанию, пока Chrome открыт;
- показывать подсказки по тестам через Groq и нажимать финальную отправку теста.

### Что такое Groq

Groq — это внешний сервис с нейросетями. Здесь он нужен для писем и подсказок по тестам.

Ключ Groq берется по официальной инструкции: [Groq Quickstart](https://console.groq.com/docs/quickstart).

После получения ключа вставьте его в `Настройки` расширения в поле `Groq API key`.

### Как скачать

1. Откройте страницу проекта на GitHub.
2. Нажмите зеленую кнопку `Code`.
3. Нажмите `Download ZIP`.
4. Дождитесь скачивания ZIP-файла.
5. Распакуйте ZIP в обычную папку.
6. Не удаляйте эту папку. Chrome будет запускать расширение прямо из нее.

Важно: устанавливать надо распакованную папку, не ZIP-файл.

### Как установить в Chrome

1. Откройте Chrome.
2. В адресной строке напишите `chrome://extensions` и нажмите Enter.
3. Справа сверху включите `Developer mode` / `Режим разработчика`.
4. Нажмите `Load unpacked` / `Загрузить распакованное расширение`.
5. Выберите распакованную папку `hh-job-assistant`.
6. Убедитесь, что внутри выбранной папки есть файл `manifest.json`.

Пример, где находятся `Developer mode` и `Load unpacked`:

![Chrome Developer mode and Load unpacked](https://developer.chrome.com/static/docs/extensions/get-started/tutorial/hello-world/image/extensions-page-e0d64d89a6acf.png)

Источник картинки: [Chrome for Developers](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked).

После установки нажмите на значок пазла в Chrome и закрепите HH Job Assistant на панели.

### Настройка

Откройте `Настройки` расширения.

Заполните:

- `Groq API key` — ключ из [Groq Quickstart](https://console.groq.com/docs/quickstart);
- `Groq model` — модель, по умолчанию `llama-3.3-70b-versatile`;
- `Resume text` — краткий текст резюме;
- `Cover-letter prompt` — инструкция для сопроводительного письма;
- `Daily apply limit` — лимит откликов;
- `Delay min/max` — пауза между действиями;
- `Enable daily resume refresh` — обновлять резюме ежедневно, пока Chrome открыт.

Нажмите `Save`. Если указали Groq key, нажмите `Test Groq`.

### Как пользоваться

1. Войдите в аккаунт на [hh.ru](https://hh.ru).
2. Откройте страницу с вакансиями.
3. Нажмите на иконку HH Job Assistant.
4. Если нужно большое окно, нажмите `Открыть окном`.
5. Перед первым запуском на новой странице нажмите `Предпросмотр`.
6. Если вакансии найдены корректно, нажмите `Запустить отклики`.
7. Чтобы остановить работу, нажмите `Стоп`.

Кнопки:

- `Предпросмотр` — проверяет страницу и ничего не отправляет.
- `Запустить отклики` — запускает отклики до лимита.
- `Стоп` — останавливает работу.
- `Обновить резюме` — обновляет резюме вручную.
- `Открыть окном` — открывает расширение отдельным окном.
- `Настройки` — открывает настройки.

### Что будет без Groq key

- Обычные отклики без письма работают.
- Вакансии с обязательным письмом пропускаются.
- Вакансии с тестом пропускаются.

### Важно

- Расширение не хранит логин и пароль от hh.ru.
- Нужно заранее войти в hh.ru в Chrome.
- Если появилась капча или страница входа, остановите расширение и пройдите проверку вручную.
- Не публикуйте Groq key в GitHub, чатах, скриншотах или логах.

---

## English

HH Job Assistant is a Google Chrome extension that helps apply to hh.ru vacancies from an already signed-in applicant account.

What it does:

- detects vacancies on the currently open hh.ru page;
- submits normal applications up to a configured limit;
- writes short cover letters through Groq;
- refreshes resumes manually or on schedule while Chrome is open;
- shows Groq hints for tests and presses the final test submit button.

### What is Groq

Groq is an external AI service. This extension uses it for cover letters and test hints.

Create a Groq key using the official guide: [Groq Quickstart](https://console.groq.com/docs/quickstart).

After creating the key, paste it into extension `Настройки` under `Groq API key`.

### How to Download

1. Open the project page on GitHub.
2. Click the green `Code` button.
3. Click `Download ZIP`.
4. Wait for the ZIP file to download.
5. Unzip it into a normal folder.
6. Do not delete this folder. Chrome runs the extension directly from it.

Important: install the unzipped folder, not the ZIP file.

### How to Install in Chrome

1. Open Chrome.
2. Type `chrome://extensions` in the address bar and press Enter.
3. Turn on `Developer mode` in the top-right corner.
4. Click `Load unpacked`.
5. Select the unzipped `hh-job-assistant` folder.
6. Make sure the selected folder contains `manifest.json`.

Example showing `Developer mode` and `Load unpacked`:

![Chrome Developer mode and Load unpacked](https://developer.chrome.com/static/docs/extensions/get-started/tutorial/hello-world/image/extensions-page-e0d64d89a6acf.png)

Image source: [Chrome for Developers](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked).

After installation, click the puzzle icon in Chrome and pin HH Job Assistant to the toolbar.

### Configure

Open extension `Настройки`.

Set:

- `Groq API key` — key from [Groq Quickstart](https://console.groq.com/docs/quickstart);
- `Groq model` — default `llama-3.3-70b-versatile`;
- `Resume text` — short resume text;
- `Cover-letter prompt` — cover-letter instruction;
- `Daily apply limit` — application limit;
- `Delay min/max` — delay between actions;
- `Enable daily resume refresh` — refresh resumes daily while Chrome is open.

Click `Save`. If you added a Groq key, click `Test Groq`.

### How to Use

1. Sign in at [hh.ru](https://hh.ru).
2. Open a page with vacancies.
3. Click the HH Job Assistant icon.
4. Click `Открыть окном` if you want a larger window.
5. Before the first run on a new page, click `Предпросмотр`.
6. If vacancies are detected correctly, click `Запустить отклики`.
7. Click `Стоп` to stop.

Buttons:

- `Предпросмотр` — checks the page and submits nothing.
- `Запустить отклики` — starts applications up to the limit.
- `Стоп` — stops the run.
- `Обновить резюме` — refreshes resumes manually.
- `Открыть окном` — opens the extension in a separate window.
- `Настройки` — opens settings.

### Without a Groq Key

- Normal applications without a cover letter work.
- Vacancies requiring a cover letter are skipped.
- Test vacancies are skipped.

### Important

- The extension does not store hh.ru login or password.
- You must be signed in to hh.ru in Chrome first.
- If captcha or login appears, stop the extension and complete the check manually.
- Do not publish the Groq key in GitHub, chats, screenshots, or logs.

---

## Developer Checks

```bash
npm test
```

Live authorized hh.ru smoke test:

```bash
npm run test:hh
```

`test:hh` requires Chrome DevTools Protocol at `http://127.0.0.1:9222`.
