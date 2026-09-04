import { env } from "cloudflare:workers";
import {
  ensureCoreTables,
  readIntegrationCredential,
  saveIntegrationCredential,
} from "../../../../db";
import { canAccessModule } from "../../../../lib/access-policy";
import {
  getAuthenticatedRequestContext,
  verifyAuthenticatedRequestCsrf,
} from "../../../../lib/production-auth";
import { hasTrustedMutationOrigin } from "../../../../lib/request-security";

const CONNECTION_ID = "INT-T-ALFACRM";
const STATE_KEY = "alfacrm_connector:v1";
const CREDENTIAL_SCOPE = "ARTHELLO";
const CREDENTIAL_KIND = "ALFACRM-V2";
const CREDENTIAL_STATE_KEY = `integration_credential:v2:${encodeURIComponent(CONNECTION_ID)}:${encodeURIComponent(CREDENTIAL_SCOPE)}:${encodeURIComponent(CREDENTIAL_KIND)}`;
const PAGE_SIZE = 500;
const MIN_REQUEST_INTERVAL_MS = 240;
const REQUEST_TIMEOUT_MS = 30_000;
const SUBSCRIPTION_CHUNK_SIZE = 15;
const editors = new Set(["OWNER", "DIRECTOR", "REPRESENTATIVE", "INTEGRATIONS"]);
const moduleOrder = ["families", "staff", "groups", "lessons", "subscriptions", "finance"] as const;
type ModuleKey = typeof moduleOrder[number];
type JsonRecord = Record<string, unknown>;

type RemoteBranch = { id: string; name: string };
type LocalBranch = { id: string; name: string };
type ModuleState = {
  status: "not_started" | "previewed" | "importing" | "imported" | "error";
  previewCount: number;
  importedCount: number;
  lastPreviewAt: string;
  lastImportAt: string;
  previewToken: string;
  previewSignature: string;
  dateFrom: string;
  dateTo: string;
  cursor: number;
  note: string;
};
type AlfaState = {
  version: 1;
  connected: boolean;
  endpoint: string;
  emailMasked: string;
  hasAppKey: boolean;
  connectedAt: string;
  lastCheckedAt: string;
  remoteBranches: RemoteBranch[];
  branchMappings: Record<string, string>;
  modules: Record<ModuleKey, ModuleState>;
};
type Credentials = { email: string; apiKey: string; appKey: string };
type AlfaSession = Credentials & { endpoint: string; token: string };
type FetchedRecord = { remoteBranchId: string; item: JsonRecord };
type RequestContext = NonNullable<Awaited<ReturnType<typeof getAuthenticatedRequestContext>>>;

let requestTail: Promise<void> = Promise.resolve();
let lastRequestStartedAt = 0;

export async function GET(request: Request) {
  const context = await requireContext(request, false);
  if (context instanceof Response) return context;
  try {
    await ensureCoreTables();
    await ensureAlfaTables();
    const [state, branches, credentialRow] = await Promise.all([
      readState(),
      readLocalBranches(),
      env.DB.prepare("SELECT 1 AS present FROM system_runtime_state WHERE state_key=?")
        .bind(CREDENTIAL_STATE_KEY).first<{ present: number }>(),
    ]);
    const credentialStored = credentialRow?.present === 1;
    return privateJson({
      state: publicState({ ...state, connected: state.connected && credentialStored }),
      localBranches: branches,
      credentialStored,
      canManage: editors.has(context.apiRole),
      direction: "AlfaCRM → ArtHello OS",
      boundary: "Первичная загрузка выполняется только по выбранным филиалам и модулям. Обратная запись в AlfaCRM отключена.",
    });
  } catch (error) {
    return privateJson({ error: safeError(error) }, 503);
  }
}

export async function POST(request: Request) {
  const context = await requireContext(request, true);
  if (context instanceof Response) return context;
  if (!editors.has(context.apiRole)) return privateJson({ error: "Нет прав на настройку AlfaCRM" }, 403);
  try {
    await ensureCoreTables();
    await ensureAlfaTables();
    const body = await request.json() as Record<string, unknown>;
    const action = clean(body.action, 60);
    if (action === "connect") return connect(context, body);
    if (action === "refreshBranches") return refreshBranches(context);
    if (action === "saveBranchMappings") return saveBranchMappings(context, body);
    if (action === "previewModule") return previewModule(context, body);
    if (action === "importModule") return importModule(context, body);
    if (action === "disconnect") return disconnect(context);
    return privateJson({ error: "Неизвестное действие AlfaCRM" }, 400);
  } catch (error) {
    console.error("alfacrm.staged_action_failed");
    return privateJson({ error: safeError(error) }, 500);
  }
}

async function requireContext(request: Request, mutation: boolean): Promise<RequestContext | Response> {
  if (mutation) {
    const publicOrigin = (env as unknown as { ARTHELLO_PUBLIC_ORIGIN?: string }).ARTHELLO_PUBLIC_ORIGIN?.trim() ?? "";
    if (!hasTrustedMutationOrigin(request, publicOrigin)) {
      return privateJson({ error: "Запрос отклонён: источник страницы не совпадает" }, 403);
    }
  }
  let context: RequestContext | null;
  try {
    context = await getAuthenticatedRequestContext(request);
  } catch {
    return privateJson({ error: "Сервис авторизации временно недоступен" }, 503);
  }
  if (!context) return privateJson({ error: "Требуется вход" }, 401);
  if (!canAccessModule({
    apiRole: context.apiRole,
    isSystemOwner: context.auth.user.isSystemOwner,
    canAccessMedical: context.auth.user.canAccessMedical,
    allowedModules: context.auth.user.allowedModules,
  }, "integrations")) return privateJson({ error: "Раздел интеграций не назначен этому пользователю" }, 403);
  if (mutation) {
    try {
      verifyAuthenticatedRequestCsrf(request, context);
    } catch {
      return privateJson({ error: "Защитная сессия устарела. Войдите заново." }, 403);
    }
  }
  return context;
}

