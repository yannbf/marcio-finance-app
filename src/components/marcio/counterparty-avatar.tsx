"use client";

/**
 * Counterparty avatar — bundled SVG for known brands, deterministic letter
 * avatar otherwise. Images that fail to load (e.g. logo file not yet added)
 * fall back to the letter avatar at runtime, so the LOGO_MAP can grow over
 * time without crashing the UI.
 */

import { useState } from "react";
import Image from "next/image";

type Props = {
  name: string | null;
  size?: number;
  className?: string;
};

const LOGO_MAP: { pattern: RegExp; src: string; alt: string }[] = [
  { pattern: /albert\s*heijn|\bah\s+(to\s+go|amsterdam)/i, src: "/logos/ah.svg", alt: "Albert Heijn" },
  { pattern: /kruidvat/i, src: "/logos/kruidvat.svg", alt: "Kruidvat" },
  { pattern: /\bbol\.?com\b/i, src: "/logos/bol.svg", alt: "Bol.com" },
  { pattern: /\btemu\b/i, src: "/logos/temu.svg", alt: "Temu" },
  { pattern: /vattenfall/i, src: "/logos/vattenfall.svg", alt: "Vattenfall" },
  { pattern: /ing\s*hypotheken|^ing\b/i, src: "/logos/ing.svg", alt: "ING" },
  { pattern: /\bkpn\b/i, src: "/logos/kpn.svg", alt: "KPN" },
  { pattern: /\bvgz\b/i, src: "/logos/vgz.svg", alt: "VGZ" },
  { pattern: /\bwise\b/i, src: "/logos/wise.svg", alt: "Wise" },
  { pattern: /ovpay/i, src: "/logos/ovpay.svg", alt: "OV-pay" },
  { pattern: /apple\.?com\/bill|apple\s*icloud/i, src: "/logos/apple.svg", alt: "Apple" },
  { pattern: /\bhbo\b|max\.com/i, src: "/logos/hbomax.svg", alt: "HBO Max" },
  { pattern: /\btikkie\b/i, src: "/logos/tikkie.svg", alt: "Tikkie" },
  { pattern: /sumup/i, src: "/logos/sumup.svg", alt: "SumUp" },
  { pattern: /gemeente\s*amsterdam|belastingen/i, src: "/logos/amsterdam.svg", alt: "Gemeente Amsterdam" },
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
    return (
      <span
        className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-card ring-1 ring-border/40 ${className ?? ""}`}
        style={{ width: size, height: size }}
      >
        <Image
          src={hit.src}
          alt={hit.alt}
          width={size}
          height={size}
          className="object-contain p-1"
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
