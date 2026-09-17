/**
 * Aplica as migrations pendentes em ordem, uma transação por arquivo.
 *
 *   npm run migrate -- --dry-run    lista o que falta sem gravar nada
 *   npm run migrate -- --baseline   marca o que existe como aplicado, sem executar
 *   npm run migrate                 aplica o pendente
 *
 * Recusa rodar quando um arquivo já aplicado foi editado depois: nesse caso a
 * correção é criar uma migration nova, não reescrever a antiga.
 *
 * O `--baseline` existe porque o banco de produção foi construído antes deste
 * controle: a `001_app_live.sql` inclui a carga inicial a partir de `app_core`,
 * a camada da importação da planilha, e não deve ser reexecutada. Rode o
 * baseline uma única vez no banco atual; dali em diante as migrations novas
 * entram normalmente.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { checksum, migrationsTable, planejar, type ArquivoMigration, type MigrationAplicada } from "../src/lib/migrations";

const pasta = path.join(process.cwd(), "db", "migrations");
const dryRun = process.argv.includes("--dry-run");
const baseline = process.argv.includes("--baseline");

async function lerArquivos(): Promise<ArquivoMigration[]> {
  const nomes = (await readdir(pasta)).filter((nome) => nome.endsWith(".sql"));
  return Promise.all(nomes.map(async (filename) => ({
    filename,
    checksum: checksum(await readFile(path.join(pasta, filename), "utf8")),
  })));
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL não configurada. Exporte a URL interna do PostgreSQL antes de rodar.");
    process.exit(1);
  }

  const pool = new Pool({ connectionString, max: 2, connectionTimeoutMillis: 10_000 });
  try {
    await pool.query("CREATE SCHEMA IF NOT EXISTS app_live;");
    await pool.query(migrationsTable);
    const aplicadas = (await pool.query<MigrationAplicada>("SELECT filename, checksum FROM app_live.schema_migrations")).rows;
    const arquivos = await lerArquivos();
    const plano = planejar(arquivos, aplicadas);

    for (const item of plano.ausentes) {
      console.warn(`aviso: ${item.filename} está registrada no banco e não existe mais no repositório.`);
    }

    if (plano.alteradas.length) {
      console.error("As migrations abaixo já foram aplicadas e o conteúdo mudou depois:");
      for (const item of plano.alteradas) console.error(`  - ${item.filename}`);
      console.error("Crie uma migration nova com a correção em vez de editar a antiga.");
      process.exit(1);
    }

    if (!plano.pendentes.length) {
      console.log(`Nada pendente. ${aplicadas.length} migration(s) já aplicada(s).`);
      return;
    }

    if (baseline) {
      for (const item of plano.pendentes) {
        await pool.query(
          "INSERT INTO app_live.schema_migrations(filename,checksum) VALUES($1,$2) ON CONFLICT(filename) DO UPDATE SET checksum=EXCLUDED.checksum",
          [item.filename, item.checksum],
        );
        console.log(`marcada como aplicada sem executar: ${item.filename}`);
      }
      console.log(`Baseline concluído com ${plano.pendentes.length} migration(s). Confira se o schema atual já corresponde a elas.`);
      return;
    }

    console.log(`${plano.pendentes.length} migration(s) pendente(s):`);
    for (const item of plano.pendentes) console.log(`  - ${item.filename}`);
    if (dryRun) {
      console.log("Modo --dry-run: nada foi gravado.");
      return;
    }

    for (const item of plano.pendentes) {
      const sql = await readFile(path.join(pasta, item.filename), "utf8");
      const cliente = await pool.connect();
      try {
        await cliente.query("BEGIN");
        await cliente.query(sql);
        await cliente.query(
          "INSERT INTO app_live.schema_migrations(filename,checksum) VALUES($1,$2) ON CONFLICT(filename) DO UPDATE SET checksum=EXCLUDED.checksum,applied_at=now()",
          [item.filename, item.checksum],
        );
        await cliente.query("COMMIT");
        console.log(`aplicada: ${item.filename}`);
      } catch (error) {
        await cliente.query("ROLLBACK");
        console.error(`falhou em ${item.filename}; nada dessa migration foi gravado.`);
        throw error;
      } finally {
        cliente.release();
      }
    }
    console.log("Migrations aplicadas com sucesso.");
  } finally {
    await pool.end();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