async function connect(context: RequestContext, body: Record<string, unknown>) {
  const endpoint = normalizeEndpoint(body.endpoint);
  const email = clean(body.email, 240).toLowerCase();
  const apiKey = cleanSecret(body.apiKey, 1024);
  const appKey = cleanSecret(body.appKey, 1024, true);
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) return privateJson({ error: "Укажите e-mail пользователя AlfaCRM" }, 400);
  if (apiKey.length < 8) return privateJson({ error: "Укажите ключ API (v2api) из AlfaCRM" }, 400);
  const credentials: Credentials = { email, apiKey, appKey };
  const token = await authenticate(endpoint, credentials);
  const session: AlfaSession = { endpoint, token, ...credentials };
  const remoteBranches = await loadRemoteBranches(session);
  if (!remoteBranches.length) return privateJson({ error: "AlfaCRM авторизована, но не вернула ни одного филиала" }, 422);

  await saveIntegrationCredential(context.actor, CONNECTION_ID, CREDENTIAL_SCOPE, CREDENTIAL_KIND, JSON.stringify(credentials));
  const previous = await readState();
  const remoteIds = new Set(remoteBranches.map((branch) => branch.id));
  const nextMappings = Object.fromEntries(Object.entries(previous.branchMappings).filter(([remoteId]) => remoteIds.has(remoteId)));
  const current = new Date().toISOString();
  const state: AlfaState = {
    ...previous,
    connected: true,
    endpoint,
    emailMasked: maskEmail(email),
    hasAppKey: Boolean(appKey),
    connectedAt: previous.connectedAt || current,
    lastCheckedAt: current,
    remoteBranches,
    branchMappings: nextMappings,
  };
  await persistState(state);
  await env.DB.batch([
    env.DB.prepare(`UPDATE integration_connections SET
      status='Подключено',auth_status='AlfaCRM авторизована · режим только чтение',
      verified_transfer=1,is_enabled=1,last_success_at=?,next_sync_at='',error_count=0,updated_at=?
      WHERE id=?`).bind(current, current, CONNECTION_ID),
    auditStatement(context.actor, "integration.alfacrm_connected", {
      branchCount: remoteBranches.length,
      hasAppKey: Boolean(appKey),
      direction: "read_only_inbound",
    }),
  ]);
  return privateJson({
    state: publicState(state),
    message: `AlfaCRM подключена. Найдено филиалов: ${remoteBranches.length}. Теперь сопоставьте нужные филиалы с ArtHello OS.`,
  });
}

async function refreshBranches(context: RequestContext) {
  const state = await requireConnectedState();
  const session = await storedSession(state);
  const remoteBranches = await loadRemoteBranches(session);
  const current = new Date().toISOString();
  const remoteIds = new Set(remoteBranches.map((branch) => branch.id));
  const next: AlfaState = {
    ...state,
    remoteBranches,
    lastCheckedAt: current,
    branchMappings: Object.fromEntries(Object.entries(state.branchMappings).filter(([remoteId]) => remoteIds.has(remoteId))),
  };
  await persistState(next);
  await env.DB.batch([
    env.DB.prepare("UPDATE integration_connections SET last_success_at=?,error_count=0,updated_at=? WHERE id=?")
      .bind(current, current, CONNECTION_ID),
    auditStatement(context.actor, "integration.alfacrm_connection_checked", { branchCount: remoteBranches.length }),
  ]);
  return privateJson({ state: publicState(next), message: `Соединение работает. AlfaCRM вернула филиалов: ${remoteBranches.length}.` });
}

async function saveBranchMappings(context: RequestContext, body: Record<string, unknown>) {
  const state = await requireConnectedState();
  const requested = body.mappings && typeof body.mappings === "object" && !Array.isArray(body.mappings)
    ? body.mappings as Record<string, unknown>
    : {};
  const remoteIds = new Set(state.remoteBranches.map((branch) => branch.id));
  const localBranches = await readLocalBranches();
  const localIds = new Set(localBranches.map((branch) => branch.id));
  const mappings: Record<string, string> = {};
  for (const [remoteId, localIdValue] of Object.entries(requested)) {
    const localId = clean(localIdValue, 80);
    if (!localId) continue;
    if (!remoteIds.has(remoteId)) return privateJson({ error: "В сопоставлении есть неизвестный филиал AlfaCRM" }, 400);
    if (!localIds.has(localId)) return privateJson({ error: "Выберите существующий активный филиал ArtHello OS" }, 400);
    mappings[remoteId] = localId;
  }
  if (!Object.keys(mappings).length) return privateJson({ error: "Сопоставьте хотя бы один филиал" }, 400);
  const next = { ...state, branchMappings: mappings };
  await persistState(next);
  await env.DB.batch([
    auditStatement(context.actor, "integration.alfacrm_branch_mapping_saved", {
      selectedRemoteBranches: Object.keys(mappings),
      mappingCount: Object.keys(mappings).length,
    }),
  ]);
  return privateJson({ state: publicState(next), message: `Сопоставлено филиалов: ${Object.keys(mappings).length}. Данные ещё не загружались.` });
}

async function previewModule(context: RequestContext, body: Record<string, unknown>) {
  const module = normalizeModule(body.module);
  const state = await requireConnectedState();
  const denial = dependencyError(module, state);
  if (denial) return privateJson({ error: denial }, 409);
  const selectedBranches = mappedRemoteBranches(state);
  if (!selectedBranches.length) return privateJson({ error: "Сначала сопоставьте филиалы" }, 409);
  const params = moduleParams(module, body);
  const session = await storedSession(state);
  const startedAt = new Date().toISOString();
  let count = 0;
  let countUnit = "записей";
  if (module === "subscriptions") {
    const customers = await readImportedCustomers(selectedBranches);
    count = customers.length;
    countUnit = "клиентов к проверке";
  } else {
    const rows = await fetchModuleRecords(session, module, selectedBranches, params);
    count = rows.length;
  }
  const previewToken = crypto.randomUUID();
  const previewSignature = await previewSignatureFor(module, state, params);
  const moduleState: ModuleState = {
    ...state.modules[module],
    status: "previewed",
    previewCount: count,
    lastPreviewAt: startedAt,
    previewToken,
    previewSignature,
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
    cursor: module === "subscriptions" ? 0 : state.modules[module].cursor,
    note: module === "subscriptions"
      ? "Абонементы читаются по карточкам клиентов пакетами, чтобы не перегружать AlfaCRM."
      : module === "finance"
        ? "Это движения CRM с выбранной даты. Они не дублируются в банковский ДДС автоматически."
        : "Предпросмотр ничего не записал в ArtHello OS.",
  };
  const next = { ...state, modules: { ...state.modules, [module]: moduleState } };
  await persistState(next);
  await env.DB.batch([
    auditStatement(context.actor, "integration.alfacrm_module_previewed", {
      module,
      count,
      selectedRemoteBranches: selectedBranches,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
    }),
  ]);
  return privateJson({
    state: publicState(next),
    module,
    count,
    countUnit,
    previewToken,
    message: `Предпросмотр готов: ${count} ${countUnit}. В ArtHello OS пока ничего не изменено.`,
  });
}

