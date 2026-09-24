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

export function absenceKind(absenceType: string) {
  const value = absenceType.toLowerCase();
  return value.includes("отпуск") || value === "о" || value === "vacation" ? "vacation" : "absence";
}

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

function absenceForDay(e: Employee, year: number, month: number, day: number, absences: Absence[]) {
  const date = dateOf(year, month, day);
  return absences.find(a => a.employee_id === e.id && a.date_from <= date && a.date_to >= date);
}

function absent(e: Employee, year: number, month: number, day: number, absences: Absence[]) {
  return Boolean(absenceForDay(e, year, month, day, absences));
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

function adjustedMonthlyTarget(e: Employee, year: number, month: number, absences: Absence[]) {
  const target = Math.max(0, e.target_hours || 0);
  if (!target) return 0;
  const totalDays = daysInMonth(year, month);
  let vacationDays = 0;
  for (let day = 1; day <= totalDays; day++) {
    const a = absenceForDay(e, year, month, day, absences);
    if (a && absenceKind(a.absence_type) === "vacation") vacationDays++;
  }
  return Math.round(target * Math.max(0, totalDays - vacationDays) / totalDays);
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
    employeeId: e.id,
    brigadeId: e.main_brigade_id,
    day,
    label,
    hours: shiftHours(label),
    shiftType: "replacement",
    isVacancy: false
  };

  const own = shifts.filter(s => s.employeeId === e.id);

  // Never put a shift on top of another shift.
  if (own.some(s => overlaps(s, probe))) return false;

  // A night shift must be followed by a real rest period:
  // 12Н -> 12Д/8–17/24 on the next day is forbidden.
  for (const s of own) {
    if (s.label === "12Н" && day === s.day + 1) {
      if (label === "12Д" || label === "8–17" || label === "24") return false;
    }
    if (label === "12Н" && s.day === day + 1) {
      // A shift ending at 08:00 is not enough rest before the next night.
      if (s.label === "12Д" || s.label === "24" || s.label === "8–17") return false;
    }
  }

  // For a 24-hour shift there must be at least the following calendar day
  // free. Extra 12-hour work is allowed later between the regular 24/3 shifts.
  for (const s of own) {
    if (s.label === "24" && Math.abs(day - s.day) <= 1) return false;
    if (label === "24" && Math.abs(day - s.day) <= 1) return false;
  }

  // Extra work must not destroy the employee's basic cycle.
  // A 12-hour employee may work the natural day+night pair, but an extra
  // assignment cannot create a third consecutive working day.
  if (e.work_schedule_type === "day_night_2_off") {
    const workDays = new Set(own.map(s => s.day));
    workDays.add(day);
    let run = 0;
    for (let d = 1; d <= daysInMonth(year, month); d++) {
      if (workDays.has(d)) {
        run++;
        if (run > 2) return false;
      } else {
        run = 0;
      }
    }
  }

  // 24/3 employees may take extra work between their 24-hour shifts, but
  // never another 24-hour shift immediately after one.
  if (e.work_schedule_type === "24/3") {
    const work24 = own.filter(s => s.label === "24").map(s => s.day);
    if (label === "24" && work24.some(d => Math.abs(d - day) < 4)) return false;
    // A 12-hour extra is allowed between 24-hour shifts, provided it does
    // not overlap and does not violate the night-rest rule above.
  }

  return true;
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
        const a = absenceForDay(e, year, month, d, absences);
        cells[e.id][d] = {
          label: a && absenceKind(a.absence_type) === "vacation" ? "О" : "В",
          kind: "absence"
        };
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
  // ДВУХЭТАПНЫЙ ГЕНЕРАТОР:
  // 1) сначала неизменно строим базовые циклы сотрудников;
  // 2) затем закрываем только оставшийся дефицит подработками.
  const phaseByEmployee = new Map<string, number>();

  for (const [, brigadeEmployees] of byBrigade) {
    const byType = new Map<WorkScheduleType, Employee[]>();
    for (const e of brigadeEmployees) {
      const list = byType.get(e.work_schedule_type) ?? [];
      list.push(e);
      byType.set(e.work_schedule_type, list);
    }
    for (const [type, list] of byType) {
      list.sort((a, b) => a.full_name.localeCompare(b.full_name, "ru"));
      list.forEach((e, index) => phaseByEmployee.set(e.id, type === "8_17" ? 0 : index % 4));
    }
  }

  function availableCycleLabel(e: Employee, day: number) {
    return cycleLabel(e, day, phaseByEmployee.get(e.id) ?? 0, year, month);
  }

  function setCell(employeeId: string, day: number, label: ShiftLabel, kind: ScheduleCell["kind"]) {
    const current = cells[employeeId][day];
    if (!current || current.kind === "absence" || !current.label) {
      cells[employeeId][day] = { label, kind };
      return;
    }
    const labels = new Set(current.label.split(" + "));
    labels.add(label);
    cells[employeeId][day] = { label: Array.from(labels).join(" + "), kind };
  }

  function addShift(e: Employee, brigadeId: string, day: number, label: ShiftLabel,
    shiftType: GeneratedShift["shiftType"], note?: string) {
    const shift: GeneratedShift = {
      employeeId: e.id, brigadeId, day, label, hours: shiftHours(label),
      shiftType, isVacancy: false, note
    };
    shifts.push(shift);
    setCell(e.id, day, label, shiftType === "base" ? "base" : "extra");
    return shift;
  }

  function coversDay(label: ShiftLabel) {
    return label === "24" || label === "12Д" || label === "8–17";
  }

  function coversNight(label: ShiftLabel) {
    return label === "24" || label === "12Н";
  }

  function coverageFor(brigadeId: string, day: number) {
    let dayCount = 0;
    let nightCount = 0;
    for (const s of shifts) {
      if (s.isVacancy || !s.employeeId || s.brigadeId !== brigadeId || s.day !== day) continue;
      if (coversDay(s.label)) dayCount++;
      if (coversNight(s.label)) nightCount++;
    }
    return { dayCount, nightCount };
  }

  function cycleCandidates(brigadeId: string, day: number) {
    return (byBrigade.get(brigadeId) ?? [])
      .map(e => {
        const label = availableCycleLabel(e, day);
        return label ? { e, label } : null;
      })
      .filter((x): x is { e: Employee; label: ShiftLabel } => x !== null)
      .filter(x => candidateOK(x.e, day, x.label, shifts, year, month, absences, false))
      .sort((a, b) => {
        const ta = adjustedMonthlyTarget(a.e, year, month, absences);
        const tb = adjustedMonthlyTarget(b.e, year, month, absences);
        const ha = hoursForEmployeeInMonth(a.e.id, shifts);
        const hb = hoursForEmployeeInMonth(b.e.id, shifts);
        const da = ta > 0 ? (ta - ha) / ta : 0;
        const db = tb > 0 ? (tb - hb) / tb : 0;
        return db - da;
      });
  }

  // ЭТАП 1: только штатный цикл.
  for (let day = 1; day <= days; day++) {
    for (const brigade of staffing.active) {
      const required = staffing.required.get(brigade.id) ?? 0;
      const candidates = cycleCandidates(brigade.id, day);

      // Сначала 24/3: 24 часа сразу закрывают день и ночь.
      for (const x of candidates.filter(x => x.label === "24")) {
        const c = coverageFor(brigade.id, day);
        if (c.dayCount >= required && c.nightCount >= required) break;
        if (c.dayCount < required && c.nightCount < required) {
          addShift(x.e, brigade.id, day, "24", "base");
        }
      }

      // Затем штатные 12Д / 8–17.
      for (const x of candidates.filter(x => x.label === "12Д" || x.label === "8–17")) {
        if (coverageFor(brigade.id, day).dayCount >= required) break;
        addShift(x.e, brigade.id, day, x.label, "base");
      }

      // Затем штатные 12Н.
      for (const x of candidates.filter(x => x.label === "12Н")) {
        if (coverageFor(brigade.id, day).nightCount >= required) break;
        addShift(x.e, brigade.id, day, "12Н", "base");
      }
    }
  }

  // ЭТАП 2: только здесь разрешаем подработки.
  function extraCandidate(brigadeId: string, day: number, label: ShiftLabel) {
    return employees
      .filter(e => e.active && e.main_brigade_id && e.can_extra_shifts)
      .filter(e => candidateOK(e, day, label, shifts, year, month, absences, true))
      .filter(e => !shifts.some(s => s.employeeId === e.id && s.day === day))
      .sort((a, b) => {
        const ta = adjustedMonthlyTarget(a, year, month, absences);
        const tb = adjustedMonthlyTarget(b, year, month, absences);
        const ha = hoursForEmployeeInMonth(a.id, shifts);
        const hb = hoursForEmployeeInMonth(b.id, shifts);
        const da = ta > 0 ? (ta - ha) / ta : 0;
        const db = tb > 0 ? (tb - hb) / tb : 0;
        if (db !== da) return db - da;
        return (a.main_brigade_id === brigadeId ? 0 : 1) - (b.main_brigade_id === brigadeId ? 0 : 1);
      })[0];
  }

  let vacancyCount = 0;
  let stage2Filled = 0;

  for (let day = 1; day <= days; day++) {
    for (const brigade of staffing.active) {
      const required = staffing.required.get(brigade.id) ?? 0;

      for (let guard = 0; guard < required * 4; guard++) {
        const c = coverageFor(brigade.id, day);
        const dayMissing = required - c.dayCount;
        const nightMissing = required - c.nightCount;
        if (dayMissing <= 0 && nightMissing <= 0) break;

        // Если одновременно не хватает дня и ночи — одна 24-часовая подработка.
        if (dayMissing > 0 && nightMissing > 0) {
          const e24 = extraCandidate(brigade.id, day, "24");
          if (e24) {
            addShift(e24, brigade.id, day, "24",
              mode === "B" ? "temporary_densification" : "replacement",
              "Этап 2: дополнительная 24-часовая смена.");
            stage2Filled++;
            continue;
          }
        }

        // Только день — 12Д.
        if (dayMissing > 0) {
          const e12d = extraCandidate(brigade.id, day, "12Д");
          if (e12d) {
            addShift(e12d, brigade.id, day, "12Д",
              mode === "B" ? "temporary_densification" : "replacement",
              "Этап 2: дополнительная дневная смена.");
            stage2Filled++;
            continue;
          }
        }

        // Только ночь — 12Н.
        if (nightMissing > 0) {
          const e12n = extraCandidate(brigade.id, day, "12Н");
          if (e12n) {
            addShift(e12n, brigade.id, day, "12Н",
              mode === "B" ? "temporary_densification" : "replacement",
              "Этап 2: дополнительная ночная смена.");
            stage2Filled++;
            continue;
          }
        }

        break;
      }

      const c = coverageFor(brigade.id, day);
      const remaining = Math.max(0, required - c.dayCount) + Math.max(0, required - c.nightCount);
      if (remaining > 0) {
        vacancyCount += remaining;
        reasons.push(dateOf(year, month, day) + ": бригада " + brigade.number +
          " не закрыта после двух этапов. Осталось мест: " + remaining + ".");
      }
    }
  }

  // Для совместимости с остальной частью движка оставляем этот массив.
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

  // Second pass: rebalance the already valid daily staffing toward monthly
  // norms. A move never changes the number of positions in a brigade/day.
  // It is accepted only when the receiving employee can legally work the shift
  // and the donor is above the receiving employee's relative workload.
  for (let pass = 0; pass < 250; pass++) {
    let moved = false;

    for (const current of [...shifts]) {
      // Базовый цикл после этапа 1 не трогаем. Иначе перераспределение
      // могло бы превратить 24/3 или день/ночь/2 выходных в произвольный график.
      if (current.isVacancy || !current.employeeId || current.shiftType === "base") continue;

      const donor = employees.find(e => e.id === current.employeeId);
      if (!donor) continue;

      const donorTarget = adjustedMonthlyTarget(donor, year, month, absences);
      const donorHours = hoursForEmployeeInMonth(donor.id, shifts);
      if (donorHours <= donorTarget) continue;

      const receivers = employees
        .filter(e => e.id !== donor.id && e.active && e.main_brigade_id)
        .filter(e => {
          const target = adjustedMonthlyTarget(e, year, month, absences);
          const hours = hoursForEmployeeInMonth(e.id, shifts);
          return target > 0 && hours + current.hours < target;
        })
        .filter(e => {
          // Temporarily remove the donor shift while testing the receiver.
          const idx = shifts.indexOf(current);
          if (idx >= 0) shifts.splice(idx, 1);
          const ok = candidateOK(e, current.day, current.label, shifts, year, month, absences, false);
          if (idx >= 0) shifts.splice(idx, 0, current);
          return ok;
        })
        .sort((a, b) => {
          const ta = adjustedMonthlyTarget(a, year, month, absences);
          const tb = adjustedMonthlyTarget(b, year, month, absences);
          const ha = hoursForEmployeeInMonth(a.id, shifts);
          const hb = hoursForEmployeeInMonth(b.id, shifts);
          return (tb - hb) / tb - (ta - ha) / ta;
        });

      const receiver = receivers[0];
      if (!receiver) continue;

      // Do not move a shift when it would make the donor fall below norm.
      if (donorHours - current.hours < donorTarget) continue;

      current.employeeId = receiver.id;
      current.shiftType = receiver.main_brigade_id === current.brigadeId ? "base" : "replacement";
      current.note = "Перераспределено вторым проходом по месячной норме часов.";
      cells[donor.id][current.day] = { label: "", kind: "base" };
      cells[receiver.id][current.day] = {
        label: current.label,
        kind: current.shiftType === "base" ? "base" : "extra"
      };
      moved = true;
    }

    if (!moved) break;
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
    const adjustedTarget = adjustedMonthlyTarget(e, year, month, absences);
    const actual = monthlyHours.get(e.id) ?? 0;
    if (actual < adjustedTarget) {
      reasons.push(
        e.full_name +
        ": назначено " + actual +
        " ч. при месячной норме " + e.target_hours + " ч."
      );
    }
  }

  const finalDayCounts = new Map<number, number>();
  const finalNightCounts = new Map<number, number>();
  let staffingValid = true;

  for (let day = 1; day <= days; day++) {
    const dayBrigadeCounts = new Map<string, number>();
    const nightBrigadeCounts = new Map<string, number>();

    for (const shift of shifts) {
      if (shift.isVacancy || !shift.employeeId || shift.day !== day) continue;
      if (coversDay(shift.label)) {
        finalDayCounts.set(day, (finalDayCounts.get(day) ?? 0) + 1);
        dayBrigadeCounts.set(shift.brigadeId, (dayBrigadeCounts.get(shift.brigadeId) ?? 0) + 1);
      }
      if (coversNight(shift.label)) {
        finalNightCounts.set(day, (finalNightCounts.get(day) ?? 0) + 1);
        nightBrigadeCounts.set(shift.brigadeId, (nightBrigadeCounts.get(shift.brigadeId) ?? 0) + 1);
      }
    }

    const dayCount = finalDayCounts.get(day) ?? 0;
    const nightCount = finalNightCounts.get(day) ?? 0;

    if (dayCount !== 13) {
      staffingValid = false;
      reasons.push(dateOf(year, month, day) + " дневная укомплектованность: " + dayCount + " вместо 13.");
    }
    if (nightCount !== 13) {
      staffingValid = false;
      reasons.push(dateOf(year, month, day) + " ночная укомплектованность: " + nightCount + " вместо 13.");
    }

    for (const [brigadeId, required] of staffing.required) {
      const dayActual = dayBrigadeCounts.get(brigadeId) ?? 0;
      const nightActual = nightBrigadeCounts.get(brigadeId) ?? 0;
      const brigadeNumber = brigades.find(b => b.id === brigadeId)?.number ?? brigadeId;

      if (dayActual !== required) {
        staffingValid = false;
        reasons.push(dateOf(year, month, day) + " бригада " + brigadeNumber +
          " днём: " + dayActual + " вместо " + required + ".");
      }
      if (nightActual !== required) {
        staffingValid = false;
        reasons.push(dateOf(year, month, day) + " бригада " + brigadeNumber +
          " ночью: " + nightActual + " вместо " + required + ".");
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

  // Hard safety/fairness checks for generated patterns.
  for (const e of employees) {
    const own = shifts.filter(s => s.employeeId === e.id).sort((a, b) => a.day - b.day);
    for (let i = 1; i < own.length; i++) {
      const prev = own[i - 1];
      const cur = own[i];
      if (prev.label === "12Н" && cur.day === prev.day + 1 &&
          (cur.label === "12Д" || cur.label === "8–17" || cur.label === "24")) {
        staffingValid = false;
        reasons.push(e.full_name + ": запрещена дневная смена сразу после ночной.");
      }
      if (e.work_schedule_type === "24/3" && prev.label === "24" && cur.label === "24" &&
          cur.day - prev.day < 4) {
        staffingValid = false;
        reasons.push(e.full_name + ": нарушен цикл 24/3.");
      }
    }

    if (e.work_schedule_type === "day_night_2_off") {
      let run = 0;
      for (let d = 1; d <= days; d++) {
        if (own.some(s => s.day === d)) {
          run++;
          if (run > 2) {
            staffingValid = false;
            reasons.push(e.full_name + ": более двух рабочих дней подряд у 12-часового графика.");
            break;
          }
        } else {
          run = 0;
        }
      }
    }
  }

  return {
    shifts,
    cells,
    vacancyCount: vacancyCount,
    filledVacancyCount: filled,
    unfilledVacancyCount: vacancyCount,
    staffingValid,
    reasons
  };
}
