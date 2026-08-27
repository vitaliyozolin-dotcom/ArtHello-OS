import fs from "node:fs";

const path = "/app/scripts/patch-help-finance-ux-v3.mjs";
let source = fs.readFileSync(path, "utf8");

const replacements = [
  {
    label: "current finance period template",
    before: '\\`${year}-\\${month}\\`',
    after: '\\`\\${year}-\\${month}\\`',
  },
  {
    label: "finance period navigation template",
    before: '\\`${date.getUTCFullYear()}-\\${String(date.getUTCMonth() + 1).padStart(2, "0")}\\`',
    after: '\\`\\${date.getUTCFullYear()}-\\${String(date.getUTCMonth() + 1).padStart(2, "0")}\\`',
  },
];

for (const { label, before, after } of replacements) {
  const first = source.indexOf(before);
  const second = first === -1 ? -1 : source.indexOf(before, first + before.length);
  if (first === -1) {
    if (source.includes(after)) continue;
    throw new Error(`prepare-help-finance-ux-v3 failed at ${label}: source marker not found`);
  }
  if (second !== -1) {
    throw new Error(`prepare-help-finance-ux-v3 failed at ${label}: duplicate source marker`);
  }
  source = source.slice(0, first) + after + source.slice(first + before.length);
}

fs.writeFileSync(path, source, "utf8");
console.log("prepare-help-finance-ux-v3: interpolation fixed");
