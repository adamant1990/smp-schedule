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
  staffingValid: boolean;
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

function hoursForEmployeeInMonth(employeeId: string, shifts: GeneratedShift[]) {
  return shifts
    .filter(s => s.employeeId === employeeId)
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
      staffingValid: false,
      reasons: ["Для формирования смены требуется ровно 8 активных бригад: 5 бригад по 2 фельдшера и 3 бригады по 1 фельдшеру."]
    };
  }

  for (const e of employees) {
    cells[e.id] = {};
    for (let d = 1; d <= days; d++) cells[e.id][d] = { label: "", kind: "base" };
    for (let d = 1; d <= days; d++) {
      if (absent(e, year, month, d, absences)) {
        cells[e.id][d] = { label: "В", kind: "absence" };
      }
    }
    if (!e.main_brigade_id) continue;
    const list = byBrigade.get(e.main_brigade_id) ?? [];
    list.push(e);
    byBrigade.set(e.main_brigade_id, list);
  }
  for (const list of byBrigade.values()) list.sort((a, b) => a.full_name.localeCompare(b.full_name, "ru"));

  // A phase tells us when an employee is available in the normal cycle.
  // It is NOT a reason to create an additional shift. The station still
  // has exactly 13 positions per calendar day.
  const phaseByEmployee = new Map<string, number>();

  for (const [brigadeId, brigadeEmployees] of byBrigade) {
    const required = staffing.required.get(brigadeId) ?? 0;
    const byType = new Map<WorkScheduleType, Employee[]>();

    for (const e of brigadeEmployees) {
      const list = byType.get(e.work_schedule_type) ?? [];
      list.push(e);
      byType.set(e.work_schedule_type, list);
    }

    for (const [type, list] of byType) {
      list.sort((a, b) => a.full_name.localeCompare(b.full_name, "ru"));
      list.forEach((e, index) => {
        const phase = type === "day_night_2_off"
          ? index % 4
          : Math.floor(index / Math.max(1, required)) % 4;
        phaseByEmployee.set(e.id, phase);
      });
    }
  }

  function availableCycleLabel(e: Employee, day: number) {
    return cycleLabel(e, day, phaseByEmployee.get(e.id) ?? 0, year, month);
  }

  function assignmentScore(e: Employee, day: number, label: ShiftLabel, brigadeId: string) {
    const workedMonth = hoursForEmployeeInMonth(e.id, shifts);
    const target = Math.max(0, e.target_hours || 0);
    const deficit = target - workedMonth;

    // Strongly prefer the employee's main brigade for a base position.
    // When the main brigade has more available staff than its daily quota,
    // extra-capable employees can cover positions in other brigades.
    const brigadePenalty = e.main_brigade_id === brigadeId ? 0 : 1000;

    // Employees below their monthly norm get priority. For ordinary
    // employees the norm is a minimum, not a weekly/hourly ceiling.
    // Extra-shift employees are also allowed to accumulate hours above norm.
    const deficitPriority = Math.max(0, deficit);
    const surplusPenalty = e.can_extra_shifts ? 0 : Math.max(0, -deficit);
    return brigadePenalty - deficitPriority * 10 + surplusPenalty * 2 + workedMonth / 1000 + day / 100000;
  }

  function chooseCandidate(
    day: number,
    brigadeId: string,
    preferred: Employee[],
    allowGlobalExtra: boolean
  ): { e: Employee; label: ShiftLabel } | undefined {
    const local: { e: Employee; label: ShiftLabel }[] = preferred
      .map(e => {
        const label = availableCycleLabel(e, day);
        return label ? { e, label } : null;
      })
      .filter((x): x is { e: Employee; label: ShiftLabel } => x !== null)
      .filter(x => candidateOK(x.e, day, x.label, shifts, year, month, absences, false))
      .sort((a, b) => assignmentScore(a.e, day, a.label, brigadeId) - assignmentScore(b.e, day, b.label, brigadeId));

    if (!allowGlobalExtra) return local[0];

    const global: { e: Employee; label: ShiftLabel }[] = employees
      .filter(e => e.main_brigade_id && e.main_brigade_id !== brigadeId && e.can_extra_shifts)
      .map(e => {
        const label = availableCycleLabel(e, day);
        return label ? { e, label } : null;
      })
      .filter((x): x is { e: Employee; label: ShiftLabel } => x !== null)
      .filter(x => candidateOK(x.e, day, x.label, shifts, year, month, absences, true))
      .sort((a, b) => assignmentScore(a.e, day, a.label, brigadeId) - assignmentScore(b.e, day, b.label, brigadeId));

    // Compare the best employee from the home brigade with the best employee
    // who can take an extra shift. This is important for brigades with many
    // employees but only one daily position: otherwise their staff would
    // remain almost without shifts while other brigades consume all slots.
    const bestLocal = local[0];
    const bestGlobal = global[0];
    if (!bestLocal) return bestGlobal;
    if (!bestGlobal) return bestLocal;

    return assignmentScore(bestGlobal.e, day, bestGlobal.label!, brigadeId) <
      assignmentScore(bestLocal.e, day, bestLocal.label!, brigadeId)
      ? bestGlobal
      : bestLocal;
  }

  // Fill exactly 13 positions every day. First use employees in their own
  // brigade according to their cycle and current workload. If that brigade
  // has more cycle-available employees than its quota, an extra-capable
  // employee may be assigned to another brigade so the whole staff gets a
  // fair share of the monthly work.
  for (let day = 1; day <= days; day++) {
    for (const brigade of staffing.active) {
      const required = staffing.required.get(brigade.id) ?? 0;
      const brigadeEmployees = byBrigade.get(brigade.id) ?? [];

      for (let position = 0; position < required; position++) {
        const selected = chooseCandidate(day, brigade.id, brigadeEmployees, true);

        if (!selected) {
          shifts.push({
            employeeId: null,
            brigadeId: brigade.id,
            day,
            label: "24",
            hours: 24,
            shiftType: "base",
            isVacancy: true,
            note: "Не найден сотрудник в основном цикле или среди сотрудников, которым разрешены подработки."
          });
          continue;
        }

        const { e, label } = selected;
        const isBase = e.main_brigade_id === brigade.id;
        const isAbsent = absent(e, year, month, day, absences);

        if (isAbsent) {
          shifts.push({
            employeeId: null,
            brigadeId: brigade.id,
            day,
            label,
            hours: shiftHours(label),
            shiftType: "base",
            isVacancy: true,
            sourceEmployeeId: e.id,
            note: "Основная смена сохранена как вакансия из-за отсутствия."
          });
          cells[e.id][day] = { label: "В", kind: "absence" };
          continue;
        }

        shifts.push({
          employeeId: e.id,
          brigadeId: brigade.id,
          day,
          label,
          hours: shiftHours(label),
          shiftType: isBase ? "base" : "replacement",
          isVacancy: false,
          note: isBase ? undefined : "Подработка в другой бригаде для равномерного распределения нагрузки."
        });

        cells[e.id][day] = {
          label,
          kind: isBase ? "base" : "extra"
        };
      }
    }
  }

  const vacancies = shifts.filter(s => s.isVacancy);
  let filled = 0;

  // Close vacancies created by absences or by a shortage in the base cycle.
  for (const vacancy of vacancies) {
    const active = shifts.filter(s => !s.isVacancy);
    let replacement: Employee | undefined;
    let label = vacancy.label;
    let shiftType: GeneratedShift["shiftType"] = "replacement";
    const brigadeId = vacancy.brigadeId;

    if (mode === "A") {
      const sameBrigade = employees
        .filter(e => e.main_brigade_id === brigadeId && e.can_extra_shifts)
        .filter(e => candidateOK(e, vacancy.day, vacancy.label, active, year, month, absences, true))
        .sort((a, b) => assignmentScore(a, vacancy.day, vacancy.label, brigadeId) - assignmentScore(b, vacancy.day, vacancy.label, brigadeId));

      replacement = sameBrigade[0];

      if (!replacement && vacancy.label === "24") {
        const dayCandidates = employees
          .filter(e => e.main_brigade_id === brigadeId && e.can_extra_shifts)
          .filter(e => candidateOK(e, vacancy.day, "12Д", active, year, month, absences, true))
          .sort((a, b) => assignmentScore(a, vacancy.day, "12Д", brigadeId) - assignmentScore(b, vacancy.day, "12Д", brigadeId));

        const nightCandidates = employees
          .filter(e => e.main_brigade_id === brigadeId && e.can_extra_shifts)
          .filter(e => candidateOK(e, vacancy.day, "12Н", active, year, month, absences, true))
          .sort((a, b) => assignmentScore(a, vacancy.day, "12Н", brigadeId) - assignmentScore(b, vacancy.day, "12Н", brigadeId));

        const dayEmployee = dayCandidates[0];
        const nightEmployee = nightCandidates.find(e => e.id !== dayEmployee?.id);

        if (dayEmployee && nightEmployee) {
          shifts.push({
            employeeId: dayEmployee.id,
            brigadeId,
            day: vacancy.day,
            label: "12Д",
            hours: 12,
            shiftType: "replacement",
            isVacancy: false,
            sourceEmployeeId: vacancy.sourceEmployeeId,
            note: "Часть 24-часовой вакансии."
          });
          shifts.push({
            employeeId: nightEmployee.id,
            brigadeId,
            day: vacancy.day,
            label: "12Н",
            hours: 12,
            shiftType: "replacement",
            isVacancy: false,
            sourceEmployeeId: vacancy.sourceEmployeeId,
            note: "Часть 24-часовой вакансии."
          });
          cells[dayEmployee.id][vacancy.day] = { label: "12Д", kind: "replacement" };
          cells[nightEmployee.id][vacancy.day] = { label: "12Н", kind: "replacement" };
          filled++;
          continue;
        }
      }
    } else {
      replacement = employees
        .filter(e => e.main_brigade_id === brigadeId && e.can_extra_shifts)
        .filter(e => candidateOK(e, vacancy.day, vacancy.label, active, year, month, absences, true))
        .sort((a, b) => assignmentScore(a, vacancy.day, vacancy.label, brigadeId) - assignmentScore(b, vacancy.day, vacancy.label, brigadeId))[0];

      if (replacement) shiftType = "temporary_densification";

      if (!replacement) {
        replacement = employees
          .filter(e => e.main_brigade_id && e.main_brigade_id !== brigadeId && e.can_extra_shifts)
          .filter(e => candidateOK(e, vacancy.day, vacancy.label, active, year, month, absences, true))
          .sort((a, b) => assignmentScore(a, vacancy.day, vacancy.label, brigadeId) - assignmentScore(b, vacancy.day, vacancy.label, brigadeId))[0];
      }
    }

    if (replacement) {
      shifts.push({
        employeeId: replacement.id,
        brigadeId,
        day: vacancy.day,
        label,
        hours: shiftHours(label),
        shiftType,
        isVacancy: false,
        sourceEmployeeId: vacancy.sourceEmployeeId,
        note: mode === "B" && shiftType === "temporary_densification"
          ? "Режим B: временное уплотнение; после возвращения сотрудника прекращается."
          : "Автоматическая замена вакансии."
      });
      cells[replacement.id][vacancy.day] = {
        label,
        kind: shiftType === "temporary_densification" ? "extra" : "replacement"
      };
      filled++;
    } else {
      reasons.push(
        "Не закрыта вакансия: " + dateOf(year, month, vacancy.day) +
        ", бригада " + (brigades.find(b => b.id === vacancy.brigadeId)?.number ?? "—") +
        ", смена " + vacancy.label
      );
    }
  }

  // target_hours is a MONTHLY norm. It is not a weekly maximum.
  // A non-extra employee must receive at least the monthly norm, but whole
  // shifts may make the actual total slightly higher. Employees with
  // can_extra_shifts=true have no monthly upper limit.
  const monthlyHours = new Map<string, number>();
  for (const shift of shifts) {
    if (!shift.employeeId) continue;
    monthlyHours.set(
      shift.employeeId,
      (monthlyHours.get(shift.employeeId) ?? 0) + shift.hours
    );
  }

  for (const e of employees) {
    if (!e.active || !e.target_hours || e.can_extra_shifts) continue;
    const actual = monthlyHours.get(e.id) ?? 0;
    if (actual < e.target_hours) {
      reasons.push(
        e.full_name +
        ": назначено " + actual +
        " ч. при месячной норме " + e.target_hours + " ч."
      );
    }
  }

  const finalDailyCounts = new Map<number, number>();
  const finalBrigadeCounts = new Map<number, Map<string, number>>();
  for (const shift of shifts) {
    if (!shift.isVacancy && shift.employeeId) {
      finalDailyCounts.set(shift.day, (finalDailyCounts.get(shift.day) ?? 0) + 1);
      const byDay = finalBrigadeCounts.get(shift.day) ?? new Map<string, number>();
      byDay.set(shift.brigadeId, (byDay.get(shift.brigadeId) ?? 0) + 1);
      finalBrigadeCounts.set(shift.day, byDay);
    }
  }

  let staffingValid = true;
  for (let day = 1; day <= days; day++) {
    const count = finalDailyCounts.get(day) ?? 0;
    const brigadeCounts = finalBrigadeCounts.get(day) ?? new Map<string, number>();

    if (count !== 13) {
      staffingValid = false;
      reasons.push(
        dateOf(year, month, day) +
        " итоговая укомплектованность: " + count +
        " фельдшеров вместо 13."
      );
    }

    for (const [brigadeId, required] of staffing.required) {
      const actual = brigadeCounts.get(brigadeId) ?? 0;
      if (actual !== required) {
        staffingValid = false;
        const brigadeNumber = brigades.find(b => b.id === brigadeId)?.number ?? brigadeId;
        reasons.push(
          dateOf(year, month, day) +
          " бригада " + brigadeNumber +
          ": " + actual + " фельдшеров вместо " + required + "."
        );
      }
    }
  }

  // A monthly norm is a minimum for ordinary employees, not a hard cap.
  // Extra-shift employees are intentionally excluded from this minimum
  // validation because their workload is unrestricted by the norm.
  for (const e of employees) {
    if (!e.active || !e.target_hours || e.can_extra_shifts) continue;
    const actual = monthlyHours.get(e.id) ?? 0;
    if (actual < e.target_hours) staffingValid = false;
  }
  if (vacancies.length - filled > 0) staffingValid = false;

  return {
    shifts,
    cells,
    vacancyCount: vacancies.length,
    filledVacancyCount: filled,
    unfilledVacancyCount: vacancies.length - filled,
    staffingValid,
    reasons
  };
}
