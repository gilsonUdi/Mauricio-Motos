import { NextResponse } from "next/server";
import { getTenantScope } from "@/lib/auth";
import { getPool } from "@/lib/db";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const channels = new Set(["WhatsApp", "Telefone", "Presencial", "E-mail", "Outro"]);
const outcomes = new Set(["AGUARDANDO", "PEDIU_ALTERACAO", "APROVOU", "RECUSOU", "SEM_RETORNO"]);
type Context = { params: Promise<{ id: string }> };

async function scopeAndId(context: Context) {
  const scope = await getTenantScope();
  const { id } = await context.params;
  return { scope, id };
}

export async function GET(_request: Request, context: Context) {
  const pool = getPool();
  if (!pool) return NextResponse.json({ error: "Banco não configurado." }, { status: 503 });
  const { scope, id } = await scopeAndId(context);
  if (!scope) return NextResponse.json({ error: "Selecione uma empresa." }, { status: 403 });
  if (!uuidPattern.test(id)) return NextResponse.json({ error: "Orçamento inválido." }, { status: 400 });
  try {
    const order = await pool.query(`SELECT 1 FROM app_live.work_orders WHERE id=$1::uuid AND company_id=$2::uuid`, [id,scope.companyId]);
    if (!order.rowCount) return NextResponse.json({ error: "Orçamento não encontrado." }, { status: 404 });
    const history = await pool.query(
      `SELECT f.id::text,f.contacted_at AS "contactedAt",f.channel,f.outcome,f.notes,
              f.next_follow_up_at AS "nextFollowUpAt",COALESCE(u.name,'Usuário removido') AS "actorName"
       FROM app_live.budget_follow_ups f LEFT JOIN app_live.app_users u ON u.id=f.actor_id
       WHERE f.work_order_id=$1::uuid AND f.company_id=$2::uuid ORDER BY f.contacted_at DESC LIMIT 30`,
      [id,scope.companyId],
    );
    return NextResponse.json({ history:history.rows });
  } catch (error) {
    console.error("Falha ao carregar retornos do orçamento", error);
    return NextResponse.json({ error: "Não foi possível carregar o histórico de retornos." }, { status: 500 });
  }
}

export async function POST(request: Request, context: Context) {
  const pool = getPool();
  if (!pool) return NextResponse.json({ error: "Banco não configurado." }, { status: 503 });
  const { scope, id } = await scopeAndId(context);
  if (!scope) return NextResponse.json({ error: "Selecione uma empresa." }, { status: 403 });
  if (!uuidPattern.test(id)) return NextResponse.json({ error: "Orçamento inválido." }, { status: 400 });
  let body: Record<string,unknown>;
  try { body = await request.json() as Record<string,unknown>; }
  catch { return NextResponse.json({ error: "Dados inválidos." }, { status: 400 }); }
  const channel = typeof body.channel === "string" && channels.has(body.channel) ? body.channel : "";
  const outcome = typeof body.outcome === "string" && outcomes.has(body.outcome) ? body.outcome : "";
  const notes = typeof body.notes === "string" ? body.notes.trim().slice(0,2000) || null : null;
  const nextValue = typeof body.nextFollowUpAt === "string" ? body.nextFollowUpAt : "";
  const nextDate = nextValue && Number.isFinite(Date.parse(nextValue)) ? new Date(nextValue).toISOString() : null;
  if (!channel || !outcome) return NextResponse.json({ error: "Informe o canal e o resultado do contato." }, { status: 400 });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const order = await client.query(`SELECT order_number,status FROM app_live.work_orders WHERE id=$1::uuid AND company_id=$2::uuid FOR UPDATE`, [id,scope.companyId]);
    if (!order.rowCount) throw new Error("ORDER_NOT_FOUND");
    if (order.rows[0].status !== "ORCAMENTO") throw new Error("ORDER_CLOSED");
    const inserted = await client.query(
      `INSERT INTO app_live.budget_follow_ups(company_id,work_order_id,actor_id,channel,outcome,notes,next_follow_up_at)
       VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7::timestamptz)
       RETURNING id::text,contacted_at AS "contactedAt",channel,outcome,notes,next_follow_up_at AS "nextFollowUpAt"`,
      [scope.companyId,id,scope.user?.id ?? null,channel,outcome,notes,nextDate],
    );
    const summary = await client.query(
      `UPDATE app_live.work_orders SET last_follow_up_at=now(),next_follow_up_at=$2::timestamptz,follow_up_count=follow_up_count+1,updated_at=now()
       WHERE id=$1::uuid RETURNING last_follow_up_at AS "lastFollowUpAt",next_follow_up_at AS "nextFollowUpAt",follow_up_count AS "followUpCount"`,
      [id,nextDate],
    );
    await client.query(
      `INSERT INTO app_live.audit_log(entity_type,entity_id,action,actor_id,details)
       VALUES('work_order',$1::uuid,'follow_up',$2::uuid,jsonb_build_object('order_number',$3::text,'channel',$4::text,'outcome',$5::text,'next_follow_up_at',$6::text,'company_id',$7::text))`,
      [id,scope.user?.id ?? null,order.rows[0].order_number,channel,outcome,nextDate,scope.companyId],
    );
    await client.query("COMMIT");
    return NextResponse.json({ event:{ ...inserted.rows[0],actorName:scope.user?.name ?? "Sistema" },...summary.rows[0] }, { status: 201 });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Falha ao registrar retorno do orçamento", error);
    const message = error instanceof Error && error.message === "ORDER_NOT_FOUND" ? "Orçamento não encontrado."
      : error instanceof Error && error.message === "ORDER_CLOSED" ? "Somente orçamentos em aberto aceitam novos retornos."
      : "Não foi possível registrar o retorno.";
    return NextResponse.json({ error:message }, { status:message === "Orçamento não encontrado." ? 404 : message.startsWith("Somente") ? 409 : 500 });
  } finally {
    client.release();
  }
}
