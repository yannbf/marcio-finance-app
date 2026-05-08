import { describe, expect, it } from "vitest";
import {
  CATEGORY_DISPLAY_ORDER,
  CATEGORY_KEYS,
  categorizeTx,
  type Category,
} from "@/lib/categorization.ts";

function tag(
  counterparty: string,
  description: string | null = null,
): Category {
  return categorizeTx({ counterparty, description });
}

describe("categorizeTx", () => {
  it("recognises Dutch supermarkets and drugstores as groceries", () => {
    expect(tag("Albert Heijn 9876")).toBe("groceries");
    expect(tag("AH AMSTERDAM NLD")).toBe("groceries");
    expect(tag("Jumbo Supermarkten")).toBe("groceries");
    expect(tag("LIDL DEN HAAG")).toBe("groceries");
    expect(tag("Kruidvat Centrum")).toBe("groceries");
    expect(tag("Etos Hoofddorp")).toBe("groceries");
  });

  it("flags eating-out venues as restaurants", () => {
    expect(tag("CCV*UMMAH daoudi super", "Lunch")).toBe("restaurants");
    expect(tag("Thuisbezorgd.nl")).toBe("restaurants");
    expect(tag("Domino's Pizza")).toBe("restaurants");
    expect(tag("Starbucks Schiphol")).toBe("restaurants");
    expect(tag("La Trattoria")).toBe("restaurants");
    expect(tag("New York Pizza")).toBe("restaurants");
  });

  it("classifies transport providers", () => {
    expect(tag("OVPAY")).toBe("transport");
    expect(tag("NS GROEP IZ NS REIZIGERS")).toBe("transport");
    expect(tag("Uber BV", "trip 12 May")).toBe("transport");
    expect(tag("Bolt.eu")).toBe("transport");
    expect(tag("Shell Tankstation A4")).toBe("transport");
    expect(tag("Q-Park Amsterdam")).toBe("transport");
  });

  it("classifies general retail and e-commerce", () => {
    expect(tag("Bol.com")).toBe("shopping");
    expect(tag("Coolblue B.V.")).toBe("shopping");
    expect(tag("Zalando Payments")).toBe("shopping");
    expect(tag("HEMA Centraal Station")).toBe("shopping");
    expect(tag("ACTION ROTTERDAM")).toBe("shopping");
    expect(tag("IKEA AMSTERDAM")).toBe("shopping");
  });

  it("classifies entertainment, travel and gym as leisure", () => {
    expect(tag("Netflix.com")).toBe("leisure");
    expect(tag("BasicFit Amsterdam")).toBe("leisure");
    expect(tag("Pathe Cinema")).toBe("leisure");
    expect(tag("Booking.com")).toBe("leisure");
    expect(tag("KLM Royal Dutch Airlines")).toBe("leisure");
    expect(tag("Airbnb Payments")).toBe("leisure");
  });

  it("classifies energy / telecom / water as utilities", () => {
    expect(tag("Vattenfall NL")).toBe("utilities");
    expect(tag("Eneco")).toBe("utilities");
    expect(tag("KPN Mobile")).toBe("utilities");
    expect(tag("Ziggo")).toBe("utilities");
    expect(tag("Waternet")).toBe("utilities");
  });

  it("classifies healthcare", () => {
    expect(tag("Apotheek Centrum")).toBe("healthcare");
    expect(tag("VGZ Zorgverzekeraar")).toBe("healthcare");
    expect(tag("Tandartspraktijk West")).toBe("healthcare");
    expect(tag("Huisarts Amsterdam")).toBe("healthcare");
  });

  it("classifies digital subscriptions distinctly from leisure", () => {
    expect(tag("APPLE.COM/BILL")).toBe("subscriptions");
    expect(tag("Adobe Systems")).toBe("subscriptions");
    expect(tag("OpenAI", "ChatGPT subscription")).toBe("subscriptions");
    expect(tag("GitHub Inc.")).toBe("subscriptions");
  });

  it("classifies taxes / government", () => {
    expect(tag("Belastingdienst")).toBe("taxes");
    expect(tag("Gemeente Amsterdam")).toBe("taxes");
    expect(tag("CJIB")).toBe("taxes");
  });

  it("classifies bank service fees as finance", () => {
    expect(tag("ING BASIC", "Kosten OranjePakket")).toBe("finance");
    expect(tag("Kosten OranjePakket")).toBe("finance");
  });

  it("falls back to 'other' when nothing matches", () => {
    expect(tag("Some Mystery Vendor")).toBe("other");
    expect(tag("")).toBe("other");
    expect(tag("Random LLC", "invoice 42")).toBe("other");
  });

  it("display order covers every category key (no orphans)", () => {
    expect(new Set(CATEGORY_DISPLAY_ORDER)).toEqual(new Set(CATEGORY_KEYS));
  });
});
