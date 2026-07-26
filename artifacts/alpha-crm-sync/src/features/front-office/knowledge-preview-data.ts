export type PreviewKnowledgeStatus =
  | "APPROVED"
  | "IN_REVIEW"
  | "DRAFT"
  | "STALE";

export type PreviewFactStatus = "VERIFIED" | "PARTIAL" | "STALE";

export interface PreviewKnowledgeSource {
  id: string;
  label: string;
  kind: "POLICY" | "CATALOG" | "CONTRACT" | "PROCESS";
  version: string;
  effectiveAt: string;
  status: PreviewFactStatus;
}

export interface PreviewKnowledgeArticle {
  id: string;
  title: string;
  topic: string;
  status: PreviewKnowledgeStatus;
  confidence: PreviewFactStatus;
  version: string;
  owner: string;
  approver: string;
  effectiveAt: string;
  reviewAt: string;
  services: string[];
  branchScope: string;
  exceptions: string[];
  allowedActions: string[];
  escalation: string;
  responseTemplate: string;
  sources: PreviewKnowledgeSource[];
  facts: {
    statement: string;
    status: PreviewFactStatus;
    sourceId: string;
  }[];
  aiEligible: boolean;
  aiBlockReason: string;
}

export interface PreviewKnowledgeGap {
  id: string;
  topic: string;
  reason: "MISSING_SOURCE" | "SOURCE_CONFLICT" | "STALE_POLICY";
  occurrences: number;
  owner: string;
  due: string;
  impact: string;
  nextAction: string;
}

