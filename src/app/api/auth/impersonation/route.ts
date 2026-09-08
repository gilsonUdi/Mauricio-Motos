import { NextResponse } from "next/server";
import { createSessionToken,ensureAuthSchema,getSessionUser,permissionIds,sessionCookie } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { uuidPattern } from "@/lib/registries";

const cookieOptions={httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax" as const,path:"/",maxAge:12*60*60};

export async function POST(request:Request){
  const actor=await getSessionUser();
  if(actor?.role!=="SUPER_ADMIN"||actor.impersonatedBy)return NextResponse.json({error:"Acesso restrito ao administrador da plataforma."},{status:403});
  let body:{companyId?:string};try{body=await request.json();}catch{return NextResponse.json({error:"Dados inválidos."},{status:400});}
  if(!body.companyId||!uuidPattern.test(body.companyId))return NextResponse.json({error:"Empresa inválida."},{status:400});
  try{
    await ensureAuthSchema();const pool=getPool()!;const company=await pool.query(`SELECT id::text,name FROM app_live.companies WHERE id=$1::uuid AND active`,[body.companyId]);
    if(!company.rowCount)return NextResponse.json({error:"Empresa não encontrada ou inativa."},{status:404});
    const row=company.rows[0];const token=createSessionToken({id:actor.id,name:actor.name,email:actor.email,role:"ADMIN",permissions:[...permissionIds],companyId:row.id,companyName:row.name,impersonatedBy:{id:actor.id,name:actor.name,email:actor.email}});
    await pool.query(`INSERT INTO app_live.audit_log(entity_type,entity_id,action,actor_id,details) VALUES('company',$1::uuid,'impersonation_started',$2::uuid,$3::jsonb)`,[row.id,actor.id,JSON.stringify({companyName:row.name})]);
    const response=NextResponse.json({ok:true});response.cookies.set(sessionCookie,token,cookieOptions);return response;
  }catch(error){console.error("Falha ao iniciar visualização administrativa",error);return NextResponse.json({error:"Não foi possível abrir o painel da empresa."},{status:500});}
}

export async function DELETE(){
  const user=await getSessionUser();if(!user?.impersonatedBy)return NextResponse.json({error:"Não existe visualização administrativa ativa."},{status:409});
  const admin=user.impersonatedBy;const token=createSessionToken({id:admin.id,name:admin.name,email:admin.email,role:"SUPER_ADMIN",permissions:[...permissionIds],companyId:null,companyName:null,impersonatedBy:null});
  const response=NextResponse.json({ok:true});response.cookies.set(sessionCookie,token,cookieOptions);return response;
}
