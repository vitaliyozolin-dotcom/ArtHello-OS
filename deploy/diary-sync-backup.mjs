// Online, standalone SQLite backup before owner-approved directory writes.
import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync, statSync, statfsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function backupDiary(source, directory, system) {
  if(!['atlas','school'].includes(system)) throw Error('DIARY_SYSTEM');
  const capacity=statfsSync(directory);
  if(capacity.bavail*capacity.bsize < statSync(source).size*3+512*1024*1024) throw Error('BACKUP_CAPACITY');
  const db=new DatabaseSync(source,{readOnly:true});
  const target=join(directory,'diary.sqlite');
  try {
    const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name));
    if(!['students','school_classes','lessons'].every(t=>tables.has(t))) throw Error('DIARY_SCHEMA');
    if(system==='atlas' && (!tables.has('diary_identity') || db.prepare("SELECT institution_id FROM diary_identity WHERE id='primary'").get()?.institution_id!=='atlas-school')) throw Error('DIARY_IDENTITY');
    // SQLite's backup API includes committed WAL pages while the application stays online.
    await backup(db,target);
  } finally { db.close(); }
  const saved=new DatabaseSync(target,{readOnly:true});
  try { if(saved.prepare('PRAGMA integrity_check').get().integrity_check!=='ok') throw Error('BACKUP_INTEGRITY'); }
  finally { saved.close(); }
  const receipt={system,integrity:'ok',method:'sqlite-online-backup',sha256:createHash('sha256').update(readFileSync(target)).digest('hex')};
  writeFileSync(join(directory,'receipt.json'),JSON.stringify(receipt),{flag:'wx',mode:0o600});
  return receipt;
}

if(process.argv[1]==='-' || (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)) {
  try {
    const source=process.env.DATABASE_PATH;
    const system=source==='/data/atlas-school.sqlite'?'atlas':source==='/data/school-1-11.sqlite'?'school':null;
    const key=process.env.ARTHELLO_SYNC_BACKUP_KEY;
    if(!system || !/^[1-9][0-9]*-1$/.test(key??'')) throw Error('BACKUP_CONTEXT');
    const directory=join('/backups','alfa-sync-'+key);
    mkdirSync(directory,{mode:0o700});
    console.log('DIARY_SYNC_BACKUP='+JSON.stringify(await backupDiary(source,directory,system)));
  } catch(error) { console.error('DIARY_SYNC_BACKUP_BLOCKED='+(/^[A-Z_]{3,50}$/.test(error?.message??'')?error.message:'UNCONFIRMED'));process.exitCode=2; }
}

