const MONTHS = [
  "январь",
  "февраль",
  "март",
  "апрель",
  "май",
  "июнь",
  "июль",
  "август",
  "сентябрь",
  "октябрь",
  "ноябрь",
  "декабрь",
] as const;

/**
 * Converts a storage identifier into a short, stable number for the interface.
 * The original value must still be used as a React key and in API requests.
 */
export function recordSequence(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(1, Math.abs(Math.trunc(value)) % 10_000);
  }

  const source = typeof value === "string" ? value.trim() : "";
  const matches = [...source.matchAll(/\d+/g)].map((match) => ({
    value: Number(match[0]),
    text: match[0],
    index: match.index ?? 0,
  }));
  const nonYear = matches.filter((item) => !(item.text.length === 4 && item.value >= 1900 && item.value <= 2100));
  const candidates = nonYear.length ? nonYear : matches;
  if (candidates.length) {
    const trailing = candidates.at(-1)!;
    const beforeTrailing = candidates.at(-2);
    const followsSlash = trailing.index > 0 && source[trailing.index - 1] === "/";
    const chosen = followsSlash && trailing.text.length <= 2 && beforeTrailing ? beforeTrailing : trailing;
    return Math.max(1, Math.abs(chosen.value) % 10_000);
  }

  // FNV-1a keeps UUID-like storage keys stable without exposing them to users.
  let hash = 0x811c9dc5;
  for (const char of source || "record") {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % 9_999 + 1;
}

export function recordNumber(value: unknown): string {
  return `№${String(recordSequence(value)).padStart(4, "0")}`;
}

export function recordLabel(kind: string, value: unknown): string {
  return `${kind.trim()} ${recordNumber(value)}`;
}

export function taskRecordLabel(value: unknown): string {
  return `Задача №${recordSequence(value)}`;
}

export function humanPeriodLabel(value: string): string {
  const quarter = /^(\d{4})-Q([1-4])$/i.exec(value.trim());
  if (quarter) return `${quarter[2]} квартал ${quarter[1]}`;
  const month = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value.trim());
  if (month) return `${MONTHS[Number(month[2]) - 1]} ${month[1]}`;
  return value;
}

const TECHNICAL_SOURCE_LABELS: Record<string, string> = {
  financial_operations: "Финансовые операции",
  client_lifecycles: "Карточки семей",
  education_progress: "Учебный прогресс",
  education_attendance: "Посещаемость",
  education_feedback: "Обратная связь по обучению",
  education_programs: "Учебные программы",
  hr_employees: "Карточки сотрудников",
  hr_vacancies: "Вакансии",
  hr_onboarding: "Адаптация сотрудников",
  hr_accesses: "Доступы сотрудников",
  hr_development: "Развитие сотрудников",
  hr_rewards: "Поощрения сотрудников",
  finance_budgets: "Финансовые бюджеты",
  finance_accruals: "Начисления",
  finance_forecast_items: "Платёжный календарь",
  finance_reconciliation_issues: "Финансовые сверки",
  integration_conflicts: "Конфликты интеграций",
  content_publications: "Публикации",
  content_attributions: "Атрибуция контента",
  food_shipments: "Отгрузки кухни",
  food_production: "Производство кухни",
  food_shifts: "Смены кухни",
  analytics_metric_definitions: "Показатели аналитики",
  procurement_suppliers: "Поставщики",
  supplier_offers: "Предложения поставщиков",
  accounting_completeness_checks: "Проверки комплектности",
  accounting_documents: "Первичные документы",
  tasks: "Задачи",
  safety_faults: "Неисправности",
  strategy_projects: "Проекты",
  strategy_deviations: "Отклонения проектов",
};

export function humanSourceList(value: string): string {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => TECHNICAL_SOURCE_LABELS[item] ?? (/^[a-z0-9_]+$/i.test(item) ? "Источник данных" : item))
    .join(" · ");
}

