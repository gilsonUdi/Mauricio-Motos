"use client";

import { BarChart3, ChevronDown, CircleDollarSign, LoaderCircle, Menu, Settings2, TrendingDown, TrendingUp } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";

type Group = { id:string;name:string;amount:number;categories:Array<{id:string;name:string;amount:number}> };
type DrgData = { period:{from:string;to:string};salesCount:number;summary:{grossRevenue:number;discounts:number;taxes:number;netRevenue:number;cogs:number;grossProfit:number;operatingExpenses:number;otherOperatingIncome:number;operatingResult:number;nonOperatingIncome:number;nonOperatingExpenses:number;netResult:number;grossMargin:number;netMargin:number};details:{taxes:Group[];operatingExpenses:Group[];operatingIncome:Group[];nonOperatingIncome:Group[];nonOperatingExpenses:Group[]} };

const money = new Intl.NumberFormat("pt-BR", { style:"currency",currency:"BRL" });
const iso = (date:Date) => date.toLocaleDateString("en-CA");
const initialRange = () => { const now=new Date();return { from:iso(new Date(now.getFullYear(),now.getMonth(),1)),to:iso(new Date(now.getFullYear(),now.getMonth()+1,0)) }; };

function StatementLine({ label,value,kind="normal",percentage }: { label:string;value:number;kind?:"normal"|"negative"|"subtotal"|"result";percentage?:number }) {
  return <div className={`drg-line ${kind}`}><span>{kind==="negative"&&"(−) "}{label}</span><strong>{money.format(value)}{percentage!==undefined&&<small>{percentage.toLocaleString("pt-BR",{maximumFractionDigits:1})}%</small>}</strong></div>;
}

function GroupDetails({ groups,negative=true }: { groups:Group[];negative?:boolean }) {
  if(!groups.length)return null;
  return <div className="drg-groups">{groups.map(group=><details key={group.id}><summary><span><ChevronDown size={15}/>{group.name}</span><strong>{negative?"− ":"+ "}{money.format(group.amount)}</strong></summary><div>{group.categories.map(category=><p key={category.id}><span>{category.name}</span><b>{money.format(category.amount)}</b></p>)}</div></details>)}</div>;
}

export function DrgPage(){
  const defaults=initialRange();const [from,setFrom]=useState(defaults.from);const [to,setTo]=useState(defaults.to);const [data,setData]=useState<DrgData>();const [loading,setLoading]=useState(false);const [error,setError]=useState("");const [mobileMenu,setMobileMenu]=useState(false);
  async function generate(){setLoading(true);setError("");try{const response=await fetch(`/api/drg?from=${from}&to=${to}`);const payload=await response.json();if(!response.ok)throw new Error(payload.error??"Não foi possível gerar o DRG.");setData(payload);}catch(caught){setData(undefined);setError(caught instanceof Error?caught.message:"Não foi possível gerar o DRG.");}finally{setLoading(false);}}
  const summary=data?.summary;
  return <div className="app-shell"><AppSidebar active="drg"/><main className="workspace registry-workspace"><header className="topbar registry-topbar"><button className="mobile-menu" onClick={()=>setMobileMenu(!mobileMenu)} aria-label="Abrir menu"><Menu/></button><div><p className="eyebrow">FINANCEIRO</p><h1>DRG — Demonstrativo de Resultado Gerencial</h1><p className="page-description">Resultado econômico por competência, separado dos movimentos de caixa.</p></div><Link className="secondary-button" href="/categorias-financeiras"><Settings2 size={17}/>Configurar categorias</Link></header>
    {mobileMenu&&<div className="mobile-shortcuts registry-shortcuts"><Link href="/receber">Receber</Link><Link href="/pagar">Pagar</Link><Link href="/financeiro">Financeiro</Link><Link href="/drg">DRG</Link></div>}
    <section className="period-toolbar drg-toolbar"><label><span>De</span><input type="date" value={from} onChange={event=>setFrom(event.target.value)}/></label><label><span>Até</span><input type="date" value={to} onChange={event=>setTo(event.target.value)}/></label><button className="primary-button" onClick={()=>void generate()} disabled={loading}>{loading?<LoaderCircle className="spin" size={18}/>:<BarChart3 size={18}/>}Gerar DRG</button><p>Somente categorias marcadas para inclusão entram no demonstrativo.</p></section>
    {error&&<p className="form-error drg-error">{error}</p>}
    {!data&&!loading&&!error&&<section className="registry-panel drg-empty"><BarChart3/><h2>Escolha o período e gere o demonstrativo</h2><p>Os dados financeiros só serão exibidos depois que você clicar em “Gerar DRG”.</p></section>}
    {loading&&<section className="registry-panel registry-loading"><LoaderCircle className="spin"/>Consolidando vendas, custos e despesas...</section>}
    {summary&&!loading&&<><section className="operations-stats finance-stats drg-stats"><div><CircleDollarSign/><span>Receita líquida</span><strong>{money.format(summary.netRevenue)}</strong></div><div><TrendingUp/><span>Lucro bruto</span><strong>{money.format(summary.grossProfit)}</strong></div><div className={summary.operatingResult<0?"negative-card":"positive-card"}><BarChart3/><span>Resultado operacional</span><strong>{money.format(summary.operatingResult)}</strong></div><div className={summary.netResult<0?"negative-card":"positive-card"}>{summary.netResult<0?<TrendingDown/>:<TrendingUp/>}<span>Resultado líquido</span><strong>{money.format(summary.netResult)}</strong></div></section>
      <section className="registry-panel drg-statement"><header><div><span className="section-kicker">DEMONSTRAÇÃO DETALHADA</span><h2>Resultado do período</h2></div><span>{data.salesCount} venda(s)</span></header><StatementLine label="RECEITA OPERACIONAL BRUTA" value={summary.grossRevenue} kind="subtotal"/><StatementLine label="Descontos concedidos" value={summary.discounts} kind="negative"/><StatementLine label="Impostos e deduções" value={summary.taxes} kind="negative"/><GroupDetails groups={data.details.taxes}/><StatementLine label="RECEITA OPERACIONAL LÍQUIDA" value={summary.netRevenue} kind="subtotal"/><StatementLine label="CMV — Custo das mercadorias vendidas" value={summary.cogs} kind="negative"/><StatementLine label="LUCRO BRUTO" value={summary.grossProfit} kind="subtotal" percentage={summary.grossMargin}/><StatementLine label="Despesas operacionais" value={summary.operatingExpenses} kind="negative"/><GroupDetails groups={data.details.operatingExpenses}/>{summary.otherOperatingIncome>0&&<><StatementLine label="Outras receitas operacionais" value={summary.otherOperatingIncome}/><GroupDetails groups={data.details.operatingIncome} negative={false}/></>}<StatementLine label="RESULTADO OPERACIONAL" value={summary.operatingResult} kind="subtotal"/>{summary.nonOperatingIncome>0&&<><StatementLine label="Receitas não operacionais" value={summary.nonOperatingIncome}/><GroupDetails groups={data.details.nonOperatingIncome} negative={false}/></>}{summary.nonOperatingExpenses>0&&<><StatementLine label="Despesas não operacionais" value={summary.nonOperatingExpenses} kind="negative"/><GroupDetails groups={data.details.nonOperatingExpenses}/></>}<StatementLine label="RESULTADO LÍQUIDO" value={summary.netResult} kind="result" percentage={summary.netMargin}/></section>
    </>}
  </main></div>;
}
