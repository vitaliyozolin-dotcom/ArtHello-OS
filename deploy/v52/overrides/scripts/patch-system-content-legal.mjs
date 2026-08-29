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

patch("app/api/legal-actions/route.ts", (input) => {
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
    `async function createContract(actor: string, body: Record<string, unknown>) {\n  const partyName = clean(body.partyName, 180);\n  const partyType = clean(body.partyType, 60) || "Контрагент";\n  const contractType = clean(body.contractType, 80) || "Договор";\n  const number = clean(body.number, 80);\n  const validFrom = clean(body.validFrom, 10);\n  const validUntil = clean(body.validUntil, 10);\n  const signedStatus = clean(body.signedStatus, 40) || "Не подписан";\n  const limitRubles = Number(body.limitRubles ?? 0);\n  const closingRequired = body.closingRequired === true || body.closingRequired === "on";\n  if (partyName.length < 3 || number.length < 2 || !/^\\d{4}-\\d{2}-\\d{2}$/.test(validFrom) || !/^\\d{4}-\\d{2}-\\d{2}$/.test(validUntil) || validUntil < validFrom) {\n    return Response.json({ error: "Заполните сторону, номер и корректный срок договора" }, { status: 400 });\n  }\n  if (!Number.isFinite(limitRubles) || limitRubles < 0) return Response.json({ error: "Проверьте сумму или лимит договора" }, { status: 400 });\n  const db = getDb();\n  const suffix = crypto.randomUUID().slice(0, 8).toUpperCase();\n  const partyId = \`ENT-\${suffix}\`;\n  const contractId = \`LCON-\${suffix}\`;\n  const referenceDocumentId = \`DOG-\${suffix}\`;\n  await db.insert(entities).values({\n    id: partyId, entityType: partyType, displayName: partyName, status: "Активна", sourceSystem: "MANUAL",\n    sourceRecordId: \`LEGAL:\${partyId}\`, dataQuality: "Ручной ввод · требует проверки", scope: "Юридический контур", metadata: "{}", createdBy: actor,\n  });\n  try {\n    const [contract] = await db.insert(legalContracts).values({\n      id: contractId, referenceDocumentId, contractType, partyType, partyEntityId: partyId, number, signedStatus, validFrom, validUntil,\n      limitMinor: Math.round(limitRubles * 100), spentMinor: 0, status: "На проверке", electronicSignatureStatus: "ЭП не подключена",\n      requisiteStatus: "Требуют проверки", ownerEntityId: "", closingRequired,\n    }).returning();\n    const stableId = \`LGLDOC-\${suffix}\`;\n    await db.insert(legalDocumentItems).values({\n      id: \`\${stableId}-V1\`, stableId, contractId, itemType: "Договор", title: \`\${contractType} № \${number}\`, version: 1,\n      required: true, signedStatus, status: "На проверке", dueDate: validUntil, reference: "Ручной ввод",\n    });\n    await audit(actor, "legal.contract_created", "legal_contract", contractId, { partyId, number, contractType });\n    return Response.json({ contract }, { status: 201 });\n  } catch (error) {\n    await db.delete(entities).where(eq(entities.id, partyId));\n    throw error;\n  }\n}\n\nasync function version(actor: string, body: Record<string, unknown>) {`,
    "legal contract create implementation",
  );
  return source;
});

console.log("System-wide patch content_legal applied");

