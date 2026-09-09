# Архив GitHub Actions workflow — 2026-09-09

Исходный commit: `6ce3d34188cec72f83777e2bad0b1a6574a9399a`.

Первый cleanup-блок Фазы 6 удаляет из активной директории завершённые
одноразовые production hotfix, recovery R2–R11 и ранние School diagnostics.
GitHub сохраняет историю запусков независимо от удаления YAML. Исходники
восстанавливаются из указанного commit или по blob SHA ниже.

Доступа к GitHub Actions API в рабочей среде нет, поэтому run URL не
переписываются из интерфейса и не объявляются проверенными. Фактическая
история решений и известных run ID остаётся в `DECISIONS.md`, а GitHub run
logs — в Actions. Текущие R12/R13 и постоянные проверки этим блоком не
затронуты.

| Blob SHA | Путь |
|---|---|
| `46ce4c5ed22c88a692f565e91dc8112e400bdff6` | `.github/workflows/d060-tochka-production-hotfix-v2.yml` |
| `1d8eb70e79afe0e0f7ceec9c946dde0753944b6e` | `.github/workflows/d060-tochka-production-hotfix.yml` |
| `342b59acc066df9daf957b94df292ecfba0418a2` | `.github/workflows/d061-auth-production-diagnostic.yml` |
| `830f075873f852e1571eb4119f5094b474b99565` | `.github/workflows/d062-recovery-candidate-inventory.yml` |
| `7e2aa6638cbec3d7ebeae23a35df237c2b9c80f4` | `.github/workflows/d063-restore-production-auth.yml` |
| `f08e14eb80c65e2d9a5b35d3074aba5cc98f87e9` | `.github/workflows/d064-tochka-multi-company-production.yml` |
| `6aeeb591fd723625aee71cf00672308d2e820869` | `.github/workflows/d065-tochka-statement-production.yml` |
| `424a35e21e94d673c0d764ad6115f1949c620ccc` | `.github/workflows/d066-tochka-finance-production.yml` |
| `eb9b41e5828adfd56fc1c2508033f1cdabe346a0` | `.github/workflows/d067-safe-json-production.yml` |
| `a77925911d5caaf8b1b9d76428e8bf7801db79ab` | `.github/workflows/d069-finance-allocation-production.yml` |
| `2ad2af7513b70c9153dbaca54219f0b1707902f3` | `.github/workflows/d069-tochka-statements-production.yml` |
| `effbcc02f4b1cab480a67423f39ccd84bb36fabe` | `.github/workflows/deploy-arthello-recovery-20260908.yml` |
| `a1169dda7c10919f5a89c6570530562db02da470` | `.github/workflows/deploy-arthello-recovery-r2-20260908.yml` |
| `b3aedfd751d24da22251e1ef003a5060616000af` | `.github/workflows/deploy-arthello-recovery-r3-20260908.yml` |
| `75f899a366fb6f4e41190034a1c4d2d643609877` | `.github/workflows/deploy-arthello-recovery-r4-20260908.yml` |
| `5895032150c41c35a3f59375d1a1c281e7480bf0` | `.github/workflows/deploy-arthello-recovery-r5-20260908.yml` |
| `d641fc9a8310bcc8a308efb7366420ea877c3821` | `.github/workflows/deploy-arthello-recovery-r6-20260908.yml` |
| `28f13d922a6238743cc0590c29fd67453f8c22ae` | `.github/workflows/deploy-arthello-recovery-r7-20260908.yml` |
| `7cdd07e189b0c29cb740f43105073cddf09cf00f` | `.github/workflows/deploy-arthello-recovery-r8-20260908.yml` |
| `1b95206ff4ca86c3b2f070c63379525d4c3cf643` | `.github/workflows/deploy-arthello-recovery-r9-20260909.yml` |
| `6bceb35e6c1c051ced46b7f8ae1b01b5b3ae4a17` | `.github/workflows/deploy-arthello-recovery-r10-20260909.yml` |
| `8581398cf32f337e4a3e172bfc6818d4e95f95b5` | `.github/workflows/deploy-arthello-recovery-r11-20260909.yml` |
| `973c563ed8a41c88b4126c075b7bafa4a1ff1c88` | `.github/workflows/school-r3-bootstrap-diagnostic-20260908.yml` |
| `e43a931c2e890b9e27e14bf75e399e28ef52618b` | `.github/workflows/school-r4-fingerprint-diagnostic-20260908.yml` |

Восстановление отдельного файла:

```bash
git show 6ce3d34188cec72f83777e2bad0b1a6574a9399a:.github/workflows/<file>.yml
```
