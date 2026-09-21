import test from 'node:test';
import assert from 'node:assert/strict';
import {createDiaryDirectoryTransport} from '../production/diary-directory-transport.mjs';
import {Miniflare,Log,LogLevel} from 'miniflare';
const origin='https://atlas.test';
const body={systemId:'SYS-SCHOOL-ATLAS',branchId:'BR-ATLAS-SCHOOL',action:'inspect',snapshot:null};
const request=(url=origin+'/api/internal/directory-sync',payload=body)=>new Request(url,{method:'POST',headers:{'content-type':'application/json','x-arthello-signature':'a'.repeat(64),'x-arthello-timestamp':'1800000000',cookie:'must-not-forward'},body:JSON.stringify(payload)});
test('directory channel preserves signed bytes and filters response and request headers',async()=>{
  const transport=createDiaryDirectoryTransport({atlasOrigin:origin,fetchImpl:async(url,init)=>{
    assert.equal(url,origin+'/api/internal/directory-sync');assert.equal(init.redirect,'manual');assert.equal(init.body,JSON.stringify(body));assert.equal(init.headers.cookie,undefined);
    return Response.json({classes:[]},{headers:{'set-cookie':'must-not-cross'}});
  }});
  const result=await transport(request());assert.equal(result.status,200);assert.equal(result.headers.has('set-cookie'),false);assert.deepEqual(await result.json(),{classes:[]});
});
test('foreign endpoints, mutations outside directory and cross-school bodies never reach the network',async()=>{
  let calls=0;const transport=createDiaryDirectoryTransport({atlasOrigin:origin,fetchImpl:async()=>{calls++;return Response.json({});}});
  for(const url of ['https://other.test/api/internal/directory-sync',origin+'/api/auth/login',origin+'/api/internal/directory-sync?next=other'])assert.equal((await transport(request(url))).status,403);
  assert.equal((await transport(request(undefined,{...body,branchId:'BR-SCHOOL'}))).status,400);assert.equal((await transport(request(undefined,{...body,action:'delete'}))).status,400);assert.equal(calls,0);
});
test('redirects and errors cannot disclose signed payloads or network secrets',async()=>{
  for(const fetchImpl of [async()=>new Response(null,{status:302,headers:{location:'https://other.test'}}),async()=>{throw Error('private upstream detail');}]){
    const transport=createDiaryDirectoryTransport({atlasOrigin:origin,fetchImpl});const r=await transport(request());assert.equal(r.status,502);assert.doesNotMatch(await r.text(),/private|other.test/);
  }
});

test('real worker service binding carries directory requests to Node',async()=>{
  const transport=createDiaryDirectoryTransport({atlasOrigin:origin,fetchImpl:async(_url,init)=>{
    assert.equal(JSON.parse(init.body).action,'inspect'); return Response.json({classes:[]});
  }});
  const runtime=new Miniflare({modules:true,compatibilityDate:'2026-05-15',cf:false,log:new Log(LogLevel.NONE),
    script:`export default {async fetch(request,env){return env.DIARY_DIRECTORY_TRANSPORT.fetch(new Request(${JSON.stringify(origin+'/api/internal/directory-sync')},{method:'POST',redirect:'manual',headers:{'content-type':'application/json','x-arthello-signature':'a'.repeat(64),'x-arthello-timestamp':'1800000000'},body:${JSON.stringify(JSON.stringify(body))}}));}}`,
    serviceBindings:{DIARY_DIRECTORY_TRANSPORT:transport}});
  try{const response=await runtime.dispatchFetch('http://localhost/');assert.equal(response.status,200);assert.deepEqual(await response.json(),{classes:[]});}
  finally{await runtime.dispose();}
});
