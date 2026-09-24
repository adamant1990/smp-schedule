"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email,setEmail] = useState("");
  const [password,setPassword] = useState("");
  const [error,setError] = useState("");
  const [loading,setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      router.replace("/employees");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось выполнить вход");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="center-page">
      <form className="card auth-card" onSubmit={submit}>
        <div className="eyebrow">СМП • ПЛАНИРОВАНИЕ</div>
        <h1>Вход</h1>
        <p className="muted">Войдите в планировщик графика.</p>
        <label>Email<input type="email" value={email} onChange={e=>setEmail(e.target.value)} required autoComplete="email"/></label>
        <label>Пароль<input type="password" value={password} onChange={e=>setPassword(e.target.value)} required autoComplete="current-password"/></label>
        {error && <div className="error-box">{error}</div>}
        <button className="primary-button" disabled={loading}>{loading ? "Вход..." : "Войти"}</button>
      </form>
    </main>
  );
}
