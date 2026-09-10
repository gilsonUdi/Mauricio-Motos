import { NextResponse } from "next/server";
import { defaultCompanyId, getTenantScope, hasPermission } from "@/lib/auth";
import { getPool } from "@/lib/db";

type Mapping = { code:string;label:string;coreTable:string;liveTable:string;coreKey:string;liveKey:string;coreValue?:string;liveValue?:string;valueLabel?:string };
const mappings:Mapping[]=[
  {code:"CUSTOMERS",label:"Clientes",coreTable:"customers",liveTable:"customers",coreKey:"customer_key",liveKey:"legacy_customer_key"},
  {code:"VEHICLES",label:"Veículos",coreTable:"vehicles",liveTable:"vehicles",coreKey:"vehicle_key",liveKey:"legacy_vehicle_key"},
  {code:"PRODUCTS",label:"Produtos",coreTable:"products",liveTable:"products",coreKey:"product_key",liveKey:"legacy_product_key",coreValue:"stock",liveValue:"current_stock",valueLabel:"Saldo de estoque"},
  {code:"MECHANICS",label:"Mecânicos",coreTable:"mechanics",liveTable:"mechanics",coreKey:"mechanic_id",liveKey:"legacy_mechanic_id"},
  {code:"ORDERS",label:"Ordens e orçamentos",coreTable:"service_orders",liveTable:"work_orders",coreKey:"order_key",liveKey:"legacy_order_key",coreValue:"total_value",liveValue:"total_value",valueLabel:"Valor total"},
  {code:"ORDER_ITEMS",label:"Itens das ordens",coreTable:"order_items",liveTable:"work_order_items",coreKey:"item_key",liveKey:"legacy_item_key"},
  {code:"RECEIVABLES",label:"Contas a receber",coreTable:"accounts_receivable",liveTable:"receivables",coreKey:"receivable_key",liveKey:"legacy_receivable_key",coreValue:"amount",liveValue:"amount",valueLabel:"Valor total"},
  {code:"INVENTORY",label:"Movimentos de estoque",coreTable:"inventory_movements",liveTable:"inventory_movements",coreKey:"movement_key",liveKey:"legacy_movement_key"},
  {code:"FINANCE",label:"Movimentos financeiros",coreTable:"finance_transactions",liveTable:"financial_transactions",coreKey:"finance_key",liveKey:"legacy_finance_key",coreValue:"amount",liveValue:"amount",valueLabel:"Valor total"},
];
const incompleteChecks=[
  {code:"CUSTOMER_CONTACT",label:"Clientes sem telefone e documento",query:`SELECT count(*)::integer AS count,COALESCE(json_agg(name ORDER BY name) FILTER (WHERE sample_rank<=8),'[]'::json) AS samples FROM (SELECT name,row_number() OVER(ORDER BY name) sample_rank FROM app_live.customers WHERE company_id=$1::uuid AND legacy_customer_key IS NOT NULL AND NULLIF(regexp_replace(COALESCE(phone,''),'\\D','','g'),'') IS NULL AND NULLIF(regexp_replace(COALESCE(document,''),'\\D','','g'),'') IS NULL) x`},
  {code:"VEHICLE_CUSTOMER",label:"Veículos sem cliente vinculado",query:`SELECT count(*)::integer AS count,COALESCE(json_agg(plate ORDER BY plate) FILTER (WHERE sample_rank<=8),'[]'::json) AS samples FROM (SELECT plate,row_number() OVER(ORDER BY plate) sample_rank FROM app_live.vehicles WHERE company_id=$1::uuid AND legacy_vehicle_key IS NOT NULL AND customer_id IS NULL) x`},
  {code:"VEHICLE_MODEL",label:"Veículos sem modelo",query:`SELECT count(*)::integer AS count,COALESCE(json_agg(plate ORDER BY plate) FILTER (WHERE sample_rank<=8),'[]'::json) AS samples FROM (SELECT plate,row_number() OVER(ORDER BY plate) sample_rank FROM app_live.vehicles WHERE company_id=$1::uuid AND legacy_vehicle_key IS NOT NULL AND NULLIF(trim(description),'') IS NULL) x`},
  {code:"PRODUCT_COST",label:"Produtos com estoque e sem custo",query:`SELECT count(*)::integer AS count,COALESCE(json_agg(name ORDER BY name) FILTER (WHERE sample_rank<=8),'[]'::json) AS samples FROM (SELECT name,row_number() OVER(ORDER BY name) sample_rank FROM app_live.products WHERE company_id=$1::uuid AND legacy_product_key IS NOT NULL AND current_stock>0 AND COALESCE(cost_price,0)<=0) x`},
  {code:"ORDER_CUSTOMER",label:"Ordens sem cadastro de cliente vinculado",query:`SELECT count(*)::integer AS count,COALESCE(json_agg(reference ORDER BY reference) FILTER (WHERE sample_rank<=8),'[]'::json) AS samples FROM (SELECT concat(order_number,' · ',customer_name) reference,row_number() OVER(ORDER BY budget_date DESC NULLS LAST) sample_rank FROM app_live.work_orders WHERE company_id=$1::uuid AND legacy_order_key IS NOT NULL AND customer_id IS NULL) x`},
  {code:"ORDER_ITEMS",label:"Ordens sem itens",query:`SELECT count(*)::integer AS count,COALESCE(json_agg(reference ORDER BY reference) FILTER (WHERE sample_rank<=8),'[]'::json) AS samples FROM (SELECT concat(o.order_number,' · ',o.customer_name) reference,row_number() OVER(ORDER BY o.budget_date DESC NULLS LAST) sample_rank FROM app_live.work_orders o WHERE o.company_id=$1::uuid AND o.legacy_order_key IS NOT NULL AND NOT EXISTS(SELECT 1 FROM app_live.work_order_items i WHERE i.work_order_id=o.id)) x`},
  {code:"ITEM_PRODUCT",label:"Itens de produto sem produto vinculado",query:`SELECT count(*)::integer AS count,COALESCE(json_agg(item_name ORDER BY item_name) FILTER (WHERE sample_rank<=8),'[]'::json) AS samples FROM (SELECT item_name,row_number() OVER(ORDER BY item_name) sample_rank FROM app_live.work_order_items i JOIN app_live.work_orders o ON o.id=i.work_order_id WHERE o.company_id=$1::uuid AND i.legacy_item_key IS NOT NULL AND i.product_id IS NULL AND lower(COALESCE(i.item_type,'')) NOT LIKE '%serv%') x`},
  {code:"RECEIVABLE_CUSTOMER",label:"Recebíveis sem cliente vinculado",query:`SELECT count(*)::integer AS count,COALESCE(json_agg(reference ORDER BY reference) FILTER (WHERE sample_rank<=8),'[]'::json) AS samples FROM (SELECT concat(COALESCE(customer_name,'Sem nome'),' · ',COALESCE(due_date::text,'Sem vencimento')) reference,row_number() OVER(ORDER BY due_date DESC NULLS LAST) sample_rank FROM app_live.receivables WHERE company_id=$1::uuid AND legacy_receivable_key IS NOT NULL AND customer_id IS NULL) x`},
  {code:"DUPLICATE_PLATE",label:"Placas duplicadas",query:`SELECT count(*)::integer AS count,COALESCE(json_agg(normalized_plate ORDER BY normalized_plate),'[]'::json) AS samples FROM (SELECT normalized_plate FROM app_live.vehicles WHERE company_id=$1::uuid AND NULLIF(normalized_plate,'') IS NOT NULL GROUP BY normalized_plate HAVING count(*)>1 LIMIT 8) x`},
];

