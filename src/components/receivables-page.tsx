"use client";

import { AlertTriangle, BadgeCheck, CalendarClock, CircleDollarSign, LoaderCircle, Menu, Plus, Search, WalletCards, X } from "lucide-react";
import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";

type Status = "PENDENTE" | "VENCIDO" | "PAGO" | "CANCELADO";
type Receivable = { id: string; workOrderId?: string; orderNumber?: number; customerId?: string; customerName: string; dueDate?: string; paymentDate?: string; amount: number; openAmount: number; status: Status; paymentMethod?: string; notes?: string };
type Customer = { id: string; name: string };
type Order = { id: string; number: number; customerId: string; customerName: string; total: number };
type Payload = { receivables: Receivable[]; customers: Customer[]; orders: Order[] };

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const dateFormat = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" });
const today = () => new Date().toLocaleDateString("en-CA");
const showDate = (value?: string) => value ? dateFormat.format(new Date(`${value.slice(0, 10)}T00:00:00Z`)) : "—";

export function ReceivablesPage({ reconciliation = false }: { reconciliation?: boolean }) {
  const [data, setData] = useState<Payload>({ receivables: [], customers: [], orders: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Status | "TODOS">(reconciliation ? "PENDENTE" : "TODOS");
  const [mobileMenu, setMobileMenu] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [paying, setPaying] = useState<Receivable>();
  const [saving, setSaving] = useState(false);
  const [orderId, setOrderId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [dueDate, setDueDate] = useState(today);
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [paymentDate, setPaymentDate] = useState(today);
  const [paymentMethod, setPaymentMethod] = useState("PIX");

  async function load(signal?: AbortSignal) {
    const response = await fetch("/api/receivables", { signal });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "Não foi possível carregar as cobranças.");
    setData(payload);
  }

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/receivables", { signal: controller.signal }).then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Não foi possível carregar as cobranças.");
      setData(payload);
    }).catch((caught) => { if (caught instanceof Error && caught.name !== "AbortError") setError(caught.message); }).finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  const visible = useMemo(() => data.receivables.filter((item) => {
    const normalizedStatus = status === "PENDENTE" && reconciliation ? ["PENDENTE", "VENCIDO"].includes(item.status) : status === "TODOS" || item.status === status;
    return normalizedStatus && `${item.customerName} ${item.orderNumber ?? ""} ${item.notes ?? ""}`.toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR"));
  }), [data.receivables, query, reconciliation, status]);
  const active = data.receivables.filter((item) => item.status !== "CANCELADO");
  const open = active.filter((item) => item.status === "PENDENTE" || item.status === "VENCIDO");
  const overdue = active.filter((item) => item.status === "VENCIDO");
  const paid = active.filter((item) => item.status === "PAGO");
  const dueToday = open.filter((item) => item.dueDate?.slice(0, 10) === today());
  const methodTotals = Object.entries(paid.reduce<Record<string, number>>((result, item) => { const key = item.paymentMethod || "Não informado"; result[key] = (result[key] || 0) + item.amount; return result; }, {}));

  function chooseOrder(value: string) {
    setOrderId(value);
    const order = data.orders.find((item) => item.id === value);
    if (order) { setCustomerId(order.customerId); setAmount(String(order.total)); }
  }

  async function create(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      const response = await fetch("/api/receivables", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workOrderId: orderId || null, customerId: customerId || null, dueDate, amount: Number(amount.replace(",", ".")), notes }) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? "Não foi possível criar a cobrança.");
      await load(); setShowCreate(false); setNotice("Cobrança registrada com sucesso.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível criar a cobrança."); }
    finally { setSaving(false); }
  }

  async function change(item: Receivable, action: "PAY" | "REOPEN") {
    setSaving(true); setError("");
    try {
      const response = await fetch(`/api/receivables/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, paymentDate, paymentMethod }) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? "Não foi possível atualizar a cobrança.");
      await load(); setPaying(undefined); setNotice(action === "PAY" ? "Recebimento confirmado e lançado no financeiro." : "Cobrança reaberta e entrada financeira removida.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível atualizar a cobrança."); }
    finally { setSaving(false); }
  }

  return <div className="app-shell"><AppSidebar active={reconciliation ? "conferencia" : "receber"} /><main className="workspace registry-workspace">
    <header className="topbar registry-topbar"><button className="mobile-menu" onClick={() => setMobileMenu(!mobileMenu)} aria-label="Abrir menu"><Menu /></button><div><p className="eyebrow">FINANCEIRO</p><h1>{reconciliation ? "Conferência de pagamentos" : "Contas a receber"}</h1><p className="page-description">{reconciliation ? "Confirme os recebimentos e acompanhe pendências por forma de pagamento." : "Cobranças geradas pelas vendas e lançamentos avulsos."}</p></div>{!reconciliation && <button className="primary-button" onClick={() => { setError(""); setOrderId(""); setCustomerId(""); setAmount(""); setDueDate(today()); setNotes(""); setShowCreate(true); }}><Plus size={18} /> Nova cobrança</button>}</header>
    {mobileMenu && <div className="mobile-shortcuts registry-shortcuts"><Link href="/">Atendimento</Link><Link href="/receber">Receber</Link><Link href="/conferencia">Conferência</Link><Link href="/financeiro">Financeiro</Link></div>}
    <section className="operations-stats finance-stats"><div><CircleDollarSign /><span>Em aberto</span><strong>{money.format(open.reduce((sum, item) => sum + item.openAmount, 0))}</strong></div><div><AlertTriangle /><span>Vencido</span><strong>{money.format(overdue.reduce((sum, item) => sum + item.openAmount, 0))}</strong></div><div><CalendarClock /><span>Vence hoje</span><strong>{money.format(dueToday.reduce((sum, item) => sum + item.openAmount, 0))}</strong></div><div><BadgeCheck /><span>Recebido</span><strong>{money.format(paid.reduce((sum, item) => sum + item.amount, 0))}</strong></div></section>
    {reconciliation && methodTotals.length > 0 && <section className="method-summary">{methodTotals.map(([method, total]) => <div key={method}><span>{method}</span><strong>{money.format(total)}</strong></div>)}</section>}
    <section className="financial-toolbar"><label className="compact-search"><Search size={18} /><input placeholder="Buscar cliente ou pedido" value={query} onChange={(event) => setQuery(event.target.value)} /></label><select value={status} onChange={(event) => setStatus(event.target.value as Status | "TODOS")}><option value="TODOS">Todos os status</option><option value="PENDENTE">Pendentes{reconciliation ? " e vencidos" : ""}</option>{!reconciliation && <option value="VENCIDO">Vencidos</option>}<option value="PAGO">Pagos</option><option value="CANCELADO">Cancelados</option></select></section>
    <section className="registry-panel">{loading ? <div className="registry-loading"><LoaderCircle className="spin" /> Carregando...</div> : error && !data.receivables.length ? <div className="empty-state">{error}</div> : <div className="registry-table-wrap"><table className="registry-table"><thead><tr><th>Pedido</th><th>Cliente</th><th>Vencimento</th><th>Pagamento</th><th>Forma</th><th>Valor</th><th>Status</th><th>Ações</th></tr></thead><tbody>{visible.map((item) => <tr key={item.id}><td data-label="Pedido">{item.orderNumber ? `#${item.orderNumber}` : "Avulsa"}</td><td data-label="Cliente"><strong>{item.customerName}</strong>{item.notes && <small className="table-note">{item.notes}</small>}</td><td data-label="Vencimento">{showDate(item.dueDate)}</td><td data-label="Pagamento">{showDate(item.paymentDate)}</td><td data-label="Forma">{item.paymentMethod || "—"}</td><td data-label="Valor"><strong>{money.format(item.amount)}</strong></td><td data-label="Status"><span className={`financial-status ${item.status.toLowerCase()}`}>{item.status}</span></td><td data-label="Ações">{item.status === "PENDENTE" || item.status === "VENCIDO" ? <button className="table-action" onClick={() => { setPaymentDate(today()); setPaymentMethod(item.paymentMethod || "PIX"); setPaying(item); }}><BadgeCheck size={16} /> Receber</button> : item.status === "PAGO" ? <button className="table-action" disabled={saving} onClick={() => change(item, "REOPEN")}>Reabrir</button> : "—"}</td></tr>)}</tbody></table>{!visible.length && <div className="empty-state">Nenhuma cobrança encontrada.</div>}</div>}</section>
  </main>
  {showCreate && <div className="modal-backdrop"><section className="registry-modal"><header className="modal-header"><div><span className="section-kicker">FINANCEIRO</span><h2>Nova cobrança</h2></div><button className="icon-button" onClick={() => setShowCreate(false)}><X /></button></header><form className="registry-form" onSubmit={create}><div className="form-grid registry-form-grid"><label className="field span-2"><span>Pedido (opcional)</span><select value={orderId} onChange={(event) => chooseOrder(event.target.value)}><option value="">Cobrança avulsa</option>{data.orders.map((order) => <option value={order.id} key={order.id}>#{order.number} · {order.customerName} · {money.format(order.total)}</option>)}</select></label><label className="field span-2"><span>Cliente *</span><select value={customerId} disabled={Boolean(orderId)} onChange={(event) => setCustomerId(event.target.value)} required><option value="">Selecione</option>{data.customers.map((customer) => <option value={customer.id} key={customer.id}>{customer.name}</option>)}</select></label><label className="field"><span>Vencimento *</span><input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} required /></label><label className="field"><span>Valor *</span><input type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} required /></label><label className="field span-2"><span>Observações</span><textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} /></label></div>{error && <p className="form-error">{error}</p>}<footer className="modal-actions"><button type="button" className="secondary-button" onClick={() => setShowCreate(false)}>Cancelar</button><button className="primary-button" disabled={saving}>{saving ? <LoaderCircle className="spin" size={18} /> : <Plus size={18} />}Salvar cobrança</button></footer></form></section></div>}
  {paying && <div className="modal-backdrop"><section className="registry-modal compact-modal"><header className="modal-header"><div><span className="section-kicker">CONFERÊNCIA</span><h2>Confirmar recebimento</h2></div><button className="icon-button" onClick={() => setPaying(undefined)}><X /></button></header><form className="registry-form" onSubmit={(event) => { event.preventDefault(); change(paying, "PAY"); }}><p className="payment-callout"><WalletCards /> <span><b>{paying.customerName}</b><br />{money.format(paying.amount)}</span></p><div className="form-grid registry-form-grid"><label className="field"><span>Data do pagamento</span><input type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} required /></label><label className="field"><span>Forma de pagamento</span><select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option>PIX</option><option>Dinheiro</option><option>Cartão de crédito</option><option>Cartão de débito</option><option>Boleto</option><option>Transferência</option><option>Outro</option></select></label></div>{error && <p className="form-error">{error}</p>}<footer className="modal-actions"><button type="button" className="secondary-button" onClick={() => setPaying(undefined)}>Cancelar</button><button className="primary-button" disabled={saving}><BadgeCheck size={18} /> Confirmar</button></footer></form></section></div>}
  {notice && <button className="toast" onClick={() => setNotice("")}>{notice}</button>}
  </div>;
}
