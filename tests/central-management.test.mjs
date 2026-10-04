import test from 'node:test';
import assert from 'node:assert/strict';
import { centralManagementUrl } from '../lib/central-management.mjs';
test('management links lead to existing central modules',()=>{
  for(const section of ['clients','hr','education','access']) assert.equal(centralManagementUrl('https://os.test.invalid',section),'https://os.test.invalid/#'+section);
});
test('unknown sections, paths and URLs cannot create an open redirect',()=>{
  for(const section of [null,'//evil.invalid','https://evil.invalid','access?role=OWNER','__proto__','constructor']) assert.equal(centralManagementUrl('https://os.test.invalid',section),'https://os.test.invalid/');
});
