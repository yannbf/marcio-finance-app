import type { Section } from "./types.ts";

/** Stable display order for the Mês screen, joint and personal alike. */
export const SECTION_ORDER: Section[] = [
  "ENTRADAS",
  "FIXAS",
  "VARIAVEIS",
  "SAZONAIS",
  "DIVIDAS",
  "ECONOMIAS",
];

/** Map a section to its translation key under the "Sections" namespace. */
export const SECTION_TR_KEY: Record<Section, string> = {
  ENTRADAS: "entradas",
  FIXAS: "fixas",
  VARIAVEIS: "variaveis",
  SAZONAIS: "sazonais",
  DIVIDAS: "dividas",
  ECONOMIAS: "economias",
};

/** Sections that count as outflow on the headline "spent" line. */
export const OUTFLOW_SECTIONS: Section[] = [
  "FIXAS",
  "VARIAVEIS",
  "SAZONAIS",
  "DIVIDAS",
];
