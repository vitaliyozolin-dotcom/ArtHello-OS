export interface PreviewLead {
  id: string;
  need: string;
  area: string;
  stage: string;
  next: string;
  due: string;
  owner: string;
  risk: "normal" | "overdue";
}

export interface PreviewLeadDetail {
  source: string;
  campaign: string;
  age: string;
  preferredTime: string;
  goal: string;
  qualification: {
    label: string;
    value: string;
    status: "known" | "missing";
  }[];
  candidates: {
    title: string;
    reason: string;
    evidence: string;
    status: "VERIFIED" | "PARTIAL";
  }[];
  touches: {
    at: string;
    channel: string;
    summary: string;
    actor: string;
  }[];
  draft: {
    text: string;
    claims: {
      text: string;
      evidence: string;
      status: "VERIFIED" | "PARTIAL";
    }[];
  };
}

export interface PreviewServiceTicket {
  id: string;
  intent: string;
  subject: string;
  priority: "P2" | "P3" | "P4";
  status: "WORKING" | "WAITING_CUSTOMER" | "WAITING_INTERNAL" | "RESOLVED";
  identity: "not_required" | "verified" | "partial";
  owner: string;
  due: string;
  verifiedFacts: number;
  unverifiedClaims: number;
  escalation: string | null;
}

export const PREVIEW_LEADS: PreviewLead[] = [
  {
    id: "AH-DEMO-0042",
    need: "Творческая программа · 6–7 лет",
    area: "Север города",
    stage: "QUALIFIED",
    next: "Предложить два проверенных варианта",
    due: "Сегодня, 14:00",
    owner: "Менеджер 1",
    risk: "normal",
  },
  {
    id: "AH-DEMO-0043",
    need: "Подготовка к школе · вечер",
    area: "Рядом с филиалом",
    stage: "PROGRAM_MATCHED",
    next: "Уточнить удобный день пробного",
    due: "Сегодня, 16:30",
    owner: "Менеджер 2",
    risk: "normal",
  },
  {
    id: "AH-DEMO-0044",
    need: "Детский сад · полный день",
    area: "Район не подтверждён",
    stage: "NEW",
    next: "Уточнить возраст, район и дату старта",
    due: "Просрочено на 24 мин",
    owner: "Не назначен",
    risk: "overdue",
  },
  {
    id: "AH-DEMO-0045",
    need: "Пробное занятие · выходные",
    area: "Север города",
    stage: "TRIAL_BOOKED",
    next: "Подтвердить посещение сотрудником",
    due: "Завтра, 10:00",
    owner: "Менеджер 1",
    risk: "normal",
  },
];