export function humanFormulaLabel(value: string): string {
  const source = value.trim();
  const exact: Record<string, string> = {
    "SUM(Поступление)-SUM(Списание)": "Поступления за месяц минус списания",
    "SUM(payment amount) по family_id": "Сумма подтверждённых оплат семьи",
    "COUNT(active family WHERE band=Высокий)": "Число активных семей с высоким риском",
    "AVG(score)": "Среднее значение прогресса",
    "COUNT(status=Работает)": "Число работающих сотрудников",
    "COUNT(status!=Закрыт)": "Число незакрытых неисправностей",
    "COUNT(status=Под риском)": "Число проектов под риском",
    "COUNT(open finance issues)+COUNT(open integration conflicts)": "Число открытых расхождений в финансах и интеграциях",
  };
  if (exact[source]) return exact[source];
  if (/\b(?:SUM|COUNT|AVG|MIN|MAX)\s*\(|family_id|[a-z]+_[a-z_]+|(?:WHERE|SELECT)\b/i.test(source)) {
    return "Расчёт по утверждённым данным";
  }
  return source;
}

export function humanVersionLabel(value: string): string {
  const normalized = value.trim();
  if (!normalized || /rules|test|manual-control/i.test(normalized)) return "Правила проверены человеком";
  return normalized.replace(/^v(?=\d)/i, "Версия ");
}

const REFERENCE_KINDS: Array<[RegExp, string]> = [
  [/^(?:TSK|TASK)(?:-|$)/i, "Задача"],
  [/^(?:DOG|CONTRACT)(?:-|$)/i, "Договор"],
  [/^(?:FIN|PAY|BANK)(?:-|$)/i, "Операция"],
  [/^(?:ACC|DOC|UPD|ACT)(?:-|$)/i, "Документ"],
  [/^(?:PUB)(?:-|$)/i, "Публикация"],
  [/^(?:ATTR|CLICK)(?:-|$)/i, "Переход"],
  [/^(?:LEAD)(?:-|$)/i, "Заявка"],
  [/^(?:FAM|LIFE)(?:-|$)/i, "Карточка семьи"],
  [/^(?:EMP|USR)(?:-|$)/i, "Сотрудник"],
  [/^(?:SAFE|MED)(?:-|$)/i, "Проверка"],
  [/^(?:REQ|ORD|OFFR|DLV|SHIP|PROD|BATCH|ITEM)(?:-|$)/i, "Запись"],
  [/^(?:AI-CONTRACT)(?:-|$)/i, "Сценарий"],
  [/^(?:AI-SIG)(?:-|$)/i, "Сигнал"],
  [/^(?:AI-RUN)(?:-|$)/i, "Запуск"],
];

export function humanReferenceLabel(value: string, fallbackKind = "Запись"): string {
  const source = value.trim();
  const kind = REFERENCE_KINDS.find(([pattern]) => pattern.test(source))?.[1] ?? fallbackKind;
  return kind === "Задача" ? taskRecordLabel(source) : recordLabel(kind, source);
}

export function humanTechnicalText(value: string): string {
  let result = humanFormulaLabel(value);
  result = result.replace(/\b\d{4}-Q[1-4]\b/gi, (period) => humanPeriodLabel(period));
  result = result.replace(/\b(?:TEST-)?RULES-v?\d+(?:\.\d+)*\b/gi, "правила, проверенные человеком");
  result = result
    .replace(/\bSYNTHETIC_[A-Z0-9_]+\b/g, "тестовый контур")
    .replace(/\bMANUAL_[A-Z0-9_]+\b/g, "ручной ввод")
    .replace(/\bXLSX_[A-Z0-9_]+\b/g, "факт из исходной таблицы");
  result = result.replace(
    /\b(?:AI-(?:CONTRACT|SIG|RUN)|[A-ZА-Я]{2,})(?:[-:][A-ZА-Я0-9.]+)+(?:\/\d+)?\b/g,
    (reference) => humanReferenceLabel(reference),
  );
  result = result
    .replace(/\bnext_payment_minor\b/gi, "сумма следующего платежа")
    .replace(/\bfalse[- ]positive\b/gi, "ложных сигналов")
    .replace(/\bhigh[- ]impact\b/gi, "существенным")
    .replace(/\bLTV\b/g, "ценность семьи")
    .replace(/\bKPI\b/g, "показатели")
    .replace(/\bHR\b/g, "команда")
    .replace(/\bAI\b/g, "ИИ")
    .replace(/\bAPI\b/g, "подключение")
    .replace(/\bXLSX\b/g, "исходная таблица")
    .replace(/\bCRM\b/g, "система продаж")
    .replace(/\bCTR\b/g, "доля переходов")
    .replace(/\bSLA\b/g, "норматив срока")
    .replace(/\breview\b/gi, "проверку")
    .replace(/\bdrift\b/gi, "отклонение")
    .replace(/\bcoverage\b/gi, "покрытие данных")
    .replace(/\bguardrail\b/gi, "контрольное ограничение")
    .replace(/\bquality\b/gi, "качества")
    .replace(/\bshortlist\b/gi, "короткий список");
  return result;
}
