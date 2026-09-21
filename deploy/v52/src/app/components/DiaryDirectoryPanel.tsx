"use client";
import { useState } from 'react';
import type { DirectoryClass } from '../../lib/diary-directory';

type Options = {branchId:string;groups:Array<{id:string;name:string}>;classes:Array<{id:string;name:string;grade:number}>};
type Preview = {branchId:string;token:string;students:number;families:number;classes:number;teachers:number;archived:number;applied:boolean};

export function DiaryDirectoryPanel({branches,busy,onAction}:{branches:Array<{id:string;name:string}>;busy:boolean;onAction:(body:Record<string,unknown>)=>Promise<unknown>}) {
  const [branchId,setBranchId]=useState(branches[0]?.id??'BR-SCHOOL');
  const [options,setOptions]=useState<Options>();
  const [draft,setDraft]=useState<Record<string,DirectoryClass>>({});
  const [preview,setPreview]=useState<Preview>();
  const change=(id:string,value:DirectoryClass|undefined)=>{setDraft(previous=>{const next={...previous};if(value)next[id]=value;else delete next[id];return next});setPreview(undefined)};
  const defaultClass=(group:{id:string;name:string}):DirectoryClass=>({id:group.id,name:group.name,grade:Number(group.name.match(/^(1[01]|[0-9])(?:-й)?\s*класс/i)?.[1]??-1)});
  async function perform(body:Record<string,unknown>) {
    const result=await onAction(body) as {diaryOptions?:Options;diaryDirectory?:Preview}|undefined;
    if(result?.diaryOptions){setOptions(result.diaryOptions);setDraft({});setPreview(undefined)}
    if(result?.diaryDirectory)setPreview(result.diaryDirectory);
  }
  if(!branches.length)return null;
  return <section aria-label="Передача справочника в дневники">
    <h4>Ученики и классы в дневниках</h4>
    <p>Выберите все школьные классы для передачи. Кружки не выбирайте. Ранее переданные ученики, которых нет в новом составе, попадут в архив. Передача не выдаёт доступы и не меняет пароли.</p>
    <select aria-label="Дневник школы" disabled={busy} value={branchId} onChange={event=>{setBranchId(event.target.value);setOptions(undefined);setPreview(undefined);setDraft({})}}>{branches.map(branch=><option key={branch.id} value={branch.id}>{branch.name}</option>)}</select>
    <button type="button" disabled={busy} onClick={()=>void perform({action:'readDiaryDirectoryOptions',branchId})}>Загрузить группы и классы</button>
    {options ? <><div style={{maxHeight:360,overflow:'auto'}}><table><thead><tr><th>Передавать</th><th>Группа ОС</th><th>Класс дневника</th><th>Название</th><th>Параллель</th></tr></thead><tbody>{options.groups.map(group=>{
      const row=draft[group.id];
      return <tr key={group.id}><td><input type="checkbox" aria-label={`Передавать ${group.name}`} disabled={busy} checked={Boolean(row)} onChange={event=>change(group.id,event.target.checked?defaultClass(group):undefined)}/></td><td>{group.name}</td><td>{row?<select aria-label={`Привязка ${group.name}`} disabled={busy} value={row.localId??''} onChange={event=>{const target=options.classes.find(item=>item.id===event.target.value);change(group.id,target?{id:group.id,name:target.name,grade:target.grade,localId:target.id}:defaultClass(group))}}><option value="">Создать новый класс</option>{options.classes.map(target=><option key={target.id} value={target.id}>{target.name}</option>)}</select>:null}</td><td>{row?<input aria-label={`Название ${group.name}`} disabled={busy||Boolean(row.localId)} value={row.name} onChange={event=>change(group.id,{...row,name:event.target.value})}/>:null}</td><td>{row?<input aria-label={`Параллель ${group.name}`} type="number" min={0} max={11} disabled={busy||Boolean(row.localId)} value={row.grade<0?'':row.grade} onChange={event=>change(group.id,{...row,grade:event.target.value===''?-1:Number(event.target.value)})}/>:null}</td></tr>;
    })}</tbody></table></div>
      <button type="button" disabled={busy||!Object.keys(draft).length||Object.values(draft).some(row=>row.grade<0)} onClick={()=>void perform({action:'previewDiaryDirectory',branchId,classes:Object.values(draft)})}>Проверить передачу без применения</button>
    </>:null}
    {preview?<div role="status"><p>Классов: {preview.classes}; учеников: {preview.students}; связанных семей: {preview.families}; профилей педагогов: {preview.teachers}; учеников в плане архивирования: {preview.archived}. {preview.applied?'Дневник подтвердил приём.':'Дневник проверил состав, данные ещё не применены.'}</p>{!preview.applied?<button type="button" disabled={busy} onClick={()=>void perform({action:'applyDiaryDirectory',branchId,token:preview.token})}>Передать проверенный справочник</button>:null}</div>:null}
  </section>;
}
