import assert from "node:assert/strict";
import test from "node:test";
import { formatMoneyInput, numberToMoneyInput, parseBrazilianNumber } from "../src/lib/numbers";

test("interpreta valores brasileiros e internacionais", () => {
  assert.equal(parseBrazilianNumber("R$ 1.234,56"),1234.56);
  assert.equal(parseBrazilianNumber("1,234.56"),1234.56);
  assert.equal(parseBrazilianNumber("1.234"),1234);
});

test("formata dinheiro enquanto o usuário digita", () => {
  assert.equal(formatMoneyInput("123456"),"1.234,56");
  assert.equal(formatMoneyInput("-1234",true),"-12,34");
  assert.equal(numberToMoneyInput(9876.5),"9.876,50");
});
