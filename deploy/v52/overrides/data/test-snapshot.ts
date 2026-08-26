export type SourceStatus = "connected" | "stale" | "review" | "planned";

export const snapshot = {
  meta: {
    environment: "РАБОЧИЙ КОНТУР",
    generatedAt: "",
    privacy: "Данных пока нет. Разделы заполняются только после ручного ввода или подтверждённого импорта.",
    sourceMode: "Источники не подключены",
  },
  finance: {
    months: [] as string[],
    receipts: [] as number[],
    outflows: [] as number[],
    cashFlow: [] as number[],
    payroll: [] as number[],
    payrollMonths: [] as string[],
    currentRevenue: 0,
    currentOutflows: 0,
    currentCashFlow: 0,
  },
  payments: {
    schoolMay: { records: 0, paid: 0, outstanding: 0, outstandingCases: 0 },
    kindergartenMay: { records: 0, paid: 0, outstanding: 0, outstandingCases: 0 },
    campJune: { records: 0, paid: 0, outstanding: 0, outstandingCases: 0 },
    kindergartenJune: { records: 0, paid: 0, outstanding: 0, outstandingCases: 0 },
  },
  registers: {
    employeeRows: 0,
    financeSheets: 0,
    payrollSheets: 0,
    paymentSheets: 0,
  },
  qualitySignals: [] as Array<{ id: string; severity: string; title: string; detail: string; owner: string; action: string }>,
  sources: [] as Array<{ id: string; name: string; status: SourceStatus; records: string; updated: string; truth: string }>,
} as const;

export const moduleCatalog = [
  { id: "home", label: "Главная", group: "Рабочий день", status: "ready" },
  { id: "tasks", label: "Задачи", group: "Рабочий день", status: "ready" },
  { id: "finance", label: "Финансы", group: "Управление", status: "data" },
  { id: "accounting", label: "Бухгалтерия и 1С", group: "Управление", status: "test" },
  { id: "registry", label: "Единые карточки", group: "Управление", status: "ready" },
  { id: "sales", label: "Продажи", group: "Управление", status: "test" },
  { id: "clients", label: "Клиенты и семьи", group: "Управление", status: "test" },
  { id: "education", label: "Обучение", group: "Образование", status: "test" },
  { id: "methods", label: "Методики", group: "Образование", status: "test" },
  { id: "hr", label: "Сотрудники", group: "Команда", status: "data" },
  { id: "legal", label: "Документы", group: "Контроль", status: "test" },
  { id: "procurement", label: "Закупки и имущество", group: "Операции", status: "test" },
  { id: "food", label: "Питание", group: "Операции", status: "test" },
  { id: "safety", label: "Безопасность", group: "Контроль", status: "test" },
  { id: "medical", label: "Медицина", group: "Контроль", status: "restricted" },
  { id: "content", label: "Контент", group: "Рост", status: "test" },
  { id: "events", label: "События", group: "Рост", status: "test" },
  { id: "projects", label: "Проекты и KPI", group: "Рост", status: "test" },
  { id: "analytics", label: "Аналитика и ИИ", group: "Рост", status: "test" },
  { id: "contractors", label: "Подрядчики", group: "Операции", status: "test" },
  { id: "assets", label: "Имущество", group: "Операции", status: "test" },
  { id: "quality", label: "Качество и обращения", group: "Контроль", status: "test" },
  { id: "access", label: "Доступы", group: "Система", status: "restricted" },
  { id: "integrations", label: "Интеграции", group: "Система", status: "ready" },
  { id: "acceptance", label: "Приёмка", group: "Система", status: "ready" },
] as const;

export type ModuleId = (typeof moduleCatalog)[number]["id"];
