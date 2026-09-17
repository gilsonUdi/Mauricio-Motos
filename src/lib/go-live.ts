export const goLiveChecklist = [
  { key: "backup_verified", category: "INFRAESTRUTURA", label: "Backup automático configurado e restauração testada", description: "Registre a data do último teste de restauração nas observações." },
  { key: "production_domain", category: "INFRAESTRUTURA", label: "Domínio e HTTPS de produção validados", description: "Teste o acesso em redes e dispositivos diferentes." },
  { key: "users_reviewed", category: "ACESSOS", label: "Usuários, perfis e permissões revisados", description: "Remova acessos de teste e confirme as áreas de cada pessoa." },
  { key: "opening_balances", category: "DADOS", label: "Saldos financeiros iniciais conferidos", description: "Valide caixa, bancos, contas a pagar e contas a receber." },
  { key: "inventory_balances", category: "DADOS", label: "Estoque físico confrontado com o sistema", description: "Registre e justifique os ajustes antes do corte." },
  { key: "migration_reviewed", category: "DADOS", label: "Pendências da migração histórica revisadas", description: "Use a reconciliação do AppSheet e documente exceções aceitas." },
  { key: "sale_flow_tested", category: "TESTES", label: "Fluxo completo de venda testado", description: "Orçamento, aprovação, estoque, CMV, entrada, parcelas, taxas, recebimento e repasse da taxa ao cliente." },
  { key: "purchase_flow_tested", category: "TESTES", label: "Fluxo completo de compra testado", description: "Compra, custo médio, estoque, obrigação e pagamento." },
  { key: "reversal_flow_tested", category: "TESTES", label: "Cancelamentos e estornos testados", description: "Confirme que estoque e financeiro são revertidos sem duplicidade." },
  { key: "mobile_desktop_tested", category: "TESTES", label: "Uso validado em celular e computador", description: "Teste as telas principais nos equipamentos realmente usados pela oficina." },
  { key: "team_trained", category: "IMPLANTAÇÃO", label: "Equipe treinada no novo sistema", description: "Inclua atendimento, estoque, compras e financeiro." },
  { key: "parallel_operation", category: "IMPLANTAÇÃO", label: "Operação paralela concluída", description: "Compare o AppSheet e o novo sistema durante o período acordado." },
  { key: "cutover_date", category: "IMPLANTAÇÃO", label: "Data de corte definida e comunicada", description: "A partir desta data, novos lançamentos devem ocorrer somente no novo sistema." },
  { key: "appsheet_readonly", category: "IMPLANTAÇÃO", label: "AppSheet colocado em modo somente leitura", description: "Preserve a consulta histórica e impeça novos lançamentos duplicados." },
  { key: "appsheet_retired", category: "ENCERRAMENTO", label: "AppSheet desativado após o período de segurança", description: "Conclua somente após backup, conferência e aceite da operação." },
] as const;

export const goLiveScenarios = [
  { key: "budget_lifecycle", area: "ATENDIMENTO", title: "Orçamento completo", steps: "Cadastre cliente e veículo, crie o orçamento, gere o PDF, registre a aprovação e converta em pedido." },
  { key: "sale_finance", area: "VENDAS", title: "Venda, taxa e parcelamento", steps: "Feche uma venda com cartão, confira taxa, valor líquido, parcelas, conta a receber e evento no DRG." },
  { key: "stock_exception", area: "VENDAS", title: "Venda sem estoque", steps: "Tente vender item sem saldo, valide o bloqueio, confirme a exceção e confira o alerta até a reposição." },
  { key: "purchase_cycle", area: "COMPRAS", title: "Compra e custo médio", steps: "Confirme uma compra e confira estoque, custo médio ponderado, obrigação e pagamento." },
  { key: "receivable_settlement", area: "FINANCEIRO", title: "Recebimento", steps: "Baixe uma parcela e confira conta, forma de pagamento, taxa, valor líquido e saldo remanescente." },
  { key: "reversals", area: "CONTROLES", title: "Cancelamentos e estornos", steps: "Cancele venda e compra de teste e confirme a reversão de estoque, títulos e eventos financeiros sem duplicidade." },
  { key: "reports_and_drg", area: "RELATÓRIOS", title: "Relatórios e DRG", steps: "Compare vendas, compras, CMV, taxas e saldos do período com os lançamentos usados no teste." },
  { key: "access_control", area: "ACESSOS", title: "Permissões e isolamento", steps: "Teste perfis distintos e confirme que usuários não acessam áreas ou dados de outra empresa." },
] as const;

export type GoLiveTestStatus = "PENDENTE" | "APROVADO" | "REPROVADO" | "BLOQUEADO";

export const goLiveChecklistKeys = new Set<string>(goLiveChecklist.map((item) => item.key));
export const goLiveScenarioKeys = new Set<string>(goLiveScenarios.map((item) => item.key));
export const goLiveTestStatuses = new Set<GoLiveTestStatus>(["PENDENTE", "APROVADO", "REPROVADO", "BLOQUEADO"]);
