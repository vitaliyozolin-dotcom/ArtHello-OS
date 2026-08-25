# ArtHello OS deployment policy

## Environments

- `develop` = integration branch. Changes here MUST NOT modify production.
- STAGING = test environment built from `develop` with isolated runtime/data.
- `main` = production release branch.
- PRODUCTION = live ArtHello OS.

## Release commands

- User command **«На тест»** means: commit current changes to `develop`, build/deploy STAGING, run automated checks, and return the staging URL. Production MUST remain unchanged.
- User command **«В прод»** means: take the exact staging-tested revision, run final checks, promote that exact revision to `main`/PRODUCTION, verify production, and rollback automatically on failure.

## Hard gates

1. No direct feature work in `main`.
2. No production deployment from `develop`.
3. STAGING and PRODUCTION must use separate application containers and separate writable data/database state.
4. Promotion must deploy the exact commit/image tested on STAGING; rebuilding a different artifact for production is forbidden.
5. Production cutover happens only after health, asset, auth and critical-route checks pass.
6. School 1–11 route must be checked before and after ArtHello production cutover.
7. Keep the previous production image/config until post-deploy verification succeeds.
8. Failed production verification triggers rollback to the previous known-good image/config.
9. Secrets and production credentials must not be copied into staging data.
10. Staging must be visibly marked TEST and must not send real SMS/email/payment actions unless explicitly enabled for a test provider/recipient.

## User acceptance

A staging version is not accepted implicitly. Only the explicit phrase **«В прод»** authorizes production promotion.
