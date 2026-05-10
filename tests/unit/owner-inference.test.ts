import { describe, expect, it } from "vitest";
import { inferAccountOwner } from "@/lib/enable_banking/owner-inference.ts";

describe("inferAccountOwner", () => {
  it("flips to joint when the holder line carries a comma (multi-holder)", () => {
    expect(
      inferAccountOwner({
        fallback: "yann",
        name: "Y Bezerra Braga Ferreira,C Ferrer Bezerra Loureiro",
      }),
    ).toBe("joint");
  });

  it("flips to joint on ampersand", () => {
    expect(
      inferAccountOwner({
        fallback: "yann",
        name: "Yann & Camila",
      }),
    ).toBe("joint");
  });

  it("flips to joint on slash separator", () => {
    expect(
      inferAccountOwner({
        fallback: "yann",
        name: "Yann / Camila",
      }),
    ).toBe("joint");
  });

  it("flips to joint when the product literally says joint or gezamenlijk", () => {
    expect(
      inferAccountOwner({
        fallback: "yann",
        name: "Some single name",
        product: "Joint Checking Account",
      }),
    ).toBe("joint");
    expect(
      inferAccountOwner({
        fallback: "camila",
        name: "Single",
        product: "Gezamenlijke rekening",
      }),
    ).toBe("joint");
  });

  it("keeps the connecting user's role for clearly-personal accounts", () => {
    expect(
      inferAccountOwner({
        fallback: "yann",
        name: "Y Bezerra Braga Ferreira",
        product: "Oranje betalen",
      }),
    ).toBe("yann");
    expect(
      inferAccountOwner({
        fallback: "camila",
        name: "Camila Ferrer",
      }),
    ).toBe("camila");
  });

  it("doesn't false-positive on non-name commas in product / type", () => {
    // `,` only checked in `name`, not product/type — this stays personal.
    expect(
      inferAccountOwner({
        fallback: "yann",
        name: "Yann Bezerra",
        product: "Oranje, type checking",
      }),
    ).toBe("yann");
  });

  it("returns fallback when name is missing entirely", () => {
    expect(inferAccountOwner({ fallback: "yann" })).toBe("yann");
    expect(inferAccountOwner({ fallback: "camila", name: "" })).toBe("camila");
  });
});
