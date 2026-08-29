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
