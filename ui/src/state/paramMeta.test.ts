import { describe, expect, it } from "vitest";

import { PARAMS, SWITCHES, parseParamValue } from "./paramMeta";

describe("parseParamValue", () => {
  it("normalizes unlimited max_per_video to null", () => {
    const max = PARAMS.find((item) => item.key === "max_per_video")!;
    expect(parseParamValue("0", max)).toBeNull();
    expect(parseParamValue("", max)).toBeNull();
    expect(parseParamValue("12", max)).toBe(12);
  });

  it("parses integer and floating point parameters", () => {
    expect(parseParamValue("768", PARAMS[0])).toBe(768);
    expect(parseParamValue("0.82", PARAMS[5])).toBe(0.82);
  });
});

describe("switch inspector metadata", () => {
  it("covers every parameter switch with a unique key and bilingual explanation", () => {
    expect(SWITCHES).toHaveLength(7);
    expect(new Set(SWITCHES.map((item) => item.key)).size).toBe(SWITCHES.length);
    for (const item of SWITCHES) {
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.tip).toContain(" / ");
    }
  });

  it("maps the mode switch to the real decode_mode config key", () => {
    expect(SWITCHES[1]).toMatchObject({ key: "decode_mode", label: "Keyframe mode (fast)" });
  });
});
