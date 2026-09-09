import { NextResponse } from "next/server";
import { isValidCnpj } from "@/lib/registries";
import { brazilianPlatePattern, normalizePlacaFipeResponse, normalizePlate } from "@/lib/vehicle-lookup";

const digits = (value:string|null) => (value ?? "").replace(/\D/g, "");

export async function GET(request:Request) {
  const params = new URL(request.url).searchParams;
  const type = params.get("type");
  const rawValue = params.get("value");
  const value = digits(rawValue);
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
    if (type === "plate") {
      const plate = normalizePlate(rawValue);
      if (!brazilianPlatePattern.test(plate)) {
        return NextResponse.json({ error:"Informe uma placa brasileira válida." }, { status:400 });
      }
      const token = process.env.PLACA_FIPE_API_TOKEN?.trim();
      if (!token) {
        return NextResponse.json({ error:"Consulta por placa ainda não configurada. Informe PLACA_FIPE_API_TOKEN no servidor." }, { status:503 });
      }
      const response = await fetch(process.env.PLACA_FIPE_API_URL?.trim() || "https://api.placafipe.com.br/getplaca", {
        method:"POST",
        headers:{ "Content-Type":"application/json", Accept:"application/json" },
        body:JSON.stringify({ placa:plate, token }),
        cache:"no-store",
        signal:AbortSignal.timeout(10000),
      });
      const data = await response.json().catch(() => ({})) as Record<string,unknown>;
      if (response.status === 404 || data.codigo === 0) {
        return NextResponse.json({ error:String(data.mensagem || "Placa não encontrada.") }, { status:404 });
      }
      if (!response.ok || !data.informacoes_veiculo) throw new Error("PLATE_PROVIDER_ERROR");
      return NextResponse.json(normalizePlacaFipeResponse(data));
    }
    return NextResponse.json({ error:"Consulta inválida." }, { status:400 });
  } catch (error) {
    console.error("Falha em consulta cadastral", error);
    const message = type === "cep" ? "Não foi possível consultar o CEP agora."
      : type === "cnpj" ? "Não foi possível consultar o CNPJ agora."
      : "Não foi possível consultar a placa agora.";
    return NextResponse.json({ error:message }, { status:502 });
  }
}
