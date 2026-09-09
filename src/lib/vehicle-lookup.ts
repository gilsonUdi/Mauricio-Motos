export const brazilianPlatePattern = /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/;

export function normalizePlate(value: string | null) {
  return (value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function text(value: unknown) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function year(value: unknown) {
  const parsed = Number.parseInt(text(value), 10);
  return Number.isFinite(parsed) && parsed > 1900 ? parsed : "";
}

export function normalizePlacaFipeResponse(payload: Record<string, unknown>) {
  const raw = (payload.informacoes_veiculo ?? payload) as Record<string, unknown>;
  return {
    plate: normalizePlate(text(raw.placa)),
    brand: text(raw.marca),
    model: text(raw.modelo),
    manufactureYear: year(raw.ano),
    modelYear: year(raw.ano_modelo),
    color: text(raw.cor),
    fuel: text(raw.combustivel),
    engineDisplacement: text(raw.cilindradas),
    registrationCity: text(raw.municipio),
    registrationState: text(raw.uf).toUpperCase(),
    plateLookupAt: new Date().toISOString(),
  };
}
