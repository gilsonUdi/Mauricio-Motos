import assert from "node:assert/strict";
import test from "node:test";
import { checksum, ordenar, planejar } from "../src/lib/migrations";

const arquivo = (filename: string, conteudo: string) => ({ filename, checksum: checksum(conteudo) });

test("aplica somente o que ainda não rodou", () => {
  const arquivos = [arquivo("001_a.sql","create a"), arquivo("002_b.sql","create b"), arquivo("003_c.sql","create c")];
  const plano = planejar(arquivos, [{ filename:"001_a.sql", checksum: checksum("create a") }]);
  assert.deepEqual(plano.pendentes.map(i=>i.filename), ["002_b.sql","003_c.sql"]);
  assert.equal(plano.alteradas.length, 0);
});

test("acusa migration aplicada que foi editada depois", () => {
  const plano = planejar([arquivo("001_a.sql","create a corrigido")], [{ filename:"001_a.sql", checksum: checksum("create a") }]);
  assert.deepEqual(plano.alteradas.map(i=>i.filename), ["001_a.sql"]);
  assert.equal(plano.pendentes.length, 0);
});

test("avisa sobre migration registrada que saiu do repositório", () => {
  const plano = planejar([arquivo("001_a.sql","create a")], [
    { filename:"001_a.sql", checksum: checksum("create a") },
    { filename:"000_removida.sql", checksum:"x" },
  ]);
  assert.deepEqual(plano.ausentes.map(i=>i.filename), ["000_removida.sql"]);
});

test("nada pendente quando o banco está em dia", () => {
  const conteudo = "create a";
  const plano = planejar([arquivo("001_a.sql",conteudo)], [{ filename:"001_a.sql", checksum: checksum(conteudo) }]);
  assert.equal(plano.pendentes.length, 0);
  assert.equal(plano.alteradas.length, 0);
  assert.equal(plano.ausentes.length, 0);
});

test("ordena pelo prefixo numérico e ignora CRLF no checksum", () => {
  const nomes = ordenar([arquivo("020_t.sql","x"), arquivo("003_c.sql","x"), arquivo("001_a.sql","x")]).map(i=>i.filename);
  assert.deepEqual(nomes, ["001_a.sql","003_c.sql","020_t.sql"]);
  assert.equal(checksum("linha1\r\nlinha2"), checksum("linha1\nlinha2"));
});
