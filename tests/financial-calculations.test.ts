import assert from "node:assert/strict";
import test from "node:test";
import { addMonthsIso, allowedInstallmentCounts, calculateCardAmounts, feePercentForInstallments, splitCents } from "../src/lib/financial-calculations";

test("seleciona a taxa correspondente à quantidade de parcelas", () => {
  const rules=[{minimumInstallments:1,maximumInstallments:3,feePercent:2.5},{minimumInstallments:4,maximumInstallments:null,feePercent:4.9}];
  assert.equal(feePercentForInstallments(1.2,true,rules,2),2.5);
  assert.equal(feePercentForInstallments(1.2,true,rules,8),4.9);
  assert.equal(feePercentForInstallments(1.2,false,rules,8),1.2);
});

test("lista somente parcelamentos que possuem regra cadastrada", () => {
  const rules=[{minimumInstallments:2,maximumInstallments:4,feePercent:3}];
  assert.deepEqual(allowedInstallmentCounts(true,6,true,rules),[2,3,4]);
  assert.deepEqual(allowedInstallmentCounts(false,12,false,[]),[1]);
});

test("calcula taxa assumida pela empresa", () => {
  assert.deepEqual(calculateCardAmounts(100,20,3,false),{chargedTotal:100,chargedEntry:20,chargedBalance:80,feeAmount:3,netAmount:97});
});

test("gross-up preserva o valor líquido quando o cliente assume a taxa", () => {
  assert.deepEqual(calculateCardAmounts(100,20,3,true),{chargedTotal:103.09,chargedEntry:20.62,chargedBalance:82.47,feeAmount:3.09,netAmount:100});
});

test("vencimentos mensais respeitam o último dia do mês", () => {
  assert.equal(addMonthsIso("2026-01-31",1),"2026-02-28");
  assert.equal(addMonthsIso("2028-01-31",1),"2028-02-29");
  assert.equal(addMonthsIso("2026-12-31",2),"2027-02-28");
});

test("parcelas em centavos sempre fecham o total", () => {
  const parts=splitCents(10000,3);
  assert.deepEqual(parts,[3333,3333,3334]);
  assert.equal(parts.reduce((sum,value)=>sum+value,0),10000);
});
