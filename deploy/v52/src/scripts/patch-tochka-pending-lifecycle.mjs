import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const marker = 'TOCHKA_PENDING_STATEMENT_LIFECYCLE_V1';
function replace(source, before, after, label) {
  if (!source.includes(before) || source.indexOf(before) !== source.lastIndexOf(before)) {
    throw new Error(`Tochka pending lifecycle patch target is missing or ambiguous: ${label}`);
  }
  return source.replace(before, after);
}

export function patchTochkaPendingIntegrations(source) {
  if (source.includes(marker)) return source;
  source = `import type { TochkaPendingStatementStore } from './tochka-statement-state';\n// ${marker}\n` + source;
  source = replace(source, 'export async function syncTochkaReadOnly(input: {\n',
    'export async function syncTochkaReadOnly(input: {\n  statementState?: TochkaPendingStatementStore;\n  endDate?: string;\n', 'sync input');
  source = replace(source, '  const endDate = new Date(nowMs).toISOString().slice(0, 10);',
    `  const currentEndDate = new Date(nowMs).toISOString().slice(0, 10);
  const targetEndDate = input.endDate === undefined ? currentEndDate : cleanIsoDate(input.endDate);
  let endDate = targetEndDate;
  if (!endDate || endDate > currentEndDate) return empty('Укажите корректную дату окончания загрузки выписок');`, 'frozen statement end date');
  source = replace(source, '    if (!accounts.length) return empty("Для выбранной компании нет доступных расчётных счетов");',
    `    if (!accounts.length) return empty("Для выбранной компании нет доступных расчётных счетов");
    endDate = await input.statementState?.resolveEndDate(startDate, targetEndDate, accounts.map(account => account.accountId)) ?? targetEndDate;
    if (!endDate || endDate < startDate || endDate > targetEndDate) return empty('Не удалось определить период незавершённой выписки');`, 'freeze only currently accessible accounts');
  const begin = '      const statementBody = JSON.stringify({ Data: { Statement: { accountId: account.accountId, startDateTime: startDate, endDateTime: endDate } } });';
  const end = '      const statementUrl = `${TOCHKA_ACCOUNTS_URL}/${account.accountId}/statements/${initiatedStatementId}`;';
  const first = source.indexOf(begin), last = source.indexOf(end, first);
  if (first < 0 || last < first) throw new Error('Tochka pending lifecycle: statement initialization target missing');
  source = source.slice(0, first) + `      const statementScope = { accountId: account.accountId, startDate, endDate };
      let initiatedStatementId = await input.statementState?.get(statementScope) ?? '';
      if (!initiatedStatementId) {
        const statementBody = JSON.stringify({ Data: { Statement: { accountId: account.accountId, startDateTime: startDate, endDateTime: endDate } } });
        if (!isAllowedTochkaStatementRequest(TOCHKA_STATEMENTS_URL, 'POST')) return empty('Загрузка заблокирована внутренним ограничением методов');
        const initResponse = await request(TOCHKA_STATEMENTS_URL, requestInit('POST', statementBody));
        if (!initResponse.ok) return empty(tochkaReadFailure(initResponse.status, 'выпискам'));
        const initPayload = await readLimitedJson(initResponse);
        const initiated = readTochkaStatement(initPayload);
        const initiatedAccountId = cleanTochkaAccountId(initiated?.accountId ?? initiated?.AccountId);
        initiatedStatementId = cleanProviderId(String(initiated?.statementId ?? initiated?.StatementId ?? ''));
        if (!initiated || initiatedAccountId !== account.accountId || !initiatedStatementId) {
          return empty('Точка не вернула номер созданной выписки');
        }
        // Persist before polling: retries and restarted workers resume this exact bank job.
        await input.statementState?.put(statementScope, initiatedStatementId);
      }

` + source.slice(last);
  source = replace(source,
    '        if (!response.ok) return empty(tochkaReadFailure(response.status, "готовой выписке"));',
    `        if (!response.ok) {
          if (response.status === 404 || response.status === 410) await input.statementState?.forget(statementScope, initiatedStatementId);
          return empty(tochkaReadFailure(response.status, 'готовой выписке'));
        }`, 'missing statement lifecycle');
  source = replace(source,
    '        if (/^(error|failed|rejected)$/i.test(status)) return empty("Точка не смогла сформировать выписку");',
    `        if (/^(error|failed|rejected)$/i.test(status)) {
          await input.statementState?.forget(statementScope, initiatedStatementId);
          return empty('Точка не смогла сформировать выписку. Повторите загрузку для нового запроса.');
        }`, 'terminal statement lifecycle');
  source = replace(source,
    '        const status = cleanText(statement.status, 40);',
    `        const returnedAccount = statement.accountId ?? statement.AccountId;
        const returnedId = statement.statementId ?? statement.StatementId;
        const returnedStart = statement.startDateTime ?? statement.StartDateTime;
        const returnedEnd = statement.endDateTime ?? statement.EndDateTime;
        if ((returnedAccount !== undefined && cleanTochkaAccountId(returnedAccount) !== account.accountId)
          || (returnedId !== undefined && cleanProviderId(String(returnedId)) !== initiatedStatementId)
          || (returnedStart !== undefined && cleanIsoDate(returnedStart) !== startDate)
          || (returnedEnd !== undefined && cleanIsoDate(returnedEnd) !== endDate)) {
          return empty('Выписка Точки не соответствует запрошенному счёту или периоду');
        }
        const status = cleanText(statement.status ?? statement.Status, 40);`, 'returned statement scope');
  source = replace(source,
    '      complete,\n      reason: complete ? "Счета, остатки, выписки и операции загружены из Точки" : "Точка ещё формирует часть выписок — повторите синхронизацию",',
    '      complete: complete && rejectedCount === 0 && endDate === targetEndDate,\n      reason: rejectedCount > 0 ? "Часть данных выписки не обработана. Проверьте отклонённые операции; загрузка не завершена." : complete && endDate < targetEndDate ? "Сохранённая выписка загружена. Повторите синхронизацию, чтобы догрузить операции нового дня." : complete ? "Счета, остатки, выписки и операции загружены из Точки" : "Точка ещё формирует часть выписок — повторите синхронизацию",', 'rejected rows cannot produce success');
  return source;
}

