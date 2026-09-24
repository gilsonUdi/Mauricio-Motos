"use client";

import { KeyboardEvent, useId, useMemo, useState } from "react";

export type SuggestionOption = {
  id: string;
  value: string;
  code?: string;
  description: string;
  searchText?: string;
  detail?: string;
};

type Props = {
  value: string;
  options: SuggestionOption[];
  onChange: (value: string) => void;
  onSelect: (option: SuggestionOption) => void;
  placeholder?: string;
  required?: boolean;
  className?: string;
  emptyMessage?: string;
  firstAction?: { label: string; onClick: () => void };
  maxResults?: number;
};

const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").trim();

export function SuggestionInput({ value, options, onChange, onSelect, placeholder, required, className = "", emptyMessage = "Nenhuma opção encontrada.", firstAction, maxResults = 50 }: Props) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const filtered = useMemo(() => {
    const term = normalize(value);
    return options.filter((option) => !term || normalize(`${option.code ?? ""} ${option.description} ${option.value} ${option.searchText ?? ""}`).includes(term)).slice(0, maxResults);
  }, [options, value, maxResults]);

  function select(option: SuggestionOption) {
    onSelect(option);
    setOpen(false);
    setActive(-1);
  }

  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((current) => Math.min(current + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter" && open && active >= 0 && filtered[active]) {
      event.preventDefault();
      select(filtered[active]);
    } else if (event.key === "Escape") {
      setOpen(false);
      setActive(-1);
    }
  }

  return <div className={`suggestion-picker ${className}`.trim()}>
    <input
      value={value}
      onChange={(event) => { onChange(event.target.value); setOpen(true); setActive(-1); }}
      onFocus={() => setOpen(true)}
      onBlur={() => window.setTimeout(() => { setOpen(false); setActive(-1); }, 120)}
      onKeyDown={keyDown}
      placeholder={placeholder}
      required={required}
      autoComplete="off"
      role="combobox"
      aria-autocomplete="list"
      aria-expanded={open}
      aria-controls={listId}
    />
    {open && <div className="suggestion-results" role="listbox" id={listId}>
      {firstAction && <button type="button" className="suggestion-new" onMouseDown={(event) => event.preventDefault()} onClick={(event) => { event.preventDefault(); event.stopPropagation(); setOpen(false); firstAction.onClick(); }}>{firstAction.label}</button>}
      {filtered.map((option, index) => <button
        type="button"
        role="option"
        aria-selected={index === active}
        className={index === active ? "active" : ""}
        key={option.id}
        onMouseDown={(event) => event.preventDefault()}
        onMouseEnter={() => setActive(index)}
        onClick={() => select(option)}
      >
        {option.code && <><b>{option.code}</b><span aria-hidden="true">—</span></>}
        <span>{option.description}</span>
        {option.detail && <small>{option.detail}</small>}
      </button>)}
      {!filtered.length && <p>{emptyMessage}</p>}
    </div>}
  </div>;
}
