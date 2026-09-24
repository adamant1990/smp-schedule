"use client";

import { FormEvent, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Brigade = { id:string; number:number; name:string; active:boolean };
type Employee = {
  id:string; full_name:string; position:string; main_brigade_id:string|null;
  employment_start:string|null; employment_end:string|null;
  target_hours:number; can_extra_shifts:boolean; active:boolean;
};

const emptyForm = {
  full_name:"", position:"Фельдшер", main_brigade_id:"",
  employment_start:"", employment_end:"", target_hours:"0",
  can_extra_shifts:true
};

export default function EmployeesPage() {
  const [employees,setEmployees]=useState<Employee[]>([]);
  const [brigades,setBrigades]=useState<Brigade[]>([]);
  const [form,setForm]=useState(emptyForm);
  const [editing,setEditing]=useState<string|null>(null);
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(true);
  const [supabase,setSupabase]=useState<ReturnType<typeof createClient>|null>(null);

  async function load(client: ReturnType<typeof createClient>) {
    setLoading(true); setError("");
    const [e,b] = await Promise.all([
      client.from("employees").select("*").order("full_name"),
      client.from("brigades").select("*").eq("active",true).order("number")
    ]);
    if(e.error || b.error) setError(e.error?.message || b.error?.message || "Ошибка загрузки");
    else { setEmployees((e.data||[]) as Employee[]); setBrigades((b.data||[]) as Brigade[]); }
    setLoading(false);
  }

  useEffect(()=>{ const client=createClient(); setSupabase(client); void load(client); },[]);

  function edit(employee:Employee) {
    setEditing(employee.id);
    setForm({
      full_name:employee.full_name, position:employee.position,
      main_brigade_id:employee.main_brigade_id || "",
      employment_start:employee.employment_start || "",
      employment_end:employee.employment_end || "",
      target_hours:String(employee.target_hours ?? 0),
      can_extra_shifts:employee.can_extra_shifts
    });
    window.scrollTo({top:0,behavior:"smooth"});
  }

  function reset() { setEditing(null); setForm(emptyForm); }

  async function submit(event:FormEvent) {
    event.preventDefault();
    if (!supabase) return; setError("");
    const payload={
      full_name:form.full_name.trim(), position:form.position.trim() || "Фельдшер",
      main_brigade_id:form.main_brigade_id || null,
      employment_start:form.employment_start || null,
      employment_end:form.employment_end || null,
      target_hours:Number(form.target_hours) || 0,
      can_extra_shifts:form.can_extra_shifts, active:true
    };
    const result=editing
      ? await supabase.from("employees").update(payload).eq("id",editing)
      : await supabase.from("employees").insert(payload);
    if(result.error) { setError(result.error.message); return; }
    reset(); await load(supabase);
  }

  async function toggleActive(employee:Employee) {
    if (!supabase) return;
    const {error}=await supabase.from("employees").update({active:!employee.active}).eq("id",employee.id);
    if(error) setError(error.message); else await load(supabase);
  }

  const brigadeName=(id:string|null)=>id ? brigades.find(b=>b.id===id)?.number ?? "—" : "—";

  return (
    <main className="page">
      <header className="topbar">
        <div><div className="eyebrow">СМП • ПЛАНИРОВАНИЕ</div><h1>Сотрудники</h1><p className="muted">Сотрудники, основные бригады и нормы часов.</p></div>
        <a className="secondary-button" href="/">← Главное меню</a>
      </header>

      <section className="card">
        <div className="section-title"><h2>{editing ? "Редактирование сотрудника" : "Новый сотрудник"}</h2>{editing && <button className="link-button" onClick={reset}>Отмена</button>}</div>
        <form className="employee-form" onSubmit={submit}>
          <label>ФИО<input value={form.full_name} onChange={e=>setForm({...form,full_name:e.target.value})} required placeholder="Фамилия Имя Отчество"/></label>
          <label>Должность<input value={form.position} onChange={e=>setForm({...form,position:e.target.value})} required/></label>
          <label>Основная бригада<select value={form.main_brigade_id} onChange={e=>setForm({...form,main_brigade_id:e.target.value})}><option value="">Не назначена</option>{brigades.map(b=><option key={b.id} value={b.id}>Бригада {b.number}</option>)}</select></label>
          <label>Дата начала<input type="date" value={form.employment_start} onChange={e=>setForm({...form,employment_start:e.target.value})}/></label>
          <label>Дата окончания<input type="date" value={form.employment_end} onChange={e=>setForm({...form,employment_end:e.target.value})}/></label>
          <label>Норма часов<input type="number" min="0" step="0.5" value={form.target_hours} onChange={e=>setForm({...form,target_hours:e.target.value})}/></label>
          <label className="checkbox-label"><input type="checkbox" checked={form.can_extra_shifts} onChange={e=>setForm({...form,can_extra_shifts:e.target.checked})}/> Может брать дополнительные смены</label>
          <button className="primary-button" type="submit">{editing ? "Сохранить" : "Добавить сотрудника"}</button>
        </form>
        {error && <div className="error-box">{error}</div>}
      </section>

      <section className="card">
        <div className="section-title"><h2>Список сотрудников</h2><span className="badge">{employees.length}</span></div>
        {loading ? <p className="muted">Загрузка...</p> : employees.length===0 ? <p className="muted">Сотрудников пока нет.</p> :
          <div className="table-wrap"><table><thead><tr><th>ФИО</th><th>Должность</th><th>Бригада</th><th>Норма</th><th>Доп. смены</th><th>Статус</th><th></th></tr></thead>
          <tbody>{employees.map(e=><tr key={e.id}><td><strong>{e.full_name}</strong></td><td>{e.position}</td><td>{brigadeName(e.main_brigade_id)}</td><td>{e.target_hours} ч</td><td>{e.can_extra_shifts?"Да":"Нет"}</td><td><span className={e.active?"status-ok":"status-off"}>{e.active?"Активен":"Неактивен"}</span></td><td className="actions"><button className="link-button" onClick={()=>edit(e)}>Изменить</button><button className="link-button" onClick={()=>toggleActive(e)}>{e.active?"Отключить":"Включить"}</button></td></tr>)}</tbody></table></div>}
      </section>
    </main>
  );
}
