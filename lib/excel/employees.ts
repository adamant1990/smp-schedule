import ExcelJS from "exceljs";

export type ImportedEmployee = {
  full_name: string;
  position: string;
  main_brigade_number: number | null;
  employment_start: string | null;
  employment_end: string | null;
  target_hours: number | null;
  can_extra_shifts: boolean;
};

function normalize(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/ё/g, "е");
}

function textValue(value: unknown): string {
  if (value && typeof value === "object" && "text" in value) {
    return String((value as { text?: unknown }).text ?? "").trim();
  }
  return String(value ?? "").trim();
}

function findColumn(headers: string[], variants: string[]): number {
  const normalized = headers.map(normalize);
  return normalized.findIndex((header) =>
    variants.some((variant) => header === normalize(variant))
  );
}

function getRowValues(row: ExcelJS.Row): unknown[] {
  const values = row.values;
  return Array.isArray(values) ? values.slice(1) : [];
}

function buildHeaderValues(sheet: ExcelJS.Worksheet, rowNumber: number): string[] {
  const row = sheet.getRow(rowNumber);
  const values = getRowValues(row).map((value) => textValue(value));

  for (let column = 1; column <= sheet.columnCount; column += 1) {
    if (values[column - 1]) continue;

    const cell = sheet.getCell(rowNumber, column);
    const master = cell.master;
    if (master && master.address !== cell.address) {
      values[column - 1] = textValue(master.value);
    }
  }

  return values;
}

function findHeaderRow(sheet: ExcelJS.Worksheet): { rowNumber: number; headers: string[] } {
  const variants = [
    "ФИО",
    "Ф. И. О.",
    "Фамилия Имя Отчество",
    "Полное ФИО",
    "Сотрудник"
  ].map(normalize);

  const maxRowsToScan = Math.min(sheet.rowCount, 30);

  for (let rowNumber = 1; rowNumber <= maxRowsToScan; rowNumber += 1) {
    const headers = buildHeaderValues(sheet, rowNumber);
    const hasNameHeader = headers.some((header) => variants.includes(normalize(header)));
    if (hasNameHeader) {
      return { rowNumber, headers };
    }
  }

  throw new Error("Не найден столбец «ФИО». Заголовок должен содержать «ФИО».");
}

function parseBrigade(value: unknown): number | null {
  const match = textValue(value).match(/(?:бр\.?\s*)?(?:бригада\s*)?(\d{1,2})/i);
  const number = match ? Number(match[1]) : Number(textValue(value));
  return Number.isInteger(number) && number >= 1 && number <= 8 ? number : null;
}

function findBrigadeColumn(
  sheet: ExcelJS.Worksheet,
  headers: string[],
  nameCol: number
): number {
  const explicitCol = findColumn(headers, ["Бригада", "Основная бригада"]);
  if (explicitCol >= 0) return explicitCol;

  // В исходном графике номер бригады находится слева от ФИО,
  // а ячейки с номером бригады объединены на несколько строк.
  // Ищем наиболее вероятную колонку среди столбцов слева от ФИО.
  let bestColumn = -1;
  let bestCount = 0;

  for (let column = 1; column <= nameCol; column += 1) {
    let count = 0;

    for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
      if (parseBrigade(sheet.getCell(rowNumber, column).value) !== null) {
        count += 1;
      }
    }

    if (count > bestCount) {
      bestCount = count;
      bestColumn = column - 1;
    }
  }

  return bestColumn;
}

function parseBoolean(value: unknown): boolean {
  const v = normalize(value);
  return ["да", "yes", "true", "1", "+", "может"].includes(v);
}

function isFeldsherPosition(value: unknown): boolean {
  const position = normalize(value);

  if (!position) return false;
  if (!position.includes("фельдшер")) return false;

  // Старшие фельдшеры не участвуют в обычном составе наряда.
  if (
    position.includes("старш") ||
    position.includes("ст.фельдшер") ||
    position.includes("ст. фельдшер")
  ) {
    return false;
  }

  return true;
}

function parseDate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  const raw = textValue(value);
  const match = raw.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/);
  if (match) {
    const [, day, month, year] = match;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return null;
}

function parseNumber(value: unknown): number | null {
  const raw = textValue(value).replace(",", ".");
  if (!raw) return null;

  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export async function parseEmployeesWorkbook(file: File): Promise<ImportedEmployee[]> {
  const workbook = new ExcelJS.Workbook();
  const buffer = await file.arrayBuffer();
  await workbook.xlsx.load(buffer);

  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("В Excel-файле нет листов.");

  const { rowNumber: headerRowNumber, headers } = findHeaderRow(sheet);

  const nameCol = findColumn(headers, [
    "ФИО",
    "Ф. И. О.",
    "Фамилия Имя Отчество",
    "Полное ФИО",
    "Сотрудник"
  ]);
  if (nameCol < 0) throw new Error("Не найден столбец «ФИО».");

  const positionCol = findColumn(headers, ["Должность", "Позиция"]);
  const brigadeCol = findBrigadeColumn(sheet, headers, nameCol);
  const startCol = findColumn(headers, ["Дата начала", "Начало работы", "Дата приема"]);
  const endCol = findColumn(headers, ["Дата окончания", "Окончание работы"]);
  const hoursCol = findColumn(headers, [
    "Норма времени",
    "Норма часов",
    "Часы",
    "Целевые часы",
    "Target hours"
  ]);
  const extraCol = findColumn(headers, [
    "Дополнительные смены",
    "Подработка",
    "Может брать дополнительные",
    "Доп. смены"
  ]);

  const result: ImportedEmployee[] = [];
  let currentBrigade: number | null = null;

  for (let rowNumber = headerRowNumber + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const values = getRowValues(row);

    if (brigadeCol >= 0) {
      const brigadeFromRow = parseBrigade(values[brigadeCol]);
      if (brigadeFromRow !== null) {
        currentBrigade = brigadeFromRow;
      }
    }

    const fullName = textValue(values[nameCol]);
    if (!fullName) continue;

    const position = positionCol >= 0 ? textValue(values[positionCol]) : "";
    if (!isFeldsherPosition(position)) continue;

    result.push({
      full_name: fullName,
      position: position || "Фельдшер",
      main_brigade_number: currentBrigade,
      employment_start: startCol >= 0 ? parseDate(values[startCol]) : null,
      employment_end: endCol >= 0 ? parseDate(values[endCol]) : null,
      target_hours: hoursCol >= 0 ? parseNumber(values[hoursCol]) : null,
      can_extra_shifts: extraCol >= 0 ? parseBoolean(values[extraCol]) : true
    });
  }

  return result;
}
