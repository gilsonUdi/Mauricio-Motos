"use client";

import { Bike, Building2, LoaderCircle, Menu, PackagePlus, Pencil, Plus, Save, Search, UserRoundCog, Users, Wrench, X } from "lucide-react";
import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import type { RegistryEntity } from "@/lib/registries";

type RegistryRecord = { id: string; [key: string]: unknown };
type CustomerOption = { id: string; name: string };
type SupplierOption = { id: string; name: string };
type FieldDefinition = {
  key: string;
  label: string;
  type?: "text" | "number" | "checkbox" | "customer" | "supplier" | "select" | "document" | "zip" | "plate";
  required?: boolean;
  step?: string;
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
};
type ColumnDefinition = { key: string; label: string; format?: "money" | "percent" | "number" | "status" };

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });

const configs: Record<RegistryEntity, {
  title: string;
  singular: string;
  description: string;
  icon: typeof Users;
  fields: FieldDefinition[];
  columns: ColumnDefinition[];
}> = {
  customers: {
    title: "Clientes", singular: "cliente", icon: Users,
    description: "Contatos e veículos padrão utilizados nos atendimentos.",
    fields: [
      { key: "name", label: "Nome", required: true },
      { key: "phone", label: "Telefone" },
      { key: "email", label: "E-mail" },
      { key: "document", label: "CPF/CNPJ", type:"document" },
      { key: "zipCode", label: "CEP", type:"zip" },
      { key: "street", label: "Logradouro" },
      { key: "addressNumber", label: "Número" },
      { key: "complement", label: "Complemento" },
      { key: "district", label: "Bairro" },
      { key: "city", label: "Cidade" },
      { key: "state", label: "UF" },
      { key: "defaultPlate", label: "Placa padrão" },
      { key: "defaultModel", label: "Modelo padrão" },
    ],
    columns: [
      { key: "name", label: "Cliente" }, { key: "phone", label: "Telefone" },
      { key: "document", label: "CPF/CNPJ" }, { key: "city", label: "Cidade" },
    ],
  },
  vehicles: {
    title: "Veículos", singular: "veículo", icon: Bike,
    description: "Motos e veículos vinculados aos clientes da oficina.",
    fields: [
      { key: "customerId", label: "Cliente", type: "customer" },
      { key: "plate", label: "Placa", type: "plate", required: true },
      { key: "model", label: "Modelo/descrição" },
      { key: "brand", label: "Marca" },
      { key: "manufactureYear", label: "Ano de fabricação", type: "number", step: "1" },
      { key: "modelYear", label: "Ano do modelo", type: "number", step: "1" },
      { key: "color", label: "Cor" },
      { key: "fuel", label: "Combustível" },
      { key: "engineDisplacement", label: "Cilindrada" },
      { key: "registrationCity", label: "Município de registro" },
      { key: "registrationState", label: "UF de registro" },
      { key: "mileage", label: "Quilometragem", type: "number", step: "1" },
    ],
    columns: [
      { key: "plate", label: "Placa" }, { key: "model", label: "Modelo" },
      { key: "customerName", label: "Cliente" }, { key: "mileage", label: "Quilometragem", format: "number" },
    ],
  },
  products: {
    title: "Produtos e serviços", singular: "produto ou serviço", icon: Wrench,
    description: "Catálogo, preços e saldo atual usados na montagem dos orçamentos.",
    fields: [
      { key: "name", label: "Nome", required: true },
      { key: "itemKind", label: "Natureza", type: "select", options: [{value:"PRODUTO",label:"Produto"},{value:"SERVICO",label:"Serviço"}] },
      { key: "type", label: "Categoria/Tipo", placeholder: "Ex.: Peça, óleo ou mão de obra" },
      { key: "sku", label: "Código interno (SKU)" },
      { key: "barcode", label: "Código de barras" },
      { key: "brand", label: "Marca" },
      { key: "supplierId", label: "Fornecedor principal", type: "supplier" },
      { key: "costPrice", label: "Preço de custo", type: "number", step: "0.01" },
      { key: "salePrice", label: "Preço de venda", type: "number", step: "0.01" },
      { key: "profitMargin", label: "Margem (%)", type: "number", step: "0.01", placeholder: "Calculada se ficar vazia" },
      { key: "stock", label: "Estoque atual", type: "number", step: "0.001" },
      { key: "minimumStock", label: "Estoque mínimo", type: "number", step: "0.001" },
      { key: "leadTimeDays", label: "Prazo de reposição (dias)", type: "number", step: "1" },
      { key: "stockLocation", label: "Localização no estoque" },
      { key: "ncm", label: "NCM" },
      { key: "cest", label: "CEST" },
      { key: "fiscalOrigin", label: "Origem fiscal" },
      { key: "commercialUnit", label: "Unidade comercial", placeholder: "UN" },
      { key: "defaultCfop", label: "CFOP padrão" },
      { key: "taxCode", label: "CST/CSOSN" },
      { key: "taxRate", label: "Alíquota padrão (%)", type: "number", step: "0.0001" },
      { key: "active", label: "Cadastro ativo", type: "checkbox" },
    ],
    columns: [
      { key: "name", label: "Descrição" }, { key: "itemKind", label: "Natureza" },
      { key: "sku", label: "SKU" },
      { key: "salePrice", label: "Venda", format: "money" }, { key: "stock", label: "Estoque", format: "number" },
      { key: "active", label: "Situação", format: "status" },
    ],
  },
  mechanics: {
    title: "Mecânicos", singular: "mecânico", icon: UserRoundCog,
    description: "Profissionais disponíveis e percentual padrão de comissão.",
    fields: [
      { key: "name", label: "Nome", required: true },
      { key: "commissionPercent", label: "Comissão (%)", type: "number", step: "0.01" },
      { key: "active", label: "Cadastro ativo", type: "checkbox" },
    ],
    columns: [
      { key: "name", label: "Mecânico" }, { key: "commissionPercent", label: "Comissão", format: "percent" },
      { key: "active", label: "Situação", format: "status" },
    ],
  },
  suppliers: {
    title: "Fornecedores", singular: "fornecedor", icon: Building2,
    description: "Fornecedores utilizados nas compras, obrigações e reposições de estoque.",
    fields: [
      { key: "name", label: "Nome fantasia", required: true },
      { key: "legalName", label: "Razão social" },
      { key: "document", label: "CNPJ/CPF", type:"document" },
      { key: "stateRegistration", label: "Inscrição estadual" },
      { key: "phone", label: "Telefone" },
      { key: "email", label: "E-mail" },
      { key: "zipCode", label: "CEP", type:"zip" },
      { key: "street", label: "Logradouro" },
      { key: "addressNumber", label: "Número" },
      { key: "complement", label: "Complemento" },
      { key: "district", label: "Bairro" },
      { key: "city", label: "Cidade" },
      { key: "state", label: "UF" },
      { key: "paymentTermsDays", label: "Prazo padrão (dias)", type: "number", step: "1" },
      { key: "notes", label: "Observações" },
      { key: "active", label: "Cadastro ativo", type: "checkbox" },
    ],
    columns: [
      { key: "name", label: "Fornecedor" }, { key: "document", label: "CNPJ/CPF" },
      { key: "phone", label: "Telefone" }, { key: "city", label: "Cidade" },
      { key: "state", label: "UF" }, { key: "active", label: "Situação", format: "status" },
    ],
  },
};

