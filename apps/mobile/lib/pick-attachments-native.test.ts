import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as DocumentPicker from "expo-document-picker";
import { expect, it, vi } from "vitest";

const files = vi.hoisted(() => new Map<string, Buffer>());
vi.mock("expo-file-system", () => ({
  File: class {
    constructor(private uri: string) {}
    info() {
      return { size: files.get(this.uri)!.byteLength };
    }
    async base64() {
      return files.get(this.uri)!.toString("base64");
    }
  },
}));
vi.mock("expo-document-picker", () => ({ getDocumentAsync: vi.fn() }));
vi.mock("expo-image-picker", () => ({}));

import { pickDocuments } from "./pick-attachments.js";

it.each([
  ["xls", "application/vnd.ms-excel", "application/octet-stream"],
  ["xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", undefined],
])(
  "keeps original %s bytes from the native document picker",
  async (extension, mimeType, reportedType) => {
    const name = `statement.${extension}`;
    const bytes = readFileSync(resolve(import.meta.dirname, "../../web/e2e/fixtures", name));
    const uri = `file:///fake/${name}`;
    files.set(uri, bytes);
    vi.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue({
      canceled: false,
      assets: [{ name, uri, mimeType: reportedType, lastModified: 0 }],
    });
    const result = await pickDocuments();
    expect(result.skipped).toEqual([]);
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0]).toMatchObject({
      name,
      mimeType,
      contentBase64: bytes.toString("base64"),
    });
  },
);
