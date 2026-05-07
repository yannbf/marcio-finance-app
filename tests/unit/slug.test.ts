import { describe, expect, it } from "vitest";
import { slugify } from "@/lib/import/slug.ts";

describe("slugify", () => {
  it("strips diacritics from Portuguese names", () => {
    expect(slugify("Plano saúde Yann")).toBe("plano-saude-yann");
    expect(slugify("Eletricidade + Aquecimento")).toBe(
      "eletricidade-aquecimento",
    );
    expect(slugify("Imposto da água (estimado)")).toBe("imposto-da-agua-estimado");
  });

  it("collapses non-alphanumeric runs into a single dash", () => {
    expect(slugify("foo  bar---baz")).toBe("foo-bar-baz");
  });

  it("trims leading/trailing dashes", () => {
    expect(slugify("---hello---")).toBe("hello");
  });

  it("preserves digit suffixes", () => {
    expect(slugify("Internet KPN 1000mb")).toBe("internet-kpn-1000mb");
  });

  it("returns an empty string for input without alphanumerics", () => {
    expect(slugify("---")).toBe("");
    expect(slugify("")).toBe("");
  });
});