async function importModule(context: RequestContext, body: Record<string, unknown>) {
  const module = normalizeModule(body.module);
  const state = await requireConnectedState();
  const denial = dependencyError(module, state);
  if (denial) return privateJson({ error: denial }, 409);
  const selectedBranches = mappedRemoteBranches(state);
  if (!selectedBranches.length) return privateJson({ error: "Сначала сопоставьте филиалы" }, 409);
  const params = moduleParams(module, body);
  const storedModule = state.modules[module];
  const previewToken = clean(body.previewToken, 80);
  const signature = await previewSignatureFor(module, state, params);
  if (!previewToken || previewToken !== storedModule.previewToken || signature !== storedModule.previewSignature) {
    return privateJson({ error: "Параметры изменились после предпросмотра. Выполните предпросмотр ещё раз." }, 409);
  }
  const session = await storedSession(state);
  const localBranches = await readLocalBranches();
  let rows: FetchedRecord[] = [];
  let complete = true;
  let nextCursor = storedModule.cursor;
  if (module === "subscriptions") {
    const customers = await readImportedCustomers(selectedBranches);
    const start = Math.min(storedModule.cursor, customers.length);
    const portion = customers.slice(start, start + SUBSCRIPTION_CHUNK_SIZE);
    for (const customer of portion) {
      const tariffs = await fetchPaged(session, `${customer.remoteBranchId}/customer-tariff/index?customer_id=${encodeURIComponent(customer.customerId)}`, { dead: false });
      rows.push(...tariffs.map((item) => ({ remoteBranchId: customer.remoteBranchId, item: { ...item, customer_id: scalar(item.customer_id) || customer.customerId } })));
    }
    nextCursor = start + portion.length;
    complete = nextCursor >= customers.length;
  } else {
    rows = await fetchModuleRecords(session, module, selectedBranches, params);
  }

  const rawCount = await upsertRawRecords(module, rows);
  let accepted = 0;
  let rejected = 0;
  if (module === "families") ({ accepted, rejected } = await canonicalizeFamilies(rows, state, localBranches, context.actor));
  if (module === "staff") ({ accepted, rejected } = await canonicalizeStaff(rows, state, localBranches, context.actor));
  if (module === "groups") ({ accepted, rejected } = await canonicalizeGroups(rows, state, localBranches, context.actor));
  if (module === "lessons") ({ accepted, rejected } = await canonicalizeLessons(rows, state, context.actor));
  if (module === "subscriptions") ({ accepted, rejected } = await canonicalizeSubscriptions(rows, state));
  if (module === "finance") ({ accepted, rejected } = await canonicalizeFinance(rows, state, params));

  if (module === "groups") await syncMembershipsFromFamilyRaw(state, context.actor);
  const current = new Date().toISOString();
  const importedCount = module === "subscriptions"
    ? (storedModule.status === "importing" ? storedModule.importedCount : 0) + accepted
    : accepted;
  const moduleState: ModuleState = {
    ...storedModule,
    status: complete ? "imported" : "importing",
    importedCount,
    lastImportAt: current,
    cursor: module === "subscriptions" ? nextCursor : 0,
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
    note: complete
      ? moduleCompletionNote(module)
      : `Загружено пакетами: обработано клиентов ${nextCursor}. Нажмите «Продолжить загрузку».`,
  };
  const next = { ...state, modules: { ...state.modules, [module]: moduleState } };
  await persistState(next);
  await env.DB.batch([
    env.DB.prepare(`UPDATE integration_connections SET
      last_success_at=?,received_count=received_count+?,accepted_count=accepted_count+?,
      rejected_count=rejected_count+?,error_count=0,updated_at=? WHERE id=?`)
      .bind(current, rows.length, accepted, rejected, current, CONNECTION_ID),
    auditStatement(context.actor, "integration.alfacrm_module_imported", {
      module,
      fetched: rows.length,
      rawStored: rawCount,
      accepted,
      rejected,
      complete,
      cursor: nextCursor,
      selectedRemoteBranches: selectedBranches,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
    }),
  ]);
  return privateJson({
    state: publicState(next),
    module,
    fetched: rows.length,
    accepted,
    rejected,
    complete,
    nextCursor,
    message: complete
      ? `Модуль «${moduleTitle(module)}» загружен. Принято: ${accepted}, пропущено: ${rejected}.`
      : `Пакет абонементов загружен. Обработано клиентов: ${nextCursor}. Продолжите загрузку.`,
  });
}

