"use client";

/**
 * Counterparty avatar — bundled brand logos for known merchants, deterministic
 * letter avatar otherwise. Each logo entry specifies its file (any extension)
 * and the background tone the logo was designed for. NL retail logos rendered
 * on a white chip read like the real app icons people recognize; Apple/Wise/
 * Sumup come from brandfetch's "dark" theme so they sit on the app surface
 * without a chip.
 */

import { useState } from "react";
import Image from "next/image";

type Props = {
  name: string | null;
  size?: number;
  className?: string;
};

type Logo = {
  pattern: RegExp;
  src: string;
  alt: string;
  /** "white" = render on a white chip with subtle padding (default for color
   * logos). "dark" = render directly on the avatar surface. */
  bg?: "white" | "dark";
};

const LOGO_MAP: Logo[] = [
  // Groceries / supermarket
  { pattern: /albert\s*heijn|\bah\s+(to\s+go|amsterdam)/i, src: "/logos/ah.png", alt: "Albert Heijn" },
  // Drug stores
  { pattern: /kruidvat/i, src: "/logos/kruidvat.png", alt: "Kruidvat" },
  { pattern: /\betos\b/i, src: "/logos/etos.png", alt: "Etos" },
  // General retail
  { pattern: /\bbol\.?com\b/i, src: "/logos/bol.svg", alt: "Bol.com" },
  { pattern: /\bhema\b/i, src: "/logos/hema.png", alt: "HEMA" },
  { pattern: /\baction\b/i, src: "/logos/action.png", alt: "Action" },
  { pattern: /coolblue/i, src: "/logos/coolblue.png", alt: "Coolblue" },
  { pattern: /bijenkorf/i, src: "/logos/bijenkorf.png", alt: "De Bijenkorf" },
  // E-commerce
  { pattern: /\btemu\b/i, src: "/logos/temu.svg", alt: "Temu", bg: "dark" },
  // Energy
  { pattern: /vattenfall/i, src: "/logos/vattenfall.svg", alt: "Vattenfall" },
  { pattern: /\beneco\b/i, src: "/logos/eneco.png", alt: "Eneco" },
  // Telecom
  { pattern: /\bkpn\b/i, src: "/logos/kpn.svg", alt: "KPN" },
  { pattern: /ziggo/i, src: "/logos/ziggo.svg", alt: "Ziggo" },
  // Transport
  { pattern: /ovpay/i, src: "/logos/ovpay.svg", alt: "OV-pay" },
  { pattern: /\bgvb\b/i, src: "/logos/gvb.png", alt: "GVB" },
  // Food delivery
  { pattern: /\btakeaway\b|thuisbezorgd/i, src: "/logos/takeaway.svg", alt: "Takeaway" },
  // Banking & gov — also covers Oranje Spaarrekening (ING's savings
  // product) and the generic "spaarrekening …" lines so transfers to
  // a Dutch savings account read as ING transactions instead of
  // landing on the deterministic letter avatar.
  { pattern: /ing\s*hypotheken|^ing\b|ing\s*basic|ing\s*kosten|oranje\s*spaarrekening|^spaarrekening\b/i, src: "/logos/ing.svg", alt: "ING" },
  { pattern: /belastingdienst/i, src: "/logos/belastingdienst.svg", alt: "Belastingdienst" },
  { pattern: /gemeente\s*amsterdam|belastingen/i, src: "/logos/amsterdam.svg", alt: "Gemeente Amsterdam" },
  { pattern: /\bideal\b|i?wero/i, src: "/logos/ideal.svg", alt: "iDEAL" },
  { pattern: /\btikkie\b|aab\s*inz\s*tikkie/i, src: "/logos/tikkie.png", alt: "Tikkie" },
  // International / fintech
  { pattern: /\bwise\b/i, src: "/logos/wise.png", alt: "Wise", bg: "dark" },
  { pattern: /sumup/i, src: "/logos/sumup.jpg", alt: "SumUp", bg: "dark" },
  { pattern: /apple\.?com\/bill|apple\s*icloud/i, src: "/logos/apple.png", alt: "Apple", bg: "dark" },
];

const PALETTE = [
  "oklch(0.62 0.13 60)",
  "oklch(0.60 0.13 230)",
  "oklch(0.62 0.16 320)",
  "oklch(0.60 0.13 162)",
  "oklch(0.62 0.16 25)",
  "oklch(0.55 0.10 280)",
];

export function CounterpartyAvatar({ name, size = 36, className }: Props) {
  const [errored, setErrored] = useState(false);
  const trimmed = (name ?? "").trim();

  if (!trimmed) {
    return <Fallback initials="?" size={size} className={className} />;
  }

  const hit = LOGO_MAP.find((l) => l.pattern.test(trimmed));
  if (hit && !errored) {
    const isWhite = hit.bg !== "dark";
    return (
      <span
        className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full ring-1 ring-border/40 ${
          isWhite ? "bg-white" : "bg-card"
        } ${className ?? ""}`}
        style={{ width: size, height: size }}
      >
        <Image
          src={hit.src}
          alt={hit.alt}
          width={size}
          height={size}
          className="object-contain p-1.5"
          onError={() => setErrored(true)}
          unoptimized
        />
      </span>
    );
  }

  return (
    <Fallback
      initials={initialsOf(trimmed)}
      size={size}
      seed={trimmed}
      className={className}
    />
  );
}

function Fallback({
  initials,
  size,
  seed,
  className,
}: {
  initials: string;
  size: number;
  seed?: string;
  className?: string;
}) {
  const color = seed ? PALETTE[hashCode(seed) % PALETTE.length] : PALETTE[0];
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full text-[11px] font-semibold uppercase ${className ?? ""}`}
      style={{
        width: size,
        height: size,
        backgroundColor: color,
        color: "oklch(0.99 0 0)",
      }}
    >
      {initials}
    </span>
  );
}

function initialsOf(name: string): string {
  const tokens = name
    .replace(/[^\p{L}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length >= 2) {
    return (tokens[0][0] + tokens[1][0]).toUpperCase();
  }
  if (tokens.length === 1) {
    return tokens[0].slice(0, 2).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}
