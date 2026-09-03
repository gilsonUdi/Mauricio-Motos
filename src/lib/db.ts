import { Pool } from "pg";

declare global {
  var mauricioMotosPool: Pool | undefined;
}

export function getPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return null;

  if (!global.mauricioMotosPool) {
    global.mauricioMotosPool = new Pool({
      connectionString,
      max: 8,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 8_000,
    });
  }

  return global.mauricioMotosPool;
}
