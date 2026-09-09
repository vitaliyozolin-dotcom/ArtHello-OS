"use client";

import { FormEvent, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ModuleId, moduleCatalog, snapshot } from "../../data/test-snapshot";
import { AppIcon } from "./AppIcon";
import { OwnerDashboard } from "./OwnerDashboard";
import type { AccessContext } from "./SettingsWorkspace";
import "./ShellFoundation.css";
import "./AiryLayout.css";
import "./ContentModern.css";

const RegistryWorkspace = lazy(() => import("./RegistryWorkspace").then((item) => ({ default: item.RegistryWorkspace })));
const WorkflowWorkspace = lazy(() => import("./WorkflowWorkspace").then((item) => ({ default: item.WorkflowWorkspace })));
const FinanceWorkspace = lazy(() => import("./FinanceWorkspace").then((item) => ({ default: item.FinanceWorkspace })));
const SalesWorkspace = lazy(() => import("./SalesWorkspace").then((item) => ({ default: item.SalesWorkspace })));
const FamilyWorkspace = lazy(() => import("./FamilyWorkspace").then((item) => ({ default: item.FamilyWorkspace })));
const ContentWorkspace = lazy(() => import("./ContentWorkspace").then((item) => ({ default: item.ContentWorkspace })));
const EducationWorkspace = lazy(() => import("./EducationWorkspace").then((item) => ({ default: item.EducationWorkspace })));
const HrWorkspace = lazy(() => import("./HrWorkspace").then((item) => ({ default: item.HrWorkspace })));
const LegalWorkspace = lazy(() => import("./LegalWorkspace").then((item) => ({ default: item.LegalWorkspace })));
const ProcurementWorkspace = lazy(() => import("./ProcurementWorkspace").then((item) => ({ default: item.ProcurementWorkspace })));
const FoodWorkspace = lazy(() => import("./FoodWorkspace").then((item) => ({ default: item.FoodWorkspace })));
const SafetyWorkspace = lazy(() => import("./SafetyWorkspace").then((item) => ({ default: item.SafetyWorkspace })));
const MedicalWorkspace = lazy(() => import("./MedicalWorkspace").then((item) => ({ default: item.MedicalWorkspace })));
const AccountingWorkspace = lazy(() => import("./AccountingWorkspace").then((item) => ({ default: item.AccountingWorkspace })));
const StrategyWorkspace = lazy(() => import("./StrategyWorkspace").then((item) => ({ default: item.StrategyWorkspace })));
const IntegrationWorkspace = lazy(() => import("./IntegrationWorkspace").then((item) => ({ default: item.IntegrationWorkspace })));
const ContractorWorkspace = lazy(() => import("./ContractorWorkspace").then((item) => ({ default: item.ContractorWorkspace })));
const AnalyticsWorkspace = lazy(() => import("./AnalyticsWorkspace").then((item) => ({ default: item.AnalyticsWorkspace })));
const ReadinessWorkspace = lazy(() => import("./ReadinessWorkspace").then((item) => ({ default: item.ReadinessWorkspace })));
const SystemWorkspace = lazy(() => import("./SystemWorkspace").then((item) => ({ default: item.SystemWorkspace })));
const SettingsWorkspace = lazy(() => import("./SettingsWorkspace").then((item) => ({ default: item.SettingsWorkspace })));

type Task = {
  id: number;
  title: string;
  owner: string;
  dueDate: string;
  priority: string;
  status: string;
  sourceType: string;
  sourceId: string;
  createdAt: string;
  updatedAt: string;
};

type DrawerData = {
  title: string;
  value?: string;
  summary: string;
  source: string;
  calculation: string;
  updated: string;
  owner: string;
  quality: string;
  lineage: string[];
};

type Metric = {
  label: string;
  value: string;
  note: string;
  tone?: "default" | "warning" | "positive";
  drawer: DrawerData;
};

const rub = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0,
});

const number = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });

const uiStorage = {
  sidebar: "arthello:ui:v1:sidebar",
  recents: "arthello:ui:v1:recent-modules",
  navigationDepth: "arthello:ui:v1:navigation-depth",
  branch: "arthello:ui:v1:branch",
} as const;

// Every implemented workspace remains reachable when its registry is empty.
// Primary input is an action inside Settings, not a replacement for a module.
const manualFirstModules: ReadonlySet<ModuleId> = new Set();

function readStorage(scope: "local" | "session", key: string, legacyKey?: string) {
  if (typeof window === "undefined") return null;
  try {
    const storage = scope === "local" ? window.localStorage : window.sessionStorage;
    return storage.getItem(key) ?? (legacyKey ? storage.getItem(legacyKey) : null);
  } catch {
    return null;
  }
}

function writeStorage(scope: "local" | "session", key: string, value: string) {
  if (typeof window === "undefined") return;
  try {
    const storage = scope === "local" ? window.localStorage : window.sessionStorage;
    storage.setItem(key, value);
  } catch {
    // Preferences remain optional when storage is unavailable (for example, private browsing).
  }
}

const entitySearchIndex: Array<{ id: string; label: string; type: string; meta: string; module: ModuleId }> = [
  { id: "FAM-T-014", label: "Семья Орловых", type: "Семья", meta: "Ученик А-014 · группа 3А", module: "clients" },
  { id: "EMP-T-032", label: "Сотрудник T-032", type: "Сотрудник", meta: "Педагог · Школа 1–11", module: "hr" },
  { id: "DOG-T-2026-044", label: "Договор подрядчика", type: "Договор", meta: "Истекает · требуется акт", module: "legal" },
  { id: "FIN-TEST-CLIENT-014", label: "Платёж семьи T-014", type: "Платёж", meta: "75 000 ₽ · синтетическая операция", module: "finance" },
  { id: "LEAD-T-014", label: "Лид семьи T-014", type: "Лид", meta: "Посещение → договор", module: "sales" },
  { id: "PRG-T-012", label: "Математика 3А", type: "Программа", meta: "Версия 4.2 · на проверке", module: "methods" },
  { id: "EVENT-T-071", label: "День открытых дверей", type: "Событие", meta: "29 августа · Корпус 1", module: "events" },
  { id: "SUP-T-SAFE-001", label: "ООО «Сервис Контур»", type: "Подрядчик", meta: "Нужен закрывающий акт", module: "contractors" },
  { id: "SAFE-EQ-T-001", label: "Контроллер СКУД", type: "Оборудование", meta: "Корпус 1 · после ремонта", module: "assets" },
  { id: "Q-T-014", label: "Обращение семьи T-014", type: "Обращение", meta: "В работе · директор школы", module: "quality" },
];

const dashboardProfiles: Record<string, { label: string }> = {
  "Собственник": { label: "Собственник" },
  "Директор": { label: "Директор" },
  "Финансы": { label: "Финансы" },
  "Продажи": { label: "Продажи" },
  "HR": { label: "HR" },
  "Кухня": { label: "Кухня" },
  "Сотрудник": { label: "Сотрудник" },
  "Представитель Виталия": { label: "Представитель Виталия" },
};

