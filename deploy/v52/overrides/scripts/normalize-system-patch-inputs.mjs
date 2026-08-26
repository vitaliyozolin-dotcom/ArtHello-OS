import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const legalPath = fileURLToPath(new URL("../app/components/LegalWorkspace.tsx", import.meta.url));
let legal = readFileSync(legalPath, "utf8");
const variants = [
  'import {useCallback,useEffect,useState} from "react";',
  'import {useCallback,useEffect,useState}from "react";',
  'import {useCallback,useEffect,useState} from"react";',
];
const matches = variants.filter((variant) => legal.includes(variant));
if (matches.length !== 1) {
  throw new Error(`Patch input normalization failed for LegalWorkspace import: ${matches.length} matches`);
}
legal = legal.replace(matches[0], 'import {useCallback,useEffect,useState}from"react";');
writeFileSync(legalPath, legal, "utf8");

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

console.log("System patch inputs normalized");
