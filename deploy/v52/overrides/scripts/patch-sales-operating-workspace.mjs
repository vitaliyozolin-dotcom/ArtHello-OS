import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function replaceOnce(source, search, replacement, label) {
  const first = source.indexOf(search);
  const second = first === -1 ? -1 : source.indexOf(search, first + search.length);
  if (first === -1 || second !== -1) {
    throw new Error(`Sales operating patch failed at ${label}`);
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + search.length)}`;
}
console.log("SalesWorkspace Design System override is already installed; preserving operating integrations");

const shellTarget = fileURLToPath(new URL("../app/components/ArtHelloShell.tsx", import.meta.url));
let shell = readFileSync(shellTarget, "utf8");
shell = replaceOnce(
  shell,
  '<SalesWorkspace workspace="sales" role={role} notify={setNotice} onTasksChanged={loadTasks} onOpenFinance={() => openModule("finance")} focusId={moduleFocus?.module === "sales" ? moduleFocus.id : undefined} />',
  '<SalesWorkspace workspace="sales" role={role} notify={setNotice} onTasksChanged={loadTasks} onOpenFinance={() => openModule("finance")} onOpenIntegrations={() => openModule("integrations")} focusId={moduleFocus?.module === "sales" ? moduleFocus.id : undefined} />',
  "sales to integrations navigation",
);
writeFileSync(shellTarget, shell, "utf8");

const integrationTarget = fileURLToPath(new URL("../app/components/IntegrationWorkspace.tsx", import.meta.url));
let integration = readFileSync(integrationTarget, "utf8");
integration = replaceOnce(
  integration,
  `        {[\n          ["INT-T-TOCHKA", "Точка", "Выписки с выбранной даты · каждый час"],\n          ["INT-T-ALFABANK", "Альфа-Банк", "Банковские операции и расписание"],\n          ["INT-T-ALFACRM", "AlfaCRM", "Семьи, лиды, договоры и статусы"],\n          ["INT-T-FORMS", "Сайт", "Webhook форм → воронка"],\n          ["INT-T-SOCIAL", "Соцсети", "Публикации, метрики и UTM"],\n          ["INT-T-TG", "Мессенджеры", "Telegram webhook и обращения"],\n          ["INT-T-OPENAI-IMAGES", "OpenAI Images", "Генерация по описанию и референсу"],\n        ].map(([id, name, note]) => <button key={id} onClick={() => setWizardId(id)}>\n`,
  `        {[\n          ["INT-T-ALFACRM", "AlfaCRM", "Лиды, семьи, договоры, занятия и оплаты"],\n          ["INT-T-FORMS", "Формы сайта", "Webhook заявки → этап «Заявка»"],\n          ["INT-T-PHONE", "Телефония", "Звонки и история контакта"],\n          ["INT-T-WHATSAPP", "WhatsApp", "Обращения WhatsApp Business API"],\n          ["INT-T-TG", "Telegram", "Бот, webhook и обращения"],\n          ["INT-T-VK", "VK", "Lead Ads, сообщения и UTM"],\n          ["INT-T-YANDEX", "Яндекс", "Директ, Метрика, Формы и UTM"],\n          ["INT-T-MAIL", "Email", "Письма, ответы и статусы доставки"],\n          ["INT-T-ADS", "Рекламные кабинеты", "Расходы, кампании и креативы"],\n          ["INT-T-SOCIAL", "Социальные сети", "Публикации, метрики и переходы"],\n          ["INT-T-TOCHKA", "Точка", "Выписки с выбранной даты · каждый час"],\n          ["INT-T-ALFABANK", "Альфа-Банк", "Банковские операции и расписание"],\n          ["INT-T-OPENAI-IMAGES", "OpenAI Images", "Генерация по описанию и референсу"],\n        ].map(([id, name, note]) => <button key={id} onClick={() => setWizardId(id)}>\n`,
  "complete source starter catalog",
);
integration = replaceOnce(
  integration,
  '  const openai = connection.id === "INT-T-OPENAI-IMAGES";\n  const scopeOptions = bank\n',
  '  const openai = connection.id === "INT-T-OPENAI-IMAGES";\n  const salesChannel = ["INT-T-FORMS", "INT-T-PHONE", "INT-T-WHATSAPP", "INT-T-TG", "INT-T-VK", "INT-T-YANDEX", "INT-T-MAIL", "INT-T-ADS", "INT-T-SOCIAL"].includes(connection.id);\n  const scopeOptions = bank\n',
  "sales source scope detection",
);
integration = replaceOnce(
  integration,
  '      : openai\n        ? ["Созданные изображения"]\n        : ["Обращения", "Контакты", "Согласия", "UTM и источник", "Публикации", "Метрики контента"];\n',
  '      : openai\n        ? ["Созданные изображения"]\n        : salesChannel\n          ? ["Лиды", "Контакты", "Сообщения и звонки", "Согласия", "UTM и источник", "Статусы", "Менеджер", "Филиал", "Кампании и креативы"]\n          : ["Обращения", "Контакты", "Согласия", "UTM и источник", "Публикации", "Метрики контента"];\n',
  "sales source data scopes",
);
integration = replaceOnce(
  integration,
  '  const tochkaRedirectUrl = "https://arthello-os.ozolin.chatgpt.site/api/integrations/tochka/callback";\n',
  '  const tochkaRedirectUrl = "https://arthello-188-225-38-55.sslip.io/api/integrations/tochka/callback";\n',
  "current Tochka callback",
);
writeFileSync(integrationTarget, integration, "utf8");

const integrationActionTarget = fileURLToPath(new URL("../app/api/integration-actions/route.ts", import.meta.url));
let integrationAction = readFileSync(integrationActionTarget, "utf8");
integrationAction = replaceOnce(
  integrationAction,
  'import type { IntegrationSetup } from "../../../db";\n',
  'import type { IntegrationSetup } from "../../../db";\nimport { ensureOperatingIntegrationCatalog } from "../../../lib/operating-integration-catalog";\n',
  "integration catalog action import",
);
integrationAction = replaceOnce(
  integrationAction,
  '    await ensureCoreTables();\n    const body = await request.json() as Record<string, unknown>;\n',
  '    await ensureCoreTables();\n    await ensureOperatingIntegrationCatalog();\n    const body = await request.json() as Record<string, unknown>;\n',
  "integration catalog action guard",
);
writeFileSync(integrationActionTarget, integrationAction, "utf8");

console.log("Sales operating workspace patch applied");