async function disconnect(context: RequestContext) {
  const state = await readState();
  const next: AlfaState = { ...state, connected: false, lastCheckedAt: new Date().toISOString() };
  await env.DB.batch([
    env.DB.prepare("DELETE FROM system_runtime_state WHERE state_key=?").bind(CREDENTIAL_STATE_KEY),
    env.DB.prepare("INSERT INTO system_runtime_state (state_key,state_value,updated_at) VALUES (?,?,CURRENT_TIMESTAMP) ON CONFLICT(state_key) DO UPDATE SET state_value=excluded.state_value,updated_at=CURRENT_TIMESTAMP")
      .bind(STATE_KEY, JSON.stringify(next)),
    env.DB.prepare(`UPDATE integration_connections SET
      status='Ожидает доступ',auth_status='Доступ AlfaCRM удалён из ArtHello OS',verified_transfer=0,is_enabled=0,
      next_sync_at='',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(CONNECTION_ID),
    auditStatement(context.actor, "integration.alfacrm_disconnected", { importedDataPreserved: true }),
  ]);
  return privateJson({ state: publicState(next), message: "Доступ AlfaCRM удалён. Уже импортированные данные ArtHello OS сохранены." });
}

async function storedSession(state: AlfaState): Promise<AlfaSession> {
  const secret = await readIntegrationCredential(CONNECTION_ID, CREDENTIAL_SCOPE, CREDENTIAL_KIND);
  if (!secret) throw new Error("Подключение AlfaCRM не содержит сохранённого ключа. Подключите AlfaCRM заново.");
  let credentials: Credentials;
  try {
    const parsed = JSON.parse(secret) as Partial<Credentials>;
    credentials = {
      email: clean(parsed.email, 240).toLowerCase(),
      apiKey: cleanSecret(parsed.apiKey, 1024),
      appKey: cleanSecret(parsed.appKey, 1024, true),
    };
  } catch {
    throw new Error("Сохранённый доступ AlfaCRM повреждён. Подключите AlfaCRM заново.");
  }
  if (!credentials.email || !credentials.apiKey) throw new Error("Сохранённый доступ AlfaCRM неполный. Подключите AlfaCRM заново.");
  const token = await authenticate(state.endpoint, credentials);
  return { endpoint: state.endpoint, token, ...credentials };
}

async function authenticate(endpoint: string, credentials: Credentials) {
  const response = await alfaFetch(`${endpoint}/v2api/auth/login`, {
    method: "POST",
    headers: alfaHeaders("", credentials.appKey),
    body: JSON.stringify({ email: credentials.email, api_key: credentials.apiKey }),
  });
  const payload = await readJson(response);
  const token = record(payload)?.token;
  if (!response.ok || typeof token !== "string" || token.length < 10) {
    throw new AlfaApiError(response.status === 401 || response.status === 403
      ? "AlfaCRM отклонила e-mail или ключ API. Проверьте доступ v2api в карточке пользователя."
      : `AlfaCRM не подтвердила авторизацию (${response.status}).`);
  }
  return token;
}

async function loadRemoteBranches(session: AlfaSession): Promise<RemoteBranch[]> {
  const items = await fetchPaged(session, "0/branch/index", {});
  const result = items.flatMap((item) => {
    const id = scalar(item.id ?? item.branch_id);
    if (!id) return [];
    const name = scalar(item.name ?? item.title ?? item.branch_name) || `Филиал ${id}`;
    return [{ id, name: name.slice(0, 160) }];
  });
  return [...new Map(result.map((branch) => [branch.id, branch])).values()].sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

async function fetchModuleRecords(session: AlfaSession, module: ModuleKey, branchIds: string[], params: { dateFrom: string; dateTo: string }) {
  const rows: FetchedRecord[] = [];
  for (const remoteBranchId of branchIds) {
    let path = "";
    let filters: JsonRecord = {};
    if (module === "families") {
      path = `${remoteBranchId}/customer/index`;
      filters = { is_study: 1, removed: 0, withGroups: true };
    } else if (module === "staff") {
      path = `${remoteBranchId}/teacher/index`;
      filters = { removed: 0 };
    } else if (module === "groups") {
      path = `${remoteBranchId}/group/index`;
      filters = { removed: 0 };
    } else if (module === "lessons") {
      path = `${remoteBranchId}/lesson/index`;
      filters = { date_from: params.dateFrom, date_to: params.dateTo };
    } else if (module === "finance") {
      path = `${remoteBranchId}/pay/index`;
      filters = { date_from: params.dateFrom.replace(/-/g, "."), date_to: params.dateTo.replace(/-/g, ".") };
    } else {
      continue;
    }
    const items = await fetchPaged(session, path, filters);
    rows.push(...items.map((item) => ({ remoteBranchId, item })));
  }
  return rows;
}

async function fetchPaged(session: AlfaSession, path: string, filters: JsonRecord) {
  const items: JsonRecord[] = [];
  let page = 0;
  let previousFingerprint = "";
  while (page < 120) {
    const response = await alfaFetch(`${session.endpoint}/v2api/${path}`, {
      method: "POST",
      headers: alfaHeaders(session.token, session.appKey),
      body: JSON.stringify({ ...filters, page, pageSize: PAGE_SIZE }),
    });
    if (response.status === 401) throw new AlfaApiError("Сессия AlfaCRM истекла во время чтения. Повторите действие — ключ в ArtHello OS сохранён.");
    if (!response.ok) throw new AlfaApiError(`AlfaCRM не выполнила чтение данных (${response.status}).`);
    const payload = await readJson(response);
    const pageItems = listItems(payload);
    const fingerprint = pageItems.length ? await hashText(JSON.stringify(pageItems.map((item) => scalar(item.id ?? item.customer_id ?? item.student_id)).slice(0, 12))) : "";
    if (page > 0 && fingerprint && fingerprint === previousFingerprint) break;
    if (fingerprint) previousFingerprint = fingerprint;
    items.push(...pageItems);
    const total = totalItems(payload);
    if (!pageItems.length || pageItems.length < PAGE_SIZE || (total !== null && items.length >= total)) break;
    page += 1;
  }
  return items;
}

async function alfaFetch(input: string, init: RequestInit) {
  let release: (() => void) | undefined;
  const previous = requestTail;
  requestTail = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    const wait = Math.max(0, MIN_REQUEST_INTERVAL_MS - (Date.now() - lastRequestStartedAt));
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequestStartedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(input, { ...init, signal: controller.signal, cache: "no-store", redirect: "error" });
    } finally {
      clearTimeout(timeout);
    }
  } finally {
    release?.();
  }
}

function alfaHeaders(token: string, appKey: string) {
  return {
    accept: "application/json",
    "content-type": "application/json",
    ...(token ? { "X-ALFACRM-TOKEN": token } : {}),
    ...(appKey ? { "X-APP-KEY": appKey } : {}),
  };
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length > 6_000_000) throw new AlfaApiError("AlfaCRM вернула слишком большой ответ. Сузьте период или набор данных.");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AlfaApiError("AlfaCRM вернула некорректный ответ.");
  }
}

async function ensureAlfaTables() {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS alfacrm_import_records (
      remote_branch_id TEXT NOT NULL,
      module TEXT NOT NULL,
      record_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      imported_at TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(remote_branch_id,module,record_id)
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS alfacrm_customer_tariffs (
      remote_branch_id TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      tariff_record_id TEXT NOT NULL,
      tariff_id TEXT NOT NULL DEFAULT '',
      balance_minor INTEGER NOT NULL DEFAULT 0,
      valid_from TEXT NOT NULL DEFAULT '',
      valid_to TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Текущий снимок',
      family_entity_id TEXT NOT NULL DEFAULT '',
      payload_hash TEXT NOT NULL,
      imported_at TEXT NOT NULL,
      PRIMARY KEY(remote_branch_id,customer_id,tariff_record_id)
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS alfacrm_finance_snapshots (
      remote_branch_id TEXT NOT NULL,
      payment_id TEXT NOT NULL,
      customer_id TEXT NOT NULL DEFAULT '',
      family_entity_id TEXT NOT NULL DEFAULT '',
      operation_date TEXT NOT NULL,
      direction TEXT NOT NULL,
      amount_minor INTEGER NOT NULL,
      category TEXT NOT NULL DEFAULT '',
      payload_hash TEXT NOT NULL,
      imported_at TEXT NOT NULL,
      PRIMARY KEY(remote_branch_id,payment_id)
    )`),
  ]);
}

async function upsertRawRecords(module: ModuleKey, rows: FetchedRecord[]) {
  const now = new Date().toISOString();
  const statements = [];
  for (const row of rows) {
    const payload = JSON.stringify(row.item);
    const payloadHash = await hashText(payload);
    const id = scalar(row.item.id ?? row.item.customer_id ?? row.item.student_id) || payloadHash;
    statements.push(env.DB.prepare(`INSERT INTO alfacrm_import_records
      (remote_branch_id,module,record_id,payload,payload_hash,imported_at,updated_at)
      VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(remote_branch_id,module,record_id) DO UPDATE SET
        payload=excluded.payload,payload_hash=excluded.payload_hash,imported_at=excluded.imported_at,updated_at=CURRENT_TIMESTAMP`)
      .bind(row.remoteBranchId, module, id, payload, payloadHash, now));
  }
  await runBatches(statements);
  return statements.length;
}

async function canonicalizeFamilies(rows: FetchedRecord[], state: AlfaState, localBranches: LocalBranch[], actor: string) {
  const branchNames = new Map(localBranches.map((branch) => [branch.id, branch.name]));
  const statements = [];
  let accepted = 0;
  let rejected = 0;
  for (const { remoteBranchId, item } of rows) {
    const studentId = scalar(item.id);
    const childName = scalar(item.name ?? item.full_name);
    const localBranchId = state.branchMappings[remoteBranchId] ?? "";
    if (!studentId || !childName || !localBranchId) { rejected += 1; continue; }
    const phone = normalizePhone(item.phone);
    const email = firstScalar(item.email).toLowerCase();
    const guardianName = scalar(item.legal_name ?? item.payer_name ?? item.parent_name);
    const familyIdentity = guardianName || phone ? `${normalizeName(guardianName)}|${phone}` : `student:${studentId}`;
    const familyHash = await shortHash(`${remoteBranchId}:${familyIdentity}`);
    const childHash = await shortHash(`${remoteBranchId}:${studentId}`);
    const familyId = `FAM-A-${familyHash}`;
    const parentId = `CLI-A-${familyHash}`;
    const childId = `CHD-A-${childHash}`;
    const scope = branchNames.get(localBranchId) ?? localBranchId;
    const quality = guardianName ? "Импортировано из AlfaCRM" : "Требует сверки";
    const familyName = `Семья ${guardianName ? guardianName.split(/\s+/)[0] : childName.split(/\s+/)[0]}`.trim();
    const common = { remoteBranchId, localBranchId, alfaCustomerId: studentId };
    statements.push(
      entityUpsert(familyId, "Семья", familyName, `family:${remoteBranchId}:${familyHash}`, quality, scope, { ...common, guardianName, phone }, actor),
      entityUpsert(parentId, "Клиент", guardianName || "Представитель семьи", `guardian:${remoteBranchId}:${familyHash}`, quality, scope, { ...common, phone, email, guardianName }, actor),
      entityUpsert(childId, "Ребёнок", childName, `student:${remoteBranchId}:${studentId}`, "Импортировано из AlfaCRM", scope, {
        ...common,
        dob: isoDate(item.dob),
        phone,
        email,
        groupIds: groupIds(item),
      }, actor),
      env.DB.prepare("INSERT OR IGNORE INTO entity_links (from_entity_id,to_entity_id,relation_type,created_by) VALUES (?,?,?,?)")
        .bind(familyId, parentId, "Клиентская карточка семьи", actor),
      env.DB.prepare("INSERT OR IGNORE INTO entity_links (from_entity_id,to_entity_id,relation_type,created_by) VALUES (?,?,?,?)")
        .bind(familyId, childId, "Семья → ребёнок", actor),
    );
    accepted += 1;
  }
  await runBatches(statements);
  return { accepted, rejected };
}

