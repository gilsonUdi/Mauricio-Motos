import { createHmac, timingSafeEqual } from "node:crypto";
import type { SessionUser } from "@/lib/auth-shared";

function signature(payload: string) { return createHmac("sha256", process.env.AUTH_SECRET || "disabled").update(payload).digest("base64url"); }
export function createSessionToken(user: Omit<SessionUser, "exp">) { const payload = Buffer.from(JSON.stringify({ ...user, exp: Date.now() + 12 * 60 * 60 * 1000 })).toString("base64url"); return `${payload}.${signature(payload)}`; }
export function verifySessionToken(token?: string | null): SessionUser | null { if (!token) return null; const [payload, received] = token.split("."); if (!payload || !received) return null; const expected = signature(payload); const left = Buffer.from(received); const right = Buffer.from(expected); if (left.length !== right.length || !timingSafeEqual(left, right)) return null; try { const user = JSON.parse(Buffer.from(payload, "base64url").toString()) as SessionUser; return user.exp > Date.now() ? user : null; } catch { return null; } }
