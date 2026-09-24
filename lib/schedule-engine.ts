export type PlanningMode = "A" | "B";
export type ShiftLabel = "24" | "12Д" | "12Н" | "8–17";
export type WorkScheduleType = "24/3" | "day_night_2_off" | "8_17";

export type Employee = {
  id: string;
  full_name: string;
  position: string;
  main_brigade_id: string | null;
  employment_start: string | null;
  employment_end: string | null;
  target_hours: number;
  can_extra_shifts: boolean;
  work_schedule_type: WorkScheduleType;
  active: boolean;
};

export type Brigade = {
  id: string;
  number: number;
  active: boolean;
  required_feldshers: number;
};

export type Absence = {
  id: string;
  employee_id: string;
  absence_type: string;
  date_from: string;
  date_to: string;
};

export type GeneratedShift = {
  employeeId: string | null;
  brigadeId: string;
  day: number;
  label: ShiftLabel;
  hours: number;
  shiftType: "base" | "replacement" | "temporary_densification";
  isVacancy: boolean;
  sourceEmployeeId?: string;
  note?: string;
};

export type ScheduleCell = {
  label: string;
  kind: "base" | "replacement" | "absence" | "extra";
};

export type GenerationResult = {
  shifts: GeneratedShift[];
  cells: Record<string, Record<number, ScheduleCell>>;
  vacancyCount: number;
  filledVacancyCount: number;
  unfilledVacancyCount: number;
  reasons: string[];
};

