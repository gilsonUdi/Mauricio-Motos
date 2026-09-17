import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Acima disso o monitor considera o banco indisponível em vez de esperar. */
const DB_TIMEOUT_MS = 5_000;

async function checkDatabase() {
  const pool = getPool();
  if (!pool) return { ok: false, reason: "DATABASE_URL ausente" as string | null, latencyMs: null as number | null };
  const started = Date.now();
  try {
    // A consulta é trivial de propósito: mede conexão, não desempenho de query.
    await Promise.race([
      pool.query("SELECT 1"),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), DB_TIMEOUT_MS)),
    ]);
    return { ok: true, reason: null, latencyMs: Date.now() - started };
  } catch (error) {
    // O motivo é registrado no log do servidor; a resposta pública fica genérica
    // porque este endpoint não exige autenticação.
    console.error("[health] PostgreSQL indisponível", error);
    const timedOut = error instanceof Error && error.message === "timeout";
    return { ok: false, reason: timedOut ? "tempo de resposta excedido" : "conexão recusada", latencyMs: Date.now() - started };
  }
}

/**
 * Sonda de disponibilidade para o monitor externo.
 *
 * Sem autenticação e sem dados da operação: devolve apenas se a aplicação
 * responde e se o PostgreSQL está alcançável. Responde 200 quando tudo está no
 * ar e 503 quando o banco falha, para o monitor alertar sem precisar
 * interpretar o corpo.
 */
export async function GET() {
  const database = await checkDatabase();
  const body = {
    status: database.ok ? "ok" : "degraded",
    checkedAt: new Date().toISOString(),
    database: { ok: database.ok, latencyMs: database.latencyMs, reason: database.reason },
    auth: { configured: Boolean(process.env.AUTH_SECRET) },
  };
  return NextResponse.json(body, {
    status: database.ok ? 200 : 503,
    headers: { "cache-control": "no-store" },
  });
}
