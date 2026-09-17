import assert from "node:assert/strict";
import test from "node:test";
import { goLiveChecklist, goLiveChecklistKeys, goLiveScenarios, goLiveScenarioKeys, goLiveTestStatuses } from "../src/lib/go-live";

test("checklist de implantação não possui chaves duplicadas", () => {
  assert.equal(goLiveChecklistKeys.size, goLiveChecklist.length);
  assert.ok(goLiveChecklist.every((item) => item.label && item.description && item.category));
});

test("homologação cobre os fluxos críticos sem chaves duplicadas", () => {
  assert.equal(goLiveScenarioKeys.size, goLiveScenarios.length);
  assert.deepEqual(
    new Set(goLiveScenarios.map((item) => item.area)),
    new Set(["ATENDIMENTO", "VENDAS", "COMPRAS", "FINANCEIRO", "CONTROLES", "RELATÓRIOS", "ACESSOS"]),
  );
});

test("resultados aceitos pela homologação são explícitos", () => {
  assert.deepEqual([...goLiveTestStatuses], ["PENDENTE", "APROVADO", "REPROVADO", "BLOQUEADO"]);
});
