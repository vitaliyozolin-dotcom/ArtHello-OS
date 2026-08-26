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

const salesTarget = fileURLToPath(new URL("../app/components/SalesWorkspace.tsx", import.meta.url));
let sales = readFileSync(salesTarget, "utf8");

sales = replaceOnce(
  sales,
  'import "./SalesWorkspace.css";\n',
  'import "./SalesWorkspace.css";\nimport "./SalesOperatingWorkspace.css";\n',
  "sales operating styles",
);

sales = replaceOnce(
  sales,
  'const roleCodes: Record<string, string> = {\n',
  `const DEFAULT_FUNNEL_STAGES = ["Первый клик", "Заявка", "Консультация", "Посещение", "Договор", "Начисление", "Платёж"] as const;\nconst EMPTY_LEAD: Lead = {\n  id: "", firstClickAt: "", source: "", utmSource: "", utmMedium: "", utmCampaign: "", utmContent: "",\n  campaignId: "", creativeId: "", offerId: "", formId: "", managerEntityId: "", stage: "Заявка", status: "Активен",\n  familyEntityId: "", childEntityId: "", contractId: "", serviceEntityId: "", rejectionReason: "", tags: [], dataQuality: "",\n};\n\nconst roleCodes: Record<string, string> = {\n`,
  "empty-safe funnel constants",
);

sales = replaceOnce(
  sales,
  'export function SalesWorkspace({ workspace, role, notify, onTasksChanged, onOpenFinance, focusId }: { workspace: "sales" | "clients"; role: string; notify: (message: string) => void; onTasksChanged: () => void; onOpenFinance: () => void; focusId?: string }) {\n',
  'export function SalesWorkspace({ workspace, role, notify, onTasksChanged, onOpenFinance, onOpenIntegrations, focusId }: { workspace: "sales" | "clients"; role: string; notify: (message: string) => void; onTasksChanged: () => void; onOpenFinance: () => void; onOpenIntegrations: () => void; focusId?: string }) {\n',
  "sales integration navigation prop",
);

sales = replaceOnce(
  sales,
  '  const [touchpointOutcome, setTouchpointOutcome] = useState("");\n',
  '  const [touchpointOutcome, setTouchpointOutcome] = useState("");\n  const [leadCreateOpen, setLeadCreateOpen] = useState(false);\n',
  "manual lead dialog state",
);

sales = replaceOnce(
  sales,
  `  async function action(body: Record<string, unknown>, key: string) {\n    setBusy(key);\n    try {\n      const response = await fetch("/api/sales-actions", {\n        method: "POST",\n        headers: { "content-type": "application/json", "x-arthello-role": roleCodes[role] ?? "" },\n        body: JSON.stringify(body),\n      });\n      const payload = await response.json() as { error?: string; reused?: boolean; stage?: string };\n      if (!response.ok) throw new Error(payload.error ?? "Действие не выполнено");\n      notify(payload.reused ? "Связанная задача уже существует" : payload.stage ? \`Лид переведён: \${payload.stage}\` : "Действие сохранено");\n      setEvidence(""); setTouchpointSummary(""); setTouchpointOutcome("");\n      await load(); onTasksChanged();\n    } catch (actionError) {\n      notify(actionError instanceof Error ? actionError.message : "Действие не выполнено");\n    } finally { setBusy(""); }\n  }\n`,
  `  async function action(body: Record<string, unknown>, key: string) {\n    setBusy(key);\n    try {\n      const response = await fetch("/api/sales-actions", {\n        method: "POST",\n        headers: { "content-type": "application/json", "x-arthello-role": roleCodes[role] ?? "" },\n        body: JSON.stringify(body),\n      });\n      const payload = await response.json() as { error?: string; reused?: boolean; stage?: string; lead?: { id: string } };\n      if (!response.ok) throw new Error(payload.error ?? "Действие не выполнено");\n      notify(payload.lead?.id ? \`Лид \${payload.lead.id} создан\` : payload.reused ? "Связанная задача уже существует" : payload.stage ? \`Лид переведён: \${payload.stage}\` : "Действие сохранено");\n      setEvidence(""); setTouchpointSummary(""); setTouchpointOutcome("");\n      await load(); onTasksChanged();\n      return true;\n    } catch (actionError) {\n      notify(actionError instanceof Error ? actionError.message : "Действие не выполнено");\n      return false;\n    } finally { setBusy(""); }\n  }\n`,
  "sales action result",
);

