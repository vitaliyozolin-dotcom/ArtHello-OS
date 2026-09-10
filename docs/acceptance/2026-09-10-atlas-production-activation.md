# D122 — первый production-запуск дневника «Атласа»

Статус: кандидат, не принят.

Первые protected runs остановились до container/Caddy mutation. D126 доказал cross-daemon image-ID rewrite; D127 run `34526464994/103037110088` прошёл portable archive/source/tree provenance и выявил отсутствующий обязательный `0600` на локальных снимках Caddy после `docker cp`. D128 выставляет режим до защитного parse; остальные ворота неизменны.

## Наблюдённый baseline

- Read-only inventory runs: `34517280798/103005739539`, `34518569941/103010096941`.
- Один живой central: container `9909bd54d31244627477bd60c3b8e7cc6cd84758902943e54eb555206c4a1142`, accepted D113 source `ff8559254faaedade63a9ee7567a45686d08c13a`, image `sha256:34402014063a05c81754716f46b3f9059297f1d21d37da7e5f00b1eb8f7fdd46`.
- Central и School health прошли на gateway.
- `ATLAS_PUBLIC_ORIGIN`, Atlas secret mount, Atlas container, data/backup volumes и Atlas Caddy route отсутствуют.
- `/api/atlas-sso/open` не выдаёт требуемый `303` на Atlas.

## Контракт изменения

1. Собрать exact Atlas source `987abd5951dc4832e2c071d8744051c518bae42e`, tree `1dccbd1fea14838bde0319014f7509b572b06061`, вне production и проверить пустую institution-bound БД.
2. Проверить exact current main, owner, successful Quality, protected environment, central identity/runtime, Caddy и School.
3. Создать отдельные Atlas secret/pepper как файлы; не выводить значения и не записывать shared secret в Docker configuration.
4. Поднять Atlas с отдельными data/backup volumes и сделать первый online-consistent backup до публичного трафика.
5. Остановить точный старый central и поднять тот же принятый image на том же data/backup/bank context с прежним runtime и Atlas file binding/origin.
6. Одним compare-and-swap Caddy route file переключить central и добавить Atlas. Проверить central, School, Atlas и точный 303 redirect.
7. При ошибке до принятия восстановить исходный route и старый central. После успеха сохранить predecessor остановленным для отдельной rollback-приёмки.

## Не входит

- DNS бренда `diary.atlas.arthelloteam.ru`;
- назначение прав сотрудникам;
- загрузка семей, классов, расписания или КТП;
- natural browser, реальный вход и mobile acceptance;
- изменение финансовых данных или School `1–11`.

## Ворота принятия

- exact-head PR Quality, Proof, v52/R14/Atlas jobs — success;
- squash merge с prefix `D122: guarded Atlas activation`;
- protected deploy receipt с `centralHealth=true`, `schoolHealth=true`, `atlasHealth=true`, `centralSsoOpen=true`;
- отдельная natural browser/login/mobile приёмка перед выдачей прав реальным людям.
