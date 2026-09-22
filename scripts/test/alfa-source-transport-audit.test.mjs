import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeTransportProbe } from '../../.github/scripts/alfa-source-audit.mjs';

test('transport probe emits fixed codes and never teacher response bodies', async()=>{
  assert.deepEqual(await summarizeTransportProbe(Response.json({items:[{name:'private'}]})),{status:200,ok:true});
  assert.deepEqual(await summarizeTransportProbe(Response.json({error:'upstream_response_too_large'},{status:502})),{status:502,ok:false,reason:'upstream_response_too_large'});
  const unknown=await summarizeTransportProbe(Response.json({error:'private secret',detail:'private'},{status:502}));
  assert.deepEqual(unknown,{status:502,ok:false,reason:'unclassified'});
  assert.doesNotMatch(JSON.stringify(unknown),/private|secret/);
});
