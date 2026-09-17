# Prompt de contexto — Maurício Motos

Use este documento ao retomar o desenvolvimento do projeto. Ele registra o estado atual e evita repetir etapas já concluídas.

## Objetivo

Substituir o AppSheet da Maurício Motos por uma aplicação web multiempresa, hospedada no Easypanel e conectada ao PostgreSQL. O novo sistema deve preservar o histórico importado e centralizar atendimento, orçamentos, vendas, compras, estoque, financeiro, DRG, cadastros, relatórios, auditoria e administração das empresas.

## Repositório e publicação

- Repositório local: `G:\Meu Drive\PROJETOS GS\CLIENTES\9 - SISTEMAS\mauricio-motos`
- Repositório remoto: `https://github.com/gilsonUdi/Mauricio-Motos.git`
- Branch principal: `main`
- Deploy: Easypanel, usando Node.js 22 e PostgreSQL.
- Regra do projeto: após cada mudança concluída, validar, fazer commit e push.
- Nunca substituir as variáveis existentes do Easypanel ao adicionar uma nova.

## Estado funcional atual

Já estão implementados:

- autenticação multi-tenant, painel de empresas, alteração de login e senha e visualização por impersonação administrativa;
- atendimento, orçamento, PDF, aprovação, validade, revisões, compartilhamento e acompanhamento comercial;
- clientes com validação de CPF/CNPJ e CEP, fornecedores com CNPJ/CEP, veículos, mecânicos e produtos/serviços;
- cadastro fiscal vigente e campos cadastrais da reforma tributária;
- compras, custo médio ponderado, estoque e cancelamento transacional de compras;
- conclusão financeira da venda, entrada, parcelas, contas, formas de pagamento e taxas de cartão;
- opção de a empresa ou o cliente assumir a taxa do cartão;
- venda sem estoque mediante confirmação explícita e alerta até a reposição;
- contas a pagar, contas a receber, baixas financeiras e DRG por competência;
- indicadores de estoque, relatórios operacionais, auditoria, conferência de integridade e reconciliação da migração;
- central de prontidão e homologação assistida com oito cenários obrigatórios por empresa;
- testes automatizados dos cálculos e validações críticas.

## Etapas pendentes — ordem recomendada

### 1. Publicar e validar a homologação assistida

- Fazer o deploy da versão mais recente no Easypanel.
- Confirmar a criação automática de `app_live.go_live_test_runs` ou executar `db/migrations/020_go_live_test_runs.sql` se necessário.
- Verificar a Central de Prontidão em desktop e celular.
- Confirmar que resultado, evidência, responsável e horário são gravados separadamente para cada empresa.

### 2. Executar a homologação com a Maurício Motos

Executar e registrar os oito roteiros disponíveis na Central de Prontidão:

1. orçamento completo;
2. venda, taxa e parcelamento;
3. venda sem estoque;
4. compra e custo médio;
5. recebimento;
6. cancelamentos e estornos;
7. relatórios e DRG;
8. permissões e isolamento entre empresas.

Qualquer cenário reprovado ou bloqueado deve gerar correção, novo teste e nova evidência antes do corte.

### 3. Conferir dados e saldos de abertura

- Resolver ou documentar as diferenças apresentadas em Reconciliação da Migração.
- Conferir estoque físico contra o PostgreSQL.
- Conferir caixa, bancos, contas a pagar e contas a receber na data escolhida para o corte.
- Corrigir cadastros incompletos ou registrar formalmente as exceções aceitas.
- Gerar e validar um backup restaurável antes do início da operação paralela.

### 4. Operação paralela e treinamento

- Definir um período curto de operação paralela entre AppSheet e novo sistema.
- Comparar diariamente vendas, compras, estoque, recebimentos, pagamentos e DRG.
- Treinar atendimento, estoque/compras, mecânicos e financeiro nos fluxos correspondentes.
- Revisar usuários, perfis e permissões; remover contas de teste.

### 5. Corte definitivo do AppSheet

- Definir e comunicar a data e o horário do corte.
- Fazer backup final e reconciliação imediatamente antes do corte.
- Colocar o AppSheet em modo somente leitura.
- Fazer novos lançamentos exclusivamente no sistema web.
- Manter o AppSheet apenas para consulta durante o período de segurança e desativá-lo somente após o aceite da operação.
- Documentar plano de retorno caso seja encontrada uma falha crítica no início da operação.

### 6. Consulta automática de veículo por placa — aguardando contratação

- O cadastro manual de veículos já funciona.
- A consulta automática foi retirada temporariamente porque depende de provedor/plano contratado.
- Antes de implementar, confirmar fornecedor, documentação, limites, custo, token e campos legalmente disponíveis.
- A credencial deverá ficar somente no backend/variáveis de ambiente, com timeout, tratamento de indisponibilidade e preenchimento revisável pelo usuário.

### 7. Emissão fiscal — depende de definição externa

- Os campos fiscais de produto e serviço já existem, mas o sistema ainda não calcula tributos nem emite documentos fiscais.
- Antes da implementação, definir com o contador e a empresa:
  - regime tributário e regras aplicáveis;
  - emissão de NF-e, NFC-e e/ou NFS-e;
  - provedor fiscal/API;
  - certificado digital e ambiente de homologação;
  - séries, numeração, CFOP, CST/CSOSN, NCM, NBS e códigos municipais;
  - regras e cronograma da reforma tributária.
- Implementar primeiro em homologação, com fila, idempotência, consulta de status, cancelamento, carta de correção quando aplicável e armazenamento de XML/PDF.

### 8. Operação e monitoramento pós-corte

- Configurar monitoramento de disponibilidade, erros do backend e falhas de conexão com PostgreSQL.
- Confirmar rotina automática de backup e realizar testes periódicos de restauração.
- Acompanhar auditoria, divergências da Conferência e exceções de estoque nos primeiros dias.
- Criar rotina de atualização segura de migrations e procedimento de rollback de deploy.

## Critério de conclusão do projeto

O AppSheet só pode ser considerado substituído quando:

- todas as verificações automáticas da Central de Prontidão estiverem em estado pronto;
- todos os cenários de homologação estiverem aprovados com evidência;
- o checklist operacional estiver completo;
- os saldos e históricos tiverem sido reconciliados;
- a equipe tiver operado o novo sistema no período paralelo;
- o AppSheet estiver somente para consulta e não houver pendência crítica durante o período de segurança.

As integrações de placa e emissão fiscal são extensões externas. Elas não devem bloquear o corte se a empresa aceitar formalmente o cadastro manual de veículos e a emissão fiscal fora do sistema durante a fase inicial.
