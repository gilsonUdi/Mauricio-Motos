"use client";

import { AlertTriangle, ArrowDownCircle, ArrowUpCircle, CircleDollarSign, LoaderCircle, Menu, Plus, Scale, X } from "lucide-react";
import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";

type Transaction = { id: string; date: string; description: string; movement: "ENTRADA" | "SAIDA"; type?: string; category?: string; amount: number };
type Category = { movement: "ENTRADA" | "SAIDA"; category: string; total: number };
type CategoryOption={id:string;name:string;nature:"RECEITA"|"DESPESA"|"AMBOS";groupName:string};
type FinanceData = { summary: { income: number; expense: number; result: number; openAmount: number; overdueAmount: number; overdueCount: number }; transactions: Transaction[]; categories: Category[]; availableCategories:CategoryOption[] };
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const dateFormat = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" });
const iso = (date: Date) => date.toLocaleDateString("en-CA");
const monthRange = () => { const now = new Date(); return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(new Date(now.getFullYear(), now.getMonth() + 1, 0)) }; };
const defaultRange = monthRange();

export function FinancePage() {
  const [from, setFrom] = useState(defaultRange.from); const [to, setTo] = useState(defaultRange.to);
  const [data, setData] = useState<FinanceData>(); const [loading, setLoading] = useState(true);
  const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [mobileMenu, setMobileMenu] = useState(false);
  const [showForm, setShowForm] = useState(false); const [saving, setSaving] = useState(false);
  const [date, setDate] = useState(iso(new Date())); const [description, setDescription] = useState("");
  const [movement, setMovement] = useState<"ENTRADA" | "SAIDA">("SAIDA"); const [category, setCategory] = useState(""); const [amount, setAmount] = useState("");

  async function load() {
    setLoading(true); setError("");
    try { const response = await fetch(`/api/finance?from=${from}&to=${to}`); const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? "Não foi possível carregar o financeiro."); setData(payload); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível carregar o financeiro."); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/finance?from=${defaultRange.from}&to=${defaultRange.to}`, { signal: controller.signal }).then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Não foi possível carregar o financeiro.");
      setData(payload);
    }).catch((caught) => { if (caught instanceof Error && caught.name !== "AbortError") setError(caught.message); }).finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  const maxCategory = useMemo(() => Math.max(1, ...(data?.categories.map((item) => item.total) ?? [1])), [data]);
  async function save(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    try { const selected=data?.availableCategories.find(item=>item.id===category);const response = await fetch("/api/finance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date, description, movement, categoryId:category||undefined,category:selected?.name, amount: Number(amount.replace(",", ".")) }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? "Não foi possível salvar."); await load(); setShowForm(false); setNotice("Lançamento financeiro registrado."); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível salvar."); }
    finally { setSaving(false); }
  }

  const summary = data?.summary ?? { income: 0, expense: 0, result: 0, openAmount: 0, overdueAmount: 0, overdueCount: 0 };
  return <div className="app-shell"><AppSidebar active="financeiro" /><main className="workspace registry-workspace">
    <header className="topbar registry-topbar"><button className="mobile-menu" onClick={() => setMobileMenu(!mobileMenu)} aria-label="Abrir menu"><Menu /></button><div><p className="eyebrow">GESTÃO</p><h1>Painel financeiro</h1><p className="page-description">Entradas, saídas, resultado e carteira a receber em uma única visão.</p></div><button className="primary-button" onClick={() => { setError(""); setDate(iso(new Date())); setDescription(""); setMovement("SAIDA"); setCategory(""); setAmount(""); setShowForm(true); }}><Plus size={18} /> Novo lançamento</button></header>
    {mobileMenu && <div className="mobile-shortcuts registry-shortcuts"><Link href="/">Atendimento</Link><Link href="/receber">Receber</Link><Link href="/conferencia">Conferência</Link><Link href="/financeiro">Financeiro</Link></div>}
    <section className="period-toolbar"><label><span>De</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label><span>Até</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label><button className="secondary-button" onClick={load}>Aplicar período</button></section>
    <section className="operations-stats finance-stats"><div><ArrowUpCircle /><span>Entradas</span><strong>{money.format(summary.income)}</strong></div><div><ArrowDownCircle /><span>Saídas</span><strong>{money.format(summary.expense)}</strong></div><div className={summary.result < 0 ? "negative-card" : "positive-card"}><Scale /><span>Resultado</span><strong>{money.format(summary.result)}</strong></div><div><AlertTriangle /><span>Vencido ({summary.overdueCount})</span><strong>{money.format(summary.overdueAmount)}</strong></div></section>
    {loading ? <div className="registry-panel registry-loading"><LoaderCircle className="spin" /> Carregando financeiro...</div> : error && !data ? <div className="registry-panel empty-state">{error}</div> : <div className="finance-layout"><section className="registry-panel"><div className="operations-title"><div><span className="section-kicker">MOVIMENTAÇÃO</span><h2>Lançamentos do período</h2></div><span>{data?.transactions.length ?? 0} lançamento(s)</span></div><div className="registry-table-wrap"><table className="registry-table"><thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Movimento</th><th>Valor</th></tr></thead><tbody>{data?.transactions.map((item) => <tr key={item.id}><td data-label="Data">{dateFormat.format(new Date(`${item.date.slice(0, 10)}T00:00:00Z`))}</td><td data-label="Descrição"><strong>{item.description}</strong></td><td data-label="Categoria">{item.category || "—"}</td><td data-label="Movimento"><span className={`movement-badge ${item.movement === "SAIDA" ? "out" : ""}`}>{item.movement}</span></td><td data-label="Valor"><strong className={item.movement === "SAIDA" ? "negative-value" : "positive-value"}>{item.movement === "SAIDA" ? "− " : "+ "}{money.format(item.amount)}</strong></td></tr>)}</tbody></table>{!data?.transactions.length && <div className="empty-state">Nenhum lançamento no período.</div>}</div></section>
      <aside className="finance-side"><section className="portfolio-card"><CircleDollarSign /><div><span>Carteira em aberto</span><strong>{money.format(summary.openAmount)}</strong><small>{money.format(summary.overdueAmount)} vencidos</small></div></section><section className="category-panel"><div><span className="section-kicker">COMPOSIÇÃO</span><h2>Por categoria</h2></div>{data?.categories.map((item) => <div className="category-row" key={`${item.movement}-${item.category}`}><p><span>{item.category}</span><b className={item.movement === "SAIDA" ? "negative-value" : "positive-value"}>{money.format(item.total)}</b></p><i><em className={item.movement === "SAIDA" ? "out" : ""} style={{ width: `${Math.max(4, item.total / maxCategory * 100)}%` }} /></i></div>)}{!data?.categories.length && <p className="empty-compact">Sem dados no período.</p>}</section></aside></div>}
  </main>
  {showForm && <div className="modal-backdrop"><section className="registry-modal"><header className="modal-header"><div><span className="section-kicker">FINANCEIRO</span><h2>Novo lançamento</h2></div><button className="icon-button" onClick={() => setShowForm(false)}><X /></button></header><form className="registry-form" onSubmit={save}><div className="form-grid registry-form-grid"><label className="field"><span>Data *</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} required /></label><label className="field"><span>Movimento *</span><select value={movement} onChange={(event) => {setMovement(event.target.value as "ENTRADA" | "SAIDA");setCategory("");}}><option value="ENTRADA">Entrada</option><option value="SAIDA">Saída</option></select></label><label className="field span-2"><span>Descrição *</span><input value={description} onChange={(event) => setDescription(event.target.value)} required /></label><label className="field"><span>Categoria *</span><select value={category} onChange={(event)=>setCategory(event.target.value)} required><option value="">Selecione</option>{data?.availableCategories.filter(item=>item.nature==="AMBOS"||item.nature===(movement==="ENTRADA"?"RECEITA":"DESPESA")).map(item=><option value={item.id} key={item.id}>{item.groupName} · {item.name}</option>)}</select></label><label className="field"><span>Valor *</span><input type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} required /></label></div>{error && <p className="form-error">{error}</p>}<footer className="modal-actions"><button type="button" className="secondary-button" onClick={() => setShowForm(false)}>Cancelar</button><button className="primary-button" disabled={saving}>{saving ? <LoaderCircle className="spin" size={18} /> : <Plus size={18} />}Salvar lançamento</button></footer></form></section></div>}
  {notice && <button className="toast" onClick={() => setNotice("")}>{notice}</button>}</div>;
}