export const PREVIEW_LEAD_DETAILS: Record<string, PreviewLeadDetail> = {
  "AH-DEMO-0042": {
    source: "Сайт",
    campaign: "Летний набор · DEMO",
    age: "6–7 лет",
    preferredTime: "Будни после 17:00",
    goal: "Развивать интерес к творчеству без перегрузки",
    qualification: [
      { label: "Возраст", value: "6–7 лет", status: "known" },
      { label: "Район", value: "Север города", status: "known" },
      { label: "Цель семьи", value: "Творческое развитие", status: "known" },
      { label: "Удобное время", value: "После 17:00", status: "known" },
      { label: "Филиал", value: "Нужно подтвердить", status: "missing" },
      { label: "Дата старта", value: "Нужно уточнить", status: "missing" },
    ],
    candidates: [
      {
        title: "Творческая мастерская · DEMO",
        reason: "Совпадает возраст и заявленная цель семьи",
        evidence: "KB-DEMO-PROGRAM-01 · версия 1.0",
        status: "VERIFIED",
      },
      {
        title: "Арт-лаборатория · DEMO",
        reason: "Подходит по формату, но время ещё не подтверждено",
        evidence: "KB-DEMO-PROGRAM-02 · версия 0.8",
        status: "PARTIAL",
      },
    ],
    touches: [
      {
        at: "Сегодня, 11:18",
        channel: "Сайт",
        summary: "Получено первичное обращение",
        actor: "Система · DEMO",
      },
      {
        at: "Сегодня, 11:26",
        channel: "Внутренняя заметка",
        summary: "Определены возраст, район и цель семьи",
        actor: "Менеджер 1",
      },
      {
        at: "Сегодня, 11:31",
        channel: "AI-черновик",
        summary: "Подготовлены два варианта и уточняющий вопрос",
        actor: "Front Office · DRAFT_ONLY",
      },
    ],
    draft: {
      text: "Здравствуйте! По указанному возрасту и цели я подготовил два возможных направления. Перед тем как предложить конкретный вариант пробного занятия, уточните, пожалуйста, какой филиал вам удобнее и когда вы хотели бы начать. После этого сотрудник проверит актуальное расписание и наличие мест.",
      claims: [
        {
          text: "Подготовлено не более двух вариантов",
          evidence: "POLICY-DEMO-SALES-01 · подбор программ",
          status: "VERIFIED",
        },
        {
          text: "Расписание и наличие требуют отдельной проверки",
          evidence: "SOURCE_OF_TRUTH_MAP · AlfaCRM read-only",
          status: "VERIFIED",
        },
      ],
    },
  },
  "AH-DEMO-0043": {
    source: "Рекомендация",
    campaign: "Без кампании",
    age: "5–6 лет",
    preferredTime: "Будни вечером",
    goal: "Спокойно подготовиться к школьному формату",
    qualification: [
      { label: "Возраст", value: "5–6 лет", status: "known" },
      { label: "Район", value: "Рядом с филиалом", status: "known" },
      { label: "Цель семьи", value: "Подготовка к школе", status: "known" },
      { label: "Удобное время", value: "Вечер", status: "known" },
      { label: "День недели", value: "Нужно уточнить", status: "missing" },
      { label: "Дата старта", value: "В течение месяца", status: "known" },
    ],
    candidates: [
      {
        title: "Подготовка к школе · DEMO",
        reason: "Совпадает возраст, цель и предпочтительный формат",
        evidence: "KB-DEMO-PROGRAM-03 · версия 1.1",
        status: "VERIFIED",
      },
    ],
    touches: [
      {
        at: "Вчера, 18:42",
        channel: "Ручной ввод",
        summary: "Лид создан сотрудником по рекомендации",
        actor: "Менеджер 2",
      },
      {
        at: "Сегодня, 09:10",
        channel: "Внутренняя заметка",
        summary: "Программа подобрана, конкретный слот не проверялся",
        actor: "Менеджер 2",
      },
    ],
    draft: {
      text: "Здравствуйте! По вашему запросу подходит программа подготовки к школе. Чтобы сотрудник проверил конкретный вариант пробного занятия, подскажите, пожалуйста, какие дни недели вам удобны. Цена, расписание и наличие будут указаны только после проверки актуальных источников.",
      claims: [
        {
          text: "Программа соответствует возрастной группе в демо-каталоге",
          evidence: "KB-DEMO-PROGRAM-03 · версия 1.1",
          status: "VERIFIED",
        },
        {
          text: "Конкретный слот ещё не подтверждён",
          evidence: "TRIAL_STATE_EVENT-DEMO · отсутствует BOOKED",
          status: "VERIFIED",
        },
      ],
    },
  },
  "AH-DEMO-0044": {
    source: "Карты",
    campaign: "Карточка филиала · DEMO",
    age: "Не указан",
    preferredTime: "Полный день",
    goal: "Найти детский сад рядом с домом",
    qualification: [
      { label: "Возраст", value: "Нужно уточнить", status: "missing" },
      { label: "Район", value: "Нужно уточнить", status: "missing" },
      { label: "Цель семьи", value: "Детский сад", status: "known" },
      { label: "Удобное время", value: "Полный день", status: "known" },
      { label: "Дата старта", value: "Нужно уточнить", status: "missing" },
      { label: "Ответственный", value: "Не назначен", status: "missing" },
    ],
    candidates: [],
    touches: [
      {
        at: "Сегодня, 10:54",
        channel: "Ручной ввод",
        summary: "Создано неполное обращение без контактного follow-up",
        actor: "Система · DEMO",
      },
    ],
    draft: {
      text: "Здравствуйте! Чтобы подобрать подходящий вариант, уточните, пожалуйста, возраст ребёнка, район и желаемую дату начала. После этого сотрудник сможет проверить применимые программы и филиалы.",
      claims: [
        {
          text: "Для подбора не хватает трёх обязательных параметров",
          evidence: "QUALIFICATION-DEMO · age, area, start_date",
          status: "VERIFIED",
        },
      ],
    },
  },
  "AH-DEMO-0045": {
    source: "Сайт",
    campaign: "Пробное занятие · DEMO",
    age: "7–8 лет",
    preferredTime: "Выходные",
    goal: "Познакомиться с форматом до решения",
    qualification: [
      { label: "Возраст", value: "7–8 лет", status: "known" },
      { label: "Район", value: "Север города", status: "known" },
      { label: "Цель семьи", value: "Пробное занятие", status: "known" },
      { label: "Удобное время", value: "Выходные", status: "known" },
      { label: "Слот", value: "DEMO-SLOT-07", status: "known" },
      { label: "Подтверждение", value: "Требуется человек", status: "missing" },
    ],
    candidates: [
      {
        title: "Пробное занятие · DEMO",
        reason: "Синтетический слот соответствует предпочтению",
        evidence: "SCHEDULE-DEMO-07 · не AlfaCRM",
        status: "PARTIAL",
      },
    ],
    touches: [
      {
        at: "Вчера, 13:20",
        channel: "Сайт",
        summary: "Получен запрос на пробное занятие",
        actor: "Система · DEMO",
      },
      {
        at: "Вчера, 13:32",
        channel: "Внутренняя заметка",
        summary: "Создан синтетический слот без внешнего бронирования",
        actor: "Менеджер 1",
      },
    ],
    draft: {
      text: "Здравствуйте! В демонстрационном сценарии выбран вариант на выходных. Это не реальная запись: перед сообщением клиенту сотрудник должен проверить актуальный слот в системе расписания и подтвердить бронирование.",
      claims: [
        {
          text: "Слот существует только в синтетическом preview",
          evidence: "SCHEDULE-DEMO-07 · PARTIAL",
          status: "PARTIAL",
        },
      ],
    },
  },
};

