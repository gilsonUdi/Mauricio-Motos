import assert from "node:assert/strict";
import { test } from "node:test";
import { salePriceFromProfit } from "../src/lib/pricing";

test("preço de venda usa lucro percentual sobre o custo", () => {
  assert.equal(salePriceFromProfit(100, 30), 130);
  assert.equal(salePriceFromProfit(25.5, 20), 30.6);
  assert.equal(salePriceFromProfit(0, 30), 0);
});
