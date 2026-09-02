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
const shellBefore = '<SalesWorkspace workspace="sales" role={role} notify={setNotice} onTasksChanged={loadTasks} onOpenFinance={() => openModule("finance")} focusId={moduleFocus?.module === "sales" ? moduleFocus.id : undefined} />';
const shellAfter = '<SalesWorkspace workspace="sales" role={role} notify={setNotice} onTasksChanged={loadTasks} onOpenFinance={() => openModule("finance")} onOpenIntegrations={() => openModule("integrations")} focusId={moduleFocus?.module === "sales" ? moduleFocus.id : undefined} />';
if (!shell.includes(shellAfter)) {
  shell = replaceOnce(shell, shellBefore, shellAfter, "sales to integrations navigation");
}
writeFileSync(shellTarget, shell, "utf8");

const integrationTarget = fileURLToPath(new URL("../app/components/IntegrationWorkspace.tsx", import.meta.url));
let integration = readFileSync(integrationTarget, "utf8");
const catalogBeforeCurrent = `        {[\n          ["INT-T-TOCHKA", "Точка", "Выписки с выбранной даты · каждый час"],\n          ["INT-T-ALFABANK", "Альфа-Банк", "Банковские операции и расписание"],\n          ["INT-T-ALFACRM", "AlfaCRM", "Семьи, лиды, договоры и статусы"],\n          ["INT-T-FORMS", "Сайт", "Webhook форм → воронка"],\n          ["INT-T-SOCIAL", "Соцсети", "Публикации, метрики и UTM"],\n          ["INT-T-TG", "Мессенджеры", "Telegram webhook и обращения"],\n          ["INT-T-OPENAI-IMAGES", "OpenAI Images", "Генерация по описанию и референсу"],\n        ].map(([id, name, note]) => <button key={id} onClick={() => setWizardId(id)}>\n`;
const catalogAfter = `        {[\n          ["INT-T-ALFACRM", "AlfaCRM", "Лиды, семьи, договоры, занятия и оплаты"],\n          ["INT-T-FORMS", "Формы сайта", "Webhook заявки → этап «Заявка»"],\n          ["INT-T-PHONE", "Телефония", "Звонки и история контакта"],\n          ["INT-T-WHATSAPP", "WhatsApp", "Обращения WhatsApp Business API"],\n          ["INT-T-TG", "Telegram", "Бот, webhook и обращения"],\n          ["INT-T-VK", "VK", "Lead Ads, сообщения и UTM"],\n          ["INT-T-YANDEX", "Яндекс", "Директ, Метрика, Формы и UTM"],\n          ["INT-T-MAIL", "Email", "Письма, ответы и статусы доставки"],\n          ["INT-T-ADS", "Рекламные кабинеты", "Расходы, кампании и креативы"],\n          ["INT-T-SOCIAL", "Социальные сети", "Публикации, метрики и переходы"],\n          ["INT-T-TOCHKA", "Точка", "Выписки с выбранной даты · каждый час"],\n          ["INT-T-ALFABANK", "Альфа-Банк", "Банковские операции и расписание"],\n          ["INT-T-OPENAI-IMAGES", "OpenAI Images", "Генерация по описанию и референсу"],\n        ].map(([id, name, note]) => <button key={id} onClick={() => setWizardId(id)}>\n`;
const catalogBeforeAccountsOnly = catalogBeforeCurrent.replace(
  "Выписки с выбранной даты · каждый час",
  "JWT и список доступных счетов",
);
const catalogAfterAccountsOnly = catalogAfter.replace(
  "Выписки с выбранной даты · каждый час",
  "JWT и список доступных счетов",
);
const ownerAwareMap = '].filter(([id]) => id !== TOCHKA_CONNECTION_ID || data.capabilities.canManageTochka).map(([id, name, note]) => <button key={id} onClick={() => setWizardId(id)}>';
const catalogBeforeAccountsOnlyOwnerAware = catalogBeforeAccountsOnly.replace(
  '].map(([id, name, note]) => <button key={id} onClick={() => setWizardId(id)}>',
  ownerAwareMap,
);
const catalogAfterAccountsOnlyOwnerAware = catalogAfterAccountsOnly.replace(
  '].map(([id, name, note]) => <button key={id} onClick={() => setWizardId(id)}>',
  ownerAwareMap,
);
if (!integration.includes(catalogAfterAccountsOnly) && !integration.includes(catalogAfterAccountsOnlyOwnerAware)) {
  if (integration.includes(catalogAfter)) {
    integration = replaceOnce(integration, catalogAfter, catalogAfterAccountsOnly, "honest Tochka starter copy");
  } else {
    const ownerAware = integration.includes(catalogBeforeAccountsOnlyOwnerAware);
    const currentCatalog = ownerAware
      ? catalogBeforeAccountsOnlyOwnerAware
      : integration.includes(catalogBeforeAccountsOnly)
        ? catalogBeforeAccountsOnly
        : catalogBeforeCurrent;
    integration = replaceOnce(
      integration,
      currentCatalog,
      ownerAware ? catalogAfterAccountsOnlyOwnerAware : catalogAfterAccountsOnly,
      "complete source starter catalog",
    );
  }
}
const salesDetectionBefore = '  const openai = connection.id === "INT-T-OPENAI-IMAGES";\n  const scopeOptions = bank\n';
const salesDetectionAfter = '  const openai = connection.id === "INT-T-OPENAI-IMAGES";\n  const salesChannel = ["INT-T-FORMS", "INT-T-PHONE", "INT-T-WHATSAPP", "INT-T-TG", "INT-T-VK", "INT-T-YANDEX", "INT-T-MAIL", "INT-T-ADS", "INT-T-SOCIAL"].includes(connection.id);\n  const scopeOptions = bank\n';
if (!integration.includes(salesDetectionAfter)) {
  integration = replaceOnce(integration, salesDetectionBefore, salesDetectionAfter, "sales source scope detection");
}
const salesScopesBefore = '      : openai\n        ? ["Созданные изображения"]\n        : ["Обращения", "Контакты", "Согласия", "UTM и источник", "Публикации", "Метрики контента"];\n';
const salesScopesAfter = '      : openai\n        ? ["Созданные изображения"]\n        : salesChannel\n          ? ["Лиды", "Контакты", "Сообщения и звонки", "Согласия", "UTM и источник", "Статусы", "Менеджер", "Филиал", "Кампании и креативы"]\n          : ["Обращения", "Контакты", "Согласия", "UTM и источник", "Публикации", "Метрики контента"];\n';
if (!integration.includes(salesScopesAfter)) {
  integration = replaceOnce(integration, salesScopesBefore, salesScopesAfter, "sales source data scopes");
}
if (!integration.includes("const tochkaRedirectUrl = useMemo(")) {
  integration = replaceOnce(
    integration,
    '  const [credential, setCredential] = useState("");\n',
    '  const [credential, setCredential] = useState("");\n  const tochkaRedirectUrl = useMemo(\n    () => typeof window === "undefined" ? "/api/integrations/tochka/callback" : `${window.location.origin}/api/integrations/tochka/callback`,\n    [],\n  );\n',
    "origin-aware Tochka callback state",
  );
}
for (const legacyCallback of [
  '  const tochkaRedirectUrl = "https://arthello-os.ozolin.chatgpt.site/api/integrations/tochka/callback";\n',
  '  const tochkaRedirectUrl = "https://arthello-188-225-38-55.sslip.io/api/integrations/tochka/callback";\n',
]) {
  if (integration.includes(legacyCallback)) {
    integration = replaceOnce(integration, legacyCallback, "", "remove fixed Tochka callback");
  }
}
if (integration.includes("arthello-os.ozolin.chatgpt.site")) {
  throw new Error("Sales operating patch left a preview Tochka callback in production source");
}
writeFileSync(integrationTarget, integration, "utf8");

const integrationActionTarget = fileURLToPath(new URL("../app/api/integration-actions/route.ts", import.meta.url));
let integrationAction = readFileSync(integrationActionTarget, "utf8");
const integrationCatalogImport = 'import { ensureOperatingIntegrationCatalog } from "../../../lib/operating-integration-catalog";\n';
if (!integrationAction.includes(integrationCatalogImport)) {
  integrationAction = replaceOnce(
    integrationAction,
    'import type { IntegrationSetup } from "../../../db";\n',
    `import type { IntegrationSetup } from "../../../db";\n${integrationCatalogImport}`,
    "integration catalog action import",
  );
}
const integrationCatalogGuard = '    await ensureOperatingIntegrationCatalog();\n';
if (!integrationAction.includes(integrationCatalogGuard)) {
  integrationAction = replaceOnce(
    integrationAction,
    '    await ensureCoreTables();\n',
    `    await ensureCoreTables();\n${integrationCatalogGuard}`,
    "integration catalog action guard",
  );
}
writeFileSync(integrationActionTarget, integrationAction, "utf8");

console.log("Sales operating workspace patch applied");
