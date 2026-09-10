import { NextResponse } from "next/server";
import { ensureAuthSchema, getTenantScope, hasPermission } from "@/lib/auth";
import { getPool } from "@/lib/db";

const allowedPageSizes = new Set([25, 50, 100]);

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) =>
    /password|senha|secret|token|hash/i.test(key) ? [key, "[protegido]"] : [key, redact(item)],
  ));
}

export async function GET(request: Request) {
  const scope = await getTenantScope();
  if (!scope) return NextResponse.json({ error: "Selecione uma empresa." }, { status: 403 });
  if (scope.user && !hasPermission(scope.user, "auditoria")) return NextResponse.json({ error: "Acesso restrito." }, { status: 403 });

  const url = new URL(request.url);
  const search = url.searchParams.get("search")?.trim() ?? "";
  const entity = url.searchParams.get("entity")?.trim() ?? "";
  const action = url.searchParams.get("action")?.trim() ?? "";
  const actor = url.searchParams.get("actor")?.trim() ?? "";
  const from = url.searchParams.get("from")?.trim() ?? "";
  const to = url.searchParams.get("to")?.trim() ?? "";
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const requestedSize = Number(url.searchParams.get("pageSize")) || 50;
  const pageSize = allowedPageSizes.has(requestedSize) ? requestedSize : 50;

  const values: unknown[] = [scope.companyId];
  const where = ["a.company_id=$1::uuid"];
  const add = (condition: string, value: unknown) => { values.push(value); where.push(condition.replace("?", `$${values.length}`)); };
  if (search) add("(COALESCE(u.name,'') ILIKE '%'||?||'%' OR COALESCE(u.email,'') ILIKE '%'||?||'%' OR a.entity_type ILIKE '%'||?||'%' OR a.action ILIKE '%'||?||'%' OR a.details::text ILIKE '%'||?||'%')".replaceAll("?", `$${values.length + 1}`), search);
  if (entity) add("a.entity_type=?", entity);
  if (action) add("a.action=?", action);
  if (actor === "system") where.push("a.actor_id IS NULL");
  else if (actor) add("a.actor_id=?::uuid", actor);
  if (from) add("a.created_at>=?::date", from);
  if (to) add("a.created_at<?::date + interval '1 day'", to);

  try {
    await ensureAuthSchema();
    const pool = getPool()!;
    const predicate = where.join(" AND ");
    const [result, facets] = await Promise.all([
      pool.query(
        `SELECT a.id::text,a.entity_type,a.entity_id::text,a.action,a.details,a.created_at,
                u.id::text AS actor_id,u.name AS actor_name,u.email AS actor_email,
                count(*) OVER()::integer AS filtered_total
         FROM app_live.audit_log a
         LEFT JOIN app_live.app_users u ON u.id=a.actor_id
         WHERE ${predicate}
         ORDER BY a.created_at DESC,a.id DESC
         LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
        values,
      ),
      pool.query(
        `SELECT
          (SELECT count(*)::integer FROM app_live.audit_log WHERE company_id=$1::uuid) AS total,
          (SELECT count(*)::integer FROM app_live.audit_log WHERE company_id=$1::uuid AND created_at>=CURRENT_DATE) AS today,
          (SELECT count(DISTINCT actor_id)::integer FROM app_live.audit_log WHERE company_id=$1::uuid AND actor_id IS NOT NULL) AS actors,
          (SELECT COALESCE(json_agg(x ORDER BY x.label),'[]'::json) FROM (
             SELECT DISTINCT a.entity_type AS value,a.entity_type AS label FROM app_live.audit_log a WHERE a.company_id=$1::uuid
           ) x) AS entities,
          (SELECT COALESCE(json_agg(x ORDER BY x.label),'[]'::json) FROM (
             SELECT DISTINCT a.action AS value,a.action AS label FROM app_live.audit_log a WHERE a.company_id=$1::uuid
           ) x) AS actions,
          (SELECT COALESCE(json_agg(x ORDER BY x.label),'[]'::json) FROM (
             SELECT DISTINCT u.id::text AS value,u.name AS label FROM app_live.audit_log a JOIN app_live.app_users u ON u.id=a.actor_id WHERE a.company_id=$1::uuid
           ) x) AS actor_options`,
        [scope.companyId],
      ),
    ]);
    const total = Number(result.rows[0]?.filtered_total ?? 0);
    return NextResponse.json({
      events: result.rows.map((row) => ({
        id: row.id, entity_type: row.entity_type, entity_id: row.entity_id, action: row.action,
        details: redact(row.details), created_at: row.created_at, actor_id: row.actor_id,
        actor_name: row.actor_name, actor_email: row.actor_email,
      })),
      pagination: { page, pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)) },
      summary: facets.rows[0] ?? { total: 0, today: 0, actors: 0, entities: [], actions: [], actor_options: [] },
    });
  } catch (error) {
    console.error("Falha ao carregar auditoria", error);
    return NextResponse.json({ error: "Não foi possível carregar o histórico de alterações." }, { status: 500 });
  }
}
