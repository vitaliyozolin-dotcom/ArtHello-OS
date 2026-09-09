const rubleFormatter = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0,
});

const rubleNumberFormatter = new Intl.NumberFormat("ru-RU", {
  maximumFractionDigits: 0,
});

export function formatRubles(value: number): string {
  return rubleFormatter.format(value);
}

export function formatRubleNumber(value: number): string {
  return rubleNumberFormatter.format(value);
}
