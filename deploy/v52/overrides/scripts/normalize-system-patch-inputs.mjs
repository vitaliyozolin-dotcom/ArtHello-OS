import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function replaceExactlyOnce(source, search, replacement, label) {
  const first = source.indexOf(search);
  const second = first === -1 ? -1 : source.indexOf(search, first + search.length);
  if (first === -1 || second !== -1) {
    throw new Error(`Patch input normalization failed for ${label}`);
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + search.length)}`;
}

const operationalPath = fileURLToPath(new URL("./patch-system-operational-modules.mjs", import.meta.url));
let operational = readFileSync(operationalPath, "utf8");
const strictFoodWording = 'source = replaceText(source, "по тестовым складам", "по рабочим складам", "food stock wording");';
if (!operational.includes(strictFoodWording)) {
  throw new Error("Patch input normalization failed for optional food wording rule");
}
operational = operational.replace(
  strictFoodWording,
  'source = source.replace("по тестовым складам", "по рабочим складам");',
);

const impureRequestDate = ' defaultValue={new Date(Date.now()+21*86400000).toISOString().slice(0,10)}';
if (!operational.includes(impureRequestDate)) {
  throw new Error("Patch input normalization failed for procurement request date");
}
operational = operational.replace(impureRequestDate, "");
writeFileSync(operationalPath, operational, "utf8");

const analyticsPath = fileURLToPath(new URL("./patch-system-analytics-readiness.mjs", import.meta.url));
let analytics = readFileSync(analyticsPath, "utf8");
analytics = replaceExactlyOnce(
  analytics,
  '<div className="analytics-heading-actions"><button onClick={onOpenIntegrations}>Подключить источники</button></div>',
  '<div className="analytics-heading-actions"><button onClick={onOpenIntegrations}>Загрузить данные</button></div>',
  "analytics stable empty-state action",
);
writeFileSync(analyticsPath, analytics, "utf8");

const contentPath = fileURLToPath(new URL("./patch-system-content-legal.mjs", import.meta.url));
let content = readFileSync(contentPath, "utf8");
content = replaceExactlyOnce(
  content,
  '<div className="content-boundary"><strong>РАБОЧАЯ СТРУКТУРА</strong><span>Контент-план, публикации, атрибуция и рекомендации остаются доступными при нулевых данных.</span>',
  '<div className="content-boundary"><strong>Данных пока нет</strong><span>Контент-план, публикации, атрибуция и рекомендации остаются доступными при нулевых данных.</span>',
  "content stable empty-state label",
);
writeFileSync(contentPath, content, "utf8");

console.log("System patch inputs normalized");

