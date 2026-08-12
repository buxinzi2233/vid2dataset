import { describe, expect, it } from "vitest";

import { clampZoom } from "./app";

describe("clampZoom", () => {
  it("keeps zoom between 80 and 140 percent on tenths", () => {
    expect(clampZoom(0.2)).toBe(0.8);
    expect(clampZoom(0.94)).toBe(0.9);
    expect(clampZoom(1.06)).toBe(1.1);
    expect(clampZoom(2)).toBe(1.4);
  });
});
