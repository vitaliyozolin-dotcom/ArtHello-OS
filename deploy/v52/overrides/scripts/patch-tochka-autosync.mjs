import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const marker = 'TOCHKA_AUTOMATIC_READONLY_V1';
function replace(source, before, after, label) {
  if (!source.includes(before) || source.indexOf(before) !== source.lastIndexOf(before)) {
    throw new Error(`Tochka autosync patch target missing or ambiguous: ${label}`);
  }
  return source.replace(before, after);
}
export function patchTochkaAutosyncRoute(source) {
  if (source.includes(marker)) return source;
  source = `import { isTochkaAutosyncRequest, runScheduledTochkaSync } from '../../../lib/tochka-autosync';\n// ${marker}\n` + source;
  source = replace(source, 'export async function POST(request: Request) {', `export async function POST(request: Request) {
  const schedulerSecret = (env as unknown as { TOCHKA_AUTOSYNC_SECRET?: string }).TOCHKA_AUTOSYNC_SECRET;
  if (schedulerSecret && await isTochkaAutosyncRequest(request, schedulerSecret)) {
    try {
      await ensureCoreTables();
      const setup = (await getIntegrationSetups())[tochkaConnectionId];
      const [connection] = await getDb().select().from(integrationConnections).where(eq(integrationConnections.id, tochkaConnectionId)).limit(1);
      const result = await runScheduledTochkaSync({ db: env.DB, setup, connection, run: async () => {
        if (!setup) return privateJson({ error: 'Подключение не настроено' }, 409);
        await validateIntegrationSetupReferences(setup);
        const token = await readIntegrationCredential(setup.connectionId, setup.legalEntityId, setup.customerCode);
        if (!token) return privateJson({ error: 'Ключ отсутствует' }, 409);
        return runTochkaStatementSync('SYSTEM:TOCHKA_READONLY_SCHEDULER', setup, 'Автоматическая загрузка по расписанию', token, true);
      } });
      return privateJson(result);
    } catch {
      console.error('integration.tochka_scheduled_tick_failed');
      return privateJson({ error: 'Автоматическая загрузка не выполнена' }, 503);
    }
  }`, 'service-only entry');
  source = replace(source,
    'async function runTochkaStatementSync(actor: string, setup: IntegrationSetup, trigger: string, token: string) {\n  const statementState = await openTochkaStatementState(setup);',
    'async function runTochkaStatementSync(actor: string, setup: IntegrationSetup, trigger: string, token: string, automatic = false) {\n  const statementState = await openTochkaStatementState(setup, automatic);', 'automatic statement fence');
  source = replace(source, '      complete: sync.complete,', '      complete: sync.complete,\n      rejectedCount: sync.rejectedCount,', 'expose rejected count for retry backoff');
  source = replace(source,
    '"Черновик распределения сохранён. Ключ не использовался; отдельную проверку счетов запускает собственник."',
    '"Распределение и расписание сохранены. Если подключение включено, сервер загрузит данные автоматически; ручная проверка также доступна."', 'truthful saved schedule');
  source = replace(source,
    '  const ready = row.verifiedTransfer && row.authStatus.includes("активна");',
    `  if (id === tochkaConnectionId) {
    const setup = (await getIntegrationSetups())[id];
    if (!setup || setup.secretStatus !== 'stored' || !setup.customerCode) return privateJson({ error: 'Сначала сохраните подтверждённый ключ Точки' }, 409);
    await validateIntegrationSetupReferences(setup);
    const [updated] = await db.update(integrationConnections).set({ status: 'Ожидает синхронизации', isEnabled: true,
      nextSyncAt: new Date().toISOString(), updatedAt: new Date().toISOString() }).where(eq(integrationConnections.id, id)).returning();
    await audit(actor, 'integration.resumed', 'integration_connection', id, { scheduledReadOnly: true });
    return privateJson({ connection: updated, needsAccess: false });
  }
  const ready = row.verifiedTransfer && row.authStatus.includes("активна");`, 'resume current Tochka statuses');
  return source;
}
export function patchTochkaAutosyncProxy(source) {
  if (source.includes(marker)) return source;
  source = `import { isTochkaAutosyncRequest } from './lib/tochka-autosync';\n// ${marker}\n` + source;
  return replace(source, '  if (!hasTrustedMutationOrigin(request, runtimePublicOrigin())) {', `  const schedulerSecret = (env as unknown as { TOCHKA_AUTOSYNC_SECRET?: string }).TOCHKA_AUTOSYNC_SECRET;
  if (schedulerSecret && await isTochkaAutosyncRequest(request, schedulerSecret)) {
    return NextResponse.next({ request: { headers } });
  }

  if (!hasTrustedMutationOrigin(request, runtimePublicOrigin())) {`, 'service authentication before session authentication');
}
export function patchTochkaAutosyncDb(source) {
  if (source.includes(marker)) return source;
  source = `// ${marker}\n` + source;
  source = replace(source, 'export async function openTochkaStatementState(setup: IntegrationSetup) {',
    'export async function openTochkaStatementState(setup: IntegrationSetup, requireAutomatic = false) {', 'open automatic state');
  source = replace(source, '    setupStateKey: integrationSetupPrefix + setup.connectionId,',
    '    setupStateKey: integrationSetupPrefix + setup.connectionId,\n    requireAutomatic,', 'automatic state requirement');
  source = replace(source,
    '${statementLease ? ` AND ${tochkaStatementLeaseGuardSql}` : ""}`;',
    '${statementLease ? ` AND ${tochkaStatementLeaseGuardSql}` : ""}${statementLease?.requireAutomatic ? " AND EXISTS (SELECT 1 FROM integration_connections WHERE id=\'INT-T-TOCHKA\' AND status <> \'На паузе\' AND (is_enabled=1 OR status=\'Ошибка подключения\'))" : ""}`;', 'automatic commit pause fence');
  source = replace(source, 'status=?,auth_status=?,credential_expires_at=?,last_success_at=?,next_sync_at=?,',
    "status=?,auth_status=?,credential_expires_at=?,last_success_at=COALESCE(NULLIF(?,''),last_success_at),next_sync_at=?,", 'do not erase last successful sync');
  source = replace(source, '        sync.valid ? occurredAt : "",',
    '        sync.valid && sync.complete && sync.rejectedCount === 0 ? occurredAt : "",', 'only complete data marks last success');
  return source;
}
export function patchTochkaAutosyncStatementState(source) {
  if (source.includes(marker)) return source;
  source = `// ${marker}\n` + source;
  source = replace(source, 'export type TochkaStatementLeaseFence = { key: string; owner: string };',
    'export type TochkaStatementLeaseFence = { key: string; owner: string; requireAutomatic?: boolean };', 'fence type');
  source = replace(source, '  setupStateKey: string;\n};', '  setupStateKey: string;\n  requireAutomatic?: boolean;\n};', 'scope type');
  source = replace(source, '  )`;\n  const credentialBindings',
    '  )${scope.requireAutomatic ? " AND EXISTS (SELECT 1 FROM integration_connections WHERE id=\'INT-T-TOCHKA\' AND status <> \'На паузе\' AND (is_enabled=1 OR status=\'Ошибка подключения\'))" : ""}`;\n  const credentialBindings', 'pause fences every statement operation');
  source = replace(source, "  const fence = { key: 'tochka-statement-lease:v1:' + scope.connectionId, owner: crypto.randomUUID() };",
    "  const fence = { key: 'tochka-statement-lease:v1:' + scope.connectionId, owner: crypto.randomUUID(), ...(scope.requireAutomatic ? { requireAutomatic: true } : {}) };", 'fence identity');
  return source;
}
export function patchTochkaAutosyncRuntime(source) {
  if (source.includes(marker)) return source;
  source = `import { randomBytes } from 'node:crypto';\nimport { startTochkaAutosyncTimer } from './tochka-autosync-timer.mjs';\n// ${marker}\n` + source;
  source = replace(source, 'const runtime = new Miniflare({',
    "const tochkaAutosyncEnabled = process.env.TOCHKA_AUTOSYNC_ENABLED === '1';\nconst tochkaAutosyncSecret = tochkaAutosyncEnabled ? randomBytes(32).toString('hex') : '';\n\nconst runtime = new Miniflare({", 'explicit production activation');
  source = replace(source, '    TBANK_EGRESS_IP: process.env.TBANK_EGRESS_IP || "",',
    '    TBANK_EGRESS_IP: process.env.TBANK_EGRESS_IP || "",\n    TOCHKA_AUTOSYNC_SECRET: tochkaAutosyncSecret,', 'ephemeral secret binding');
  source = replace(source, 'async function shutdown() {',
    'const tochkaAutosyncTimer = startTochkaAutosyncTimer({ runtime, secret: tochkaAutosyncSecret, publicOrigin, enabled: tochkaAutosyncEnabled, releaseSha: process.env.RELEASE_SHA || "", activationId: process.env.TOCHKA_AUTOSYNC_ACTIVATION_ID || "" });\n\nasync function shutdown() {\n  tochkaAutosyncTimer.stop();', 'runtime timer lifecycle');
  return source;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const patches = [
    ['app/api/integration-actions/route.ts', patchTochkaAutosyncRoute],
    ['proxy.ts', patchTochkaAutosyncProxy],
    ['db/index.ts', patchTochkaAutosyncDb],
    ['lib/tochka-statement-state.ts', patchTochkaAutosyncStatementState],
    ['production/runtime-server.mjs', patchTochkaAutosyncRuntime],
  ];
  const candidates = await Promise.all(patches.map(async ([path, patch]) => [path, patch(await readFile(path, 'utf8'))]));
  for (const [path, content] of candidates) await writeFile(path, content);
}
