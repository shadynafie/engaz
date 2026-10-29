import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { assertTransition, canTransition, isActive, isExecuting } from "./run-state.js";

describe("run state machine", () => {
  it("keeps waiting runs cancellable without presenting them as executing", () => {
    for (const status of ["queued", "leased", "running"] as const) {
      expect(isExecuting(status)).toBe(true);
      expect(isActive(status)).toBe(true);
    }
    for (const status of ["waiting_input", "waiting_takeover"] as const) {
      expect(isExecuting(status)).toBe(false);
      expect(isActive(status)).toBe(true);
    }
    for (const status of ["completed", "failed", "cancelled", undefined]) {
      expect(isExecuting(status)).toBe(false);
    }
  });

  it("allows takeover resume onto a lease", () => {
    expect(canTransition("waiting_takeover", "leased")).toBe(true);
    expect(canTransition("waiting_takeover", "running")).toBe(false);
  });

  it("rejects rewriting a completed run", () => {
    expect(() => assertTransition("completed", "running")).toThrow(/illegal/i);
  });

  it("never leaves a terminal state except failed retry", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("completed" as const, "cancelled" as const),
        fc.constantFrom(
          "queued" as const,
          "leased" as const,
          "running" as const,
          "waiting_input" as const,
          "completed" as const,
        ),
        (from, to) => {
          expect(canTransition(from, to)).toBe(false);
        },
      ),
    );
  });
});
