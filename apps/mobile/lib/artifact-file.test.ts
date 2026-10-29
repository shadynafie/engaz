import { describe, expect, it } from "vitest";
import { artifactCacheFileName } from "./artifact-file.js";

describe("artifactCacheFileName", () => {
  it("uses the server id instead of an untrusted display name", () => {
    expect(artifactCacheFileName("../artifact/one", "application/pdf")).toBe("___artifact_one.pdf");
    expect(artifactCacheFileName("markdown-one", "text/markdown")).toBe("markdown-one.md");
    expect(artifactCacheFileName("legacy-sheet", "application/vnd.ms-excel")).toBe(
      "legacy-sheet.xls",
    );
    expect(
      artifactCacheFileName(
        "sheet",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ),
    ).toBe("sheet.xlsx");
  });
});
