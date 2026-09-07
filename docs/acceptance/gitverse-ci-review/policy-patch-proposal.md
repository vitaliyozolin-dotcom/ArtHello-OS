# Минимальный patch proposal для coverage CI-политики

Предложение не применено к исходному репозиторию. Оно должно идти в отдельный PR до включения новой CI-поверхности.

| Место | Изменение | Проверка, которую нельзя потерять |
|---|---|---|
| `scripts/workflow-policy.mjs`: `main()` | Анализировать `.github/workflows` и существующую `.gitverse/workflows`; отсутствие optional GitVerse directory допустимо до переноса, но parse/error fail closed. В отчёт включить платформу и полный относительный путь. | Текущее поведение всех GitHub workflow сохраняется; новые нарушения GitVerse влияют на общий exit code. |
| `PR_HEAD_PATTERN`, `jobRunsOnEvent()` | Поддержать и `github`, и `gitverse` контекст; ref/head_ref и event_name. Не выполнять текстовую замену по всему исходнику workflow. | `gitverse.event.pull_request.head.sha` на self-hosted должен блокироваться так же, как GitHub вариант; неоднозначное `if` не делает job безопасным. |
| `checksOutPullRequestHead()` | Распознавать закреплённые формы используемого checkout action, включая явно заданный URL GitVerse, после подтверждения реального action source. | Смена `uses` URL не должна прятать PR-controlled ref от scanner. |
| Локальные reusable workflow | Разрешать по нормализованному пути, не только по basename, и проверять оба каталога; неизвестная локальная цель остаётся privileged/unresolved. | Нельзя спутать безопасный файл одного каталога и одноимённый privileged файл другого; циклы должны завершаться детерминированно. |
| `proof-gates.yml` path filters | Добавить `.gitverse/workflows/**` и новые тестовые пути к триггерам изменения политики. | Изменение новой CI-поверхности запускает proof; старые `.github` фильтры сохраняются. |
| GitVerse pilot workflow | Отдельное имя, ручной read-only preflight, no protected Environment/no production credentials/no shared production socket. | Не имитирует `verify-v52`, не запускает deploy, не меняет branch protection и не ослабляет Ruby-проверку исходного production contract. |

Обязательные regression cases для будущего patch:

1. GitVerse PR + self-hosted → нарушение.
2. GitVerse PR-target + checkout PR-head + production Environment/SSH → нарушение.
3. Hosted PR + fixture-only environment → разрешён при отсутствии production capability; сам Docker-build статус не доказывает runtime gate.
4. Смешанный alias `github`/`gitverse` не меняет результат.
5. Local reusable workflow через другой каталог наследует production capability.
6. Неизвестная reusable цель и ошибка YAML не превращаются в зелёный отчёт.
7. Одноимённые workflow в двух каталогах не подменяют друг друга.
8. Все существующие GitHub workflow-policy tests сохраняют текущий результат.

Нельзя в рамках этого patch разрешить PR на self-hosted через новый label `isolated` или поле `productionCapability: false`, введённое самим PR. Изоляция должна проверяться вне недоверенного checkout; изменение действующего D-040 — отдельное архитектурное решение.
