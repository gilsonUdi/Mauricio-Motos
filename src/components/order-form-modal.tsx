"use client";

import { Bike, CirclePlus, LoaderCircle, PackagePlus, Save, Trash2, UserRound, X } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import type { OrderLookups, ProductLookup, WorkOrder } from "@/lib/types";

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

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const normalize = (value: string) => value.trim().toLocaleLowerCase("pt-BR");

function blankItem(key: number): DraftItem {
  return { key, name: "", type: "Produto", quantity: "1", unitPrice: "0" };
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
  const [plate, setPlate] = useState(initialOrder?.plate ?? "");
  const [model, setModel] = useState(initialOrder?.model ?? "");
  const [mileage, setMileage] = useState(initialOrder?.mileage ? String(initialOrder.mileage) : "");
  const [mechanicId, setMechanicId] = useState(initialOrder?.mechanicId ?? "");
  const [budgetDate, setBudgetDate] = useState(initialOrder?.budgetDate ?? today);
  const [discount, setDiscount] = useState(String(initialOrder?.discount ?? 0));
  const [notes, setNotes] = useState(initialOrder?.notes ?? "");
  const [items, setItems] = useState<DraftItem[]>(initialOrder?.items.length ? initialOrder.items.map((item, index) => ({
    key: index + 1,
    productId: item.productId,
    name: item.name,
    type: item.type || "Produto/Serviço",
    quantity: String(item.quantity),
    unitPrice: String(item.unitPrice),
  })) : [blankItem(1)]);
  const [nextKey, setNextKey] = useState((initialOrder?.items.length ?? 1) + 1);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/lookups", { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Não foi possível carregar os cadastros.");
        const loaded = payload as OrderLookups;
        setLookups(loaded);
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
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const customerVehicles = useMemo(() => {
    if (!lookups) return [];
    return customerId ? lookups.vehicles.filter((vehicle) => vehicle.customerId === customerId) : lookups.vehicles;
  }, [customerId, lookups]);

  const subtotal = useMemo(() => items.reduce((sum, item) => (
    sum + (Number(item.quantity.replace(",", ".")) || 0) * (Number(item.unitPrice.replace(",", ".")) || 0)
  ), 0), [items]);
  const total = Math.max(0, subtotal - (Number(discount.replace(",", ".")) || 0));

  function chooseCustomer(value: string) {
    setCustomerName(value);
    const customer = lookups?.customers.find((entry) => normalize(entry.name) === normalize(value));
    setCustomerId(customer?.id ?? "");
    setPhone(customer?.phone ?? "");
    setDocument(customer?.document ?? "");
    setVehicleId("");
    setPlate("");
    setModel("");
    setMileage("");
  }

  function chooseVehicle(id: string) {
    setVehicleId(id);
    const vehicle = lookups?.vehicles.find((entry) => entry.id === id);
    setPlate(vehicle?.plate ?? "");
    setModel(vehicle?.model ?? "");
    setMileage(vehicle?.mileage ? String(vehicle.mileage) : "");
  }

  function updateItem(key: number, patch: Partial<DraftItem>) {
    setItems((current) => current.map((item) => item.key === key ? { ...item, ...patch } : item));
  }

  function chooseProduct(item: DraftItem, value: string) {
    const product = lookups?.products.find((entry) => normalize(entry.name) === normalize(value));
    updateItem(item.key, {
      name: value,
      productId: product?.id,
      type: product?.type ?? item.type,
      unitPrice: product ? String(product.salePrice) : item.unitPrice,
    });
  }

  function addItem() {
    setItems((current) => [...current, blankItem(nextKey)]);
    setNextKey((current) => current + 1);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!customerName.trim()) return setError("Informe o cliente.");
    if (items.some((item) => !item.name.trim())) return setError("Preencha a descrição de todos os itens.");

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
          mileage: Number(mileage) || undefined,
          mechanicId: mechanicId || undefined,
          budgetDate,
          discount: Number(discount.replace(",", ".")) || 0,
          notes,
          items: items.map((item) => ({
            productId: item.productId,
            name: item.name,
            type: item.type,
            quantity: Number(item.quantity.replace(",", ".")) || 1,
            unitPrice: Number(item.unitPrice.replace(",", ".")) || 0,
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
                <label className="field span-2"><span>Cliente *</span><input list="customer-options" value={customerName} onChange={(event) => chooseCustomer(event.target.value)} placeholder="Busque ou digite um novo cliente" required /></label>
                <label className="field"><span>Data do orçamento</span><input type="date" value={budgetDate} onChange={(event) => setBudgetDate(event.target.value)} /></label>
                <label className="field"><span>Telefone</span><input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="(00) 00000-0000" disabled={Boolean(customerId)} /></label>
                <label className="field"><span>CPF/CNPJ</span><input value={document} onChange={(event) => setDocument(event.target.value)} placeholder="Documento" disabled={Boolean(customerId)} /></label>
                <label className="field"><span>Mecânico</span><select value={mechanicId} onChange={(event) => setMechanicId(event.target.value)}><option value="">Não definido</option>{lookups?.mechanics.map((mechanic) => <option key={mechanic.id} value={mechanic.id}>{mechanic.name}</option>)}</select></label>
              </div>
            </fieldset>

            <fieldset className="form-section">
              <legend><Bike size={18} /> Veículo</legend>
              <div className="form-grid four-columns">
                <label className="field span-2"><span>Veículo cadastrado</span><select value={vehicleId} onChange={(event) => chooseVehicle(event.target.value)}><option value="">Cadastrar/informar outro veículo</option>{customerVehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.plate} — {vehicle.model ?? "Sem modelo"}</option>)}</select></label>
                <label className="field"><span>Placa</span><input value={plate} onChange={(event) => setPlate(event.target.value.toUpperCase())} disabled={Boolean(vehicleId)} /></label>
                <label className="field"><span>Quilometragem</span><input type="number" min="0" value={mileage} onChange={(event) => setMileage(event.target.value)} /></label>
                <label className="field span-2"><span>Modelo/descrição</span><input value={model} onChange={(event) => setModel(event.target.value)} disabled={Boolean(vehicleId)} /></label>
              </div>
            </fieldset>

            <fieldset className="form-section items-editor">
              <legend><PackagePlus size={18} /> Produtos e serviços</legend>
              <div className="editor-head"><span>Descrição</span><span>Tipo</span><span>Qtd.</span><span>Valor unit.</span><span></span></div>
              {items.map((item) => (
                <div className="editor-row" key={item.key}>
                  <input list="product-options" value={item.name} onChange={(event) => chooseProduct(item, event.target.value)} placeholder="Busque ou digite um item" required />
                  <select value={item.type} onChange={(event) => updateItem(item.key, { type: event.target.value })}><option>Produto</option><option>Serviço</option><option>Produto/Serviço</option></select>
                  <input type="number" min="0.001" step="0.001" value={item.quantity} onChange={(event) => updateItem(item.key, { quantity: event.target.value })} aria-label="Quantidade" />
                  <input type="number" min="0" step="0.01" value={item.unitPrice} onChange={(event) => updateItem(item.key, { unitPrice: event.target.value })} aria-label="Valor unitário" />
                  <button type="button" className="remove-item" onClick={() => setItems((current) => current.filter((entry) => entry.key !== item.key))} disabled={items.length === 1} aria-label="Remover item"><Trash2 size={18} /></button>
                </div>
              ))}
              <button type="button" className="add-item" onClick={addItem}><CirclePlus size={17} /> Adicionar item</button>
            </fieldset>

            <div className="form-footer-grid">
              <label className="field notes-field"><span>Observações</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} placeholder="Informações importantes para o atendimento" /></label>
              <div className="budget-summary">
                <label className="field"><span>Desconto</span><input type="number" min="0" step="0.01" value={discount} onChange={(event) => setDiscount(event.target.value)} /></label>
                <p><span>Subtotal</span><b>{currency.format(subtotal)}</b></p>
                <p className="grand-total"><span>Total</span><strong>{currency.format(total)}</strong></p>
              </div>
            </div>

            {error && <p className="form-error">{error}</p>}
            <footer className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button type="submit" className="primary-button" disabled={saving}>{saving ? <LoaderCircle className="spin" size={18} /> : <Save size={18} />}{saving ? "Salvando..." : initialOrder ? "Salvar alterações" : "Salvar orçamento"}</button></footer>
          </form>
        )}

        <datalist id="customer-options">{lookups?.customers.map((customer) => <option key={customer.id} value={customer.name} />)}</datalist>
        <datalist id="product-options">{lookups?.products.map((product: ProductLookup) => <option key={product.id} value={product.name}>{currency.format(product.salePrice)}</option>)}</datalist>
      </section>
    </div>
  );
}
