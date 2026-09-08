import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { stripTypeScriptTypes } from 'node:module';

const routePath = 'app/api/integrations/alfacrm/route.ts';
const shellPath = 'app/components/IntegrationWorkspace.tsx';
const wizardPath = 'app/components/AlfaCrmSetupWizard.tsx';
const hook = resolve('scripts/patch-alfacrm-staged-integration.mjs');
const candidateStatement = /    if \(matchKey\) statements\.push\(env\.DB\.prepare\(`INSERT INTO alfacrm_family_merge_candidates[\s\S]*?\.bind\(remoteBranchId, studentId, familyId, matchKey, guardianName, phone\)\);\n/g;

for (const needsInsertion of [false, true]) {
  test(`repeated actual assembly preserves one candidate write (${needsInsertion ? 'legacy missing insert' : 'current raw override'})`, async t => {
    const dir = mkdtempSync(join(tmpdir(), 'alfacrm-assembly-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    for (const path of [routePath, shellPath, wizardPath]) {
      let source = readFileSync(resolve(path), 'utf8');
      if (path === routePath && needsInsertion) {
        const matches = source.match(candidateStatement) ?? [];
        assert.equal(matches.length, 1, 'fixture starts with exactly one actual candidate insert');
        source = source.replace(candidateStatement, '');
      }
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), source);
    }
    // The staged hook precedes the style-import hook in a fresh assembly.
    writeFileSync(join(dir, 'app/components/AlfaCrmSetupWizard.styles.txt'), readFileSync(resolve('app/components/AlfaCrmSetupWizard.css')));
    const snapshot = () => [routePath, shellPath, wizardPath].map(path => readFileSync(join(dir, path), 'utf8'));
    execFileSync(process.execPath, [hook], { cwd: dir, stdio: 'pipe' });
    const first = snapshot();
    for (let i = 0; i < 2; i += 1) {
      execFileSync(process.execPath, [hook], { cwd: dir, stdio: 'pipe' });
      assert.deepEqual(snapshot(), first, 'rerunning the real hook must not change any of its output files');
    }

    // Count actual submitted D1 writes. An UPSERT hides duplicate submissions in
    // row-count checks, so executing canonicalization exposes the original bug.
    const writes = [];
    globalThis.__alfaAssemblyDb = {
      prepare: sql => ({ bind: (...args) => ({ sql, args }) }),
      batch: async statements => { writes.push(...statements); return statements.map(() => ({})); },
    };
    let source = stripTypeScriptTypes(first[0], { mode: 'transform' });
    source = source.replace(/^import\s+[\s\S]*?\s+from\s+["'][^"']+["'];?/gm, '');
    source = `const env={DB:globalThis.__alfaAssemblyDb};\n${source}\nexport {canonicalizeFamilies,defaultState};`;
    const route = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${needsInsertion}`);
    const state = route.defaultState(); state.branchMappings = { '7': 'BR-FIXTURE' };
    const result = await route.canonicalizeFamilies([{ remoteBranchId: '7', item: { id: 101, name: 'Fixture pupil', legal_name: 'Fixture guardian' } }], state, [{ id: 'BR-FIXTURE', name: 'Fixture branch' }], 'fixture');
    assert.deepEqual(result, { accepted: 1, rejected: 0 });
    assert.equal(writes.filter(statement => /INSERT INTO alfacrm_family_merge_candidates\b/.test(statement.sql)).length, 1);
    assert.equal(writes.filter(statement => /INSERT INTO alfacrm_projection_lineage\b/.test(statement.sql)).length, 3, 'all family projections retain their lineage');
  });
}