export const PREVIEW_SERVICE_TICKETS: PreviewServiceTicket[] = [
  {
    id: "SV-DEMO-0101",
    intent: "FAMILY.SCHEDULE",
    subject: "Изменение не появилось в семейном расписании",
    priority: "P3",
    status: "WORKING",
    identity: "verified",
    owner: "Администратор · DEMO",
    due: "Сегодня, 15:00",
    verifiedFacts: 2,
    unverifiedClaims: 1,
    escalation: null,
  },
  {
    id: "SV-DEMO-0102",
    intent: "COMPLAINT.CANCELLATION",
    subject: "Повторная отмена занятия",
    priority: "P2",
    status: "WAITING_INTERNAL",
    identity: "partial",
    owner: "Руководитель сервиса · DEMO",
    due: "Сегодня, 13:30",
    verifiedFacts: 1,
    unverifiedClaims: 2,
    escalation: "Требуется решение человека",
  },
  {
    id: "SV-DEMO-0103",
    intent: "FIN.CHARGE",
    subject: "Спорное начисление без подтверждённой сверки",
    priority: "P2",
    status: "WAITING_INTERNAL",
    identity: "verified",
    owner: "Финансы · DEMO",
    due: "Сегодня, 17:00",
    verifiedFacts: 1,
    unverifiedClaims: 1,
    escalation: "Финансовое решение запрещено AI",
  },
  {
    id: "SV-DEMO-0104",
    intent: "INFO.DOCUMENTS",
    subject: "Общий список документов",
    priority: "P4",
    status: "RESOLVED",
    identity: "not_required",
    owner: "Менеджер 2",
    due: "Закрыто",
    verifiedFacts: 3,
    unverifiedClaims: 0,
    escalation: null,
  },
];
