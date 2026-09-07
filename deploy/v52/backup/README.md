# Резервные копии ArtHello v52

Это host-пакет для действующего Miniflare/D1 SQLite runtime. Он не использует
legacy PostgreSQL `deploy/backup.sh`, не добавляет Docker socket в приложение
и не меняет deployment gates.

## Поведение

- Ручной запуск и ежедневный запуск используют один `oneshot` service.
- Ежедневное время по умолчанию — 00:15 UTC (03:15 Москва). `Persistent=true`
  выполняет пропущенный запуск после включения сервера.
- SQLite Online Backup API читает точный файл активной БД через `mode=ro`, с
  учётом WAL. `immutable=1`, горячее `cp`, остановка приложения и запись в
  source DB не используются. В systemd весь filesystem, включая исходную БД,
  доступен только для чтения, кроме каталога копий и private temporary storage.
- Каждый запуск создаёт временный каталог, проверяет `integrity_check`, затем
  восстанавливает отдельную SQLite БД через backup API и сверяет таблицы,
  количество записей и SHA-256 логического содержимого. Пробная БД удаляется.
- Только после успешного восстановления каталог атомарно переименовывается.
  Файл БД и manifest синхронизируются на диск. Manifest содержит checksum,
  время, объём, количество строк и длительность проверки, но не данные строк.
- Каталоги имеют режим 0700, файлы 0600. `flock` исключает параллельные
  ручной и автоматический запуски. Общий лимит запуска — 15 минут.
- Срок хранения — 14 дней, как в существующем `deploy/backup.sh`. Удаление
  старых завершённых копий происходит только после успешной новой копии;
  произвольные файлы и незавершённые каталоги не удаляются.
- При ошибке service завершается неуспешно и пишет безопасный статус в journal.
  Статус `verified` относится к SQLite restore drill, а не к запуску приложения.

## Установка на production-host

Предварительно нужны Python 3.9+ с SQLite 3.22+ и systemd. Файл БД следует
получить из принятого production inventory для активного volume
`arthello-direct-v44-data`. Нельзя выбирать первый найденный `*.sqlite`:
в volume могут оставаться другие базы. Передавать нужно реальный абсолютный
host-путь без symlink, а не путь `/data/d1` внутри контейнера.

Установка производится из проверенного неизменяемого release-пакета обычным
защищённым deployment-процессом, с существующими gates. Команда оператора:

```sh
sudo bash deploy/v52/backup/install.sh /absolute/host/path/to/active-arthello.sqlite
```

Установщик проверяет source и units, размещает код в
`/usr/local/lib/arthello-v52-backup`, закрытый config в
`/etc/arthello-v52-backup.json`, копии в `/var/backups/arthello-v52`.
Расписание включается только после первой успешной копии с restore drill.
Если live WAL не допускает read-only доступ, первая копия останавливается с
ошибкой: нельзя обходить это через `immutable=1` или ослабление read-only mount.

## Ручная копия и контроль расписания

```sh
sudo systemctl start arthello-v52-backup.service
sudo systemctl status arthello-v52-backup.service
sudo systemctl list-timers --all arthello-v52-backup.timer
sudo journalctl -u arthello-v52-backup.service --since yesterday --no-pager
```

Последний успешный запуск должен возвращать `status=verified`, а timer —
следующее время запуска. Факт установленного timer не доказывает, что следующая
суточная копия завершилась: после неё проверяются journal и новый manifest.
Для временного отключения расписания: `systemctl disable --now
arthello-v52-backup.timer`. Это не удаляет существующие копии.

Повторная проверка конкретной копии, с восстановлением во временную отдельную
БД, без обращения к live source:

```sh
sudo python3 /usr/local/lib/arthello-v52-backup/backup.py --verify /var/backups/arthello-v52/arthello-v52-YYYYMMDDTHHMMSSZ-ID
```

## Восстановление и границы

Пакет намеренно не содержит команды автоматического восстановления в live:
сначала выполняется отдельный recovery-процесс на остановленном целевом
контуре и проверка приложения с восстановленными данными. Нельзя заменять
live SQLite-файл, пока контейнер работает, или смешивать snapshot с прежними
`-wal`/`-shm` файлами.

Копируется одна активная D1 БД. Runtime secrets, включая master key шифрования
сохранённых credentials, должны восстанавливаться из существующего защищённого
хранилища deployment secrets; этот пакет их не экспортирует. Образы приложения,
документы во внешнем storage, другие D1 bindings и School имеют отдельные
процедуры. Локальная копия на том же VPS не защищает от потери VPS: перенос в
отдельное утверждённое хранилище этим пакетом не реализован.

Кнопка owner UI и уведомления о неуспешной суточной копии пока не реализованы.
Для UI сначала требуется ограниченный backend→host bridge без Docker socket
и проверка owner permissions; этот пакет не выдаёт пользователям shell-доступ.

## Выполненная проверка кандидата

На временных fixture-БД выполнены 10 behavioral tests: committed WAL,
исключение незакоммиченной транзакции, восстановление при удалённой исходной
БД, одновременные переводы между счетами, запрет source write, общий lock,
corrupt source, retention 14 дней, изменение сохранённой копии, закрытые права,
symlink, выбор посторонней SQLite БД и полный операторский CLI. Все прошли.

```sh
python3 deploy/v52/backup/test_backup.py
bash -n deploy/v52/backup/install.sh
python3 -m py_compile deploy/v52/backup/backup.py deploy/v52/backup/test_backup.py
systemd-analyze verify deploy/v52/backup/arthello-v52-backup.service deploy/v52/backup/arthello-v52-backup.timer
systemd-analyze calendar '*-*-* 00:15:00 UTC'
```

Фактическая установка service, read-only WAL в namespace production systemd,
суточный запуск, runtime restore приложения и измерение production RPO/RTO
пока не выполнены. Fixture restore time не является production RTO.

Технические основания: [SQLite Online Backup API](https://www.sqlite.org/backup.html),
[Python sqlite3.Connection.backup](https://docs.python.org/3/library/sqlite3.html#sqlite3.Connection.backup).
