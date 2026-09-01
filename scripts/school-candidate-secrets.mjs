import { randomBytes } from "node:crypto";
import { appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SECRET_NAMES = ["CENTRAL_SECRET", "PASSWORDLESS_PEPPER", "DELIVERY_TOKEN"];

export function generateSchoolCandidateSecrets({
  appendEnvironment,
  emitWorkflowCommand,
} = {}) {
  const githubEnvironment = process.env.GITHUB_ENV;
  const append =
    appendEnvironment ??
    ((line) => {
      if (!githubEnvironment) throw new Error("GITHUB_ENV is required");
      appendFileSync(githubEnvironment, `${line}\n`, { encoding: "utf8", mode: 0o600 });
    });
  const emit = emitWorkflowCommand ?? ((line) => process.stdout.write(`${line}\n`));

  const secrets = Object.fromEntries(
    SECRET_NAMES.map((name) => [name, randomBytes(32).toString("hex")]),
  );

  for (const value of Object.values(secrets)) emit(`::add-mask::${value}`);
  for (const [name, value] of Object.entries(secrets)) append(`${name}=${value}`);
  return secrets;
}

const isEntryPoint =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isEntryPoint) generateSchoolCandidateSecrets();
