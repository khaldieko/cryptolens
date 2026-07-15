import { createContext, useContext, useState, ReactNode } from "react";

interface AuthState {
  token: string | null;
  setToken: (t: string | null) => void;
}

const AuthContext = createContext<AuthState>({ token: null, setToken: () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(() => localStorage.getItem("cl_token"));

  const setToken = (t: string | null) => {
    if (t) localStorage.setItem("cl_token", t);
    else localStorage.removeItem("cl_token");
    setTokenState(t);
  };

  return <AuthContext.Provider value={{ token, setToken }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
