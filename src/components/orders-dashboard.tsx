"use client";

import {
  Bike,
  Boxes,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  FileText,
  Gauge,
  LayoutDashboard,
  Menu,
  PackageSearch,
  Search,
  Settings,
  Users,
  Wrench,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { DashboardData, OrderStatus } from "@/lib/types";

const statusLabels: Record<OrderStatus, string> = {
  ORCAMENTO: "Orçamento",
  PEDIDO: "Pedido gerado",
  VENDA_REALIZADA: "Venda realizada",
  CANCELADO: "Cancelado",
};

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function formatDate(value?: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

function Sidebar() {
  const entries = [
    { label: "Atendimento", icon: LayoutDashboard, active: true },
    { label: "Orçamentos", icon: ClipboardList },
    { label: "Compras", icon: PackageSearch },
    { label: "Contas a receber", icon: CircleDollarSign },
    { label: "Estoque", icon: Boxes },
    { label: "Clientes", icon: Users },
    { label: "Veículos", icon: Bike },
    { label: "Produtos e serviços", icon: Wrench },
  ];

  return (
    <aside className="sidebar">
      <div className="brand-mark"><Wrench size={22} /><span>MM</span></div>
      <nav aria-label="Navegação principal">
        {entries.map(({ label, icon: Icon, active }) => (
          <button className={`nav-button ${active ? "active" : ""}`} key={label} title={label}>
            <Icon size={20} /><span>{label}</span>
          </button>
        ))}
      </nav>
      <button className="nav-button settings"><Settings size={20} /><span>Configurações</span></button>
    </aside>
  );
}

function StatCard({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return <div className={`stat-card ${tone ?? ""}`}><span>{label}</span><strong>{value}</strong></div>;
}

function StatusBadge({ status }: { status: OrderStatus }) {
  return <span className={`status-badge status-${status.toLowerCase()}`}>{statusLabels[status]}</span>;
}

export function OrdersDashboard({ initialData }: { initialData: DashboardData }) {
  const [orders, setOrders] = useState(initialData.orders);
  const [selectedId, setSelectedId] = useState(initialData.orders[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<OrderStatus | "TODOS">("TODOS");
  const [mobileMenu, setMobileMenu] = useState(false);
  const [notice, setNotice] = useState("");
  const selected = orders.find((order) => order.id === selectedId) ?? orders[0];

  const filtered = useMemo(() => orders.filter((order) => {
    const haystack = `${order.number} ${order.customer} ${order.plate ?? ""} ${order.model ?? ""}`.toLowerCase();
    return (filter === "TODOS" || order.status === filter) && haystack.includes(query.toLowerCase());
  }), [filter, orders, query]);

  const totals = useMemo(() => ({
    open: orders.filter((order) => order.status === "ORCAMENTO").length,
    inProgress: orders.filter((order) => order.status === "PEDIDO").length,
    completed: orders.filter((order) => order.status === "VENDA_REALIZADA").length,
    revenue: orders.filter((order) => order.status === "VENDA_REALIZADA").reduce((sum, order) => sum + order.total, 0),
  }), [orders]);

  async function changeStatus(status: OrderStatus) {
    if (!selected) return;
    if (!initialData.connected) {
      setOrders((current) => current.map((order) => order.id === selected.id ? { ...order, status } : order));
      setNotice(`Demonstração: ${statusLabels[status].toLowerCase()} aplicado localmente.`);
      return;
    }

    const response = await fetch(`/api/orders/${selected.id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!response.ok) {
      setNotice("Não foi possível atualizar a ordem.");
      return;
    }
    setOrders((current) => current.map((order) => order.id === selected.id ? { ...order, status } : order));
    setNotice(`Ordem ${selected.number} atualizada para ${statusLabels[status].toLowerCase()}.`);
  }

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="workspace">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setMobileMenu(!mobileMenu)} aria-label="Abrir menu"><Menu /></button>
          <div>
            <p className="eyebrow">OFICINA</p>
            <h1>Gestão de atendimento</h1>
          </div>
          <div className="topbar-actions">
            {!initialData.connected && <span className="demo-pill">Prévia com dados de demonstração</span>}
            <button className="primary-button"><FileText size={18} /> Novo orçamento</button>
          </div>
        </header>

        {mobileMenu && <div className="mobile-shortcuts">Atendimento · Orçamentos · Clientes · Estoque · Financeiro</div>}

        <section className="stats-grid" aria-label="Resumo do atendimento">
          <StatCard label="Orçamentos abertos" value={String(totals.open)} tone="amber" />
          <StatCard label="Em execução" value={String(totals.inProgress)} tone="blue" />
          <StatCard label="Concluídos" value={String(totals.completed)} tone="green" />
          <StatCard label="Vendas no painel" value={currency.format(totals.revenue)} />
        </section>

        <section className="service-board">
          <div className="orders-column">
            <div className="panel-heading">
              <div><span className="section-kicker">ORDENS DE SERVIÇO</span><h2>Fila de atendimento</h2></div>
              <span className="count-bubble">{filtered.length}</span>
            </div>
            <div className="filters">
              <label className="search-box"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cliente, pedido ou placa" /></label>
              <select value={filter} onChange={(event) => setFilter(event.target.value as OrderStatus | "TODOS")}>
                <option value="TODOS">Todos os status</option>
                {Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select>
            </div>
            <div className="order-list">
              {filtered.map((order) => (
                <button className={`order-card ${selected?.id === order.id ? "selected" : ""}`} key={order.id} onClick={() => setSelectedId(order.id)}>
                  <div className="order-card-top"><span>#{order.number}</span><StatusBadge status={order.status} /></div>
                  <strong>{order.customer}</strong>
                  <p>{order.plate ?? "Sem placa"} · {order.model ?? "Modelo não informado"}</p>
                  <div className="order-card-bottom"><span>{formatDate(order.budgetDate)}</span><b>{currency.format(order.total)}</b><ChevronRight size={18} /></div>
                </button>
              ))}
              {!filtered.length && <div className="empty-state">Nenhuma ordem encontrada para estes filtros.</div>}
            </div>
          </div>

          <div className="details-column">
            {selected ? (
              <>
                <div className="detail-header">
                  <div><span className="section-kicker">ORDEM #{selected.number}</span><h2>{selected.customer}</h2><p>{selected.phone ?? "Telefone não informado"}</p></div>
                  <StatusBadge status={selected.status} />
                </div>
                <div className="vehicle-strip">
                  <div className="vehicle-icon"><Bike /></div>
                  <div><span>Veículo</span><strong>{selected.model ?? "Não informado"}</strong></div>
                  <div><span>Placa</span><strong>{selected.plate ?? "—"}</strong></div>
                  <div><span>Quilometragem</span><strong>{selected.mileage ? `${selected.mileage.toLocaleString("pt-BR")} km` : "—"}</strong></div>
                  <div><span>Mecânico</span><strong>{selected.mechanic ?? "Não definido"}</strong></div>
                </div>

                <div className="items-table">
                  <div className="items-title"><h3>Produtos e serviços</h3><span>{selected.items.length} item(ns)</span></div>
                  <div className="table-head"><span>Descrição</span><span>Qtd.</span><span>Unitário</span><span>Total</span></div>
                  {selected.items.map((item) => (
                    <div className="table-row" key={item.id}>
                      <div><strong>{item.name}</strong><small>{item.type}</small></div>
                      <span>{item.quantity}</span><span>{currency.format(item.unitPrice)}</span><b>{currency.format(item.total)}</b>
                    </div>
                  ))}
                  <div className="total-row"><span>Total do orçamento</span><strong>{currency.format(selected.total)}</strong></div>
                </div>

                <div className="service-notes"><Gauge size={18} /><div><span>Observações</span><p>{selected.notes ?? "Nenhuma observação registrada."}</p></div></div>

                <div className="actions-bar">
                  {selected.status !== "PEDIDO" && selected.status !== "VENDA_REALIZADA" && <button className="action-button amber" onClick={() => changeStatus("PEDIDO")}><ClipboardList size={18} /> Gerar pedido</button>}
                  {selected.status !== "VENDA_REALIZADA" && <button className="action-button green" onClick={() => changeStatus("VENDA_REALIZADA")}><CheckCircle2 size={18} /> Concluir venda</button>}
                  {selected.status !== "ORCAMENTO" && <button className="action-button" onClick={() => changeStatus("ORCAMENTO")}><FileText size={18} /> Retornar a orçamento</button>}
                  {selected.status !== "CANCELADO" && <button className="action-button danger" onClick={() => changeStatus("CANCELADO")}><XCircle size={18} /> Cancelar</button>}
                </div>
              </>
            ) : <div className="empty-state">Selecione uma ordem para ver os detalhes.</div>}
          </div>
        </section>
      </main>
      {notice && <button className="toast" onClick={() => setNotice("")}>{notice}</button>}
    </div>
  );
}
