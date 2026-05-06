/**
 * Parse a sheet tab name like "Custos Maio 2026" into payday-month coordinates.
 * Tolerates extra whitespace, case variation, and missing "Custos" prefix.
 */

const PT_MONTHS: Record<string, number> = {
  janeiro: 1,
  fevereiro: 2,
  marco: 3,
  abril: 4,
  maio: 5,
  junho: 6,
  julho: 7,
  agosto: 8,
  setembro: 9,
  outubro: 10,
  novembro: 11,
  dezembro: 12,
};

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

export function parseTabName(
  name: string,
): { year: number; month: number } | null {
  const tokens = normalize(name)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  let month: number | null = null;
  let year: number | null = null;

  for (const tok of tokens) {
    if (month === null && tok in PT_MONTHS) month = PT_MONTHS[tok];
    if (year === null && /^\d{4}$/.test(tok)) {
      const y = Number.parseInt(tok, 10);
      if (y >= 2020 && y <= 2100) year = y;
    }
  }

  if (month === null || year === null) return null;
  return { year, month };
}
