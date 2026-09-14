"use client";

import type { InputHTMLAttributes } from "react";
import { formatMoneyInput } from "@/lib/numbers";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> & {
  value: string;
  onValueChange: (value: string) => void;
  allowNegative?: boolean;
};

export function MoneyInput({ value, onValueChange, allowNegative = false, ...props }: Props) {
  return (
    <input
      {...props}
      type="text"
      inputMode="numeric"
      value={value}
      onChange={(event) => onValueChange(formatMoneyInput(event.target.value, allowNegative))}
    />
  );
}