const moduleDetails: Partial<Record<ModuleId, {
  eyebrow: string;
  title: string;
  subtitle: string;
  metrics: Metric[];
  tableTitle: string;
  tableSubtitle: string;
  columns: string[];
  rows: string[][];
}>> = {
  finance: {
    eyebrow: "Контур денег",
    title: "Финансы",
    subtitle: "Платежи, ДДС, ОПиУ и план-факт в одной доказуемой цепочке.",
    metrics: [
      {
        label: "Поступления · апрель",
        value: rub.format(snapshot.finance.currentRevenue),
        note: "Из ОДДС · только чтение",
        drawer: financeDrawer("Поступления за апрель 2026", rub.format(snapshot.finance.currentRevenue), "Строка «Поступления», лист 2026"),
      },
      {
        label: "Списания · апрель",
        value: rub.format(snapshot.finance.currentOutflows),
        note: "Нужна банковская сверка",
        tone: "warning",
        drawer: financeDrawer("Списания за апрель 2026", rub.format(snapshot.finance.currentOutflows), "Строка «Списания», лист 2026"),
      },
      {
        label: "Чистый денежный поток",
        value: rub.format(snapshot.finance.currentCashFlow),
        note: "По формуле исходного файла",
        tone: "positive",
        drawer: financeDrawer("Чистый денежный поток", rub.format(snapshot.finance.currentCashFlow), "Строка «Чистый денежный поток», лист 2026"),
      },
      {
        label: "Зарплатный контур",
        value: rub.format(snapshot.finance.payroll.at(-1) ?? 0),
        note: "Последний доступный итог",
        drawer: {
          title: "Зарплатный контур",
          value: rub.format(snapshot.finance.payroll.at(-1) ?? 0),
          summary: "Сводный итог начислений по группе со школами.",
          source: "Зарплатная ведомость.xlsx · лист «СВОД ДЛЯ ОПИУ»",
          calculation: "Сумма подразделений по исходным формулам файла",
          updated: "Последний доступный расчёт в источнике",
          owner: "Финансовый контролёр + HR",
          quality: "Требует разделения активных и исторических сотрудников",
          lineage: ["Строка начисления", "Сотрудник", "Подразделение", "Месяц", "Свод ОПиУ"],
        },
      },
    ],
    tableTitle: "Платёжная дисциплина",
    tableSubtitle: "Агрегаты без персональных данных",
    columns: ["Контур", "Период", "Записей", "Оплачено", "Остаток", "Случаев"],
    rows: [
      ["Школа", "Май 2026", "30", rub.format(snapshot.payments.schoolMay.paid), rub.format(snapshot.payments.schoolMay.outstanding), "2"],
      ["Детский сад", "Май 2026", "78", rub.format(snapshot.payments.kindergartenMay.paid), rub.format(snapshot.payments.kindergartenMay.outstanding), "1"],
      ["Лагерь", "Июнь 2026", "15", rub.format(snapshot.payments.campJune.paid), rub.format(snapshot.payments.campJune.outstanding), "7"],
      ["Детский сад", "Июнь 2026", "55", rub.format(snapshot.payments.kindergartenJune.paid), rub.format(snapshot.payments.kindergartenJune.outstanding), "35"],
    ],
  },
  accounting: genericModule(
    "От первички до проводки",
    "Бухгалтерия и 1С",
    "Документы, ЭДО, закрывающие и выгрузка в 1С с контролем расхождений.",
    [
      ["Первичных документов", "164", "Синтетический тестовый набор"],
      ["Без закрывающих", "17", "Связаны с задачами"],
      ["К выгрузке в 1С", "28", "Только после сверки"],
      ["Расхождений", "3", "Автопроведение запрещено"],
    ],
    ["DOC-T-401", "Акт поставщика", "REQ-T-088", "Готов к сверке", "Бухгалтер T-02"],
    ["DOC-T-405", "Счёт", "DOG-T-2026-044", "Нет акта", "Финконтроль"],
    ["EXP-T-019", "Пакет 1С", "28 документов", "Черновик", "Главный бухгалтер"],
  ),
  sales: genericModule(
    "Рост выручки",
    "Продажи",
    "Воронка от первого клика до договора и платежа — без потерянных источников.",
    [
      ["Новые обращения", "42", "Синтетический тестовый набор"],
      ["Записаны на встречу", "18", "43% от обращений"],
      ["Договоры", "7", "Источник и оффер сохранены"],
      ["Без источника", "5", "Требуют разбора"],
    ],
    ["Лид T-1042", "Сайт · форма школы", "Консультация", "Сегодня, 14:00", "Источник сохранён"],
    ["Лид T-1041", "Telegram", "Новая заявка", "Сегодня, 12:20", "Нужен ответственный"],
    ["Лид T-1038", "Не определён", "Диагностика", "Вчера", "UTM отсутствует"],
  ),
  clients: genericModule(
    "Единая карточка",
    "Клиенты и семьи",
    "Семья, ребёнок, договор, обучение и деньги связаны одним идентификатором.",
    [
      ["Семьи", "108", "Синтетический набор"],
      ["Дети", "133", "Без персональных данных"],
      ["Активные договоры", "121", "11 требуют сверки"],
      ["Риск ухода", "8", "Только сигнал, не решение"],
    ],
    ["FAM-T-014", "Семья Орловых", "Ученик А-014", "3А · тестовая группа", "Нет долга"],
    ["FAM-T-021", "Семья Соколовых", "Ученик А-021", "Сад · группа 2", "Нужен акт"],
    ["FAM-T-033", "Семья Волковых", "Ученик А-033", "Подготовка", "Платёж 5 сентября"],
  ),
  education: genericModule(
    "Учебный день",
    "Обучение",
    "Расписание, посещаемость, задания и прогресс с правами по роли.",
    [
      ["Занятий сегодня", "36", "4 корпуса"],
      ["Посещаемость", "92%", "Тестовый период"],
      ["Непроверенные ДЗ", "14", "У 5 педагогов"],
      ["Замены", "2", "Подтверждены"],
    ],
    ["09:00", "3А · математика", "Педагог T-032", "Кабинет 12", "Идёт"],
    ["10:10", "Сад · музыка", "Педагог T-018", "Зал", "По плану"],
    ["11:30", "5Б · проект", "Педагог T-041", "Лаборатория", "Замена"],
  ),
  methods: genericModule(
    "Качество программы",
    "Методики",
    "Версии программ, материалы, результаты и доказанные улучшения.",
    [
      ["Активные программы", "24", "У каждой есть версия"],
      ["На пересмотре", "3", "Назначены владельцы"],
      ["Материалов", "186", "С проверкой доступа"],
      ["Сигналов улучшения", "7", "Не применяются автоматически"],
    ],
    ["PRG-T-012", "Математика 3А", "v4.2", "Методист T-04", "На проверке"],
    ["PRG-T-007", "Речь и театр", "v2.8", "Методист T-11", "Действует"],
    ["PRG-T-019", "Проектная лаборатория", "v1.3", "Методист T-04", "Нужна метрика"],
  ),
  hr: genericModule(
    "Единый сотрудник",
    "Сотрудники",
    "Карточка сотрудника связывает договор, ставку, доступы, задачи и выплаты.",
    [
      ["Строк в источнике", number.format(snapshot.registers.employeeRows), "Не равно активному штату"],
      ["Активные карточки", "—", "До дедупликации не считаем"],
      ["Доступы на проверке", "6", "Синтетический тест"],
      ["Документы истекают", "4", "На горизонте 30 дней"],
    ],
    ["EMP-T-032", "Педагог", "Школа 1–11", "Договор активен", "Доступ активен"],
    ["EMP-T-018", "Педагог", "Детский сад", "Нужна аттестация", "Доступ активен"],
    ["EMP-T-004", "Администратор", "УК", "Истекает договор", "Проверить"],
  ),
  legal: genericModule(
    "Обязательства",
    "Документы",
    "Договоры, приложения, акты и сроки без потери версий.",
    [
      ["Договоров", "284", "Синтетический набор"],
      ["Без подписи", "9", "Блокирующий контроль"],
      ["Истекают за 30 дней", "12", "Задачи сформированы"],
      ["Нет закрывающих", "17", "Связать с оплатами"],
    ],
    ["DOG-T-2026-014", "Клиентский", "ООО «АртХелло»", "31.08.2027", "Действует"],
    ["DOG-T-2026-044", "Подрядчик", "УК", "02.09.2026", "Истекает"],
    ["ACT-T-198", "Акт", "ИП Тюрин П.О.", "—", "Нет подписи"],
  ),
  procurement: genericModule(
    "От заявки до оплаты",
    "Закупки и имущество",
    "Согласования, поставщики, склад, оборудование и закрывающие документы.",
    [
      ["Заявки", "23", "7 ждут решения"],
      ["Без сравнения цен", "4", "Проверка закупки"],
      ["Оборудование", "417", "Синтетический реестр"],
      ["Гарантия истекает", "6", "В течение 45 дней"],
    ],
    ["REQ-T-088", "Ноутбуки · 4 шт.", rub.format(320000), "Сравнение цен", "Снабжение"],
    ["REQ-T-091", "Фильтры кухни", rub.format(48000), "Согласование", "Кухня"],
    ["EQ-T-117", "Проектор", "Корпус 1", "Проверка 26.08", "Ответственный T-09"],
  ),
  food: genericModule(
    "Центр прибыли",
    "Питание",
    "Партии, ТТК, производство, отгрузки и себестоимость кухни.",
    [
      ["Отгрузок сегодня", "11", "4 объекта"],
      ["Себестоимость порции", rub.format(214), "Синтетический расчёт"],
      ["Партии у срока", "3", "Нужна проверка"],
      ["Списания", "1.8%", "Цель ≤ 2.0%"],
    ],
    ["BATCH-T-311", "Молоко", "24 л", "24.08.2026", "Кухня"],
    ["MENU-T-221", "Меню · пятница", "286 порций", "Готово", "Технолог T-06"],
    ["SHIP-T-199", "Корпус 2", "64 порции", "08:15", "Принято"],
  ),
  safety: genericModule(
    "Управляемый риск",
    "Безопасность",
    "Проверка создаёт задачу, ремонт завершается актом и следующей датой.",
    [
      ["Объектов", "4", "Синтетический реестр"],
      ["Проверок в августе", "12", "9 завершено"],
      ["Неисправности", "3", "Одна высокой важности"],
      ["Акты отсутствуют", "2", "Оплата заблокирована"],
    ],
    ["INC-T-031", "СКУД · корпус 1", "Высокий", "Подрядчик T-12", "В работе"],
    ["CHK-T-090", "Пожарная сигнализация", "Плановая", "Ответственный T-03", "26.08"],
    ["EQ-T-288", "Камера · вход", "Средний", "Подрядчик T-18", "Нужен акт"],
  ),
  medical: genericModule(
    "Особые права",
    "Медицинское сопровождение",
    "Данные скрыты по умолчанию; каждый просмотр должен попадать в аудит.",
    [
      ["Доступ", "Ограничен", "Только медроль и уполномоченный директор"],
      ["Открытых случаев", "Скрыто", "Нет права на агрегат"],
      ["Истекающих справок", "Скрыто", "Запросить специальный доступ"],
      ["Аудит просмотров", "Включён", "Запись обязательна"],
    ],
    ["MED-T-—", "Данные скрыты", "—", "—", "Нет специальных прав"],
  ),
  content: genericModule(
    "От публикации до денег",
    "Контент",
    "Контент-план связывает публикацию, переход, заявку, договор и выручку.",
    [
      ["Публикаций", "18", "Тестовый месяц"],
      ["Переходов", "1 284", "Сохраняем UTM"],
      ["Заявок", "37", "2.9% от переходов"],
      ["Договоров", "6", "Выручка требует сверки"],
    ],
    ["POST-T-181", "Как выбрать школу", "VK · Telegram", "482 перехода", "4 заявки"],
    ["POST-T-177", "Открытый день", "Reels", "316 переходов", "11 заявок"],
    ["POST-T-169", "Летняя программа", "VK", "208 переходов", "Источник сохранён"],
  ),
  projects: genericModule(
    "Цели и исполнение",
    "Проекты и KPI",
    "Цель раскрывается до инициативы, бюджета, задачи и результата.",
    [
      ["Активных проектов", "9", "3 под риском"],
      ["KPI в норме", "18 из 27", "Синтетический набор"],
      ["Просроченных шагов", "6", "Назначены владельцы"],
      ["Бюджет под риском", rub.format(1240000), "Требует подтверждения"],
    ],
    ["PRJ-T-001", "ArtHello OS", "Платформенное ядро", "В работе", "Представитель Виталия"],
    ["PRJ-T-006", "Набор 2026/27", "Продажи", "Под риском", "Директор по продажам"],
    ["PRJ-T-009", "Кухня как ЦФР", "Финмодель", "На проверке", "Операционный директор"],
  ),
  analytics: genericModule(
    "Решения с доказательствами",
    "Аналитика и ИИ",
    "Прогнозы отделены от факта, имеют версию, владельца и объяснение факторов.",
    [
      ["Панелей", "12", "Тестовый каталог"],
      ["Сигналов", "7", "Не принимают решения автоматически"],
      ["Прогнозов", "4", "Отмечены как модельные"],
      ["Качество источников", "2 из 5", "Два источника требуют проверки"],
    ],
    ["AI-T-011", "Прогноз денежного потока", "Модель v0.1", "Требует сверки", "Финансовый контролёр"],
    ["DQ-T-003", "Дедупликация сотрудников", "Правило качества", "Задача создана", "HR"],
    ["RISK-T-008", "Риск ухода семей", "Синтетическая модель", "Только сигнал", "Директор"],
  ),
};

