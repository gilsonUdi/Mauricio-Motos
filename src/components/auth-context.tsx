"use client";
import { createContext, useContext, useEffect, useState } from "react";
import type { Permission } from "@/lib/auth-shared";

type AuthUser = { id: string; name: string; email: string; role: string; permissions: Permission[]; companyId:string|null; companyName?:string|null };
type AuthState = { enabled: boolean; user: AuthUser | null; loading: boolean };
const AuthContext = createContext<AuthState>({ enabled: false, user: null, loading: true });
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ enabled: false, user: null, loading: true });
  useEffect(() => { const controller = new AbortController(); fetch("/api/auth/me", { signal: controller.signal }).then(async (response) => { const payload = await response.json(); setState({ enabled: payload.enabled === true, user: response.ok ? payload.user ?? null : null, loading: false }); }).catch((error) => { if (error instanceof Error && error.name !== "AbortError") setState({ enabled: false, user: null, loading: false }); }); return () => controller.abort(); }, []);
  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}
export function useAuth() { return useContext(AuthContext); }
