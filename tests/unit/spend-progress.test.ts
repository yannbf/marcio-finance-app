import { describe, expect, it } from "vitest";
import { progressTone } from "@/components/marcio/spend-progress.tsx";

describe("progressTone", () => {
  it("returns ok when nothing is planned", () => {
    expect(progressTone(0, 0)).toBe("ok");
    expect(progressTone(100, 0)).toBe("ok");
  });

  it("stays ok below 75%", () => {
    expect(progressTone(0, 100)).toBe("ok");
    expect(progressTone(50, 100)).toBe("ok");
    expect(progressTone(74, 100)).toBe("ok");
  });

  it("flips to warn at exactly 75%", () => {
    expect(progressTone(75, 100)).toBe("warn");
    expect(progressTone(99, 100)).toBe("warn");
  });

  it("stays warn (not over) at exactly 100%", () => {
    // Spending exactly the planned amount is on budget, not over —
    // the row should render with a checkmark, never the red alert.
    expect(progressTone(100, 100)).toBe("warn");
  });

  it("flips to over only when actual exceeds planned", () => {
    expect(progressTone(101, 100)).toBe("over");
    expect(progressTone(500, 100)).toBe("over");
  });
});
