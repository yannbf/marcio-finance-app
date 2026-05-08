import { describe, expect, it } from "vitest";
import {
  detectSavingsBucketRef,
  isInternalTransferTx,
  isSavingsTransferTx,
} from "@/lib/matching/seed-rules.ts";
import {
  cleanSavingsDescription,
  extractSavingsPurpose,
} from "@/lib/savings-detection.ts";

describe("detectSavingsBucketRef", () => {
  it("extracts a Dutch ING-style ref from a spaarrekening transfer", () => {
    expect(detectSavingsBucketRef("Oranje spaarrekening V12602730 Taxes")).toBe(
      "V12602730",
    );
    expect(detectSavingsBucketRef("spaarrekening N14631597")).toBe("N14631597");
    expect(detectSavingsBucketRef("Spaarrekening A98765432 trip")).toBe(
      "A98765432",
    );
  });

  it("is case-insensitive on the keyword", () => {
    expect(detectSavingsBucketRef("SPAARREKENING V11111111")).toBe("V11111111");
  });

  it("returns null when the description does not mention spaarrekening", () => {
    expect(detectSavingsBucketRef("Albert Heijn AMSTERDAM NLD")).toBeNull();
    expect(detectSavingsBucketRef("Random text V12345678")).toBeNull();
  });
});

describe("isSavingsTransferTx", () => {
  it("flags transactions whose description mentions spaarrekening", () => {
    expect(
      isSavingsTransferTx({
        counterparty: "ING Spaarrekening",
        description: "Transfer to Spaarrekening V12602730",
      }),
    ).toBe(true);
  });

  it("flags transactions whose description mentions savings account", () => {
    expect(
      isSavingsTransferTx({
        counterparty: "Self",
        description: "Move to savings account",
      }),
    ).toBe(true);
  });

  it("does not flag a Tikkie or grocery row", () => {
    expect(
      isSavingsTransferTx({
        counterparty: "AAB INZ TIKKIE",
        description: "Tikkie ID 100001 drinks",
      }),
    ).toBe(false);
    expect(
      isSavingsTransferTx({
        counterparty: "Albert Heijn 1234",
        description: "Albert Heijn AMSTERDAM NLD groceries",
      }),
    ).toBe(false);
  });

  it("is independent from isInternalTransferTx (different concerns)", () => {
    const row = {
      counterparty: "Y Bezerra Braga Ferreira",
      description: "Contribuicao maio",
    };
    expect(isInternalTransferTx(row)).toBe(true);
    expect(isSavingsTransferTx(row)).toBe(false);
  });
});

describe("extractSavingsPurpose", () => {
  it("pulls the user-typed label between the ref and 'Value date:'", () => {
    expect(
      extractSavingsPurpose(
        "To Oranje spaarrekening V12602730 Afronding Value date: 05/05/2026",
        "V12602730",
      ),
    ).toBe("Afronding");
    expect(
      extractSavingsPurpose(
        "From Oranje spaarrekening V12602730 Impostos Value date: 28/04/2026",
        "V12602730",
      ),
    ).toBe("Impostos");
    expect(
      extractSavingsPurpose(
        "To Oranje spaarrekening N14631597 Maio Value date: 28/04/2026",
        "N14631597",
      ),
    ).toBe("Maio");
  });

  it("returns null when the description doesn't follow the canonical shape", () => {
    expect(extractSavingsPurpose("random text", "V12602730")).toBeNull();
    expect(extractSavingsPurpose(null, "V12602730")).toBeNull();
  });

  it("rejects oversized purposes (likely garbage parses)", () => {
    const long = "x".repeat(60);
    expect(
      extractSavingsPurpose(
        `Oranje spaarrekening V12602730 ${long} Value date: 1/1/2026`,
        "V12602730",
      ),
    ).toBeNull();
  });
});

describe("cleanSavingsDescription", () => {
  it("strips the trailing 'Value date: ...' suffix", () => {
    expect(
      cleanSavingsDescription(
        "To Oranje spaarrekening V12602730 Afronding Value date: 05/05/2026",
      ),
    ).toBe("To Oranje spaarrekening V12602730 Afronding");
  });

  it("returns the input unchanged when there's nothing to strip", () => {
    expect(cleanSavingsDescription("Plain description")).toBe(
      "Plain description",
    );
    expect(cleanSavingsDescription(null)).toBe("");
  });
});
