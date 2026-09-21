// Only the signed directory endpoint of the two configured diaries is exposed.
// Uses Node's bounded DNS/TLS path, like the existing AlfaCRM service binding.
const LIMIT = 6_000_000;
const reply = status => Response.json({error:'diary_transport_refused'},{status,headers:{'cache-control':'no-store'}});
export function createDiaryDirectoryTransport({atlasOrigin='',schoolOrigin='',fetchImpl=globalThis.fetch,timeoutMs=30_000}={}) {
  const targets=new Map();
  for(const [origin,systemId,branchId] of [[atlasOrigin,'SYS-SCHOOL-ATLAS','BR-ATLAS-SCHOOL'],[schoolOrigin,'SYS-SCHOOL-1-11','BR-SCHOOL']]) {
    if(!origin) continue;
    const url=new URL(origin);
    if(url.origin!==origin || url.protocol!=='https:' || url.username || url.password || targets.has(origin)) throw Error('Invalid diary transport configuration');
    targets.set(origin,{systemId,branchId});
  }
  if(typeof fetchImpl!=='function' || !Number.isSafeInteger(timeoutMs) || timeoutMs<1 || timeoutMs>30_000) throw Error('Invalid diary transport configuration');
  return async request=>{
    let url;try{url=new URL(request.url);}catch{return reply(403);}
    const expected=targets.get(url.origin);
    if(!expected || request.method!=='POST' || url.pathname!=='/api/internal/directory-sync' || url.search || url.hash || url.username || url.password) return reply(403);
    if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json') return reply(415);
    const signature=request.headers.get('x-arthello-signature')??'',timestamp=request.headers.get('x-arthello-timestamp')??'';
    if(!/^[a-f0-9]{64}$/.test(signature) || !/^\d{10,12}$/.test(timestamp)) return reply(400);
    let body,payload;try{body=await request.text();if(Buffer.byteLength(body)>LIMIT)return reply(413);payload=JSON.parse(body);}catch{return reply(400);}
    if(!payload || payload.systemId!==expected.systemId || payload.branchId!==expected.branchId || !['inspect','preview','apply'].includes(payload.action)
      || (payload.action==='inspect' ? payload.snapshot!==null : !payload.snapshot || typeof payload.snapshot!=='object')) return reply(400);
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
    const aborted=()=>controller.abort(); request.signal?.addEventListener('abort',aborted,{once:true});
    try{
      if(request.signal?.aborted)controller.abort();
      const response=await fetchImpl(url.href,{method:'POST',headers:{accept:'application/json','content-type':'application/json','x-arthello-signature':signature,'x-arthello-timestamp':timestamp},body,redirect:'manual',signal:controller.signal});
      if(response.status>=300 && response.status<400){await response.body?.cancel();return reply(502);}
      const reader=response.body?.getReader(),chunks=[];let size=0;
      if(reader)for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>LIMIT){await reader.cancel();return reply(502);}chunks.push(part.value);}
      return new Response([204,205,304].includes(response.status)?null:Buffer.concat(chunks),{status:response.status,headers:{'content-type':'application/json','cache-control':'no-store'}});
    }catch{return reply(controller.signal.aborted?504:502);}
    finally{clearTimeout(timer);request.signal?.removeEventListener('abort',aborted);}
  };
}
