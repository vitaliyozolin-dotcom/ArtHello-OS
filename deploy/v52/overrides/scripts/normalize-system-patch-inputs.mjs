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

console.log("System patch inputs normalized");