sales = replaceOnce(
  sales,
  '    return data.leads.filter((lead) => !normalized || [lead.id, lead.source, lead.stage, lead.campaignId, lead.managerEntityId, ...lead.tags].join(" ").toLocaleLowerCase("ru").includes(normalized));\n',
  '    return data.leads.filter((lead) => !normalized || [lead.id, data.entityNames[lead.familyEntityId], lead.source, lead.stage, lead.campaignId, lead.managerEntityId, ...lead.tags].join(" ").toLocaleLowerCase("ru").includes(normalized));\n',
  "lead name search",
);

sales = replaceOnce(
  sales,
  `  if (!data.leads.length) return <section className="page sales-workspace">\n    <div className="sales-heading"><div><p className="eyebrow">Воронка · единый путь клиента</p><h1>Продажи</h1><p>Лиды, контакты, этапы воронки и связанные платежи появятся после добавления данных.</p></div></div>\n    <div className="manual-module-empty"><span>＋</span><h2>Лидов пока нет</h2><p>Подключите CRM или добавьте первую заявку вручную.</p></div>\n  </section>;\n\n`,
  "",
  "remove blocking sales empty return",
);

sales = replaceOnce(
  sales,
  '  const chainLead = data.leads.find((lead) => lead.id === data.acceptanceChainLeadId) ?? data.leads[0];\n',
  '  const hasLeads = data.leads.length > 0;\n  const funnelColumns = data.funnel.length ? data.funnel : DEFAULT_FUNNEL_STAGES.map((stage, index) => ({ stage, reached: 0, conversionPercent: index === 0 ? 100 : 0 }));\n  const chainLead = data.leads.find((lead) => lead.id === data.acceptanceChainLeadId) ?? data.leads[0] ?? EMPTY_LEAD;\n',
  "safe empty sales chain",
);

sales = replaceOnce(
  sales,
  '        <div className="sales-heading-actions"><span><i />Рабочие данные</span><button onClick={() => { setTab("chain"); setSelected(chainLead); }}>Открыть цепочку {chainLead.id}</button></div>\n',
  '        <div className="sales-heading-actions"><span><i />Рабочие данные</span><div className="sales-heading-buttons"><button onClick={() => setLeadCreateOpen(true)}>+ Добавить лид</button><button className="secondary" onClick={onOpenIntegrations}>Подключить источники</button>{hasLeads ? <button className="secondary" onClick={() => { setTab("chain"); setSelected(chainLead); }}>Цепочка {chainLead.id}</button> : null}</div></div>\n',
  "sales header actions",
);

sales = replaceOnce(
  sales,
  '      <div className="sales-source-boundary"><strong>ДАННЫЕ ПРОДАЖ</strong><span>{data.sourcePolicy.note}</span><em>Показываются только сохранённые записи</em></div>\n\n',
  '      <div className="sales-source-boundary"><strong>ДАННЫЕ ПРОДАЖ</strong><span>{data.sourcePolicy.note}</span><em>Показываются только сохранённые записи</em></div>\n\n      {!hasLeads && workspace === "sales" ? <section className="sales-start-panel"><div><strong>Все разделы продаж уже доступны</strong><span>Начните с ручного лида либо подключите AlfaCRM, сайт, телефонию, WhatsApp, Telegram, VK, Яндекс, email и рекламные кабинеты. Пустая база больше не скрывает воронку, реестр, сквозную цепочку и LTV.</span></div><div className="sales-start-actions"><button onClick={() => setLeadCreateOpen(true)}>+ Добавить первый лид</button><button className="secondary" onClick={onOpenIntegrations}>Настроить источники</button></div></section> : null}\n\n',
  "sales empty onboarding",
);

