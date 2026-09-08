import { NextResponse } from "next/server";
import { getTenantScope } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { uuidPattern } from "@/lib/registries";

const natures = new Set(["RECEITA","DESPESA","AMBOS"]);
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";

export async function GET() {
  const pool=getPool(); if(!pool)return NextResponse.json({error:"Banco não configurado."},{status:503});
  const scope=await getTenantScope(); if(!scope)return NextResponse.json({error:"Selecione uma empresa."},{status:403});
  try {
    const [groups,categories]=await Promise.all([
      pool.query(`SELECT id::text,name,nature,include_in_drg,system_code,active FROM app_live.financial_category_groups WHERE company_id=$1::uuid ORDER BY active DESC,name`,[scope.companyId]),
      pool.query(`SELECT id::text,group_id::text,name,nature,include_in_drg,system_code,active FROM app_live.financial_categories WHERE company_id=$1::uuid ORDER BY active DESC,name`,[scope.companyId]),
    ]);
    return NextResponse.json({groups:groups.rows.map((group)=>({
      id:group.id,name:group.name,nature:group.nature,includeInDrg:group.include_in_drg,systemCode:group.system_code,active:group.active,
      categories:categories.rows.filter((category)=>category.group_id===group.id).map((category)=>({id:category.id,groupId:category.group_id,name:category.name,nature:category.nature,includeInDrg:category.include_in_drg,systemCode:category.system_code,active:category.active})),
    }))});
  } catch(error){console.error("Falha ao carregar categorias financeiras",error);return NextResponse.json({error:"Não foi possível carregar as categorias."},{status:500});}
}

export async function POST(request:Request){
  const pool=getPool();if(!pool)return NextResponse.json({error:"Banco não configurado."},{status:503});
  const scope=await getTenantScope();if(!scope)return NextResponse.json({error:"Selecione uma empresa."},{status:403});
  let body:Record<string,unknown>;try{body=await request.json() as Record<string,unknown>;}catch{return NextResponse.json({error:"Dados inválidos."},{status:400});}
  const entity=body.entity==="group"?"group":body.entity==="category"?"category":null;
  const name=text(body.name);const nature=natures.has(body.nature as string)?body.nature as string:"DESPESA";const includeInDrg=body.includeInDrg!==false;
  if(!entity||!name)return NextResponse.json({error:"Informe o tipo e o nome do cadastro."},{status:400});
  const client=await pool.connect();
  try{
    await client.query("BEGIN");let inserted;
    if(entity==="group") inserted=await client.query(`INSERT INTO app_live.financial_category_groups(company_id,name,nature,include_in_drg,active) VALUES($1::uuid,$2,$3,$4,true) RETURNING id::text`,[scope.companyId,name,nature,includeInDrg]);
    else{
      const groupId=text(body.groupId);if(!uuidPattern.test(groupId))throw new Error("GROUP_REQUIRED");
      const group=await client.query(`SELECT 1 FROM app_live.financial_category_groups WHERE id=$1::uuid AND company_id=$2::uuid AND active`,[groupId,scope.companyId]);if(!group.rowCount)throw new Error("GROUP_REQUIRED");
      inserted=await client.query(`INSERT INTO app_live.financial_categories(company_id,group_id,name,nature,include_in_drg,active) VALUES($1::uuid,$2::uuid,$3,$4,$5,true) RETURNING id::text`,[scope.companyId,groupId,name,nature,includeInDrg]);
    }
    await client.query(`INSERT INTO app_live.audit_log(entity_type,entity_id,action,actor_id,details) VALUES($1,$2::uuid,'created',$3::uuid,$4::jsonb)`,[entity==="group"?"financial_category_group":"financial_category",inserted.rows[0].id,scope.user?.id??null,JSON.stringify({name,nature,includeInDrg})]);
    await client.query("COMMIT");return NextResponse.json({id:inserted.rows[0].id},{status:201});
  }catch(error){await client.query("ROLLBACK");console.error("Falha ao criar categoria financeira",error);const group=error instanceof Error&&error.message==="GROUP_REQUIRED";const duplicate=error instanceof Error&&"code" in error&&error.code==="23505";return NextResponse.json({error:group?"Selecione um grupo válido.":duplicate?"Já existe um cadastro com esse nome.":"Não foi possível salvar."},{status:group?400:duplicate?409:500});}finally{client.release();}
}