async function canonicalizeStaff(rows: FetchedRecord[], state: AlfaState, localBranches: LocalBranch[], actor: string) {
  const branchNames = new Map(localBranches.map((branch) => [branch.id, branch.name]));
  const statements = [];
  let accepted = 0;
  let rejected = 0;
  for (const { remoteBranchId, item } of rows) {
    const teacherId = scalar(item.id);
    const name = scalar(item.name ?? item.full_name);
    const localBranchId = state.branchMappings[remoteBranchId] ?? "";
    if (!teacherId || !name || !localBranchId) { rejected += 1; continue; }
    const employeeId = await localTeacherId(remoteBranchId, teacherId);
    const scope = branchNames.get(localBranchId) ?? localBranchId;
    statements.push(
      entityUpsert(employeeId, "Сотрудник", name, `teacher:${remoteBranchId}:${teacherId}`, "Импортировано из AlfaCRM", scope, {
        remoteBranchId,
        localBranchId,
        alfaTeacherId: teacherId,
        phone: normalizePhone(item.phone),
        email: firstScalar(item.email).toLowerCase(),
        sourceRole: "Педагог AlfaCRM",
      }, actor),
      env.DB.prepare(`INSERT INTO hr_employees
        (id,candidate_id,contract_id,position_id,unit,rate_minor,hire_date,status,termination_date,termination_reason,access_status,created_at,updated_at)
        VALUES (?,'','','PEDAGOG',?,0,'','Работает','','','Доступ не выдан',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET unit=excluded.unit,status='Работает',access_status=CASE WHEN hr_employees.access_status='' THEN 'Доступ не выдан' ELSE hr_employees.access_status END,updated_at=CURRENT_TIMESTAMP`)
        .bind(employeeId, scope),
    );
    accepted += 1;
  }
  await runBatches(statements);
  return { accepted, rejected };
}

async function canonicalizeGroups(rows: FetchedRecord[], state: AlfaState, localBranches: LocalBranch[], actor: string) {
  const statements = [];
  const programIds = new Map<string, string>();
  for (const branch of localBranches) {
    const programId = `PRG-A-${await shortHash(branch.id)}`;
    programIds.set(branch.id, programId);
    statements.push(env.DB.prepare(`INSERT INTO education_programs
      (id,title,version,status,author_entity_id,methodist_entity_id,scope,material_ref,expected_result,source_type,created_at,updated_at)
      VALUES (?, ?, 1, 'Активна', '', '', ?, 'AlfaCRM', 'Оперативные группы и расписание из AlfaCRM', 'ALFACRM', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title,scope=excluded.scope,status='Активна',updated_at=CURRENT_TIMESTAMP`)
      .bind(programId, `AlfaCRM · ${branch.name}`, branch.name));
  }
  let accepted = 0;
  let rejected = 0;
  for (const { remoteBranchId, item } of rows) {
    const groupId = scalar(item.id);
    const name = scalar(item.name);
    const localBranchId = state.branchMappings[remoteBranchId] ?? "";
    if (!groupId || !name || !localBranchId) { rejected += 1; continue; }
    const teacherRemoteId = scalar(item.teacher_id) || firstTeacherId(item);
    const teacherEntityId = teacherRemoteId ? await localTeacherId(remoteBranchId, teacherRemoteId) : "";
    const id = await localGroupId(remoteBranchId, groupId);
    const programId = programIds.get(localBranchId) ?? `PRG-A-${await shortHash(localBranchId)}`;
    statements.push(env.DB.prepare(`INSERT INTO education_groups
      (id,name,unit_entity_id,program_id,teacher_entity_id,room,status)
      VALUES (?,?,?,?,?,?,'Активна')
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,unit_entity_id=excluded.unit_entity_id,program_id=excluded.program_id,teacher_entity_id=excluded.teacher_entity_id,room=excluded.room,status='Активна'`)
      .bind(id, name, localBranchId, programId, teacherEntityId, scalar(item.room_name ?? item.room ?? item.location_name)));
    accepted += 1;
  }
  await runBatches(statements);
  return { accepted, rejected };
}

async function syncMembershipsFromFamilyRaw(state: AlfaState, actor: string) {
  const rows = await env.DB.prepare("SELECT remote_branch_id,record_id,payload FROM alfacrm_import_records WHERE module='families' ORDER BY remote_branch_id,record_id")
    .all<{ remote_branch_id: string; record_id: string; payload: string }>();
  const statements = [];
  for (const row of rows.results ?? []) {
    if (!state.branchMappings[row.remote_branch_id]) continue;
    let item: JsonRecord;
    try { item = JSON.parse(row.payload) as JsonRecord; } catch { continue; }
    const studentId = scalar(item.id) || row.record_id;
    const childId = `CHD-A-${await shortHash(`${row.remote_branch_id}:${studentId}`)}`;
    const phone = normalizePhone(item.phone);
    const guardianName = scalar(item.legal_name ?? item.payer_name ?? item.parent_name);
    const familyIdentity = guardianName || phone ? `${normalizeName(guardianName)}|${phone}` : `student:${studentId}`;
    const familyId = `FAM-A-${await shortHash(`${row.remote_branch_id}:${familyIdentity}`)}`;
    for (const remoteGroupId of groupIds(item)) {
      const groupId = await localGroupId(row.remote_branch_id, remoteGroupId);
      const studentRowId = `STU-A-${await shortHash(`${row.remote_branch_id}:${studentId}:${remoteGroupId}`)}`;
      statements.push(env.DB.prepare(`INSERT INTO education_students
        (id,child_entity_id,family_entity_id,group_id,cabinet_status,status)
        SELECT ?,?,?,?,'Доступ не выдан','Активен' WHERE EXISTS (SELECT 1 FROM education_groups WHERE id=?)
        ON CONFLICT(id) DO UPDATE SET child_entity_id=excluded.child_entity_id,family_entity_id=excluded.family_entity_id,group_id=excluded.group_id,status='Активен'`)
        .bind(studentRowId, childId, familyId, groupId, groupId));
    }
  }
  await runBatches(statements);
  if (statements.length) await env.DB.batch([auditStatement(actor, "integration.alfacrm_memberships_synced", { membershipsConsidered: statements.length })]);
}

