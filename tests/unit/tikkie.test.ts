import { describe, expect, it } from "vitest";
import {
  isTikkie,
  parseTikkiePerson,
  parseTikkieTopic,
} from "@/lib/tikkie.ts";

describe("isTikkie", () => {
  it("matches the 'X via Tikkie' counterparty shape", () => {
    expect(isTikkie({ counterparty: "Alpha via Tikkie", description: "" })).toBe(
      true,
    );
  });
  it("matches the 'AAB INZ TIKKIE' counterparty shape", () => {
    expect(
      isTikkie({ counterparty: "AAB INZ TIKKIE", description: "Tikkie ID 123" }),
    ).toBe(true);
  });
  it("ignores merchant rows", () => {
    expect(
      isTikkie({ counterparty: "Albert Heijn", description: "groceries" }),
    ).toBe(false);
  });
  it("tolerates null fields", () => {
    expect(isTikkie({ counterparty: null, description: null })).toBe(false);
  });
});

describe("parseTikkiePerson", () => {
  it("extracts the name from 'X via Tikkie'", () => {
    expect(parseTikkiePerson("Alice Example via Tikkie", "")).toBe(
      "Alice Example",
    );
  });

  it("strips honorifics", () => {
    expect(parseTikkiePerson("Hr Doe via Tikkie", "")).toBe("Doe");
    expect(parseTikkiePerson("Mevr Smit via Tikkie", "")).toBe("Smit");
  });

  it("falls back to the description's 'Van X,' shape", () => {
    expect(
      parseTikkiePerson(
        "AAB INZ TIKKIE",
        "Tikkie ID 123, Drinks, Van Alice, NL00ABNA",
      ),
    ).toBe("Alice");
  });

  it("falls back to the description's 'From X,' shape", () => {
    expect(
      parseTikkiePerson(
        "AAB INZ TIKKIE",
        "Tikkie ID 123, Drinks, From Bob, NL00ABNA",
      ),
    ).toBe("Bob");
  });

  it("returns an em-dash when nothing matches", () => {
    expect(parseTikkiePerson("Random merchant", "no name here")).toBe("—");
  });

  it("tolerates null inputs", () => {
    expect(parseTikkiePerson(null, null)).toBe("—");
  });
});

describe("parseTikkieTopic", () => {
  it("returns the user-typed topic between Tikkie ID and the sender", () => {
    expect(
      parseTikkieTopic(
        "Tikkie ID 001186043116, Movies, Van Alice, NL00ABNA",
      ),
    ).toBe("Movies");
  });

  it("returns null for descriptions without a topic", () => {
    expect(parseTikkieTopic("Tikkie ID 123, Van Alice, NL00ABNA")).toBeNull();
    expect(parseTikkieTopic("totally unrelated description")).toBeNull();
  });

  it("rejects implausibly long topics (probably parsed past a comma)", () => {
    const long = "x".repeat(80);
    expect(
      parseTikkieTopic(`Tikkie ID 1, ${long}, Van Alice, NL00ABNA`),
    ).toBeNull();
  });

  it("tolerates null", () => {
    expect(parseTikkieTopic(null)).toBeNull();
  });
});
