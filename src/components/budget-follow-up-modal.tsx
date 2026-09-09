"use client";

import { CalendarClock, LoaderCircle, MessageCircleMore, Save, X } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import type { WorkOrder } from "@/lib/types";

type FollowUp = { id:string;contactedAt:string;channel:string;outcome:string;notes?:string;nextFollowUpAt?:string;actorName:string };
type Summary = { lastFollowUpAt:string;nextFollowUpAt?:string;followUpCount:number };
const outcomeLabels:Record<string,string> = { AGUARDANDO:"Aguardando retorno",PEDIU_ALTERACAO:"Solicitou alteração",APROVOU:"Informou aprovação",RECUSOU:"Não aprovou",SEM_RETORNO:"Sem retorno" };
const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle:"short",timeStyle:"short" });

export function BudgetFollowUpModal({ order,onClose,onSaved }:{ order:WorkOrder;onClose:()=>void;onSaved:(summary:Summary)=>void }) {
  const [history,setHistory]=useState<FollowUp[]>([]);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [channel,setChannel]=useState("WhatsApp");
  const [outcome,setOutcome]=useState("AGUARDANDO");
  const [notes,setNotes]=useState("");
  const [nextFollowUpAt,setNextFollowUpAt]=useState("");
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");

  useEffect(()=>{ const controller=new AbortController();fetch(`/api/orders/${order.id}/follow-ups`,{signal:controller.signal}).then(async(response)=>{const payload=await response.json();if(!response.ok)throw new Error(payload.error??"Não foi possível carregar o histórico.");setHistory(payload.history??[]);}).catch(caught=>{if(caught instanceof Error&&caught.name!=="AbortError")setError(caught.message);}).finally(()=>setLoading(false));return()=>controller.abort();},[order.id]);

  async function submit(event:FormEvent){event.preventDefault();setSaving(true);setError("");setNotice("");try{const response=await fetch(`/api/orders/${order.id}/follow-ups`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({channel,outcome,notes,nextFollowUpAt:nextFollowUpAt?new Date(nextFollowUpAt).toISOString():undefined})});const payload=await response.json();if(!response.ok)throw new Error(payload.error??"Não foi possível registrar o retorno.");setHistory(current=>[payload.event,...current]);onSaved({lastFollowUpAt:payload.lastFollowUpAt,nextFollowUpAt:payload.nextFollowUpAt,followUpCount:Number(payload.followUpCount)});setNotes("");setNextFollowUpAt("");setNotice("Contato registrado no histórico.");}catch(caught){setError(caught instanceof Error?caught.message:"Não foi possível registrar o retorno.");}finally{setSaving(false);}}

  return <div className="modal-backdrop"><section className="registry-modal follow-up-modal"><header className="modal-header"><div><span className="section-kicker">ACOMPANHAMENTO COMERCIAL</span><h2>Retornos do orçamento #{order.number}</h2></div><button className="icon-button" onClick={onClose} aria-label="Fechar"><X /></button></header><form className="registry-form" onSubmit={submit}><div className="form-grid registry-form-grid"><label className="field"><span>Canal do contato *</span><select value={channel} onChange={event=>setChannel(event.target.value)}><option>WhatsApp</option><option>Telefone</option><option>Presencial</option><option>E-mail</option><option>Outro</option></select></label><label className="field"><span>Resultado *</span><select value={outcome} onChange={event=>setOutcome(event.target.value)}>{Object.entries(outcomeLabels).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label><label className="field span-2"><span>Observações</span><textarea rows={3} maxLength={2000} value={notes} onChange={event=>setNotes(event.target.value)} placeholder="Registre o que foi conversado com o cliente" /></label><label className="field span-2"><span>Próximo retorno</span><input type="datetime-local" value={nextFollowUpAt} onChange={event=>setNextFollowUpAt(event.target.value)} /></label></div>{error&&<p className="form-error">{error}</p>}{notice&&<p className="form-success">{notice}</p>}<footer className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Fechar</button><button className="primary-button" disabled={saving}>{saving?<LoaderCircle className="spin" size={18}/>:<Save size={18}/>}Registrar contato</button></footer></form><section className="follow-up-history"><h3><MessageCircleMore size={18}/> Histórico de contatos</h3>{loading?<div className="registry-loading"><LoaderCircle className="spin"/>Carregando...</div>:history.length?history.map(item=><article key={item.id}><header><strong>{outcomeLabels[item.outcome]??item.outcome}</strong><time>{dateTime.format(new Date(item.contactedAt))}</time></header><p>{item.channel} · {item.actorName}</p>{item.notes&&<blockquote>{item.notes}</blockquote>}{item.nextFollowUpAt&&<small><CalendarClock size={14}/> Próximo retorno: {dateTime.format(new Date(item.nextFollowUpAt))}</small>}</article>):<div className="empty-state">Nenhum contato registrado.</div>}</section></section></div>;
}