function financeDrawer(title: string, value: string, source: string): DrawerData {
  return {
    title,
    value,
    summary: "Агрегат импортирован без изменения исходного файла.",
    source: `Атлас ОДДС 01.01.2023–31.01.2026.xlsx · ${source}`,
    calculation: "Значение и формула исходного файла; банковская операция ещё не подключена",
    updated: "21 августа 2026 · импорт для тестового контура",
    owner: "Финансовый контролёр",
    quality: "Средняя — агрегат прочитан, первичные операции не сверены",
    lineage: ["ОДДС · лист 2026", "Статья", "Месяц", "Агрегат", "Управленческий показатель"],
  };
}

function genericModule(
  eyebrow: string,
  title: string,
  subtitle: string,
  metricRows: string[][],
  ...rows: string[][]
) {
  return {
    eyebrow,
    title,
    subtitle,
    metrics: metricRows.map((item) => ({
      label: item[0],
      value: item[1],
      note: item[2],
      drawer: {
        title: item[0],
        value: item[1],
        summary: "Показатель демонстрирует целевую структуру карточки в тестовом контуре.",
        source: "Синтетический набор ArtHello OS",
        calculation: "Тестовое правило расчёта; не использовать для управленческих решений",
        updated: snapshot.meta.generatedAt,
        owner: "Владелец соответствующего процесса",
        quality: "Тестовые данные",
        lineage: ["Тестовая запись", "Доменная сущность", "Агрегат", "Карточка показателя"],
      },
    })),
    tableTitle: `${title}: рабочий реестр`,
    tableSubtitle: "Синтетические записи для проверки сценариев",
    columns: title === "Продажи"
      ? ["Запись", "Источник", "Этап", "Следующий шаг", "Контроль"]
      : ["ID", "Объект", "Связь", "Состояние", "Следующий шаг"],
    rows,
  };
}

