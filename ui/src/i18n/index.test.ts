import { describe, expect, it } from "vitest";

import { setLang, t } from "./index";

describe("i18n", () => {
  it("switches dictionaries and interpolates variables", () => {
    setLang("en");
    expect(t("videos_found", { n: 3 })).toBe("3 files found");
    setLang("zh");
    expect(t("videos_found", { n: 3 })).toBe("找到 3 个文件");
  });
});
