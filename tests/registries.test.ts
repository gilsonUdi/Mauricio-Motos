import assert from "node:assert/strict";
import test from "node:test";
import { isValidBrazilianDocument, isValidCnpj, isValidCpf, validateProductFiscalFields } from "../src/lib/registries";

test("valida CPF e rejeita sequências repetidas", () => {
  assert.equal(isValidCpf("52998224725"),true);
  assert.equal(isValidCpf("11111111111"),false);
  assert.equal(isValidBrazilianDocument("52998224725"),true);
});

test("valida CNPJ e rejeita dígito incorreto", () => {
  assert.equal(isValidCnpj("11222333000181"),true);
  assert.equal(isValidCnpj("11222333000182"),false);
});

test("valida campos fiscais essenciais", () => {
  assert.equal(validateProductFiscalFields({ncm:"12345678",ibsCbsCst:"123",cbsRate:"12,50"}),null);
  assert.equal(validateProductFiscalFields({ncm:"123"}),"NCM deve possuir 8 dígitos.");
  assert.equal(validateProductFiscalFields({cbsRate:101}),"Alíquota CBS deve ficar entre 0% e 100%.");
});
