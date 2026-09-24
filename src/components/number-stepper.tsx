"use client";

type Props = {
  value: string | number;
  onChange: (value: string) => void;
  min?: number;
  max?: number;
  step?: number;
  label: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
};

export function NumberStepper({ value, onChange, min = 0, max, step = 1, label, required, disabled, placeholder }: Props) {
  const precision = (String(step).split(".")[1] ?? "").length;
  function adjust(direction: number) {
    const current = Number(String(value).replace(",", "."));
    const next = Number.isFinite(current) ? current + direction * step : min;
    onChange(String(Math.min(max ?? Infinity, Math.max(min, Number(next.toFixed(precision))))));
  }
  return <div className="number-stepper">
    <button type="button" onClick={() => adjust(-1)} disabled={disabled || Number(value) <= min} aria-label={`Diminuir ${label}`}>−</button>
    <input type="number" inputMode="decimal" min={min} max={max} step={step} value={value} onChange={(event) => onChange(event.target.value)} aria-label={label} required={required} disabled={disabled} placeholder={placeholder} />
    <button type="button" onClick={() => adjust(1)} disabled={disabled || (max !== undefined && Number(value) >= max)} aria-label={`Aumentar ${label}`}>+</button>
  </div>;
}
