# Maurício Motos

Aplicação web para substituir gradualmente o AppSheet da oficina, preservando os dados históricos no PostgreSQL.

## Primeiro módulo

- painel de gestão de atendimento;
- lista e busca de ordens;
- detalhe de cliente, veículo, mecânico, produtos e serviços;
- transições entre orçamento, pedido, venda realizada e cancelamento;
- registro de alterações no banco.

Sem `DATABASE_URL`, a aplicação abre em modo de demonstração. Em produção, use o host interno do PostgreSQL no Easypanel.

## Estrutura de dados

- `appsheet_raw`: cópia fiel da planilha original;
- `app_core`: dados históricos tipados e reconciliados;
- `app_live`: modelo canônico utilizado pelo novo site.

Execute `db/migrations/001_app_live.sql` uma única vez no banco `mauricio_motos` antes de conectar a aplicação.
Para ativar o login, configure `AUTH_SECRET`, `AUTH_ADMIN_EMAIL`, `AUTH_ADMIN_PASSWORD` e, opcionalmente, `AUTH_ADMIN_NAME`. Essas credenciais pertencem ao administrador geral da plataforma, que cadastra as empresas e seus acessos no painel `/admin/empresas`. A estrutura multi-tenant também está documentada em `db/migrations/003_multitenancy.sql`.

## Fundação financeira

A migração `db/migrations/004_financial_foundation.sql` separa os eventos econômicos dos movimentos de caixa. Compras confirmadas atualizam o custo médio ponderado, geram entrada de estoque e uma obrigação em contas a pagar, mas não viram despesa do DRG novamente. Vendas concluídas congelam o custo do item, geram receita, CMV e conta a receber. As alterações são idempotentes e também são verificadas automaticamente no primeiro acesso autenticado após o deploy.

A migração `db/migrations/005_catalogs.sql` amplia produtos com dados fiscais e de reposição, cria o cadastro completo de fornecedores e instala um plano inicial de grupos e categorias financeiras para cada empresa. Novas empresas recebem esse plano automaticamente.

A migração `db/migrations/006_operational_finance.sql` cria contas financeiras, formas de pagamento e faixas de taxas por parcelamento. As baixas de contas a receber passam a registrar conta, forma, valor bruto, taxa e valor líquido sem duplicar a receita econômica da venda.