sales = replaceOnce(
  sales,
  '<div className="crm-toolbar"><div><strong>Основная воронка</strong><span>Карточка открывается по клику; перенос между этапами подтверждается внутри карточки.</span></div><div><button onClick={() => setTab("leads")}>Реестр лидов</button><button onClick={() => setQuery("")}>Все менеджеры</button></div></div>',
  '<div className="crm-toolbar"><div><strong>Основная воронка</strong><span>Карточка открывается по клику; перенос между этапами подтверждается внутри карточки.</span></div><div><button onClick={() => setLeadCreateOpen(true)}>+ Добавить лид</button><button onClick={() => setTab("leads")}>Реестр лидов</button><button onClick={onOpenIntegrations}>Источники</button></div></div>',
  "funnel operational actions",
);

sales = replaceOnce(
  sales,
  '>{data.funnel.map((column, index) => {\n',
  '>{funnelColumns.map((column, index) => {\n',
  "visible empty funnel columns",
);

sales = replaceOnce(
  sales,
  '<p>Для лида {chainLead.id} пока нет связанного договора, начисления или платежа. Раздел продолжает работать без фиктивных связей.</p>',
  '<p>{hasLeads ? `Для лида ${chainLead.id} пока нет связанного договора, начисления или платежа.` : "Цепочка появится после первого лида и будет достраиваться только по подтверждённым договору, начислению и платежу."} Фиктивные связи не создаются.</p>',
  "empty chain explanation",
);

sales = replaceOnce(
  sales,
  '      {selected ? <LeadDrawer lead={selected} data={data} busy={busy} evidence={evidence} setEvidence={setEvidence} touchpointType={touchpointType} setTouchpointType={setTouchpointType} touchpointSummary={touchpointSummary} setTouchpointSummary={setTouchpointSummary} touchpointOutcome={touchpointOutcome} setTouchpointOutcome={setTouchpointOutcome} close={() => setSelected(null)} action={action} /> : null}\n',
  '      {leadCreateOpen ? <LeadCreateModal busy={busy === "create-lead"} close={() => setLeadCreateOpen(false)} save={async (lead) => { const saved = await action({ action: "createLead", ...lead }, "create-lead"); if (saved) { setLeadCreateOpen(false); setTab("leads"); } return saved; }} /> : null}\n      {selected ? <LeadDrawer lead={selected} data={data} busy={busy} evidence={evidence} setEvidence={setEvidence} touchpointType={touchpointType} setTouchpointType={setTouchpointType} touchpointSummary={touchpointSummary} setTouchpointSummary={setTouchpointSummary} touchpointOutcome={touchpointOutcome} setTouchpointOutcome={setTouchpointOutcome} close={() => setSelected(null)} action={action} /> : null}\n',
  "manual lead modal render",
);

