"use client";

import { BadgeCheck, LoaderCircle, X } from "lucide-react";
import { FormEvent, useState } from "react";
import type { BudgetApprovalConfig, WorkOrder } from "@/lib/types";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function BudgetApprovalModal({ order, onClose, onConfirm }: {
  order: WorkOrder;
  onClose: () => void;
  onConfirm: (approval: BudgetApprovalConfig) => Promise<void>;
}) {
  const [approvedBy, setApprovedBy] = useState(order.customer);
  const [method, setMethod] = useState("WhatsApp");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!approvedBy.trim()) return setError("Informe quem aprovou o orçamento.");
    setSaving(true);
    setError("");
    try {
      await onConfirm({ approvedByCustomer: approvedBy.trim(), approvalMethod: method, approvalNotes: notes.trim() || undefined });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível registrar a aprovação.");
    } finally {
      setSaving(false);
    }
  }

  return <div className="modal-backdrop">
    <section className="registry-modal">
      <header className="modal-header"><div><span className="section-kicker">APROVAÇÃO DO CLIENTE</span><h2>Gerar pedido</h2></div><button className="icon-button" onClick={onClose} aria-label="Fechar"><X /></button></header>
      <form className="registry-form" onSubmit={submit}>
        <p className="payment-callout"><BadgeCheck /><span><b>Orçamento #{order.number} · {order.customer}</b><br />Valor aprovado: {currency.format(order.total)}</span></p>
        <div className="form-grid registry-form-grid">
          <label className="field"><span>Nome de quem aprovou *</span><input value={approvedBy} maxLength={160} onChange={(event) => setApprovedBy(event.target.value)} required /></label>
          <label className="field"><span>Canal da aprovação *</span><select value={method} onChange={(event) => setMethod(event.target.value)} required><option>WhatsApp</option><option>Telefone</option><option>Presencial</option><option>E-mail</option><option>Outro</option></select></label>
          <label className="field span-2"><span>Observações da aprovação</span><textarea rows={3} maxLength={1000} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Ex.: cliente aprovou todos os itens sem alterações" /></label>
        </div>
        {error && <p className="form-error">{error}</p>}
        <footer className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={saving}>{saving ? <LoaderCircle className="spin" size={18} /> : <BadgeCheck size={18} />}{saving ? "Registrando..." : "Confirmar e gerar pedido"}</button></footer>
      </form>
    </section>
  </div>;
}