const productionRoleLabels: Record<string, string> = {
  owner: "Собственник",
  accountant: "Финансы",
  viewer: "Сотрудник",
};

export default function ArtHelloShell({ displayName, authenticatedRole, onLogout }: { displayName: string; authenticatedRole?: string; onLogout?: () => void }) {
  const [active, setActive] = useState<ModuleId>("home");
  const [query, setQuery] = useState("");
  const [role, setRole] = useState(productionRoleLabels[authenticatedRole ?? ""] ?? "Собственник");
  const [drawer, setDrawer] = useState<DrawerData | null>(null);
  const [taskOpen, setTaskOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [, setRecentModules] = useState<ModuleId[]>([]);
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([]);
  const [administrative, setAdministrative] = useState(true);
  const [selectedBranch, setSelectedBranch] = useState("ALL");
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollPositions = useRef<Record<string, number>>({});
  const navigationDepth = useRef(0);

  const applyAccessContext = useCallback((context: AccessContext) => {
    setRole(productionRoleLabels[authenticatedRole ?? ""] ?? context.me.role);
    setBranches(context.branches);
    const isAdministrative = authenticatedRole ? authenticatedRole === "owner" : context.me.isAdministrative;
    setAdministrative(isAdministrative);
    const allowed = isAdministrative ? context.branches.map((branch) => branch.id) : context.access.map((grant) => grant.branchId);
    const saved = readStorage("local", uiStorage.branch);
    const next = isAdministrative && saved === "ALL" ? "ALL" : saved && allowed.includes(saved) ? saved : isAdministrative ? "ALL" : allowed[0] ?? "";
    setSelectedBranch(next);
    writeStorage("local", uiStorage.branch, next);
    document.cookie = `arthello_branch=${encodeURIComponent(next)}; Path=/; SameSite=Lax`;
  }, [authenticatedRole]);

  useEffect(() => {
    void loadTasks();
    const loadAccessContext = async () => {
      try {
        const response = await fetch("/api/settings", { cache: "no-store" });
        if (response.ok) applyAccessContext((await response.json()) as AccessContext);
      } catch { /* The owner fallback remains available while settings reconnect. */ }
    };
    void loadAccessContext();

    const preferenceHydration = window.setTimeout(() => {
      setSidebarCollapsed(readStorage("local", uiStorage.sidebar, "arthello:sidebar") === "collapsed");
      const savedRecent = readStorage("local", uiStorage.recents, "arthello:recent-modules");
      if (savedRecent) {
        try {
          setRecentModules((JSON.parse(savedRecent) as ModuleId[]).filter((id) => moduleCatalog.some((item) => item.id === id)).slice(0, 3));
        } catch {
          writeStorage("local", uiStorage.recents, "[]");
        }
      }
    }, 0);

    const openHashModule = () => {
      const requested = window.location.hash.slice(1) as ModuleId;
      if (moduleCatalog.some((module) => module.id === requested)) {
        setActive(requested);
        requestAnimationFrame(() => contentRef.current?.scrollTo({ top: scrollPositions.current[requested] ?? 0 }));
      }
    };
    const onPopState = () => {
      navigationDepth.current = Math.max(0, navigationDepth.current - 1);
      writeStorage("session", uiStorage.navigationDepth, String(navigationDepth.current));
      openHashModule();
    };
    const onKeyboard = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen((value) => !value);
      }
      if (event.key === "Escape") {
        setCommandOpen(false);
        setDrawer(null);
      }
    };
    navigationDepth.current = Number(readStorage("session", uiStorage.navigationDepth, "arthello:navigation-depth") ?? 0);
    const initialRoute = window.setTimeout(openHashModule, 0);
    window.addEventListener("popstate", onPopState);
    window.addEventListener("keydown", onKeyboard);
    return () => {
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("keydown", onKeyboard);
      window.clearTimeout(initialRoute);
      window.clearTimeout(preferenceHydration);
    };
  }, [applyAccessContext]);

  function changeBranch(branchId: string) {
    setSelectedBranch(branchId);
    writeStorage("local", uiStorage.branch, branchId);
    document.cookie = `arthello_branch=${encodeURIComponent(branchId)}; Path=/; SameSite=Lax`;
    setNotice(branchId === "ALL" ? "Показаны все филиалы административного корпуса" : `Рабочий филиал: ${branches.find((branch) => branch.id === branchId)?.name ?? branchId}`);
    window.dispatchEvent(new CustomEvent("arthello:branch-changed", { detail: branchId }));
  }

  async function loadTasks() {
    try {
      const response = await fetch("/api/tasks", { cache: "no-store" });
      if (!response.ok) throw new Error("Не удалось загрузить задачи");
      const payload = (await response.json()) as { tasks: Task[] };
      setTasks(payload.tasks);
    } catch {
      setTasks([]);
    }
  }

  function openModule(id: ModuleId) {
    if (contentRef.current) scrollPositions.current[active] = contentRef.current.scrollTop;
    setActive(id);
    setQuery("");
    setNavOpen(false);
    if (id !== "home") {
      setRecentModules((current) => {
        const next = [id, ...current.filter((item) => item !== id)].slice(0, 3);
        writeStorage("local", uiStorage.recents, JSON.stringify(next));
        return next;
      });
    }
    if (typeof window !== "undefined") {
      if (window.location.hash !== `#${id}`) {
        window.history.pushState({ module: id }, "", `#${id}`);
        navigationDepth.current += 1;
        writeStorage("session", uiStorage.navigationDepth, String(navigationDepth.current));
      }
      requestAnimationFrame(() => contentRef.current?.scrollTo({ top: scrollPositions.current[id] ?? 0, behavior: "auto" }));
    }
  }

  function goBack() {
    if (navigationDepth.current > 0) window.history.back();
    else openModule("home");
  }

  function toggleSidebar() {
    setSidebarCollapsed((current) => {
      const next = !current;
      writeStorage("local", uiStorage.sidebar, next ? "collapsed" : "expanded");
      return next;
    });
  }

  const searchResults = useMemo(() => {
    const clean = query.trim().toLowerCase();
    if (clean.length < 2) return [];
    const modules = moduleCatalog
      .filter((module) => `${module.label} ${module.group}`.toLowerCase().includes(clean))
      .map((module) => ({ id: module.id, label: module.label, type: "Раздел", meta: module.group, module: module.id as ModuleId }));
    const entities = entitySearchIndex.filter((item) => `${item.id} ${item.label} ${item.type} ${item.meta}`.toLowerCase().includes(clean));
    const taskResults = tasks.filter((task) => `${task.id} ${task.title} ${task.owner} ${task.sourceId}`.toLowerCase().includes(clean)).map((task) => ({ id: `TASK-${task.id}`, label: task.title, type: "Задача", meta: `${task.owner} · ${task.status}`, module: "tasks" as ModuleId }));
    return [...modules, ...entities, ...taskResults].slice(0, 8);
  }, [query, tasks]);

  const activeEntry = moduleCatalog.find((item) => item.id === active) ?? moduleCatalog[0];
  const primaryNav = ["home", "finance", "clients", "education", "hr", "sales", "content", "tasks", "legal", "analytics"] as ModuleId[];
  const favoriteNav = ["registry", "clients", "legal", "hr", "projects"] as ModuleId[];
  const extraNav = moduleCatalog.filter((item) => !primaryNav.includes(item.id) && !favoriteNav.includes(item.id));
  const navLabels: Partial<Record<ModuleId, string>> = { finance: "Деньги", clients: "Клиенты", hr: "Команда", legal: "Документы", projects: "План-факт" };

  const renderNavItem = (item: typeof moduleCatalog[number], keyPrefix = "") => (
    <a
      href={`#${item.id}`}
      className={`nav-item ${active === item.id ? "active" : ""}`}
      key={`${keyPrefix}${item.id}`}
      title={item.label}
      onClick={(event) => { event.preventDefault(); openModule(item.id); }}
    >
      <span className="nav-mark"><AppIcon name={item.id} /></span>
      <span>{navLabels[item.id] ?? item.label}</span>
      {item.id === "tasks" && tasks.length > 0 ? <b>{tasks.length}</b> : null}
      {item.status === "restricted" ? <em>особые права</em> : null}
    </a>
  );

  return (
    <div className={`os-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <aside className={`sidebar ${navOpen ? "sidebar-open" : ""}`} aria-label="Основная навигация">
        <div className="brand-row">
          <button className="brand-home" onClick={() => openModule("home")} aria-label="На персональный дашборд">
            <span className="brand-mark brand-mark-new" aria-hidden="true"><i /><i /></span>
          </button>
          <div className="brand-copy">
            <strong>ArtHello <span>OS</span></strong>
          </div>
          <button className="sidebar-close" onClick={() => setNavOpen(false)} aria-label="Закрыть меню">×</button>
        </div>
        <nav className="nav-scroll">
          <div className="nav-group"><p>Основное</p>{primaryNav.map((id) => renderNavItem(moduleCatalog.find((item) => item.id === id)!))}</div>
          <div className="nav-group"><p>Избранное</p>{favoriteNav.map((id) => renderNavItem(moduleCatalog.find((item) => item.id === id)!, "favorite-"))}</div>
          <details className="nav-more">
            <summary><AppIcon name="more" /><span>Все разделы</span></summary>
            <div className="nav-group">{extraNav.map((item) => renderNavItem(item, "extra-"))}</div>
          </details>
        </nav>
        <div className="sidebar-tools" aria-label="Системные действия">
          <button onClick={() => setCommandOpen(true)} title="Командная палитра"><AppIcon name="command" /><span>Команды</span><kbd>⌘K</kbd></button>
          {authenticatedRole === undefined || authenticatedRole === "owner" ? <button onClick={() => setSettingsOpen(true)} title="Настройки"><AppIcon name="settings" /><span>Настройки</span></button> : null}
          <button onClick={() => setNotice("Откройте командную палитру: там собраны разделы, сущности и быстрые действия")} title="Помощь"><AppIcon name="help" /><span>Помощь</span></button>
          {onLogout ? <button onClick={onLogout} title="Выйти из системы"><AppIcon name="logout" /><span>Выйти</span></button> : null}
        </div>
        <div className="sidebar-user">
          <div className="avatar">{initials(displayName)}</div>
          <div><strong>{displayName}</strong><span>{role}</span></div>
        </div>
        <div className="sidebar-version"><span>ArtHello OS</span><b>v1.0.0</b></div>
        <button className="sidebar-collapse" onClick={toggleSidebar} aria-label={sidebarCollapsed ? "Развернуть меню" : "Свернуть меню"} title={sidebarCollapsed ? "Развернуть меню" : "Свернуть меню"}><AppIcon name="collapse" /><span>{sidebarCollapsed ? "Развернуть" : "Свернуть"}</span></button>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <button
            className="mobile-menu"
            onClick={active === "home" ? () => setNavOpen(true) : goBack}
            aria-label={active === "home" ? "Открыть меню" : "Вернуться назад"}
          >
            <AppIcon name={active === "home" ? "menu" : "back"} />
          </button>
          <div className="mobile-shell-title" aria-live="polite">
            <strong>{active === "home" ? "ArtHello" : activeEntry.label}</strong>
            <span>{active === "home" ? "Рабочий контур" : activeEntry.group}</span>
          </div>
          <div className="search-wrap">
            <AppIcon name="search" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Найти раздел, семью, документ или задачу"
              aria-label="Глобальный поиск"
            />
            {searchResults.length > 0 ? (
              <div className="search-results">
                {searchResults.map((result) => (
                  <button key={result.id} onClick={() => openModule(result.module)}>
                    <span className="nav-mark"><AppIcon name={result.module} /></span>
                    <span><strong>{result.label}</strong><small>{result.type} · {result.meta}</small></span>
                  </button>
                ))}
              </div>
            ) : null}
            <button className="command-trigger" onClick={() => setCommandOpen(true)} aria-label="Открыть командную палитру"><kbd>⌘ K</kbd></button>
          </div>
          <div className="mobile-top-actions">
            <button onClick={() => setCommandOpen(true)} aria-label="Открыть поиск"><AppIcon name="search" /></button>
            <button className="create" onClick={() => setTaskOpen(true)} aria-label="Создать задачу"><AppIcon name="plus" /></button>
          </div>
          <div className="top-actions">
            <div className="scope-switcher" aria-label="Рабочий контекст">
              <label><span className="sr-only">Филиал</span><select aria-label="Выбрать филиал" value={selectedBranch} onChange={(event) => changeBranch(event.target.value)}>{administrative ? <option value="ALL">Все филиалы</option> : null}{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
            </div>
            <button className="freshness" onClick={() => openModule("integrations")}><span /> Данные: есть замечания</button>
            <button className="top-icon-action create" onClick={() => setTaskOpen(true)} aria-label="Быстро создать задачу" title="Быстро создать"><AppIcon name="plus" /></button>
            <button className="top-icon-action" onClick={() => openModule("tasks")} aria-label={`Открыть задачи: ${tasks.length}`} title="Задачи"><AppIcon name="tasks" />{tasks.length > 0 ? <b>{tasks.length}</b> : null}</button>
            <button className="top-icon-action" onClick={() => setNotice("Новых системных уведомлений нет")} aria-label="Уведомления" title="Уведомления"><AppIcon name="bell" /></button>
            <button className="role-switch" onClick={() => authenticatedRole === undefined || authenticatedRole === "owner" ? setSettingsOpen(true) : setNotice("Настройки доступны собственнику")}><span>{role}</span></button>
          </div>
        </header>

        {active !== "home" ? (
          <div className="context-bar">
            <button className="back-action" onClick={goBack}><AppIcon name="back" />Назад</button>
            <nav aria-label="Хлебные крошки">
              <button onClick={() => openModule("home")}>Главная</button><AppIcon name="chevron" />
              <span>{activeEntry.group}</span><AppIcon name="chevron" />
              <strong aria-current="page">{activeEntry.label}</strong>
            </nav>
            <div><button onClick={() => contentRef.current?.scrollTo({ top: 0, behavior: "smooth" })}>Начало раздела</button><button onClick={() => setCommandOpen(true)}><AppIcon name="command" />Команды</button></div>
          </div>
        ) : null}

        <div className="content-frame" ref={contentRef}>
          <div className="route-stage" key={active}>
          <Suspense fallback={<section className="workspace-loading" aria-live="polite"><span /><strong>Открываем рабочее пространство…</strong><small>Контекст и навигация уже доступны</small></section>}>
          {manualFirstModules.has(active) ? (
            <ManualStartWorkspace module={active} selectedBranch={selectedBranch} branches={branches} openSettings={() => setSettingsOpen(true)} openIntegrations={() => openModule("integrations")} />
          ) : active === "home" ? (
            <HomeView
              displayName={displayName}
              role={role}
              setActive={openModule}
              setDrawer={setDrawer}
              createTask={() => setTaskOpen(true)}
              tasks={tasks}
              sourceOnly
            />
          ) : active === "tasks" ? (
            <WorkflowWorkspace role={role} notify={setNotice} onChanged={loadTasks} />
          ) : active === "registry" ? (
            <RegistryWorkspace notify={setNotice} />
          ) : active === "finance" ? (
            <FinanceWorkspace role={role} notify={setNotice} onTasksChanged={loadTasks} />
          ) : active === "sales" ? (
            <SalesWorkspace workspace="sales" role={role} notify={setNotice} onTasksChanged={loadTasks} onOpenFinance={() => openModule("finance")} />
          ) : active === "clients" ? (
            <FamilyWorkspace notify={setNotice} onOpenIntegrations={() => openModule("integrations")} />
          ) : active === "content" ? (
            <ContentWorkspace sourceOnly role={role} notify={setNotice} onTasksChanged={loadTasks} onOpenSales={() => openModule("sales")} onOpenFinance={() => openModule("finance")} />
          ) : active === "education" || active === "methods" ? (
            <EducationWorkspace key={active} workspace={active} role={role} notify={setNotice} onTasksChanged={loadTasks} />
          ) : active === "hr" ? (
            <HrWorkspace role={role} notify={setNotice} onTasksChanged={loadTasks} />
          ) : active === "legal" ? (
            <LegalWorkspace role={role} notify={setNotice} onTasksChanged={loadTasks} />
          ) : active === "procurement" ? (
            <ProcurementWorkspace role={role} notify={setNotice} onTasksChanged={loadTasks} onOpenFinance={() => openModule("finance")} />
          ) : active === "food" ? (
            <FoodWorkspace role={role} notify={setNotice} onTasksChanged={loadTasks} onOpenFinance={() => openModule("finance")} />
          ) : active === "safety" ? (
            <SafetyWorkspace role={role} notify={setNotice} onTasksChanged={loadTasks} onOpenFinance={() => openModule("finance")} />
          ) : active === "medical" ? (
            <MedicalWorkspace role={role} notify={setNotice} />
          ) : active === "accounting" ? (
            <AccountingWorkspace role={role} notify={setNotice} onTasksChanged={loadTasks} onOpenFinance={() => openModule("finance")} />
          ) : active === "projects" ? (
            <StrategyWorkspace role={role} notify={setNotice} onTasksChanged={loadTasks} />
          ) : active === "contractors" ? (
            <ContractorWorkspace notify={setNotice} onOpenFinance={() => openModule("finance")} />
          ) : active === "events" || active === "access" || active === "assets" || active === "quality" ? (
            <SystemWorkspace module={active} role={role} notify={setNotice} createTask={() => setTaskOpen(true)} navigate={openModule} />
          ) : active === "integrations" ? (
            <IntegrationWorkspace role={role} notify={setNotice} onTasksChanged={loadTasks} />
          ) : active === "analytics" ? (
            <AnalyticsWorkspace role={role} notify={setNotice} onTasksChanged={loadTasks} />
          ) : active === "acceptance" ? (
            <ReadinessWorkspace role={role} notify={setNotice} />
          ) : (
            <ModuleView module={active} setDrawer={setDrawer} createTask={() => setTaskOpen(true)} />
          )}
          </Suspense>
          </div>
        </div>
      </main>

      {drawer ? <DetailDrawer data={drawer} close={() => setDrawer(null)} createTask={() => { setDrawer(null); setTaskOpen(true); }} /> : null}
      {taskOpen ? <TaskModal close={() => setTaskOpen(false)} refresh={loadTasks} notify={setNotice} /> : null}
      {notice ? <div className="toast" role="status">{notice}<button onClick={() => setNotice(null)}>×</button></div> : null}
      {navOpen ? <button className="nav-scrim" aria-label="Закрыть меню" onClick={() => setNavOpen(false)} /> : null}
      {commandOpen ? <CommandPalette tasks={tasks} close={() => setCommandOpen(false)} navigate={(id) => { openModule(id); setCommandOpen(false); }} createTask={() => { setCommandOpen(false); setTaskOpen(true); }} /> : null}
      {settingsOpen && (authenticatedRole === undefined || authenticatedRole === "owner") ? <Suspense fallback={<div className="settings-layer"><button className="drawer-scrim" onClick={() => setSettingsOpen(false)} aria-label="Закрыть настройки" /><section className="settings-modal" role="dialog" aria-modal="true" aria-label="Настройки"><div className="settings-state"><strong>Открываем настройки…</strong><span>Проверяем роль владельца и доступные филиалы</span></div></section></div>}><SettingsWorkspace close={() => setSettingsOpen(false)} notify={setNotice} onContextChanged={applyAccessContext} /></Suspense> : null}
      <nav className="mobile-dock" aria-label="Мобильная навигация">
        <button className={active === "home" ? "active" : ""} onClick={() => openModule("home")}><AppIcon name="home" /><span>Главная</span></button>
        <button className={active === "tasks" ? "active" : ""} onClick={() => openModule("tasks")}><AppIcon name="tasks" /><span>Задачи</span></button>
        <button className="mobile-create" onClick={() => setTaskOpen(true)}><AppIcon name="plus" /><span>Создать</span></button>
        <button onClick={() => setCommandOpen(true)}><AppIcon name="search" /><span>Поиск</span></button>
        <button onClick={() => setNavOpen(true)}><AppIcon name="registry" /><span>Разделы</span></button>
      </nav>
    </div>
  );
}

function HomeView({
  displayName,
  role,
  setActive,
  setDrawer,
  createTask,
  tasks,
  sourceOnly,
}: {
  displayName: string;
  role: string;
  setActive: (id: ModuleId) => void;
  setDrawer: (value: DrawerData) => void;
  createTask: () => void;
  tasks: Task[];
  sourceOnly: boolean;
}) {
  const profile = dashboardProfiles[role] ?? dashboardProfiles.Сотрудник;
  return (
    <OwnerDashboard
      displayName={displayName}
      roleLabel={profile.label}
      tasks={tasks}
      sourceOnly={sourceOnly}
      navigate={setActive}
      createTask={createTask}
      openOperation={setDrawer}
    />
  );
}

const manualTypesByModule: Partial<Record<ModuleId, string[]>> = {
  sales: ["Семья", "Ребёнок", "Договор", "Начисление", "Оплата"],
  education: ["Ребёнок", "Класс или группа", "Занятие", "Дополнительное занятие"],
  methods: ["Класс или группа", "Занятие", "Дополнительное занятие"],
  hr: ["Сотрудник", "Заработная плата"], legal: ["Договор"], accounting: ["ДДС", "ОПиУ", "Заработная плата", "Договор", "Оплата"],
  projects: ["Другое"], events: ["Другое"], procurement: ["Договор", "Оплата", "Другое"], food: ["Оплата", "Другое"],
  safety: ["Договор", "Другое"], medical: ["Другое"], assets: ["Другое"], quality: ["Другое"], access: ["Сотрудник"], analytics: ["ДДС", "ОПиУ", "Заработная плата", "Оплата"],
};

function ManualStartWorkspace({ module, selectedBranch, branches, openSettings, openIntegrations }: { module: ModuleId; selectedBranch: string; branches: Array<{ id: string; name: string }>; openSettings: () => void; openIntegrations: () => void }) {
  const [records, setRecords] = useState<Array<{ id: string; branchId: string; recordType: string; title: string; period: string; amountMinor: number; status: string }>>([]);
  useEffect(() => {
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/settings", { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json() as { records: typeof records };
        const allowedTypes = manualTypesByModule[module] ?? ["Другое"];
        setRecords(payload.records.filter((record) => allowedTypes.includes(record.recordType) && (selectedBranch === "ALL" || record.branchId === selectedBranch)));
      } catch { setRecords([]); }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [module, selectedBranch]);
  const entry = moduleCatalog.find((item) => item.id === module);
  const branchName = selectedBranch === "ALL" ? "Все филиалы" : branches.find((branch) => branch.id === selectedBranch)?.name ?? "Филиал";
  return <section className="page manual-start-workspace"><header><div><p className="eyebrow">Первичный ввод · {branchName}</p><h1>{entry?.label}</h1><p>Здесь показываются только данные, введённые вручную или полученные из выбранных вами полей интеграции.</p></div><div><button onClick={openSettings}>+ Ввести данные</button><button onClick={openIntegrations}>Подключить источник</button></div></header>{records.length ? <div className="manual-module-list">{records.map((record) => <article key={record.id}><span>{record.recordType}</span><h2>{record.title}</h2><p>{branches.find((branch) => branch.id === record.branchId)?.name}{record.period ? ` · ${record.period}` : ""}</p><footer><strong>{record.amountMinor ? rub.format(record.amountMinor / 100) : record.status}</strong><em>{record.id}</em></footer></article>)}</div> : <div className="manual-module-empty"><span>＋</span><h2>Данных пока нет</h2><p>Введите исходные записи вручную или подключите источник и выберите, какие именно поля разрешено получать.</p><button onClick={openSettings}>Открыть первичный ввод</button></div>}</section>;
}

function ModuleView({ module, setDrawer, createTask }: { module: ModuleId; setDrawer: (value: DrawerData) => void; createTask: () => void }) {
  const detail = moduleDetails[module];
  if (!detail) return null;

  return (
    <section className="page module-page">
      <div className="page-heading">
        <div><p className="eyebrow">{detail.eyebrow}</p><h1>{detail.title}</h1><p>{detail.subtitle}</p></div>
        <div className="heading-actions"><button className="secondary-action" onClick={createTask}>Создать задачу</button><button className="primary-action" onClick={() => setDrawer(detail.metrics[0].drawer)}>Открыть сводку</button></div>
      </div>
      <div className="metrics-grid">
        {detail.metrics.map((metric) => (
          <button className={`metric-card ${metric.tone ?? ""}`} key={metric.label} onClick={() => setDrawer(metric.drawer)}>
            <span>{metric.label}</span><strong>{metric.value}</strong><small>{metric.note}</small><em>Раскрыть →</em>
          </button>
        ))}
      </div>
      {module === "finance" ? <FinanceTrend setDrawer={setDrawer} /> : null}
      <article className="data-card">
        <div className="card-heading"><div><p>{detail.tableSubtitle}</p><h2>{detail.tableTitle}</h2></div><button onClick={createTask}>+ Задача из записи</button></div>
        <div className="table-wrap">
          <table><thead><tr>{detail.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
            <tbody>{detail.rows.map((row, rowIndex) => (
              <tr key={`${row[0]}-${rowIndex}`} onClick={() => setDrawer({
                title: row[1] || row[0],
                value: row[0],
                summary: "Синтетическая карточка для проверки сквозного пользовательского маршрута.",
                source: module === "finance" ? "Обезличенный агрегат из загруженного XLSX" : "Синтетический набор ArtHello OS",
                calculation: "Показатель сформирован в тестовом контуре",
                updated: snapshot.meta.generatedAt,
                owner: row.at(-1) || "Владелец процесса",
                quality: module === "finance" ? "Требует сверки с первичной операцией" : "Тестовые данные",
                lineage: ["Карточка", "Связанная сущность", "Документ", "Событие", "Аудит"],
              })}>{row.map((cell, cellIndex) => <td key={`${cellIndex}-${cell}`}>{cell}</td>)}</tr>
            ))}</tbody>
          </table>
        </div>
      </article>
    </section>
  );
}

function FinanceTrend({ setDrawer }: { setDrawer: (value: DrawerData) => void }) {
  return (
    <article className="finance-trend">
      <div><p>Динамика 2026</p><h2>Чистый денежный поток</h2><span>Нажмите на месяц, чтобы увидеть источник и расчёт.</span></div>
      <div className="cashflow-row">
        {snapshot.finance.months.map((month, index) => {
          const value = snapshot.finance.cashFlow[index];
          return <button className={value >= 0 ? "up" : "down"} key={month} onClick={() => setDrawer(financeDrawer(`Чистый поток · ${month}`, rub.format(value), `Строка «Чистый денежный поток», ${month}`))}>
            <span>{month}</span><strong>{value >= 0 ? "+" : ""}{(value / 1000000).toFixed(2)} млн</strong>
          </button>;
        })}
      </div>
    </article>
  );
}

function CommandPalette({
  tasks,
  close,
  navigate,
  createTask,
}: {
  tasks: Task[];
  close: () => void;
  navigate: (id: ModuleId) => void;
  createTask: () => void;
}) {
  const [commandQuery, setCommandQuery] = useState("");
  const clean = commandQuery.trim().toLocaleLowerCase("ru-RU");
  const items = [
    ...moduleCatalog.map((item) => ({ id: `module-${item.id}`, label: item.label, type: "Раздел", meta: item.group, module: item.id as ModuleId })),
    ...entitySearchIndex,
    ...tasks.map((task) => ({ id: `task-${task.id}`, label: task.title, type: "Задача", meta: `${task.owner} · ${task.status}`, module: "tasks" as ModuleId })),
  ].filter((item) => !clean || `${item.id} ${item.label} ${item.type} ${item.meta}`.toLocaleLowerCase("ru-RU").includes(clean)).slice(0, 12);

  return (
    <div className="command-layer" role="presentation">
      <button className="command-scrim" onClick={close} aria-label="Закрыть командную палитру" />
      <section className="command-palette" role="dialog" aria-modal="true" aria-labelledby="command-title">
        <header>
          <AppIcon name="search" />
          <label><span id="command-title" className="sr-only">Командная палитра</span><input autoFocus value={commandQuery} onChange={(event) => setCommandQuery(event.target.value)} placeholder="Раздел, семья, сотрудник, договор, платёж или действие" /></label>
          <kbd>Esc</kbd>
        </header>
        <div className="command-quick">
          <button onClick={createTask}><AppIcon name="plus" /><span><strong>Создать задачу</strong><small>Сохранить в рабочем контуре</small></span></button>
          <button onClick={() => navigate("integrations")}><AppIcon name="integrations" /><span><strong>Проверить источники</strong><small>Авторизация, передача, журнал и тестовые данные</small></span></button>
          <button onClick={() => navigate("analytics")}><AppIcon name="analytics" /><span><strong>Открыть аналитику</strong><small>Метрики, сигналы и AI-контракты</small></span></button>
        </div>
        <div className="command-results">
          <p>{clean ? `Результаты по запросу «${commandQuery}»` : "Разделы и недавние объекты"}</p>
          {items.map((item) => (
            <button key={item.id} onClick={() => navigate(item.module)}>
              <span className="command-icon"><AppIcon name={item.module} /></span>
              <span><strong>{item.label}</strong><small>{item.type} · {item.meta}</small></span>
              <kbd>↵</kbd>
            </button>
          ))}
          {items.length === 0 ? <div className="command-empty"><strong>Совпадений нет</strong><span>Проверьте ID или откройте нужный раздел через меню.</span></div> : null}
        </div>
        <footer><span><kbd>Tab</kbd> выбрать</span><span><kbd>↵</kbd> открыть</span><span><kbd>Esc</kbd> закрыть</span><b>Только тестовые данные</b></footer>
      </section>
    </div>
  );
}

function DetailDrawer({ data, close, createTask }: { data: DrawerData; close: () => void; createTask: () => void }) {
  return <div className="drawer-layer"><button className="drawer-scrim" onClick={close} aria-label="Закрыть карточку" /><aside className="detail-drawer" role="dialog" aria-modal="true" aria-label={data.title}>
    <div className="drawer-head"><div><p>Доказуемый показатель</p><h2>{data.title}</h2>{data.value ? <strong>{data.value}</strong> : null}</div><button onClick={close} aria-label="Закрыть">×</button></div>
    <p className="drawer-summary">{data.summary}</p>
    <div className="lineage"><p>Цепочка происхождения</p><div>{data.lineage.map((step, index) => <span key={step}>{step}{index < data.lineage.length - 1 ? <i>→</i> : null}</span>)}</div></div>
    <dl className="proof-list"><div><dt>Источник</dt><dd>{data.source}</dd></div><div><dt>Расчёт</dt><dd>{data.calculation}</dd></div><div><dt>Последнее обновление</dt><dd>{data.updated}</dd></div><div><dt>Ответственный</dt><dd>{data.owner}</dd></div><div><dt>Качество данных</dt><dd>{data.quality}</dd></div></dl>
    <div className="drawer-actions"><button onClick={createTask}>Создать задачу</button><button onClick={close}>Закрыть</button></div>
  </aside></div>;
}

function TaskModal({ close, refresh, notify }: { close: () => void; refresh: () => Promise<void>; notify: (value: string) => void }) {
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(Object.fromEntries(form.entries())),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Не удалось создать задачу");
      await refresh();
      close();
      notify("Задача создана и сохранена");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Не удалось создать задачу");
    } finally {
      setSaving(false);
    }
  }
  return <div className="modal-layer"><button className="drawer-scrim" onClick={close} aria-label="Закрыть форму" /><form className="task-modal" onSubmit={submit}>
    <div className="drawer-head"><div><p>Новая запись</p><h2>Создать задачу</h2></div><button type="button" onClick={close}>×</button></div>
    <label><span>Что нужно сделать</span><input name="title" required minLength={4} placeholder="Например: сверить оплаты за июль" /></label>
    <div className="form-row"><label><span>Ответственный</span><input name="owner" required defaultValue="Финансовый контролёр" /></label><label><span>Срок</span><input name="dueDate" type="date" /></label></div>
    <div className="form-row"><label><span>Приоритет</span><select name="priority" defaultValue="Высокий"><option>Высокий</option><option>Средний</option><option>Низкий</option></select></label><label><span>Источник</span><select name="sourceType" defaultValue="Сигнал качества"><option>Сигнал качества</option><option>Финансы</option><option>Документ</option><option>Ручная задача</option></select></label></div>
    <input type="hidden" name="sourceId" value="MANUAL" />
    <div className="modal-actions"><button type="button" onClick={close}>Отмена</button><button disabled={saving} type="submit">{saving ? "Сохраняем…" : "Создать задачу"}</button></div>
  </form></div>;
}

function initials(name: string) {
  const parts = name.split(/[\s@.]+/).filter(Boolean).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase()).join("") || "ВО";
}
