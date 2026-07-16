import { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const NAV = [
  { to: "/", label: "Dashboard", enabled: true },
  { to: "/portfolio", label: "Portfolio", enabled: true },
  { to: "/risk", label: "Risk Lab", enabled: false },
  { to: "/alerts", label: "Alerts", enabled: false },
];

export default function Layout({ title, children }: { title: string; children: ReactNode }) {
  const { setToken } = useAuth();

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <header className="bg-[#0B1B33] text-white px-6 py-4 flex items-center justify-between">
        <span className="font-bold text-lg">CryptoLens</span>
        <button onClick={() => setToken(null)} className="text-sm text-teal-300 hover:text-teal-200">
          Sign out
        </button>
      </header>

      <div className="flex flex-1">
        <aside className="w-52 border-r border-slate-200 bg-slate-50 p-3 space-y-1 hidden sm:block">
          {NAV.map(item =>
            item.enabled ? (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  `block rounded-lg px-3 py-2 text-sm font-medium ${
                    isActive
                      ? "bg-teal-50 text-[#0B1B33] border border-teal-500"
                      : "text-slate-500 hover:bg-slate-100"
                  }`
                }
              >
                {item.label}
              </NavLink>
            ) : (
              <div
                key={item.to}
                className="px-3 py-2 text-sm text-slate-300 cursor-not-allowed select-none"
                title="Coming in a later week"
              >
                {item.label}
                <span className="ml-2 text-[10px] uppercase tracking-wide">soon</span>
              </div>
            )
          )}
        </aside>

        <main className="flex-1 p-6 max-w-5xl">
          <h1 className="text-xl font-bold text-slate-800 mb-4">{title}</h1>
          {children}
        </main>
      </div>
    </div>
  );
}