async function canonicalizeLessons(rows: FetchedRecord[], state: AlfaState, actor: string) {
  const groups = await env.DB.prepare("SELECT id,program_id FROM education_groups").all<{ id: string; program_id: string }>();
  const groupPrograms = new Map((groups.results ?? []).map((row) => [row.id, row.program_id]));
  const statements = [];
  let accepted = 0;
  let rejected = 0;
  for (const { remoteBranchId, item } of rows) {
    const lessonId = scalar(item.id);
    const remoteGroupId = scalar(item.group_id ?? record(item.group)?.id);
    const date = isoDate(item.date ?? item.lesson_date);
    const localBranchId = state.branchMappings[remoteBranchId] ?? "";
    if (!lessonId || !remoteGroupId || !date || !localBranchId) { rejected += 1; continue; }
    const groupId = await localGroupId(remoteBranchId, remoteGroupId);
    const programId = groupPrograms.get(groupId);
    if (!programId) { rejected += 1; continue; }
    const teacherRemoteId = scalar(item.teacher_id ?? record(item.teacher)?.id);
    const teacherEntityId = teacherRemoteId ? await localTeacherId(remoteBranchId, teacherRemoteId) : "";
    const id = `LES-A-${await shortHash(`${remoteBranchId}:${lessonId}`)}`;
    statements.push(env.DB.prepare(`INSERT INTO education_lessons
      (id,group_id,program_id,scheduled_at,topic,teacher_entity_id,substitute_entity_id,room,status,homework,created_at,updated_at)
      VALUES (?,?,?,?,?,?,'',?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET group_id=excluded.group_id,program_id=excluded.program_id,scheduled_at=excluded.scheduled_at,topic=excluded.topic,teacher_entity_id=excluded.teacher_entity_id,room=excluded.room,status=excluded.status,homework=excluded.homework,updated_at=CURRENT_TIMESTAMP`)
      .bind(
        id,
        groupId,
        programId,
        lessonTimestamp(date, item.time_from ?? item.start_time),
        scalar(item.topic ?? item.name ?? item.title) || "Занятие AlfaCRM",
        teacherEntityId,
        scalar(item.room_name ?? item.room ?? item.location_name),
        scalar(item.status) || "Импортировано",
        scalar(item.homework),
      ));
    accepted += 1;
  }
  await runBatches(statements);
  if (accepted) await env.DB.batch([auditStatement(actor, "integration.alfacrm_lessons_projected", { accepted, rejected })]);
  return { accepted, rejected };
}

async function canonicalizeSubscriptions(rows: FetchedRecord[], state: AlfaState) {
  const familyMap = await familyEntityMap(state);
  const statements = [];
  const current = new Date().toISOString();
  let accepted = 0;
  let rejected = 0;
  for (const { remoteBranchId, item } of rows) {
    const id = scalar(item.id);
    const customerId = scalar(item.customer_id);
    if (!id || !customerId) { rejected += 1; continue; }
    const payloadHash = await hashText(JSON.stringify(item));
    statements.push(env.DB.prepare(`INSERT INTO alfacrm_customer_tariffs
      (remote_branch_id,customer_id,tariff_record_id,tariff_id,balance_minor,valid_from,valid_to,status,family_entity_id,payload_hash,imported_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(remote_branch_id,customer_id,tariff_record_id) DO UPDATE SET
        tariff_id=excluded.tariff_id,balance_minor=excluded.balance_minor,valid_from=excluded.valid_from,valid_to=excluded.valid_to,status=excluded.status,family_entity_id=excluded.family_entity_id,payload_hash=excluded.payload_hash,imported_at=excluded.imported_at`)
      .bind(remoteBranchId, customerId, id, scalar(item.tariff_id), moneyMinor(item.balance), isoDate(item.b_date), isoDate(item.e_date), "Текущий снимок AlfaCRM", familyMap.get(`${remoteBranchId}:${customerId}`) ?? "", payloadHash, current));
    accepted += 1;
  }
  await runBatches(statements);
  return { accepted, rejected };
}

async function canonicalizeFinance(rows: FetchedRecord[], state: AlfaState, params: { dateFrom: string; dateTo: string }) {
  const familyMap = await familyEntityMap(state);
  const statements = [];
  const current = new Date().toISOString();
  let accepted = 0;
  let rejected = 0;
  for (const { remoteBranchId, item } of rows) {
    const id = scalar(item.id);
    const operationDate = isoDate(item.document_date ?? item.date);
    const customerId = scalar(item.customer_id ?? item.student_id);
    const income = numberValue(item.income);
    const outcome = numberValue(item.outcome);
    const direct = numberValue(item.amount);
    const numeric = direct !== null ? direct : income !== null ? income : outcome !== null ? -Math.abs(outcome) : null;
    if (!id || !operationDate || numeric === null || operationDate < params.dateFrom || operationDate > params.dateTo) { rejected += 1; continue; }
    const payloadHash = await hashText(JSON.stringify(item));
    statements.push(env.DB.prepare(`INSERT INTO alfacrm_finance_snapshots
      (remote_branch_id,payment_id,customer_id,family_entity_id,operation_date,direction,amount_minor,category,payload_hash,imported_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(remote_branch_id,payment_id) DO UPDATE SET
        customer_id=excluded.customer_id,family_entity_id=excluded.family_entity_id,operation_date=excluded.operation_date,direction=excluded.direction,amount_minor=excluded.amount_minor,category=excluded.category,payload_hash=excluded.payload_hash,imported_at=excluded.imported_at`)
      .bind(
        remoteBranchId,
        id,
        customerId,
        familyMap.get(`${remoteBranchId}:${customerId}`) ?? "",
        operationDate,
        numeric >= 0 ? "Поступление" : "Списание",
        Math.round(Math.abs(numeric) * 100),
        scalar(item.pay_item_name ?? item.payment_type_name ?? item.pay_type_name ?? item.note) || "Движение AlfaCRM",
        payloadHash,
        current,
      ));
    accepted += 1;
  }
  await runBatches(statements);
  return { accepted, rejected };
}

async function familyEntityMap(state: AlfaState) {
  const rows = await env.DB.prepare("SELECT remote_branch_id,record_id,payload FROM alfacrm_import_records WHERE module='families'")
    .all<{ remote_branch_id: string; record_id: string; payload: string }>();
  const map = new Map<string, string>();
  for (const row of rows.results ?? []) {
    if (!state.branchMappings[row.remote_branch_id]) continue;
    let item: JsonRecord;
    try { item = JSON.parse(row.payload) as JsonRecord; } catch { continue; }
    const customerId = scalar(item.id) || row.record_id;
    const phone = normalizePhone(item.phone);
    const guardianName = scalar(item.legal_name ?? item.payer_name ?? item.parent_name);
    const identity = guardianName || phone ? `${normalizeName(guardianName)}|${phone}` : `student:${customerId}`;
    map.set(`${row.remote_branch_id}:${customerId}`, `FAM-A-${await shortHash(`${row.remote_branch_id}:${identity}`)}`);
  }
  return map;
}

