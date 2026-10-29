import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { RunErrorNotice } from "./RunErrorNotice";

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({ t: (strings: TemplateStringsArray) => strings.join("") }),
}));

function render(error: string) {
  return renderToStaticMarkup(
    <RunErrorNotice
      error={error}
      onChooseModel={() => undefined}
      onOpenModels={() => undefined}
      onDismiss={() => undefined}
    />,
  );
}

describe("run error notice", () => {
  it.each([
    ["invalid_api_key", "Replace key"],
    ["model_not_found", "Choose a model"],
    ["insufficient_quota", "Choose a model"],
    ["Connect a model to start a run.", "Connect a model"],
  ])("shows one recovery action for %s", (error, action) => {
    const html = render(error);
    expect(html.match(/data-testid="run-error-recovery"/g)).toHaveLength(1);
    expect(html).toContain(`>${action}</button>`);
    expect(html).toContain("<details");
    expect(html).not.toContain("<details open");
    expect(html).toContain(error);
  });
  it.each(["Provider request timed out", "Unexpected database error"])(
    "does not send temporary or unknown failures to model settings: %s",
    (error) => {
      expect(render(error)).not.toContain('data-testid="run-error-recovery"');
    },
  );
});
