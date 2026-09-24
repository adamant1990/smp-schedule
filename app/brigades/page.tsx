"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type Brigade = {
  id: string;
  number: number;
  name: string;
  required_feldshers: number;
  active: boolean;
};

export default function BrigadesPage() {
  const [supabase, setSupabase] = useState<ReturnType<typeof createClient> | null>(null);
  const [brigades, setBrigades] = useState<Brigade[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function loadBrigades(client: ReturnType<typeof createClient>) {
    setLoading(true);
    setError("");

    const { data, error: loadError } = await client
      .from("brigades")
      .select("id, number, name, required_feldshers, active")
      .order("number");

    if (loadError) {
      setError(loadError.message);
      setBrigades([]);
    } else {
      setBrigades((data ?? []) as Brigade[]);
    }

    setLoading(false);
  }

  useEffect(() => {
    const client = createClient();
    setSupabase(client);
    void loadBrigades(client);
  }, []);

  async function saveRequirement(id: string, value: number) {
    if (!supabase) return;
    setSavingId(id);
    setError("");

    const { error: updateError } = await supabase
      .from("brigades")
      .update({ required_feldshers: value })
      .eq("id", id);

    if (updateError) {
      setError(updateError.message);
    } else {
      setBrigades((current) =>
        current.map((brigade) =>
          brigade.id === id
            ? { ...brigade, required_feldshers: value }
            : brigade
        )
      );
    }

    setSavingId(null);
  }

  const totalPositions = brigades
    .filter((brigade) => brigade.active)
    .reduce((sum, brigade) => sum + brigade.required_feldshers, 0);

  return (
    <main className="page">
      <header className="topbar">
        <div>
          <div className="eyebrow">СМП • НАСТРОЙКИ</div>
          <h1>Бригады</h1>
          <p className="muted">Требуемое количество фельдшеров одновременно</p>
        </div>
        <div className="actions">
          <Link href="/" className="secondary-button">← Главная</Link>
          <Link href="/employees" className="secondary-button">Сотрудники</Link>
        </div>
      </header>

      <section className="card">
        <div className="section-title">
          <div>
            <h2>Требования к составу</h2>
            <p className="muted">Эти значения будут использоваться при автоматическом составлении графика.</p>
          </div>
          <span className="badge">Всего позиций: {totalPositions}</span>
        </div>

        {loading ? (
          <p className="muted">Загрузка...</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>№</th>
                  <th>Бригада</th>
                  <th>Фельдшеров</th>
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>
                {brigades.map((brigade) => (
                  <tr key={brigade.id}>
                    <td>{brigade.number}</td>
                    <td>{brigade.name}</td>
                    <td>
                      <select
                        value={brigade.required_feldshers}
                        disabled={savingId === brigade.id}
                        onChange={(event) =>
                          void saveRequirement(
                            brigade.id,
                            Number(event.target.value)
                          )
                        }
                        style={{ width: 150 }}
                      >
                        <option value={1}>1 фельдшер</option>
                        <option value={2}>2 фельдшера</option>
                      </select>
                    </td>
                    <td>
                      {brigade.active ? (
                        <span className="status-ok">Активна</span>
                      ) : (
                        <span className="status-off">Отключена</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {error && <div className="error-box">{error}</div>}
      </section>
    </main>
  );
}
