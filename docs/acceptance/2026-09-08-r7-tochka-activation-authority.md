# R7: отдельный автор активации Точки

Основание кандидата: `eb47c1360fbd701876a3c49efe029194707304db`. Исторический root-writer D063 и прежние workflows не изменяются. Новый протокол применяется только к новому контейнеру приложения.

## Контракт

- Новый отдельный named volume монтируется по `/var/lib/arthello-v52-tochka-activation`. Приложение UID1000 получает только read-only mount. Backup worker не получает этот volume вообще.
- При сборке того же immutable image создаётся каталог UID1002:GID1000, mode0750, и seed `.activation-volume-v2.seed`, UID1002:GID1000, mode0440, содержимое `ARTHELLO_TOCHKA_ACTIVATION_VOLUME_V2\n`. Runtime не выполняет chown/sudo и не получает host-root mount.
- Отдельный one-shot writer использует тот же image, UID1002:GID1000, read-only rootfs, cap-drop ALL, no-new-privileges и network none. Единственный writable mount — activation volume. Consumer запускает запись только после существующих публичных проверок и durable publication boundary.
- Маркер `tochka-autosync.activation`: обычный файл UID1002:GID1000, mode0640, nlink1; строго `ARTHELLO_TOCHKA_AUTOSYNC_V2 <40 lowercase hex SHA> <64 lowercase hex nonce>\n`, не более160 байт.
- `RELEASE_SHA` сохраняется. В `TOCHKA_AUTOSYNC_ACTIVATION_ID` новый consumer передаёт свежие32 случайных байта в hex. Старый32-символьный nonce, V1 и root-owned marker не активируют новый reader.

## CLI и публикация

```text
python3 -I /opt/arthello-backup/activation-volume.py check-empty --directory /var/lib/arthello-v52-tochka-activation
python3 -I /opt/arthello-backup/activation-volume.py write --directory /var/lib/arthello-v52-tochka-activation --release-sha <SHA40> --nonce <NONCE64>
```

`check-empty` только проверяет каталог/seed/отсутствие маркера; ничего не создаёт. Результат: schemaVersion1, state `empty-verified`, executionUid1002, executionGid1000, directoryMode `0750`, markerPresent false.

`write` проверяет identity, каждый компонент фиксированного пути через O_NOFOLLOW и descriptor-relative операции, владельца/режим каталога, seed и существующие файлы. Неизвестные записи, чужие владельцы/группы, symlink/hardlink, специальные файлы и старый протокол вызывают отказ. Lock0600 с flock исключает параллельную запись. Временный файл создаётся эксклюзивно, синхронизируется, атомарно переименовывается, затем синхронизируется каталог. Повтор с теми же байтами также fsync-ит маркер и каталог: это закрывает прерывание предыдущей записи между rename и directory fsync.

Receipt `write`: schemaVersion1, state `verified`, protocol `ARTHELLO_TOCHKA_AUTOSYNC_V2`, releaseSha, activationId, executionUid1002, executionGid1000, markerMode `0640`, mode `created` / `replaced` / `verified-existing`, contentSha256, verifiedAtUtc. Ошибки содержат фиксированный код без исходных путей или секретов.

Reader проверяет каталог и файл на каждом tick: O_DIRECTORY/O_NOFOLLOW для каталога, O_NOFOLLOW/O_NONBLOCK для файла, UID/GID/mode/nlink/размер, точные байты и стабильность descriptor metadata до/после чтения. Удаление или замена маркера наблюдаются на следующем tick. Периоды timer и правила остановки не меняются.

## Проверки и ограничения локального окружения

- Python compile и Node syntax check: PASS.
- Portable Python filesystem/atomicity model: 6/6 PASS. В этом явно обозначенном тестовом адаптере UID/GID заменены текущей локальной identity; это не доказательство реальных прав UID1002.
- Portable Node descriptor/protocol checks: 7/7 PASS; шесть настоящих UID fixtures локально пропущены только при явном `ARTHELLO_ACTIVATION_MODEL_ONLY=1`.
- Локальный uid_map/gid_map содержит только ID0 с range1. Поэтому реальные chown1002/setuid1002 здесь возвращают EINVAL. Эскалация прав не запрашивалась, runtime-проверки не ослаблялись.
- Обязательная hosted-проверка: 14 реальных Python authority/atomicity fixtures плюс6 portable fixtures в отдельном тестовом контейнере. `ARTHELLO_ACTIVATION_REQUIRE_REAL_IDS=1` запрещает выдавать пропуск этих тестов за успех.
- Hosted Docker acceptance отдельно проверяет image copy-up seed, writer UID1002, app UID1000 с RO mount и отсутствие activation mount у backup worker. До этих результатов реальная контейнерная схема не считается проверенной.

Для Python hosted unit container требуются только тестовые CHOWN/FOWNER/DAC_OVERRIDE/SETUID/SETGID: root создаёт временные fixtures, затем дочерние процессы сбрасывают группы и переходят на реальные UID/GID. Ни application DB, ни activation named volume туда не монтируются; только файл тестов read-only, image и private `/tmp`. Эти capabilities не добавляются ни приложению, ни production writer.

При внезапном завершении writer до rename может остаться временный файл. Следующая запись откажет на неизвестной записи; автоматического удаления или присвоения чужого состояния нет. При ошибке после публикации применяются существующие правила сохранения новых данных, а не восстановление старой БД поверх новых записей.

Аудит старых D063–D068 contracts не обнаружил чтения текущего timer: они проверяют исторические workflow/writer. Меняется только текущий тестовый ratchet V1/root/32hex → V2/UID1002:GID1000/64hex. Сценарии чтения выписок, интеграционные ключи и финансовые данные этой задачей не изменялись.
