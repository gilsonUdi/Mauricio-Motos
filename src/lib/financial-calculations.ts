export type FeeRuleInput = {
  minimumInstallments: number;
  maximumInstallments: number | null;
  feePercent: number;
};

export const roundMoney = (value: number) => Math.round((Number(value) || 0) * 100) / 100;

export function feePercentForInstallments(defaultFeePercent: number, variableFee: boolean, rules: FeeRuleInput[], installments: number) {
  if (!variableFee) return Number(defaultFeePercent) || 0;
  return Number(rules.find((rule) => installments >= rule.minimumInstallments && (rule.maximumInstallments === null || installments <= rule.maximumInstallments))?.feePercent ?? defaultFeePercent) || 0;
}

export function allowedInstallmentCounts(supportsInstallments: boolean, maximumInstallments: number, variableFee: boolean, rules: FeeRuleInput[]) {
  const maximum = supportsInstallments ? Math.max(1, Math.trunc(maximumInstallments) || 1) : 1;
  return Array.from({ length: maximum }, (_, index) => index + 1).filter((count) =>
    !variableFee || rules.some((rule) => count >= rule.minimumInstallments && (rule.maximumInstallments === null || count <= rule.maximumInstallments)),
  );
}

export function calculateCardAmounts(baseTotal: number, entryAmount: number, feePercent: number, customerAssumesFee: boolean) {
  const total = roundMoney(Math.max(0, baseTotal));
  const entry = roundMoney(Math.min(total, Math.max(0, entryAmount)));
  const validFee = Math.max(0, Number(feePercent) || 0);
  const grossUp = customerAssumesFee && validFee > 0 && validFee < 100;
  const divisor = grossUp ? 1 - validFee / 100 : 1;
  const chargedTotal = roundMoney(total / divisor);
  const chargedEntry = roundMoney(entry / divisor);
  const chargedBalance = roundMoney(chargedTotal - chargedEntry);
  const feeAmount = roundMoney(chargedTotal * validFee / 100);
  return { chargedTotal, chargedEntry, chargedBalance, feeAmount, netAmount: roundMoney(chargedTotal - feeAmount) };
}

export function addMonthsIso(date: string, offset: number) {
  const [year, month, day] = date.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + offset, 1, 12));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0, 12)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

export function splitCents(totalCents: number, count: number) {
  const safeTotal = Math.max(0, Math.trunc(totalCents));
  const safeCount = Math.max(1, Math.trunc(count));
  const base = Math.floor(safeTotal / safeCount);
  return Array.from({ length: safeCount }, (_, index) => base + (index === safeCount - 1 ? safeTotal % safeCount : 0));
}
