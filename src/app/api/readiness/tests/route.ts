import { NextResponse } from "next/server";
import { ensureAuthSchema, getTenantScope } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { goLiveScenarioKeys, goLiveTestStatuses, type GoLiveTestStatus } from "@/lib/go-live";

export async function PATCH(request: Request) {
  const scope = await getTenantScope();
  if (!scope) return NextResponse.json({ error: "Selecione uma empresa." }, { status: 403 });
  if (scope.user && scope.user.role !== "ADMIN") return NextResponse.json({ error: "Somente administradores podem registrar a homologação." }, { status: 403 });

  let body: { key?: string; status?: GoLiveTestStatus; notes?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Dados inválidos." }, { status: 400 }); }
  if (!body.key || !goLiveScenarioKeys.has(body.key) || !body.status || !goLiveTestStatuses.has(body.status)) {
    return NextResponse.json({ error: "Cenário ou resultado inválido." }, { status: 400 });
  }
  const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 2000) : "";
  if (body.status !== "PENDENTE" && !notes) {
    return NextResponse.json({ error: "Registre a evidência ou observação deste teste." }, { status: 400 });
  }

  try {
    await ensureAuthSchema();
    const pool = getPool()!;
    await pool.query(
      `INSERT INTO app_live.go_live_test_runs(company_id,scenario_key,status,notes,tested_by,tested_at,updated_at)
       VALUES($1::uuid,$2,$3,$4,$5::uuid,CASE WHEN $3='PENDENTE' THEN NULL ELSE now() END,now())
       ON CONFLICT(company_id,scenario_key) DO UPDATE SET status=EXCLUDED.status,notes=EXCLUDED.notes,tested_by=EXCLUDED.tested_by,tested_at=EXCLUDED.tested_at,updated_at=now()`,
      [scope.companyId, body.key, body.status, notes || null, scope.user?.id ?? null],
    );
    await pool.query(
      `INSERT INTO app_live.audit_log(entity_type,entity_id,action,actor_id,details)
       VALUES('company',$1::uuid,'go_live_test_updated',$2::uuid,jsonb_build_object('scenario',$3::text,'status',$4::text,'notes',$5::text,'companyId',$1::text))`,
      [scope.companyId, scope.user?.id ?? null, body.key, body.status, notes || null],
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Falha ao registrar homologação", error);
    return NextResponse.json({ error: "Não foi possível registrar o resultado do teste." }, { status: 500 });
  }
}
