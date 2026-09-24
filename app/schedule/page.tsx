"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ExcelJS from "exceljs";
import { createClient } from "@/lib/supabase/client";
import {
  absenceKind,
  analyzeManualSchedule,
  generateSchedule,
  type Absence,
  type AssistantIssue,
  type Brigade,
  type Employee,
  type PlanningMode,
  type ScheduleCell,
  type ShiftLabel,
  shiftTimes,
} from "@/lib/schedule-engine";

type Schedule = Record<string, Record<number, string>>;

const scheduleTypeLabel = {
  "24/3": "24 ч / 3 выходных",
  day_night_2_off: "день / ночь / 2 выходных",
  "8_17": "08:00–17:00",
} as const;

function monthDays(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function makeEmptySchedule(employees: Employee[], days: number): Schedule {
  return Object.fromEntries(
    employees.map((employee) => [
      employee.id,
      Object.fromEntries(Array.from({ length: days }, (_, i) => [i + 1, ""])),
    ])
  ) as Schedule;
}

function cellsToSchedule(
  employees: Employee[],
  cells: Record<string, Record<number, ScheduleCell>>,
  days: number
): Schedule {
  const schedule = makeEmptySchedule(employees, days);
  for (const employee of employees) {
    for (let day = 1; day <= days; day++) {
      schedule[employee.id][day] = cells[employee.id]?.[day]?.label ?? "";
    }
  }
  return schedule;
}

export default function SchedulePage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [mode, setMode] = useState<PlanningMode>("A");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [brigades, setBrigades] = useState<Brigade[]>([]);
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [schedule, setSchedule] = useState<Schedule>({});
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [vacancyCount, setVacancyCount] = useState(0);
  const [filledVacancyCount, setFilledVacancyCount] = useState(0);
  const [unfilledVacancyCount, setUnfilledVacancyCount] = useState(0);
  const [generationReasons, setGenerationReasons] = useState<string[]>([]);
  const [vacationEmployeeId, setVacationEmployeeId] = useState("");
  const [vacationFrom, setVacationFrom] = useState("");
  const [vacationTo, setVacationTo] = useState("");
  const [vacationSaving, setVacationSaving] = useState(false);
  const [assistantIssues, setAssistantIssues] = useState<AssistantIssue[]>([]);
  const [assistantChecked, setAssistantChecked] = useState(false);
  const [importingExcel, setImportingExcel] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const days = monthDays(year, month);
  const brigadeMap = useMemo(
    () => new Map(brigades.map((brigade) => [brigade.id, brigade.number])),
    [brigades]
  );

  async function load() {
    setLoading(true);
    setError("");
    const supabase = createClient();

    const [employeesResult, brigadesResult, absencesResult] = await Promise.all([
      supabase
        .from("employees")
        .select(
          "id, full_name, position, main_brigade_id, employment_start, employment_end, target_hours, can_extra_shifts, work_schedule_type, active"
        )
        .eq("active", true)
        .order("full_name"),
      supabase
        .from("brigades")
        .select("id, number, active, required_feldshers")
        .eq("active", true)
        .order("number"),
      supabase
        .from("employee_absences")
        .select("id, employee_id, absence_type, date_from, date_to")
        .lte("date_from", new Date(year, month + 1, 0).toISOString().slice(0, 10))
        .gte("date_to", new Date(year, month, 1).toISOString().slice(0, 10)),
    ]);

    if (employeesResult.error || brigadesResult.error || absencesResult.error) {
      setError(
        employeesResult.error?.message ||
          brigadesResult.error?.message ||
          absencesResult.error?.message ||
          "Ошибка загрузки"
      );
      setLoading(false);
      return;
    }

    const loadedEmployees = (employeesResult.data ?? []) as Employee[];
    setEmployees(loadedEmployees);
    setBrigades((brigadesResult.data ?? []) as Brigade[]);
    setAbsences((absencesResult.data ?? []) as Absence[]);
    setSchedule(makeEmptySchedule(loadedEmployees, days));
    setVacancyCount(0);
    setFilledVacancyCount(0);
    setUnfilledVacancyCount(0);
    setGenerationReasons([]);
    setAssistantIssues([]);
    setAssistantChecked(false);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [year, month]);

  async function addVacation() {
    if (!vacationEmployeeId || !vacationFrom || !vacationTo) {
      setError("Для отпуска выберите сотрудника и укажите обе даты.");
      return;
    }
    if (vacationFrom > vacationTo) {
      setError("Дата начала отпуска не может быть позже даты окончания.");
      return;
    }

    const employee = employees.find((item) => item.id === vacationEmployeeId);
    if (!employee) return;

    const overlapsExisting = absences.some(
      (a) =>
        a.employee_id === vacationEmployeeId &&
        absenceKind(a.absence_type) === "vacation" &&
        a.date_from <= vacationTo &&
        a.date_to >= vacationFrom
    );
    if (overlapsExisting) {
      setError("У этого сотрудника уже есть пересекающийся отпуск.");
      return;
    }

    setVacationSaving(true);
    setError("");
    const supabase = createClient();
    const result = await supabase.from("employee_absences").insert({
      employee_id: employee.id,
      absence_type: "vacation",
      date_from: vacationFrom,
      date_to: vacationTo,
    }).select("id, employee_id, absence_type, date_from, date_to").single();

    if (result.error || !result.data) {
      setError(result.error?.message || "Не удалось сохранить отпуск.");
      setVacationSaving(false);
      return;
    }

    setAbsences((current) => [...current, result.data as Absence].sort((a, b) => a.date_from.localeCompare(b.date_from)));
    setVacationFrom("");
    setVacationTo("");
    setMessage("Отпуск сохранён. При следующем формировании графика эти дни будут исключены из работы сотрудника.");
    setVacationSaving(false);
  }

  async function removeVacation(id: string) {
    const supabase = createClient();
    const result = await supabase.from("employee_absences").delete().eq("id", id);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    setAbsences((current) => current.filter((item) => item.id !== id));
    setMessage("Отпуск удалён.");
  }

  useEffect(() => {
    setSchedule((current) => {
      const next = makeEmptySchedule(employees, days);
      for (const employee of employees) {
        for (let day = 1; day <= days; day++) {
          next[employee.id][day] = current[employee.id]?.[day] ?? "";
        }
      }
      return next;
    });
  }, [employees, days]);

  const manualShiftOptions: Array<{ value: ShiftLabel | ""; label: string }> = [
    { value: "", label: "—" },
    { value: "12Д", label: "12Д" },
    { value: "12Н", label: "12Н" },
    { value: "24", label: "24" },
    { value: "8–17", label: "8–17" },
  ];

  function changeCell(employee: Employee, day: number, value: string) {
    setSchedule((current) => ({
      ...current,
      [employee.id]: {
        ...(current[employee.id] ?? {}),
        [day]: value,
      },
    }));
    setAssistantChecked(false);
    setAssistantIssues([]);
  }

  function normalizeImportName(value: unknown) {
    return String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/\\s+/g, " ");
  }

  function parseImportedShift(value: unknown): string {
    const raw = String(value ?? "").trim().toUpperCase().replace(/–/g, "-");
    if (!raw) return "";
    if (raw === "В" || raw === "О" || raw === "ВЫХ" || raw === "ВЫХОДНОЙ") return raw === "В" ? "В" : "";
    if (raw === "24" || raw.includes("24 Ч") || raw.includes("24Ч")) return "24";
    if (raw === "12Д" || raw === "12 Д" || raw === "8-20" || raw === "08-20" || raw.includes("08:00-20:00")) return "12Д";
    if (raw === "12Н" || raw === "12 Н" || raw === "20-8" || raw === "20-08" || raw.includes("20:00-08:00")) return "12Н";
    if (raw === "8-17" || raw === "08-17" || raw === "08:00-17:00" || raw === "8–17") return "8–17";
    return raw;
  }

  async function importExcelSchedule(file: File) {
    setImportingExcel(true);
    setError("");
    setMessage("");

    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await file.arrayBuffer());

      const worksheet = workbook.worksheets[0];
      if (!worksheet) throw new Error("В Excel-файле нет листов.");

      let headerRow = 0;
      let nameColumn = 0;
      const dayColumns = new Map<number, number>();

      for (let rowNumber = 1; rowNumber <= Math.min(15, worksheet.rowCount); rowNumber++) {
        const row = worksheet.getRow(rowNumber);
        let candidateNameColumn = 0;
        const candidateDays = new Map<number, number>();

        row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
          const text = String(cell.text ?? cell.value ?? "").trim();
          const normalized = normalizeImportName(text);
          if (!candidateNameColumn && (normalized === "фио" || normalized.includes("ф.и.о") || normalized === "сотрудник" || normalized === "фельдшер")) {
            candidateNameColumn = columnNumber;
          }
          const day = Number(text);
          if (Number.isInteger(day) && day >= 1 && day <= days) {
            candidateDays.set(day, columnNumber);
          }
        });

        if (candidateNameColumn && candidateDays.size >= Math.min(5, days)) {
          headerRow = rowNumber;
          nameColumn = candidateNameColumn;
          for (const [day, column] of candidateDays) dayColumns.set(day, column);
          break;
        }
      }

      if (!headerRow || !nameColumn || dayColumns.size === 0) {
        throw new Error("Не удалось определить таблицу графика. Нужна строка с заголовком «ФИО» и столбцами дней 1, 2, 3...");
      }

      const employeeByName = new Map(
        employees.map((employee) => [normalizeImportName(employee.full_name), employee])
      );
      const nextSchedule = makeEmptySchedule(employees, days);
      let importedRows = 0;
      let matchedRows = 0;
      const unmatched: string[] = [];
      const invalidCells: string[] = [];

      for (let rowNumber = headerRow + 1; rowNumber <= worksheet.rowCount; rowNumber++) {
        const row = worksheet.getRow(rowNumber);
        const name = String(row.getCell(nameColumn).text ?? row.getCell(nameColumn).value ?? "").trim();
        if (!name) continue;
        importedRows++;

        const employee = employeeByName.get(normalizeImportName(name));
        if (!employee) {
          unmatched.push(name);
          continue;
        }

        matchedRows++;
        for (const [day, column] of dayColumns) {
          const value = parseImportedShift(row.getCell(column).text ?? row.getCell(column).value);
          if (value === "В") {
            nextSchedule[employee.id][day] = "В";
          } else if (value === "" || value === "О") {
            nextSchedule[employee.id][day] = "";
          } else if (["12Д", "12Н", "24", "8–17"].includes(value)) {
            nextSchedule[employee.id][day] = value;
          } else {
            invalidCells.push(name + ", день " + day + ": «" + value + "»");
          }
        }
      }

      if (!matchedRows) {
        throw new Error("Ни один сотрудник из Excel не найден в списке сотрудников приложения.");
      }

      setSchedule(nextSchedule);
      setAssistantChecked(false);
      setAssistantIssues([]);
      setGenerationReasons([]);

      const parts = [
        "Excel загружен: сопоставлено " + matchedRows + " из " + importedRows + " строк."
      ];
      if (unmatched.length) parts.push("Не найдены: " + unmatched.slice(0, 5).join(", ") + (unmatched.length > 5 ? " и ещё " + (unmatched.length - 5) : "") + ".");
      if (invalidCells.length) parts.push("Не распознано ячеек: " + invalidCells.length + ".");
      setMessage(parts.join(" "));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить Excel-файл.");
    } finally {
      setImportingExcel(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function handleExcelFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void importExcelSchedule(file);
  }

  function clearSchedule() {
    setSchedule(makeEmptySchedule(employees, days));
    setVacancyCount(0);
    setFilledVacancyCount(0);
    setUnfilledVacancyCount(0);
    setGenerationReasons([]);
    setAssistantIssues([]);
    setAssistantChecked(false);
    setMessage("");
    setError("");
  }

  function checkScheduleWithAssistant() {
    setError("");
    setMessage("");
    const result = analyzeManualSchedule(schedule, employees, brigades, absences, year, month);
    setAssistantIssues(result.issues);
    setAssistantChecked(true);

    if (result.issues.length === 0) {
      setMessage("График проверен: дыр по укомплектованности нет.");
    } else {
      setMessage(
        "Ассистент нашёл " +
        result.issues.reduce((sum, issue) => sum + issue.missing, 0) +
        " незакрытых мест. Ни одна уже установленная смена не изменена."
      );
    }
  }

  function applyAssistantCandidate(issue: AssistantIssue, employeeId: string) {
    const label = issue.period === "day" ? "12Д" : "12Н";
    setSchedule((current) => ({
      ...current,
      [employeeId]: {
        ...(current[employeeId] ?? {}),
        [issue.day]: label,
      },
    }));
    setAssistantIssues((current) =>
      current.map((item) =>
        item.day === issue.day &&
        item.brigadeId === issue.brigadeId &&
        item.period === issue.period
          ? { ...item, missing: Math.max(0, item.missing - 1), candidates: item.candidates.filter(c => c.employeeId !== employeeId) }
          : item
      ).filter(item => item.missing > 0)
    );
    setAssistantChecked(true);
    setMessage("Смена добавлена вручную. Базовый график остальных сотрудников не изменён.");
  }

    async function generateBaseSchedule() {
    if (generating || employees.length === 0) return;

    setGenerating(true);
    setError("");
    setMessage("");
    setGenerationReasons([]);

    const supabase = createClient();
    const existing = await supabase
      .from("schedules")
      .select("id")
      .eq("year", year)
      .eq("month", month + 1)
      .limit(1);

    if (existing.error) {
      setError(existing.error.message);
      setGenerating(false);
      return;
    }

    if (existing.data && existing.data.length > 0) {
      setError(
        "На этот месяц график уже существует. Он не будет автоматически перезаписан. Откройте существующий график для редактирования."
      );
      setGenerating(false);
      return;
    }

    const result = generateSchedule(employees, brigades, absences, year, month, mode);

    if (!result.staffingValid) {
      setError(
        "График не сохранён: не выполнены жёсткие требования. " +
        "В каждой смене должно быть ровно 13 фельдшеров (5 бригад по 2 и 3 бригады по 1), " +
        "а также должны соблюдаться доступность сотрудников и месячные нормы часов."
      );
      setGenerationReasons(result.reasons);
      setSchedule(cellsToSchedule(employees, result.cells, days));
      setVacancyCount(result.vacancyCount);
      setFilledVacancyCount(result.filledVacancyCount);
      setUnfilledVacancyCount(result.unfilledVacancyCount);
      setGenerating(false);
      return;
    }

    const scheduleInsert = await supabase
      .from("schedules")
      .insert({
        year,
        month: month + 1,
        status: "generated",
        planning_mode: mode,
        preserve_fixed_shifts: true,
      })
      .select("id")
      .single();

    if (scheduleInsert.error || !scheduleInsert.data) {
      setError(scheduleInsert.error?.message || "Не удалось создать график");
      setGenerating(false);
      return;
    }

    const scheduleId = scheduleInsert.data.id;

    const shiftRows = result.shifts.map((shift) => {
      const times = shiftTimes(year, month, shift.day, shift.label);
      return {
        schedule_id: scheduleId,
        brigade_id: shift.brigadeId,
        shift_date: new Date(year, month, shift.day).toISOString().slice(0, 10),
        shift_type: shift.shiftType,
        start_at: times.start_at,
        end_at: times.end_at,
        required_hours: shift.hours,
        is_fixed: false,
        is_vacancy: shift.isVacancy,
        note: shift.note ?? null,
      };
    });

    const shiftsResult =
      shiftRows.length > 0
        ? await supabase.from("shifts").insert(shiftRows).select("id")
        : { data: [], error: null };

    if (shiftsResult.error || !shiftsResult.data) {
      await supabase.from("schedules").delete().eq("id", scheduleId);
      setError(shiftsResult.error?.message || "Не удалось сохранить смены");
      setGenerating(false);
      return;
    }

    const assignmentRows = result.shifts
      .map((shift, index) => ({
        shift,
        shiftId: shiftsResult.data[index]?.id,
      }))
      .filter((item) => Boolean(item.shiftId && item.shift.employeeId))
      .map((item) => ({
        shift_id: item.shiftId as string,
        employee_id: item.shift.employeeId as string,
        assignment_status:
          item.shift.shiftType === "replacement" || item.shift.shiftType === "temporary_densification"
            ? "replacement"
            : "assigned",
        is_user_fixed: false,
      }));

    if (assignmentRows.length > 0) {
      const assignmentsResult = await supabase
        .from("shift_assignments")
        .insert(assignmentRows);

      if (assignmentsResult.error) {
        await supabase.from("shifts").delete().eq("schedule_id", scheduleId);
        await supabase.from("schedules").delete().eq("id", scheduleId);
        setError(assignmentsResult.error.message);
        setGenerating(false);
        return;
      }
    }

    const vacancyIds = new Map<string, string>();
    result.shifts.forEach((shift, index) => {
      if (shift.isVacancy && shift.sourceEmployeeId) {
        vacancyIds.set(
          shift.sourceEmployeeId + ":" + shift.day,
          shiftsResult.data[index].id
        );
      }
    });

    const substitutions = result.shifts
      .map((shift, index) => ({
        shift,
        shiftId: shiftsResult.data[index]?.id,
      }))
      .filter(
        (item) =>
          item.shift.employeeId &&
          (item.shift.shiftType === "replacement" ||
            item.shift.shiftType === "temporary_densification") &&
          item.shift.sourceEmployeeId
      )
      .map((item) => ({
        schedule_id: scheduleId,
        vacancy_shift_id:
          vacancyIds.get(item.shift.sourceEmployeeId + ":" + item.shift.day) ??
          item.shiftId,
        replacement_employee_id: item.shift.employeeId,
        replacement_mode: "automatic",
        status: "confirmed",
        reason: item.shift.note ?? null,
      }));

    if (substitutions.length > 0) {
      await supabase.from("substitutions").insert(substitutions);
    }

    await supabase.from("schedule_versions").insert({
      schedule_id: scheduleId,
      version_number: 1,
      reason:
        mode === "A"
          ? "Первичное формирование с сохранением цикла и автоматическим закрытием вакансий."
          : "Первичное формирование режима B с временным уплотнением при отсутствии.",
      snapshot: {
        year,
        month: month + 1,
        planning_mode: mode,
        shift_count: result.shifts.length,
        vacancy_count: result.vacancyCount,
        filled_vacancy_count: result.filledVacancyCount,
        unfilled_vacancy_count: result.unfilledVacancyCount,
        absences_count: absences.length,
      },
    });

    await supabase.from("audit_logs").insert({
      schedule_id: scheduleId,
      action_type: "schedule_generated",
      entity_type: "schedule",
      entity_id: scheduleId,
      details: {
        mode,
        shift_count: result.shifts.length,
        vacancy_count: result.vacancyCount,
        filled_vacancy_count: result.filledVacancyCount,
        unfilled_vacancy_count: result.unfilledVacancyCount,
      },
    });

    setSchedule(cellsToSchedule(employees, result.cells, days));
    setVacancyCount(result.vacancyCount);
    setFilledVacancyCount(result.filledVacancyCount);
    setUnfilledVacancyCount(result.unfilledVacancyCount);
    setGenerationReasons(result.reasons);

    const modeText =
      mode === "A"
        ? "режим A: цикл сутки через трое сохранён"
        : "режим B: при отсутствии разрешено временное уплотнение";

    setMessage(
      "График сформирован (" +
        modeText +
        "). Основных/замещающих смен: " +
        result.shifts.filter((s) => !s.isVacancy).length +
        ". Вакансий: " +
        result.vacancyCount +
        ", закрыто: " +
        result.filledVacancyCount +
        ", осталось: " +
        result.unfilledVacancyCount +
        "."
    );
    setGenerating(false);
  }

  const vacations = absences.filter((absence) => absenceKind(absence.absence_type) === "vacation");

  const totalAssigned = employees.reduce(
    (sum, employee) =>
      sum +
      Object.values(schedule[employee.id] ?? {}).filter(
        (value) => value && value !== "В"
      ).length,
    0
  );

  const monthTitle = new Intl.DateTimeFormat("ru-RU", {
    month: "long",
    year: "numeric",
  }).format(new Date(year, month, 1));

  return (
    <main className="page">
      <header className="topbar">
        <div>
          <div className="eyebrow">СМП • ПЛАНИРОВАНИЕ</div>
          <h1>График фельдшеров</h1>
          <p className="muted">
            Вы составляете базовый график, а ассистент проверяет его и помогает закрыть незакрытые смены.
          </p>
        </div>
        <a className="secondary-button" href="/">← Главное меню</a>
      </header>

      <section className="card schedule-toolbar">
        <div>
          <label>
            Месяц
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

        <div>
          <label>
            Режим планирования
            <select value={mode} onChange={(e) => setMode(e.target.value as PlanningMode)}>
              <option value="A">A — сохранять сутки через трое</option>
              <option value="B">B — временное уплотнение при отсутствии</option>
            </select>
          </label>
        </div>

        <div className="schedule-actions">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={handleExcelFileChange}
            style={{ display: "none" }}
          />
          <button
            className="secondary-button"
            onClick={() => fileInputRef.current?.click()}
            disabled={importingExcel || loading}
          >
            {importingExcel ? "Загрузка Excel..." : "📥 Загрузить Excel"}
          </button>
          <button className="secondary-button" onClick={clearSchedule}>Очистить</button>
          <button
            className="primary-button"
            onClick={checkScheduleWithAssistant}
            disabled={loading || employees.length === 0}
          >
            🤖 Проверить и помочь закрыть дыры
          </button>
        </div>

        <div className="schedule-summary">
          <strong>{monthTitle}</strong>
          <span>Сотрудников: {employees.length}</span>
          <span>Смен: {totalAssigned}</span>
          <span>Отсутствий: {absences.length}</span><span>Отпусков: {vacations.length}</span>
          {vacancyCount > 0 && (
            <span className="warning-text">
              Вакансии: {filledVacancyCount}/{vacancyCount}
            </span>
          )}
        </div>
      </section>

      {message && <div className="success-box">{message}</div>}
      {error && <div className="error-box">{error}</div>}

      {assistantChecked && (
        <section className="card">
          <div className="section-title">
            <div>
              <h2>🤖 Ассистент графика</h2>
              <p className="muted">
                Ассистент не переставляет и не удаляет уже поставленные смены.
                Он только показывает незакрытые места и подходящих сотрудников для дополнительного выхода.
              </p>
            </div>
          </div>

          {assistantIssues.length === 0 ? (
            <div className="success-box">Все дневные и ночные места закрыты по правилам 5×2 + 3×1.</div>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              {assistantIssues.map((issue, index) => (
                <div key={issue.day + "-" + issue.brigadeId + "-" + issue.period} className="card" style={{ margin: 0, padding: 14 }}>
                  <strong>
                    {String(issue.day).padStart(2, "0")}.{String(month + 1).padStart(2, "0")}.{year}
                    {" • "}бригада {issue.brigadeNumber} • {issue.period === "day" ? "день" : "ночь"}
                  </strong>
                  <div className="muted" style={{ marginTop: 4 }}>Не хватает: {issue.missing}</div>

                  {issue.candidates.length === 0 ? (
                    <div className="warning-text" style={{ marginTop: 8 }}>
                      Подходящих кандидатов сейчас нет.
                    </div>
                  ) : (
                    <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                      {issue.candidates.map((candidate) => (
                        <div
                          key={candidate.employeeId}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "minmax(220px, 1fr) auto auto",
                            gap: 10,
                            alignItems: "center",
                            padding: "8px 10px",
                            border: "1px solid var(--border, #ddd)",
                            borderRadius: 10
                          }}
                        >
                          <div>
                            <strong>{candidate.fullName}</strong>
                            <div className="muted">
                              {candidate.actualHours} / {candidate.targetHours} ч • +{candidate.hours} ч • {candidate.reason}
                            </div>
                          </div>
                          <span className="muted">Недобор: {candidate.deficit} ч</span>
                          <button
                            className="primary-button"
                            onClick={() => applyAssistantCandidate(issue, candidate.employeeId)}
                          >
                            Поставить
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {generationReasons.length > 0 && (
        <section className="card">
          <h2>Что осталось незакрытым</h2>
          <ul className="muted" style={{ marginBottom: 0 }}>
            {generationReasons.map((reason, index) => <li key={index}>{reason}</li>)}
          </ul>
        </section>
      )}

      <section className="card">
        <div className="section-title">
          <div>
            <h2>Отпуска сотрудников</h2>
            <p className="muted">
              Отпуск не сдвигает основной цикл. В дни отпуска сотрудник не назначается на смену,
              а его вакансия закрывается по выбранному режиму. Месячная норма автоматически
              уменьшается пропорционально числу дней отпуска.
            </p>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 2fr) 1fr 1fr auto", gap: 12, alignItems: "end" }}>
          <label>
            Сотрудник
            <select value={vacationEmployeeId} onChange={(e) => setVacationEmployeeId(e.target.value)}>
              <option value="">Выберите сотрудника</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>{employee.full_name}</option>
              ))}
            </select>
          </label>
          <label>
            С
            <input type="date" value={vacationFrom} onChange={(e) => setVacationFrom(e.target.value)} />
          </label>
          <label>
            По
            <input type="date" value={vacationTo} onChange={(e) => setVacationTo(e.target.value)} />
          </label>
          <button className="primary-button" onClick={addVacation} disabled={vacationSaving}>
            {vacationSaving ? "Сохранение..." : "Добавить отпуск"}
          </button>
        </div>

        {vacations.length > 0 && (
          <div style={{ marginTop: 18, overflowX: "auto" }}>
            <table className="schedule-table">
              <thead>
                <tr><th>Сотрудник</th><th>Период</th><th></th></tr>
              </thead>
              <tbody>
                {vacations.map((vacation) => (
                  <tr key={vacation.id}>
                    <td>{employees.find((e) => e.id === vacation.employee_id)?.full_name ?? "—"}</td>
                    <td>{vacation.date_from} — {vacation.date_to}</td>
                    <td>
                      <button className="secondary-button" onClick={() => removeVacation(vacation.id)}>
                        Удалить
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card schedule-card">
        <div className="section-title">
          <div>
            <h2>Месячная таблица</h2>
            <p className="muted schedule-hint">
              В каждой ячейке можно напрямую выбрать: 12Д, 12Н, 24 или 8–17.
              24 — сутки, 12Д — 08:00–20:00, 12Н — 20:00–08:00, 8–17 — дневная смена.
              Сначала вручную расставьте базовый график. После этого нажмите «Проверить и помочь закрыть дыры».
              Ассистент предложит дополнительные смены, но не будет менять уже поставленные вами.
            </p>
          </div>
        </div>

        {loading ? (
          <p className="muted">Загрузка сотрудников...</p>
        ) : employees.length === 0 ? (
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
                      {employee.main_brigade_id
                        ? brigadeMap.get(employee.main_brigade_id) ?? "—"
                        : "—"}
                    </td>
                    <td className="hours-cell">{employee.target_hours ?? 0}</td>
                    <td className="hours-cell">
                      {scheduleTypeLabel[employee.work_schedule_type]}
                    </td>
                    {Array.from({ length: days }, (_, index) => {
                      const day = index + 1;
                      const value = schedule[employee.id]?.[day] ?? "";
                      const absentCell = value === "В";
                      return (
                        <td key={day}>
                          {absentCell ? (
                            <button
                              className={
                                "shift-cell " +
                                (absenceKind(absences.find((a) => a.employee_id === employee.id && a.date_from <= `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}` && a.date_to >= `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`)?.absence_type ?? "") === "vacation" ? "shift-vacation" : "shift-absence")
                              }
                              disabled
                              aria-label={employee.full_name + ", день " + day}
                            >
                              {value}
                            </button>
                          ) : (
                            <select
                              className={
                                "shift-cell " +
                                (value === "24"
                                  ? "shift-24"
                                  : value === "12Д"
                                    ? "shift-820"
                                    : value === "12Н"
                                      ? "shift-208"
                                      : value === "8–17"
                                        ? "shift-817"
                                        : "shift-empty")
                              }
                              value={value}
                              onChange={(event) => changeCell(employee, day, event.target.value)}
                              aria-label={employee.full_name + ", день " + day + ", смена"}
                            >
                              {manualShiftOptions.map((option) => (
                                <option key={option.value || "empty"} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          )}
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
        <h2>Как работает выбранный режим</h2>
        {mode === "A" ? (
          <p className="muted" style={{ lineHeight: 1.6, marginBottom: 0 }}>
            <strong>Режим A:</strong> основной цикл сотрудника не сдвигается. При отпуске или больничном
            его плановая смена превращается в вакансию. Сначала ищется подходящий сотрудник той же бригады,
            а 24-часовая вакансия может быть закрыта одной 24-часовой либо двумя 12-часовыми сменами.
            После возвращения исходный цикл продолжается.
          </p>
        ) : (
          <p className="muted" style={{ lineHeight: 1.6, marginBottom: 0 }}>
            <strong>Режим B:</strong> основной цикл также не переписывается. На время отсутствия программа
            сначала пытается закрыть вакансию внутри той же бригады временным уплотнением. Если это невозможно,
            ищется сотрудник другой бригады. После возвращения отсутствующего сотрудника временная замена
            прекращается, а его обычный цикл продолжается.
          </p>
        )}
      </section>
    </main>
  );
}
