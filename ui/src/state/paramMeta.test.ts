import { describe, expect, it } from "vitest";

import { BUCKET_PARAMS, STRONG_PARAMS, SWITCHES, paramsForConfig, parseParamValue } from "./paramMeta";

describe("parseParamValue", () => {
  it("normalizes unlimited max_per_video to null", () => {
    const max = BUCKET_PARAMS.find((item) => item.key === "max_per_video")!;
    expect(parseParamValue("0", max)).toBeNull();
    expect(parseParamValue("", max)).toBeNull();
    expect(parseParamValue("12", max)).toBe(12);
  });

  it("parses integer and floating point parameters", () => {
    expect(parseParamValue("768", BUCKET_PARAMS[0])).toBe(768);
    expect(parseParamValue("0.82", BUCKET_PARAMS[5])).toBe(0.82);
  });

  it("switches the eight slots to strong-dedup controls", () => {
    expect(paramsForConfig({ output_mode: "bucket" })).toBe(BUCKET_PARAMS);
    expect(paramsForConfig({ output_mode: "native" })).toBe(STRONG_PARAMS);
    expect(STRONG_PARAMS).toHaveLength(8);
    expect(STRONG_PARAMS.map((item) => item.key)).toContain("dedup_content_threshold");
    expect(STRONG_PARAMS.map((item) => item.key)).toContain("native_scan_interval_seconds");
    expect(STRONG_PARAMS.map((item) => item.key)).toContain("native_scene_threshold");
    expect(STRONG_PARAMS.map((item) => item.key)).toContain("dedup_temporal_feature_threshold");
    expect(STRONG_PARAMS.at(-1)?.key).toBe("dedup_min_seconds");
  });
});

describe("switch inspector metadata", () => {
  it("covers every parameter switch with a unique key and bilingual explanation", () => {
    expect(SWITCHES).toHaveLength(9);
    expect(new Set(SWITCHES.map((item) => item.key)).size).toBe(SWITCHES.length);
    for (const item of SWITCHES) {
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.tip).toContain(" / ");
    }
  });

  it("maps the mode switch to the real decode_mode config key", () => {
    expect(SWITCHES[1]).toMatchObject({ key: "decode_mode", label: "Keyframe mode (fast)" });
  });

  it("exposes native output and strong dedup as real config switches", () => {
    expect(SWITCHES.at(-2)?.key).toBe("output_mode");
    expect(SWITCHES.at(-1)?.key).toBe("dedup_mode");
  });
});
