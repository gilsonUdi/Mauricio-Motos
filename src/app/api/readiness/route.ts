import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { ensureAuthSchema, getTenantScope, hasPermission } from "@/lib/auth";

const checklist=[
  {key:"backup_verified",category:"INFRAESTRUTURA",label:"Backup automático configurado e restauração testada",description:"Registre a data do último teste de restauração nas observações."},
  {key:"production_domain",category:"INFRAESTRUTURA",label:"Domínio e HTTPS de produção validados",description:"Teste o acesso em redes e dispositivos diferentes."},
  {key:"users_reviewed",category:"ACESSOS",label:"Usuários, perfis e permissões revisados",description:"Remova acessos de teste e confirme as áreas de cada pessoa."},
  {key:"opening_balances",category:"DADOS",label:"Saldos financeiros iniciais conferidos",description:"Valide caixa, bancos, contas a pagar e contas a receber."},
  {key:"inventory_balances",category:"DADOS",label:"Estoque físico confrontado com o sistema",description:"Registre e justifique os ajustes antes do corte."},
  {key:"migration_reviewed",category:"DADOS",label:"Pendências da migração histórica revisadas",description:"Use a reconciliação do AppSheet e documente exceções aceitas."},
  {key:"sale_flow_tested",category:"TESTES",label:"Fluxo completo de venda testado",description:"Orçamento, aprovação, estoque, CMV, parcelas e recebimento."},
  {key:"purchase_flow_tested",category:"TESTES",label:"Fluxo completo de compra testado",description:"Compra, custo médio, estoque, obrigação e pagamento."},
  {key:"reversal_flow_tested",category:"TESTES",label:"Cancelamentos e estornos testados",description:"Confirme que estoque e financeiro são revertidos sem duplicidade."},
  {key:"mobile_desktop_tested",category:"TESTES",label:"Uso validado em celular e computador",description:"Teste as telas principais nos equipamentos realmente usados pela oficina."},
  {key:"team_trained",category:"IMPLANTAÇÃO",label:"Equipe treinada no novo sistema",description:"Inclua atendimento, estoque, compras e financeiro."},
  {key:"parallel_operation",category:"IMPLANTAÇÃO",label:"Operação paralela concluída",description:"Compare o AppSheet e o novo sistema durante o período acordado."},
  {key:"cutover_date",category:"IMPLANTAÇÃO",label:"Data de corte definida e comunicada",description:"A partir desta data, novos lançamentos devem ocorrer somente no novo sistema."},
  {key:"appsheet_readonly",category:"IMPLANTAÇÃO",label:"AppSheet colocado em modo somente leitura",description:"Preserve a consulta histórica e impeça novos lançamentos duplicados."},
  {key:"appsheet_retired",category:"ENCERRAMENTO",label:"AppSheet desativado após o período de segurança",description:"Conclua somente após backup, conferência e aceite da operação."},
] as const;
const keys=new Set(checklist.map(item=>item.key));