async function readImportedCustomers(remoteBranches: string[]) {
  const rows = await env.DB.prepare("SELECT remote_branch_id,record_id FROM alfacrm_import_records WHERE module='families' ORDER BY remote_branch_id,record_id")
    .all<{ remote_branch_id: string; record_id: string }>();
  const selected = new Set(remoteBranches);
  return (rows.results ?? []).flatMap((row) => selected.has(row.remote_branch_id)
    ? [{ remoteBranchId: row.remote_branch_id, customerId: row.record_id }]
    : []);
}

function entityUpsert(id: string, entityType: string, displayName: string, sourceRecordId: string, dataQuality: string, scope: string, metadata: JsonRecord, actor: string) {
  return env.DB.prepare(`INSERT INTO entities
    (id,entity_type,display_name,status,source_system,source_record_id,data_quality,scope,metadata,created_by,created_at,updated_at)
    VALUES (?,?,?,'Активна','ALFACRM',?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name,status='Активна',data_quality=excluded.data_quality,scope=excluded.scope,metadata=excluded.metadata,updated_at=CURRENT_TIMESTAMP`)
    .bind(id, entityType, displayName.slice(0, 180), sourceRecordId, dataQuality, scope, JSON.stringify(metadata), actor);
}

async function readState(): Promise<AlfaState> {
  const row = await env.DB.prepare("SELECT state_value FROM system_runtime_state WHERE state_key=?")
    .bind(STATE_KEY).first<{ state_value: string }>();
  if (!row) return defaultState();
  try {
    const parsed = JSON.parse(row.state_value) as Partial<AlfaState>;
    const defaults = defaultState();
    const modules = Object.fromEntries(moduleOrder.map((key) => [key, { ...defaults.modules[key], ...(parsed.modules?.[key] ?? {}) }])) as Record<ModuleKey, ModuleState>;
    return {
      ...defaults,
      ...parsed,
      version: 1,
      connected: parsed.connected === true,
      endpoint: typeof parsed.endpoint === "string" ? parsed.endpoint : "",
      emailMasked: typeof parsed.emailMasked === "string" ? parsed.emailMasked : "",
      hasAppKey: parsed.hasAppKey === true,
      remoteBranches: Array.isArray(parsed.remoteBranches) ? parsed.remoteBranches.filter(isRemoteBranch).slice(0, 500) : [],
      branchMappings: parsed.branchMappings && typeof parsed.branchMappings === "object" ? parsed.branchMappings as Record<string, string> : {},
      modules,
    };
  } catch {
    return defaultState();
  }
}

function defaultState(): AlfaState {
  const module = (): ModuleState => ({
    status: "not_started", previewCount: 0, importedCount: 0,
    lastPreviewAt: "", lastImportAt: "", previewToken: "", previewSignature: "",
    dateFrom: "", dateTo: "", cursor: 0, note: "",
  });
  return {
    version: 1, connected: false, endpoint: "", emailMasked: "", hasAppKey: false,
    connectedAt: "", lastCheckedAt: "", remoteBranches: [], branchMappings: {},
    modules: { families: module(), staff: module(), groups: module(), lessons: module(), subscriptions: module(), finance: module() },
  };
}

async function persistState(state: AlfaState) {
  await env.DB.prepare(`INSERT INTO system_runtime_state (state_key,state_value,updated_at)
    VALUES (?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(state_key) DO UPDATE SET state_value=excluded.state_value,updated_at=CURRENT_TIMESTAMP`)
    .bind(STATE_KEY, JSON.stringify(state)).run();
}

function publicState(state: AlfaState) { return state; }

async function readLocalBranches(): Promise<LocalBranch[]> {
  const rows = await env.DB.prepare("SELECT id,name FROM organization_branches WHERE status='Активен' ORDER BY sort_order,name")
    .all<LocalBranch>();
  return rows.results ?? [];
}

function mappedRemoteBranches(state: AlfaState) {
  const available = new Set(state.remoteBranches.map((branch) => branch.id));
  return Object.entries(state.branchMappings).filter(([remoteId, localId]) => available.has(remoteId) && Boolean(localId)).map(([remoteId]) => remoteId);
}

function dependencyError(module: ModuleKey, state: AlfaState) {
  if (module === "groups" && state.modules.staff.status !== "imported") return "Сначала загрузите сотрудников: группы должны сразу связаться с педагогами.";
  if (module === "lessons" && (state.modules.staff.status !== "imported" || state.modules.groups.status !== "imported")) return "Сначала загрузите сотрудников и группы.";
  if ((module === "subscriptions" || module === "finance") && state.modules.families.status !== "imported") return "Сначала загрузите семьи и детей.";
  return "";
}

function moduleParams(module: ModuleKey, body: Record<string, unknown>) {
  const today = new Date().toISOString().slice(0, 10);
  let dateFrom = "";
  let dateTo = "";
  if (module === "lessons") {
    dateFrom = clean(body.dateFrom, 10);
    dateTo = clean(body.dateTo, 10);
    if (!isoDate(dateFrom) || !isoDate(dateTo) || dateFrom > dateTo) throw new Error("Укажите корректный период занятий");
    if (daysBetween(dateFrom, dateTo) > 370) throw new Error("Для занятий выбирайте период не более 370 дней за один импорт");
  }
  if (module === "finance") {
    dateFrom = clean(body.transitionDate ?? body.dateFrom, 10);
    dateTo = today;
    if (!isoDate(dateFrom) || dateFrom > today) throw new Error("Укажите корректную дату перехода для оплат");
    if (daysBetween(dateFrom, dateTo) > 730) throw new Error("Для первичного финансового импорта выберите дату перехода не старше двух лет");
  }
  return { dateFrom, dateTo };
}

async function previewSignatureFor(module: ModuleKey, state: AlfaState, params: { dateFrom: string; dateTo: string }) {
  const mappings = Object.entries(state.branchMappings).sort(([left], [right]) => left.localeCompare(right));
  return hashText(JSON.stringify({ module, mappings, params }));
}

function moduleCompletionNote(module: ModuleKey) {
  if (module === "families") return "Семьи и дети созданы из выбранных филиалов. Межфилиальные дубли автоматически не объединялись.";
  if (module === "staff") return "Сотрудники созданы без выдачи доступов. Доступы остаются отдельным действием владельца.";
  if (module === "groups") return "Группы связаны с импортированными педагогами; членство детей восстановлено по данным AlfaCRM.";
  if (module === "lessons") return "Загружены только занятия выбранного периода.";
  if (module === "subscriptions") return "Сохранены текущие снимки абонементов и их балансов по импортированным клиентам.";
  return "Сохранены только движения AlfaCRM с даты перехода. Они не добавлены в банковский ДДС, чтобы не задвоить деньги.";
}