export function patchTochkaPendingDb(source) {
  if (source.includes(marker)) return source;
  source = `import { acquireTochkaStatementState, tochkaStatementLeaseGuardSql } from '../lib/tochka-statement-state';\nimport type { TochkaStatementLeaseFence } from '../lib/tochka-statement-state';\n// ${marker}\n` + source;
  source = replace(source, 'export async function commitTochkaReadOnlySync(\n',
    `export async function openTochkaStatementState(setup: IntegrationSetup) {
  return acquireTochkaStatementState(env.DB, {
    connectionId: setup.connectionId,
    legalEntityId: setup.legalEntityId,
    customerCode: setup.customerCode,
    credentialGeneration: normalizeCredentialGeneration(setup.credentialGeneration),
    credentialStateKey: integrationCredentialStateKey(setup.connectionId, setup.legalEntityId, setup.customerCode),
    setupStateKey: integrationSetupPrefix + setup.connectionId,
  });
}

export async function commitTochkaReadOnlySync(\n`, 'statement state database wrapper');
  const first = source.indexOf('export async function commitTochkaReadOnlySync(');
  const last = source.indexOf('\nexport async function hasIntegrationCredential(', first);
  if (last < first) throw new Error('Tochka pending lifecycle: commit boundary missing');
  let commit = source.slice(first, last);
  commit = replace(commit, '  trigger: string,\n)', '  trigger: string,\n  statementLease?: TochkaStatementLeaseFence,\n)', 'commit lease input');
  commit = replace(commit,
    '  ) AND EXISTS (SELECT 1 FROM integration_connections WHERE id=?)`;',
    '  ) AND EXISTS (SELECT 1 FROM integration_connections WHERE id=?)${statementLease ? ` AND ${tochkaStatementLeaseGuardSql}` : ""}`;', 'commit lease fence');
  commit = replace(commit,
    '  const guardBindings = [credentialStateKey, setupStateKey, generation, setup.connectionId];',
    '  const guardBindings = [credentialStateKey, setupStateKey, generation, setup.connectionId, ...(statementLease ? [statementLease.key, statementLease.owner] : [])];', 'commit lease bindings');
  commit = replace(commit,
    '  const runStatus = sync.valid && sync.complete ? "Успешно" : sync.valid ? "Ожидание банка" : "Ошибка";',
    '  const runStatus = sync.valid && sync.complete && sync.rejectedCount === 0 ? "Успешно" : sync.rejectedCount > 0 ? "Требует проверки" : sync.valid ? "Ожидание банка" : "Ошибка";', 'rejected run status');
  commit = replace(commit,
    '        !sync.valid ? "Ошибка подключения" : sync.complete ? "Работает" : "Формируются выписки",',
    '        !sync.valid ? "Ошибка подключения" : sync.rejectedCount > 0 ? "Требует проверки" : sync.complete ? "Работает" : "Формируются выписки",', 'rejected connection status');
  commit = replace(commit,
    '        sync.valid && sync.statements.length > 0 ? 1 : 0,',
    '        sync.valid && sync.complete && sync.rejectedCount === 0 && sync.statements.length > 0 ? 1 : 0,', 'verified transfer requires complete import');
  return source.slice(0, first) + commit + source.slice(last);
}

