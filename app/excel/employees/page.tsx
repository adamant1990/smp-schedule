"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { parseEmployeesWorkbook, type ImportedEmployee } from "@/lib/excel/employees";

type PreviewEmployee = ImportedEmployee & { brigadeId: string | null; error?: string };

export default function ExcelEmployeesPage() {
  const [preview, setPreview] = useState<PreviewEmployee[]>([]);
  const [fileName, setFileName] = useState("");
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function handleFile(file: File) {
    setLoading(true);
    setError("");
    setMessage("");
    setFileName(file.name);

    try {
      const rows = await parseEmployeesWorkbook(file);
      const supabase = createClient();
      const { data: brigades, error: brigadeError } = await supabase
        .from("brigades")
        .select("id, number");

      if (brigadeError) throw brigadeError;

      const brigadeMap = new Map(
        (brigades ?? []).map((brigade) => [brigade.number, brigade.id as string])
      );

      setPreview(
        rows.map((row) => ({
          ...row,
          brigadeId: row.main_brigade_number
            ? brigadeMap.get(row.main_brigade_number) ?? null
            : null,
          error:
            row.main_brigade_number && !brigadeMap.has(row.main_brigade_number)
              ? "Бригада не найдена"
              : undefined
        }))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось прочитать Excel-файл.");
      setPreview([]);
    } finally {
      setLoading(false);
    }
  }

  async function importEmployees() {
    const invalid = preview.filter((row) => row.error);
    if (!preview.length || invalid.length) {
      setError("Исправьте строки с ошибками перед импортом.");
      return;
    }

    setImporting(true);
    setError("");
    setMessage("");

    try {
      const supabase = createClient();
      const payload = preview.map((row) => ({
        full_name: row.full_name,
        position: row.position,
        main_brigade_id: row.brigadeId,
        employment_start: row.employment_start,
        employment_end: row.employment_end,
        target_hours: row.target_hours,
        can_extra_shifts: row.can_extra_shifts,
        active: true
      }));

      const { error: insertError } = await supabase.from("employees").insert(payload);
      if (insertError) throw insertError;

      setMessage(`Импортировано сотрудников: ${payload.length}`);
      setPreview([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка импорта.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <main className="page">
      <header className="topbar">
        <div>
          <div className="eyebrow">СМП • EXCEL</div>
          <h1>Импорт сотрудников</h1>
          <p className="muted">Загрузите Excel-файл и сначала проверьте данные.</p>
        </div>
        <div className="actions">
          <Link href="/" className="secondary-button">← Главная</Link>
          <Link href="/employees" className="secondary-button">Сотрудники</Link>
        </div>
      </header>

      <section className="card">
        <h2>1. Выберите Excel-файл</h2>
        <p className="muted">Первый лист используется как таблица сотрудников. Столбец «ФИО» обязателен.</p>
        <input
          type="file"
          accept=".xlsx"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleFile(file);
          }}
        />
        {fileName && <p className="muted">Файл: {fileName}</p>}
      </section>

      <section className="card">
        <div className="section-title">
          <div>
            <h2>2. Проверка</h2>
            <p className="muted">До импорта данные не записываются в базу.</p>
          </div>
          <span className="badge">Строк: {preview.length}</span>
        </div>

        {loading ? (
          <p className="muted">Читаем Excel...</p>
        ) : preview.length ? (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>ФИО</th><th>Должность</th><th>Бригада</th><th>Норма</th><th>Доп. смены</th><th>Проверка</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((row, index) => (
                    <tr key={`${row.full_name}-${index}`}>
                      <td>{row.full_name}</td>
                      <td>{row.position}</td>
                      <td>{row.main_brigade_number ?? "—"}</td>
                      <td>{row.target_hours ?? "—"}</td>
                      <td>{row.can_extra_shifts ? "Да" : "Нет"}</td>
                      <td>{row.error ? <span className="status-off">{row.error}</span> : <span className="status-ok">OK</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="primary-button" style={{ marginTop: 16 }} disabled={importing || preview.some((row) => row.error)} onClick={() => void importEmployees()}>
              {importing ? "Импорт..." : "Импортировать сотрудников"}
            </button>
          </>
        ) : (
          <p className="muted">После выбора файла здесь появится предварительный просмотр.</p>
        )}

        {message && <div className="success-box">{message}</div>}
        {error && <div className="error-box">{error}</div>}
      </section>

      <section className="card">
        <h2>Поддерживаемые столбцы</h2>
        <p className="muted">
          ФИО, Должность, Бригада, Дата начала, Дата окончания, Норма часов,
          Дополнительные смены. Необязательные столбцы можно не заполнять.
        </p>
      </section>
    </main>
  );
}
