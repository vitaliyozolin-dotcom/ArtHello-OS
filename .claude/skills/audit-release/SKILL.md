---
name: audit-release
description: Проверка provenance-цепочки релиза/деплоя перед запуском — SHA/tree совпадения, чексуммы payload'ов, boundary-строки манифеста, свежесть validation run. Использовать перед любым dispatch деплой-workflow или по запросу «проверь релиз/кандидата».
---

# Аудит provenance релиза

Роль: read-only проверяющий. Ничего не деплоить, ничего не менять — только собрать доказательства и выдать вердикт.

## Входные данные

Определи проверяемый путь доставки (спроси пользователя, если неясно):
- **RU release**: `deploy-ru.yml` → prerelease `arthello-ru-<sha>` → `deploy/pull-release.sh`
- **School cutover**: `deploy-school-staff-sso-production-v3-20260831.yml` + `validate-school-staff-sso-transfer-v3.yml`
- **Sites**: `pnpm build:sites` → ручная публикация через Sites CLI

## Чек-лист проверок

### Общие (любой путь)
1. Кандидатный SHA — 40 hex, существует, является ancestor'ом `origin/main`: `git merge-base --is-ancestor <sha> origin/main`.
2. `quality.yml` на этом SHA завершился успехом; provenance-artifact `arthello-provenance-<run_id>` существует и его `head_sha`/`tree_sha` совпадают с кандидатом (`gh run list`, `gh api`).
3. `proof-gates.yml` на этом SHA зелёный.
4. Никакие изменения не попали между валидацией и деплоем: tree кандидата == tree провалидированного коммита (`git rev-parse <sha>^{tree}`).

### School cutover (chunked payloads)
5. Пересобери payload'ы локально и сверь чексуммы с константами workflow:
   ```bash
   cat .github/scripts/school-staff-sso-workflow-controller-v3.sh.gz.b64.part-* | tr -d '\r\n\t ' | base64 -d | gzip -d | sha256sum
   cat .github/scripts/school-staff-sso-production-cutover-v3.sh.gz.b64.part-* | tr -d '\r\n\t ' | base64 -d | gzip -d | sha256sum
   ```
   Сравни с `CONTROLLER_SCRIPT_SHA256` / `CUTOVER_SCRIPT_SHA256` в `deploy-...-v3-20260831.yml`.
6. Число чанков соответствует ассертам workflow (сейчас 5 и 10).
7. **Свежесть валидации**: `VALIDATION_RUN_ID` в workflow — проверь через `gh api repos/{owner}/{repo}/actions/runs/<id>`, что run имеет `conclusion == success` и его `head_sha` даёт тот же tree, что кандидат. Захардкоженный исторический run id для нового кандидата = **FAIL** (известная уязвимость R4 из REFACTORING_PLAN.md).
8. Убедись, что не существует более одного живого варианта того же cutover (v1/v2/v3 — R3): лишние = FAIL.

### RU release
9. В манифесте релиза присутствуют все 4 boundary-строки: `real_data=not_loaded`, `integrations=disabled`, `first_owner=not_created`, `dns=not_changed`.
10. Все 4 asset'а релиза на месте; `.sha256` сходится; `target_commitish` == кандидатный SHA.
11. OCI-label `org.opencontainers.image.revision` образов == кандидатный SHA (если образы доступны).

## Вердикт

Формат вывода — как у Ревизора (см. MASTER_BOOK.md):
- **PASS** — все пункты с доказательствами (команда + вывод).
- **CONDITIONAL PASS** — перечислить условия.
- **FAIL / BLOCKED** — точная причина, какой пункт, чем доказано.

Каждый пункт в отчёте цитирует команду и её вывод. Никогда не выводить «PASS» без исполненной проверки.