function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function dateOf(year: number, month: number, day: number) {
  const d = new Date(year, month, day);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

export function shiftHours(label: ShiftLabel) {
  return label === "24" ? 24 : label === "8–17" ? 9 : 12;
}

export function shiftTimes(year: number, month: number, day: number, label: ShiftLabel) {
  const date = dateOf(year, month, day);
  const next = dateOf(year, month, day + 1);
  if (label === "24") return { start_at: date + "T08:00:00", end_at: next + "T08:00:00" };
  if (label === "12Д") return { start_at: date + "T08:00:00", end_at: date + "T20:00:00" };
  if (label === "12Н") return { start_at: date + "T20:00:00", end_at: next + "T08:00:00" };
  return { start_at: date + "T08:00:00", end_at: date + "T17:00:00" };
}

function employed(e: Employee, year: number, month: number, day: number) {
  const date = dateOf(year, month, day);
  return (!e.employment_start || date >= e.employment_start) &&
    (!e.employment_end || date <= e.employment_end);
}

function absent(e: Employee, year: number, month: number, day: number, absences: Absence[]) {
  const date = dateOf(year, month, day);
  return absences.some(a => a.employee_id === e.id && a.date_from <= date && a.date_to >= date);
}

function overlaps(a: GeneratedShift, b: GeneratedShift) {
  const start = (s: GeneratedShift) => s.day * 24 + (s.label === "12Н" ? 20 : 8);
  const aStart = start(a), bStart = start(b);
  return aStart < bStart + b.hours && bStart < aStart + a.hours;
}

function weekKey(year: number, month: number, day: number) {
  const d = new Date(year, month, day);
  const dayOfWeek = d.getDay() || 7;
  d.setDate(d.getDate() - dayOfWeek + 1);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function hoursForEmployeeInWeek(
  employeeId: string,
  shifts: GeneratedShift[],
  year: number,
  month: number,
  targetWeek: string
) {
  return shifts
    .filter(s => s.employeeId === employeeId && weekKey(year, month, s.day) === targetWeek)
    .reduce((sum, s) => sum + s.hours, 0);
}

function staffingRequirements(brigades: Brigade[]) {
  const active = brigades.filter(b => b.active).sort((a, b) => a.number - b.number);
  if (active.length !== 8) {
    return { valid: false, active, required: new Map<string, number>(), total: 13 };
  }
  const required = new Map<string, number>();
  active.forEach((b, index) => required.set(b.id, index < 5 ? 2 : 1));
  return { valid: true, active, required, total: 13 };
}

function candidateOK(
  e: Employee,
  day: number,
  label: ShiftLabel,
  shifts: GeneratedShift[],
  year: number,
  month: number,
  absences: Absence[],
  extraOnly: boolean
) {
  if (!e.active || !e.main_brigade_id || !employed(e, year, month, day)) return false;
  if (absent(e, year, month, day, absences)) return false;
  if (extraOnly && !e.can_extra_shifts) return false;
  const targetWeek = weekKey(year, month, day);
  if (hoursForEmployeeInWeek(e.id, shifts, year, month, targetWeek) + shiftHours(label) > 48) return false;
  const probe: GeneratedShift = {
    employeeId: e.id, brigadeId: e.main_brigade_id, day, label,
    hours: shiftHours(label), shiftType: "replacement", isVacancy: false
  };
  return !shifts.some(s => s.employeeId === e.id && overlaps(s, probe));
}

function cycleLabel(e: Employee, day: number, phase: number, year: number, month: number): ShiftLabel | null {
  if (e.work_schedule_type === "24/3") {
    return ((day - 1 - phase + 400) % 4 === 0) ? "24" : null;
  }
  if (e.work_schedule_type === "day_night_2_off") {
    const n = (day - 1 - phase + 400) % 4;
    return n === 0 ? "12Д" : n === 1 ? "12Н" : null;
  }
  const weekday = new Date(year, month, day).getDay();
  return weekday === 0 || weekday === 6 ? null : "8–17";
}

export function generateSchedule(
  employees: Employee[],
  brigades: Brigade[],
  absences: Absence[],
  year: number,
  month: number,
  mode: PlanningMode
): GenerationResult {
  const days = daysInMonth(year, month);
  const cells: Record<string, Record<number, ScheduleCell>> = {};
  const shifts: GeneratedShift[] = [];
  const reasons: string[] = [];
  const byBrigade = new Map<string, Employee[]>();
  const staffing = staffingRequirements(brigades);

  if (!staffing.valid) {
    return {
      shifts: [],
      cells: Object.fromEntries(employees.map(e => [e.id, Object.fromEntries(Array.from({ length: days }, (_, i) => [i + 1, { label: "", kind: "base" as const }]))])),
      vacancyCount: 0,
      filledVacancyCount: 0,
      unfilledVacancyCount: 0,
      reasons: ["Для формирования смены требуется ровно 8 активных бригад: 5 бригад по 2 фельдшера и 3 бригады по 1 фельдшеру."]
    };
  }

  for (const e of employees) {
    cells[e.id] = {};
    for (let d = 1; d <= days; d++) cells[e.id][d] = { label: "", kind: "base" };
    if (!e.main_brigade_id) continue;
    const list = byBrigade.get(e.main_brigade_id) ?? [];
    list.push(e);
    byBrigade.set(e.main_brigade_id, list);
  }
  for (const list of byBrigade.values()) list.sort((a, b) => a.full_name.localeCompare(b.full_name, "ru"));

  // The employee's original cycle is always generated first and is never shifted
  // because of an absence. This is the key invariant for both planning modes.
  for (const e of employees) {
    const brigadeEmployees = byBrigade.get(e.main_brigade_id ?? "") ?? [];
    const employeeIndex = Math.max(0, brigadeEmployees.findIndex(x => x.id === e.id));
    const required = staffing.required.get(e.main_brigade_id ?? "") ?? 0;
    const sameScheduleEmployees = brigadeEmployees.filter(x => x.work_schedule_type === e.work_schedule_type);
    const sameIndex = Math.max(0, sameScheduleEmployees.findIndex(x => x.id === e.id));
    const phase = e.work_schedule_type === "24/3"
      ? Math.floor(sameIndex / Math.max(1, required)) % 4
      : e.work_schedule_type === "day_night_2_off"
        ? Math.floor(sameIndex / Math.max(1, required)) % 4
        : employeeIndex % 5;
    for (let day = 1; day <= days; day++) {
      const label = cycleLabel(e, day, phase, year, month);
      if (!label || !employed(e, year, month, day) || !e.main_brigade_id) continue;
      if (absent(e, year, month, day, absences)) {
        shifts.push({
          employeeId: null, sourceEmployeeId: e.id, brigadeId: e.main_brigade_id,
          day, label, hours: shiftHours(label), shiftType: "base", isVacancy: true,
          note: "Основная смена сохранена как вакансия из-за отсутствия."
        });
        cells[e.id][day] = { label: "В", kind: "absence" };
      } else {
        shifts.push({
          employeeId: e.id, brigadeId: e.main_brigade_id, day, label,
          hours: shiftHours(label), shiftType: "base", isVacancy: false
        });
        cells[e.id][day] = { label, kind: "base" };
      }
    }
  }

  const vacancies = shifts.filter(s => s.isVacancy);
  let filled = 0;

  // Hard staffing rule: every calendar day must contain exactly 13 active feldsher
  // positions distributed as 2+2+2+2+2+1+1+1 across brigades.
  for (let day = 1; day <= days; day++) {
    const dayActive = shifts.filter(s => s.day === day && !s.isVacancy);
    const dayVacancies = shifts.filter(s => s.day === day && s.isVacancy);
    const counts = new Map<string, number>();
    for (const s of dayActive) counts.set(s.brigadeId, (counts.get(s.brigadeId) ?? 0) + 1);
    const total = dayActive.length;
    if (total !== 13 || dayVacancies.length > 0) {
      reasons.push(
        "На " + dateOf(year, month, day) +
        " до закрытия вакансий сформировано " + total +
        " назначений вместо 13. Требование: 5 бригад × 2 + 3 бригады × 1."
      );
    }
  }

  for (const vacancy of vacancies) {
    const active = shifts.filter(s => !s.isVacancy);
    let replacement: Employee | undefined;
    let label = vacancy.label;
    let shiftType: GeneratedShift["shiftType"] = "replacement";
    let brigadeId = vacancy.brigadeId;

    if (mode === "A") {
      // Mode A: first try a 24-hour employee for a 24-hour vacancy.
      if (vacancy.label === "24") {
        replacement = employees
          .filter(e => e.work_schedule_type === "24/3" && e.main_brigade_id === vacancy.brigadeId)
          .filter(e => candidateOK(e, vacancy.day, "24", active, year, month, absences, true))
          .sort((a, b) => a.full_name.localeCompare(b.full_name, "ru"))[0];

        if (replacement) label = "24";
      } else {
        replacement = employees
          .filter(e => e.work_schedule_type === "day_night_2_off" && e.main_brigade_id === vacancy.brigadeId)
          .filter(e => candidateOK(e, vacancy.day, vacancy.label, active, year, month, absences, true))
          .sort((a, b) => a.full_name.localeCompare(b.full_name, "ru"))[0];
      }

      // A 24-hour vacancy can also be split into 08-20 + 20-08.
      if (!replacement && vacancy.label === "24") {
        const dayCandidates = employees
          .filter(e => e.main_brigade_id === vacancy.brigadeId)
          .filter(e => candidateOK(e, vacancy.day, "12Д", active, year, month, absences, true));
        const nightCandidates = employees
          .filter(e => e.main_brigade_id === vacancy.brigadeId)
          .filter(e => candidateOK(e, vacancy.day, "12Н", active, year, month, absences, true));
        const dayEmployee = dayCandidates[0];
        const nightEmployee = nightCandidates.find(e => e.id !== dayEmployee?.id);
        if (dayEmployee && nightEmployee) {
          shifts.push({
            employeeId: dayEmployee.id, brigadeId: brigadeId, day: vacancy.day,
            label: "12Д", hours: 12, shiftType: "replacement", isVacancy: false,
            sourceEmployeeId: vacancy.sourceEmployeeId, note: "Часть 24-часовой вакансии."
          });
          shifts.push({
            employeeId: nightEmployee.id, brigadeId: brigadeId, day: vacancy.day,
            label: "12Н", hours: 12, shiftType: "replacement", isVacancy: false,
            sourceEmployeeId: vacancy.sourceEmployeeId, note: "Часть 24-часовой вакансии."
          });
          cells[dayEmployee.id][vacancy.day] = { label: "12Д", kind: "replacement" };
          cells[nightEmployee.id][vacancy.day] = { label: "12Н", kind: "replacement" };
          filled++;
          continue;
        }
      }
    } else {
      // Mode B: temporary densification starts inside the absent employee's brigade.
      replacement = employees
        .filter(e => e.main_brigade_id === vacancy.brigadeId)
        .filter(e => candidateOK(e, vacancy.day, vacancy.label, active, year, month, absences, true))
        .sort((a, b) => a.full_name.localeCompare(b.full_name, "ru"))[0];

      if (replacement) {
        shiftType = "temporary_densification";
      } else {
        // If the brigade cannot cover the vacancy, use another brigade.
        replacement = employees
          .filter(e => e.main_brigade_id && e.main_brigade_id !== vacancy.brigadeId)
          .filter(e => candidateOK(e, vacancy.day, vacancy.label, active, year, month, absences, true))
          .sort((a, b) => a.full_name.localeCompare(b.full_name, "ru"))[0];
      }
    }

    if (replacement) {
      // Never allow an automatic replacement to push the employee above 48 hours
      // in the same calendar week.
      const targetWeek = weekKey(year, month, vacancy.day);
      const alreadyWorked = hoursForEmployeeInWeek(replacement.id, shifts, year, month, targetWeek);
      if (alreadyWorked + shiftHours(label) > 48) {
        replacement = undefined;
      }
    }

    if (replacement) {
      shifts.push({
        employeeId: replacement.id, brigadeId, day: vacancy.day, label,
        hours: shiftHours(label), shiftType, isVacancy: false,
        sourceEmployeeId: vacancy.sourceEmployeeId,
        note: mode === "B" && shiftType === "temporary_densification"
          ? "Режим B: временное уплотнение; после возвращения сотрудника прекращается."
          : "Автоматическая замена вакансии."
      });
      cells[replacement.id][vacancy.day] = { label, kind: shiftType === "temporary_densification" ? "extra" : "replacement" };
      filled++;
    } else {
      reasons.push(
        "Не закрыта вакансия: " + dateOf(year, month, vacancy.day) +
        ", бригада " + (brigades.find(b => b.id === vacancy.brigadeId)?.number ?? "—") +
        ", смена " + vacancy.label
      );
    }
  }

  // Final hard check: no employee may exceed 48 hours in a calendar week.
  const weeklyHours = new Map<string, number>();
  for (const shift of shifts) {
    if (!shift.employeeId) continue;
    const key = shift.employeeId + ":" + weekKey(year, month, shift.day);
    weeklyHours.set(key, (weeklyHours.get(key) ?? 0) + shift.hours);
  }
  for (const [key, hours] of weeklyHours) {
    if (hours > 48) reasons.push("Превышение лимита 48 часов: " + key + " = " + hours + " ч.");
  }

  return {
    shifts,
    cells,
    vacancyCount: vacancies.length,
    filledVacancyCount: filled,
    unfilledVacancyCount: vacancies.length - filled,
    reasons
  };
}