function moduleTitle(module: ModuleKey) {
  return ({ families: "Семьи и дети", staff: "Сотрудники", groups: "Классы и группы", lessons: "Расписание и занятия", subscriptions: "Абонементы и текущие остатки", finance: "Оплаты с даты перехода" } satisfies Record<ModuleKey, string>)[module];
}

function normalizeModule(value: unknown): ModuleKey {
  const candidate = clean(value, 40) as ModuleKey;
  if (!moduleOrder.includes(candidate)) throw new Error("Неизвестный модуль AlfaCRM");
  return candidate;
}

async function requireConnectedState() {
  const state = await readState();
  if (!state.connected || !state.endpoint) throw new Error("Сначала подключите AlfaCRM");
  return state;
}

function normalizeEndpoint(value: unknown) {
  const source = clean(value, 260);
  let url: URL;
  try { url = new URL(source); } catch { throw new Error("Укажите адрес AlfaCRM, например https://arthellonew.s20.online"); }
  const hostname = url.hostname.toLowerCase();
  const allowedHost = hostname.endsWith(".alfacrm.pro") || /^[a-z0-9-]+\.s\d+\.online$/i.test(hostname);
  if (url.protocol !== "https:" || !allowedHost || url.port || url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    throw new Error("Разрешён только HTTPS-адрес аккаунта AlfaCRM на alfacrm.pro или sNN.online без пути и параметров");
  }
  return `https://${hostname}`;
}

function cleanSecret(value: unknown, max: number, allowEmpty = false) {
  const result = typeof value === "string" ? value.trim().slice(0, max) : "";
  if (!result && allowEmpty) return "";
  if (/\s/.test(result) || /[\u0000-\u001f\u007f]/.test(result)) throw new Error("Ключ доступа содержит недопустимые символы");
  return result;
}

function listItems(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) return value.filter((item): item is JsonRecord => Boolean(record(item)));
  const root = record(value);
  if (!root) return [];
  for (const key of ["items", "data", "result", "records"]) {
    const items = root[key];
    if (Array.isArray(items)) return items.filter((item): item is JsonRecord => Boolean(record(item)));
  }
  return [];
}

function totalItems(value: unknown) {
  const root = record(value);
  for (const key of ["total", "count"]) {
    const n = numberValue(root?.[key]);
    if (n !== null && n >= 0) return n;
  }
  return null;
}

function groupIds(item: JsonRecord) {
  const values = Array.isArray(item.groups) ? item.groups : Array.isArray(item.group_ids) ? item.group_ids : [];
  return [...new Set(values.map((value) => scalar(record(value)?.id ?? value)).filter(Boolean))].slice(0, 100);
}

function firstTeacherId(item: JsonRecord) {
  const teachers = Array.isArray(item.teachers) ? item.teachers : [];
  for (const value of teachers) {
    const id = scalar(record(value)?.id ?? value);
    if (id) return id;
  }
  return "";
}

function scalar(value: unknown): string {
  if (typeof value === "string") return value.trim().slice(0, 500);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function firstScalar(value: unknown) {
  if (Array.isArray(value)) {
    for (const item of value) { const text = scalar(item); if (text) return text; }
    return "";
  }
  return scalar(value);
}

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = scalar(value).replace(/\s+/g, "").replace(",", ".").replace(/[^\d.+-]/g, "");
  if (!text) return null;
  const valueNumber = Number(text);
  return Number.isFinite(valueNumber) ? valueNumber : null;
}

function moneyMinor(value: unknown) {
  const number = numberValue(value);
  return number === null ? 0 : Math.round(number * 100);
}

function normalizePhone(value: unknown) {
  const raw = firstScalar(value);
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && (digits.startsWith("7") || digits.startsWith("8"))) return `+7${digits.slice(1)}`;
  if (digits.length === 10) return `+7${digits}`;
  return digits ? `+${digits}` : "";
}

function normalizeName(value: unknown) {
  return scalar(value).toLocaleLowerCase("ru-RU").replace(/[^a-zа-яё0-9]/gi, "");
}

function isoDate(value: unknown) {
  const text = scalar(value);
  const ymd = /^(\d{4})[-.](\d{2})[-.](\d{2})/.exec(text);
  if (ymd) return `${ymd[1]}-${ymd[2]}-${ymd[3]}`;
  const dmy = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/.exec(text);
  return dmy ? `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}` : "";
}

function lessonTimestamp(date: string, timeValue: unknown) {
  const time = scalar(timeValue);
  const matched = /^(\d{1,2}):(\d{2})/.exec(time);
  const clock = matched ? `${matched[1].padStart(2, "0")}:${matched[2]}:00` : "00:00:00";
  const parsed = new Date(`${date}T${clock}+03:00`);
  return Number.isNaN(parsed.getTime()) ? `${date}T00:00:00Z` : parsed.toISOString();
}

function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "••••";
  return `${local.slice(0, Math.min(2, local.length))}•••@${domain}`;
}

function clean(value: unknown, max: number) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }

function daysBetween(from: string, to: string) {
  return Math.ceil((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

async function localTeacherId(remoteBranchId: string, teacherId: string) { return `EMP-A-${await shortHash(`${remoteBranchId}:${teacherId}`)}`; }
async function localGroupId(remoteBranchId: string, groupId: string) { return `GRP-A-${await shortHash(`${remoteBranchId}:${groupId}`)}`; }
async function shortHash(value: string) { return (await hashText(value)).slice(0, 16).toUpperCase(); }

async function hashText(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function runBatches(statements: ReturnType<typeof env.DB.prepare>[]) {
  for (let index = 0; index < statements.length; index += 40) await env.DB.batch(statements.slice(index, index + 40));
}

function auditStatement(actor: string, action: string, payload: unknown) {
  return env.DB.prepare("INSERT INTO audit_events (actor,action,entity_type,entity_id,payload) VALUES (?,?,?,?,?)")
    .bind(actor, action, "integration_connection", CONNECTION_ID, JSON.stringify(payload));
}

function isRemoteBranch(value: unknown): value is RemoteBranch {
  const row = record(value);
  return Boolean(row && scalar(row.id) && scalar(row.name));
}

function privateJson(payload: unknown, status = 200) {
  return Response.json(payload, { status, headers: { "cache-control": "no-store, max-age=0", pragma: "no-cache" } });
}

class AlfaApiError extends Error {
  constructor(message: string) { super(message); this.name = "AlfaApiError"; }
}

function safeError(error: unknown) {
  if (error instanceof AlfaApiError) return error.message;
  if (error instanceof Error) {
    const safePrefixes = ["Сначала ", "Подключение ", "Сохранённый ", "Укажите ", "Выберите ", "Разрешён ", "Для занятий", "Для первичного", "Параметры ", "Неизвестный ", "Ключ доступа"];
    if (safePrefixes.some((prefix) => error.message.startsWith(prefix))) return error.message;
  }
  return "Не удалось выполнить действие AlfaCRM. Проверьте подключение и повторите попытку.";
}
