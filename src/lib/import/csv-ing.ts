import { createHash } from "node:crypto";

/**
 * ING NL CSV parser.
 *
 * The Dutch/EN export commonly uses semicolons with double-quoted fields and
 * Windows-1252 line endings. We auto-detect the delimiter and tolerate either
 * the legacy headers ("Naam / Omschrijving", "Mededelingen", "Bedrag (EUR)")
 * or the newer English ones ("Description", "Amount (EUR)").
 *
 * Output rows are agnostic of the original column order — downstream code
 * keys off named fields.
 */

export type IngTx = {
  bookingDate: Date;
  amountCents: number;
  counterparty: string;
  description: string;
  iban: string;
  counterpartyIban: string;
  /** Hash used to make re-uploads of overlapping ranges idempotent. */
  dedupeKey: string;
  /** "Af" debit or "Bij" credit — preserved as a raw signal. */
  direction: "debit" | "credit";
  raw: Record<string, string>;
};

export type IngParseResult = {
  rows: IngTx[];
  /** IBAN of the account these rows belong to. */
  accountIban: string;
  warnings: string[];
};

const HEADER_ALIASES: Record<string, string[]> = {
  date: ["datum", "date"],
  counterparty: ["naam / omschrijving", "name / description", "naam"],
  iban: ["rekening", "account"],
  counterpartyIban: ["tegenrekening", "counterparty"],
  code: ["code"],
  afBij: ["af bij", "af/bij", "debit/credit"],
  amount: ["bedrag (eur)", "amount (eur)", "bedrag", "amount"],
  description: ["mededelingen", "description", "notifications"],
  mutationType: ["mutatiesoort", "transaction type", "type"],
};

export function parseIngCsv(buf: Uint8Array): IngParseResult {
  const text = decode(buf);
  const lines = splitLines(text);
  if (lines.length < 2) {
    return { rows: [], accountIban: "", warnings: ["Empty CSV."] };
  }

  const delimiter = detectDelimiter(lines[0]);
  const header = parseLine(lines[0], delimiter).map((h) =>
    h.trim().toLowerCase(),
  );
  const idx = mapHeaderIndices(header);

  if (idx.date === -1 || idx.amount === -1) {
    return {
      rows: [],
      accountIban: "",
      warnings: [
        `CSV doesn't look like an ING export. Got headers: ${header.join(", ")}`,
      ],
    };
  }

  const rows: IngTx[] = [];
  const warnings: string[] = [];
  let firstIban = "";

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cells = parseLine(line, delimiter).map((c) => c.trim());
    if (cells.length < header.length) {
      warnings.push(`Skipped malformed row ${i + 1}.`);
      continue;
    }

    const date = parseIngDate(get(cells, idx.date));
    if (!date) {
      warnings.push(`Row ${i + 1}: unparsable date "${get(cells, idx.date)}".`);
      continue;
    }

    const direction = parseDirection(get(cells, idx.afBij));
    const amount = parseAmount(get(cells, idx.amount));
    if (amount === null) {
      warnings.push(`Row ${i + 1}: unparsable amount.`);
      continue;
    }
    const signed = direction === "debit" ? -amount : amount;
    const cents = Math.round(signed * 100);

    const iban = normalizeIban(get(cells, idx.iban));
    if (!firstIban && iban) firstIban = iban;

    const counterparty = get(cells, idx.counterparty);
    const description = get(cells, idx.description);
    const counterpartyIban = normalizeIban(get(cells, idx.counterpartyIban));

    const raw: Record<string, string> = {};
    header.forEach((h, j) => (raw[h] = cells[j] ?? ""));

    const dedupe = createHash("sha1")
      .update(
        [
          iban,
          formatYmd(date),
          String(cents),
          normalizeForHash(counterparty),
          normalizeForHash(description),
        ].join("|"),
      )
      .digest("hex");

    rows.push({
      bookingDate: date,
      amountCents: cents,
      counterparty,
      description,
      iban,
      counterpartyIban,
      direction,
      dedupeKey: dedupe,
      raw,
    });
  }

  return { rows, accountIban: firstIban, warnings };
}

/* -------------------------------------------------------------------------- */

function decode(buf: Uint8Array): string {
  // ING files are usually UTF-8 with BOM; fall back to Latin-1-ish decoding for legacy exports.
  try {
    const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(buf);
    if (!utf8.includes("�")) return stripBom(utf8);
  } catch {
    // ignore
  }
  return stripBom(new TextDecoder("windows-1252").decode(buf));
}

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function splitLines(s: string): string[] {
  return s.replace(/\r\n?/g, "\n").split("\n");
}

function detectDelimiter(headerLine: string): "," | ";" | "\t" {
  const counts = {
    ",": (headerLine.match(/,/g) || []).length,
    ";": (headerLine.match(/;/g) || []).length,
    "\t": (headerLine.match(/\t/g) || []).length,
  };
  return Object.entries(counts).sort(
    (a, b) => b[1] - a[1],
  )[0][0] as "," | ";" | "\t";
}

function parseLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function mapHeaderIndices(headers: string[]): {
  date: number;
  counterparty: number;
  iban: number;
  counterpartyIban: number;
  code: number;
  afBij: number;
  amount: number;
  description: number;
  mutationType: number;
} {
  const find = (key: keyof typeof HEADER_ALIASES) => {
    const aliases = HEADER_ALIASES[key];
    for (let i = 0; i < headers.length; i++) {
      if (aliases.includes(headers[i])) return i;
    }
    return -1;
  };
  return {
    date: find("date"),
    counterparty: find("counterparty"),
    iban: find("iban"),
    counterpartyIban: find("counterpartyIban"),
    code: find("code"),
    afBij: find("afBij"),
    amount: find("amount"),
    description: find("description"),
    mutationType: find("mutationType"),
  };
}

function get(cells: string[], i: number): string {
  if (i < 0 || i >= cells.length) return "";
  return cells[i];
}

function parseIngDate(s: string): Date | null {
  const t = s.trim();
  if (/^\d{8}$/.test(t)) {
    const y = Number.parseInt(t.slice(0, 4), 10);
    const m = Number.parseInt(t.slice(4, 6), 10);
    const d = Number.parseInt(t.slice(6, 8), 10);
    return safeDate(y, m, d);
  }
  // DD-MM-YYYY or DD/MM/YYYY (older exports)
  const m = t.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
  if (m) {
    return safeDate(
      Number.parseInt(m[3], 10),
      Number.parseInt(m[2], 10),
      Number.parseInt(m[1], 10),
    );
  }
  // ISO
  const iso = new Date(t);
  return Number.isNaN(iso.getTime()) ? null : iso;
}

function safeDate(y: number, m: number, d: number): Date | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function parseAmount(s: string): number | null {
  const t = s.replace(/[€\s]/g, "").replace(/\./g, "").replace(",", ".");
  if (!t) return null;
  const n = Number.parseFloat(t);
  return Number.isFinite(n) ? Math.abs(n) : null;
}

function parseDirection(s: string): "debit" | "credit" {
  const t = s.trim().toLowerCase();
  if (t === "bij" || t === "credit" || t === "c") return "credit";
  return "debit";
}

function normalizeIban(s: string): string {
  return s.replace(/\s+/g, "").toUpperCase();
}

function normalizeForHash(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function formatYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
