# D133 — согласованность главной и возврата в двух дневниках

## Наблюдение

- Atlas production: owner SSO и роль `director` работают; первым полноэкранным блоком показан «Кабинет родителя» с текстом об отсутствии детей, а управленческий дашборд расположен ниже.
- School 1–11 production: управленческий дашборд показывается при нуле учеников, но возврата в ArtHello OS нет.

## Причина

- Atlas source `987abd5951dc4832e2c071d8744051c518bae42e` рендерит leadership parent preview отдельным `page-shell` перед основным контентом. На мобильном `page-shell` имеет минимальную высоту рабочей области.
- School production source `54242340f2d9b6a9887d69ecc03520ddf9f7982c` старше принятых коммитов возврата; исправленная двухстрочная shell-реализация находится в `1a501aa11c55a7a743fc05888d5a57190f2a5c80`.

## Кандидат

- Atlas PR438 accepted source `f856fb3bd098152bb6b02c4d0273c4c9170b130c`, tree `e63e28520670527bc12d84abcd45cd8fffe2b876`; source CI `34534445112` — SUCCESS.
- School `1a501aa11c55a7a743fc05888d5a57190f2a5c80`, tree `ff140e1c5cee91dfe685962c1c5a9e1b6d7d14f1`.
- Локально Atlas: новый navigation policy 3/3, полный Atlas suite 28/28, lint, production build и HTTP acceptance PASS.

## Production-граница

Controller не меняет центральный ArtHello runtime, grants или учебные данные. School использует существующий backup/rollback release path. Atlas volume не удаляется: после остановки создаётся постоянная SQLite-копия, проверяется integrity, новый image запускается на том же data volume, прежний контейнер остаётся rollback-кандидатом до public health.

До exact-head CI и фактических production receipts результат не объявляется опубликованным.

## Повтор D134

D133 PR439 и hosted run `34535437429` прошли. Protected run `34536320576` остановился до Atlas: School `repair-deploy.sh` потребовал отсутствующий `/srv/school-1-11/shared/.env`. Это несовпадение controller и фактической standalone-топологии, а не отказ приложения или данных. D134 сохраняет оба source pin и использует guarded standalone cutover для наблюдаемого контейнера `school-1-11`.
