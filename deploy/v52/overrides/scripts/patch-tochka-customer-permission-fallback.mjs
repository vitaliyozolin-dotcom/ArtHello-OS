import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const targetUrl = new URL("../lib/integrations.ts", import.meta.url);
const marker = "TOCHKA_CUSTOMER_DIRECTORY_OPTIONAL";

const probeBefore = `    if (!customersResponse.ok) {
      const reason = customersResponse.status === 401
        ? "Точка отклонила ключ"
        : customersResponse.status === 403
          ? "Ключ Точки не даёт права читать список компаний"
          : customersResponse.status === 429
            ? "Точка временно ограничила число проверок"
            : "Точка не подтвердила доступ к компаниям";
      return fail(reason);
    }
`;

const probeAfter = `    if (!customersResponse.ok) {
      // ${marker}: ReadCustomerData is optional. When the key cannot read the
      // customer directory, prove ownership from account customerCode values.
      if (customersResponse.status === 403) {
        const accountsResponse = await request(TOCHKA_ACCOUNTS_URL, requestInit);
        if (!accountsResponse.ok) {
          const reason = accountsResponse.status === 401
            ? "Точка отклонила ключ"
            : accountsResponse.status === 403
              ? "Ключ Точки не даёт права читать счета"
              : accountsResponse.status === 429
                ? "Точка временно ограничила число проверок"
                : "Точка не подтвердила доступ к счетам";
          return fail(reason);
        }
        const accountsPayload = await readLimitedJson(accountsResponse);
        if (accountsPayload === null) return fail("Точка вернула некорректный список счетов");
        const accounts = extractTochkaAccounts(accountsPayload);
        if (!accounts.length) return fail("Ключ Точки подтверждён, но доступных счетов нет");
        const customerCodes = [...new Set(accounts.map(readTochkaCustomerCode).filter(Boolean))];
        const requested = cleanTochkaCode(requestedCustomerCode);
        if (!customerCodes.length) {
          return fail("Точка разрешила чтение счетов, но не указала компанию-владельца. Для безопасной привязки нужен customerCode в ответе счетов");
        }
        let selectedCustomerCode = "";
        if (requested) {
          if (!customerCodes.includes(requested)) {
            return fail("Выбранная компания не доступна этому ключу Точки", customerCodes.map((code, index) => ({ code, name: \\`Компания \\${index + 1}\\` })));
          }
          selectedCustomerCode = requested;
        } else if (customerCodes.length === 1) {
          selectedCustomerCode = customerCodes[0];
        } else {
          return fail("Ключ Точки даёт доступ к нескольким компаниям. Выберите одну.", customerCodes.map((code, index) => ({ code, name: \\`Компания \\${index + 1}\\` })));
        }
        const accountCount = accounts.filter((account) => readTochkaCustomerCode(account) === selectedCustomerCode).length;
        if (!accountCount) return fail("Ключ Точки подтверждён, но для выбранной компании доступных счетов нет", [], selectedCustomerCode);
        return {
          valid: true,
          reason: "Ключ и компания подтверждены по доступным счетам Точки",
          expiresAt: validation.expiresAt,
          accountCount,
          accountCountScope: "selected_customer",
          customerCode: selectedCustomerCode,
          customerChoices: [],
        };
      }
      const reason = customersResponse.status === 401
        ? "Точка отклонила ключ"
        : customersResponse.status === 429
          ? "Точка временно ограничила число проверок"
          : "Точка не подтвердила доступ к компаниям";
      return fail(reason);
    }
`;

const syncBefore = `    const customersResponse = await request(TOCHKA_CUSTOMERS_URL, requestInit("GET"));
    if (!customersResponse.ok) return empty(tochkaReadFailure(customersResponse.status, "компаниям"));
    const customersPayload = await readLimitedJson(customersResponse);
    const customers = customersPayload === null ? [] : extractTochkaCustomers(customersPayload);
    if (!customers.some((customer) => customer.code === customerCode)) return empty("Выбранная компания не доступна этому ключу Точки");

    const accountsResponse = await request(TOCHKA_ACCOUNTS_URL, requestInit("GET"));
`;

const syncAfter = `    const customersResponse = await request(TOCHKA_CUSTOMERS_URL, requestInit("GET"));
    const customerDirectoryForbidden = customersResponse.status === 403;
    let customers: TochkaCustomerChoice[] = [];
    if (customersResponse.ok) {
      const customersPayload = await readLimitedJson(customersResponse);
      if (customersPayload === null) return empty("Точка вернула некорректный список компаний");
      customers = extractTochkaCustomers(customersPayload);
      if (!customers.some((customer) => customer.code === customerCode)) return empty("Выбранная компания не доступна этому ключу Точки");
    } else if (!customerDirectoryForbidden) {
      return empty(tochkaReadFailure(customersResponse.status, "компаниям"));
    }

    const accountsResponse = await request(TOCHKA_ACCOUNTS_URL, requestInit("GET"));
`;

const scopeBefore = `    const rawAccounts = extractTochkaAccounts(accountsPayload);
    const hasOwnerCodes = rawAccounts.length > 0 && rawAccounts.every((account) => Boolean(readTochkaCustomerCode(account)));
    if (!hasOwnerCodes && customers.length > 1) {
`;

const scopeAfter = `    const rawAccounts = extractTochkaAccounts(accountsPayload);
    const hasOwnerCodes = rawAccounts.length > 0 && rawAccounts.every((account) => Boolean(readTochkaCustomerCode(account)));
    if (customerDirectoryForbidden && !hasOwnerCodes) {
      return empty("Точка разрешила чтение счетов, но не указала владельца счетов. Для безопасной загрузки нужен customerCode в ответе Точки");
    }
    if (hasOwnerCodes && !rawAccounts.some((account) => readTochkaCustomerCode(account) === customerCode)) {
      return empty("Выбранная компания не доступна этому ключу Точки");
    }
    if (!hasOwnerCodes && customers.length > 1) {
`;

export function patchTochkaCustomerPermissionFallback(source) {
  if (source.includes(marker)) return source;
  for (const [before, label] of [
    [probeBefore, "probe customer failure block"],
    [syncBefore, "sync customer preflight block"],
    [scopeBefore, "sync account scope block"],
  ]) {
    if (!source.includes(before)) throw new Error(`D-060 patch target missing: ${label}`);
  }
  return source
    .replace(probeBefore, probeAfter)
    .replace(syncBefore, syncAfter)
    .replace(scopeBefore, scopeAfter);
}

export async function applyTochkaCustomerPermissionFallback(path = targetUrl) {
  const source = await readFile(path, "utf8");
  const patched = patchTochkaCustomerPermissionFallback(source);
  if (patched !== source) await writeFile(path, patched, "utf8");
  return patched !== source;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const changed = await applyTochkaCustomerPermissionFallback();
  console.log(changed ? "D-060 Tochka customer permission fallback applied" : "D-060 Tochka fallback already present");
}