export const PREVIEW_KNOWLEDGE_ARTICLES: PreviewKnowledgeArticle[] = [
  {
    id: "KB-DEMO-001",
    title: "Документы для первичного обращения",
    topic: "Документы",
    status: "APPROVED",
    confidence: "VERIFIED",
    version: "1.2",
    owner: "Владелец знаний · DEMO",
    approver: "Ответственный за поддержку · DEMO",
    effectiveAt: "01.07.2026",
    reviewAt: "01.10.2026",
    services: ["Первичная заявка", "Пробное занятие"],
    branchScope: "Все синтетические филиалы",
    exceptions: ["Индивидуальный договор проверяется отдельно"],
    allowedActions: [
      "Отправить утверждённый публичный список",
      "Создать задачу при запросе индивидуального документа",
    ],
    escalation:
      "Запрос персональных документов требует проверки личности и человека",
    responseTemplate:
      "Здравствуйте! Для первичной заявки понадобится утверждённый публичный список документов. Если речь идёт о вашем договоре или персональном документе, сотрудник сначала подтвердит доступ.",
    sources: [
      {
        id: "POLICY-DEMO-DOCS-01",
        label: "Порядок документов · DEMO",
        kind: "POLICY",
        version: "1.2",
        effectiveAt: "01.07.2026",
        status: "VERIFIED",
      },
    ],
    facts: [
      {
        statement: "Публичный список можно сообщить без проверки личности",
        status: "VERIFIED",
        sourceId: "POLICY-DEMO-DOCS-01",
      },
      {
        statement: "Индивидуальные документы требуют проверки доступа",
        status: "VERIFIED",
        sourceId: "POLICY-DEMO-DOCS-01",
      },
    ],
    aiEligible: true,
    aiBlockReason: "",
  },
  {
    id: "KB-DEMO-002",
    title: "Правила пробного занятия",
    topic: "Пробное занятие",
    status: "IN_REVIEW",
    confidence: "PARTIAL",
    version: "0.9",
    owner: "Продуктовый руководитель · DEMO",
    approver: "Не утверждено",
    effectiveAt: "Не вступила в силу",
    reviewAt: "До 30.07.2026",
    services: ["Пробное занятие"],
    branchScope: "Только синтетический контур",
    exceptions: ["Цена, наличие и расписание читаются отдельно"],
    allowedActions: ["Создать внутренний черновик уточняющего вопроса"],
    escalation: "Любое обещание места или цены запрещено до проверки источника",
    responseTemplate:
      "Черновик: уточнить возраст, филиал и удобное время. Не обещать место, цену или конкретный слот.",
    sources: [
      {
        id: "PROCESS-DEMO-TRIAL-01",
        label: "Процесс пробного занятия · DEMO",
        kind: "PROCESS",
        version: "0.9",
        effectiveAt: "На согласовании",
        status: "PARTIAL",
      },
    ],
    facts: [
      {
        statement: "Для подбора нужны возраст, филиал и удобное время",
        status: "PARTIAL",
        sourceId: "PROCESS-DEMO-TRIAL-01",
      },
    ],
    aiEligible: false,
    aiBlockReason: "Нет утверждающего и действующей версии",
  },
  {
    id: "KB-DEMO-003",
    title: "Публичные цены программ",
    topic: "Цена",
    status: "DRAFT",
    confidence: "PARTIAL",
    version: "0.1",
    owner: "Коммерческий владелец · DEMO",
    approver: "Не утверждено",
    effectiveAt: "Не вступила в силу",
    reviewAt: "После получения каталога",
    services: ["Подбор программы"],
    branchScope: "Не определён",
    exceptions: ["Индивидуальные условия договора имеют приоритет"],
    allowedActions: ["Создать KNOWLEDGE_GAP"],
    escalation: "Запрос актуальной цены передать владельцу каталога",
    responseTemplate:
      "Цена не подтверждена. Запросить актуальный каталог и не использовать исторические значения.",
    sources: [],
    facts: [
      {
        statement: "Текущая цена отсутствует в подтверждённом источнике",
        status: "PARTIAL",
        sourceId: "SOURCE-MISSING",
      },
    ],
    aiEligible: false,
    aiBlockReason: "Нет актуального утверждённого каталога",
  },
  {
    id: "KB-DEMO-004",
    title: "Пропуски и отработки",
    topic: "Посещение",
    status: "STALE",
    confidence: "STALE",
    version: "0.7",
    owner: "Операционный владелец · DEMO",
    approver: "Историческое утверждение · DEMO",
    effectiveAt: "01.02.2026",
    reviewAt: "20.07.2026 · просрочено",
    services: ["Регулярные занятия"],
    branchScope: "Область применения требует перепроверки",
    exceptions: ["Договор семьи имеет приоритет"],
    allowedActions: ["Передать человеку", "Создать запрос на обновление"],
    escalation: "Не отвечать автоматически до сверки политики и договора",
    responseTemplate:
      "Правило требует проверки. Сотрудник сверит действующую политику и условия конкретного договора.",
    sources: [
      {
        id: "POLICY-DEMO-ATTENDANCE-07",
        label: "Историческая политика посещения · DEMO",
        kind: "POLICY",
        version: "0.7",
        effectiveAt: "01.02.2026",
        status: "STALE",
      },
    ],
    facts: [
      {
        statement: "Историческое правило нельзя применять как текущее",
        status: "STALE",
        sourceId: "POLICY-DEMO-ATTENDANCE-07",
      },
    ],
    aiEligible: false,
    aiBlockReason: "Дата пересмотра просрочена",
  },
];

export const PREVIEW_KNOWLEDGE_GAPS: PreviewKnowledgeGap[] = [
  {
    id: "KG-DEMO-001",
    topic: "Публичные цены программ",
    reason: "MISSING_SOURCE",
    occurrences: 8,
    owner: "Коммерческий владелец · DEMO",
    due: "До 29.07.2026",
    impact: "AI не может отвечать на ценовые вопросы",
    nextAction: "Утвердить каталог, владельца и дату следующего пересмотра",
  },
  {
    id: "KG-DEMO-002",
    topic: "Пропуски и отработки",
    reason: "STALE_POLICY",
    occurrences: 5,
    owner: "Операционный владелец · DEMO",
    due: "Просрочено · DEMO",
    impact: "Все обращения требуют ручной проверки",
    nextAction: "Сверить договоры и выпустить новую версию политики",
  },
  {
    id: "KG-DEMO-003",
    topic: "Пробное занятие",
    reason: "SOURCE_CONFLICT",
    occurrences: 3,
    owner: "Продуктовый руководитель · DEMO",
    due: "До 30.07.2026",
    impact: "Нельзя обещать единый процесс записи",
    nextAction: "Разрешить конфликт процесса и каталога филиалов",
  },
];
