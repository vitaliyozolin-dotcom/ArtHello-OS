import { env } from "cloudflare:workers";

type CatalogConnection = {
  id: string;
  system: string;
  category: string;
  targetModule: string;
  ownerEntityId: string;
  sourceOfTruth: string;
  mode: string;
  impact: string;
  adapterVersion: string;
  core?: boolean;
};

const OPERATING_CATALOG: CatalogConnection[] = [
  { id: "INT-T-D1", system: "ArtHello OS D1", category: "Внутренняя платформа", targetModule: "Все модули", ownerEntityId: "ROLE:OWNER", sourceOfTruth: "ArtHello OS D1", mode: "Binding · read/write", impact: "Критичное: без D1 недоступны рабочие записи", adapterVersion: "d1-core@1", core: true },
  { id: "INT-T-ALFACRM", system: "AlfaCRM", category: "CRM", targetModule: "Продажи · Клиенты · Обучение", ownerEntityId: "ROLE:SALES", sourceOfTruth: "AlfaCRM", mode: "API · входящие и исходящие изменения", impact: "Высокое: лиды, семьи, договоры и статусы не синхронизируются автоматически", adapterVersion: "alfacrm@1" },
  { id: "INT-T-FORMS", system: "Формы сайта", category: "Маркетинг", targetModule: "Продажи", ownerEntityId: "ROLE:MARKETING", sourceOfTruth: "Формы сайта ArtHello", mode: "Webhook · входящие заявки", impact: "Высокое: заявки сайта не попадают в воронку автоматически", adapterVersion: "web-forms@1" },
  { id: "INT-T-PHONE", system: "Телефония", category: "Коммуникации", targetModule: "Продажи", ownerEntityId: "ROLE:SALES", sourceOfTruth: "Выбранный оператор телефонии", mode: "Webhook · звонки и записи контактов", impact: "Среднее: звонки приходится фиксировать вручную", adapterVersion: "telephony@1" },
  { id: "INT-T-WHATSAPP", system: "WhatsApp", category: "Коммуникации", targetModule: "Продажи · Клиенты", ownerEntityId: "ROLE:SALES", sourceOfTruth: "WhatsApp Business API", mode: "Webhook · обращения и статусы сообщений", impact: "Высокое: обращения WhatsApp не создают лиды автоматически", adapterVersion: "whatsapp@1" },
  { id: "INT-T-TG", system: "Telegram", category: "Коммуникации", targetModule: "Продажи · Клиенты · Задачи", ownerEntityId: "ROLE:SALES", sourceOfTruth: "Telegram Bot API", mode: "Webhook · обращения и уведомления", impact: "Среднее: обращения Telegram остаются вне единой истории", adapterVersion: "telegram@1" },
  { id: "INT-T-VK", system: "VK", category: "Маркетинг", targetModule: "Продажи · Контент", ownerEntityId: "ROLE:MARKETING", sourceOfTruth: "VK API · Lead Ads и сообщения", mode: "API / webhook · лиды, сообщения и UTM", impact: "Среднее: лиды VK и сообщения не связаны с воронкой", adapterVersion: "vk@1" },
  { id: "INT-T-YANDEX", system: "Яндекс", category: "Маркетинг", targetModule: "Продажи · Контент", ownerEntityId: "ROLE:MARKETING", sourceOfTruth: "Яндекс Директ · Метрика · Формы", mode: "API · кампании, формы, расходы и UTM", impact: "Среднее: стоимость лида и first-click не подтверждаются Яндексом", adapterVersion: "yandex@1" },
  { id: "INT-T-MAIL", system: "Email и рассылки", category: "Коммуникации", targetModule: "Продажи · Клиенты · Контент", ownerEntityId: "ROLE:MARKETING", sourceOfTruth: "Выбранный почтовый сервис", mode: "API · письма, ответы и статусы доставки", impact: "Среднее: письма и ответы не входят в историю клиента", adapterVersion: "mailing@1" },
  { id: "INT-T-ADS", system: "Рекламные кабинеты", category: "Маркетинг", targetModule: "Продажи · Контент", ownerEntityId: "ROLE:MARKETING", sourceOfTruth: "Рекламные платформы", mode: "API · расходы, кампании и креативы", impact: "Среднее: ROMI и стоимость лида не подтверждаются платформами", adapterVersion: "ads@1" },
  { id: "INT-T-SOCIAL", system: "Социальные сети", category: "Контент", targetModule: "Контент · Продажи", ownerEntityId: "ROLE:MARKETING", sourceOfTruth: "Социальные платформы", mode: "API · публикации, метрики и переходы", impact: "Среднее: контент не связывается с кликами, лидами и выручкой", adapterVersion: "social@1" },
  { id: "INT-T-TOCHKA", system: "Банк Точка", category: "Банк", targetModule: "Финансы", ownerEntityId: "ROLE:OWNER", sourceOfTruth: "Официальный интерфейс Банка Точка", mode: "Только чтение · счета, остатки, выписки и проведённые операции", impact: "Критичное: без синхронизации новые банковские операции не попадут в реестр финансов", adapterVersion: "bank-tochka-readonly@2" },
  { id: "INT-T-TBANK", system: "Т‑Банк", category: "Банк", targetModule: "Финансы", ownerEntityId: "ROLE:OWNER", sourceOfTruth: "Официальный интерфейс Т‑Банка для бизнеса", mode: "Прямое подключение · только чтение счетов и короткой выписки", impact: "Критичное: доступ можно проверить, но операции не импортируются и платежи не создаются", adapterVersion: "tbank-h2h-readonly@1" },
  { id: "INT-T-DIARY", system: "Электронный дневник", category: "Образование", targetModule: "Обучение", ownerEntityId: "ROLE:METHODIST", sourceOfTruth: "ArtHello School 1–11", mode: "API · расписание, оценки и посещаемость", impact: "Высокое: учебные данные не синхронизируются с основной системой", adapterVersion: "diary@1" },
  { id: "INT-T-EDO", system: "ЭДО", category: "Документы", targetModule: "Бухгалтерия · Юрист", ownerEntityId: "ROLE:ACCOUNTING", sourceOfTruth: "Выбранный оператор ЭДО", mode: "API · документы и подписи", impact: "Высокое: подписи и первичные документы подтверждаются вручную", adapterVersion: "edo@1" },
  { id: "INT-T-1C", system: "1С", category: "Учёт", targetModule: "Бухгалтерия", ownerEntityId: "ROLE:ACCOUNTING", sourceOfTruth: "1С", mode: "Контролируемый импорт и экспорт", impact: "Высокое: данные не передаются в 1С автоматически", adapterVersion: "1c@1" },
  { id: "INT-T-ACS", system: "СКУД", category: "Безопасность", targetModule: "Безопасность", ownerEntityId: "ROLE:SAFETY", sourceOfTruth: "Контроллеры СКУД", mode: "API · события доступа", impact: "Критичное: события доступа не поступают в систему", adapterVersion: "acs@1" },
  { id: "INT-T-CAM", system: "Камеры", category: "Безопасность", targetModule: "Безопасность", ownerEntityId: "ROLE:SAFETY", sourceOfTruth: "VMS объектов", mode: "События без хранения видеопотока", impact: "Среднее: события камер не поступают в систему", adapterVersion: "cameras@1" },
  { id: "INT-T-OPENAI-IMAGES", system: "OpenAI Images", category: "Контент", targetModule: "Контент · Студия", ownerEntityId: "ROLE:MARKETING", sourceOfTruth: "OpenAI Images API", mode: "API · генерация и редактирование", impact: "Среднее: генерация изображений недоступна без отдельного ключа", adapterVersion: "openai-images@1" },
];

