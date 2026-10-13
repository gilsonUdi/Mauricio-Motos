/** Acrescenta o percentual de lucro ao custo, arredondando para centavos. */
export function salePriceFromProfit(cost: number, profitPercent: number): number {
  const safeCost = Number.isFinite(cost) ? Math.max(0, cost) : 0;
  const safeProfit = Number.isFinite(profitPercent) ? Math.max(0, profitPercent) : 0;
  return Math.round((safeCost * (1 + safeProfit / 100) + Number.EPSILON) * 100) / 100;
}
