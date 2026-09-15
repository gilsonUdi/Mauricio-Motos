"use client";

import { CheckCircle2, LoaderCircle, WalletCards, X } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import type { SaleFinancialConfig, WorkOrder } from "@/lib/types";
import { MoneyInput } from "@/components/money-input";
import { parseBrazilianNumber } from "@/lib/numbers";

type Account = { id: string; name: string };
type FeeRule = {
  minimumInstallments: number;
  maximumInstallments: number | null;
  feePercent: number;
};
type PaymentMethod = {
  id: string;
  name: string;
  supportsInstallments: boolean;
  maximumInstallments: number;
  variableFee: boolean;
  defaultFeePercent: number;
  defaultAccountId?: string;
  rules: FeeRule[];
};
type Options = { accounts: Account[]; methods: PaymentMethod[] };

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
const today = () => new Date().toLocaleDateString("en-CA");

export function SaleFinanceModal({
  order,
  onClose,
  onConfirm,
}: {
  order: WorkOrder;
  onClose: () => void;
  onConfirm: (config: SaleFinancialConfig) => Promise<void>;
}) {
  const [options, setOptions] = useState<Options>({
    accounts: [],
    methods: [],
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [entry, setEntry] = useState("0,00");
  const [installments, setInstallments] = useState(1);
  const [firstDueDate, setFirstDueDate] = useState(today);
  const [methodId, setMethodId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [customerAssumesFee, setCustomerAssumesFee] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/orders/financial-options", { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok)
          throw new Error(
            payload.error ?? "Não foi possível carregar as opções financeiras.",
          );
        setOptions(payload);
        const method = payload.methods[0] as PaymentMethod | undefined;
        setMethodId(method?.id ?? "");
        setAccountId(method?.defaultAccountId ?? payload.accounts[0]?.id ?? "");
      })
      .catch((caught) => {
        if (caught instanceof Error && caught.name !== "AbortError")
          setError(caught.message);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  const method = options.methods.find((item) => item.id === methodId);
  const entryAmount = Math.max(0, parseBrazilianNumber(entry));
  const balance = Math.max(0, order.total - entryAmount);
  const feePercent = useMemo(() => {
    if (!method) return 0;
    if (!method.variableFee) return method.defaultFeePercent;
    return (
      method.rules.find(
        (rule) =>
          installments >= rule.minimumInstallments &&
          (rule.maximumInstallments === null ||
            installments <= rule.maximumInstallments),
      )?.feePercent ?? method.defaultFeePercent
    );
  }, [installments, method]);
  const chargeTotal = customerAssumesFee && feePercent > 0 && feePercent < 100
    ? order.total / (1 - feePercent / 100)
    : order.total;
  const chargedBalance = customerAssumesFee && feePercent > 0 && feePercent < 100
    ? balance / (1 - feePercent / 100)
    : balance;
  const feeAmount = chargeTotal * feePercent / 100;
  const netAmount = chargeTotal - feeAmount;
  const allowedInstallments = useMemo(() => {
    const maximum = method?.supportsInstallments ? Math.max(1, method.maximumInstallments || 1) : 1;
    return Array.from({ length: maximum }, (_, index) => index + 1).filter((count) =>
      !method?.variableFee || method.rules.some((rule) => count >= rule.minimumInstallments && (rule.maximumInstallments === null || count <= rule.maximumInstallments))
    );
  }, [method]);

  function chooseMethod(value: string) {
    const selected = options.methods.find((item) => item.id === value);
    setMethodId(value);
    if (selected?.defaultAccountId) setAccountId(selected.defaultAccountId);
    const nextAllowed = selected?.supportsInstallments
      ? Array.from({ length: Math.max(1, selected.maximumInstallments || 1) }, (_, index) => index + 1).filter((count) => !selected.variableFee || selected.rules.some((rule) => count >= rule.minimumInstallments && (rule.maximumInstallments === null || count <= rule.maximumInstallments)))
      : [1];
    setInstallments(nextAllowed[0] ?? 1);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (entryAmount > order.total)
      return setError("A entrada não pode ser maior que o total da venda.");
    setSaving(true);
    setError("");
    try {
      await onConfirm({
        entryAmount,
        installmentCount: installments,
        firstDueDate,
        paymentMethodId: methodId,
        financialAccountId: accountId,
        customerAssumesFee,
      });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Não foi possível concluir a venda.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <section className="registry-modal sale-finance-modal">
        <header className="modal-header">
          <div>
            <span className="section-kicker">FECHAMENTO DA VENDA</span>
            <h2>Condições financeiras</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Fechar">
            <X />
          </button>
        </header>
        {loading ? (
          <div className="modal-loading">
            <LoaderCircle className="spin" /> Carregando configurações...
          </div>
        ) : (
          <form className="registry-form" onSubmit={submit}>
            <p className="payment-callout">
              <WalletCards />
              <span>
                <b>
                  Ordem #{order.number} · {order.customer}
                </b>
                <br />
                Total da venda: {money.format(order.total)}
              </span>
            </p>
            <div className="form-grid registry-form-grid">
              <label className="field">
                <span>Entrada</span>
                <MoneyInput value={entry} onValueChange={setEntry} />
              </label>
              <label className="field">
                <span>{customerAssumesFee ? "Saldo a parcelar na maquininha" : "Saldo a parcelar"}</span>
                <input value={money.format(customerAssumesFee ? chargedBalance : balance)} disabled />
              </label>
              <label className="field">
                <span>Número de parcelas</span>
                <select value={installments} onChange={(event) => setInstallments(Number(event.target.value))} disabled={allowedInstallments.length <= 1}>
                  {allowedInstallments.map((count) => <option value={count} key={count}>{count}x</option>)}
                </select>
              </label>
              <label className="field">
                <span>Primeiro vencimento</span>
                <input
                  type="date"
                  value={firstDueDate}
                  onChange={(event) => setFirstDueDate(event.target.value)}
                  required
                />
              </label>
              <label className="field">
                <span>Forma de pagamento</span>
                <select
                  value={methodId}
                  onChange={(event) => chooseMethod(event.target.value)}
                  required
                >
                  <option value="">Selecione</option>
                  {options.methods.map((item) => (
                    <option value={item.id} key={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Conta financeira</span>
                <select
                  value={accountId}
                  onChange={(event) => setAccountId(event.target.value)}
                  required
                >
                  <option value="">Selecione</option>
                  {options.accounts.map((item) => (
                    <option value={item.id} key={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {feePercent > 0 && (
              <label className="checkbox-field sale-fee-payer">
                <input type="checkbox" checked={customerAssumesFee} onChange={(event) => setCustomerAssumesFee(event.target.checked)} />
                <span>Repassar a taxa da maquininha ao cliente</span>
              </label>
            )}
            <div className="sale-finance-summary">
              <span>
                <small>Parcelas</small>
                <b>
                  {installments}x de{" "}
                  {money.format(installments ? chargedBalance / installments : 0)}
                </b>
              </span>
              <span>
                <small>Taxa congelada</small>
                <b>
                  {feePercent.toLocaleString("pt-BR")}% ·{" "}
                  {money.format(feeAmount)}
                </b>
              </span>
              <span>
                <small>{customerAssumesFee ? "Valor na maquininha" : "Líquido estimado"}</small>
                <b>{money.format(customerAssumesFee ? chargeTotal : netAmount)}</b>
              </span>
            </div>
            {customerAssumesFee && feePercent > 0 && <p className="payment-callout fee-warning"><WalletCards/><span><b>Cobrar {money.format(chargeTotal)} do cliente.</b><br/>Após a taxa, a empresa recebe {money.format(order.total)} líquidos.</span></p>}
            {!options.methods.length && (
              <p className="form-error">
                Cadastre uma forma de pagamento antes de concluir a venda.
              </p>
            )}
            {!options.accounts.length && (
              <p className="form-error">
                Cadastre uma conta financeira antes de concluir a venda.
              </p>
            )}
            {error && <p className="form-error">{error}</p>}
            <footer className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={onClose}
              >
                Cancelar
              </button>
              <button
                className="primary-button"
                disabled={
                  saving || !options.methods.length || !options.accounts.length
                }
              >
                {saving ? (
                  <LoaderCircle className="spin" size={18} />
                ) : (
                  <CheckCircle2 size={18} />
                )}
                Concluir e gerar parcelas
              </button>
            </footer>
          </form>
        )}
      </section>
    </div>
  );
}
