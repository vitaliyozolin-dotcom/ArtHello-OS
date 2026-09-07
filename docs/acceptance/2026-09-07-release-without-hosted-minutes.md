# ArtHello OS — варианты выпуска без платных GitHub-hosted минут

Дата проверки: 7 сентября 2026. Статус: исследование и рекомендация, не утверждённая миграция и не опубликованный релиз.

## Подтверждённое препятствие

Владелец предоставил скриншоты GitHub Billing: Actions 2000/2000 минут, storage 0,5/0,5 ГБ, billable usage $0; $12,13 использования покрыто included usage. Основная доля показанного расхода — ArtHello-OS ($11,78). Карты, по словам владельца, из Казахстана и Сингапура отклоняются. Причина конкретного отказа платёжного процессора не установлена. Реквизиты карт в документы/репозиторий не переносились.

GitHub для исходников и PR доступен. Актуальный main проверен: 9e4c49161e643997fe821a91b84c60c6e38ede33. Прикладная работа и выпуск остаются разными незавершёнными частями задачи; предыдущие 507 локальных тестов не означают готовность всех шести пунктов.

## Варианты

| Вариант | Подтверждено | Ограничения и вывод |
| --- | --- | --- |
| GitHub + отдельный self-hosted builder | GitHub не тарифицирует минуты собственного runner; текущие source/PR и интеграция Codex сохраняются | Рекомендуемый первый путь. Нужны отдельная изолированная Linux-машина, Docker, исходящий HTTPS, штатная регистрация runner и другой проверяемый контракт provenance. Решить также хранение артефактов. Production-машины для выполнения PR не использовать. |
| GitVerse | Free: приватные репозитории, 2000 минут CI/CD, 1 ГБ для пакетов/артефактов/релизов; Pro на странице 399 ₽/польз./мес при оплате за год, 5000 минут | Российская альтернатива. Не объявлять мгновенной миграцией: Docker на cloud runner предлагается через kaniko, CI недоступен для mirror-репозитория, GitHub-specific API/provenance/защиты/секреты требуют адаптации. Текущего подключённого GitVerse-аккаунта/API-доступа нет. |
| GitLab.com | Free namespace: 400 compute minutes/month | Перенос ради бесплатных минут невыгоден относительно уже исчерпанных 2000; нужны адаптация CI и доступы. |
| Forgejo / GitLab на своей инфраструктуре | Forgejo поддерживает репозитории и Actions; совместимость с GitHub не полная | Стратегический вариант независимости, но обслуживание ещё одного сервиса и перенос процесса увеличат объём работы перед ближайшим выпуском. |
| Второй бесплатный личный GitHub | ToS §B.3 ограничивает человека/юрлицо одним free account, отдельно допускает machine account только для автоматизации | Не предлагать второй личный аккаунт ради повторного получения квоты. |
| PayPal из России | PayPal официально приостановил услуги в РФ в марте 2022; официального возобновления в проверенных источниках не найдено | Предыдущий совет использовать/создать PayPal из России отозван. Иностранная карта сама по себе не подтверждает право на аккаунт другой страны. |

## Проверка именно нашего release-процесса

- `.github/workflows/verify-arthello-v52.yml`: сборка на GitHub-hosted runner; provenance указывает `runnerTrust: github-hosted-ephemeral`, `productionCapability: false`. Docker archive сохраняется в Actions artifacts с retention 30 дней.
- `.github/workflows/deploy-arthello-direct-38-55.yml`: runner `[self-hosted, linux, x64, arthello-gateway]`, environment `production-ru`; доставка требует hosted provenance. Workflow относится к отдельному одноразовому D-059/PR328, не является универсальной кнопкой следующего выпуска.
- `scripts/workflow-policy.mjs`: любой self-hosted трактуется как production-capable и запрещён для pull_request. Нужно явно отличить изолированный builder от production deploy runner и проверить изоляцию; подставлять старый trust marker в новую сборку нельзя.
- D-069 workflows также специальные; сроки, pins, approvals и one-shot guards не изменялись и не перевооружались.
- `.github/workflows/probe-school-production-topology.yml`: штатный read-only workflow_dispatch без календарного ограничения, self-hosted arthello-gateway, production-ru. Проверяет топологию и SQLite integrity; не заменяет сбор SSO callback logs.
- Необходимо сохранять настоящие quality/proof/verify результаты для точного SHA, manifest/checksum/digest образа и возможности rollback. Изменение исполнителя сборки не должно ослабить права к production.

