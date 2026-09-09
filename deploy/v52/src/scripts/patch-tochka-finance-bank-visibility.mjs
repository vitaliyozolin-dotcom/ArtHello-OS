import { applyD066 } from "./patch-tochka-finance-bank-visibility-v3.mjs";

console.log((await applyD066()) ? "D-066 bank finance visibility applied" : "D-066 already present");
