/**
 * Smoke-tests for fingerprintCounterparty. Run with:
 *   pnpm tsx scripts/test-fingerprint.ts
 *
 * Not a Vitest suite (we don't have one yet); this is the lightest
 * thing that catches regressions in the fingerprinter without taking
 * on a new dev dep.
 */

import { fingerprintCounterparty } from "../src/lib/matching/fingerprint.ts";

const cases: Array<[string, string]> = [
  ["AH AMSTERDAM NLD", "ah"],
  ["AH ROTTERDAM NLD", "ah"],
  ["AH UTRECHT NLD", "ah"],
  ["Coolblue B.V. EINDHOVEN NLD", "coolblue b\\.v\\."],
  ["AAB INZ TIKKIE", "tikkie"],
  ["NS-OV ROTTERDAM Pas 003", "ns-ov"],
  // No tail — passes through.
  ["Belastingdienst", "belastingdienst"],
  // Trailing digits stripped.
  ["Foobar 1234", "foobar"],
];

let failures = 0;
for (const [input, expected] of cases) {
  const got = fingerprintCounterparty(input);
  const ok = got === expected;
  console.log(`${ok ? "✓" : "✗"} ${input.padEnd(35)} → ${got}` + (ok ? "" : `  (expected: ${expected})`));
  if (!ok) failures++;
}

process.exit(failures === 0 ? 0 : 1);
