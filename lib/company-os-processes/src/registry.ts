import type { ProcessDefinition, ProcessId } from "./types";

const ALL_AGENTS = [
  "memory",
  "intelligence",
  "competence-network",
  "execution",
  "evolution",
] as const;

export const PROCESS_LIBRARY: Record<ProcessId, ProcessDefinition> = {
  "capacity-enrollment-planner": {
    id: "capacity-enrollment-planner",
    name: "Capacity & Enrollment Planner",
    purpose:
      "Связывает набор, вместимость, помещения, педагогическую нагрузку, ФОТ, цену и точку безубыточности.",
    mode: "automatic",
    triggers: ["education-capacity"],
    agents: [...ALL_AGENTS],
    outputs: [
      "current-capacity",
      "growth-scenarios",
      "next-class-trigger",
      "next-hire-trigger",
      "break-even",
      "safety-margin",
    ],
    guardrails: [
      "не открывать класс или вакансию автоматически",
      "не считать неизвестные данные нулём",
      "отделять факт от прогноза",
    ],
    pilot:
      "Финансовая модель школы и сада: 40 платных учеников школы и 10 платных детей сада с последующим ростом.",
  },
  "receivables-orchestrator": {
    id: "receivables-orchestrator",
    name: "Receivables Orchestrator",
    purpose:
      "Управляет уже начисленной дебиторкой и обещаниями оплатить до фактической сверки с банком.",
    mode: "automatic",
    triggers: ["receivables"],
    agents: [...ALL_AGENTS],
    outputs: [
      "expected-receipts",
      "kept-promises",
      "broken-promises",
      "amount-at-risk",
      "next-action",
    ],
    guardrails: [
      "не обещать скидки, возвраты или отсрочки без разрешения",
      "не закрывать сомнительное совпадение платежа автоматически",
      "не использовать давление на семьи",
    ],
    pilot: "Дебиторка и обещания оплатить в ArtHello OS.",
  },
  "growth-experiment-engine": {
    id: "growth-experiment-engine",
    name: "Growth Experiment Engine",
    purpose:
      "Превращает утверждённую маркетинговую гипотезу в ограниченный измеримый эксперимент со stop/scale rules.",
    mode: "on-demand",
    triggers: ["marketing-experiment"],
    agents: [...ALL_AGENTS],
    outputs: [
      "experiment-contract",
      "primary-metric",
      "stop-rule",
      "scale-rule",
      "experiment-result",
    ],
    guardrails: [
      "не оптимизировать vanity metrics",
      "не запускать эксперимент без AI Process Contract",
      "не продолжать тест после stop rule без нового решения",
    ],
    pilot:
      "ИКИОМА, ArtHello/школа и мебель/Avito после подключения достоверного учёта заявок и продаж.",
  },
  "founder-bottleneck-miner": {
    id: "founder-bottleneck-miner",
    name: "Founder Bottleneck Miner",
    purpose:
      "Выявляет повторяющиеся обращения к собственнику и предлагает оставить, делегировать или автоматизировать их.",
    mode: "advisory",
    triggers: ["founder-repeat"],
    agents: [...ALL_AGENTS],
    outputs: [
      "founder-bottlenecks",
      "delegation-candidates",
      "automation-candidates",
      "expected-time-saving",
    ],
    guardrails: [
      "не делегировать стратегические и необратимые решения автоматически",
      "не расширять полномочия без утверждения",
      "сохранять право собственника вернуть решение себе",
    ],
    pilot: "Повторяющиеся решения собственника в Company OS.",
  },
  "assumption-reality-check": {
    id: "assumption-reality-check",
    name: "Assumption Reality Check",
    purpose:
      "Сравнивает ключевые предположения финансовых и операционных моделей с фактом и пересчитывает влияние устойчивых отклонений.",
    mode: "advisory",
    triggers: ["financial-model"],
    agents: [...ALL_AGENTS],
    outputs: [
      "planned-assumption",
      "actual-value",
      "variance",
      "forecast-impact",
      "review-recommendation",
    ],
    guardrails: [
      "не считать единичный шум трендом",
      "не переписывать исходную модель без утверждения",
      "порог существенности задаётся контекстом проекта",
    ],
    pilot: "Финансовая модель школы и сада, затем ИКИОМА.",
  },
};

export const listProcesses = (): ProcessDefinition[] =>
  Object.values(PROCESS_LIBRARY);
