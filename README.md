# Maurício Motos

Aplicação web para substituir gradualmente o AppSheet da oficina, preservando os dados históricos no PostgreSQL. Inclui atendimento e orçamentos, compras e estoque com custo médio, contas a pagar e receber, DRG gerencial, cadastros multiempresa e relatórios operacionais.

## Primeiro módulo

- painel de gestão de atendimento;
- lista e busca de ordens;
- detalhe de cliente, veículo, mecânico, produtos e serviços;
- transições entre orçamento, pedido, venda realizada e cancelamento;
- geração de orçamento em PDF para impressão ou envio ao cliente;
- área própria para acompanhar orçamentos, aprová-los e convertê-los em pedidos;
- registro de quem aprovou, canal, data e observações da aprovação;
- validade configurável e filtros de orçamentos vigentes e vencidos;
- criação de novas versões sem sobrescrever a proposta ou o histórico original;
- compartilhamento do PDF pelo celular ou WhatsApp Web, com data e quantidade de envios;
- histórico de contatos comerciais e agenda de próximos retornos por orçamento;
- auditoria pesquisável por empresa, período, módulo, ação e usuário;
- detalhes protegidos das alterações e comparação de dados antes/depois.
- conferência de integridade entre vendas, compras, estoque, CMV, contas e movimentos de caixa, sem correções automáticas.
- reconciliação da migração histórica entre `appsheet_raw`, `app_core` e `app_live`, com chaves faltantes, totais e cadastros incompletos.
- central de prontidão por empresa, com diagnóstico automático e checklist auditável para backup, testes, treinamento e desligamento gradual do AppSheet.

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

A conclusão de uma venda solicita entrada, parcelamento, vencimento, forma e conta, gerando as parcelas automaticamente com a taxa congelada. O módulo `/pagar` reúne obrigações de compras e lançamentos manuais, separa emissão, competência e vencimento e registra a baixa na conta financeira sem duplicar a despesa no DRG.

O demonstrativo `/drg` consolida receita bruta, descontos, impostos, receita líquida, CMV, lucro bruto, despesas por grupo e resultado líquido. Ele considera a data de competência e respeita as opções “Incluir no DRG” dos grupos e categorias financeiras.

O estoque calcula giro apenas a partir de vendas concluídas, cobertura em dias, ruptura e risco de ruptura usando estoque mínimo e prazo de reposição. O painel também mostra o valor atual a custo, o valor potencial de venda e a margem projetada do inventário.

Os cadastros de clientes e fornecedores validam CPF/CNPJ no backend. A consulta de CEP usa o ViaCEP e a consulta cadastral de CNPJ usa a BrasilAPI, sempre pelo backend para manter o formulário independente dos provedores externos.

O cadastro manual de veículos inclui marca, modelo, anos, cor, combustível, cilindrada e município/UF. A migração `db/migrations/009_vehicle_lookup.sql` documenta os novos campos e eles também são garantidos automaticamente no primeiro acesso autenticado após o deploy.