## Фактически доступно в этом сеансе

Есть GitHub read/write для кода и PR и локально собранные кандидаты. Есть операции повторного запуска отдельных jobs, но нет операции произвольного workflow_dispatch или регистрации/inventory runner. Запрос runner inventory отвергнут ограничением connector endpoint. В текущем окружении нет SSH-конфигурации/SSH agent и Docker daemon/CLI; в рабочем браузере открыты только ArtHello и дневник, авторизованной панели Timeweb нет. Наличие настроенного в workflow production runner не доказывает, что он online.

## Конкретный маршрут рекомендации

1. Получить штатный доступ к отдельной сборочной машине либо инвентаризировать доступные машины через Timeweb; не покупать новый VPS без согласованного ресурса/стоимости.
2. Подготовить отдельный изолированный runner без production-ключей, банковских секретов и рабочих БД; сначала read-only smoke test с текущей квотой.
3. Проверяемым PR изменить runner classification/provenance и хранение релизов; сохранить проверки и защиты. Выбрать закрытое хранилище, доступное production по HTTPS, с immutable manifest/digest и retention для rollback.
4. Выполнить реальные проверки кандидатов, завершить оставшиеся прикладные исправления, затем штатный выпуск и браузерная приёмка.
5. Возвращаться к полной миграции GitVerse/Forgejo, если нужен полный выход из GitHub или первый путь не подтвердится на smoke test.

## Первичные источники

- GitHub self-hosted runner billing: https://docs.github.com/en/actions/concepts/runners/self-hosted-runners
- Actions usage и storage: https://docs.github.com/en/billing/concepts/product-billing/github-actions
- Регистрация runner: https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/add-runners
- GitHub ToS: https://docs.github.com/en/site-policy/github-terms/github-terms-of-service#3-account-requirements
- PayPal Russia suspension: https://newsroom.paypal-corp.com/2022-03-05-paypal-ceo-dan-schulman-message-ukraine
- PayPal country: https://www.paypal.com/us/cshelp/article/can-i-change-the-address-on-my-paypal-account-to-another-country-help210
- GitVerse тарифы: https://gitverse.ru/home/pricing/
- GitVerse CI FAQ: https://gitverse.ru/docs/cicd/faq
- GitLab compute: https://docs.gitlab.com/ci/pipelines/compute_minutes/
- Forgejo Actions: https://forgejo.org/docs/latest/user/actions/reference/

## Проверка готового диагностического маршрута

Найден предыдущий успешный запуск topology probe: [33575409573](https://github.com/vitaliyozolin-dotcom/ArtHello-OS/actions/runs/33575409573), job 100078175427, 2 сентября 2026 00:27 UTC, SHA c3182d598fd7a7a00a5388003754293219e41096. Текст workflow на этом SHA совпадает с текущим main. Подходящих failed/cancelled jobs для доступного rerun-инструмента не найдено. Проверены последние 300 общих запусков, 878 push-запусков 21 августа–3 сентября и 43 workflow_dispatch. Сам факт старого success не доказывает работоспособность runner при текущей billing-блокировке.

Конкретная безопасная проверка: открыть [Probe School production topology](https://github.com/vitaliyozolin-dotcom/ArtHello-OS/actions/workflows/probe-school-production-topology.yml), Run workflow → main; дополнительных inputs нет. Используются существующий runner и production-ru. На сервере только Docker inspect/readOnly SQLite integrity, без изменения контейнеров, данных или сервисов. Может потребоваться штатное environment approval; защита не снимается. Запуск в этом сеансе не выполнен, потому что fresh dispatch не предоставлен текущим подключением. Результат определит, доступен ли собственный runner; причиной отказа также может быть устаревший helper image, а не billing.
