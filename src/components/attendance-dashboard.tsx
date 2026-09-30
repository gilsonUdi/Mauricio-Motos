"use client";

import { Bike, CheckCircle2, ChevronDown, ClipboardList, ExternalLink, FileText, History, LoaderCircle, Pencil, Plus, RotateCcw, Search, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { OrderFormModal } from "@/components/order-form-modal";
import { SaleFinanceModal } from "@/components/sale-finance-modal";
import type { DashboardData, OrderStatus, SaleFinancialConfig, StockShortage, WorkOrder } from "@/lib/types";

type Filter = "TODOS" | "ORCAMENTO" | "PEDIDO" | "VENDA_REALIZADA";
type HistoryEntry = { id: string; number: string; status: OrderStatus; budgetDate?: string; saleDate?: string; plate?: string; model?: string; notes?: string; total: number; items: Array<{ name: string; quantity: number }> };
const pageSize = 100;
const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const labels: Record<OrderStatus, string> = { ORCAMENTO: "Orçamento", PEDIDO: "Pedido", VENDA_REALIZADA: "Concluído", CANCELADO: "Cancelado" };
const filters: Array<{ value: Filter; label: string }> = [
  { value: "TODOS", label: "Todos" }, { value: "ORCAMENTO", label: "Orçamentos" },
  { value: "PEDIDO", label: "Pedidos" }, { value: "VENDA_REALIZADA", label: "Concluídos" },
];

function formatDate(value?: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

function IconAction({ label, tone = "", disabled, onClick, children }: { label: string; tone?: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" className={`attendance-icon-action ${tone}`} title={label} aria-label={label} disabled={disabled} onClick={onClick}>{children}</button>;
}

export function AttendanceDashboard({ initialData }: { initialData: DashboardData }) {
  const [orders, setOrders] = useState(initialData.orders);
  const [filter, setFilter] = useState<Filter>("TODOS");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [hasMore, setHasMore] = useState(initialData.connected && initialData.orders.length >= pageSize);
  const [nextOffset, setNextOffset] = useState(initialData.orders.length);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [notice, setNotice] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<WorkOrder | null>(null);
  const [closingSale, setClosingSale] = useState<WorkOrder | null>(null);
  const [expandedId, setExpandedId] = useState("");
  const [expandedTab, setExpandedTab] = useState<"details" | "history">("details");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    if (!initialData.connected) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ search, status: filter, offset: "0" });
    setLoading(true);
    fetch(`/api/orders?${params}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Não foi possível carregar os atendimentos.");
        setOrders(payload.orders ?? []);
        setNextOffset((payload.orders ?? []).length);
        setHasMore(Boolean(payload.hasMore));
        setNotice("");
      })
      .catch((error) => { if (error?.name !== "AbortError") setNotice(error instanceof Error ? error.message : "Não foi possível carregar os atendimentos."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [filter, initialData.connected, search]);

  const visible = useMemo(() => initialData.connected ? orders : orders.filter((order) =>
    (filter === "TODOS" || order.status === filter) && `${order.number} ${order.customer} ${order.plate ?? ""} ${order.model ?? ""}`.toLocaleLowerCase("pt-BR").includes(search.toLocaleLowerCase("pt-BR")),
  ), [filter, initialData.connected, orders, search]);
  const expanded = visible.find((order) => order.id === expandedId);

  useEffect(() => {
    if (!expanded || expandedTab !== "history") return;
    if (!expanded.customerId || !initialData.connected) {
      setHistory(orders.filter((order) => order.customer === expanded.customer && order.id !== expanded.id).map((order) => ({ ...order, items: order.items })));
      setHistoryError("");
      return;
    }
    const controller = new AbortController();
    setHistoryLoading(true);
    setHistoryError("");
    fetch(`/api/orders/history?customerId=${encodeURIComponent(expanded.customerId)}&includeCanceled=true`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Não foi possível carregar o histórico.");
        setHistory((payload.orders ?? []).filter((entry: HistoryEntry) => entry.id !== expanded.id));
      })
      .catch((error) => { if (error?.name !== "AbortError") setHistoryError(error instanceof Error ? error.message : "Não foi possível carregar o histórico."); })
      .finally(() => { if (!controller.signal.aborted) setHistoryLoading(false); });
    return () => controller.abort();
  }, [expanded?.id, expanded?.customerId, expanded?.customer, expandedTab, initialData.connected]);

  async function loadMore() {
    if (loadingMore || !hasMore || !initialData.connected) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams({ search, status: filter, offset: String(nextOffset) });
      const response = await fetch(`/api/orders?${params}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Não foi possível carregar mais atendimentos.");
      setOrders((current) => [...current, ...(payload.orders ?? []).filter((entry: WorkOrder) => !current.some((order) => order.id === entry.id))]);
      setNextOffset((current) => current + (payload.orders ?? []).length);
      setHasMore(Boolean(payload.hasMore));
    } catch (error) { setNotice(error instanceof Error ? error.message : "Não foi possível carregar mais atendimentos."); }
    finally { setLoadingMore(false); }
  }

  function saved(order: WorkOrder) {
    setOrders((current) => [order, ...current.filter((entry) => entry.id !== order.id)]);
    setFilter("TODOS");
    setSearchInput("");
    setSearch("");
    setExpandedId(order.id);
    setExpandedTab("details");
    setCreating(false);
    setEditing(null);
    setNotice(`Orçamento ${order.number} salvo.`);
  }

  async function changeStatus(order: WorkOrder, status: "PEDIDO" | "VENDA_REALIZADA" | "CANCELADO", financial?: SaleFinancialConfig) {
    setBusyId(order.id);
    try {
      if (!initialData.connected) {
        setOrders((current) => status === "CANCELADO" ? current.filter((entry) => entry.id !== order.id) : current.map((entry) => entry.id === order.id ? { ...entry, status } : entry));
      } else {
        const response = await fetch(`/api/orders/${order.id}/status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, ...financial }) });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          const error = new Error(payload.error ?? "Não foi possível atualizar o pedido.") as Error & { stockShortages?: StockShortage[] };
          if (Array.isArray(payload.stockShortages)) error.stockShortages = payload.stockShortages;
          throw error;
        }
        setOrders((current) => status === "CANCELADO" ? current.filter((entry) => entry.id !== order.id) : current.map((entry) => entry.id === order.id ? {
          ...entry, ...payload, status,
          ...(status === "PEDIDO" ? { saleDate: undefined, stockWarningItems: [], paymentMethod: undefined, financialAccountName: undefined } : {}),
        } : entry));
      }
      if (status === "VENDA_REALIZADA") setClosingSale(null);
      if (status === "CANCELADO") setExpandedId("");
      setNotice(status === "CANCELADO" ? `Pedido ${order.number} cancelado.` : status === "PEDIDO" ? `Venda ${order.number} retornou a pedido.` : `Venda ${order.number} concluída.`);
    } catch (error) {
      if (financial) throw error;
      setNotice(error instanceof Error ? error.message : "Não foi possível atualizar o pedido.");
    } finally { setBusyId(""); }
  }

  async function cancelBudget(order: WorkOrder) {
    if (!window.confirm(`Excluir definitivamente o orçamento ${order.number}? Esta ação não poderá ser desfeita.`)) return;
    setBusyId(order.id);
    try {
      if (initialData.connected) {
        const response = await fetch(`/api/orders/${order.id}`, { method: "DELETE" });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error ?? "Não foi possível cancelar o orçamento.");
      }
      setOrders((current) => current.filter((entry) => entry.id !== order.id));
      if (expandedId === order.id) setExpandedId("");
      setNotice(`Orçamento ${order.number} cancelado e excluído.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Não foi possível cancelar o orçamento."); }
    finally { setBusyId(""); }
  }

  function cancelOrder(order: WorkOrder) {
    const warning = order.status === "VENDA_REALIZADA" ? "A venda será estornada no estoque e no financeiro. Se houver recebimentos, o cancelamento será bloqueado." : "O pedido será retirado da fila, mas seu registro ficará preservado.";
    if (window.confirm(`Cancelar o pedido ${order.number}? ${warning}`)) void changeStatus(order, "CANCELADO");
  }

  function openHistory(order: WorkOrder) {
    setExpandedId(order.id);
    setExpandedTab("history");
  }

  return <div className="app-shell">
    <AppSidebar active="atendimento" />
    <main className="workspace attendance-workspace">
      <header className="attendance-page-header">
        <div><p className="eyebrow">OFICINA</p><h1>Atendimento</h1><p>Orçamentos e pedidos em uma fila única, com as ações ao alcance de um clique.</p></div>
        <button type="button" className="primary-button" onClick={() => setCreating(true)}><Plus size={18} /> Novo orçamento</button>
      </header>
      {!initialData.connected && <p className="demo-pill">Prévia com dados de demonstração</p>}
      <section className="attendance-board" aria-label="Fila de atendimentos">
        <div className="attendance-toolbar">
          <label className="attendance-search"><Search size={18} aria-hidden="true" /><input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Procurar cliente, orçamento ou placa" aria-label="Procurar cliente, orçamento ou placa" /></label>
          <div className="attendance-filters" role="group" aria-label="Filtrar por situação">{filters.map((entry) => <button type="button" key={entry.value} className={filter === entry.value ? "active" : ""} aria-pressed={filter === entry.value} onClick={() => { setFilter(entry.value); setExpandedId(""); }}>{entry.label}</button>)}</div>
        </div>
        <div className="attendance-list-heading"><span>{loading ? "Buscando atendimentos..." : `${visible.length} atendimento(s) nesta lista`}</span><span>Ações rápidas</span></div>
        <div className="attendance-list">
          {visible.map((order) => <div className="attendance-entry" key={order.id}>
            <div className="attendance-row">
              <button type="button" className="attendance-row-main" aria-expanded={expandedId === order.id} onClick={() => { setExpandedId(expandedId === order.id ? "" : order.id); setExpandedTab("details"); }}>
                <span className={`attendance-status-dot status-${order.status.toLowerCase()}`} aria-hidden="true" />
                <span className="attendance-row-copy"><strong>{order.customer}</strong><small>#{order.number} · {labels[order.status]} · {formatDate(order.saleDate ?? order.budgetDate)}</small></span>
                <span className="attendance-row-plate"><Bike size={14} aria-hidden="true" />{order.plate || order.model || "Sem veículo"}</span>
                <b className="attendance-row-value">{currency.format(order.total)}</b>
                <ChevronDown size={18} className={expandedId === order.id ? "attendance-chevron open" : "attendance-chevron"} aria-hidden="true" />
              </button>
              <div className="attendance-actions" aria-label={`Ações de ${order.customer}`}>
                <a className="attendance-icon-action" href={`/api/orders/${order.id}/pdf`} target="_blank" rel="noopener noreferrer" title="Abrir PDF" aria-label={`Abrir PDF do atendimento ${order.number}`}><ExternalLink size={19} /></a>
                {order.status === "ORCAMENTO" && <>
                  <IconAction label="Concluir venda" tone="success" disabled={busyId === order.id} onClick={() => setClosingSale(order)}><CheckCircle2 size={19} /></IconAction>
                  <IconAction label="Cancelar orçamento" tone="danger" disabled={busyId === order.id} onClick={() => void cancelBudget(order)}><XCircle size={19} /></IconAction>
                  <IconAction label="Editar orçamento" disabled={busyId === order.id} onClick={() => setEditing(order)}><Pencil size={19} /></IconAction>
                </>}
                {order.status === "PEDIDO" && <>
                  <IconAction label="Concluir venda" tone="success" disabled={busyId === order.id} onClick={() => setClosingSale(order)}><CheckCircle2 size={19} /></IconAction>
                  <IconAction label="Cancelar pedido" tone="danger" disabled={busyId === order.id} onClick={() => cancelOrder(order)}><XCircle size={19} /></IconAction>
                </>}
                {order.status === "VENDA_REALIZADA" && <>
                  <IconAction label="Retornar para pedido" disabled={busyId === order.id} onClick={() => { if (window.confirm(`Retornar a venda ${order.number} para pedido? Os lançamentos financeiros e o estoque serão estornados.`)) void changeStatus(order, "PEDIDO"); }}><RotateCcw size={19} /></IconAction>
                  <IconAction label="Cancelar pedido" tone="danger" disabled={busyId === order.id} onClick={() => cancelOrder(order)}><XCircle size={19} /></IconAction>
                </>}
                <IconAction label="Histórico do cliente" onClick={() => openHistory(order)}><History size={19} /></IconAction>
              </div>
            </div>
            {expandedId === order.id && <div className="attendance-expanded">
              <div className="attendance-expanded-header"><strong>{expandedTab === "history" ? `Histórico de ${order.customer}` : `Atendimento #${order.number}`}</strong><button type="button" onClick={() => setExpandedId("")} aria-label="Fechar detalhes"><XCircle size={18} /></button></div>
              {expandedTab === "history" ? <div className="attendance-history">
                {historyLoading ? <p>Carregando histórico...</p> : historyError ? <p role="alert">{historyError}</p> : !history.length ? <p>Nenhum outro atendimento ou orçamento encontrado para este cliente.</p> : history.map((entry) => <article key={entry.id}>
                  <div><strong>#{entry.number} · {labels[entry.status]}</strong><span>{formatDate(entry.saleDate ?? entry.budgetDate)} · {entry.plate || entry.model || "Sem veículo"} · {currency.format(entry.total)}</span></div>
                  <p>{entry.items.map((item) => `${item.quantity}× ${item.name}`).join(" · ") || "Sem itens registrados"}</p>{entry.notes && <p><b>Observações:</b> {entry.notes}</p>}
                </article>)}
              </div> : <div className="attendance-detail-grid">
                <div><span>Veículo</span><strong>{order.model || "Não informado"}</strong></div><div><span>Placa</span><strong>{order.plate || "—"}</strong></div><div><span>Mecânico</span><strong>{order.mechanic || "Não definido"}</strong></div><div><span>Telefone</span><strong>{order.phone || "Não informado"}</strong></div>
                <div className="attendance-detail-items"><span>Produtos e serviços</span>{order.items.map((item) => <p key={item.id}>{item.quantity}× {item.name}<b>{currency.format(item.total)}</b></p>)}{!order.items.length && <p>Sem itens registrados</p>}</div>
                {order.notes && <div className="attendance-detail-notes"><span>Observações</span><p>{order.notes}</p></div>}
              </div>}
            </div>}
          </div>)}
          {!visible.length && !loading && <div className="attendance-empty">Nenhum atendimento encontrado para esta busca.</div>}
        </div>
        {hasMore && initialData.connected && <button type="button" className="attendance-load-more" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? <LoaderCircle size={18} className="spin" /> : <ClipboardList size={18} />} Carregar mais atendimentos</button>}
      </section>
      {notice && <button type="button" className="toast" role="status" onClick={() => setNotice("")}>{notice}</button>}
      {creating && <OrderFormModal onClose={() => setCreating(false)} onSaved={saved} />}
      {editing && <OrderFormModal initialOrder={editing} onClose={() => setEditing(null)} onSaved={saved} />}
      {closingSale && <SaleFinanceModal order={closingSale} onClose={() => setClosingSale(null)} onConfirm={(config) => changeStatus(closingSale, "VENDA_REALIZADA", config)} />}
    </main>
  </div>;
}
