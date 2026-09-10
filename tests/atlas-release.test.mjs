import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';

for (const scenario of ['stale-source','missing-central','wrong-target']) {
  test(`production preflight refuses ${scenario} before any Docker or data mutation`,()=>{
    const root=mkdtempSync(join(tmpdir(),'atlas-release-test-'));
    try {
      writeFileSync(join(root,'curl'),`#!/usr/bin/env python3
import json,sys,pathlib
args=sys.argv[1:]
if any('api.github.com' in a for a in args):
 print(json.dumps({'object':{'sha':'${scenario==='stale-source'?'b':'a'}'*40}}))
else:
 p=args[args.index('--dump-header')+1]
 pathlib.Path(p).write_text('location: https://foreign.example.test/auth/central/start\\r\\n')
 print('${scenario==='missing-central'?'404':'303'}',end='')
`,{mode:0o700});
      writeFileSync(join(root,'docker'),`#!/bin/sh\ntouch '${root}/docker-called'\nexit 99\n`,{mode:0o700});
      const r=spawnSync('bash',[resolve('deploy/publish-atlas.sh')],{encoding:'utf8',env:{...process.env,PATH:root+':'+process.env.PATH,GITHUB_SHA:'a'.repeat(40),GITHUB_REPOSITORY:'vitaliyozolin-dotcom/ArtHello-OS',GITHUB_TOKEN:'fixture-not-a-secret',RUNNER_TEMP:root,ATLAS_BUNDLE_DIR:root}});
      assert.notEqual(r.status,0,r.stdout+r.stderr);
      assert.equal(existsSync(join(root,'docker-called')),false);
      if(scenario!=='stale-source')assert.match(r.stderr,/ATLAS_RELEASE_BLOCKED: Production ArtHello/);
    }finally{rmSync(root,{recursive:true,force:true});}
  });
}
