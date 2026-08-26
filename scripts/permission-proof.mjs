#!/usr/bin/env node
import fs from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');
const MATRIX_PATH = path.join(ROOT, 'quality-gates', 'permission-matrix.json');
const POLICY_PATH = path.join(ROOT, 'artifacts', 'api-server', 'src', 'lib', 'security', 'access-policy.ts');
const reportArg = process.argv.indexOf('--report');
const REPORT_PATH = reportArg >= 0 && process.argv[reportArg + 1]
  ? path.resolve(process.cwd(), process.argv[reportArg + 1])
  : path.join(ROOT, '.artifacts', 'permission-proof.json');

const matrix = JSON.parse(await fs.readFile(MATRIX_PATH, 'utf8'));
const policySource = await fs.readFile(POLICY_PATH, 'utf8');
const stripped = stripTypeScriptTypes(policySource, { mode: 'strip' });
const policy = await import(`data:text/javascript;base64,${Buffer.from(stripped).toString('base64')}`);
const failures = [];
const actualRoles = [...policy.AUTH_ROLES];

if (JSON.stringify(actualRoles) !== JSON.stringify(matrix.production_roles)) {
  failures.push({
    type: 'ROLE_DRIFT',
    expected: matrix.production_roles,
    actual: actualRoles,
    detail: 'Production auth roles changed without updating the proof matrix.'
  });
}

for (const gap of matrix.persona_gaps ?? []) {
  if (actualRoles.includes(gap.persona) && gap.status === 'NOT_YET_AUTH_ROLE') {
    failures.push({
      type: 'PERSONA_GAP_DRIFT',
      persona: gap.persona,
      detail: 'Persona became a production role but is still declared as a gap.'
    });
  }
}

const results = [];
for (const testCase of matrix.cases ?? []) {
  const scope = matrix.scopes?.[testCase.scope] ?? null;
  const decision = policy.decideRouteAccess(testCase.role, testCase.method, testCase.path, scope);
  const passed = decision.allowed === testCase.allowed && decision.policy === testCase.policy;
  results.push({
    id: testCase.id,
    role: testCase.role,
    method: testCase.method,
    path: testCase.path,
    expected: { allowed: testCase.allowed, policy: testCase.policy },
    actual: decision,
    passed
  });
  if (!passed) {
    failures.push({
      type: 'ACCESS_DRIFT',
      case: testCase.id,
      expected: results.at(-1).expected,
      actual: decision
    });
  }
}

for (const role of matrix.production_roles ?? []) {
  if (!results.some((item) => item.role === role)) {
    failures.push({ type: 'MISSING_ROLE_COVERAGE', role });
  }
}

const report = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  engine: 'ArtHello Permission Proof Engine',
  source_of_truth: matrix.source_of_truth,
  production_roles: actualRoles,
  persona_gaps: matrix.persona_gaps ?? [],
  summary: {
    cases: results.length,
    passed: results.filter((item) => item.passed).length,
    failed: failures.length,
    status: failures.length ? 'FAILED' : 'PROVED'
  },
  results,
  failures
};

await fs.mkdir(path.dirname(REPORT_PATH), { recursive: true });
await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2) + '\n');

if (failures.length) {
  console.error(`Permission Proof: FAILED (${failures.length} failure(s)). Report: ${REPORT_PATH}`);
  process.exit(1);
}
console.log(`Permission Proof: PROVED ${results.length}/${results.length}; persona gaps=${report.persona_gaps.length}.`);
