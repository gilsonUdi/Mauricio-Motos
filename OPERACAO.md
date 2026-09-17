# Operação e monitoramento

Documento da etapa 8 do `CONTEXTO_PROJETO.md`. Trata do que fazer depois do
corte: vigiar a disponibilidade, garantir backup restaurável, aplicar
migrations com segurança e voltar atrás em um deploy ruim.

## 1. Monitoramento de disponibilidade

A aplicação expõe `GET /api/health`, sem autenticação e sem dados da operação.

| Situação | HTTP | `status` |
| --- | --- | --- |
| Aplicação e PostgreSQL no ar | 200 | `ok` |
| Banco fora, recusando conexão ou acima de 5 s | 503 | `degraded` |
| `DATABASE_URL` ausente | 503 | `degraded` |

Resposta com o banco no ar:

```json
{"status":"ok","checkedAt":"...","database":{"ok":true,"latencyMs":61,"reason":null},"auth":{"configured":true}}
```

Como configurar o monitor externo:

- URL: `https://mauriciomotos.gsgestao.com.br/api/health`
- Intervalo de 1 a 5 minutos, alerta após duas falhas seguidas para não
  disparar em reinício de deploy.
- Alertar em qualquer código diferente de 200, inclusive timeout.
- O campo `latencyMs` serve para perceber o banco ficando lento antes de cair.

O motivo detalhado da falha vai para o log do servidor com o prefixo
`[health]`. A resposta pública fica genérica de propósito, porque o endpoint
não pede sessão.

Erros de backend continuam no log do container (`console.error`). No Easypanel,
acompanhe os logs do serviço da aplicação; falhas de conexão com o banco
aparecem tanto ali quanto no `/api/health`.

## 2. Backup e restauração

O backup é responsabilidade do serviço PostgreSQL no Easypanel, não da
aplicação. Confirme e registre:

- rotina automática diária ativa no serviço `mauricio-motos-db`;
- retenção acordada com o cliente;
- teste de restauração feito em banco separado, nunca sobre o de produção.

Roteiro do teste de restauração:

```bash
# 1. Dump do banco de produção (rede interna do Easypanel)
pg_dump "$DATABASE_URL" -Fc -f mauricio_motos.dump

# 2. Restaurar em um banco novo, só para validar o dump
createdb mauricio_motos_restore
pg_restore -d mauricio_motos_restore --no-owner mauricio_motos.dump

# 3. Conferir se os volumes batem com a produção
psql -d mauricio_motos_restore -c "SELECT
  (SELECT count(*) FROM app_live.customers)   AS clientes,
  (SELECT count(*) FROM app_live.products)    AS produtos,
  (SELECT count(*) FROM app_live.work_orders) AS ordens;"
```

Registre a data do último teste no item `backup_verified` da Central de
Prontidão. Nunca abra porta externa do PostgreSQL para isso: rode de dentro da
rede do Easypanel e feche qualquer porta temporária imediatamente depois.

## 3. Migrations com segurança

O banco de produção foi construído antes de existir controle de versão de
schema: a `001_app_live.sql` inclui a carga inicial a partir de `app_core`, a
camada da importação da planilha, e por isso **não** deve ser reexecutada. Por
isso o runner tem um modo de adoção.

```bash
npm run migrate -- --dry-run    # lista o pendente, não grava nada
npm run migrate -- --baseline   # marca o que existe como aplicado, sem executar
npm run migrate                 # aplica o pendente
```

Ordem de adoção, uma única vez, no banco atual:

1. `npm run migrate -- --dry-run` e confirmar que lista os arquivos existentes;
2. `npm run migrate -- --baseline`, que cria `app_live.schema_migrations` e
   registra os arquivos atuais sem rodá-los;
3. daí em diante, cada deploy roda `npm run migrate` antes de subir a aplicação.

Regras do runner:

- aplica em ordem de nome, uma transação por arquivo — se um falhar, nada dele
  é gravado e a execução para;
- guarda o checksum de cada arquivo aplicado;
- **recusa rodar** se um arquivo já aplicado foi editado depois. A correção é
  criar uma migration nova, não reescrever a antiga;
- avisa quando uma migration registrada não existe mais no repositório.

A aplicação continua garantindo a estrutura no primeiro acesso, o que mantém o
deploy atual funcionando. O runner não substitui isso; ele dá previsibilidade
para as mudanças de schema daqui em diante.

## 4. Rollback de deploy

O código é publicado a partir da branch `main` no GitHub.

1. Identificar o commit bom: `git log --oneline`.
2. Reverter criando um commit novo, sem reescrever história:
   `git revert --no-commit <commit_ruim>..HEAD && git commit && git push`.
3. Confirmar o novo deploy no Easypanel e checar `/api/health`.

Cuidados:

- **Migration não volta sozinha.** Reverter o código não desfaz alteração de
  schema já aplicada. Se a mudança ruim incluiu migration, escreva uma
  migration nova que desfaz o efeito e só então reverta o código.
- Nunca apagar linha de `app_live.schema_migrations` à mão para "rodar de
  novo": o arquivo original já rodou e o banco pode estar em estado misto.
- Antes de qualquer rollback em produção, tire um dump (seção 2).

## 5. Primeiros dias depois do corte

Rotina diária sugerida, toda com tela no sistema:

- **Central de Prontidão**: as verificações automáticas devem continuar em
  estado pronto; `integrity` em erro aponta venda, compra ou estorno quebrado.
- **Conferência**: zerar as divergências do dia; vendas sem contrapartida
  financeira aparecem aqui primeiro.
- **Estoque**: acompanhar as exceções autorizadas de venda sem estoque até a
  reposição.
- **Auditoria**: conferir cancelamentos, estornos e alterações de permissão.
- **DRG**: comparar o resultado do dia com o esperado pela operação.

Qualquer divergência que não se explique deve ser registrada antes de seguir,
para não virar saldo errado de abertura do mês.
