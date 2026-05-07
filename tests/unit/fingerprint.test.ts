import { describe, expect, it } from "vitest";
import { fingerprintCounterparty } from "@/lib/matching/fingerprint.ts";

describe("fingerprintCounterparty", () => {
  it("collapses the same merchant across Dutch cities", () => {
    const a = fingerprintCounterparty("AH AMSTERDAM NLD");
    const b = fingerprintCounterparty("AH UTRECHT NLD");
    const c = fingerprintCounterparty("AH ROTTERDAM NLD");
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(a).toBe("ah");
  });

  it("strips trailing terminal IDs", () => {
    expect(fingerprintCounterparty("Foobar Term: ABC123")).toBe("foobar");
    expect(fingerprintCounterparty("Foobar Terminal 4242")).toBe("foobar");
    expect(fingerprintCounterparty("Foobar BTR: 9001")).toBe("foobar");
    expect(fingerprintCounterparty("Foobar Volgnr: 12")).toBe("foobar");
    expect(fingerprintCounterparty("Foobar Pas 003")).toBe("foobar");
  });

  it("strips trailing digit runs", () => {
    expect(fingerprintCounterparty("Foobar 1234")).toBe("foobar");
    expect(fingerprintCounterparty("Albert Heijn 9876")).toBe("albert heijn");
  });

  it("strips bank-side prefixes that don't identify the merchant", () => {
    expect(fingerprintCounterparty("AAB INZ TIKKIE")).toBe("tikkie");
    expect(fingerprintCounterparty("INZ Vattenfall")).toBe("vattenfall");
  });

  it("escapes regex metacharacters so the result is safe to use in ~*", () => {
    const fp = fingerprintCounterparty("Bol.com Amsterdam");
    expect(fp).toBe("bol\\.com");
  });

  it("falls back to the raw lowercased input when stripping leaves nothing", () => {
    // Pure city name: stripping leaves an empty string.
    const fp = fingerprintCounterparty("Amsterdam");
    expect(fp).toBe("amsterdam");
  });

  it("collapses whitespace runs", () => {
    expect(fingerprintCounterparty("  Foo   Bar   ")).toBe("foo bar");
  });

  it("strips compound city tails like 'alphen aan den rijn'", () => {
    expect(fingerprintCounterparty("My Shop alphen aan den rijn")).toBe(
      "my shop",
    );
  });
});
