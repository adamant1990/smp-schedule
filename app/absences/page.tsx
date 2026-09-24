"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type Employee = { id: string; full_name: string; position: string; active: boolean };
type Absence = {
  id: string; employee_id: string;
  absence_type: "vacation" | "sick" | "absence" | "other";
  date_from: string; date_to: string; note: string | null;
};
const absenceTypes = [
  { value: "vacation", label: "Отпуск" },
  { value: "sick", label: "Больничный" },
  { value: "absence", label: "Другое отсутствие" },
  { value: "other", label: "Прочее" },
] as const;

export default function AbsencesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [absenceType, setAbsenceType] = useState<Absence["absence_type"]>("vacation");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const employeeMap = useMemo(
    () => new Map(employees.map((employee) => [employee.id, employee.full_name])),
    [employees]
  );

  async function load() {
    setLoading(true);
    setError("");
    const supabase = createClient();
    const [employeesResult, absencesResult] = await Promise.all([
      supabase.from("employees").select("id, full_name, position, active").eq("active", true).order("full_name"),
      supabase.from("employee_absences")
        .select("id, employee_id, absence_type, date_from, date_to, note")
        .order("date_from", { ascending: false }),
    ]);
    if (employeesResult.error || absencesResult.error) {
      setError(employeesResult.error?.message || absencesResult.error?.message || "Не удалось загрузить данные.");
      setLoading(false);
      return;
    }
    setEmployees((employeesResult.data ?? []) as Employee[]);
    setAbsences((absencesResult.data ?? []) as Absence[]);
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  async function addAbsence() {
    setError(""); setMessage("");
    if (!employeeId || !dateFrom || !dateTo) {
      setError("Выберите сотрудника и укажите период отсутствия."); return;
    }
    if (dateFrom > dateTo) {
      setError("Дата начала не может быть позже даты окончания."); return;
    }
    const overlap = absences.some(
      (absence) => absence.employee_id === employeeId &&
        absence.date_from <= dateTo && absence.date_to >= dateFrom
    );
    if (overlap) {
      setError("У этого сотрудника уже есть пересекающееся отсутствие."); return;
    }

    setSaving(true);
    const supabase = createClient();
    const result = await supabase.from("employee_absences").insert({
      employee_id: employeeId,
      absence_type: absenceType,
      date_from: dateFrom,
      date_to: dateTo,
      note: note.trim() || null,
    }).select("id, employee_id, absence_type, date_from, date_to, note").single();

    if (result.error || !result.data) {
      setError(result.error?.message || "Не удалось сохранить отсутствие.");
      setSaving(false); return;
    }
    setAbsences((current) =>
      [result.data as Absence, ...current].sort((a, b) => b.date_from.localeCompare(a.date_from))
    );
    setDateFrom(""); setDateTo(""); setNote("");
    setMessage("Отсутствие сохранено.");
    setSaving(false);
  }

  async function removeAbsence(id: string) {
    setError(""); setMessage("");
    const supabase = createClient();
    const result = await supabase.from("employee_absences").delete().eq("id", id);
    if (result.error) { setError(result.error.message); return; }
    setAbsences((current) => current.filter((absence) => absence.id !== id));
    setMessage("Отсутствие удалено.");
  }

  return (
    <main className="page">
      <header className="topbar">
        <div>
          <div className="eyebrow">СМП • ПЛАНИРОВАНИЕ</div>
          <h1>Отсутствия сотрудников</h1>
          <p className="muted">Отпуска, больничные и другие периоды, когда сотрудник недоступен для графика.</p>
        </div>
        <Link className="secondary-button" href="/">← Главное меню</Link>
      </header>

      {message && <div className="success-box">{message}</div>}
      {error && <div className="error-box">{error}</div>}

      <section className="card">
        <div className="section-title">
          <div>
            <h2>Добавить отсутствие</h2>
            <p className="muted">Период блокирует назначение сотрудника на смены. Основной цикл при этом не сдвигается.</p>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(240px, 2fr) 1fr 1fr 1fr", gap: 12, alignItems: "end" }}>
          <label>
            Сотрудник
            <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">Выберите сотрудника</option>
              {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.full_name}</option>)}
            </select>
          </label>
          <label>
            Вид
            <select value={absenceType} onChange={(e) => setAbsenceType(e.target.value as Absence["absence_type"])}>
              {absenceTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
            </select>
          </label>
          <label>С<input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></label>
          <label>По<input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></label>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "end", marginTop: 12 }}>
          <label>
            Примечание
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Необязательно" />
          </label>
          <button className="primary-button" onClick={addAbsence} disabled={saving}>
            {saving ? "Сохранение..." : "Добавить"}
          </button>
        </div>
      </section>

      <section className="card">
        <div className="section-title">
          <div><h2>Список отсутствий</h2><p className="muted">Всего записей: {absences.length}</p></div>
        </div>
        {loading ? <p className="muted">Загрузка...</p> : absences.length === 0 ? (
          <p className="muted">Отсутствий пока нет.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="schedule-table">
              <thead><tr><th>Сотрудник</th><th>Вид</th><th>Период</th><th>Примечание</th><th></th></tr></thead>
              <tbody>
                {absences.map((absence) => (
                  <tr key={absence.id}>
                    <td>{employeeMap.get(absence.employee_id) ?? "Сотрудник не найден"}</td>
                    <td>{absenceTypes.find((item) => item.value === absence.absence_type)?.label ?? absence.absence_type}</td>
                    <td>{absence.date_from} — {absence.date_to}</td>
                    <td>{absence.note || "—"}</td>
                    <td><button className="secondary-button" onClick={() => removeAbsence(absence.id)}>Удалить</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Обозначения в графике</h2>
        <p className="muted" style={{ lineHeight: 1.7, marginBottom: 0 }}>
          <strong>О</strong> — отпуск, <strong>Б</strong> — больничный, <strong>В</strong> — другое отсутствие,
          <strong> П</strong> — прочее. При автоматическом формировании графика сотрудник не назначается на смену в период отсутствия.
        </p>
      </section>
    </main>
  );
}