function quoteIdentifier(value:string){return `"${value.replaceAll('"','""')}"`;}

export async function GET(){
  const scope=await getTenantScope();if(!scope)return NextResponse.json({error:"Selecione uma empresa."},{status:403});
  if(scope.user&&!hasPermission(scope.user,"conferencia"))return NextResponse.json({error:"Acesso restrito."},{status:403});
  if(scope.companyId!==defaultCompanyId)return NextResponse.json({applicable:false,checkedAt:new Date().toISOString(),message:"Esta empresa foi criada diretamente no novo sistema e não possui uma migração histórica do AppSheet."});
  try{
    const pool=getPool()!;
    const schemas=await pool.query(`SELECT to_regclass('app_core.customers') IS NOT NULL AS core_ready,to_regnamespace('appsheet_raw') IS NOT NULL AS raw_ready`);
    if(!schemas.rows[0]?.core_ready)return NextResponse.json({error:"O modelo histórico app_core ainda não está disponível neste banco."},{status:409});
    const comparisons=await Promise.all(mappings.map(async mapping=>{
      const valueSelect=mapping.coreValue&&mapping.liveValue?`,COALESCE((SELECT SUM(${mapping.coreValue}) FROM app_core.${mapping.coreTable}),0)::numeric AS core_value,COALESCE((SELECT SUM(${mapping.liveValue}) FROM app_live.${mapping.liveTable} WHERE company_id=$1::uuid AND ${mapping.liveKey} IS NOT NULL),0)::numeric AS live_value`:`,0::numeric AS core_value,0::numeric AS live_value`;
      const result=await pool.query(`SELECT (SELECT count(*) FROM app_core.${mapping.coreTable})::integer AS core_count,(SELECT count(*) FROM app_live.${mapping.liveTable} WHERE company_id=$1::uuid AND ${mapping.liveKey} IS NOT NULL)::integer AS live_count,(SELECT count(*) FROM app_core.${mapping.coreTable} c LEFT JOIN app_live.${mapping.liveTable} l ON l.company_id=$1::uuid AND l.${mapping.liveKey}=c.${mapping.coreKey}::text WHERE l.id IS NULL)::integer AS missing_count${valueSelect}`,[scope.companyId]);
      const row=result.rows[0];return{code:mapping.code,label:mapping.label,valueLabel:mapping.valueLabel??null,coreCount:Number(row.core_count),liveCount:Number(row.live_count),missingCount:Number(row.missing_count),coreValue:Number(row.core_value),liveValue:Number(row.live_value)};
    }));
    const incompleteResults=await Promise.all(incompleteChecks.map(check=>pool.query(check.query,[scope.companyId])));
    const incomplete=incompleteChecks.map((check,index)=>({code:check.code,label:check.label,count:Number(incompleteResults[index].rows[0]?.count??0),samples:incompleteResults[index].rows[0]?.samples??[]}));
    let rawTables:Array<{name:string;rows:number}>=[];
    if(schemas.rows[0]?.raw_ready){const listed=await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='appsheet_raw' AND table_type='BASE TABLE' ORDER BY table_name`);rawTables=await Promise.all(listed.rows.map(async row=>{const name=String(row.table_name);const result=await pool.query(`SELECT count(*)::integer AS count FROM appsheet_raw.${quoteIdentifier(name)}`);return{name,rows:Number(result.rows[0]?.count??0)};}));}
    const missing=comparisons.reduce((sum,item)=>sum+item.missingCount,0);const incompleteCount=incomplete.reduce((sum,item)=>sum+item.count,0);const valueDifferences=comparisons.filter(item=>item.valueLabel&&Math.abs(item.coreValue-item.liveValue)>0.01).length;
    return NextResponse.json({applicable:true,checkedAt:new Date().toISOString(),comparisons,incomplete,rawTables,summary:{datasets:comparisons.length,migrated:comparisons.reduce((sum,item)=>sum+item.liveCount,0),missing,incomplete:incompleteCount,valueDifferences,rawRows:rawTables.reduce((sum,item)=>sum+item.rows,0)}});
  }catch(error){console.error("Falha na reconciliação da migração",error);return NextResponse.json({error:"Não foi possível conferir a migração histórica."},{status:500});}
}
