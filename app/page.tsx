import Link from "next/link";

const sections = [
  ["📅", "График", "Основной месячный график", "/schedule"],
  ["👥", "Сотрудники", "ФИО, бригады и нормы", "/employees"],
  ["🚑", "Бригады", "8 рабочих бригад", "/brigades"],
  ["🏖", "Отсутствия", "Отпуска, больничные и другие отсутствия", "/absences"],
  ["💡", "Пожелания", "Ограничения и предпочтения", "/preferences"],
  ["⚠", "Конфликты", "Незакрытые смены и нарушения", "/conflicts"],
  ["📊", "Отчёты", "Нагрузка и статистика", "/reports"],
  ["📥", "Excel", "Импорт и экспорт", "/excel"]
] as const;

export default function HomePage() {
  return (
    <main className="page">
      <header className="topbar">
        <div>
          <div className="eyebrow">СМП • ПЛАНИРОВАНИЕ</div>
          <h1>График фельдшеров</h1>
          <p className="muted">Автоматическое составление месячного графика</p>
        </div>
        <button className="primary-button">+ Новый график</button>
      </header>

      <section className="dashboard-grid">
        {sections.map(([icon, title, description, href]) => (
          <Link href={href} className="dashboard-card" key={title}>
            <div className="dashboard-icon">{icon}</div>
            <h2>{title}</h2>
            <p>{description}</p>
          </Link>
        ))}
      </section>

      <section className="card" style={{ marginTop: 24 }}>
        <h2>Этап 2 — сотрудники и бригады</h2>
        <p className="muted" style={{ lineHeight: 1.6 }}>
          Настроены сотрудники и требования бригад. Сейчас система учитывает 13
          одновременных позиций: по 2 фельдшера в бригадах 1–5 и по 1 в бригадах 6–8.
        </p>
      </section>
    </main>
  );
}
