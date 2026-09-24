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

function parseBrigade(value: unknown): number | null {
  const match = textValue(value).match(/(?:бр\.?\s*)?(?:бригада\s*)?(\d{1,2})/i);
  const number = match ? Number(match[1]) : Number(textValue(value));
  return Number.isInteger(number) && number >= 1 && number <= 8 ? number : null;
}

function parseBoolean(value: unknown): boolean {
  const v = normalize(value);
  return ["да", "yes", "true", "1", "+", "может"].includes(v);
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

  const headerRow = sheet.getRow(1);
  const headers = getRowValues(headerRow).map((value) => textValue(value));

  const nameCol = findColumn(headers, ["ФИО", "Ф. И. О.", "Фамилия Имя Отчество", "Полное ФИО", "Сотрудник"]);
  if (nameCol < 0) throw new Error("Не найден столбец «ФИО».");

  const positionCol = findColumn(headers, ["Должность", "Позиция"]);
  const brigadeCol = findColumn(headers, ["Бригада", "Основная бригада"]);
  const startCol = findColumn(headers, ["Дата начала", "Начало работы", "Дата приема"]);
  const endCol = findColumn(headers, ["Дата окончания", "Окончание работы"]);
  const hoursCol = findColumn(headers, ["Норма часов", "Часы", "Целевые часы", "Target hours"]);
  const extraCol = findColumn(headers, ["Дополнительные смены", "Подработка", "Может брать дополнительные", "Доп. смены"]);

  const result: ImportedEmployee[] = [];

  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const values = getRowValues(row);
    const fullName = textValue(values[nameCol]);
    if (!fullName) continue;

    result.push({
      full_name: fullName,
      position: positionCol >= 0 ? textValue(values[positionCol]) || "Фельдшер" : "Фельдшер",
      main_brigade_number: brigadeCol >= 0 ? parseBrigade(values[brigadeCol]) : null,
      employment_start: startCol >= 0 ? parseDate(values[startCol]) : null,
      employment_end: endCol >= 0 ? parseDate(values[endCol]) : null,
      target_hours: hoursCol >= 0 ? parseNumber(values[hoursCol]) : null,
      can_extra_shifts: extraCol >= 0 ? parseBoolean(values[extraCol]) : true
    });
  }

  return result;
}
