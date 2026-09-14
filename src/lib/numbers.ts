export function parseBrazilianNumber(value: unknown, fallback = 0) {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value !== "string") return fallback;

  const raw = value.trim().replace(/[^\d,.-]/g, "");
  if (!raw) return fallback;
  const negative = raw.startsWith("-");
  const unsigned = raw.replace(/-/g, "");
  const comma = unsigned.lastIndexOf(",");
  const dot = unsigned.lastIndexOf(".");
  let normalized = unsigned;

  if (comma >= 0 && dot >= 0) {
    const decimal = comma > dot ? "," : ".";
    normalized = unsigned
      .replace(decimal === "," ? /\./g : /,/g, "")
      .replace(decimal, ".");
  } else if (comma >= 0) {
    normalized = unsigned.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(unsigned)) {
    normalized = unsigned.replace(/\./g, "");
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? (negative ? -parsed : parsed) : fallback;
}

export function formatMoneyInput(value: string, allowNegative = false) {
  const negative = allowNegative && value.trim().startsWith("-");
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  const amount = Number(digits) / 100;
  const formatted = amount.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return negative && amount !== 0 ? `-${formatted}` : formatted;
}

export function numberToMoneyInput(value: unknown) {
  const parsed = parseBrazilianNumber(value);
  return parsed.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
