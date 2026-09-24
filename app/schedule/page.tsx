"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Brigade = { id: string; number: number; active: boolean; required_feldshers: number };
type Employee = {
  id: string; full_name: string; position: string; main_brigade_id: string | null;
  employment_start: string | null; employment_end: string | null;
  target_hours: number; active: boolean;
};
type Cell = "" | "24";
type Schedule = Record<string, Record<number, Cell>>;

function monthDays(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function makeEmptySchedule(employees: Employee[], days: number): Schedule {
  return Object.fromEntries(
    employees.map((employee) => [
      employee.id,
      Object.fromEntries(Array.from({ length: days }, (_, index) => [index + 1, ""]))
    ])
  );
}

function isEmployeeAvailable(employee: Employee, year: number, month: number, day: number) {
  const date = String(year) + "-" + String(month + 1).padStart(2, "0") + "-" + String(day).padStart(2, "0");
  if (employee.employment_start && date < employee.employment_start) return false;
  if (employee.employment_end && date > employee.employment_end) return false;
  return true;
}

export default function SchedulePage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [brigades, setBrigades] = useState<Brigade[]>([]);
  const [schedule, setSchedule] = useState<Schedule>({});
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [vacancyCount, setVacancyCount] = useState(0);

  const days = monthDays(year, month);
  const brigadeMap = useMemo(
    () => new Map(brigades.map((brigade) => [brigade.id, brigade.number])),
    [brigades]
  );

  async function load() {
    setLoading(true);
    setError("");
    const supabase = createClient();

    const [employeesResult, brigadesResult] = await Promise.all([
      supabase.from("employees")
        .select("id, full_name, position, main_brigade_id, employment_start, employment_end, target_hours, active")
        .eq("active", true).order("full_name"),
      supabase.from("brigades")
        .select("id, number, active, required_feldshers")
        .eq("active", true).order("number")
    ]);

    if (employeesResult.error || brigadesResult.error) {
      setError(employeesResult.error?.message || brigadesResult.error?.message || "Ошибка загрузки");
      setLoading(false);
      return;
    }

    const loadedEmployees = (employeesResult.data ?? []) as Employee[];
    setEmployees(loadedEmployees);
    setBrigades((brigadesResult.data ?? []) as Brigade[]);
    setSchedule(makeEmptySchedule(loadedEmployees, days));
    setVacancyCount(0);
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  useEffect(() => {
    setSchedule((current) => {
      const next: Schedule = {};
      for (const employee of employees) {
        next[employee.id] = {};
        for (let day = 1; day <= days; day += 1) {
          next[employee.id][day] = current[employee.id]?.[day] ?? "";
        }
      }
      return next;
    });
  }, [year, month, days, employees]);

  function changeCell(employeeId: string, day: number) {
    setSchedule((current) => {
      const values = { ...(current[employeeId] ?? {}) };
      values[day] = values[day] === "24" ? "" : "24";
      return { ...current, [employeeId]: values };
    });
  }

  function clearSchedule() {
    setSchedule(makeEmptySchedule(employees, days));
    setVacancyCount(0);
    setMessage("");
    setError("");
  }

  async function generateBaseSchedule() {
    if (generating || employees.length === 0) return;

    setGenerating(true);
    setError("");
    setMessage("");

    const supabase = createClient();
    const existing = await supabase.from("schedules").select("id")
      .eq("year", year).eq("month", month + 1).limit(1);

    if (existing.error) {
      setError(existing.error.message);
      setGenerating(false);
      return;
    }

    if (existing.data && existing.data.length > 0) {
      setError("На этот месяц график уже существует. Полный пересчёт добавим следующим этапом, чтобы не удалять готовый график автоматически.");
      setGenerating(false);
      return;
    }

    const generated = makeEmptySchedule(employees, days);
    const shiftsToCreate: Array<{ employeeId: string; brigadeId: string; day: number }> = [];
    const employeesByBrigade = new Map<string, Employee[]>();

    for (const employee of employees) {
      if (!employee.main_brigade_id) continue;
      const list = employeesByBrigade.get(employee.main_brigade_id) ?? [];
      list.push(employee);
      employeesByBrigade.set(employee.main_brigade_id, list);
    }

    for (const brigade of brigades) {
      const brigadeEmployees = [...(employeesByBrigade.get(brigade.id) ?? [])]
        .sort((a, b) => a.full_name.localeCompare(b.full_name, "ru"));

      brigadeEmployees.forEach((employee, index) => {
        const phase = index % 4;

        for (let day = 1; day <= days; day += 1) {
          if ((day - 1) % 4 !== phase) continue;
          if (!isEmployeeAvailable(employee, year, month, day)) continue;

          generated[employee.id][day] = "24";
          shiftsToCreate.push({ employeeId: employee.id, brigadeId: brigade.id, day });
        }
      });
    }

    const coverage = new Map<string, number>();
    for (const item of shiftsToCreate) {
      const key = item.brigadeId + ":" + item.day;
      coverage.set(key, (coverage.get(key) ?? 0) + 1);
    }

    let vacancies = 0;
    for (const brigade of brigades) {
      for (let day = 1; day <= days; day += 1) {
        const assigned = coverage.get(brigade.id + ":" + day) ?? 0;
        vacancies += Math.max(0, brigade.required_feldshers - assigned);
      }
    }

    const scheduleInsert = await supabase.from("schedules").insert({
      year, month: month + 1, status: "generated", planning_mode: "A", preserve_fixed_shifts: true
    }).select("id").single();

    if (scheduleInsert.error || !scheduleInsert.data) {
      setError(scheduleInsert.error?.message || "Не удалось создать график");
      setGenerating(false);
      return;
    }

    const scheduleId = scheduleInsert.data.id;

    const shiftRows = shiftsToCreate.map((item) => {
      const date = String(year) + "-" + String(month + 1).padStart(2, "0") + "-" + String(item.day).padStart(2, "0");
      return {
        schedule_id: scheduleId,
        brigade_id: item.brigadeId,
        shift_date: date,
        shift_type: "base",
        start_at: date + "T08:00:00",
        end_at: date + "T08:00:00",
        required_hours: 24,
        is_fixed: false,
        is_vacancy: false
      };
    });

    if (shiftRows.length > 0) {
      const shiftsInsert = await supabase.from("shifts").insert(shiftRows).select("id");

      if (shiftsInsert.error || !shiftsInsert.data) {
        await supabase.from("schedules").delete().eq("id", scheduleId);
        setError(shiftsInsert.error?.message || "Не удалось сохранить смены");
        setGenerating(false);
        return;
      }

      const assignments = shiftsInsert.data.map((shift, index) => ({
        shift_id: shift.id,
        employee_id: shiftsToCreate[index].employeeId,
        assignment_status: "assigned",
        is_user_fixed: false
      }));

      const assignmentsInsert = await supabase.from("shift_assignments").insert(assignments);

      if (assignmentsInsert.error) {
        await supabase.from("shifts").delete().eq("schedule_id", scheduleId);
        await supabase.from("schedules").delete().eq("id", scheduleId);
        setError(assignmentsInsert.error.message);
        setGenerating(false);
        return;
      }
    }

    await supabase.from("schedule_versions").insert({
      schedule_id: scheduleId,
      version_number: 1,
      reason: "Первичное формирование базового цикла 24 часа через 3 дня",
      snapshot: {
        year,
        month: month + 1,
        shift_count: shiftsToCreate.length,
        vacancy_count: vacancies
      }
    });

    await supabase.from("audit_logs").insert({
      schedule_id: scheduleId,
      action_type: "schedule_generated",
      entity_type: "schedule",
      entity_id: scheduleId,
      details: {
        mode: "A",
        base_cycle: "24h_every_4th_day",
        shift_count: shiftsToCreate.length,
        vacancy_count: vacancies
      }
    });

    setSchedule(generated);
    setVacancyCount(vacancies);
    setMessage("Базовый график сформирован: " + shiftsToCreate.length + " смен. Незаполненных позиций: " + vacancies + ".");
    setGenerating(false);
  }

  const totalAssigned = employees.reduce(
    (sum, employee) => sum + Object.values(schedule[employee.id] ?? {}).filter(Boolean).length,
    0
  );

  const monthTitle = new Intl.DateTimeFormat("ru-RU", {
    month: "long",
    year: "numeric"
  }).format(new Date(year, month, 1));

  return (
    <main className="page">
      <header className="topbar">
        <div>
          <div className="eyebrow">СМП • ПЛАНИРОВАНИЕ</div>
          <h1>График фельдшеров</h1>
          <p className="muted">Базовый цикл: 24 часа → 3 дня отдыха.</p>
        </div>
        <a className="secondary-button" href="/">← Главное меню</a>
      </header>

      <section className="card schedule-toolbar">
        <div>
          <label>Месяц
            <input
              type="month"
              value={String(year) + "-" + String(month + 1).padStart(2, "0")}
              onChange={(event) => {
                const [nextYear, nextMonth] = event.target.value.split("-").map(Number);
                setYear(nextYear);
                setMonth(nextMonth - 1);
              }}
            />
          </label>
        </div>

        <div className="schedule-actions">
          <button className="secondary-button" onClick={clearSchedule}>Очистить</button>
          <button className="primary-button" onClick={generateBaseSchedule}
            disabled={generating || loading || employees.length === 0}>
            {generating ? "Формирование..." : "Сформировать базовый график"}
          </button>
        </div>

        <div className="schedule-summary">
          <strong>{monthTitle}</strong>
          <span>Сотрудников: {employees.length}</span>
          <span>Смен: {totalAssigned}</span>
          {vacancyCount > 0 && <span className="warning-text">Вакансий: {vacancyCount}</span>}
        </div>
      </section>

      {message && <div className="success-box">{message}</div>}
      {error && <div className="error-box">{error}</div>}

      <section className="card schedule-card">
        <div className="section-title">
          <div>
            <h2>Месячная таблица</h2>
            <p className="muted schedule-hint">
              Базовые смены отмечены как 24. Нажмите на ячейку для ручного добавления или удаления базовой смены.
            </p>
          </div>
        </div>

        {loading ? <p className="muted">Загрузка сотрудников...</p> : employees.length === 0 ? (
          <p className="muted">Активных сотрудников пока нет.</p>
        ) : (
          <div className="schedule-table-wrap">
            <table className="schedule-table">
              <thead>
                <tr>
                  <th className="sticky-name">ФИО</th>
                  <th className="brigade-head">Бригада</th>
                  <th className="hours-head">Норма</th>
                  {Array.from({ length: days }, (_, index) => <th key={index + 1}>{index + 1}</th>)}
                </tr>
              </thead>
              <tbody>
                {employees.map((employee) => (
                  <tr key={employee.id}>
                    <td className="sticky-name">
                      <strong>{employee.full_name}</strong>
                      <small>{employee.position}</small>
                    </td>
                    <td className="brigade-cell">
                      {employee.main_brigade_id ? brigadeMap.get(employee.main_brigade_id) ?? "—" : "—"}
                    </td>
                    <td className="hours-cell">{employee.target_hours ?? 0}</td>
                    {Array.from({ length: days }, (_, index) => {
                      const day = index + 1;
                      const value = schedule[employee.id]?.[day] ?? "";
                      return (
                        <td key={day}>
                          <button
                            className={"shift-cell shift-" + (value === "24" ? "24" : "empty")}
                            onClick={() => changeCell(employee.id, day)}
                            aria-label={employee.full_name + ", день " + day}
                          >
                            {value === "24" ? "24" : ""}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Что делает первый алгоритм</h2>
        <p className="muted" style={{ lineHeight: 1.6, marginBottom: 0 }}>
          Каждый активный сотрудник с основной бригадой получает базовый цикл 24 часа
          через каждые 4 дня. Цикл распределяется по четырём фазам внутри каждой бригады.
          Учитываются даты начала и окончания работы. Вакансии пока не закрываются дополнительными
          сменами — это следующий этап алгоритма.
        </p>
      </section>
    </main>
  );
}
