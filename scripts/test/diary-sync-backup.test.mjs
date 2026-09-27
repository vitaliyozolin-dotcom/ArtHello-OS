import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { backupDiary } from '../../deploy/diary-sync-backup.mjs';

test('online diary backup includes committed WAL and remains independently readable',async()=>{
  const root=mkdtempSync(join(tmpdir(),'diary-sync-backup-'));
  const source=join(root,'school.sqlite'),out=join(root,'backup');mkdirSync(out);
  const live=new DatabaseSync(source);
  try {
    live.exec("PRAGMA journal_mode=WAL; CREATE TABLE students(id TEXT); CREATE TABLE school_classes(id TEXT); CREATE TABLE lessons(id TEXT); INSERT INTO students VALUES('synthetic');");
    const receipt=await backupDiary(source,out,'school');
    assert.equal(receipt.integrity,'ok');
    const saved=new DatabaseSync(join(out,'diary.sqlite'),{readOnly:true});
    try { assert.equal(saved.prepare('SELECT count(*) n FROM students').get().n,1); } finally { saved.close(); }
    assert.deepEqual(JSON.parse(readFileSync(join(out,'receipt.json'),'utf8')),receipt);
    live.exec("INSERT INTO students VALUES('later')");
  } finally { live.close();rmSync(root,{recursive:true,force:true}); }
});

test('Atlas identity mismatch cannot be accepted as a backup',async()=>{
  const root=mkdtempSync(join(tmpdir(),'diary-sync-deny-'));
  const source=join(root,'atlas.sqlite'),out=join(root,'backup');mkdirSync(out);
  const db=new DatabaseSync(source);
  db.exec('CREATE TABLE students(id TEXT); CREATE TABLE school_classes(id TEXT); CREATE TABLE lessons(id TEXT)');db.close();
  try { await assert.rejects(()=>backupDiary(source,out,'atlas'),/DIARY_IDENTITY/); }
  finally { rmSync(root,{recursive:true,force:true}); }
});

