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