export async function ensureOperatingIntegrationCatalog() {
  if (!env.DB) throw new Error("Cloudflare D1 binding `DB` is unavailable.");
  const statements = OPERATING_CATALOG.map((item) => env.DB.prepare(`INSERT OR IGNORE INTO integration_connections (
    id,system,category,target_module,owner_entity_id,source_of_truth,mode,status,auth_status,
    credential_expires_at,last_success_at,next_sync_at,received_count,accepted_count,rejected_count,error_count,
    conflict_count,impact,adapter_version,verified_transfer,is_enabled
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
    item.id,
    item.system,
    item.category,
    item.targetModule,
    item.ownerEntityId,
    item.sourceOfTruth,
    item.mode,
    item.core ? "Работает" : "Ожидает настройку",
    item.core ? "Сервисная привязка активна" : "Не настроена",
    "",
    item.core ? new Date().toISOString() : "",
    item.core ? "Постоянно" : "После настройки доступа",
    0,
    0,
    0,
    0,
    0,
    item.impact,
    item.adapterVersion,
    item.core ? 1 : 0,
    item.core ? 1 : 0,
  ));
  for (let index = 0; index < statements.length; index += 30) {
    await env.DB.batch(statements.slice(index, index + 30));
  }
  for (const item of OPERATING_CATALOG) {
    await env.DB.prepare(`UPDATE integration_connections
      SET system=?,category=?,target_module=?,owner_entity_id=?,source_of_truth=?,mode=?,impact=?,adapter_version=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(item.system, item.category, item.targetModule, item.ownerEntityId, item.sourceOfTruth, item.mode, item.impact, item.adapterVersion, item.id).run();
  }
}