export function patchTochkaPendingRoute(source) {
  if (source.includes(marker)) return source;
  source = `import { TochkaStatementStateChanged } from '../../../lib/tochka-statement-state';\n// ${marker}\n` + source;
  source = replace(source, '  commitTochkaReadOnlySync,\n', '  commitTochkaReadOnlySync,\n  openTochkaStatementState,\n', 'route state import');
  source = replace(source, `      return recordTochkaSync(actor, setup, "Первичная загрузка владельцем", await syncTochkaReadOnly({
        token: credential,
        customerCode: setup.customerCode,
        startDate: setup.startDate || "2026-01-01",
        request: tochkaTransportFetch,
      }));`, '      return runTochkaStatementSync(actor, setup, "Первичная загрузка владельцем", credential);', 'initial import');
  source = replace(source, `  return recordTochkaSync(actor, setup, trigger, await syncTochkaReadOnly({
    token,
    customerCode: setup.customerCode,
    startDate: setup.startDate || "2026-01-01",
    request: tochkaTransportFetch,
  }));`, '  return runTochkaStatementSync(actor, setup, trigger, token);', 'retry import');
  source = replace(source,
    'async function recordTochkaSync(actor: string, setup: IntegrationSetup, trigger: string, sync: TochkaReadOnlySyncResult) {\n  const commit = await commitTochkaReadOnlySync(actor, setup, sync, trigger);',
    `async function runTochkaStatementSync(actor: string, setup: IntegrationSetup, trigger: string, token: string) {
  const statementState = await openTochkaStatementState(setup);
  if (!statementState) return privateJson({ error: 'Синхронизация Точки уже выполняется или параметры подключения изменились. Повторите загрузку.' }, 409);
  try {
    const sync = await syncTochkaReadOnly({
      token,
      customerCode: setup.customerCode,
      startDate: setup.startDate || '2026-01-01',
      statementState: statementState.store,
      request: async (input, init) => {
        await statementState.assertCurrent();
        return tochkaTransportFetch(input, init);
      },
    });
    await statementState.assertCurrent();
    return await recordTochkaSync(actor, setup, trigger, sync, statementState);
  } catch (error) {
    if (error instanceof TochkaStatementStateChanged) return privateJson({ error: error.message }, 409);
    throw error;
  } finally {
    await statementState.release();
  }
}

async function recordTochkaSync(actor: string, setup: IntegrationSetup, trigger: string, sync: TochkaReadOnlySyncResult,
  statementState: NonNullable<Awaited<ReturnType<typeof openTochkaStatementState>>>) {
  const commit = await commitTochkaReadOnlySync(actor, setup, sync, trigger, statementState.fence);`, 'guarded import wrapper');
  source = replace(source,
    '  if (!sync.valid) return privateJson({ error: sync.reason }, 422);',
    '  if (!sync.valid) return privateJson({ error: sync.reason }, 422);\n  if (sync.rejectedCount === 0) await statementState.complete(sync.statements);', 'acknowledge committed statements');
  source = replace(source,
    '      : `Ключ и счета подтверждены. Точка ещё формирует часть выписок; повторите синхронизацию через несколько минут.`,',
    '      : sync.reason,', 'incomplete statement reason');
  return source;
}

