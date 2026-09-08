"use client";

import { CirclePlus, LoaderCircle, Menu, PackageCheck, Plus, Save, ShoppingCart, Trash2, X } from "lucide-react";
import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";

type Product = { id: string; name: string; type?: string; costPrice: number; stock: number };
type Supplier = { id:string; name:string; paymentTermsDays:number };
type Purchase = { id: string; date: string; supplier: string; total: number; itemCount: number; totalQuantity: number };
type DraftItem = { key: number; productId?: string; productName: string; quantity: string; unitCost: string };

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const dateFormatter = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" });
const today = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; };
const blankItem = (key: number): DraftItem => ({ key, productName: "", quantity: "1", unitCost: "0" });
const normalize = (value: string) => value.trim().toLocaleLowerCase("pt-BR");

export function PurchasesPage() {
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers,setSuppliers]=useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [supplierId,setSupplierId]=useState("");
  const [supplier, setSupplier] = useState("");
  const [date, setDate] = useState(today);
  const [items, setItems] = useState<DraftItem[]>([blankItem(1)]);
  const [nextKey, setNextKey] = useState(2);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [mobileMenu, setMobileMenu] = useState(false);

  async function load(signal?: AbortSignal) {
    const response = await fetch("/api/purchases", { signal });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "Não foi possível carregar as compras.");
    setPurchases(payload.purchases as Purchase[]);
    setProducts(payload.products as Product[]);
    setSuppliers((payload.suppliers as Supplier[] | undefined) ?? []);
  }

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/purchases", { signal: controller.signal }).then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Não foi possível carregar as compras.");
      setPurchases(payload.purchases as Purchase[]);
      setProducts(payload.products as Product[]);
      setSuppliers((payload.suppliers as Supplier[] | undefined) ?? []);
    }).catch((caught) => {
      if (caught instanceof Error && caught.name !== "AbortError") setError(caught.message);
    }).finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  const total = useMemo(() => items.reduce((sum, item) => sum + (Number(item.quantity.replace(",", ".")) || 0) * (Number(item.unitCost.replace(",", ".")) || 0), 0), [items]);
  const monthPrefix = today().slice(0, 7);
  const monthPurchases = purchases.filter((purchase) => purchase.date?.startsWith(monthPrefix));
  const monthTotal = monthPurchases.reduce((sum, purchase) => sum + purchase.total, 0);

  function chooseProduct(item: DraftItem, value: string) {
    const product = products.find((entry) => normalize(entry.name) === normalize(value));
    setItems((current) => current.map((entry) => entry.key === item.key ? { ...entry, productName: value, productId: product?.id, unitCost: product ? String(product.costPrice) : entry.unitCost } : entry));
  }

  function resetForm() {
    setSupplierId("");setSupplier(""); setDate(today()); setItems([blankItem(1)]); setNextKey(2); setError("");
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (items.some((item) => !item.productId)) return setError("Selecione um produto cadastrado em todos os itens.");
    setSaving(true);
    try {
      const response = await fetch("/api/purchases", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supplierId:supplierId||undefined,supplier, date, items: items.map((item) => ({ productId: item.productId, quantity: Number(item.quantity.replace(",", ".")), unitCost: Number(item.unitCost.replace(",", ".")) })) }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Não foi possível registrar a compra.");
      await load();
      setShowForm(false); resetForm();
      setNotice(`Compra de ${currency.format(payload.total)} registrada e adicionada ao estoque.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível registrar a compra."); }
    finally { setSaving(false); }
  }

  return <div className="app-shell">
    <AppSidebar active="compras" />
    <main className="workspace registry-workspace">
      <header className="topbar registry-topbar">
        <button className="mobile-menu" onClick={() => setMobileMenu(!mobileMenu)} aria-label="Abrir menu"><Menu /></button>
        <div><p className="eyebrow">SUPRIMENTOS</p><h1>Compras</h1><p className="page-description">Entradas de mercadoria com atualização automática de custo e estoque.</p></div>
        <button className="primary-button" onClick={() => { resetForm(); setShowForm(true); }}><Plus size={18} /> Nova compra</button>
      </header>
      {mobileMenu && <div className="mobile-shortcuts registry-shortcuts"><Link href="/">Atendimento</Link><Link href="/compras">Compras</Link><Link href="/estoque">Estoque</Link><Link href="/produtos">Produtos</Link></div>}
      <section className="operations-stats">
        <div><ShoppingCart /><span>Compras no mês</span><strong>{monthPurchases.length}</strong></div>
        <div><PackageCheck /><span>Total no mês</span><strong>{currency.format(monthTotal)}</strong></div>
        <div><CirclePlus /><span>Itens recebidos</span><strong>{monthPurchases.reduce((sum, purchase) => sum + purchase.totalQuantity, 0).toLocaleString("pt-BR")}</strong></div>
      </section>
      <section className="registry-panel">
        <div className="operations-title"><div><span className="section-kicker">HISTÓRICO</span><h2>Compras registradas</h2></div><span>{purchases.length} lançamento(s)</span></div>
        {loading ? <div className="registry-loading"><LoaderCircle className="spin" /> Carregando compras...</div> : error && !purchases.length ? <div className="empty-state">{error}</div> : <div className="registry-table-wrap"><table className="registry-table"><thead><tr><th>Data</th><th>Fornecedor</th><th>Produtos</th><th>Quantidade</th><th>Total</th></tr></thead><tbody>{purchases.map((purchase) => <tr key={purchase.id}><td data-label="Data">{purchase.date ? dateFormatter.format(new Date(`${purchase.date}T00:00:00Z`)) : "—"}</td><td data-label="Fornecedor"><strong>{purchase.supplier}</strong></td><td data-label="Produtos">{purchase.itemCount}</td><td data-label="Quantidade">{purchase.totalQuantity.toLocaleString("pt-BR")}</td><td data-label="Total"><strong>{currency.format(purchase.total)}</strong></td></tr>)}</tbody></table>{!purchases.length && <div className="empty-state">Nenhuma compra registrada pelo novo sistema.</div>}</div>}
      </section>
    </main>
    {showForm && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setShowForm(false)}><section className="order-modal" role="dialog" aria-modal="true" aria-labelledby="purchase-title"><header className="modal-header"><div><span className="section-kicker">ESTOQUE</span><h2 id="purchase-title">Nova compra</h2></div><button className="icon-button" onClick={() => setShowForm(false)} aria-label="Fechar"><X /></button></header><form className="order-form" onSubmit={save}>
      <div className="form-grid purchase-header-grid"><label className="field"><span>Fornecedor *</span><select value={supplierId} onChange={(event)=>{setSupplierId(event.target.value);setSupplier(suppliers.find(item=>item.id===event.target.value)?.name??"");}} required><option value="">Selecione um fornecedor cadastrado</option>{suppliers.map(item=><option value={item.id} key={item.id}>{item.name}{item.paymentTermsDays?` · ${item.paymentTermsDays} dias`:""}</option>)}</select></label><label className="field"><span>Data *</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} required /></label></div>
      <fieldset className="form-section purchase-items"><legend><ShoppingCart size={18} /> Itens da compra</legend><div className="purchase-editor-head"><span>Produto</span><span>Quantidade</span><span>Custo unitário</span><span>Total</span><span></span></div>{items.map((item) => { const itemTotal = (Number(item.quantity) || 0) * (Number(item.unitCost) || 0); return <div className="purchase-editor-row" key={item.key}><input list="purchase-products" value={item.productName} onChange={(event) => chooseProduct(item, event.target.value)} placeholder="Busque um produto" required /><input type="number" min="0.001" step="0.001" value={item.quantity} onChange={(event) => setItems((current) => current.map((entry) => entry.key === item.key ? { ...entry, quantity: event.target.value } : entry))} aria-label="Quantidade" /><input type="number" min="0" step="0.01" value={item.unitCost} onChange={(event) => setItems((current) => current.map((entry) => entry.key === item.key ? { ...entry, unitCost: event.target.value } : entry))} aria-label="Custo unitário" /><strong>{currency.format(itemTotal)}</strong><button type="button" className="remove-item" disabled={items.length === 1} onClick={() => setItems((current) => current.filter((entry) => entry.key !== item.key))}><Trash2 size={18} /></button></div>; })}<button className="add-item" type="button" onClick={() => { setItems((current) => [...current, blankItem(nextKey)]); setNextKey((current) => current + 1); }}><CirclePlus size={17} /> Adicionar produto</button></fieldset>
      <div className="purchase-total"><span>Total da compra</span><strong>{currency.format(total)}</strong></div>{error && <p className="form-error">{error}</p>}<footer className="modal-actions"><button className="secondary-button" type="button" onClick={() => setShowForm(false)}>Cancelar</button><button className="primary-button" disabled={saving}>{saving ? <LoaderCircle className="spin" size={18} /> : <Save size={18} />}{saving ? "Registrando..." : "Registrar compra"}</button></footer>
      <datalist id="purchase-products">{products.map((product) => <option key={product.id} value={product.name}>{currency.format(product.costPrice)} · estoque {product.stock}</option>)}</datalist>
    </form></section></div>}
    {notice && <button className="toast" onClick={() => setNotice("")}>{notice}</button>}
  </div>;
}
