# Архив GitHub Actions workflow — 2026-09-01

Исходный commit: `03bd9b4ba64131623f715ffe16b7ea013e869b22`
Исходный tree: `892084adc1559f78b3da59c27669f3ef49e31bce`

Cleanup удаляет из активной `.github/workflows` одноразовые candidates, датированные
cutover/diagnostics, временные export-задачи и уже выключенные production jobs. Это
чистое удаление `[DEL]`: исходники остаются восстановимыми по commit и blob SHA ниже.
GitHub Actions run logs/artifacts отдельно не скачивались: доступный MCP не предоставляет
Actions jobs/logs приватного репозитория. Известные hardcoded run IDs остаются в исходных
Git blobs и Git-истории.

Постоянно оставлены:

- `.github/workflows/quality.yml`;
- `.github/workflows/proof-gates.yml`;
- `.github/workflows/deploy-ru.yml`;
- `.github/workflows/production-data-reset.yml`;
- `.github/workflows/deploy-arthello-direct-38-55.yml`;
- `.github/workflows/deploy-arthello-v44-ru.yml`.

Последние два RU deploy требуют отдельного доказательного решения о каноничности после
сверки production release evidence. До этого cleanup их не объединяет и не меняет.

## Удалённые workflow

| Blob SHA | Путь |
|---|---|
| `a34f59eb733a09b3af1fa0277609ad5b0d2b87dc` | `.github/workflows/activate-arthello-v44-live-route.yml` |
| `07754f909d2283870ca21bd1107f940555f8c1f8` | `.github/workflows/arthello-school-sso-candidate-v2.yml` |
| `7f6a90a6f00640cf25f2a87bf1d6856325cbe8b1` | `.github/workflows/arthello-school-sso-candidate.yml` |
| `216053db3da2e45de8191f4db2f52670cb35a794` | `.github/workflows/arthello-school-sso-targeted.yml` |
| `8bf49b4a19bc066e60cc70888bda87eb0144b584` | `.github/workflows/build-arthello-v44-on-origin.yml` |
| `ee54bde295ca8dcbb600b333394ed5691f86c12d` | `.github/workflows/deploy-school-1-11.yml` |
| `224578e33cc9ca8983ba512f5a536870749752c3` | `.github/workflows/deploy-school-direct-38-55.yml` |
| `8d2c2640176db5da178edb63710f00d27a4e50c8` | `.github/workflows/deploy-school-pc-direct.yml` |
| `5c970c1146fe75f842bb2bbeffc5c89572a3cbd4` | `.github/workflows/deploy-school-staff-sso-production-20260831.yml` |
| `8f827dd186e0d14a420afe0a8ed1636ffd9f7123` | `.github/workflows/deploy-school-staff-sso-production-v2-20260831.yml` |
| `b9d9cdc6d9264f3022b290975b30aa237208b91a` | `.github/workflows/deploy-school-staff-sso-production-v3-20260831.yml` |
| `0232d8ffd83e649be15142870567a12576db5e87` | `.github/workflows/design-system-safety-baseline.yml` |
| `a69cc3a5f6327e90f1955ab251411ec8202103f5` | `.github/workflows/diagnose-arthello-origin-tls.yml` |
| `e02f30109de6350e03b74eb907055ba5a3984085` | `.github/workflows/diagnose-arthello-v44-runtime.yml` |
| `4b432cdfe7c208988cf58e2edce76d8d99c829a1` | `.github/workflows/identity-delivery-inventory.yml` |
| `d0afb6e8a88874b3b58da271cc70d62652754384` | `.github/workflows/preview-contractors-pilot.yml` |
| `c57e2a539ff2b7b3d6e115de9dbc79ddb4f33146` | `.github/workflows/repair-production-ru-lb-backend.yml` |
| `b405dd1b6ea76af227d0115e604338d1b9c383e8` | `.github/workflows/restore-arthello-origin-tls.yml` |
| `50d6a1c41b0b085e638ad6f9af60e890dcee25fc` | `.github/workflows/school-diary-auth-candidate.yml` |
| `7e9acf07fb959d936ef7fd28754e131552d39430` | `.github/workflows/school-diary-auth-run-reporter.yml` |
| `28a375d2d5e0f4e90eab8b49ea10d6b00b96bb2d` | `.github/workflows/school-diary-authorized-visual-audit.yml` |
| `1f31c89bb7f096240af7238dc21c8b2d8c569916` | `.github/workflows/school-diary-design-v1-flag-off.yml` |
| `126853ef5a45873b4aa70ab5f45710b98cf618cc` | `.github/workflows/school-diary-design-v1-post-release-smoke.yml` |
| `beeb0378b1930f3c6ccffcc56f52948fff6baba2` | `.github/workflows/school-diary-design-v1-production-cutover.yml` |
| `d1007ddb05f03c17b955dafdc11b65496a44e789` | `.github/workflows/school-diary-design-v1-production-readiness.yml` |
| `b161b9b4d82ddc621dbd097cad77396c685ccba5` | `.github/workflows/school-diary-design-v1-staging.yml` |
| `c344dce6be4fc4f2ff657aab75b7bd7e0a7b5c68` | `.github/workflows/school-diary-design-v1-visual-audit.yml` |
| `43009bd8ff21fcb7cfa6d72cf22d1731b4193839` | `.github/workflows/school-diary-four-role-regression.yml` |
| `b59c2cd5edee9c97c822712e208a1969647b9895` | `.github/workflows/school-diary-safety-baseline.yml` |
| `a10c7bc66074c48e1ef549df82da0dfd2f6ba030` | `.github/workflows/school-diary-staging.yml` |
| `8b0f6fccdea49d8dbc3d6c6be58b9bcad01fbc5d` | `.github/workflows/school-diary-writable-database-repair.yml` |
| `d1f0327e62e7db8aedff0ad83933ec129aadd21f` | `.github/workflows/school-identity-broker-candidate-v2.yml` |
| `b81af4e916cf78c76d70aa97c441ca8d9a10d4dd` | `.github/workflows/school-identity-broker-candidate.yml` |
| `047b5a3320948036e6470a63f347f097b540e8db` | `.github/workflows/self-hosted-gateway-smoke.yml` |
| `564501c95f258daf0169df879aaf1a0f46437009` | `.github/workflows/stage-ru-git-transport.yml` |
| `f999b309a393417c17f099411c4221802af2ca39` | `.github/workflows/stage-ru-offline-runtime-hotfix.yml` |
| `741f4ebca5011007941d89e6173ae3c8f63e2d55` | `.github/workflows/tmp-source-export-trigger.yml` |
| `adbbea7bb7b5874a8c8c277935cb17399fedf474` | `.github/workflows/tmp-source-export.yml` |
| `4e3d6e1f97d02acdc0a82df10ea93adf1867f417` | `.github/workflows/v52-candidate.yml` |
| `1785b7cb530ebd56b85e591c4ed48263306b4bb9` | `.github/workflows/validate-school-staff-sso-transfer-v3.yml` |
| `a1f6bdb043a2c98ad6566135c56c3e677e93bf42` | `.github/workflows/verify-school-staff-sso-live-20260831.yml` |

Восстановление отдельного файла:

```bash
git show 03bd9b4ba64131623f715ffe16b7ea013e869b22:.github/workflows/<file>.yml
```
