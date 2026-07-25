import { pool } from "@workspace/db";
import { logger } from "./logger.js";

/**
 * Idempotent startup migrations — runs ADD COLUMN IF NOT EXISTS for every
 * schema change that has been applied to the dev DB but might be missing
 * in production after a new deployment.
 *
 * Safe to call on every server start: all statements use IF NOT EXISTS.
 */
export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ── bank_statements: async pipeline columns (added 2026-05-22) ──────────
    await client.query(`
      ALTER TABLE bank_statements
        ADD COLUMN IF NOT EXISTS status          text        DEFAULT 'created',
        ADD COLUMN IF NOT EXISTS requested_at    timestamptz DEFAULT NOW(),
        ADD COLUMN IF NOT EXISTS ready_at        timestamptz,
        ADD COLUMN IF NOT EXISTS last_polled_at  timestamptz
    `);

    // ── bank_statements: deduplicate before creating unique index ────────────
    // Fallback INSERTs without a unique constraint may have created duplicate
    // rows for the same (connector_id, account_id, period_from). DELETE dupes
    // keeping the latest row before attempting CREATE UNIQUE INDEX.
    await client.query(`
      DELETE FROM bank_statements
      WHERE id NOT IN (
        SELECT DISTINCT ON (bank_connector_id, external_account_id, period_from) id
        FROM bank_statements
        WHERE bank_connector_id IS NOT NULL
          AND external_account_id IS NOT NULL
          AND period_from IS NOT NULL
        ORDER BY bank_connector_id, external_account_id, period_from, created_at DESC NULLS LAST
      )
      AND bank_connector_id IS NOT NULL
      AND external_account_id IS NOT NULL
      AND period_from IS NOT NULL
    `);

    // ── bank_statements: unique index required for ON CONFLICT upsert ────────
    // Must be a FULL index (no WHERE clause) so that Drizzle's
    // onConflictDoUpdate({ target: [col1,col2,col3] }) can resolve to it.
    // A partial index (WHERE NOT NULL) is NOT matched by ON CONFLICT (cols)
    // without an explicit predicate — causing "no unique constraint" errors.
    // Strategy: always DROP + CREATE so a stale partial index is replaced.
    await client.query(`
      DROP INDEX IF EXISTS uq_bank_statements_connector_account_period
    `);
    await client.query(`
      CREATE UNIQUE INDEX uq_bank_statements_connector_account_period
        ON bank_statements (bank_connector_id, external_account_id, period_from)
    `);

    // ── bank_sync_runs: extended counters (added 2026-05) ───────────────────
    await client.query(`
      ALTER TABLE bank_sync_runs
        ADD COLUMN IF NOT EXISTS transactions_new        integer DEFAULT 0,
        ADD COLUMN IF NOT EXISTS transactions_updated    integer DEFAULT 0,
        ADD COLUMN IF NOT EXISTS transactions_duplicates integer DEFAULT 0,
        ADD COLUMN IF NOT EXISTS balances_updated        integer DEFAULT 0,
        ADD COLUMN IF NOT EXISTS statements_requested    integer DEFAULT 0,
        ADD COLUMN IF NOT EXISTS statements_saved        integer DEFAULT 0,
        ADD COLUMN IF NOT EXISTS errors_count            integer DEFAULT 0,
        ADD COLUMN IF NOT EXISTS duration_ms             integer,
        ADD COLUMN IF NOT EXISTS error_message           text,
        ADD COLUMN IF NOT EXISTS raw                     jsonb
    `);

    // ── bank_connectors: status tracking columns ─────────────────────────────
    await client.query(`
      ALTER TABLE bank_connectors
        ADD COLUMN IF NOT EXISTS last_success_at         timestamptz,
        ADD COLUMN IF NOT EXISTS sync_frequency_minutes  integer DEFAULT 15,
        ADD COLUMN IF NOT EXISTS config                  jsonb
    `);

    // ── staff_profiles (added for ФОТ module) ────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS staff_profiles (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        teacher_crm_id  text,
        full_name       text,
        position        text,
        hire_date       date,
        ndfl_rate       numeric DEFAULT 0.13,
        pfr_rate        numeric DEFAULT 0.22,
        fss_rate        numeric DEFAULT 0.029,
        is_active       boolean DEFAULT true,
        raw             jsonb,
        created_at      timestamptz DEFAULT NOW(),
        updated_at      timestamptz DEFAULT NOW()
      )
    `);

    // ── staff_bonuses ─────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS staff_bonuses (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        teacher_crm_id  text,
        period_month    text,
        amount          numeric DEFAULT 0,
        status          text DEFAULT 'pending',
        note            text,
        created_at      timestamptz DEFAULT NOW()
      )
    `);

    // ── month_closings ────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS month_closings (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        period_month    text UNIQUE,
        status          text DEFAULT 'open',
        closed_at       timestamptz,
        closed_by       text,
        kpi_snapshot    jsonb,
        checklist       jsonb,
        notes           text,
        created_at      timestamptz DEFAULT NOW(),
        updated_at      timestamptz DEFAULT NOW()
      )
    `);

    // ── bank_transactions: match/ignore columns (added 2026-05-23) ─────────
    await client.query(`
      ALTER TABLE bank_transactions
        ADD COLUMN IF NOT EXISTS matched_contractor_id  text,
        ADD COLUMN IF NOT EXISTS matched_employee_id    text,
        ADD COLUMN IF NOT EXISTS matched_payroll_id     text,
        ADD COLUMN IF NOT EXISTS is_internal_transfer   boolean DEFAULT false,
        ADD COLUMN IF NOT EXISTS ignored_at             timestamptz,
        ADD COLUMN IF NOT EXISTS ignored_reason         text,
        ADD COLUMN IF NOT EXISTS matched_by_user_id     text,
        ADD COLUMN IF NOT EXISTS match_source           text
    `);

    // ── operations: entity FK columns (added 2026-05-23) ────────────────────
    await client.query(`
      ALTER TABLE operations
        ADD COLUMN IF NOT EXISTS child_id       text,
        ADD COLUMN IF NOT EXISTS contractor_id  text,
        ADD COLUMN IF NOT EXISTS employee_id    text,
        ADD COLUMN IF NOT EXISTS contract_id    text,
        ADD COLUMN IF NOT EXISTS branch_id      text,
        ADD COLUMN IF NOT EXISTS group_id       text
    `);

    // ── Seed DDS categories (only if empty) ──────────────────────────────────
    await client.query(`
      DO $seed$
      BEGIN
        IF (SELECT COUNT(*) FROM dds_categories) = 0 THEN
          INSERT INTO dds_categories (id, direction, group_name, category, subcategory, is_active) VALUES
            -- ПОСТУПЛЕНИЯ
            (gen_random_uuid(), 'income', 'Поступления', 'Оплата за обучение (школа)', NULL, true),
            (gen_random_uuid(), 'income', 'Поступления', 'Оплата за обучение (детский сад)', NULL, true),
            (gen_random_uuid(), 'income', 'Поступления', 'Дополнительные занятия', NULL, true),
            (gen_random_uuid(), 'income', 'Поступления', 'Питание', NULL, true),
            (gen_random_uuid(), 'income', 'Поступления', 'Онлайн-обучение', NULL, true),
            (gen_random_uuid(), 'income', 'Поступления', 'Летний лагерь', NULL, true),
            (gen_random_uuid(), 'income', 'Поступления', 'Медицинские услуги', NULL, true),
            (gen_random_uuid(), 'income', 'Поступления', 'Прочие образовательные услуги', NULL, true),
            (gen_random_uuid(), 'income', 'Прочие поступления', 'Возврат от поставщиков', NULL, true),
            (gen_random_uuid(), 'income', 'Прочие поступления', 'Прочие поступления', NULL, true),
            -- РАСХОДЫ: ФОТ
            (gen_random_uuid(), 'expense', 'Фонд оплаты труда', 'Зарплата педагогов', NULL, true),
            (gen_random_uuid(), 'expense', 'Фонд оплаты труда', 'Зарплата воспитателей', NULL, true),
            (gen_random_uuid(), 'expense', 'Фонд оплаты труда', 'Зарплата административного персонала', NULL, true),
            (gen_random_uuid(), 'expense', 'Фонд оплаты труда', 'Зарплата прочего персонала', NULL, true),
            (gen_random_uuid(), 'expense', 'Фонд оплаты труда', 'НДФЛ и страховые взносы', NULL, true),
            -- РАСХОДЫ: Аренда
            (gen_random_uuid(), 'expense', 'Аренда и коммунальные', 'Аренда помещений', NULL, true),
            (gen_random_uuid(), 'expense', 'Аренда и коммунальные', 'Коммунальные услуги', NULL, true),
            (gen_random_uuid(), 'expense', 'Аренда и коммунальные', 'Электроэнергия', NULL, true),
            -- РАСХОДЫ: Питание
            (gen_random_uuid(), 'expense', 'Питание', 'Закупка продуктов питания', NULL, true),
            (gen_random_uuid(), 'expense', 'Питание', 'Услуги питания (поставщик)', NULL, true),
            -- РАСХОДЫ: Маркетинг
            (gen_random_uuid(), 'expense', 'Маркетинг', 'Реклама и продвижение', NULL, true),
            (gen_random_uuid(), 'expense', 'Маркетинг', 'Сайт и IT-маркетинг', NULL, true),
            -- РАСХОДЫ: Налоги
            (gen_random_uuid(), 'expense', 'Налоги', 'УСН / налог на прибыль', NULL, true),
            (gen_random_uuid(), 'expense', 'Налоги', 'НДС', NULL, true),
            (gen_random_uuid(), 'expense', 'Налоги', 'Прочие налоги и взносы', NULL, true),
            -- РАСХОДЫ: Банк
            (gen_random_uuid(), 'expense', 'Банковские расходы', 'Банковские комиссии', NULL, true),
            (gen_random_uuid(), 'expense', 'Банковские расходы', 'Эквайринг', NULL, true),
            (gen_random_uuid(), 'expense', 'Банковские расходы', 'Обслуживание расчётного счёта', NULL, true),
            -- РАСХОДЫ: IT
            (gen_random_uuid(), 'expense', 'IT и связь', 'IT-сервисы и программное обеспечение', NULL, true),
            (gen_random_uuid(), 'expense', 'IT и связь', 'Связь и интернет', NULL, true),
            -- РАСХОДЫ: Операционные
            (gen_random_uuid(), 'expense', 'Операционные расходы', 'Канцтовары и расходники', NULL, true),
            (gen_random_uuid(), 'expense', 'Операционные расходы', 'Хозтовары и уборка', NULL, true),
            (gen_random_uuid(), 'expense', 'Операционные расходы', 'Транспорт и доставка', NULL, true),
            (gen_random_uuid(), 'expense', 'Операционные расходы', 'Подрядчики и внешние услуги', NULL, true),
            (gen_random_uuid(), 'expense', 'Операционные расходы', 'Обслуживание оборудования', NULL, true),
            (gen_random_uuid(), 'expense', 'Операционные расходы', 'Учебные материалы и пособия', NULL, true),
            (gen_random_uuid(), 'expense', 'Операционные расходы', 'Прочие операционные расходы', NULL, true),
            -- РАСХОДЫ: Финансовые
            (gen_random_uuid(), 'expense', 'Финансовые расходы', 'Кредиты и займы (тело)', NULL, true),
            (gen_random_uuid(), 'expense', 'Финансовые расходы', 'Проценты по кредитам', NULL, true),
            (gen_random_uuid(), 'expense', 'Финансовые расходы', 'Прочие финансовые расходы', NULL, true);
        END IF;
      END $seed$;
    `);

    // ── Seed OPIU categories (only if empty) ─────────────────────────────────
    await client.query(`
      DO $seed$
      BEGIN
        IF (SELECT COUNT(*) FROM opiu_categories) = 0 THEN
          INSERT INTO opiu_categories (id, type, group_name, category, subcategory, is_active) VALUES
            -- ВЫРУЧКА
            (gen_random_uuid(), 'revenue', 'Выручка от основной деятельности', 'Школа (обучение)', NULL, true),
            (gen_random_uuid(), 'revenue', 'Выручка от основной деятельности', 'Детский сад (дошкольное)', NULL, true),
            (gen_random_uuid(), 'revenue', 'Выручка от основной деятельности', 'Дополнительные занятия', NULL, true),
            (gen_random_uuid(), 'revenue', 'Выручка от основной деятельности', 'Онлайн-обучение', NULL, true),
            (gen_random_uuid(), 'revenue', 'Выручка от основной деятельности', 'Летний лагерь', NULL, true),
            (gen_random_uuid(), 'revenue', 'Выручка от основной деятельности', 'Питание', NULL, true),
            (gen_random_uuid(), 'revenue', 'Выручка от основной деятельности', 'Прочая выручка', NULL, true),
            -- СЕБЕСТОИМОСТЬ
            (gen_random_uuid(), 'cogs', 'Себестоимость', 'Зарплата педагогов', NULL, true),
            (gen_random_uuid(), 'cogs', 'Себестоимость', 'Зарплата воспитателей', NULL, true),
            (gen_random_uuid(), 'cogs', 'Себестоимость', 'Питание (себестоимость)', NULL, true),
            (gen_random_uuid(), 'cogs', 'Себестоимость', 'Учебные материалы', NULL, true),
            (gen_random_uuid(), 'cogs', 'Себестоимость', 'Расходы лагеря', NULL, true),
            (gen_random_uuid(), 'cogs', 'Себестоимость', 'Прочая себестоимость', NULL, true),
            -- OPEX: Коммерческие
            (gen_random_uuid(), 'opex', 'Коммерческие расходы', 'Маркетинг и реклама', NULL, true),
            (gen_random_uuid(), 'opex', 'Коммерческие расходы', 'Продажи и привлечение', NULL, true),
            -- OPEX: Административные
            (gen_random_uuid(), 'opex', 'Административные расходы', 'Зарплата административного персонала', NULL, true),
            (gen_random_uuid(), 'opex', 'Административные расходы', 'Аренда помещений', NULL, true),
            (gen_random_uuid(), 'opex', 'Административные расходы', 'Коммунальные услуги', NULL, true),
            (gen_random_uuid(), 'opex', 'Административные расходы', 'IT-сервисы и ПО', NULL, true),
            (gen_random_uuid(), 'opex', 'Административные расходы', 'Связь и интернет', NULL, true),
            (gen_random_uuid(), 'opex', 'Административные расходы', 'Хозтовары и уборка', NULL, true),
            (gen_random_uuid(), 'opex', 'Административные расходы', 'Транспорт', NULL, true),
            (gen_random_uuid(), 'opex', 'Административные расходы', 'Найм и HR', NULL, true),
            (gen_random_uuid(), 'opex', 'Административные расходы', 'Прочие административные расходы', NULL, true),
            -- OPEX: Прочие операционные
            (gen_random_uuid(), 'opex', 'Прочие операционные расходы', 'Банковские комиссии', NULL, true),
            (gen_random_uuid(), 'opex', 'Прочие операционные расходы', 'Эквайринг', NULL, true),
            (gen_random_uuid(), 'opex', 'Прочие операционные расходы', 'Подрядчики и внешние услуги', NULL, true),
            (gen_random_uuid(), 'opex', 'Прочие операционные расходы', 'Обслуживание оборудования', NULL, true),
            (gen_random_uuid(), 'opex', 'Прочие операционные расходы', 'Канцтовары', NULL, true),
            -- НАЛОГИ
            (gen_random_uuid(), 'tax', 'Налоги', 'УСН / налог на прибыль', NULL, true),
            (gen_random_uuid(), 'tax', 'Налоги', 'НДС', NULL, true),
            (gen_random_uuid(), 'tax', 'Налоги', 'НДФЛ (работодатель)', NULL, true),
            (gen_random_uuid(), 'tax', 'Налоги', 'Страховые взносы', NULL, true),
            (gen_random_uuid(), 'tax', 'Налоги', 'Прочие налоги', NULL, true),
            -- ФИНАНСОВЫЕ РАСХОДЫ
            (gen_random_uuid(), 'finance', 'Финансовые расходы', 'Проценты по кредитам', NULL, true),
            (gen_random_uuid(), 'finance', 'Финансовые расходы', 'Лизинг', NULL, true),
            (gen_random_uuid(), 'finance', 'Финансовые расходы', 'Штрафы и пени', NULL, true),
            (gen_random_uuid(), 'finance', 'Финансовые расходы', 'Прочие финансовые расходы', NULL, true);
        END IF;
      END $seed$;
    `);

    // ── P5: payable_obligations ───────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS payable_obligations (
        id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        source_type               text        NOT NULL,
        status                    text        NOT NULL DEFAULT 'draft',
        counterparty_name         text        NOT NULL,
        counterparty_id           uuid,
        document_number           text,
        document_date             date,
        due_date                  date,
        service_period_from       date,
        service_period_to         date,
        amount_total              numeric(14,2) NOT NULL,
        amount_vat                numeric(14,2),
        currency                  text        NOT NULL DEFAULT 'RUB',
        dds_article_id            uuid,
        opiu_article_id           uuid,
        related_recurring_id      uuid,
        linked_bank_transaction_id uuid,
        linked_operation_id       uuid,
        branch_id                 uuid,
        facility_id               uuid,
        legal_entity_id           uuid,
        is_recurring_candidate    boolean     DEFAULT false,
        is_intercompany           boolean     DEFAULT false,
        description               text,
        notes                     text,
        created_by                uuid,
        approved_by               uuid,
        approved_at               timestamptz,
        paid_at                   timestamptz,
        created_at                timestamptz DEFAULT NOW(),
        updated_at                timestamptz DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_payable_obligations_status        ON payable_obligations (status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_payable_obligations_due_date      ON payable_obligations (due_date)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_payable_obligations_counterparty  ON payable_obligations (counterparty_name)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_payable_obligations_source_type   ON payable_obligations (source_type)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_payable_obligations_recurring     ON payable_obligations (related_recurring_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_payable_obligations_bank_tx       ON payable_obligations (linked_bank_transaction_id)`);

    // ── P5: obligation_documents ───────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS obligation_documents (
        id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        obligation_id   uuid        REFERENCES payable_obligations(id) ON DELETE SET NULL,
        source_type     text        NOT NULL,
        file_name       text,
        file_url        text,
        mime_type       text,
        document_kind   text,
        extracted_text  text,
        parsed_json     jsonb,
        parse_status    text        DEFAULT 'not_parsed',
        created_at      timestamptz DEFAULT NOW(),
        updated_at      timestamptz DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_obligation_documents_obligation ON obligation_documents (obligation_id)`);

    // ── P5: incoming_email_documents ──────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS incoming_email_documents (
        id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        sender               text,
        subject              text,
        received_at          timestamptz,
        attachment_count     integer     DEFAULT 0,
        status               text        DEFAULT 'new',
        linked_obligation_id uuid,
        raw_metadata         jsonb,
        created_at           timestamptz DEFAULT NOW(),
        updated_at           timestamptz DEFAULT NOW()
      )
    `);

    // ── Seed Articles / Chart of Accounts (only if empty) ────────────────────
    await client.query(`
      DO $seed$
      BEGIN
        IF (SELECT COUNT(*) FROM articles) = 0 THEN
          INSERT INTO articles (id, code, name, group_name, sub_group, type, affects_dds, affects_pl, affects_ebitda, tax_deductible, is_fixed, is_operational, sort_order, is_active) VALUES
            -- ДОХОДЫ от основной деятельности
            (gen_random_uuid(), '1.1',  'Оплата за обучение (школа)',          'Доходы от основной деятельности', NULL, 'income',  true, true, true, false, false, true, 10, true),
            (gen_random_uuid(), '1.2',  'Оплата за обучение (детский сад)',    'Доходы от основной деятельности', NULL, 'income',  true, true, true, false, false, true, 20, true),
            (gen_random_uuid(), '1.3',  'Дополнительные занятия',              'Доходы от основной деятельности', NULL, 'income',  true, true, true, false, false, true, 30, true),
            (gen_random_uuid(), '1.4',  'Питание (доход)',                     'Доходы от основной деятельности', NULL, 'income',  true, true, false, false, false, true, 40, true),
            (gen_random_uuid(), '1.5',  'Онлайн-обучение',                    'Доходы от основной деятельности', NULL, 'income',  true, true, true, false, false, true, 50, true),
            (gen_random_uuid(), '1.6',  'Летний лагерь',                      'Доходы от основной деятельности', NULL, 'income',  true, true, true, false, false, true, 60, true),
            (gen_random_uuid(), '1.7',  'Медицинские услуги',                 'Доходы от основной деятельности', NULL, 'income',  true, true, true, false, false, true, 70, true),
            (gen_random_uuid(), '1.9',  'Прочие доходы',                      'Доходы от основной деятельности', NULL, 'income',  true, true, false, false, false, true, 90, true),
            -- ФОТ
            (gen_random_uuid(), '2.1',  'Зарплата педагогов',                 'Фонд оплаты труда', NULL, 'expense', true, true, true, true, true, true, 110, true),
            (gen_random_uuid(), '2.2',  'Зарплата воспитателей',              'Фонд оплаты труда', NULL, 'expense', true, true, true, true, true, true, 120, true),
            (gen_random_uuid(), '2.3',  'Зарплата административного персонала','Фонд оплаты труда', NULL, 'expense', true, true, true, true, true, true, 130, true),
            (gen_random_uuid(), '2.4',  'Зарплата прочего персонала',         'Фонд оплаты труда', NULL, 'expense', true, true, true, true, false, true, 140, true),
            (gen_random_uuid(), '2.5',  'НДФЛ и страховые взносы',            'Фонд оплаты труда', NULL, 'expense', true, false, false, false, false, true, 150, true),
            -- АРЕНДА И КОММУНАЛЬНЫЕ
            (gen_random_uuid(), '3.1',  'Аренда помещений',                   'Аренда и коммунальные', NULL, 'expense', true, true, true, true, true, true, 210, true),
            (gen_random_uuid(), '3.2',  'Коммунальные услуги',                'Аренда и коммунальные', NULL, 'expense', true, true, true, true, true, true, 220, true),
            (gen_random_uuid(), '3.3',  'Электроэнергия',                     'Аренда и коммунальные', NULL, 'expense', true, true, true, true, true, true, 230, true),
            -- ПИТАНИЕ
            (gen_random_uuid(), '4.1',  'Закупка продуктов питания',          'Питание', NULL, 'expense', true, true, true, true, false, true, 310, true),
            (gen_random_uuid(), '4.2',  'Услуги питания (поставщик)',         'Питание', NULL, 'expense', true, true, true, true, false, true, 320, true),
            -- МАРКЕТИНГ
            (gen_random_uuid(), '5.1',  'Реклама и продвижение',              'Маркетинг', NULL, 'expense', true, true, true, true, false, true, 410, true),
            (gen_random_uuid(), '5.2',  'Сайт и IT-маркетинг',               'Маркетинг', NULL, 'expense', true, true, true, true, false, true, 420, true),
            -- НАЛОГИ
            (gen_random_uuid(), '6.1',  'УСН / налог на прибыль',             'Налоги', NULL, 'expense', true, false, false, false, false, false, 510, true),
            (gen_random_uuid(), '6.2',  'НДС',                                'Налоги', NULL, 'expense', true, false, false, false, false, false, 520, true),
            (gen_random_uuid(), '6.3',  'Прочие налоги и взносы',             'Налоги', NULL, 'expense', true, false, false, false, false, false, 530, true),
            -- БАНК
            (gen_random_uuid(), '7.1',  'Банковские комиссии',                'Банковские расходы', NULL, 'expense', true, true, true, true, false, true, 610, true),
            (gen_random_uuid(), '7.2',  'Эквайринг',                         'Банковские расходы', NULL, 'expense', true, true, true, true, false, true, 620, true),
            (gen_random_uuid(), '7.3',  'Обслуживание расчётного счёта',      'Банковские расходы', NULL, 'expense', true, true, true, true, false, true, 630, true),
            -- IT И СВЯЗЬ
            (gen_random_uuid(), '8.1',  'IT-сервисы и программное обеспечение','IT и связь', NULL, 'expense', true, true, true, true, false, true, 710, true),
            (gen_random_uuid(), '8.2',  'Связь и интернет',                   'IT и связь', NULL, 'expense', true, true, true, true, false, true, 720, true),
            -- ОПЕРАЦИОННЫЕ РАСХОДЫ
            (gen_random_uuid(), '9.1',  'Канцтовары и расходники',            'Операционные расходы', NULL, 'expense', true, true, true, true, false, true, 810, true),
            (gen_random_uuid(), '9.2',  'Хозтовары и уборка',                'Операционные расходы', NULL, 'expense', true, true, true, true, false, true, 820, true),
            (gen_random_uuid(), '9.3',  'Транспорт и доставка',               'Операционные расходы', NULL, 'expense', true, true, true, true, false, true, 830, true),
            (gen_random_uuid(), '9.4',  'Подрядчики и внешние услуги',        'Операционные расходы', NULL, 'expense', true, true, true, true, false, true, 840, true),
            (gen_random_uuid(), '9.5',  'Обслуживание оборудования',          'Операционные расходы', NULL, 'expense', true, true, true, true, false, true, 850, true),
            (gen_random_uuid(), '9.6',  'Учебные материалы и пособия',        'Операционные расходы', NULL, 'expense', true, true, true, true, false, true, 860, true),
            (gen_random_uuid(), '9.9',  'Прочие операционные расходы',        'Операционные расходы', NULL, 'expense', true, true, false, true, false, true, 890, true),
            -- ФИНАНСОВЫЕ РАСХОДЫ
            (gen_random_uuid(), '10.1', 'Кредиты и займы (тело)',             'Финансовые расходы', NULL, 'expense', true, false, false, false, false, false, 910, true),
            (gen_random_uuid(), '10.2', 'Проценты по кредитам',               'Финансовые расходы', NULL, 'expense', true, true, false, false, false, false, 920, true),
            (gen_random_uuid(), '10.3', 'Прочие финансовые расходы',          'Финансовые расходы', NULL, 'expense', true, true, false, false, false, false, 930, true),
            -- ВНУТРЕННИЕ ОПЕРАЦИИ
            (gen_random_uuid(), '0.1',  'Внутренний перевод',                 'Внутренние операции', NULL, 'transfer', false, false, false, false, false, false, 1, true),
            (gen_random_uuid(), '0.2',  'Возврат средств клиенту',            'Внутренние операции', NULL, 'income',  true, false, false, false, false, true, 2, true);
        END IF;
      END $seed$;
    `);

    // ── recurring_obligations (P4 — Recurring Obligations Engine) ────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS recurring_obligations (
        id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        title             text        NOT NULL,
        counterparty_name text,
        type              text        NOT NULL DEFAULT 'custom',
        dds_article_id    uuid,
        expected_amount   numeric,
        min_amount        numeric,
        max_amount        numeric,
        currency          text        DEFAULT 'RUB',
        frequency         text        NOT NULL DEFAULT 'monthly',
        day_of_month      integer,
        is_active         boolean     DEFAULT true,
        related_party     boolean     DEFAULT false,
        status            text        NOT NULL DEFAULT 'suggested',
        detection_source  text        DEFAULT 'ai_pattern',
        confidence_score  integer,
        last_detected_at  timestamptz,
        last_paid_at      date,
        next_expected_date date,
        notes             text,
        created_at        timestamptz DEFAULT NOW(),
        updated_at        timestamptz DEFAULT NOW()
      )
    `);

    // ── AlphaCRM Coverage Audit tables ───────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS alpha_sync_batches (
        id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        started_at          timestamptz DEFAULT NOW(),
        finished_at         timestamptz,
        status              text        DEFAULT 'running',
        mode                text        NOT NULL DEFAULT 'discovery',
        from_date           date,
        to_date             date,
        branch_id           text,
        entities_requested  integer     DEFAULT 0,
        entities_succeeded  integer     DEFAULT 0,
        entities_failed     integer     DEFAULT 0,
        endpoints_checked   integer     DEFAULT 0,
        total_fetched       integer     DEFAULT 0,
        total_saved         integer     DEFAULT 0,
        total_updated       integer     DEFAULT 0,
        total_skipped       integer     DEFAULT 0,
        total_errors        integer     DEFAULT 0,
        errors              jsonb,
        duration_ms         integer,
        triggered_by        text        DEFAULT 'manual',
        created_at          timestamptz DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS alpha_raw_records (
        id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        alpha_id              text,
        entity_type           text        NOT NULL,
        endpoint              text,
        branch_id             text,
        source_payload        jsonb       NOT NULL,
        payload_hash          text,
        sync_batch_id         uuid,
        synced_at             timestamptz DEFAULT NOW(),
        sync_status           text        DEFAULT 'raw',
        is_deleted            boolean     DEFAULT false,
        is_archived           boolean     DEFAULT false,
        external_created_at   timestamptz,
        external_updated_at   timestamptz,
        page                  integer,
        period_from           date,
        period_to             date,
        created_at            timestamptz DEFAULT NOW(),
        updated_at            timestamptz DEFAULT NOW(),
        UNIQUE (alpha_id, entity_type, branch_id, payload_hash)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_alpha_raw_entity_type   ON alpha_raw_records (entity_type)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_alpha_raw_branch_id     ON alpha_raw_records (branch_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_alpha_raw_alpha_id      ON alpha_raw_records (alpha_id, entity_type)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_alpha_raw_batch_id      ON alpha_raw_records (sync_batch_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_alpha_raw_synced_at     ON alpha_raw_records (synced_at DESC)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS alpha_endpoint_registry (
        id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        entity_key            text        NOT NULL,
        endpoint              text        NOT NULL,
        branch_id             text,
        method                text        DEFAULT 'POST',
        request_body          jsonb,
        status                text        DEFAULT 'UNKNOWN',
        http_status           integer,
        records_fetched       integer,
        pages_fetched         integer,
        first_successful_page integer,
        last_successful_page  integer,
        error_message         text,
        response_sample       jsonb,
        discovered_fields     jsonb,
        last_checked_at       timestamptz,
        next_action           text,
        notes                 text,
        created_at            timestamptz DEFAULT NOW(),
        updated_at            timestamptz DEFAULT NOW(),
        UNIQUE (entity_key, branch_id)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_alpha_registry_entity   ON alpha_endpoint_registry (entity_key)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_alpha_registry_status   ON alpha_endpoint_registry (status)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS alpha_linking_issues (
        id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        sync_batch_id           uuid,
        entity_type             text,
        alpha_id                text,
        raw_record_id           uuid,
        issue_type              text,
        issue_message           text,
        missing_reference_type  text,
        missing_reference_id    text,
        severity                text        DEFAULT 'warning',
        suggested_action        text,
        created_at              timestamptz DEFAULT NOW(),
        resolved_at             timestamptz
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_alpha_issues_entity     ON alpha_linking_issues (entity_type)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_alpha_issues_issue_type ON alpha_linking_issues (issue_type)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_alpha_issues_batch_id   ON alpha_linking_issues (sync_batch_id)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS alpha_verification_reports (
        id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        started_at   timestamptz NOT NULL DEFAULT NOW(),
        finished_at  timestamptz,
        status       text        NOT NULL DEFAULT 'running',
        from_date    date,
        to_date      date,
        report       jsonb,
        created_at   timestamptz NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS alpha_sync_scope (
        id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        scope_name   text        UNIQUE NOT NULL,
        branch_id    text        NOT NULL,
        branch_name  text        NOT NULL,
        is_active    boolean     NOT NULL DEFAULT true,
        reason       text,
        created_by   text        DEFAULT 'system',
        notes        text,
        created_at   timestamptz NOT NULL DEFAULT NOW(),
        updated_at   timestamptz NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_alpha_scope_active ON alpha_sync_scope (is_active)`);

    // Auto-seed Atlas scope — branchId=6 confirmed from P6.1 verification
    await client.query(`
      INSERT INTO alpha_sync_scope
        (scope_name, branch_id, branch_name, is_active, reason, created_by, notes)
      VALUES (
        'Atlas only',
        '6',
        'Атлас',
        true,
        'Current ArtHello OS audit must focus only on Atlas branch before expanding to other branches.',
        'system',
        'Atlas (branchId=6) is the main physical ArtHello location. Excluded from scope: Онлайн школа (1), Лиственная (2), Остров (3), Лыжный (4), Онлайн Школа (5), Кемпинг (7), Школа 1-11 (8).'
      )
      ON CONFLICT (scope_name) DO NOTHING
    `);

    // ── P7: Big Alpha Audit — duplicate candidates table ─────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS alpha_duplicate_candidates (
        id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        branch_id       text        NOT NULL DEFAULT '6',
        entity_type     text        NOT NULL,
        candidate_type  text        NOT NULL,
        entity_a_id     text        NOT NULL,
        entity_b_id     text        NOT NULL,
        confidence      numeric(4,2) NOT NULL DEFAULT 0.5,
        reason          text,
        source_fields   jsonb,
        status          text        NOT NULL DEFAULT 'open',
        created_at      timestamptz NOT NULL DEFAULT NOW(),
        resolved_at     timestamptz,
        UNIQUE (entity_type, entity_a_id, entity_b_id, candidate_type)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_alpha_dup_branch    ON alpha_duplicate_candidates (branch_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_alpha_dup_entity    ON alpha_duplicate_candidates (entity_type)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_alpha_dup_status    ON alpha_duplicate_candidates (status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_alpha_dup_candidate ON alpha_duplicate_candidates (candidate_type)`);

    // ── P7.1: Atlas Students Normalization Repair — extend crm_students ────────
    await client.query(`ALTER TABLE crm_students ADD COLUMN IF NOT EXISTS lifecycle_status    TEXT`);
    await client.query(`ALTER TABLE crm_students ADD COLUMN IF NOT EXISTS alpha_status        TEXT`);
    await client.query(`ALTER TABLE crm_students ADD COLUMN IF NOT EXISTS raw_record_id       UUID`);
    await client.query(`ALTER TABLE crm_students ADD COLUMN IF NOT EXISTS source_payload_hash TEXT`);
    await client.query(`ALTER TABLE crm_students ADD COLUMN IF NOT EXISTS birthdate           TEXT`);
    await client.query(`ALTER TABLE crm_students ADD COLUMN IF NOT EXISTS guardian_name       TEXT`);
    await client.query(`ALTER TABLE crm_students ADD COLUMN IF NOT EXISTS updated_at_crm      TIMESTAMPTZ`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_crm_students_lifecycle ON crm_students (lifecycle_status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_crm_students_branch    ON crm_students (branch_crm_id)`);

    // ── P7.2: Atlas Teachers + Groups Normalization Repair ───────────────────
    // Extend crm_teachers with lifecycle / raw-source columns
    await client.query(`ALTER TABLE crm_teachers ADD COLUMN IF NOT EXISTS lifecycle_status    TEXT`);
    await client.query(`ALTER TABLE crm_teachers ADD COLUMN IF NOT EXISTS alpha_status        TEXT`);
    await client.query(`ALTER TABLE crm_teachers ADD COLUMN IF NOT EXISTS raw_record_id       UUID`);
    await client.query(`ALTER TABLE crm_teachers ADD COLUMN IF NOT EXISTS source_payload_hash TEXT`);
    await client.query(`ALTER TABLE crm_teachers ADD COLUMN IF NOT EXISTS dob                 TEXT`);
    await client.query(`ALTER TABLE crm_teachers ADD COLUMN IF NOT EXISTS note                TEXT`);
    await client.query(`ALTER TABLE crm_teachers ADD COLUMN IF NOT EXISTS e_date_crm          TEXT`);
    await client.query(`ALTER TABLE crm_teachers ADD COLUMN IF NOT EXISTS custom_oklad        TEXT`);
    await client.query(`ALTER TABLE crm_teachers ADD COLUMN IF NOT EXISTS branch_ids_crm      JSONB`);
    await client.query(`ALTER TABLE crm_teachers ADD COLUMN IF NOT EXISTS updated_at_crm      TIMESTAMPTZ`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_crm_teachers_lifecycle ON crm_teachers (lifecycle_status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_crm_teachers_branch    ON crm_teachers (branch_crm_id)`);

    // crm_groups — new table
    await client.query(`
      CREATE TABLE IF NOT EXISTS crm_groups (
        id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        crm_id               TEXT        NOT NULL,
        branch_crm_id        TEXT,
        name                 TEXT,
        note                 TEXT,
        b_date               TEXT,
        e_date               TEXT,
        capacity             INTEGER,
        teacher_crm_ids      JSONB,
        raw                  JSONB,
        synced_at            TIMESTAMPTZ DEFAULT now(),
        lifecycle_status     TEXT,
        alpha_status         TEXT,
        raw_record_id        UUID,
        source_payload_hash  TEXT,
        created_at_crm       TIMESTAMPTZ,
        updated_at_crm       TIMESTAMPTZ,
        UNIQUE (crm_id)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_crm_groups_lifecycle ON crm_groups (lifecycle_status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_crm_groups_branch    ON crm_groups (branch_crm_id)`);

    // ── P7.2 crm_groups subject inference columns ────────────────────────────
    await client.query(`ALTER TABLE crm_groups ADD COLUMN IF NOT EXISTS inferred_subject_crm_id      TEXT`);
    await client.query(`ALTER TABLE crm_groups ADD COLUMN IF NOT EXISTS inferred_subject_name         TEXT`);
    await client.query(`ALTER TABLE crm_groups ADD COLUMN IF NOT EXISTS subject_inference_status      TEXT`);
    await client.query(`ALTER TABLE crm_groups ADD COLUMN IF NOT EXISTS subject_inference_confidence  NUMERIC`);

    // ── P7.3: Atlas Lessons Normalization Repair — extend crm_lessons ─────────
    await client.query(`ALTER TABLE crm_lessons ADD COLUMN IF NOT EXISTS subject_crm_id       TEXT`);
    await client.query(`ALTER TABLE crm_lessons ADD COLUMN IF NOT EXISTS teacher_crm_ids      JSONB`);
    await client.query(`ALTER TABLE crm_lessons ADD COLUMN IF NOT EXISTS group_crm_ids        JSONB`);
    await client.query(`ALTER TABLE crm_lessons ADD COLUMN IF NOT EXISTS time_from            TIMESTAMPTZ`);
    await client.query(`ALTER TABLE crm_lessons ADD COLUMN IF NOT EXISTS time_to              TIMESTAMPTZ`);
    await client.query(`ALTER TABLE crm_lessons ADD COLUMN IF NOT EXISTS lifecycle_status     TEXT`);
    await client.query(`ALTER TABLE crm_lessons ADD COLUMN IF NOT EXISTS alpha_status         TEXT`);
    await client.query(`ALTER TABLE crm_lessons ADD COLUMN IF NOT EXISTS raw_record_id        UUID`);
    await client.query(`ALTER TABLE crm_lessons ADD COLUMN IF NOT EXISTS source_payload_hash  TEXT`);
    await client.query(`ALTER TABLE crm_lessons ADD COLUMN IF NOT EXISTS visits_raw           JSONB`);
    await client.query(`ALTER TABLE crm_lessons ADD COLUMN IF NOT EXISTS visits_count         INTEGER`);
    await client.query(`ALTER TABLE crm_lessons ADD COLUMN IF NOT EXISTS room_crm_id          TEXT`);
    await client.query(`ALTER TABLE crm_lessons ADD COLUMN IF NOT EXISTS lesson_type_id       INTEGER`);
    await client.query(`ALTER TABLE crm_lessons ADD COLUMN IF NOT EXISTS lesson_type_name     TEXT`);
    await client.query(`ALTER TABLE crm_lessons ADD COLUMN IF NOT EXISTS regular_crm_id       TEXT`);
    await client.query(`ALTER TABLE crm_lessons ADD COLUMN IF NOT EXISTS topic                TEXT`);
    await client.query(`ALTER TABLE crm_lessons ADD COLUMN IF NOT EXISTS note                 TEXT`);
    await client.query(`ALTER TABLE crm_lessons ADD COLUMN IF NOT EXISTS customer_crm_ids     JSONB`);
    await client.query(`ALTER TABLE crm_lessons ADD COLUMN IF NOT EXISTS created_at_crm       TIMESTAMPTZ`);
    await client.query(`ALTER TABLE crm_lessons ADD COLUMN IF NOT EXISTS updated_at_crm       TIMESTAMPTZ`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_crm_lessons_lifecycle  ON crm_lessons (lifecycle_status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_crm_lessons_branch     ON crm_lessons (branch_crm_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_crm_lessons_subject    ON crm_lessons (subject_crm_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_crm_lessons_lesson_date ON crm_lessons (lesson_date)`);

    // ── P7.4: Atlas Attendance Extraction — extend crm_attendance ────────────
    // crm_attendance may already exist from legacy sync; add columns idempotently
    await client.query(`ALTER TABLE crm_attendance ADD COLUMN IF NOT EXISTS branch_id                 TEXT`);
    await client.query(`ALTER TABLE crm_attendance ADD COLUMN IF NOT EXISTS lesson_id                 UUID`);
    await client.query(`ALTER TABLE crm_attendance ADD COLUMN IF NOT EXISTS lesson_alpha_id           TEXT`);
    await client.query(`ALTER TABLE crm_attendance ADD COLUMN IF NOT EXISTS raw_lesson_record_id      UUID`);
    await client.query(`ALTER TABLE crm_attendance ADD COLUMN IF NOT EXISTS visit_alpha_id            TEXT`);
    await client.query(`ALTER TABLE crm_attendance ADD COLUMN IF NOT EXISTS visit_index               INTEGER`);
    await client.query(`ALTER TABLE crm_attendance ADD COLUMN IF NOT EXISTS student_alpha_id          TEXT`);
    await client.query(`ALTER TABLE crm_attendance ADD COLUMN IF NOT EXISTS student_id                UUID`);
    await client.query(`ALTER TABLE crm_attendance ADD COLUMN IF NOT EXISTS family_id                 UUID`);
    await client.query(`ALTER TABLE crm_attendance ADD COLUMN IF NOT EXISTS group_alpha_id            TEXT`);
    await client.query(`ALTER TABLE crm_attendance ADD COLUMN IF NOT EXISTS subject_alpha_id          TEXT`);
    await client.query(`ALTER TABLE crm_attendance ADD COLUMN IF NOT EXISTS teacher_alpha_ids         JSONB`);
    await client.query(`ALTER TABLE crm_attendance ADD COLUMN IF NOT EXISTS is_attend_raw             INTEGER`);
    await client.query(`ALTER TABLE crm_attendance ADD COLUMN IF NOT EXISTS visit_status_normalized   TEXT`);
    await client.query(`ALTER TABLE crm_attendance ADD COLUMN IF NOT EXISTS is_present                BOOLEAN`);
    await client.query(`ALTER TABLE crm_attendance ADD COLUMN IF NOT EXISTS is_absent                 BOOLEAN`);
    await client.query(`ALTER TABLE crm_attendance ADD COLUMN IF NOT EXISTS absence_reason_id         TEXT`);
    await client.query(`ALTER TABLE crm_attendance ADD COLUMN IF NOT EXISTS absence_reason_name       TEXT`);
    await client.query(`ALTER TABLE crm_attendance ADD COLUMN IF NOT EXISTS absence_reason_normalized TEXT`);
    await client.query(`ALTER TABLE crm_attendance ADD COLUMN IF NOT EXISTS commission                NUMERIC`);
    await client.query(`ALTER TABLE crm_attendance ADD COLUMN IF NOT EXISTS ctt_id                    TEXT`);
    await client.query(`ALTER TABLE crm_attendance ADD COLUMN IF NOT EXISTS visit_note                TEXT`);
    await client.query(`ALTER TABLE crm_attendance ADD COLUMN IF NOT EXISTS lesson_date               TIMESTAMPTZ`);
    await client.query(`ALTER TABLE crm_attendance ADD COLUMN IF NOT EXISTS lesson_start_time         TIMESTAMPTZ`);
    await client.query(`ALTER TABLE crm_attendance ADD COLUMN IF NOT EXISTS lesson_end_time           TIMESTAMPTZ`);
    await client.query(`ALTER TABLE crm_attendance ADD COLUMN IF NOT EXISTS source_payload            JSONB`);
    await client.query(`ALTER TABLE crm_attendance ADD COLUMN IF NOT EXISTS payload_hash              TEXT`);
    await client.query(`ALTER TABLE crm_attendance ADD COLUMN IF NOT EXISTS sync_source               TEXT`);
    await client.query(`ALTER TABLE crm_attendance ADD COLUMN IF NOT EXISTS normalization_status      TEXT`);
    await client.query(`ALTER TABLE crm_attendance ADD COLUMN IF NOT EXISTS normalization_error       TEXT`);
    await client.query(`ALTER TABLE crm_attendance ADD COLUMN IF NOT EXISTS created_at               TIMESTAMPTZ`);
    await client.query(`ALTER TABLE crm_attendance ADD COLUMN IF NOT EXISTS updated_at               TIMESTAMPTZ`);
    // Unique index for ON CONFLICT in P7.4 extraction (NULLs don't conflict)
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_att_uniq          ON crm_attendance (lesson_alpha_id, visit_alpha_id)`);
    await client.query(`CREATE INDEX        IF NOT EXISTS idx_crm_att_branch        ON crm_attendance (branch_id)`);
    await client.query(`CREATE INDEX        IF NOT EXISTS idx_crm_att_lesson        ON crm_attendance (lesson_id)`);
    await client.query(`CREATE INDEX        IF NOT EXISTS idx_crm_att_student       ON crm_attendance (student_id)`);
    await client.query(`CREATE INDEX        IF NOT EXISTS idx_crm_att_student_alpha ON crm_attendance (student_alpha_id)`);
    await client.query(`CREATE INDEX        IF NOT EXISTS idx_crm_att_family        ON crm_attendance (family_id)`);
    await client.query(`CREATE INDEX        IF NOT EXISTS idx_crm_att_lesson_date   ON crm_attendance (lesson_date)`);
    await client.query(`CREATE INDEX        IF NOT EXISTS idx_crm_att_status        ON crm_attendance (visit_status_normalized)`);

    // ── P7.4.3c: Historical identity columns on crm_attendance ────────────────
    await client.query(`ALTER TABLE crm_attendance ADD COLUMN IF NOT EXISTS student_identity_id      UUID`);
    await client.query(`ALTER TABLE crm_attendance ADD COLUMN IF NOT EXISTS identity_resolution_status TEXT`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_crm_att_identity ON crm_attendance (student_identity_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_crm_att_id_res   ON crm_attendance (identity_resolution_status)`);

    // ── P7.4.3c: source column on crm_students ────────────────────────────────
    await client.query(`ALTER TABLE crm_students ADD COLUMN IF NOT EXISTS source TEXT`);

    // ── P7.4.3c: crm_student_identities — one row per unique customer_id ──────
    await client.query(`
      CREATE TABLE IF NOT EXISTS crm_student_identities (
        id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        branch_id                TEXT        NOT NULL,
        alpha_customer_id        TEXT        NOT NULL,
        identity_type            TEXT        NOT NULL,
        source                   TEXT        NOT NULL,
        student_id               UUID,
        first_seen_lesson_date   DATE,
        last_seen_lesson_date    DATE,
        attendance_count         INTEGER     DEFAULT 0,
        lesson_count             INTEGER     DEFAULT 0,
        group_ids                JSONB,
        subject_ids              JSONB,
        teacher_ids              JSONB,
        sample_lesson_alpha_ids  JSONB,
        resolution_status        TEXT        NOT NULL DEFAULT 'unresolved',
        confidence               TEXT        NOT NULL DEFAULT 'medium',
        notes                    TEXT,
        created_at               TIMESTAMPTZ DEFAULT now(),
        updated_at               TIMESTAMPTZ DEFAULT now(),
        UNIQUE (branch_id, alpha_customer_id)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_csi_branch        ON crm_student_identities (branch_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_csi_resolution    ON crm_student_identities (resolution_status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_csi_alpha_cid     ON crm_student_identities (alpha_customer_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_csi_student       ON crm_student_identities (student_id)`);

    // ── P7.5: Extend crm_payments with full normalized fields ────────────────
    await client.query(`ALTER TABLE crm_payments ADD COLUMN IF NOT EXISTS raw_record_id           UUID`);
    await client.query(`ALTER TABLE crm_payments ADD COLUMN IF NOT EXISTS source_payload_hash     TEXT`);
    await client.query(`ALTER TABLE crm_payments ADD COLUMN IF NOT EXISTS document_date           DATE`);
    await client.query(`ALTER TABLE crm_payments ADD COLUMN IF NOT EXISTS created_at_alpha        TIMESTAMPTZ`);
    await client.query(`ALTER TABLE crm_payments ADD COLUMN IF NOT EXISTS updated_at_alpha        TIMESTAMPTZ`);
    await client.query(`ALTER TABLE crm_payments ADD COLUMN IF NOT EXISTS income                  NUMERIC`);
    await client.query(`ALTER TABLE crm_payments ADD COLUMN IF NOT EXISTS outcome                 NUMERIC`);
    await client.query(`ALTER TABLE crm_payments ADD COLUMN IF NOT EXISTS direction               TEXT`);
    await client.query(`ALTER TABLE crm_payments ADD COLUMN IF NOT EXISTS payment_type_id_raw     TEXT`);
    await client.query(`ALTER TABLE crm_payments ADD COLUMN IF NOT EXISTS payment_type_name_raw   TEXT`);
    await client.query(`ALTER TABLE crm_payments ADD COLUMN IF NOT EXISTS payment_type_normalized TEXT`);
    await client.query(`ALTER TABLE crm_payments ADD COLUMN IF NOT EXISTS payer_name              TEXT`);
    await client.query(`ALTER TABLE crm_payments ADD COLUMN IF NOT EXISTS account_raw             TEXT`);
    await client.query(`ALTER TABLE crm_payments ADD COLUMN IF NOT EXISTS pay_item_id             TEXT`);
    await client.query(`ALTER TABLE crm_payments ADD COLUMN IF NOT EXISTS ctt_id                  TEXT`);
    await client.query(`ALTER TABLE crm_payments ADD COLUMN IF NOT EXISTS group_alpha_id          TEXT`);
    await client.query(`ALTER TABLE crm_payments ADD COLUMN IF NOT EXISTS is_confirmed            BOOLEAN`);
    await client.query(`ALTER TABLE crm_payments ADD COLUMN IF NOT EXISTS is_correction           BOOLEAN DEFAULT FALSE`);
    await client.query(`ALTER TABLE crm_payments ADD COLUMN IF NOT EXISTS is_refund               BOOLEAN DEFAULT FALSE`);
    await client.query(`ALTER TABLE crm_payments ADD COLUMN IF NOT EXISTS is_cancelled            BOOLEAN DEFAULT FALSE`);
    await client.query(`ALTER TABLE crm_payments ADD COLUMN IF NOT EXISTS normalization_status    TEXT`);
    await client.query(`ALTER TABLE crm_payments ADD COLUMN IF NOT EXISTS normalization_error     TEXT`);
    await client.query(`ALTER TABLE crm_payments ADD COLUMN IF NOT EXISTS sync_source             TEXT`);
    await client.query(`ALTER TABLE crm_payments ADD COLUMN IF NOT EXISTS student_id              UUID`);
    await client.query(`ALTER TABLE crm_payments ADD COLUMN IF NOT EXISTS student_identity_id     UUID`);
    await client.query(`ALTER TABLE crm_payments ADD COLUMN IF NOT EXISTS family_id               UUID`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_crm_pay_branch      ON crm_payments (branch_crm_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_crm_pay_customer    ON crm_payments (student_crm_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_crm_pay_doc_date    ON crm_payments (document_date)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_crm_pay_type_norm   ON crm_payments (payment_type_normalized)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_crm_pay_direction   ON crm_payments (direction)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_crm_pay_student     ON crm_payments (student_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_crm_pay_identity    ON crm_payments (student_identity_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_crm_pay_norm_status ON crm_payments (normalization_status)`);

    // ── P7.6: Reconciliation risk flags + linking issues branch support ──────
    await client.query(`ALTER TABLE crm_payments ADD COLUMN IF NOT EXISTS reconciliation_risk_level TEXT`);
    await client.query(`ALTER TABLE crm_payments ADD COLUMN IF NOT EXISTS finance_treatment_hint    TEXT`);
    await client.query(`ALTER TABLE alpha_linking_issues ADD COLUMN IF NOT EXISTS branch_id TEXT`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_crm_pay_risk_level  ON crm_payments (reconciliation_risk_level)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ali_branch          ON alpha_linking_issues (branch_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ali_entity_type_bid ON alpha_linking_issues (entity_type, branch_id)`);

    // ── P8.4a: Counterparty reclassification fields ──────────────────────────
    await client.query(`
      ALTER TABLE counterparties
        ADD COLUMN IF NOT EXISTS finance_treatment_hint       TEXT,
        ADD COLUMN IF NOT EXISTS exclude_from_revenue_expense BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS needs_manual_review           BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS reclassification_reason      TEXT,
        ADD COLUMN IF NOT EXISTS classification_version       TEXT,
        ADD COLUMN IF NOT EXISTS classification_updated_at    TIMESTAMPTZ
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_cp_needs_review ON counterparties (needs_manual_review)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_cp_exclude_rev  ON counterparties (exclude_from_revenue_expense)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_cp_class_ver    ON counterparties (classification_version)`);

    // ── P8.4b: Bank ↔ AlphaCRM Reconciliation tables ────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS bank_alpha_reconciliation_runs (
        id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        started_at                TIMESTAMPTZ DEFAULT NOW(),
        finished_at               TIMESTAMPTZ,
        status                    TEXT DEFAULT 'running',
        bank_transactions_checked INT DEFAULT 0,
        crm_payments_checked      INT DEFAULT 0,
        matched_count             INT DEFAULT 0,
        partial_count             INT DEFAULT 0,
        possible_count            INT DEFAULT 0,
        unmatched_bank_count      INT DEFAULT 0,
        unmatched_crm_count       INT DEFAULT 0,
        excluded_internal_count   INT DEFAULT 0,
        excluded_collection_count INT DEFAULT 0,
        excluded_bank_fee_count   INT DEFAULT 0,
        needs_review_count        INT DEFAULT 0,
        errors                    JSONB DEFAULT '[]',
        created_at                TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS bank_alpha_reconciliation_matches (
        id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        run_id                 UUID,
        bank_transaction_id    TEXT,
        crm_payment_id         UUID,
        match_status           TEXT,
        match_confidence       TEXT,
        match_method           TEXT,
        amount_delta           NUMERIC(15,2),
        date_delta_days        INT,
        bank_amount            NUMERIC(15,2),
        crm_amount             NUMERIC(15,2),
        bank_date              DATE,
        crm_date               DATE,
        bank_counterparty_id   UUID,
        bank_counterparty_name TEXT,
        crm_customer_alpha_id  TEXT,
        student_id             UUID,
        student_identity_id    UUID,
        family_id              UUID,
        reasons                JSONB DEFAULT '{}',
        risk_flags             JSONB DEFAULT '{}',
        created_at             TIMESTAMPTZ DEFAULT NOW(),
        updated_at             TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_bar_run_id        ON bank_alpha_reconciliation_matches (run_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_bar_match_status  ON bank_alpha_reconciliation_matches (match_status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_bar_bank_tx_id    ON bank_alpha_reconciliation_matches (bank_transaction_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_bar_crm_pay_id    ON bank_alpha_reconciliation_matches (crm_payment_id)`);

    // ── evotor_connectors (P8.5a — Evotor Auth Layer) ─────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS evotor_connectors (
        id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        publisher_token_enc       TEXT,
        publisher_token_last4     TEXT,
        publisher_token_saved_at  TIMESTAMPTZ,
        user_token_enc            TEXT,
        user_token_last4          TEXT,
        user_token_received_at    TIMESTAMPTZ,
        stores_count              INT         DEFAULT 0,
        devices_count             INT         DEFAULT 0,
        employees_count           INT         DEFAULT 0,
        documents_count           INT         DEFAULT 0,
        last_discovery_at         TIMESTAMPTZ,
        discovery_raw             JSONB,
        readiness                 TEXT        DEFAULT 'NOT_CONNECTED',
        created_at                TIMESTAMPTZ DEFAULT NOW(),
        updated_at                TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS evotor_sync_batches (
        id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        entity_type   TEXT        NOT NULL,
        status        TEXT        DEFAULT 'pending',
        records_raw   INT         DEFAULT 0,
        records_saved INT         DEFAULT 0,
        error_message TEXT,
        started_at    TIMESTAMPTZ DEFAULT NOW(),
        finished_at   TIMESTAMPTZ,
        raw           JSONB
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS evotor_raw_records (
        id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        entity_type TEXT        NOT NULL,
        external_id TEXT,
        batch_id    UUID,
        raw         JSONB       NOT NULL,
        fetched_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_evotor_raw_entity ON evotor_raw_records (entity_type)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_evotor_raw_batch  ON evotor_raw_records (batch_id)`);

    // ── Employee Foundation (P9.1) ─────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS departments (
        id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        name        TEXT        NOT NULL,
        code        TEXT        UNIQUE,
        sort_order  INT         DEFAULT 0,
        is_active   BOOLEAN     DEFAULT TRUE,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    // Seed canonical departments (idempotent — WHERE NOT EXISTS guards duplicates)
    await client.query(`
      INSERT INTO departments (name, sort_order)
      SELECT v.name, v.sort_order FROM (VALUES
        ('Детский сад',           1),
        ('Школа',                 2),
        ('Клубные занятия',       3),
        ('Дополнительные услуги', 4),
        ('Онлайн школа',          5),
        ('Кухня',                 6),
        ('Администрация',         7),
        ('Управление',            8)
      ) AS v(name, sort_order)
      WHERE NOT EXISTS (SELECT 1 FROM departments d WHERE d.name = v.name)
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS employees (
        id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        full_name           TEXT        NOT NULL,
        phone               TEXT,
        email               TEXT,
        employment_type     TEXT        DEFAULT 'employee',
        status              TEXT        DEFAULT 'active',
        primary_role        TEXT,
        primary_department  TEXT,
        department_id       UUID,
        start_date          DATE,
        end_date            DATE,
        inn                 TEXT,
        bank_details        TEXT,
        notes               TEXT,
        teacher_crm_id      TEXT,
        branch_crm_id       TEXT,
        is_test_data        BOOLEAN     DEFAULT FALSE,
        created_at          TIMESTAMPTZ DEFAULT NOW(),
        updated_at          TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_employees_status         ON employees (status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_employees_teacher_crm_id ON employees (teacher_crm_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_employees_department      ON employees (primary_department)`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS employee_roles (
        id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        employee_id   UUID        NOT NULL,
        role_name     TEXT        NOT NULL,
        department    TEXT,
        department_id UUID,
        branch_id     TEXT,
        valid_from    DATE,
        valid_to      DATE,
        is_primary    BOOLEAN     DEFAULT FALSE,
        created_at    TIMESTAMPTZ DEFAULT NOW(),
        updated_at    TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_employee_roles_employee_id ON employee_roles (employee_id)`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS payroll_rules (
        id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        employee_id   UUID        NOT NULL,
        rule_type     TEXT        NOT NULL DEFAULT 'per_lesson',
        amount        NUMERIC(15,2),
        service_id    UUID,
        group_id      TEXT,
        department    TEXT,
        valid_from    DATE,
        valid_to      DATE,
        is_active     BOOLEAN     DEFAULT TRUE,
        notes         TEXT,
        created_at    TIMESTAMPTZ DEFAULT NOW(),
        updated_at    TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_payroll_rules_employee_id ON payroll_rules (employee_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_payroll_rules_is_active   ON payroll_rules (is_active)`);

    // ── Employee Foundation P9.2: schema drift fix ─────────────────────────────
    // Add person_id column that was in Drizzle schema but missing from migration SQL
    await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS person_id UUID`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_employees_person_id ON employees (person_id)`);
    // Unique constraint on teacher_crm_id — enables idempotent population
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'uq_employees_teacher_crm_id'
        ) THEN
          ALTER TABLE employees ADD CONSTRAINT uq_employees_teacher_crm_id UNIQUE (teacher_crm_id);
        END IF;
      END $$
    `);

    // ── P9.3.1 — Employee Classification layer ─────────────────────────────────
    await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS employee_kind TEXT`);
    await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS employee_type TEXT`);
    await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS classification_status TEXT`);
    await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS classification_reason TEXT`);
    await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS directions JSONB DEFAULT '[]'`);
    await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS exclude_from_staff_analytics BOOLEAN DEFAULT false`);
    await client.query(`CREATE INDEX IF NOT EXISTS employees_employee_kind_idx ON employees (employee_kind)`);
    await client.query(`CREATE INDEX IF NOT EXISTS employees_classification_status_idx ON employees (classification_status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS employees_exclude_from_staff_analytics_idx ON employees (exclude_from_staff_analytics)`);

    // ── Drizzle migration tracking (prevents "Load failed" on Replit Publish) ──
    // All migrations 0000-0005 were applied via this migrate.ts (IF NOT EXISTS).
    // ── P9.4.1 — educational_units table + employees.attribution_model ──────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS educational_units (
        id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        crm_group_id         text UNIQUE,
        name                 text NOT NULL,
        educational_unit_type text,
        department           text,
        attribution_model    text,
        revenue_model        text,
        is_active            boolean DEFAULT true,
        classification_status text DEFAULT 'classified',
        classification_reason text,
        created_at           timestamptz DEFAULT NOW(),
        updated_at           timestamptz DEFAULT NOW()
      )
    `);
    await client.query(`
      ALTER TABLE employees
        ADD COLUMN IF NOT EXISTS attribution_model text
    `);

    // ── P9.4.2 — employee_educational_unit_links ──────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS employee_educational_unit_links (
        id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        employee_id         uuid NOT NULL,
        educational_unit_id uuid NOT NULL,
        crm_group_id        text,
        teacher_crm_id      text,
        role_in_unit        text DEFAULT 'unknown',
        attribution_model   text,
        is_primary          boolean DEFAULT false,
        source              text DEFAULT 'inferred',
        confidence          text DEFAULT 'low',
        valid_from          date,
        valid_to            date,
        notes               text,
        created_at          timestamptz DEFAULT NOW(),
        updated_at          timestamptz DEFAULT NOW()
      )
    `);

    // Pre-seed drizzle.__drizzle_migrations so Replit's migration validator sees
    // them as already applied and does not try to re-run them.
    await client.query(`CREATE SCHEMA IF NOT EXISTS drizzle`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
        id      SERIAL PRIMARY KEY,
        hash    text    NOT NULL,
        created_at bigint
      )
    `);
    // Insert each migration hash only if not already recorded (idempotent).
    const migrationHashes: [string, number][] = [
      ['2ae4cbc4bf7921d6d85949d03ae5fb03485ea07f8f154c53279c160b04a17cad', 1779533561810], // 0000
      ['f1fd90196fbad083212be7734c9b23ed51e03323c789626304072a64e1c3acc1', 1779537865333], // 0001
      ['11cb684cdef16cf4835149d7dcd6c75afeb12f13a007f2b33794aa178d5d8a73', 1779641757810], // 0002
      ['d7dd1f3ad162e75285a01804f1e1bb16a146755fbe193480df8fec32e22c9572', 1748102400000], // 0003
      ['987047aa3029f13f39d87157c0dec50569be4d1d42c57fb0c1ccf9474f8f5161', 1780048515644], // 0004
      ['28cb10d6d6edf32aad44894df4ab22957535390a2b0352e522f975cdcbabc0a7', 1780052614426], // 0005
      ['67839f32b1b8911110624bb3902370ec51339a39d38e9d816d199b8a264978ea', 1780084956000], // 0006
      ['2d67b7ec65705ebf7989ed519f85aeec8745fb4c6ca3aa98b208c23b0af60330', 1780086400000], // 0007
    ];
    for (const [hash, createdAt] of migrationHashes) {
      await client.query(
        `INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
         SELECT $1, $2
         WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = $1)`,
        [hash, createdAt],
      );
    }

    await client.query("COMMIT");
    logger.info("runMigrations: all migrations applied successfully");
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error(
      { err },
      "runMigrations: migration failed — startup is blocked",
    );
    throw err;
  } finally {
    client.release();
  }
}
