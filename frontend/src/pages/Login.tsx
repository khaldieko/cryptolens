import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { login, register } from "../api/client";
import { useAuth } from "../context/AuthContext";

export default function Login() {
  const [mode, setMode] = useState<"signin" | "register">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { setToken } = useAuth();
  const navigate = useNavigate();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const fn = mode === "signin" ? login : register;
      const { token } = await fn(email, password);
      setToken(token);
      navigate("/");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100">
      <div className="w-full max-w-md bg-white rounded-2xl shadow p-8">
        <h1 className="text-2xl font-bold text-[#0B1B33] text-center">CryptoLens</h1>
        <p className="text-sm text-slate-500 text-center mb-6">Sign in to your risk dashboard</p>

        <div className="grid grid-cols-2 gap-2 mb-6">
          <button
            className={`py-2 rounded-lg text-sm font-semibold border ${mode === "signin" ? "bg-teal-50 border-teal-500 text-[#0B1B33]" : "border-slate-200 text-slate-500"}`}
            onClick={() => setMode("signin")}
          >
            Sign In
          </button>
          <button
            className={`py-2 rounded-lg text-sm font-semibold border ${mode === "register" ? "bg-teal-50 border-teal-500 text-[#0B1B33]" : "border-slate-200 text-slate-500"}`}
            onClick={() => setMode("register")}
          >
            Register
          </button>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <label className="block">
            <span className="text-xs text-slate-500">Email</span>
            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="text-xs text-slate-500">Password (min 8 chars)</span>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="w-full py-2.5 rounded-lg bg-[#0B1B33] text-white font-semibold text-sm disabled:opacity-60"
          >
            {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>
      </div>
    </div>
  );
}
