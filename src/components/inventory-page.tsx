"use client";

import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Boxes, History, LoaderCircle, Menu, Save, Search, SlidersHorizontal, X } from "lucide-react";
import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";

type Product = { id: string; name: string; type?: string; costPrice: number; salePrice: number; stock: number; active: boolean };
type Movement = { id: string; productId?: string; productName?: string; date?: string; type?: string; quantity: number; partyName?: string; balance?: number };
type StockFilter = "TODOS" | "POSITIVO" | "ZERADO" | "INATIVO";
const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });
const dateFormatter = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" });
const today = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; };

export function InventoryPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StockFilter>("TODOS");
  const [tab, setTab] = useState<"SALDOS" | "MOVIMENTOS">("SALDOS");
  const [showAdjustment, setShowAdjustment] = useState(false);
  const [productId, setProductId] = useState("");
  const [type, setType] = useState<"ENTRADA" | "SAIDA" | "AJUSTE">("ENTRADA");
  const [quantity, setQuantity] = useState("");
  const [date, setDate] = useState(today);
  const [partyName, setPartyName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [mobileMenu, setMobileMenu] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/inventory", { signal: controller.signal }).then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Não foi possível carregar o estoque.");
      setProducts(payload.products as Product[]); setMovements(payload.movements as Movement[]);
    }).catch((caught) => { if (caught instanceof Error && caught.name !== "AbortError") setError(caught.message); }).finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  const filtered = useMemo(() => products.filter((product) => {
    const matchesQuery = `${product.name} ${product.type ?? ""}`.toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR"));
    const matchesFilter = filter === "TODOS" || filter === "POSITIVO" && product.active && product.stock > 0 || filter === "ZERADO" && product.active && product.stock <= 0 || filter === "INATIVO" && !product.active;
    return matchesQuery && matchesFilter;
  }), [filter, products, query]);
  const activeProducts = products.filter((product) => product.active);
  const inventoryValue = activeProducts.reduce((sum, product) => sum + Math.max(0, product.stock) * product.costPrice, 0);
  const selectedProduct = products.find((product) => product.id === productId);

  function openAdjustment(product?: Product) {
    setProductId(product?.id ?? ""); setType("ENTRADA"); setQuantity(""); setDate(today()); setPartyName(""); setError(""); setShowAdjustment(true);
  }

  async function saveAdjustment(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      const response = await fetch("/api/inventory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productId, type, quantity: Number(quantity.replace(",", ".")), date, partyName }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Não foi possível movimentar o estoque.");
      setProducts((current) => current.map((product) => product.id === payload.product.id ? { ...product, stock: payload.product.stock } : product));
      setMovements((current) => [payload.movement as Movement, ...current]); setShowAdjustment(false);
      setNotice(`${selectedProduct?.name ?? "Produto"}: novo saldo de ${number.format(payload.product.stock)}.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível movimentar o estoque."); }
    finally { setSaving(false); }
  }

  return <div className="app-shell">
    <AppSidebar active="estoque" />
    <main className="workspace registry-workspace">
      <header className="topbar registry-topbar"><button className="mobile-menu" onClick={() => setMobileMenu(!mobileMenu)} aria-label="Abrir menu"><Menu /></button><div><p className="eyebrow">INVENTÁRIO</p><h1>Controle de estoque</h1><p className="page-description">Saldos, valor imobilizado e histórico de entradas e saídas.</p></div><button className="primary-button" onClick={() => openAdjustment()}><SlidersHorizontal size={18} /> Movimentar estoque</button></header>
      {mobileMenu && <div className="mobile-shortcuts registry-shortcuts"><Link href="/">Atendimento</Link><Link href="/compras">Compras</Link><Link href="/estoque">Estoque</Link><Link href="/produtos">Produtos</Link></div>}
      <section className="operations-stats inventory-stats"><div><Boxes /><span>Produtos ativos</span><strong>{activeProducts.length}</strong></div><div><AlertTriangle /><span>Sem estoque</span><strong>{activeProducts.filter((product) => product.stock <= 0).length}</strong></div><div><ArrowDownToLine /><span>Unidades em estoque</span><strong>{number.format(activeProducts.reduce((sum, product) => sum + product.stock, 0))}</strong></div><div><History /><span>Valor em estoque</span><strong>{currency.format(inventoryValue)}</strong></div></section>
      <section className="inventory-toolbar"><div className="inventory-tabs"><button className={tab === "SALDOS" ? "active" : ""} onClick={() => setTab("SALDOS")}>Saldos atuais</button><button className={tab === "MOVIMENTOS" ? "active" : ""} onClick={() => setTab("MOVIMENTOS")}>Movimentações</button></div>{tab === "SALDOS" && <><label className="compact-search"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar produto" /></label><select value={filter} onChange={(event) => setFilter(event.target.value as StockFilter)}><option value="TODOS">Todos</option><option value="POSITIVO">Com estoque</option><option value="ZERADO">Sem estoque</option><option value="INATIVO">Inativos</option></select></>}</section>
      <section className="registry-panel">{loading ? <div className="registry-loading"><LoaderCircle className="spin" /> Carregando estoque...</div> : error && !products.length ? <div className="empty-state">{error}</div> : tab === "SALDOS" ? <div className="registry-table-wrap"><table className="registry-table"><thead><tr><th>Produto</th><th>Tipo</th><th>Custo</th><th>Venda</th><th>Saldo</th><th>Valor em estoque</th><th>Ações</th></tr></thead><tbody>{filtered.map((product) => <tr key={product.id} className={!product.active ? "inactive-row" : product.stock <= 0 ? "stock-alert-row" : ""}><td data-label="Produto"><strong>{product.name}</strong></td><td data-label="Tipo">{product.type ?? "—"}</td><td data-label="Custo">{currency.format(product.costPrice)}</td><td data-label="Venda">{currency.format(product.salePrice)}</td><td data-label="Saldo"><strong>{number.format(product.stock)}</strong></td><td data-label="Valor em estoque">{currency.format(Math.max(0, product.stock) * product.costPrice)}</td><td data-label="Ações"><button className="table-action" onClick={() => openAdjustment(product)}><SlidersHorizontal size={16} /> Movimentar</button></td></tr>)}</tbody></table>{!filtered.length && <div className="empty-state">Nenhum produto encontrado.</div>}</div> : <div className="registry-table-wrap"><table className="registry-table"><thead><tr><th>Data</th><th>Produto</th><th>Movimento</th><th>Origem/destino</th><th>Quantidade</th><th>Saldo após</th></tr></thead><tbody>{movements.map((movement) => <tr key={movement.id}><td data-label="Data">{movement.date ? dateFormatter.format(new Date(`${movement.date}T00:00:00Z`)) : "—"}</td><td data-label="Produto"><strong>{movement.productName ?? "Produto não localizado"}</strong></td><td data-label="Movimento"><span className={`movement-badge ${String(movement.type).includes("SAIDA") || movement.type === "VENDA" ? "out" : "in"}`}>{movement.type ?? "—"}</span></td><td data-label="Origem/destino">{movement.partyName ?? "—"}</td><td data-label="Quantidade">{number.format(movement.quantity)}</td><td data-label="Saldo após">{movement.balance === undefined || movement.balance === null ? "—" : number.format(movement.balance)}</td></tr>)}</tbody></table>{!movements.length && <div className="empty-state">Nenhuma movimentação encontrada.</div>}</div>}</section>
    </main>
    {showAdjustment && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setShowAdjustment(false)}><section className="registry-modal" role="dialog" aria-modal="true" aria-labelledby="adjust-title"><header className="modal-header"><div><span className="section-kicker">INVENTÁRIO</span><h2 id="adjust-title">Movimentar estoque</h2></div><button className="icon-button" onClick={() => setShowAdjustment(false)} aria-label="Fechar"><X /></button></header><form className="registry-form" onSubmit={saveAdjustment}><div className="form-grid registry-form-grid"><label className="field span-2"><span>Produto *</span><select value={productId} onChange={(event) => setProductId(event.target.value)} required><option value="">Selecione</option>{activeProducts.map((product) => <option key={product.id} value={product.id}>{product.name} — saldo {number.format(product.stock)}</option>)}</select></label><label className="field"><span>Tipo *</span><select value={type} onChange={(event) => setType(event.target.value as typeof type)}><option value="ENTRADA">Entrada</option><option value="SAIDA">Saída</option><option value="AJUSTE">Definir saldo exato</option></select></label><label className="field"><span>{type === "AJUSTE" ? "Novo saldo" : "Quantidade"} *</span><input type="number" min="0" step="0.001" value={quantity} onChange={(event) => setQuantity(event.target.value)} required /></label><label className="field"><span>Data</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><label className="field"><span>Origem/destino</span><input value={partyName} onChange={(event) => setPartyName(event.target.value)} placeholder="Fornecedor, cliente ou motivo" /></label></div>{selectedProduct && <p className="current-balance">Saldo atual de <strong>{selectedProduct.name}</strong>: {number.format(selectedProduct.stock)}</p>}{error && <p className="form-error">{error}</p>}<footer className="modal-actions"><button type="button" className="secondary-button" onClick={() => setShowAdjustment(false)}>Cancelar</button><button className="primary-button" disabled={saving}>{saving ? <LoaderCircle className="spin" size={18} /> : type === "SAIDA" ? <ArrowUpFromLine size={18} /> : <Save size={18} />}{saving ? "Salvando..." : "Confirmar movimentação"}</button></footer></form></section></div>}
    {notice && <button className="toast" onClick={() => setNotice("")}>{notice}</button>}
  </div>;
}