export function patchTochkaPendingOwnerTests(source) {
  if (source.includes(marker)) return source;
  source = `import { acquireTochkaStatementState, tochkaStatementLeaseGuardSql, TochkaStatementStateChanged } from '../lib/tochka-statement-state.ts';\n// ${marker}\n` + source;
  source = replace(source, '      consumeTochkaCompanySelectionHandle,commitIntegrationBankProbe,commitTochkaReadOnlySync,createTochkaCompanySelectionHandles,',
    '      consumeTochkaCompanySelectionHandle,commitIntegrationBankProbe,commitTochkaReadOnlySync,createTochkaCompanySelectionHandles,openTochkaStatementState,TochkaStatementStateChanged,', 'route fixture pending dependencies');
  source = replace(source, 'function actionRouteStubs(overrides = {}) {\n  return {\n    env: {},\n', `function actionRouteStubs(overrides = {}) {
  return {
    env: {},
    TochkaStatementStateChanged,
    openTochkaStatementState: async () => { throw new Error('statement state must not be reached'); },
`, 'route fixture lease denial');
  source = replace(source, '  const replacements = [\n', `  const replacements = [
    ["import { acquireTochkaStatementState, tochkaStatementLeaseGuardSql } from '../lib/tochka-statement-state';", "const { acquireTochkaStatementState, tochkaStatementLeaseGuardSql } = globalThis.__ARTHELLO_TOCHKA_STATE_TEST__;"],
`, 'database fixture pending dependency');
  source = replace(source, '  globalThis.__ARTHELLO_TOCHKA_DB_PROJECT__ = toTochkaFinancialOperation;',
    '  globalThis.__ARTHELLO_TOCHKA_DB_PROJECT__ = toTochkaFinancialOperation;\n  globalThis.__ARTHELLO_TOCHKA_STATE_TEST__ = { acquireTochkaStatementState, tochkaStatementLeaseGuardSql };', 'database fixture pending binding');
  source = replace(source,
    '    const first = await dbModule.commitTochkaReadOnlySync("OWNER-LIVE", setup, sync, "Первичная загрузка");',
    `    const statementState = await dbModule.openTochkaStatementState(setup);
    assert.ok(statementState);
    const denied = await dbModule.commitTochkaReadOnlySync('OWNER-LIVE', setup, sync, 'Чужой запуск', { ...statementState.fence, owner: 'another-worker' });
    assert.equal(denied.committed, false);
    assert.equal(database.database.prepare('SELECT COUNT(*) AS count FROM financial_operations').get().count, 0);
    const first = await dbModule.commitTochkaReadOnlySync("OWNER-LIVE", setup, sync, "Первичная загрузка", statementState.fence);`, 'real financial commit lease regression');
  source = replace(source,
    '    const repeated = await dbModule.commitTochkaReadOnlySync("OWNER-LIVE", setup, sync, "Повторная загрузка");',
    `    const repeated = await dbModule.commitTochkaReadOnlySync("OWNER-LIVE", setup, sync, "Повторная загрузка", statementState.fence);
    await statementState.release();
    const expired = await dbModule.commitTochkaReadOnlySync('OWNER-LIVE', setup, sync, 'Завершённый запуск', statementState.fence);
    assert.equal(expired.committed, false);`, 'finished financial commit lease regression');
  return source;
}

export function patchTochkaPendingTransportTests(source) {
  if (source.includes(marker)) return source;
  return '// '+marker+'\n' + replace(source,
    String.raw`  assert.match(route, /syncTochkaReadOnly\(\{[\s\S]*?request:\s*tochkaTransportFetch/);`,
    String.raw`  assert.match(route, /syncTochkaReadOnly\(\{[\s\S]*?request:\s*async\s*\(input, init\)\s*=>\s*\{\s*await statementState\.assertCurrent\(\);\s*return tochkaTransportFetch\(input, init\);/);`,
    'transport remains behind the current statement lease');
}

export function patchTochkaPendingEmptyModeTests(source) {
  if (source.includes(marker)) return source;
  source = `import { acquireTochkaStatementState, tochkaStatementLeaseGuardSql } from '../lib/tochka-statement-state.ts';\n// ${marker}\n` + source;
  source = replace(source, '  globalThis.__ARTHELLO_EMPTY_MODE_ENV__ = { DB: database };',
    '  globalThis.__ARTHELLO_EMPTY_MODE_ENV__ = { DB: database };\n  globalThis.__ARTHELLO_EMPTY_MODE_TOCHKA_STATE__ = { acquireTochkaStatementState, tochkaStatementLeaseGuardSql };', 'empty data fixture state binding');
  source = replace(source, '    const code = transpile(dbSource, [\n', `    const code = transpile(dbSource, [
      ["import { acquireTochkaStatementState, tochkaStatementLeaseGuardSql } from '../lib/tochka-statement-state';", "const { acquireTochkaStatementState, tochkaStatementLeaseGuardSql } = globalThis.__ARTHELLO_EMPTY_MODE_TOCHKA_STATE__;"],
      ["import type { TochkaStatementLeaseFence } from '../lib/tochka-statement-state';", ""],
`, 'empty data fixture explicit dependency adapter');
  return source;
}

export async function applyTochkaPendingLifecycle(root = new URL('../', import.meta.url)) {
  const targets = [
    ['lib/integrations.ts', patchTochkaPendingIntegrations],
    ['db/index.ts', patchTochkaPendingDb],
    ['app/api/integration-actions/route.ts', patchTochkaPendingRoute],
    ['tests/tochka-owner-connection.test.mjs', patchTochkaPendingOwnerTests],
    ['tests/tochka-node-transport.test.mjs', patchTochkaPendingTransportTests],
    ['tests/empty-data-mode.test.mjs', patchTochkaPendingEmptyModeTests],
  ];
  const changes = await Promise.all(targets.map(async ([path, patch]) => {
    const url = new URL(path, root);
    const source = await readFile(url, 'utf8');
    return { url, source, patched: patch(source) };
  }));
  for (const { url, source, patched } of changes) if (source !== patched) await writeFile(url, patched, 'utf8');
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await applyTochkaPendingLifecycle();
  console.log('Tochka pending statement lifecycle applied');
}
