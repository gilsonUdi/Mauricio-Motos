import { NextResponse } from "next/server";
import { getTenantScope } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { uuidPattern } from "@/lib/registries";

const natures=new Set(["RECEITA","DESPESA","AMBOS"]);
export async function PATCH(request:Request,context:{params:Promise<{id:string}>}){
  const pool=getPool();if(!pool)return NextResponse.json({error:"Banco não configurado."},{status:503});
  const scope=await getTenantScope();if(!scope)return NextResponse.json({error:"Selecione uma empresa."},{status:403});
  const {id}=await context.params;if(!uuidPattern.test(id))return NextResponse.json({error:"Cadastro inválido."},{status:400});
  let body:Record<string,unknown>;try{body=await request.json() as Record<string,unknown>;}catch{return NextResponse.json({error:"Dados inválidos."},{status:400});}
  const entity=body.entity==="group"?"group":body.entity==="category"?"category":null;const name=typeof body.name==="string"?body.name.trim():"";const nature=natures.has(body.nature as string)?body.nature as string:"DESPESA";const includeInDrg=body.includeInDrg!==false;const active=body.active!==false;
  if(!entity||!name)return NextResponse.json({error:"Informe o tipo e o nome."},{status:400});
  const client=await pool.connect();
  try{
    await client.query("BEGIN");let result;
    if(entity==="group") result=await client.query(`UPDATE app_live.financial_category_groups SET name=$2,nature=$3,include_in_drg=$4,active=$5,updated_at=now() WHERE id=$1::uuid AND company_id=$6::uuid RETURNING id`,[id,name,nature,includeInDrg,active,scope.companyId]);
    else{const groupId=typeof body.groupId==="string"?body.groupId:"";if(!uuidPattern.test(groupId)||!(await client.query(`SELECT 1 FROM app_live.financial_category_groups WHERE id=$1::uuid AND company_id=$2::uuid`,[groupId,scope.companyId])).rowCount)throw new Error("GROUP_REQUIRED");result=await client.query(`UPDATE app_live.financial_categories SET group_id=$2::uuid,name=$3,nature=$4,include_in_drg=$5,active=$6,updated_at=now() WHERE id=$1::uuid AND company_id=$7::uuid RETURNING id`,[id,groupId,name,nature,includeInDrg,active,scope.companyId]);}
    if(!result.rowCount)throw new Error("NOT_FOUND");
    await client.query(`INSERT INTO app_live.audit_log(entity_type,entity_id,action,actor_id,details) VALUES($1,$2::uuid,'updated',$3::uuid,$4::jsonb)`,[entity==="group"?"financial_category_group":"financial_category",id,scope.user?.id??null,JSON.stringify({name,nature,includeInDrg,active})]);
    await client.query("COMMIT");return NextResponse.json({ok:true});
  }catch(error){await client.query("ROLLBACK");console.error("Falha ao atualizar categoria financeira",error);const known=error instanceof Error?error.message:"";const duplicate=error instanceof Error&&"code" in error&&error.code==="23505";return NextResponse.json({error:known==="GROUP_REQUIRED"?"Selecione um grupo válido.":known==="NOT_FOUND"?"Cadastro não encontrado.":duplicate?"Já existe um cadastro com esse nome.":"Não foi possível atualizar."},{status:known==="GROUP_REQUIRED"?400:known==="NOT_FOUND"?404:duplicate?409:500});}finally{client.release();}
}
