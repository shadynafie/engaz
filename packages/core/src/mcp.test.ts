import { describe, expect, it } from "vitest";
import { suggestedServerName } from "./mcp.js";

describe("suggestedServerName", () => {
  it("names a server after the meaningful part of its address", () => {
    expect(suggestedServerName("https://mcp.linear.app/sse")).toBe("Linear");
    expect(suggestedServerName("https://api.github.com/mcp")).toBe("Github");
    expect(suggestedServerName("https://treg.to/mcp/")).toBe("Treg");
  });

  it("keeps the address for machines on the home network", () => {
    expect(suggestedServerName("http://192.168.1.20:4001/mcp")).toBe("192.168.1.20:4001");
    expect(suggestedServerName("http://localhost:8765/mcp")).toBe("localhost:8765");
  });

  it("suggests nothing until the address is complete", () => {
    expect(suggestedServerName("")).toBe("");
    expect(suggestedServerName("mcp.linear")).toBe("");
  });
});
