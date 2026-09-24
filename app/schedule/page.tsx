"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Brigade = { id: string; number: number; active: boolean; required_feldshers: number };
type WorkScheduleType = "24/3" | "day_night_2_off" | "8_17";
type Employee = {
  id: string; full_name: string; position: string; main_brigade_id: string | null;
  employment_start: string | null; employment_end: string | null;
  target_hours: number; can_extra_shifts: boolean; work_schedule_type: WorkScheduleType; active: boolean;
};
type Cell = "" | "24" | "12Д" | "12Н" | "8–17";
type Schedule = Record<string, Record<number, Cell>>;
type GeneratedShift = {
  employeeId: string;
  brigadeId: string;
  day: number;
  label: Exclude<Cell, "">;
  hours: number;
  startHour: number;
  endHour: number;
};

const scheduleTypeLabel: Record<WorkScheduleType, string> = {
  "24/3": "24 ч / 3 выходных",
  day_night_2_off: "день / ночь / 2 выходных",
  "8_17": "08:00–17:00"
};

function monthDays(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function makeEmptySchedule(employees: Employee[], days: number): Schedule {
  return Object.fromEntries(
    employees.map((employee) => [
      employee.id,
      Object.fromEntries(Array.from({ length: days }, (_, index) => [index + 1, ""]))
    ])
  ) as Schedule;
}

function isoDate(year: number, month: number, day: number) {
  const date = new Date(year, month, day);
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
}

function isEmployeeAvailable(employee: Employee, year: number, month: number, day: number) {
  const date = isoDate(year, month, day);
  if (employee.employment_start && date < employee.employment_start) return false;
  if (employee.employment_end && date > employee.employment_end) return false;
  return true;
}

function addDays(year: number, month: number, day: number, amount: number) {
  const date = new Date(year, month, day + amount);
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
}

function shiftTimes(year: number, month: number, shift: GeneratedShift) {
  const date = isoDate(year, month, shift.day);
  if (shift.label === "24") {
    return { start_at: date + "T08:00:00", end_at: addDays(year, month, shift.day, 1) + "T08:00:00" };
  }
  if (shift.label === "12Д") {
    return { start_at: date + "T08:00:00", end_at: date + "T20:00:00" };
  }
  if (shift.label === "12Н") {
    return { start_at: date + "T20:00:00", end_at: addDays(year, month, shift.day, 1) + "T08:00:00" };
  }
  return { start_at: date + "T08:00:00", end_at: date + "T17:00:00" };
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
        .select("id, full_name, position, main_brigade_id, employment_start, employment_end, target_hours, can_extra_shifts, work_schedule_type, active")
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

  function manualValues(employee: Employee): Cell[] {
    if (employee.work_schedule_type === "day_night_2_off") return ["", "12Д", "12Н"];
    if (employee.work_schedule_type === "8_17") return ["", "8–17"];
    return ["", "24"];
  }

  function changeCell(employee: Employee, day: number) {
    const values = manualValues(employee);
    setSchedule((current) => {
      const currentValue = current[employee.id]?.[day] ?? "";
      const index = values.indexOf(currentValue);
      const nextValue = values[(index + 1) % values.length];
      return {
        ...current,
        [employee.id]: { ...(current[employee.id] ?? {}), [day]: nextValue }
      };
    });
  }

  function clearSchedule() {
    setSchedule(makeEmptySchedule(employees, days));
    setVacancyCount(0);
    setMessage("");
    setError("");
  }

  function buildBaseShifts(): GeneratedShift[] {
    type Candidate = GeneratedShift & { mainBrigadeId: string };
    const candidates: Candidate[] = [];

    const employeesByBrigade = new Map<string, Employee[]>();
    for (const employee of employees) {
      if (!employee.main_brigade_id) continue;
      const list = employeesByBrigade.get(employee.main_brigade_id) ?? [];
      list.push(employee);
      employeesByBrigade.set(employee.main_brigade_id, list);
    }

    function desiredBaseShifts(employee: Employee, shiftHours: number) {
      if (employee.target_hours <= 0) return 0;
      return Math.max(1, Math.round(employee.target_hours / shiftHours));
    }

    // First create each employee's own base rhythm. The number of base shifts
    // is limited by the employee's target hours; the target is approximate,
    // not a hard ceiling.
    for (const brigade of brigades) {
      const brigadeEmployees = [...(employeesByBrigade.get(brigade.id) ?? [])]
        .sort((a, b) => a.full_name.localeCompare(b.full_name, "ru"));

      const byType: Record<WorkScheduleType, Employee[]> = {
        "24/3": brigadeEmployees.filter((employee) => employee.work_schedule_type === "24/3"),
        day_night_2_off: brigadeEmployees.filter((employee) => employee.work_schedule_type === "day_night_2_off"),
        "8_17": brigadeEmployees.filter((employee) => employee.work_schedule_type === "8_17")
      };

      for (const employee of byType["24/3"]) {
        const index = byType["24/3"].indexOf(employee);
        const phase = index % 4;
        const wanted = desiredBaseShifts(employee, 24);
        let produced = 0;

        for (let day = 1; day <= days && produced < wanted; day += 1) {
          if ((day - 1) % 4 !== phase || !isEmployeeAvailable(employee, year, month, day)) continue;
          candidates.push({
            employeeId: employee.id,
            brigadeId: brigade.id,
            mainBrigadeId: brigade.id,
            day,
            label: "24",
            hours: 24,
            startHour: 8,
            endHour: 8
          });
          produced += 1;
        }
      }

      for (const employee of byType.day_night_2_off) {
        const index = byType.day_night_2_off.indexOf(employee);
        const phase = index % 4;
        const wanted = desiredBaseShifts(employee, 12);
        let produced = 0;

        for (let day = 1; day <= days && produced < wanted; day += 1) {
          if (!isEmployeeAvailable(employee, year, month, day)) continue;
          const cycleDay = (day - 1 - phase + 400) % 4;

          if (cycleDay === 0) {
            candidates.push({
              employeeId: employee.id,
              brigadeId: brigade.id,
              mainBrigadeId: brigade.id,
              day,
              label: "12Д",
              hours: 12,
              startHour: 8,
              endHour: 20
            });
            produced += 1;
          } else if (cycleDay === 1) {
            candidates.push({
              employeeId: employee.id,
              brigadeId: brigade.id,
              mainBrigadeId: brigade.id,
              day,
              label: "12Н",
              hours: 12,
              startHour: 20,
              endHour: 8
            });
            produced += 1;
          }
        }
      }

      for (const employee of byType["8_17"]) {
        // The 08:00–17:00 employee keeps a weekday daytime rhythm.
        for (let day = 1; day <= days; day += 1) {
          const weekday = new Date(year, month, day).getDay();
          if (weekday === 0 || weekday === 6 || !isEmployeeAvailable(employee, year, month, day)) continue;
          candidates.push({
            employeeId: employee.id,
            brigadeId: brigade.id,
            mainBrigadeId: brigade.id,
            day,
            label: "8–17",
            hours: 9,
            startHour: 8,
            endHour: 17
          });
        }
      }
    }

    // Now place those base shifts into actual brigade positions.
    // Main brigade is preferred, but it is not absolute: if it is already
    // full, the shift is temporarily placed into another brigade with a vacancy.
    const coverage = new Map<string, number>();
    const assignedByEmployeeDay = new Set<string>();
    const result: GeneratedShift[] = [];

    const brigadeOrder = [...brigades].sort((a, b) => a.number - b.number);

    for (let day = 1; day <= days; day += 1) {
      const dayCandidates = candidates
        .filter((candidate) => candidate.day === day)
        .sort((a, b) => {
          if (a.mainBrigadeId === b.mainBrigadeId) return a.employeeId.localeCompare(b.employeeId);
          return a.mainBrigadeId.localeCompare(b.mainBrigadeId);
        });

      for (const candidate of dayCandidates) {
        const employeeDayKey = candidate.employeeId + ":" + candidate.day;
        if (assignedByEmployeeDay.has(employeeDayKey)) continue;

        const mainBrigade = brigadeOrder.find((brigade) => brigade.id === candidate.mainBrigadeId);
        const preferred = mainBrigade ? [mainBrigade, ...brigadeOrder.filter((brigade) => brigade.id !== mainBrigade.id)] : brigadeOrder;

        const target = preferred.find((brigade) => {
          const used = coverage.get(brigade.id + ":" + day) ?? 0;
          return used < brigade.required_feldshers;
        });

        if (!target) {
          // The base rhythm still exists, but there is no free required
          // position today. Do not create a fourth/extra position just to
          // keep the employee's main brigade.
          continue;
        }

        result.push({ ...candidate, brigadeId: target.id });
        coverage.set(target.id + ":" + day, (coverage.get(target.id + ":" + day) ?? 0) + 1);
        assignedByEmployeeDay.add(employeeDayKey);
      }
    }

    return result;
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

    const baseShifts = buildBaseShifts();
    const generated = makeEmptySchedule(employees, days);

    for (const shift of baseShifts) {
      generated[shift.employeeId][shift.day] = shift.label;
    }

    const coverage = new Map<string, number>();
    for (const item of baseShifts) {
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

    const shiftRows = baseShifts.map((item) => {
      const times = shiftTimes(year, month, item);
      return {
        schedule_id: scheduleId,
        brigade_id: item.brigadeId,
        shift_date: isoDate(year, month, item.day),
        shift_type: "base",
        start_at: times.start_at,
        end_at: times.end_at,
        required_hours: item.hours,
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
        employee_id: baseShifts[index].employeeId,
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
      reason: "Первичное формирование базовых режимов сотрудников",
      snapshot: {
        year,
        month: month + 1,
        shift_count: baseShifts.length,
        vacancy_count: vacancies,
        rules: ["24/3", "day_night_2_off", "8_17"],
        extra_shifts_enabled: false
      }
    });

    await supabase.from("audit_logs").insert({
      schedule_id: scheduleId,
      action_type: "schedule_generated",
      entity_type: "schedule",
      entity_id: scheduleId,
      details: {
        mode: "A",
        base_schedule_types: ["24/3", "day_night_2_off", "8_17"],
        shift_count: baseShifts.length,
        vacancy_count: vacancies,
        extra_shifts_used: false
      }
    });

    setSchedule(generated);
    setVacancyCount(vacancies);
    setMessage("Базовый график сформирован: " + baseShifts.length + " смен. Незаполненных позиций: " + vacancies + ". Дополнительные смены пока не назначаются.");
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
          <p className="muted">Базовые режимы: 24/3, день/ночь/2 выходных и 08:00–17:00.</p>
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
              Базовые смены: 24 — сутки, 12Д — день, 12Н — ночь, 8–17 — дневная смена.
              Нажатие на ячейку циклически меняет смену для ручной корректировки.
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
                  <th className="hours-head">Основной график</th>
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
                    <td className="hours-cell">{scheduleTypeLabel[employee.work_schedule_type || "24/3"]}</td>
                    {Array.from({ length: days }, (_, index) => {
                      const day = index + 1;
                      const value = schedule[employee.id]?.[day] ?? "";
                      return (
                        <td key={day}>
                          <button
                            className={"shift-cell shift-" + (value === "24" ? "24" : value ? "12" : "empty")}
                            onClick={() => changeCell(employee, day)}
                            aria-label={employee.full_name + ", день " + day}
                          >
                            {value}
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
        <h2>Текущий этап алгоритма</h2>
        <p className="muted" style={{ lineHeight: 1.6, marginBottom: 0 }}>
          Сейчас формируется только основной режим каждого сотрудника. Дополнительные 12- и 24-часовые
          смены не назначаются автоматически, даже если сотрудник разрешил подработку. На следующем этапе
          программа будет закрывать оставшиеся вакансии, используя только подходящих сотрудников и проверяя
          их норму, отдых и допустимость переходов между сменами.
        </p>
      </section>
    </main>
  );
}
