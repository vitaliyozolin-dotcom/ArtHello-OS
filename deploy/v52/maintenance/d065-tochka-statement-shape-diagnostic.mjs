import fs from 'node:fs';
import { webcrypto } from 'node:crypto';

const { subtle } = webcrypto;
const ctx = JSON.parse(fs.readFileSync('/run/context.json', 'utf8'));
const configured = process.env.INTEGRATION_CREDENTIALS_KEY;
if (typeof configured !== 'string' || configured.length < 32) throw new Error('D065_MASTER_KEY_UNAVAILABLE');

const te = new TextEncoder();
const td = new TextDecoder();
const decode = (value) => Buffer.from(
  String(value).replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(String(value).length / 4) * 4, '='),
  'base64',
);
const keyBytes = await subtle.digest('SHA-256', te.encode(`arthello.integration-credential.key.v1\n${configured}`));
const key = await subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
const aad = te.encode(`arthello.integration-credential.v2\nINT-T-TOCHKA\n${ctx.legalEntityId}\n${ctx.customerCode}\nTOCHKA_ACCOUNTS_READ_V1`);
const plain = await subtle.decrypt(
  { name: 'AES-GCM', iv: decode(ctx.envelope.iv), additionalData: aad, tagLength: 128 },
  key,
  decode(ctx.envelope.ciphertext),
);
const token = td.decode(plain);
if (token.length < 40 || /\s/.test(token)) throw new Error('D065_DECRYPTED_CREDENTIAL_INVALID');

const headers = { accept: 'application/json', authorization: `Bearer ${token}` };
const readJson = async (response) => {
  const text = await response.text();
  if (text.length > 10_000_000) throw new Error('D065_RESPONSE_TOO_LARGE');
  try { return JSON.parse(text); } catch { return null; }
};
const obj = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : null;
const collection = (payload, names) => {
  const root = obj(payload);
  if (!root) return [];
  const data = obj(root.Data) || obj(root.data);
  for (const container of [root, data]) {
    if (!container) continue;
    for (const name of names) {
      const value = container[name];
      if (Array.isArray(value)) return value;
      if (obj(value)) return [value];
    }
  }
  return [];
};
const customerCode = (value) => String(value?.CustomerCode ?? value?.customerCode ?? value?.customer_code ?? '').trim();
const accountId = (value) => {
  if (!obj(value)) return '';
  const details = Array.isArray(value.accountDetails ?? value.AccountDetails) ? (value.accountDetails ?? value.AccountDetails) : [];
  const detail = details.find(obj);
  return String(value.accountId ?? value.AccountId ?? detail?.identification ?? detail?.Identification ?? '').trim();
};
const statements = (payload) => collection(payload, ['Statement', 'statement', 'Statements', 'statements']);
const statementId = (value) => String(value?.statementId ?? value?.StatementId ?? '').trim();
const safeKeys = (value) => obj(value) ? Object.keys(value).sort().slice(0, 80) : [];
const shape = (payload) => {
  const root = obj(payload);
  const data = root ? (obj(root.Data) || obj(root.data)) : null;
  const raw = data?.Statement ?? data?.statement ?? data?.Statements ?? data?.statements;
  const list = statements(payload);
  const first = list[0];
  const status = String(first?.status ?? first?.Status ?? '').trim();
  const tx = first?.Transaction ?? first?.transaction ?? first?.Transactions ?? first?.transactions;
  return {
    rootType: Array.isArray(payload) ? `array(${payload.length})` : root ? 'object' : typeof payload,
    rootKeys: safeKeys(root),
    dataKeys: safeKeys(data),
    statementCount: list.length,
    statementContainer: Array.isArray(raw) ? `array(${raw.length})` : obj(raw) ? 'object' : raw == null ? 'absent' : typeof raw,
    statementKeys: safeKeys(first),
    status: /^(Created|Processing|Ready|Completed|Failed|Error|Rejected)$/i.test(status) ? status : status ? 'OTHER' : 'EMPTY',
    transactionShape: Array.isArray(tx) ? `array(${tx.length})` : obj(tx) ? 'object' : tx == null ? 'absent' : typeof tx,
  };
};

const accountsResponse = await fetch('https://enter.tochka.com/uapi/open-banking/v1.0/accounts', {
  method: 'GET', headers, redirect: 'error', cache: 'no-store',
});
console.log('D065_ACCOUNTS_HTTP=' + accountsResponse.status);
if (!accountsResponse.ok) throw new Error('D065_ACCOUNTS_REQUEST_FAILED');
const accountsPayload = await readJson(accountsResponse);
const account = collection(accountsPayload, ['Account', 'account', 'Accounts', 'accounts'])
  .filter((value) => customerCode(value) === ctx.customerCode)
  .map((value) => accountId(value))
  .find((id) => /^\d{20}(?:\/\d{9})?$/.test(id));
if (!account) throw new Error('D065_SELECTED_ACCOUNT_MISSING');

const endDate = new Date().toISOString().slice(0, 10);
const initResponse = await fetch('https://enter.tochka.com/uapi/open-banking/v1.0/statements', {
  method: 'POST',
  headers: { ...headers, 'content-type': 'application/json' },
  body: JSON.stringify({ Data: { Statement: { accountId: account, startDateTime: ctx.startDate, endDateTime: endDate } } }),
  redirect: 'error',
  cache: 'no-store',
});
const initPayload = await readJson(initResponse);
console.log('D065_INIT_HTTP=' + initResponse.status);
console.log('D065_INIT_SHAPE=' + JSON.stringify(shape(initPayload)));
if (!initResponse.ok) throw new Error('D065_INIT_FAILED');
const sid = statementId(statements(initPayload)[0]);
if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(sid)) throw new Error('D065_STATEMENT_ID_MISSING');

const url = `https://enter.tochka.com/uapi/open-banking/v1.0/accounts/${account}/statements/${encodeURIComponent(sid)}`;
for (let attempt = 1; attempt <= 10; attempt += 1) {
  const response = await fetch(url, { method: 'GET', headers, redirect: 'error', cache: 'no-store' });
  const payload = await readJson(response);
  console.log(`D065_GET_${attempt}_HTTP=${response.status}`);
  console.log(`D065_GET_${attempt}_SHAPE=${JSON.stringify(shape(payload))}`);
  if (!response.ok) break;
  const first = statements(payload)[0];
  const status = String(first?.status ?? first?.Status ?? '').trim();
  if (/^(Ready|Completed)$/i.test(status)) break;
  await new Promise((resolve) => setTimeout(resolve, 1500));
}
console.log('D065_DIAGNOSTIC=SUCCESS');
