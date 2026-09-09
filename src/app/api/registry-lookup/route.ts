import { NextResponse } from "next/server";
import { isValidCnpj } from "@/lib/registries";

const digits = (value:string|null) => (value ?? "").replace(/\D/g, "");

export async function GET(request:Request) {
  const params = new URL(request.url).searchParams;
  const type = params.get("type");
  const value = digits(params.get("value"));
  try {
    if (type === "cep") {
      if (value.length !== 8) return NextResponse.json({ error:"Informe um CEP com 8 dígitos." }, { status:400 });
      const response = await fetch(`https://viacep.com.br/ws/${value}/json/`, { cache:"no-store", signal:AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error("CEP_PROVIDER_ERROR");
      const data = await response.json() as Record<string,unknown>;
      if (data.erro) return NextResponse.json({ error:"CEP não encontrado." }, { status:404 });
      return NextResponse.json({ zipCode:value,street:data.logradouro??"",complement:data.complemento??"",district:data.bairro??"",city:data.localidade??"",state:data.uf??"" });
    }
    if (type === "cnpj") {
      if (!isValidCnpj(value)) return NextResponse.json({ error:"CNPJ inválido." }, { status:400 });
      const response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${value}`, { cache:"no-store", signal:AbortSignal.timeout(10000) });
      if (response.status === 404) return NextResponse.json({ error:"CNPJ não encontrado." }, { status:404 });
      if (!response.ok) throw new Error("CNPJ_PROVIDER_ERROR");
      const data = await response.json() as Record<string,unknown>;
      return NextResponse.json({
        document:value,name:data.nome_fantasia||data.razao_social||"",legalName:data.razao_social??"",
        stateRegistration:"",phone:data.ddd_telefone_1||data.ddd_telefone_2||"",email:data.email??"",
        zipCode:String(data.cep??"").replace(/\D/g,""),street:data.logradouro??"",addressNumber:data.numero??"",
        complement:data.complemento??"",district:data.bairro??"",city:data.municipio??"",state:data.uf??"",
      });
    }
    return NextResponse.json({ error:"Consulta inválida." }, { status:400 });
  } catch (error) {
    console.error("Falha em consulta cadastral", error);
    const message = type === "cep" ? "Não foi possível consultar o CEP agora." : "Não foi possível consultar o CNPJ agora.";
    return NextResponse.json({ error:message }, { status:502 });
  }
}
