-- Remove somente orçamentos cancelados sem venda ou título financeiro.
-- Itens e acompanhamentos são removidos por ON DELETE CASCADE.
-- Pedidos/vendas e documentos financeiros permanecem intactos.
DELETE FROM app_live.work_orders o
WHERE o.status = 'CANCELADO'
  AND o.sale_date IS NULL
  AND NOT EXISTS (SELECT 1 FROM app_live.receivables r WHERE r.work_order_id = o.id)
  AND NOT EXISTS (SELECT 1 FROM app_live.financial_events e WHERE e.source_type = 'WORK_ORDER' AND e.source_id = o.id)
  AND NOT EXISTS (SELECT 1 FROM app_live.inventory_movements m WHERE m.source_type = 'WORK_ORDER' AND m.source_id = o.id);
