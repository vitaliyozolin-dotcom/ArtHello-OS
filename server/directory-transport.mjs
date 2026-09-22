import { createHmac, timingSafeEqual } from 'node:crypto';
import { applyDirectorySnapshot } from './directory-snapshot.mjs';

let queue=Promise.resolve();
export async function directoryRequest(request, config) {
  const text=await request.text();
  if(Buffer.byteLength(text)>2_000_000) return Response.json({error:'Справочник слишком большой'},{status:413});
  const timestamp=request.headers.get('x-arthello-timestamp')??'';
  const signature=request.headers.get('x-arthello-signature')??'';
  if(typeof config.secret!=='string' || config.secret.length<32) return Response.json({error:'Синхронизация не настроена'},{status:503});
  if(!/^\d{10}$/.test(timestamp) || Math.abs(Date.now()-Number(timestamp)*1000)>300_000 || !/^[a-f0-9]{64}$/i.test(signature)) return Response.json({error:'Неверная подпись или время запроса'},{status:401});
  const expected=createHmac('sha256',config.secret).update(`${timestamp}.${text}`).digest();
  if(!timingSafeEqual(expected,Buffer.from(signature,'hex'))) return Response.json({error:'Неверная подпись'},{status:401});
  let body;
  try { body=JSON.parse(text); } catch { return Response.json({error:'Некорректный JSON'},{status:400}); }
  if(body.systemId!==config.systemId || body.branchId!==config.branchId || !['preview','apply','inspect'].includes(body.action)) return Response.json({error:'Неверное учреждение или действие'},{status:400});
  const operation=queue.then(async()=> {
    try {
      const db=await config.openDatabase();
      if(body.action==='inspect') return Response.json({classes:(await db.prepare("SELECT id,name,grade FROM school_classes WHERE status='active' ORDER BY grade,name").all()).results},{headers:{'cache-control':'no-store'}});
      const result=await applyDirectorySnapshot(db,body.snapshot,body.action==='apply', {systemId:config.systemId,branchId:config.branchId});
      return Response.json(result,{headers:{'cache-control':'no-store'}});
    } catch { return Response.json({error:'Справочник не применён: проверьте версию, полноту и привязки классов'},{status:409}); }
  });
  queue=operation.then(()=>undefined,()=>undefined);
  return operation;
}
