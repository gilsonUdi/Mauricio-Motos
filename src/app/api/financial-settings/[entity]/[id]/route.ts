import { NextResponse } from "next/server";
import { getTenantScope } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { uuidPattern } from "@/lib/registries";

const accountTypes=new Set(["CAIXA","BANCO","CARTEIRA","OUTRA"]);
const text=(value:unknown)=>typeof value==="string"?value.trim():"";
type FeeRule={minimumInstallments?:number;maximumInstallments?:number|null;feePercent?:number};

export async function PATCH(request:Request,context:{params:Promise<{entity:string;id:string}>}){
  const pool=getPool();if(!pool)return NextResponse.json({error:"Banco não configurado."},{status:503});
  const scope=await getTenantScope();if(!scope)return NextResponse.json({error:"Selecione uma empresa."},{status:403});
  const {entity,id}=await context.params;if(!["account","method"].includes(entity)||!uuidPattern.test(id))return NextResponse.json({error:"Cadastro inválido."},{status:400});
  let body:Record<string,unknown>;try{body=await request.json() as Record<string,unknown>;}catch{return NextResponse.json({error:"Dados inválidos."},{status:400});}
  const name=text(body.name);if(!name)return NextResponse.json({error:"Informe o nome."},{status:400});
  const client=await pool.connect();
  try{
    await client.query("BEGIN");let result;
    if(entity==="account"){
      result=await client.query(`UPDATE app_live.financial_accounts SET name=$2,account_type=$3,opening_balance=$4,active=$5,updated_at=now() WHERE id=$1::uuid AND company_id=$6::uuid RETURNING id`,[id,name,accountTypes.has(String(body.type))?body.type:"BANCO",Number(body.openingBalance)||0,body.active!==false,scope.companyId]);
    }else{
      const defaultAccountId=typeof body.defaultAccountId==="string"&&uuidPattern.test(body.defaultAccountId)?body.defaultAccountId:null;
      if(defaultAccountId&&!(await client.query(`SELECT 1 FROM app_live.financial_accounts WHERE id=$1::uuid AND company_id=$2::uuid`,[defaultAccountId,scope.companyId])).rowCount)throw new Error("ACCOUNT_NOT_FOUND");
      const variableFee=body.variableFee===true;const rules=Array.isArray(body.rules)?body.rules as FeeRule[]:[];
      const normalized=rules.map(rule=>({minimum:Math.trunc(Number(rule.minimumInstallments)||0),maximum:rule.maximumInstallments==null?null:Math.trunc(Number(rule.maximumInstallments)||0),fee:Math.min(100,Math.max(0,Number(rule.feePercent)||0))})).sort((a,b)=>a.minimum-b.minimum);
      if(variableFee&&(!normalized.length||normalized.some((rule,index)=>rule.minimum<1||(rule.maximum!==null&&rule.maximum<rule.minimum)||(index>0&&(normalized[index-1].maximum===null||rule.minimum<=normalized[index-1].maximum!)))))throw new Error("INVALID_RULES");
      result=await client.query(`UPDATE app_live.payment_methods SET name=$2,supports_installments=$3,variable_fee=$4,default_fee_percent=$5,default_account_id=$6::uuid,active=$7,updated_at=now() WHERE id=$1::uuid AND company_id=$8::uuid RETURNING id`,[id,name,body.supportsInstallments===true,variableFee,Math.min(100,Math.max(0,Number(body.defaultFeePercent)||0)),defaultAccountId,body.active!==false,scope.companyId]);
      if(result.rowCount){await client.query(`DELETE FROM app_live.payment_fee_rules WHERE payment_method_id=$1::uuid`,[id]);for(const rule of variableFee?normalized:[])await client.query(`INSERT INTO app_live.payment_fee_rules(payment_method_id,minimum_installments,maximum_installments,fee_percent) VALUES($1::uuid,$2,$3,$4)`,[id,rule.minimum,rule.maximum,rule.fee]);}
    }
    if(!result.rowCount)throw new Error("NOT_FOUND");
    await client.query(`INSERT INTO app_live.audit_log(entity_type,entity_id,action,actor_id,details) VALUES($1,$2::uuid,'updated',$3::uuid,$4::jsonb)`,[entity==="account"?"financial_account":"payment_method",id,scope.user?.id??null,JSON.stringify({name})]);
    await client.query("COMMIT");return NextResponse.json({ok:true});
  }catch(error){await client.query("ROLLBACK");console.error("Falha ao atualizar configuração financeira",error);const code=error instanceof Error?error.message:"";const duplicate=error instanceof Error&&"code" in error&&error.code==="23505";const response=code==="INVALID_RULES"?{error:"As faixas de parcelas são inválidas ou estão sobrepostas.",status:400}:code==="ACCOUNT_NOT_FOUND"?{error:"Conta financeira inválida.",status:400}:code==="NOT_FOUND"?{error:"Cadastro não encontrado.",status:404}:duplicate?{error:"Já existe um cadastro com esse nome.",status:409}:{error:"Não foi possível atualizar.",status:500};return NextResponse.json({error:response.error},{status:response.status});}finally{client.release();}
}