sales = replaceOnce(
  sales,
  'function PanelHead({ eyebrow, title, aside }: { eyebrow: string; title: string; aside: string }) {\n',
  `function LeadCreateModal({ busy, close, save }: { busy: boolean; close: () => void; save: (lead: Record<string, unknown>) => Promise<boolean> }) {\n  const [name, setName] = useState("");\n  const [phone, setPhone] = useState("");\n  const [email, setEmail] = useState("");\n  const [source, setSource] = useState("Ручной ввод");\n  const [interest, setInterest] = useState("");\n  const [branchId, setBranchId] = useState("");\n  const [comment, setComment] = useState("");\n  const [utmSource, setUtmSource] = useState("");\n  const [utmMedium, setUtmMedium] = useState("");\n  const [utmCampaign, setUtmCampaign] = useState("");\n  const [consent, setConsent] = useState(false);\n  async function submit(event: FormEvent<HTMLFormElement>) {\n    event.preventDefault();\n    await save({ name, phone, email, source, interest, branchId, comment, utmSource, utmMedium, utmCampaign, consent });\n  }\n  return <div className="lead-create-layer"><button type="button" className="drawer-scrim" onClick={close} aria-label="Закрыть создание лида" /><form className="lead-create-modal" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="lead-create-title"><header><div><p>Новая запись в воронке</p><h2 id="lead-create-title">Добавить лид</h2></div><button type="button" onClick={close} aria-label="Закрыть">×</button></header><div className="lead-create-grid"><label><span>Имя *</span><input value={name} onChange={(event) => setName(event.target.value)} autoFocus required placeholder="Как обращаться к клиенту" /></label><label><span>Источник *</span><select value={source} onChange={(event) => setSource(event.target.value)}><option>Ручной ввод</option><option>Сайт</option><option>Телефон</option><option>WhatsApp</option><option>Telegram</option><option>VK</option><option>Яндекс</option><option>Email</option><option>Рекомендация</option><option>Другое</option></select></label><label><span>Телефон</span><input value={phone} onChange={(event) => setPhone(event.target.value)} inputMode="tel" autoComplete="tel" placeholder="+7 …" /></label><label><span>Email</span><input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" placeholder="name@example.ru" /></label><label><span>Интерес / услуга</span><input value={interest} onChange={(event) => setInterest(event.target.value)} placeholder="Садик, школа, курс, мероприятие" /></label><label><span>Филиал</span><select value={branchId} onChange={(event) => setBranchId(event.target.value)}><option value="">Пока не определён</option><option value="BR-KINDERGARTEN">Атлас — садик</option><option value="BR-ATLAS-SCHOOL">Атлас — школа</option><option value="BR-SCHOOL">1–11</option><option value="BR-NEBO">Небо</option><option value="BR-LISTVENNAYA">Лиственная</option></select></label><label className="wide"><span>Комментарий</span><textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Запрос клиента, удобное время связи, важные детали" /></label><details className="wide"><summary>UTM и рекламная атрибуция</summary><div className="lead-utm-grid"><label><span>utm_source</span><input value={utmSource} onChange={(event) => setUtmSource(event.target.value)} /></label><label><span>utm_medium</span><input value={utmMedium} onChange={(event) => setUtmMedium(event.target.value)} /></label><label><span>utm_campaign</span><input value={utmCampaign} onChange={(event) => setUtmCampaign(event.target.value)} /></label></div></details><label className="lead-consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} required /><span>Подтверждаю, что контакт передан клиентом для связи и может быть сохранён в ArtHello OS.</span></label></div><footer><span>После сохранения лид попадёт на этап «Заявка» без назначенного менеджера.</span><div><button type="button" onClick={close}>Отмена</button><button className="primary" disabled={busy || !name.trim() || (!phone.trim() && !email.trim()) || !consent}>{busy ? "Сохраняем…" : "Создать лид"}</button></div></footer></form></div>;\n}\n\nfunction PanelHead({ eyebrow, title, aside }: { eyebrow: string; title: string; aside: string }) {\n`,
  "manual lead form",
);

sales = replaceOnce(
  sales,
  '  lead: Lead; data: SalesData; busy: string; evidence: string; setEvidence: (value: string) => void; touchpointType: string; setTouchpointType: (value: string) => void; touchpointSummary: string; setTouchpointSummary: (value: string) => void; touchpointOutcome: string; setTouchpointOutcome: (value: string) => void; close: () => void; action: (body: Record<string, unknown>, key: string) => Promise<void>;\n',
  '  lead: Lead; data: SalesData; busy: string; evidence: string; setEvidence: (value: string) => void; touchpointType: string; setTouchpointType: (value: string) => void; touchpointSummary: string; setTouchpointSummary: (value: string) => void; touchpointOutcome: string; setTouchpointOutcome: (value: string) => void; close: () => void; action: (body: Record<string, unknown>, key: string) => Promise<boolean>;\n',
  "drawer action return type",
);

writeFileSync(salesTarget, sales, "utf8");

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
