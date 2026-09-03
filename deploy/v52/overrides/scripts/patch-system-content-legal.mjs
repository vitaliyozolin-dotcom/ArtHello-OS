import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function target(relativePath) {
  return fileURLToPath(new URL(`../${relativePath}`, import.meta.url));
}

function replaceText(source, search, replacement, label) {
  const first = source.indexOf(search);
  const second = first === -1 ? -1 : source.indexOf(search, first + search.length);
  if (first === -1 || second !== -1) {
    throw new Error(`System-wide UI patch failed at ${label}: expected exactly one text match`);
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + search.length)}`;
}

function replaceRegex(source, regex, replacement, label) {
  const flags = regex.flags.includes("g") ? regex.flags : `${regex.flags}g`;
  const matches = [...source.matchAll(new RegExp(regex.source, flags))];
  if (matches.length !== 1) {
    throw new Error(`System-wide UI patch failed at ${label}: expected one regex match, got ${matches.length}`);
  }
  return source.replace(regex, () => replacement);
}

function patch(relativePath, transform) {
  const path = target(relativePath);
  const before = readFileSync(path, "utf8");
  const after = transform(before);
  if (after === before) throw new Error(`System-wide UI patch produced no changes for ${relativePath}`);
  writeFileSync(path, after, "utf8");
}

const contentWorkspacePath = target("app/components/ContentWorkspace.tsx");
const contentWorkspaceSource = readFileSync(contentWorkspacePath, "utf8");
if (contentWorkspaceSource.includes('className="ahContentPage"')) {
  console.log("ContentWorkspace Design System override already owns the complete content shell");
} else {
  patch("app/components/ContentWorkspace.tsx", (input) => {
  let source = input;
  source = replaceText(
    source,
    'export function ContentWorkspace({ role, notify, onTasksChanged, onOpenSales, onOpenFinance, sourceOnly = false }: { role: string; notify: (value: string) => void; onTasksChanged: () => void; onOpenSales: () => void; onOpenFinance: () => void; sourceOnly?: boolean }) {',
    'export function ContentWorkspace({ role, notify, onTasksChanged, onOpenSales, onOpenFinance, onOpenIntegrations, sourceOnly = false }: { role: string; notify: (value: string) => void; onTasksChanged: () => void; onOpenSales: () => void; onOpenFinance: () => void; onOpenIntegrations: () => void; sourceOnly?: boolean }) {',
    "content integration prop",
  );
  source = replaceRegex(
    source,
    /  if \(!sourceOnly && !hasContentData && activeTab !== "studio"\) return <section className="page content-workspace">[\s\S]*?\n  <\/section>;/,
    `  if (!sourceOnly && !hasContentData && activeTab !== "studio") return <section className="page content-workspace operational-empty-workspace">\n    <div className="content-heading"><div><p className="eyebrow">Контент-студия ArtHello</p><h1>Контент и маркетинг</h1><p>Все рабочие разделы доступны сразу. Реальные показатели появятся после подключения каналов или создания первого материала.</p></div><div className="operational-heading-actions"><button onClick={() => setTab("studio")}>Открыть студию</button><button className="secondary" onClick={onOpenIntegrations}>Подключить каналы</button></div></div>\n    <div className="content-boundary"><strong>Данных пока нет</strong><span>Контент-план, публикации, атрибуция и рекомендации остаются доступными при нулевых данных.</span><em>фиктивные показатели не создаются</em></div>\n    <div className="content-kpis"><button onClick={() => setTab("publications")}><span>Охват</span><strong>0</strong><small>каналы не подключены</small></button><button onClick={() => setTab("publications")}><span>Переходы</span><strong>0</strong><small>метрик пока нет</small></button><button onClick={() => setTab("chain")}><span>Заявки → договоры</span><strong>0 → 0</strong><small>атрибуция пуста</small></button><button className="positive" onClick={() => setTab("chain")}><span>Выручка</span><strong>{rubles(0)}</strong><small>нет связанных операций</small></button></div>\n    <div className="content-tabs">{tabs.map((item) => <button key={item.id} className={activeTab === item.id ? "active" : ""} onClick={() => setTab(item.id)}>{item.label}{item.id === "recommendations" ? <b>0</b> : null}</button>)}</div>\n    {activeTab === "overview" ? <div className="operational-empty-grid"><button className="operational-empty-card" onClick={onOpenIntegrations}><span>01</span><strong>Каналы</strong><p>Подключите VK, Telegram, сайт, email, Яндекс или другие утверждённые источники.</p></button><button className="operational-empty-card" onClick={() => setTab("studio")}><span>02</span><strong>Студия</strong><p>Создавайте изображения по описанию и референсу после подключения провайдера.</p></button><button className="operational-empty-card" onClick={() => setTab("plan")}><span>03</span><strong>Контент-план</strong><p>Черновики, согласование, расписание и ответственные остаются в одном процессе.</p></button><button className="operational-empty-card" onClick={() => setTab("publications")}><span>04</span><strong>Публикации</strong><p>Ссылки, форматы и фактические метрики появятся после первого материала.</p></button><button className="operational-empty-card" onClick={() => setTab("chain")}><span>05</span><strong>До выручки</strong><p>Публикация связывается с переходом, лидом, договором и оплатой только по подтверждённым данным.</p></button><button className="operational-empty-card" onClick={() => setTab("recommendations")}><span>06</span><strong>Рекомендации</strong><p>Система не предлагает масштабирование без реальной статистики и атрибуции.</p></button></div> : null}\n    {activeTab === "plan" ? <article className="content-panel"><Head eyebrow="Редакционный ритм" title="Контент-план" aside="0 материалов" /><div className="empty-kanban">{["Черновик", "На согласовании", "Запланировано", "Опубликовано"].map((status) => <article key={status}><header><strong>{status}</strong><span>0</span></header><p>Материалы появятся после подключения канала и назначения автора.</p></article>)}</div></article> : null}\n    {activeTab === "publications" ? <div className="operational-inline-empty"><span>0</span><strong>Публикаций пока нет</strong><p>Подключите канал или подтвердите первую рабочую ссылку на опубликованный материал.</p><button onClick={onOpenIntegrations}>Подключить канал</button></div> : null}\n    {activeTab === "chain" ? <div className="operational-inline-empty"><span>→</span><strong>Атрибуция ещё не собрана</strong><p>Здесь появится маршрут публикация → переход → заявка → договор → платёж. Пустые связи не подменяются тестовыми.</p></div> : null}\n    {activeTab === "recommendations" ? <div className="operational-inline-empty"><span>0</span><strong>Рекомендаций пока нет</strong><p>Рекомендации формируются только после появления фактических публикаций и измеримых результатов.</p></div> : null}\n  </section>;`,
    "content complete empty shell",
  );
  source = replaceText(
    source,
    '{!studioMode && data.accounts.length ? <button onClick={() => setCreateOpen(true)}>+ Материал в план</button> : null}</div>',
    '<div className="operational-heading-actions">{!studioMode && data.accounts.length ? <button onClick={() => setCreateOpen(true)}>+ Материал в план</button> : null}{studioMode ? <button onClick={() => setTab("overview")}>Обзор контента</button> : null}<button className="secondary" onClick={onOpenIntegrations}>Подключить каналы</button></div></div>',
    "content heading actions",
  );
  source = replaceText(
    source,
    '\n\n    {activeTab === "overview" ?',
    '\n    {studioMode ? <div className="content-tabs">{tabs.map((item) => <button key={item.id} className={activeTab === item.id ? "active" : ""} onClick={() => setTab(item.id)}>{item.label}{item.id === "recommendations" ? <b>{data.recommendations.filter((row) => row.status !== "Закрыта").length}</b> : null}</button>)}</div> : null}\n\n    {activeTab === "overview" ?',
    "content studio navigation",
  );
  return source;
  });
}

const legalActionsPath = target("app/api/legal-actions/route.ts");
const legalActionsSource = readFileSync(legalActionsPath, "utf8");
const createContractDispatches = legalActionsSource.match(/if \(action === "createContract"\) return createContract\(/g)?.length ?? 0;
const createContractImplementations = legalActionsSource.match(/async function createContract\(/g)?.length ?? 0;
const hasConfirmedScanWorkflow = (legalActionsSource.includes('createContract(actor, context.appUserId, body)')
    || legalActionsSource.includes('createContract(actor, context.appUserId, role, body)'))
  && legalActionsSource.includes("async function claimScanDraft(");

if (hasConfirmedScanWorkflow && createContractDispatches === 1 && createContractImplementations === 1) {
  console.log("Legal actions already use the confirmed single-use scan workflow");
} else if (createContractDispatches === 1 && createContractImplementations === 1) {
  console.log("Legacy legal contract creation is already installed; preserving it");
} else if (createContractDispatches !== 0 || createContractImplementations !== 0) {
  throw new Error("System-wide UI patch found an ambiguous legal contract implementation");
} else patch("app/api/legal-actions/route.ts", (input) => {
  let source = input;
  source = replaceText(
    source,
    '    if (action === "createDocumentVersion") return version(actor, body);',
    '    if (action === "createContract") return createContract(actor, body);\n    if (action === "createDocumentVersion") return version(actor, body);',
    "legal create contract action",
  );
  source = replaceText(
    source,
    'async function version(actor: string, body: Record<string, unknown>) {',
    `async function createContract(actor: string, body: Record<string, unknown>) {\n  const partyName = clean(body.partyName, 180);\n  const partyType = clean(body.partyType, 60) || "Контрагент";\n  const contractType = clean(body.contractType, 80) || "Договор";\n  const number = clean(body.number, 80);\n  const validFrom = clean(body.validFrom, 10);\n  const validUntil = clean(body.validUntil, 10);\n  const signedStatus = clean(body.signedStatus, 40) || "Не подписан";\n  const limitRubles = Number(body.limitRubles ?? 0);\n  const closingRequired = body.closingRequired === true || body.closingRequired === "on";\n  if (partyName.length < 3 || number.length < 2 || !/^\\d{4}-\\d{2}-\\d{2}$/.test(validFrom) || !/^\\d{4}-\\d{2}-\\d{2}$/.test(validUntil) || validUntil < validFrom) {\n    return Response.json({ error: "Заполните сторону, номер и корректный срок договора" }, { status: 400 });\n  }\n  if (!Number.isFinite(limitRubles) || limitRubles < 0) return Response.json({ error: "Проверьте сумму или лимит договора" }, { status: 400 });\n  const db = getDb();\n  const suffix = crypto.randomUUID().slice(0, 8).toUpperCase();\n  const partyId = \`ENT-\${suffix}\`;\n  const contractId = \`LCON-\${suffix}\`;\n  const referenceDocumentId = \`DOG-\${suffix}\`;\n  await db.insert(entities).values({\n    id: partyId, entityType: partyType, displayName: partyName, status: "Активна", sourceSystem: "MANUAL",\n    sourceRecordId: \`LEGAL:\${partyId}\`, dataQuality: "Проверено", scope: "Юридический контур", metadata: "{}", createdBy: actor,\n  });\n  try {\n    const [contract] = await db.insert(legalContracts).values({\n      id: contractId, referenceDocumentId, contractType, partyType, partyEntityId: partyId, number, signedStatus, validFrom, validUntil,\n      limitMinor: Math.round(limitRubles * 100), spentMinor: 0, status: "На проверке", electronicSignatureStatus: "ЭП не подключена",\n      requisiteStatus: "Требуют проверки", ownerEntityId: "", closingRequired,\n    }).returning();\n    const stableId = \`LGLDOC-\${suffix}\`;\n    await db.insert(legalDocumentItems).values({\n      id: \`\${stableId}-V1\`, stableId, contractId, itemType: "Договор", title: \`\${contractType} № \${number}\`, version: 1,\n      required: true, signedStatus, status: "На проверке", dueDate: validUntil, reference: "Ручной ввод",\n    });\n    await audit(actor, "legal.contract_created", "legal_contract", contractId, { partyId, number, contractType });\n    return Response.json({ contract }, { status: 201 });\n  } catch (error) {\n    await db.delete(entities).where(eq(entities.id, partyId));\n    throw error;\n  }\n}\n\nasync function version(actor: string, body: Record<string, unknown>) {`,
    "legal contract create implementation",
  );
  return source;
});

console.log("System-wide patch content_legal applied");
