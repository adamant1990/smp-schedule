const sections = [
  ["📅","График","Основной месячный график"],
  ["👥","Сотрудники","ФИО, бригады и нормы"],
  ["🚑","Бригады","8 рабочих бригад"],
  ["🏖","Отсутствия","Отпуска, больничные и другие отсутствия"],
  ["💡","Пожелания","Ограничения и предпочтения"],
  ["⚠","Конфликты","Незакрытые смены и нарушения"],
  ["📊","Отчёты","Нагрузка и статистика"],
  ["📥","Excel","Импорт и экспорт"]
] as const;

export default function HomePage() {
  return (
    <main style={{maxWidth:1400,margin:"0 auto",padding:"32px 24px"}}>
      <header style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:20,marginBottom:28}}>
        <div>
          <div style={{fontSize:13,color:"#667085",marginBottom:6}}>СМП • ПЛАНИРОВАНИЕ</div>
          <h1 style={{margin:0,fontSize:32}}>График фельдшеров</h1>
          <p style={{color:"#667085",margin:"8px 0 0"}}>Автоматическое составление месячного графика</p>
        </div>
        <button style={{border:0,borderRadius:10,padding:"12px 18px",background:"#172033",color:"#fff",cursor:"pointer"}}>
          + Новый график
        </button>
      </header>
      <section style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(210px,1fr))",gap:14}}>
        {sections.map(([icon,title,description]) => (
          <article key={title} style={{background:"#fff",border:"1px solid #e4e7ec",borderRadius:14,padding:20,minHeight:130}}>
            <div style={{fontSize:24}}>{icon}</div>
            <h2 style={{fontSize:18,margin:"12px 0 6px"}}>{title}</h2>
            <p style={{fontSize:14,color:"#667085",margin:0}}>{description}</p>
          </article>
        ))}
      </section>
      <section style={{marginTop:24,background:"#fff",border:"1px solid #e4e7ec",borderRadius:14,padding:22}}>
        <h2 style={{marginTop:0}}>Этап 1 — фундамент</h2>
        <p style={{color:"#667085",lineHeight:1.6}}>
          Здесь будет выбор месяца, режима планирования и запуск генерации.
          Алгоритм «сутки через трое» будет отдельным модулем и не будет смешан с интерфейсом.
        </p>
      </section>
    </main>
  );
}
