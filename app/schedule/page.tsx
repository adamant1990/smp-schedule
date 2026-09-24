"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Brigade = { id: string; number: number; active: boolean };
type Employee = {
  id: string;
  full_name: string;
  position: string;
  main_brigade_id: string | null;
  target_hours: number;
  active: boolean;
};

type Cell = "" | "24" | "8-20" | "20-8";
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

export default function SchedulePage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [brigades, setBrigades] = useState<Brigade[]>([]);
  const [schedule, setSchedule] = useState<Schedule>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
      supabase
        .from("employees")
        .select("id, full_name, position, main_brigade_id, target_hours, active")
        .eq("active", true)
        .order("full_name"),
      supabase.from("brigades").select("id, number, active").eq("active", true).order("number")
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
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

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
      const currentValue = values[day] ?? "";
      const sequence: Cell[] = ["", "24", "8-20", "20-8"];
      const nextValue = sequence[(sequence.indexOf(currentValue) + 1) % sequence.length];
      return { ...current, [employeeId]: { ...values, [day]: nextValue } };
    });
  }

  function clearSchedule() {
    setSchedule(makeEmptySchedule(employees, days));
  }

  const totalAssigned = employees.reduce(
    (sum, employee) =>
      sum + Object.values(schedule[employee.id] ?? {}).filter(Boolean).length,
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
          <p className="muted">Основа месячного графика: сотрудники, бригады и календарные дни.</p>
        </div>
        <a className="secondary-button" href="/">← Главное меню</a>
      </header>

      <section className="card schedule-toolbar">
        <div>
          <label>Месяц
            <input
              type="month"
              value={`${year}-${String(month + 1).padStart(2, "0")}`}
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
          <button className="primary-button" disabled>Сформировать график</button>
        </div>
        <div className="schedule-summary">
          <strong>{monthTitle}</strong>
          <span>Сотрудников: {employees.length}</span>
          <span>Назначено смен: {totalAssigned}</span>
        </div>
      </section>

      {error && <div className="error-box">{error}</div>}

      <section className="card schedule-card">
        <div className="section-title">
          <div>
            <h2>Месячная таблица</h2>
            <p className="muted schedule-hint">Нажмите на ячейку несколько раз, чтобы переключить: пусто → 24 → 8–20 → 20–8.</p>
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
                    <td className="sticky-name"><strong>{employee.full_name}</strong><small>{employee.position}</small></td>
                    <td className="brigade-cell">{employee.main_brigade_id ? brigadeMap.get(employee.main_brigade_id) ?? "—" : "—"}</td>
                    <td className="hours-cell">{employee.target_hours ?? 0}</td>
                    {Array.from({ length: days }, (_, index) => {
                      const day = index + 1;
                      const value = schedule[employee.id]?.[day] ?? "";
                      return (
                        <td key={day}>
                          <button
                            className={`shift-cell shift-${value.replace("-", "")}`}
                            onClick={() => changeCell(employee.id, day)}
                            aria-label={`${employee.full_name}, день ${day}`}
                          >
                            {value === "24" ? "24" : value === "8-20" ? "8–20" : value === "20-8" ? "20–8" : ""}
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
        <h2>Пока это ручная основа</h2>
        <p className="muted" style={{ lineHeight: 1.6, marginBottom: 0 }}>
          На этом этапе таблица показывает реальные импортированные данные сотрудников,
          их основные бригады и нормы времени. Автоматический алгоритм 24 часа → 3 дня отдыха,
          закрытие вакансий, балансировку часов и учёт отсутствий подключим следующим этапом.
        </p>
      </section>
    </main>
  );
}
