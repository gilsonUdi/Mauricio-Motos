import { createHash } from "node:crypto";

/**
 * Controle de migrations aplicadas.
 *
 * Os arquivos de `db/migrations` são idempotentes e a aplicação também garante
 * a estrutura no primeiro acesso, o que resolveu o deploy inicial. O que faltava
 * era saber o que já rodou: sem registro, não há como aplicar só o pendente nem
 * perceber que um arquivo já aplicado foi editado depois.
 */
export const migrationsTable = `CREATE TABLE IF NOT EXISTS app_live.schema_migrations (
  filename text PRIMARY KEY,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);`;

export function checksum(conteudo: string): string {
  // Normaliza a quebra de linha para o checksum não mudar por causa de CRLF.
  return createHash("sha256").update(conteudo.replace(/\r\n/g, "\n")).digest("hex");
}

export interface ArquivoMigration { filename: string; checksum: string }
export interface MigrationAplicada { filename: string; checksum: string }

export interface PlanoMigration {
  pendentes: ArquivoMigration[];
  /** Arquivo já aplicado cujo conteúdo mudou depois: exige decisão humana. */
  alteradas: ArquivoMigration[];
  /** Registrada no banco mas ausente no repositório. */
  ausentes: MigrationAplicada[];
}

/** Ordena pelo nome, que é o prefixo numérico das migrations. */
export function ordenar(arquivos: ArquivoMigration[]): ArquivoMigration[] {
  return [...arquivos].sort((a, b) => a.filename.localeCompare(b.filename, "en"));
}

export function planejar(arquivos: ArquivoMigration[], aplicadas: MigrationAplicada[]): PlanoMigration {
  const porNome = new Map(aplicadas.map((item) => [item.filename, item]));
  const nomesNoDisco = new Set(arquivos.map((item) => item.filename));
  const pendentes: ArquivoMigration[] = [];
  const alteradas: ArquivoMigration[] = [];

  for (const arquivo of ordenar(arquivos)) {
    const aplicada = porNome.get(arquivo.filename);
    if (!aplicada) pendentes.push(arquivo);
    else if (aplicada.checksum !== arquivo.checksum) alteradas.push(arquivo);
  }

  return { pendentes, alteradas, ausentes: aplicadas.filter((item) => !nomesNoDisco.has(item.filename)) };
}
