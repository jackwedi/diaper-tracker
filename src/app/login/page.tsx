"use client";

import { useActionState } from "react";
import { login } from "../actions";

export default function LoginPage() {
  const [error, action, pending] = useActionState(login, null);
  return (
    <main className="login">
      <form action={action} className="card">
        <h1>👶 Suivi bébé</h1>
        <label className="field">
          <span>Mot de passe</span>
          <input type="password" name="password" autoFocus required />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={pending}>
          {pending ? "…" : "Entrer"}
        </button>
      </form>
    </main>
  );
}
