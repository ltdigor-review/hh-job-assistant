# HH Job Assistant

HH Job Assistant - Chrome-расширение для кандидатов, которые активно ищут работу на hh.ru и хотят быстрее проходить рутинные шаги отклика.

Приложение нужно, чтобы сократить время между поиском подходящей вакансии и готовым откликом: оно помогает отправлять отклики, готовить ответы для форм работодателей и поддерживать актуальность резюме.

## Зачем нужно приложение

- Быстрее обрабатывать длинные списки вакансий.
- Меньше времени тратить на повторяющиеся сопроводительные письма и вопросы работодателей.
- Не терять подходящие вакансии из-за сложных форм отклика.
- Поддерживать резюме в актуальном состоянии.
- Видеть результат каждого действия: что отправлено, что пропущено и где нужен ручной разбор.

## Фичи

- Запуск откликов со страницы поиска вакансий hh.ru.
- Автоматическая подготовка сопроводительных писем.
- Подготовка ответов на вопросы работодателей в формах отклика.
- Поддержка сложных форм с текстовыми полями и вариантами выбора.
- Поднятие резюме на hh.ru.
- Отображение текущего статуса, счетчиков и последних результатов.
- Остановка активного процесса в любой момент.
- Пометка вакансий, которые требуют ручного внимания.

## Как скрыть резюме от компании

Чтобы резюме не появлялось в выдаче у конкретной компании, найдите эту компанию в списке вакансий и нажмите на иконку глаза справа от карточки вакансии.

![Иконка глаза для скрытия резюме от компании](assets/hh-hide-resume-company-eye.png)

## Как установить

1. Скачайте репозиторий ZIP-архивом или клонируйте его.
2. Откройте в Chrome страницу `chrome://extensions`.
3. Включите `Режим разработчика`.
4. Нажмите `Загрузить распакованное расширение`.
5. Выберите папку проекта, где лежит `manifest.json`.
6. Закрепите расширение на панели Chrome.
7. Войдите в hh.ru в том же профиле Chrome.
8. Откройте страницу поиска вакансий hh.ru и запустите нужное действие из расширения.

## Как снять логи для разбора бага

1. В настройках расширения включите диагностические логи.
2. Повторите баг.
3. Закройте Chrome, чтобы хранилище расширения точно записалось на диск.
4. Заархивируйте папку хранилища расширения и отправьте архив разработчику.

Расширение хранит логи в профиле Chrome, в папке `Local Extension Settings/ohcopjcjekbfmlplembcbjocilnginmj`.

Команда для Windows PowerShell, если используется профиль Chrome `Default`:

```powershell
Compress-Archive -Path "$env:LOCALAPPDATA\Google\Chrome\User Data\Default\Local Extension Settings\ohcopjcjekbfmlplembcbjocilnginmj" -DestinationPath "$env:USERPROFILE\Desktop\hhja-extension-log.zip" -Force
```

Команда для Windows PowerShell, если используется профиль Chrome `Profile 1`:

```powershell
Compress-Archive -Path "$env:LOCALAPPDATA\Google\Chrome\User Data\Profile 1\Local Extension Settings\ohcopjcjekbfmlplembcbjocilnginmj" -DestinationPath "$env:USERPROFILE\Desktop\hhja-extension-log.zip" -Force
```

После выполнения команды архив будет лежать на рабочем столе:

```text
hhja-extension-log.zip
```

Если неизвестно, какой профиль используется, откройте `chrome://version` и посмотрите строку `Profile Path`. К пути из `Profile Path` нужно добавить:

```text
\Local Extension Settings\ohcopjcjekbfmlplembcbjocilnginmj
```

Команда для macOS, если используется профиль Chrome `Profile 1`:

```bash
zip -r "$HOME/Desktop/hhja-extension-log.zip" "$HOME/Library/Application Support/Google/Chrome/Profile 1/Local Extension Settings/ohcopjcjekbfmlplembcbjocilnginmj"
```

Для локального разбора архива используйте встроенный инструмент разбора логов из репозитория.

## Если Groq и hh.ru конфликтуют с VPN

Если Groq не работает без VPN, а hh.ru не работает с VPN, настройте раздельное туннелирование: Groq пускайте через VPN, hh.ru и российские домены - напрямую.

Самый простой вариант:

1. Установите [Clash Verge Rev](https://github.com/clash-verge-rev/clash-verge-rev).
2. Импортируйте свой VPN-профиль или подписку.
3. Включите режим `Rule`.
4. Добавьте правила `DIRECT` для hh.ru перед финальным `MATCH`.
5. Используйте готовые rule-set'ы из [legiz-ru/mihomo-rule-sets](https://github.com/legiz-ru/mihomo-rule-sets), если нужно направлять все российские домены, IP и приложения напрямую.

Анонимизированный пример фрагмента конфигурации:

```yaml
mode: rule

proxy-providers:
  my-vpn:
    type: http
    url: "https://vpn-provider.example/subscription"
    path: ./proxy-providers/my-vpn.yaml
    interval: 86400
    health-check:
      enable: true
      interval: 600
      url: https://www.gstatic.com/generate_204

proxy-groups:
  - name: VPN
    type: select
    use:
      - my-vpn
    proxies:
      - DIRECT

rule-providers:
  ru-app-list:
    type: http
    behavior: classical
    format: yaml
    url: https://github.com/legiz-ru/mihomo-rule-sets/raw/main/other/ru-app-list.yaml
    path: ./rule-sets/ru-app-list.yaml
    interval: 86400

rules:
  # hh.ru напрямую, чтобы сайт не ломался из-за VPN
  - DOMAIN-SUFFIX,hh.ru,DIRECT
  - DOMAIN-SUFFIX,hhcdn.ru,DIRECT

  # Российские приложения напрямую
  - RULE-SET,ru-app-list,DIRECT

  # Остальное через VPN, включая Groq
  - MATCH,VPN
```

Если в вашей основной конфигурации уже объявлены `geosite-ru` и `geoip-ru`, добавьте их отдельными правилами перед `ru-app-list`. В коротком примере выше используются только явно объявленные правила.
