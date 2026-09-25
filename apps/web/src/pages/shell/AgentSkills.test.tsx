// @vitest-environment jsdom

import { buildSkillMd } from "@engaz/core";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  agentSkills: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    setAssigned: vi.fn(),
  },
  skills: { list: vi.fn() },
  bots: { list: vi.fn() },
}));
vi.mock("../../lib/rpc", () => ({ rpc: api }));
vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray) => parts.join("");
  return { useLingui: () => ({ t }), Trans: ({ children }: { children: ReactNode }) => children };
});
vi.mock("@engaz/ui-web", () => ({
  Button: ({
    variant: _v,
    size: _s,
    ...props
  }: ComponentProps<"button"> & Record<string, unknown>) => <button {...props} />,
  Input: (props: ComponentProps<"input">) => <input {...props} />,
  Textarea: (props: ComponentProps<"textarea">) => <textarea {...props} />,
  Switch: ({
    checked,
    onCheckedChange,
    ...props
  }: {
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
  } & ComponentProps<"input">) => (
    <input
      type="checkbox"
      role="switch"
      aria-checked={checked}
      checked={checked}
      onChange={(event) => onCheckedChange(event.target.checked)}
      {...props}
    />
  ),
}));

import { AgentSkills } from "./AgentSkills";

const standup = {
  id: "skill-standup",
  name: "Daily standup",
  description: "Prepare standup notes",
  source: "user" as const,
  readOnly: false,
  botIds: ["bot-other"],
};

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const onSkillsChange = vi.fn();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  for (const group of Object.values(api)) for (const fn of Object.values(group)) fn.mockReset();
  api.agentSkills.list.mockResolvedValue([standup]);
  api.skills.list.mockResolvedValue([]);
  api.bots.list.mockResolvedValue([{ id: "bot-other", name: "Writer" }]);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const render = () =>
  act(async () => root.render(<AgentSkills botId="bot-chief" onSkillsChange={onSkillsChange} />));
const button = (text: string) => {
  const found = [...container.querySelectorAll("button")].find((b) => b.textContent === text);
  if (!found) throw new Error(`Missing button: ${text}`);
  return found;
};
function type(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

it("gives a skill to this agent and hands the composer only this agent's skills", async () => {
  api.agentSkills.setAssigned.mockResolvedValue({ ...standup, botIds: ["bot-other", "bot-chief"] });
  await render();
  expect(onSkillsChange).toHaveBeenLastCalledWith([]);
  const toggle = container.querySelector<HTMLInputElement>('[aria-label="Daily standup"]');
  expect(toggle?.checked).toBe(false);
  await act(async () => toggle?.click());
  expect(api.agentSkills.setAssigned).toHaveBeenCalledWith({
    skillId: "skill-standup",
    botId: "bot-chief",
    assigned: true,
  });
  expect(onSkillsChange).toHaveBeenLastCalledWith([
    expect.objectContaining({ id: "skill-standup", botIds: ["bot-other", "bot-chief"] }),
  ]);
});

it("creates a skill for this agent from plain fields", async () => {
  api.agentSkills.create.mockResolvedValue({});
  await render();
  await act(async () => button("New skill").click());
  const [name] = container.querySelectorAll("input");
  const [when, instructions] = container.querySelectorAll("textarea");
  await act(async () => {
    type(name as HTMLInputElement, "Greet");
    type(when as HTMLTextAreaElement, "At the start of a chat");
    type(instructions as HTMLTextAreaElement, "Say hello.");
  });
  await act(async () => button("Save").click());
  expect(api.agentSkills.create).toHaveBeenCalledWith({
    name: "Greet",
    description: "At the start of a chat",
    body: "Say hello.",
    botId: "bot-chief",
  });
});

it("shows who uses a skill and round-trips SKILL.md editing", async () => {
  const content = buildSkillMd({
    name: "Daily standup",
    description: "Prepare standup notes",
    body: "1. Wins",
  });
  api.agentSkills.get.mockResolvedValue({ ...standup, content });
  api.agentSkills.update.mockResolvedValue({});
  await render();
  await act(async () => container.querySelector<HTMLButtonElement>("li button")?.click());
  expect(container.textContent).toContain("Used by Writer");
  expect(container.querySelector("input")?.value).toBe("Daily standup");
  await act(async () => button("Edit SKILL.md").click());
  const raw = container.querySelector<HTMLTextAreaElement>('[aria-label="SKILL.md"]');
  expect(raw?.value).toContain("name: Daily standup");
  await act(async () =>
    type(raw as HTMLTextAreaElement, content.replace("1. Wins", "1. Blockers")),
  );
  await act(async () => button("Edit fields").click());
  expect(container.querySelectorAll("textarea")[1]?.value).toContain("1. Blockers");
  await act(async () => button("Save").click());
  expect(api.agentSkills.update).toHaveBeenCalledWith(
    expect.objectContaining({ skillId: "skill-standup", name: "Daily standup" }),
  );
});