function displayValue(value: unknown, format?: ColumnDefinition["format"]) {
  if (format === "money") return currency.format(Number(value) || 0);
  if (format === "percent") return `${number.format(Number(value) || 0)}%`;
  if (format === "number") return value === null || value === undefined ? "—" : number.format(Number(value));
  if (format === "status") return value ? "Ativo" : "Inativo";
  return value === null || value === undefined || value === "" ? "—" : String(value);
}

function initialForm(entity: RegistryEntity, record?: RegistryRecord) {
  const result: Record<string, string | boolean> = {};
  for (const field of configs[entity].fields) {
    const value = record?.[field.key];
    result[field.key] = field.type === "checkbox" ? (record ? Boolean(value) : true) : value === null || value === undefined ? (field.type === "select" ? field.options?.[0]?.value ?? "" : "") : String(value);
  }
  return result;
}

export function RegistryPage({ entity }: { entity: RegistryEntity }) {
  const config = configs[entity];
  const Icon = config.icon;
  const [records, setRecords] = useState<RegistryRecord[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [visibleLimit, setVisibleLimit] = useState(80);
  const [editing, setEditing] = useState<RegistryRecord | null | undefined>(undefined);
  const [form, setForm] = useState<Record<string, string | boolean>>(initialForm(entity));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [mobileMenu, setMobileMenu] = useState(false);
  const [lookupLoading,setLookupLoading]=useState<"cep"|"cnpj"|"plate">();

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/registries/${entity}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Não foi possível carregar o cadastro.");
        setRecords(payload.records as RegistryRecord[]);
        setCustomers(payload.customers as CustomerOption[] ?? []);
        setSuppliers(payload.suppliers as SupplierOption[] ?? []);
      })
      .catch((caught) => {
        if (caught instanceof Error && caught.name !== "AbortError") setError(caught.message);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [entity]);

  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("pt-BR");
    if (!term) return records;
    return records.filter((record) => Object.values(record).some((value) => String(value ?? "").toLocaleLowerCase("pt-BR").includes(term)));
  }, [query, records]);
  const activeCount = records.filter((record) => record.active !== false).length;

  function openForm(record: RegistryRecord | null) {
    setEditing(record);
    setForm(initialForm(entity, record ?? undefined));
    setError("");
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch(editing ? `/api/registries/${entity}/${editing.id}` : `/api/registries/${entity}`, {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Não foi possível salvar.");
      const saved = payload as RegistryRecord;
      setRecords((current) => editing ? current.map((record) => record.id === saved.id ? saved : record) : [saved, ...current]);
      setNotice(`${config.singular[0].toUpperCase()}${config.singular.slice(1)} ${editing ? "atualizado" : "cadastrado"} com sucesso.`);
      setEditing(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  }

  async function lookup(type:"cep"|"cnpj"|"plate") {
    const key=type==="cep"?"zipCode":type==="cnpj"?"document":"plate";
    const rawValue=String(form[key]??"");
    const value=type==="plate"?rawValue.toUpperCase().replace(/[^A-Z0-9]/g,""):rawValue.replace(/\D/g,"");
    setLookupLoading(type);setError("");
    try { const response=await fetch(`/api/registry-lookup?type=${type}&value=${encodeURIComponent(value)}`);const payload=await response.json();if(!response.ok)throw new Error(payload.error??"Não foi possível consultar os dados.");setForm(current=>({...current,...payload}));setNotice(type==="cep"?"Endereço preenchido pelo CEP.":type==="cnpj"?"Dados do CNPJ preenchidos. Revise antes de salvar.":"Dados do veículo preenchidos pela placa. Revise antes de salvar."); }
    catch(caught){setError(caught instanceof Error?caught.message:"Não foi possível consultar os dados.");}
    finally{setLookupLoading(undefined);}
  }

  return (
    <div className="app-shell">
      <AppSidebar active={entity} />
      <main className="workspace registry-workspace">
        <header className="topbar registry-topbar">
          <button className="mobile-menu" onClick={() => setMobileMenu(!mobileMenu)} aria-label="Abrir menu"><Menu /></button>
          <div><p className="eyebrow">CADASTROS</p><h1>{config.title}</h1><p className="page-description">{config.description}</p></div>
          <button className="primary-button" onClick={() => openForm(null)}><Plus size={18} /> Novo {config.singular}</button>
        </header>
        {mobileMenu && <div className="mobile-shortcuts registry-shortcuts"><Link href="/">Atendimento</Link><Link href="/clientes">Clientes</Link><Link href="/veiculos">Veículos</Link><Link href="/produtos">Produtos</Link><Link href="/mecanicos">Mecânicos</Link><Link href="/fornecedores">Fornecedores</Link><Link href="/categorias-financeiras">Categorias financeiras</Link></div>}

        <section className="registry-summary">
          <div><Icon size={22} /><span>Total cadastrado</span><strong>{records.length}</strong></div>
          {(entity === "products" || entity === "mechanics") && <div><PackagePlus size={22} /><span>Cadastros ativos</span><strong>{activeCount}</strong></div>}
          <label className="registry-search"><Search size={19} /><input value={query} onChange={(event) => { setQuery(event.target.value); setVisibleLimit(80); }} placeholder={`Buscar ${config.title.toLocaleLowerCase("pt-BR")}`} /></label>
        </section>

        <section className="registry-panel">
          {loading ? <div className="registry-loading"><LoaderCircle className="spin" /> Carregando cadastro...</div> : error && !records.length ? <div className="empty-state">{error}</div> : (
            <>
              <div className="registry-table-wrap">
                <table className="registry-table">
                  <thead><tr>{config.columns.map((column) => <th key={column.key}>{column.label}</th>)}<th>Ações</th></tr></thead>
                  <tbody>
                    {filtered.slice(0, visibleLimit).map((record) => <tr key={record.id} className={record.active === false ? "inactive-row" : ""}>
                      {config.columns.map((column) => <td key={column.key} data-label={column.label}>{column.format === "status" ? <span className={`registry-status ${record[column.key] ? "active" : "inactive"}`}>{displayValue(record[column.key], column.format)}</span> : displayValue(record[column.key], column.format)}</td>)}
                      <td data-label="Ações"><button className="table-action" onClick={() => openForm(record)}><Pencil size={16} /> Editar</button></td>
                    </tr>)}
                  </tbody>
                </table>
                {!filtered.length && <div className="empty-state">Nenhum registro encontrado.</div>}
              </div>
              {visibleLimit < filtered.length && <button className="load-more" onClick={() => setVisibleLimit((current) => current + 80)}>Mostrar mais {Math.min(80, filtered.length - visibleLimit)} registros</button>}
            </>
          )}
        </section>
      </main>

      {editing !== undefined && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setEditing(undefined)}>
        <section className="registry-modal" role="dialog" aria-modal="true" aria-labelledby="registry-form-title">
          <header className="modal-header"><div><span className="section-kicker">CADASTRO</span><h2 id="registry-form-title">{editing ? `Editar ${config.singular}` : `Novo ${config.singular}`}</h2></div><button className="icon-button" onClick={() => setEditing(undefined)} aria-label="Fechar"><X /></button></header>
          <form className="registry-form" onSubmit={save}>
            <div className="form-grid registry-form-grid">
              {config.fields.map((field) => field.type === "checkbox" ? (
                <label className="checkbox-field" key={field.key}><input type="checkbox" checked={Boolean(form[field.key])} onChange={(event) => setForm((current) => ({ ...current, [field.key]: event.target.checked }))} /><span>{field.label}</span></label>
              ) : field.type === "customer" ? (
                <label className="field span-2" key={field.key}><span>{field.label}</span><select value={String(form[field.key] ?? "")} onChange={(event) => setForm((current) => ({ ...current, [field.key]: event.target.value }))}><option value="">Sem cliente vinculado</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
              ) : field.type === "supplier" ? (
                <label className="field span-2" key={field.key}><span>{field.label}</span><select value={String(form[field.key] ?? "")} onChange={(event) => setForm((current) => ({ ...current, [field.key]: event.target.value }))}><option value="">Sem fornecedor vinculado</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
              ) : field.type === "select" ? (
                <label className="field" key={field.key}><span>{field.label}{field.required ? " *" : ""}</span><select required={field.required} value={String(form[field.key] ?? field.options?.[0]?.value ?? "")} onChange={(event) => setForm((current) => ({ ...current, [field.key]: event.target.value }))}>{field.options?.map((option)=><option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
              ) : field.type === "document" || field.type === "zip" || field.type === "plate" ? (
                <label className="field lookup-field" key={field.key}><span>{field.label}{field.required ? " *" : ""}</span><div><input inputMode={field.type==="plate"?"text":"numeric"} required={field.required} value={String(form[field.key] ?? "")} placeholder={field.type==="zip"?"00000-000":field.type==="plate"?"ABC1D23":"Somente números"} maxLength={field.type==="plate"?8:undefined} onChange={(event)=>setForm(current=>({...current,[field.key]:field.type==="plate"?event.target.value.toUpperCase():event.target.value}))}/><button type="button" onClick={()=>void lookup(field.type==="zip"?"cep":field.type==="plate"?"plate":"cnpj")} disabled={lookupLoading!==undefined||(field.type==="zip"?String(form[field.key]??"").replace(/\D/g,"").length!==8:field.type==="plate"?String(form[field.key]??"").replace(/[^A-Za-z0-9]/g,"").length!==7:String(form[field.key]??"").replace(/\D/g,"").length!==14)}>{lookupLoading===(field.type==="zip"?"cep":field.type==="plate"?"plate":"cnpj")?<LoaderCircle className="spin" size={15}/>:<Search size={15}/>} {field.type==="zip"?"Buscar CEP":field.type==="plate"?"Buscar placa":"Buscar CNPJ"}</button></div></label>
              ) : (
                <label className={`field ${field.key === "name" ? "span-2" : ""}`} key={field.key}><span>{field.label}{field.required ? " *" : ""}</span><input type={field.type ?? "text"} min={field.type === "number" ? "0" : undefined} step={field.step} required={field.required} value={String(form[field.key] ?? "")} placeholder={field.placeholder} onChange={(event) => setForm((current) => ({ ...current, [field.key]: event.target.value }))} /></label>
              ))}
            </div>
            {error && <p className="form-error">{error}</p>}
            <footer className="modal-actions"><button type="button" className="secondary-button" onClick={() => setEditing(undefined)}>Cancelar</button><button type="submit" className="primary-button" disabled={saving}>{saving ? <LoaderCircle className="spin" size={18} /> : <Save size={18} />}{saving ? "Salvando..." : "Salvar"}</button></footer>
          </form>
        </section>
      </div>}
      {notice && <button className="toast" onClick={() => setNotice("")}>{notice}</button>}
    </div>
  );
}
