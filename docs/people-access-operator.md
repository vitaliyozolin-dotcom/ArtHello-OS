# People & Access Operator

Owner-only контур связывает `employees` и `auth_users` через `auth_users.employee_id`.

## Поток

1. `GET /api/people-access/readiness` показывает активный, отсутствующий или заблокированный доступ без изменения данных.
2. `POST /api/people-access/plan` строит неизменяемый план `PROVISION`, `UPDATE` или `OFFBOARD` и возвращает `planHash`.
3. Владелец проверяет роль, scope и последствия.
4. `POST /api/people-access/apply` принимает тот же ввод, `planHash` и `confirmation=OWNER_APPROVED_APPLY`.
5. Сервер заново читает сотрудника и доступ под блокировкой. Любой drift меняет hash и отменяет применение.

## Ограничения

- агент назначает только `accountant` и `viewer`; роль `owner` неизменяема;
- `teacher`, `parent`, `administrator` пока не объявляются production auth-ролями;
- временный пароль требуется только при первичном provision, не возвращается в ответе и не попадает в audit;
- SMS/email приглашения не отправляются;
- offboarding деактивирует доступ и отзывает сессии, но не удаляет историю;
- все изменения выполняются только владельцем и фиксируются в `people_access_audit`.
