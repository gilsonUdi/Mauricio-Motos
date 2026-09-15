import { NextResponse } from "next/server";
import { getTenantScope } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { uuidPattern } from "@/lib/registries";

const accountTypes=new Set(["CAIXA","BANCO","CARTEIRA","OUTRA"]);
const text=(value:unknown)=>typeof value==="string"?value.trim():"";

export async function GET(){
  const pool=getPool();if(!pool)return NextResponse.json({error:"Banco não configurado."},{status:503});
  const scope=await getTenantScope();if(!scope)return NextResponse.json({error:"Selecione uma empresa."},{status:403});
  try{
    const [accounts,methods,rules]=await Promise.all([
      pool.query(`SELECT a.id::text,a.name,a.account_type,a.opening_balance,a.active,
        a.opening_balance+COALESCE(SUM(CASE WHEN t.movement='ENTRADA' THEN t.amount ELSE -t.amount END),0) AS current_balance
        FROM app_live.financial_accounts a LEFT JOIN app_live.financial_transactions t ON t.financial_account_id=a.id AND t.company_id=a.company_id
        WHERE a.company_id=$1::uuid GROUP BY a.id ORDER BY a.active DESC,a.name`,[scope.companyId]),
      pool.query(`SELECT id::text,code,name,supports_installments,maximum_installments,variable_fee,default_fee_percent,default_account_id::text,active FROM app_live.payment_methods WHERE company_id=$1::uuid ORDER BY active DESC,name`,[scope.companyId]),
      pool.query(`SELECT r.id::text,r.payment_method_id::text,r.minimum_installments,r.maximum_installments,r.fee_percent FROM app_live.payment_fee_rules r JOIN app_live.payment_methods m ON m.id=r.payment_method_id WHERE m.company_id=$1::uuid ORDER BY r.minimum_installments`,[scope.companyId]),
    ]);
    return NextResponse.json({
      accounts:accounts.rows.map(row=>({id:row.id,name:row.name,type:row.account_type,openingBalance:Number(row.opening_balance),currentBalance:Number(row.current_balance),active:row.active})),
      methods:methods.rows.map(row=>({id:row.id,code:row.code,name:row.name,supportsInstallments:row.supports_installments,maximumInstallments:Number(row.maximum_installments??1),variableFee:row.variable_fee,defaultFeePercent:Number(row.default_fee_percent),defaultAccountId:row.default_account_id,active:row.active,rules:rules.rows.filter(rule=>rule.payment_method_id===row.id).map(rule=>({id:rule.id,minimumInstallments:rule.minimum_installments,maximumInstallments:rule.maximum_installments,feePercent:Number(rule.fee_percent)}))})),
    });
  }catch(error){console.error("Falha ao carregar configurações financeiras",error);return NextResponse.json({error:"Não foi possível carregar as configurações."},{status:500});}
}

export async function POST(request:Request){
  const pool=getPool();if(!pool)return NextResponse.json({error:"Banco não configurado."},{status:503});
  const scope=await getTenantScope();if(!scope)return NextResponse.json({error:"Selecione uma empresa."},{status:403});
  let body:Record<string,unknown>;try{body=await request.json() as Record<string,unknown>;}catch{return NextResponse.json({error:"Dados inválidos."},{status:400});}
  const entity=body.entity==="account"?"account":body.entity==="method"?"method":null;const name=text(body.name);
  if(!entity||!name)return NextResponse.json({error:"Informe o tipo e o nome do cadastro."},{status:400});
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    let inserted;
    if(entity==="account"){
      inserted=await client.query(`INSERT INTO app_live.financial_accounts(company_id,name,account_type,opening_balance) VALUES($1::uuid,$2,$3,$4) RETURNING id::text`,[scope.companyId,name,accountTypes.has(String(body.type))?body.type:"BANCO",Number(body.openingBalance)||0]);
    }else{
      const supportsInstallments=body.supportsInstallments===true;
      const maximumInstallments=supportsInstallments?Math.max(1,Math.min(120,Math.trunc(Number(body.maximumInstallments)||1))):1;
      const defaultAccountId=typeof body.defaultAccountId==="string"&&body.defaultAccountId?body.defaultAccountId:null;
      if(defaultAccountId&&(!uuidPattern.test(defaultAccountId)||!(await client.query(`SELECT 1 FROM app_live.financial_accounts WHERE id=$1::uuid AND company_id=$2::uuid`,[defaultAccountId,scope.companyId])).rowCount))throw new Error("ACCOUNT_NOT_FOUND");
      const variableFee=body.variableFee===true;
      const defaultFee=Number(body.defaultFeePercent)||0;
      const rules=Array.isArray(body.rules)?body.rules as Array<{minimumInstallments?:number;maximumInstallments?:number|null;feePercent?:number}>:[];
      const normalized=rules.map(rule=>({minimum:Math.trunc(Number(rule.minimumInstallments)||0),maximum:rule.maximumInstallments==null?null:Math.trunc(Number(rule.maximumInstallments)||0),fee:Number(rule.feePercent)||0})).sort((a,b)=>a.minimum-b.minimum);
      if(defaultFee<0||defaultFee>=100||normalized.some(rule=>rule.fee<0||rule.fee>=100))throw new Error("INVALID_FEE");
      if(variableFee&&(!normalized.length||normalized.some((rule,index)=>rule.minimum<1||rule.minimum>maximumInstallments||(rule.maximum!==null&&(rule.maximum<rule.minimum||rule.maximum>maximumInstallments))||(index>0&&(normalized[index-1].maximum===null||rule.minimum<=normalized[index-1].maximum!)))))throw new Error("INVALID_RULES");
      inserted=await client.query(`INSERT INTO app_live.payment_methods(company_id,name,supports_installments,maximum_installments,variable_fee,default_fee_percent,default_account_id) VALUES($1::uuid,$2,$3,$4,$5,$6,$7::uuid) RETURNING id::text`,[scope.companyId,name,supportsInstallments,maximumInstallments,variableFee,defaultFee,defaultAccountId]);
      for(const rule of variableFee?normalized:[])await client.query(`INSERT INTO app_live.payment_fee_rules(payment_method_id,minimum_installments,maximum_installments,fee_percent) VALUES($1::uuid,$2,$3,$4)`,[inserted.rows[0].id,rule.minimum,rule.maximum,rule.fee]);
    }
    await client.query(`INSERT INTO app_live.audit_log(entity_type,entity_id,action,actor_id,details) VALUES($1,$2::uuid,'created',$3::uuid,$4::jsonb)`,[entity==="account"?"financial_account":"payment_method",inserted.rows[0].id,scope.user?.id??null,JSON.stringify({name})]);
    await client.query("COMMIT");
    return NextResponse.json({id:inserted.rows[0].id},{status:201});
  }catch(error){await client.query("ROLLBACK");console.error("Falha ao criar configuração financeira",error);const duplicate=error instanceof Error&&"code" in error&&error.code==="23505";const code=error instanceof Error?error.message:"";const message=code==="INVALID_RULES"?"As faixas de parcelas são inválidas ou ultrapassam o limite cadastrado.":code==="INVALID_FEE"?"A taxa deve ser maior ou igual a zero e menor que 100%.":code==="ACCOUNT_NOT_FOUND"?"Conta financeira inválida.":duplicate?"Já existe um cadastro com esse nome.":"Não foi possível salvar.";return NextResponse.json({error:message},{status:code.startsWith("INVALID_")||code==="ACCOUNT_NOT_FOUND"?400:duplicate?409:500});}finally{client.release();}
}
