"use client";

import { AlertTriangle, Bike, CirclePlus, LoaderCircle, PackagePlus, Save, Search, Trash2, UserRound, X } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import type { OrderLookups, ProductLookup, WorkOrder } from "@/lib/types";
import { MoneyInput } from "@/components/money-input";
import { NumberStepper } from "@/components/number-stepper";
import { SuggestionInput, type SuggestionOption } from "@/components/suggestion-input";
import { numberToMoneyInput, parseBrazilianNumber } from "@/lib/numbers";

type DraftItem = {
  key: number;
  productId?: string;
  name: string;
  type: string;
  quantity: string;
  unitPrice: string;
};

type Props = {
  onClose: () => void;
  onSaved: (order: WorkOrder) => void;
  initialOrder?: WorkOrder;
};

type QuickField = { key: string; label: string; kind?: "document" | "zip" | "number" | "email"; required?: boolean; placeholder?: string };
const quickCustomerFields: QuickField[] = [
  { key: "name", label: "Nome", required: true }, { key: "phone", label: "Telefone" },
  { key: "email", label: "E-mail", kind: "email" }, { key: "document", label: "CPF/CNPJ", kind: "document" },
  { key: "zipCode", label: "CEP", kind: "zip" }, { key: "street", label: "Logradouro" },
  { key: "addressNumber", label: "Número" }, { key: "complement", label: "Complemento" },
  { key: "district", label: "Bairro" }, { key: "city", label: "Cidade" },
  { key: "state", label: "UF" }, { key: "defaultPlate", label: "Placa padrão" },
  { key: "defaultModel", label: "Modelo padrão" },
];
const quickVehicleFields: QuickField[] = [
  { key: "plate", label: "Placa", required: true, placeholder: "ABC1D23" },
  { key: "model", label: "Modelo/descrição" }, { key: "brand", label: "Marca" },
  { key: "manufactureYear", label: "Ano de fabricação", kind: "number" },
  { key: "modelYear", label: "Ano do modelo", kind: "number" },
  { key: "color", label: "Cor" }, { key: "fuel", label: "Combustível" },
  { key: "engineDisplacement", label: "Cilindrada" },
  { key: "registrationCity", label: "Município de registro" },
  { key: "registrationState", label: "UF de registro" },
  { key: "mileage", label: "Quilometragem", kind: "number" },
];

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").trim();
const formatDocument = (value: string) => {
  const digits = value.replace(/\D/g, "").slice(0, 14);
  if (digits.length > 11) return digits.replace(/^(\d{2})(\d)/, "$1.$2").replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d)/, ".$1/$2").replace(/(\d{4})(\d)$/, "$1-$2");
  return digits.replace(/^(\d{3})(\d)/, "$1.$2").replace(/\.(\d{3})(\d)/, ".$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
};
const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const addDays = (value: string, days: number) => {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
function blankItem(key: number): DraftItem {
  return { key, name: "", type: "Produto", quantity: "1", unitPrice: "0,00" };
}

export function OrderFormModal({ onClose, onSaved, initialOrder }: Props) {
  const [lookups, setLookups] = useState<OrderLookups | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [customerName, setCustomerName] = useState(initialOrder?.customer ?? "");
  const [customerId, setCustomerId] = useState(initialOrder?.customerId ?? "");
  const [phone, setPhone] = useState(initialOrder?.phone ?? "");
  const [document, setDocument] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [vehicleSearch, setVehicleSearch] = useState(initialOrder?.model ?? "");
  const [quickCreate, setQuickCreate] = useState<"customer" | "vehicle" | null>(null);
  const [quickForm, setQuickForm] = useState<Record<string, string>>({});
  const [quickSaving, setQuickSaving] = useState(false);
  const [quickError, setQuickError] = useState("");
  const [quickLookupLoading, setQuickLookupLoading] = useState<"cep" | "cnpj" | null>(null);
  const [plate, setPlate] = useState(initialOrder?.plate ?? "");
  const [model, setModel] = useState(initialOrder?.model ?? "");
  const [mileage, setMileage] = useState(initialOrder?.mileage ? String(initialOrder.mileage) : "");
  const [mechanicId, setMechanicId] = useState(initialOrder?.mechanicId ?? "");
  const [budgetDate, setBudgetDate] = useState(initialOrder?.budgetDate ?? today);
  const [validUntil, setValidUntil] = useState(initialOrder?.validUntil ?? addDays(initialOrder?.budgetDate ?? today(), 7));
  const [discount, setDiscount] = useState(numberToMoneyInput(initialOrder?.discount ?? 0));
  const [notes, setNotes] = useState(initialOrder?.notes ?? "");
  const [items, setItems] = useState<DraftItem[]>(initialOrder?.items.length ? initialOrder.items.map((item, index) => ({
    key: index + 1,
    productId: item.productId,
    name: item.name,
    type: item.type || "Produto/Serviço",
    quantity: String(item.quantity),
    unitPrice: numberToMoneyInput(item.unitPrice),
  })) : [blankItem(1)]);
  const [nextKey, setNextKey] = useState((initialOrder?.items.length ?? 1) + 1);
  const [activeProductSearch, setActiveProductSearch] = useState<number>();

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/lookups", { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Não foi possível carregar os cadastros.");
        const loaded = payload as OrderLookups;
        setLookups(loaded);
        if (initialOrder?.customerId) {
          const owner = loaded.customers.find((entry) => entry.id === initialOrder.customerId);
          if (owner) setDocument(formatDocument(owner.document ?? ""));
        }
        if (initialOrder?.plate) {
          const normalizedPlate = initialOrder.plate.replace(/[^A-Z0-9]/gi, "").toUpperCase();
          const vehicle = loaded.vehicles.find((entry) =>
            entry.customerId === initialOrder.customerId && entry.plate.replace(/[^A-Z0-9]/gi, "").toUpperCase() === normalizedPlate
          );
          if (vehicle) setVehicleId(vehicle.id);
        }
      })
      .catch((caught) => {
        if (caught instanceof Error && caught.name !== "AbortError") setError(caught.message);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [initialOrder]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { if (quickCreate) setQuickCreate(null); else onClose(); }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, quickCreate]);

  const subtotal = useMemo(() => items.reduce((sum, item) => (
    sum + (Number(item.quantity.replace(",", ".")) || 0) * parseBrazilianNumber(item.unitPrice)
  ), 0), [items]);
  const total = Math.max(0, subtotal - parseBrazilianNumber(discount));
  const stockShortages = useMemo(() => items.flatMap((item) => {
    if (!item.productId) return [];
    const product = lookups?.products.find((entry) => entry.id === item.productId);
    if (!product || product.stock === undefined) return [];
    const itemType = normalize(product.type ?? item.type);
    if (itemType.includes("serv") && !itemType.includes("prod")) return [];
    const required = Number(item.quantity.replace(",", ".")) || 0;
    return required > product.stock ? [{ id: product.id, name: product.name, available: product.stock, required }] : [];
  }), [items, lookups]);

  function typeCustomer(value: string) {
    setCustomerName(value);
    setCustomerId("");
    setPhone("");
    setDocument("");
    setVehicleId("");
    setVehicleSearch("");
    setPlate("");
    setModel("");
    setMileage("");
  }

  function chooseCustomer(option: SuggestionOption) {
    const customer = lookups?.customers.find((entry) => entry.id === option.id);
    setCustomerName(customer?.name ?? option.value);
    setCustomerId(customer?.id ?? "");
    setPhone(customer?.phone ?? "");
    setDocument(formatDocument(customer?.document ?? ""));
    setVehicleId("");setVehicleSearch("");setPlate("");setModel("");setMileage("");
  }

  function chooseVehicle(id: string) {
    setVehicleId(id);
    const vehicle = lookups?.vehicles.find((entry) => entry.id === id);
    if (vehicle?.customerId && vehicle.customerId !== customerId) {
      const owner = lookups?.customers.find((entry) => entry.id === vehicle.customerId);
      if (owner) { setCustomerId(owner.id); setCustomerName(owner.name); setPhone(owner.phone ?? ""); setDocument(formatDocument(owner.document ?? "")); }
    }
    setVehicleSearch(vehicle?.model ?? "Veículo sem modelo");
    setPlate(vehicle?.plate ?? "");
    setModel(vehicle?.model ?? "");
    setMileage(vehicle?.mileage ? String(vehicle.mileage) : "");
  }

  function openQuickCreate(kind: "customer" | "vehicle") {
    setQuickError("");
    setQuickForm(kind === "customer"
      ? { name: customerId ? "" : customerName, phone: customerId ? "" : phone, document: customerId ? "" : document }
      : { customerId, plate: vehicleId ? "" : plate, model: vehicleId ? "" : model });
    setQuickCreate(kind);
  }

  function setQuickField(key: string, value: string) {
    setQuickForm((current) => ({ ...current, [key]: value }));
  }

  async function lookupQuick(type: "cep" | "cnpj") {
    const value = (quickForm[type === "cep" ? "zipCode" : "document"] ?? "").replace(/\D/g, "");
    setQuickLookupLoading(type); setQuickError("");
    try {
      const response = await fetch(`/api/registry-lookup?type=${type}&value=${encodeURIComponent(value)}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Não foi possível consultar o cadastro.");
      setQuickForm((current) => ({ ...current, ...payload, document: payload.document ? formatDocument(String(payload.document)) : current.document,
        zipCode: payload.zipCode ? String(payload.zipCode).replace(/^(\d{5})(\d{1,3})$/, "$1-$2") : current.zipCode }));
    } catch (caught) { setQuickError(caught instanceof Error ? caught.message : "Não foi possível consultar o cadastro."); }
    finally { setQuickLookupLoading(null); }
  }

  async function saveQuickCreate(event: FormEvent) {
    event.preventDefault();
    if (!quickCreate) return;
    if (quickCreate === "vehicle" && !quickForm.customerId) { setQuickError("Selecione o cliente do veículo."); return; }
    setQuickSaving(true); setQuickError("");
    try {
      const response = await fetch(`/api/registries/${quickCreate === "customer" ? "customers" : "vehicles"}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(quickForm),
      });
      const record = await response.json();
      if (!response.ok) throw new Error(record.error ?? "Não foi possível cadastrar.");
      if (quickCreate === "customer") {
        setLookups((current) => current ? { ...current, customers: [...current.customers, record].sort((a,b) => a.name.localeCompare(b.name)) } : current);
        setCustomerId(record.id); setCustomerName(record.name); setPhone(record.phone ?? ""); setDocument(formatDocument(record.document ?? ""));
        setVehicleId(""); setVehicleSearch(""); setPlate(""); setModel(""); setMileage("");
      } else {
        setLookups((current) => current ? { ...current, vehicles: [...current.vehicles, record].sort((a,b) => a.plate.localeCompare(b.plate)) } : current);
        if (record.customerId && record.customerId !== customerId) {
          const owner = lookups?.customers.find((entry) => entry.id === record.customerId);
          if (owner) { setCustomerId(owner.id); setCustomerName(owner.name); setPhone(owner.phone ?? ""); setDocument(formatDocument(owner.document ?? "")); }
        }
        setVehicleId(record.id); setVehicleSearch(record.model ?? "Veículo sem modelo"); setPlate(record.plate); setModel(record.model ?? ""); setMileage(record.mileage ? String(record.mileage) : "");
      }
      setQuickCreate(null);
    } catch (caught) { setQuickError(caught instanceof Error ? caught.message : "Não foi possível cadastrar."); }
    finally { setQuickSaving(false); }
  }

  function updateItem(key: number, patch: Partial<DraftItem>) {
    setItems((current) => current.map((item) => item.key === key ? { ...item, ...patch } : item));
  }

  function searchProducts(value: string) {
    const term = normalize(value);
    return (lookups?.products ?? []).filter((product) =>
      !term || normalize(`${product.name} ${product.sku ?? ""} ${product.barcode ?? ""}`).includes(term)
    );
  }

  function typeProductSearch(item: DraftItem, value: string) {
    updateItem(item.key, {
      name: value,
      productId: undefined,
    });
    setActiveProductSearch(item.key);
  }

  function chooseProduct(item: DraftItem, product: ProductLookup) {
    updateItem(item.key, {
      name: product.name,
      productId: product.id,
      type: product.type ?? item.type,
      unitPrice: numberToMoneyInput(product.salePrice),
    });
    setActiveProductSearch(undefined);
  }

  function addItem() {
    setItems((current) => [...current, blankItem(nextKey)]);
    setNextKey((current) => current + 1);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!customerName.trim()) return setError("Informe o cliente.");
    if (items.some((item) => !Number.isInteger(Number(item.quantity)) || Number(item.quantity) < 1)) return setError("A quantidade dos itens deve ser um número inteiro maior que zero.");
    if (items.some((item) => !item.productId)) return setError("Selecione um produto ou serviço cadastrado em todos os itens.");
    if (stockShortages.length && !window.confirm(`Existem produtos sem estoque suficiente:\n\n${stockShortages.map((item) => `${item.name}: disponível ${item.available.toLocaleString("pt-BR")}, necessário ${item.required.toLocaleString("pt-BR")}`).join("\n")}\n\nDeseja salvar o orçamento mesmo assim?`)) return;

    setSaving(true);
    try {
      const response = await fetch(initialOrder ? `/api/orders/${initialOrder.id}` : "/api/orders", {
        method: initialOrder ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: customerId || undefined,
          customerName,
          customerPhone: phone,
          customerDocument: document,
          vehicleId: vehicleId || undefined,
          vehiclePlate: plate,
          vehicleModel: model,
          mileage: mileage.trim() === "" ? undefined : Number(mileage),
          mechanicId: mechanicId || undefined,
          budgetDate,
          validUntil,
          discount: parseBrazilianNumber(discount),
          notes,
          items: items.map((item) => ({
            productId: item.productId,
            name: item.name,
            type: item.type,
            quantity: Number(item.quantity.replace(",", ".")) || 1,
            unitPrice: parseBrazilianNumber(item.unitPrice),
          })),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Não foi possível salvar o orçamento.");
      onSaved(payload as WorkOrder);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível salvar o orçamento.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="order-modal" role="dialog" aria-modal="true" aria-labelledby="order-form-title">
        <header className="modal-header">
          <div><span className="section-kicker">ATENDIMENTO</span><h2 id="order-form-title">{initialOrder ? `Editar orçamento ${initialOrder.number}` : "Novo orçamento"}</h2></div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Fechar"><X /></button>
        </header>

        {loading ? <div className="modal-loading"><LoaderCircle className="spin" /> Carregando cadastros...</div> : (
          <form onSubmit={submit} className="order-form">
            <fieldset className="form-section">
              <legend><UserRound size={18} /> Cliente</legend>
              <div className="form-grid three-columns">
                <label className="field span-2"><span>Cliente *</span><SuggestionInput value={customerName} onChange={typeCustomer} onSelect={chooseCustomer} placeholder="Busque um cliente" required maxResults={lookups?.customers.length} firstAction={{ label: "+ Novo cliente", onClick: () => openQuickCreate("customer") }} options={(lookups?.customers??[]).map(customer=>({id:customer.id,value:customer.name,description:customer.name,searchText:`${customer.document ?? ""} ${customer.phone ?? ""}`}))}/></label>
                <label className="field"><span>Data do orçamento</span><input type="date" value={budgetDate} onChange={(event) => { const next=event.target.value; setBudgetDate(next); if(next)setValidUntil(addDays(next,7)); }} /></label>
                <label className="field"><span>Telefone</span><input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="(00) 00000-0000" disabled={Boolean(customerId)} /></label>
                <label className="field"><span>CPF/CNPJ</span><input value={document} onChange={(event) => setDocument(formatDocument(event.target.value))} placeholder="000.000.000-00" inputMode="numeric" disabled={Boolean(customerId)} /></label>
                <label className="field"><span>Mecânico</span><select value={mechanicId} onChange={(event) => setMechanicId(event.target.value)}><option value="">Não definido</option>{lookups?.mechanics.map((mechanic) => <option key={mechanic.id} value={mechanic.id}>{mechanic.name}</option>)}</select></label>
                <label className="field"><span>Validade do orçamento</span><input type="date" min={budgetDate} value={validUntil} onChange={(event) => setValidUntil(event.target.value)} required /></label>
              </div>
            </fieldset>

            <fieldset className="form-section">
              <legend><Bike size={18} /> Veículo</legend>
              <div className="form-grid four-columns">
                <label className="field span-2"><span>Veículo cadastrado</span><SuggestionInput value={vehicleSearch} onChange={(value) => { setVehicleSearch(value); setVehicleId(""); setPlate(""); setModel(""); }} onSelect={(option) => chooseVehicle(option.id)} placeholder="Digite modelo ou placa; vazio mostra todos" maxResults={lookups?.vehicles.length} firstAction={{ label: "+ Novo veículo", onClick: () => openQuickCreate("vehicle") }} options={(lookups?.vehicles ?? []).map(vehicle => ({ id: vehicle.id, value: vehicle.model ?? "Veículo sem modelo", description: vehicle.model ?? "Veículo sem modelo", detail: `Placa: ${vehicle.plate}`, searchText: vehicle.plate }))} /></label>
                <label className="field"><span>Placa</span><SuggestionInput value={plate} onChange={(value) => setPlate(value.toUpperCase())} onSelect={(option) => chooseVehicle(option.id)} placeholder="Digite para buscar placas" maxResults={lookups?.vehicles.length} options={(lookups?.vehicles ?? []).map((vehicle) => ({ id:vehicle.id, value:vehicle.plate, description:vehicle.plate, detail:vehicle.model ?? "Sem modelo" }))} /></label>
                <label className="field"><span>Quilometragem</span><NumberStepper value={mileage} onChange={setMileage} label="Quilometragem" /></label>
                <label className="field span-2"><span>Modelo/descrição</span><input value={model} onChange={(event) => { setModel(event.target.value); setVehicleSearch(event.target.value); }} /></label>
              </div>
            </fieldset>

            <fieldset className="form-section items-editor">
              <legend><PackagePlus size={18} /> Produtos e serviços</legend>
              <div className="editor-head"><span>Descrição</span><span>Tipo</span><span>Qtd.</span><span>Valor unit.</span><span></span></div>
              {items.map((item) => (
                <div className="editor-row" key={item.key}>
                  <div className="product-picker">
                    <input value={item.name} onFocus={() => setActiveProductSearch(item.key)} onChange={(event) => typeProductSearch(item, event.target.value)} onBlur={() => window.setTimeout(() => setActiveProductSearch((current) => current === item.key ? undefined : current), 150)} placeholder="Buscar por nome, SKU ou código" autoComplete="off" required />
                    {activeProductSearch === item.key && <div className="product-search-results">
                      {searchProducts(item.name).map((product) => <button type="button" className={product.stock !== undefined && product.stock <= 0 ? "out-of-stock" : ""} key={product.id} onMouseDown={(event) => event.preventDefault()} onClick={() => chooseProduct(item, product)}>
                        <span><strong>{product.name}</strong><small>{[product.type, product.sku ? `SKU ${product.sku}` : "", product.stock === undefined ? "" : `Estoque ${product.stock.toLocaleString("pt-BR")}`].filter(Boolean).join(" · ")}</small></span>
                        <b>{currency.format(product.salePrice)}</b>
                      </button>)}
                      {!searchProducts(item.name).length && <p>Nenhum item cadastrado encontrado.</p>}
                    </div>}
                  </div>
                  <select value={item.type} onChange={(event) => updateItem(item.key, { type: event.target.value })}><option>Produto</option><option>Serviço</option><option>Produto/Serviço</option></select>
                  <NumberStepper min={1} step={1} value={item.quantity} onChange={(value) => updateItem(item.key, { quantity: value })} label="Quantidade" required />
                  <MoneyInput value={item.unitPrice} onValueChange={(value) => updateItem(item.key, { unitPrice: value })} aria-label="Valor unitário" required />
                  <button type="button" className="remove-item" onClick={() => setItems((current) => current.filter((entry) => entry.key !== item.key))} disabled={items.length === 1} aria-label="Remover item"><Trash2 size={18} /></button>
                </div>
              ))}
              <button type="button" className="add-item" onClick={addItem}><CirclePlus size={17} /> Adicionar item</button>
              {stockShortages.length > 0 && <div className="budget-stock-warning" role="alert">
                <AlertTriangle size={20} />
                <div><strong>Produto sem estoque suficiente</strong><p>{stockShortages.map((item) => `${item.name}: disponível ${item.available.toLocaleString("pt-BR")} · necessário ${item.required.toLocaleString("pt-BR")}`).join(" | ")}</p><small>Será necessário confirmar explicitamente para salvar este orçamento e novamente antes de concluir a venda.</small></div>
              </div>}
            </fieldset>

            <div className="form-footer-grid">
              <label className="field notes-field"><span>Observações</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} placeholder="Informações importantes para o atendimento" /></label>
              <div className="budget-summary">
                <label className="field"><span>Desconto</span><MoneyInput value={discount} onValueChange={setDiscount} /></label>
                <p><span>Subtotal</span><b>{currency.format(subtotal)}</b></p>
                <p className="grand-total"><span>Total</span><strong>{currency.format(total)}</strong></p>
              </div>
            </div>

            {error && <p className="form-error">{error}</p>}
            <footer className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button type="submit" className="primary-button" disabled={saving}>{saving ? <LoaderCircle className="spin" size={18} /> : <Save size={18} />}{saving ? "Salvando..." : initialOrder ? "Salvar alterações" : "Salvar orçamento"}</button></footer>
          </form>
        )}
      </section>
      {quickCreate && <div className="quick-create-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setQuickCreate(null)}>
        <section className="quick-create-modal" role="dialog" aria-modal="true" aria-label={quickCreate === "customer" ? "Novo cliente" : "Novo veículo"}>
          <header className="modal-header"><div><span className="section-kicker">CADASTRO RÁPIDO</span><h2>{quickCreate === "customer" ? "Novo cliente" : "Novo veículo"}</h2></div><button type="button" className="icon-button" onClick={() => setQuickCreate(null)} aria-label="Fechar"><X /></button></header>
          <form className="order-form" onSubmit={saveQuickCreate}><div className="form-grid registry-form-grid">
            {quickCreate === "vehicle" && <label className="field span-2"><span>Cliente *</span><select value={quickForm.customerId ?? ""} onChange={(event) => setQuickField("customerId",event.target.value)} required><option value="">Selecione um cliente</option>{(lookups?.customers ?? []).map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>}
            {(quickCreate === "customer" ? quickCustomerFields : quickVehicleFields).map((field, index) => <label className={`field ${field.key === "name" || field.key === "model" ? "span-2" : ""}`} key={field.key}><span>{field.label}{field.required ? " *" : ""}</span>
              {field.kind === "number" ? <NumberStepper value={quickForm[field.key] ?? ""} onChange={(value) => setQuickField(field.key,value)} label={field.label} /> : field.kind === "document" || field.kind === "zip" ? <div className="quick-lookup-field"><input value={quickForm[field.key] ?? ""} onChange={(event) => setQuickField(field.key,field.kind === "document" ? formatDocument(event.target.value) : event.target.value.replace(/\D/g, "").slice(0,8).replace(/^(\d{5})(\d)/,"$1-$2"))} inputMode="numeric" placeholder={field.kind === "document" ? "000.000.000-00" : "00000-000"} /><button type="button" onClick={() => void lookupQuick(field.kind === "document" ? "cnpj" : "cep")} disabled={Boolean(quickLookupLoading) || (quickForm[field.key] ?? "").replace(/\D/g, "").length !== (field.kind === "document" ? 14 : 8)}>{quickLookupLoading === (field.kind === "document" ? "cnpj" : "cep") ? <LoaderCircle className="spin" size={16} /> : <Search size={16} />} Buscar</button></div> : <input value={quickForm[field.key] ?? ""} onChange={(event) => setQuickField(field.key,field.key === "plate" || field.key === "state" || field.key === "registrationState" || field.key === "defaultPlate" ? event.target.value.toUpperCase() : event.target.value)} type={field.kind === "email" ? "email" : "text"} required={field.required} placeholder={field.placeholder} autoFocus={index === 0 && quickCreate === "customer"} />}
            </label>)}
          </div>{quickError && <p className="form-error">{quickError}</p>}<footer className="modal-actions"><button type="button" className="secondary-button" onClick={() => setQuickCreate(null)}>Voltar</button><button type="submit" className="primary-button" disabled={quickSaving}>{quickSaving ? "Salvando..." : "Cadastrar e selecionar"}</button></footer></form>
        </section>
      </div>}
    </div>
  );
}