export async function GET(){
  const started=Date.now();const scope=await getTenantScope();if(!scope)return NextResponse.json({error:"Selecione uma empresa."},{status:403});
  if(scope.user&&!hasPermission(scope.user,"conferencia"))return NextResponse.json({error:"Acesso restrito."},{status:403});
  try{await ensureAuthSchema();const pool=getPool()!;
    const [counts,saved]=await Promise.all([
      pool.query(`SELECT
        (SELECT count(*)::integer FROM app_live.app_users WHERE company_id=$1::uuid AND active AND role='ADMIN') AS admins,
        (SELECT count(*)::integer FROM app_live.financial_accounts WHERE company_id=$1::uuid AND active) AS accounts,
        (SELECT count(*)::integer FROM app_live.payment_methods WHERE company_id=$1::uuid AND active) AS methods,
        (SELECT count(*)::integer FROM app_live.financial_categories WHERE company_id=$1::uuid AND active) AS categories,
        (SELECT count(*)::integer FROM app_live.customers WHERE company_id=$1::uuid) AS customers,
        (SELECT count(*)::integer FROM app_live.products WHERE company_id=$1::uuid AND active) AS products,
        (SELECT count(*)::integer FROM app_live.products WHERE company_id=$1::uuid AND current_stock<0) AS negative_stock,
        (SELECT count(*)::integer FROM app_live.work_orders o WHERE o.company_id=$1::uuid AND o.status='VENDA_REALIZADA' AND o.financial_generated_at IS NOT NULL AND (NOT EXISTS(SELECT 1 FROM app_live.receivables r WHERE r.work_order_id=o.id AND r.status<>'CANCELADO') OR NOT EXISTS(SELECT 1 FROM app_live.financial_events e WHERE e.source_type='WORK_ORDER' AND e.source_id=o.id AND e.event_type='RECEITA_VENDA' AND e.reversed_at IS NULL))) AS broken_sales,
        (SELECT count(*)::integer FROM app_live.purchases p WHERE p.company_id=$1::uuid AND p.status='CONFIRMADA' AND NOT EXISTS(SELECT 1 FROM app_live.accounts_payable a WHERE a.purchase_id=p.id AND a.status<>'CANCELADO')) AS broken_purchases`,[scope.companyId]),
      pool.query(`SELECT c.item_key,c.completed,c.notes,c.completed_at,u.name AS completed_by_name FROM app_live.go_live_checklist c LEFT JOIN app_live.app_users u ON u.id=c.completed_by WHERE c.company_id=$1::uuid`,[scope.companyId]),
    ]);
    const row=counts.rows[0];const operationalIssues=Number(row.negative_stock)+Number(row.broken_sales)+Number(row.broken_purchases);
    const automatic=[
      {key:"database",label:"Conexão com PostgreSQL",status:"OK",detail:`Resposta em ${Date.now()-started} ms`},
      {key:"authentication",label:"Autenticação do portal",status:process.env.AUTH_SECRET&&process.env.DATABASE_URL?"OK":"ERRO",detail:process.env.AUTH_SECRET&&process.env.DATABASE_URL?"Credenciais do backend configuradas":"Variáveis obrigatórias ausentes"},
      {key:"administrators",label:"Administrador da empresa",status:Number(row.admins)>0?"OK":"ERRO",detail:`${row.admins} administrador(es) ativo(s)`},
      {key:"financial_setup",label:"Configuração financeira",status:Number(row.accounts)>0&&Number(row.methods)>0&&Number(row.categories)>0?"OK":"ATENCAO",detail:`${row.accounts} conta(s), ${row.methods} forma(s) e ${row.categories} categoria(s)`},
      {key:"catalogs",label:"Cadastros operacionais",status:Number(row.customers)>0&&Number(row.products)>0?"OK":"ATENCAO",detail:`${row.customers} cliente(s) e ${row.products} produto(s) ativo(s)`},
      {key:"integrity",label:"Integridade operacional básica",status:operationalIssues===0?"OK":"ERRO",detail:operationalIssues===0?"Nenhuma falha crítica básica":"Há ocorrências na área de Conferência"},
    ];
    const savedByKey=new Map(saved.rows.map(item=>[item.item_key,item]));const items=checklist.map(item=>({...item,...(savedByKey.get(item.key)??{completed:false,notes:null,completed_at:null,completed_by_name:null})}));
    const completed=items.filter(item=>item.completed).length;const automaticReady=automatic.filter(item=>item.status==="OK").length;
    return NextResponse.json({checkedAt:new Date().toISOString(),canEdit:!scope.user||scope.user.role==="ADMIN",automatic,items,summary:{automaticReady,automaticTotal:automatic.length,completed,total:items.length,percentage:Math.round(completed/items.length*100),ready:completed===items.length&&automaticReady===automatic.length}});
  }catch(error){console.error("Falha ao carregar prontidão",error);return NextResponse.json({error:"Não foi possível avaliar a prontidão da empresa."},{status:500});}
}

export async function PATCH(request:Request){
  const scope=await getTenantScope();if(!scope)return NextResponse.json({error:"Selecione uma empresa."},{status:403});
  if(scope.user&&scope.user.role!=="ADMIN")return NextResponse.json({error:"Somente administradores podem atualizar o checklist."},{status:403});
  let body:{key?:string;completed?:boolean;notes?:string};try{body=await request.json();}catch{return NextResponse.json({error:"Dados inválidos."},{status:400});}
  if(!body.key||!keys.has(body.key as never)||typeof body.completed!=="boolean")return NextResponse.json({error:"Item do checklist inválido."},{status:400});
  const notes=typeof body.notes==="string"?body.notes.trim().slice(0,1000):"";
  try{await ensureAuthSchema();const pool=getPool()!;await pool.query(`INSERT INTO app_live.go_live_checklist(company_id,item_key,completed,notes,completed_by,completed_at,updated_at) VALUES($1::uuid,$2,$3,$4,$5::uuid,CASE WHEN $3 THEN now() ELSE NULL END,now()) ON CONFLICT(company_id,item_key) DO UPDATE SET completed=EXCLUDED.completed,notes=EXCLUDED.notes,completed_by=EXCLUDED.completed_by,completed_at=EXCLUDED.completed_at,updated_at=now()`,[scope.companyId,body.key,body.completed,notes||null,scope.user?.id??null]);
    await pool.query(`INSERT INTO app_live.audit_log(entity_type,entity_id,action,actor_id,details) VALUES('company',$1::uuid,'readiness_updated',$2::uuid,jsonb_build_object('item',$3::text,'completed',$4::boolean,'notes',$5::text,'companyId',$1::text))`,[scope.companyId,scope.user?.id??null,body.key,body.completed,notes||null]);return NextResponse.json({ok:true});
  }catch(error){console.error("Falha ao atualizar prontidão",error);return NextResponse.json({error:"Não foi possível atualizar o checklist."},{status:500});}
}
