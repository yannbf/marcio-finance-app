/**
 * Slugify a Portuguese item name into a stable natural key.
 * Strips diacritics, lowercases, replaces non-alnum runs with `-`.
 *
 * "Plano saúde Yann" -> "plano-saude-yann"
 * "Internet KPN 1000mb" -> "internet-kpn-1000mb"
 * "Imposto da água (estimado)" -> "imposto-da-agua-estimado"
 */
export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
