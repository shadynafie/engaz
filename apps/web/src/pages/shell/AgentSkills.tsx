import type { AgentSkill, AgentSkillCatalogEntry, Bot, TaughtSkill } from "@engaz/contracts";
import { buildSkillMd, parseSkillMd } from "@engaz/core";
import { Button, Input, Switch, Textarea } from "@engaz/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { rpc } from "../../lib/rpc";

const labelClass = "mt-3 block text-[13px] text-muted-foreground";

type Draft = {
  /** null while creating. */
  skill: AgentSkill | null;
  name: string;
  description: string;
  body: string;
  /** Full SKILL.md text while editing it directly. */
  raw: string | null;
};

/** The skills this agent is given, the rest of the owner's skills, and an editor for both. */
export function AgentSkills({
  botId,
  onSkillsChange,
}: {
  botId: string;
  /** The skills this agent receives, for the composer's / picker. */
  onSkillsChange: (skills: AgentSkillCatalogEntry[]) => void;
}) {
  const { t } = useLingui();
  const ids = useId();
  const [skills, setSkills] = useState<AgentSkillCatalogEntry[] | null>(null);
  const [taught, setTaught] = useState<TaughtSkill[]>([]);
  const [bots, setBots] = useState<Bot[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const selection = useRef(0);

  const publish = useCallback(
    (list: AgentSkillCatalogEntry[]) => {
      setSkills(list);
      onSkillsChange(list.filter((skill) => skill.botIds.includes(botId)));
    },
    [botId, onSkillsChange],
  );

  const refresh = useCallback(async () => publish(await rpc.agentSkills.list({})), [publish]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      rpc.agentSkills.list({}),
      rpc.skills.list({ botId }).catch(() => []),
      rpc.bots.list().catch(() => []),
    ])
      .then(([list, taughtSkills, allBots]) => {
        if (!active) return;
        publish(list);
        setTaught(taughtSkills.filter((skill) => skill.status === "saved"));
        setBots(allBots);
      })
      .catch(() => {
        if (!active) return;
        setSkills([]);
        setError(t`Could not load`);
      });
    return () => {
      active = false;
      selection.current += 1;
    };
  }, [botId, publish, t]);

  async function toggle(skill: AgentSkillCatalogEntry, assigned: boolean) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const previous = skills;
    const botIds = assigned ? [...skill.botIds, botId] : skill.botIds.filter((id) => id !== botId);
    publish((skills ?? []).map((entry) => (entry.id === skill.id ? { ...entry, botIds } : entry)));
    try {
      await rpc.agentSkills.setAssigned({ skillId: skill.id, botId, assigned });
    } catch {
      if (previous) publish(previous);
      setError(t`Could not save skill`);
    } finally {
      setBusy(false);
    }
  }

  async function open(entry: AgentSkillCatalogEntry) {
    if (busy) return;
    const current = ++selection.current;
    setError(null);
    setConfirmingDelete(false);
    try {
      const skill = await rpc.agentSkills.get({ skillId: entry.id });
      if (current !== selection.current) return;
      const parsed = parseSkillMd(skill.content);
      setDraft(
        "error" in parsed
          ? {
              skill,
              name: skill.name,
              description: skill.description,
              body: "",
              raw: skill.content,
            }
          : {
              skill,
              name: parsed.name,
              description: parsed.description,
              body: parsed.body,
              raw: null,
            },
      );
    } catch {
      if (current === selection.current) setError(t`Could not load skill`);
    }
  }

  function close() {
    selection.current += 1;
    setDraft(null);
    setConfirmingDelete(false);
    setError(null);
  }

  function toggleRaw() {
    if (!draft) return;
    setError(null);
    if (draft.raw === null) {
      const prior = draft.skill ? parseSkillMd(draft.skill.content) : null;
      const frontmatter = prior && !("error" in prior) ? prior.frontmatter : undefined;
      let raw: string;
      try {
        raw = buildSkillMd({ ...draft, frontmatter });
      } catch {
        raw = `---\nname: ${draft.name}\ndescription: ${draft.description}\n---\n\n${draft.body}`;
      }
      setDraft({ ...draft, raw });
      return;
    }
    const parsed = parseSkillMd(draft.raw);
    if ("error" in parsed) {
      setError(parsed.error);
      return;
    }
    setDraft({
      ...draft,
      name: parsed.name,
      description: parsed.description,
      body: parsed.body,
      raw: null,
    });
  }

  async function save() {
    if (!draft || busy) return;
    setBusy(true);
    setError(null);
    const fields =
      draft.raw === null
        ? { name: draft.name.trim(), description: draft.description.trim(), body: draft.body }
        : { content: draft.raw };
    try {
      if (draft.skill) await rpc.agentSkills.update({ skillId: draft.skill.id, ...fields });
      else await rpc.agentSkills.create({ ...fields, botId });
      close();
      await refresh();
    } catch (cause) {
      setError(
        cause instanceof Error && /already exists/i.test(cause.message)
          ? t`A skill with that name already exists.`
          : t`Could not save skill`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove(skill: AgentSkill) {
    if (busy) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await rpc.agentSkills.remove({ skillId: skill.id });
      close();
      await refresh();
    } catch {
      setError(t`Could not delete skill`);
    } finally {
      setBusy(false);
    }
  }

  const readOnly = Boolean(draft?.skill?.readOnly);
  const canSave =
    draft !== null &&
    !readOnly &&
    (draft.raw === null
      ? Boolean(draft.name.trim() && draft.description.trim())
      : Boolean(draft.raw.trim()));
  const usedBy = draft?.skill
    ? bots
        .filter((bot) => draft.skill?.botIds.includes(bot.id))
        .map((bot) => bot.name)
        .join(", ")
    : "";

  return (
    <div data-testid="agent-skills" className="mt-6 border-t border-border/20 pt-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[13.5px] font-medium text-foreground">
          <Trans>Skills</Trans>
        </div>
        {!draft ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => {
              selection.current += 1;
              setError(null);
              setDraft({ skill: null, name: "", description: "", body: "", raw: null });
            }}
          >
            <Trans>New skill</Trans>
          </Button>
        ) : null}
      </div>
      {error ? <p className="mt-1 text-[12px] text-destructive">{error}</p> : null}

      {!draft && skills && skills.length === 0 && taught.length === 0 ? (
        <p className="mt-1 text-[12px] text-muted-foreground/70">
          <Trans>This agent has no skills yet.</Trans>
        </p>
      ) : null}

      {!draft && skills ? (
        <ul className="mt-2 space-y-1">
          {skills.map((skill) => (
            <li key={skill.id} className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => void open(skill)}
                className="-mx-1 min-w-0 flex-1 rounded-md px-1 py-1 text-start hover:bg-muted"
              >
                <span className="block truncate text-[13px] text-foreground" dir="auto">
                  {skill.name}
                </span>
                <span className="block truncate text-[12px] text-muted-foreground" dir="auto">
                  {skill.description}
                </span>
              </button>
              <Switch
                aria-label={skill.name}
                disabled={busy}
                checked={skill.botIds.includes(botId)}
                onCheckedChange={(checked) => void toggle(skill, checked)}
              />
            </li>
          ))}
          {taught.map((skill) => (
            <li key={skill.id} className="flex items-center gap-3 py-1">
              <span className="min-w-0 flex-1 truncate text-[13px] text-foreground" dir="auto">
                {skill.name || skill.goal}
              </span>
              <span className="shrink-0 text-[12px] text-muted-foreground">
                <Trans>Taught</Trans>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {draft ? (
        <div data-testid="agent-skill-editor" className="mt-1">
          {draft.raw === null ? (
            <>
              <label htmlFor={`${ids}-name`} className={labelClass}>
                <Trans>Name</Trans>
              </label>
              <Input
                id={`${ids}-name`}
                value={draft.name}
                maxLength={80}
                disabled={busy || readOnly}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                className="mt-1.5"
                dir="auto"
              />
              <label htmlFor={`${ids}-description`} className={labelClass}>
                <Trans>When to use</Trans>
              </label>
              <Textarea
                id={`${ids}-description`}
                value={draft.description}
                maxLength={2000}
                rows={2}
                disabled={busy || readOnly}
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                className="mt-1.5"
                dir="auto"
              />
              <label htmlFor={`${ids}-body`} className={labelClass}>
                <Trans>Instructions</Trans>
              </label>
              <Textarea
                id={`${ids}-body`}
                value={draft.body}
                rows={Math.min(16, Math.max(6, draft.body.split("\n").length + 1))}
                disabled={busy || readOnly}
                onChange={(event) => setDraft({ ...draft, body: event.target.value })}
                className="mt-1.5"
                dir="auto"
              />
            </>
          ) : (
            <Textarea
              aria-label="SKILL.md"
              value={draft.raw}
              rows={Math.min(20, Math.max(8, draft.raw.split("\n").length + 1))}
              disabled={busy || readOnly}
              onChange={(event) => setDraft({ ...draft, raw: event.target.value })}
              className="mt-3 font-mono text-[13px] leading-relaxed"
              dir="auto"
            />
          )}
          {draft.skill ? (
            <p className="mt-2 text-[12px] text-muted-foreground">
              {usedBy ? <Trans>Used by {usedBy}</Trans> : <Trans>No agent uses it yet</Trans>}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {!readOnly ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={busy || !canSave}
                onClick={() => void save()}
              >
                <Trans>Save</Trans>
              </Button>
            ) : null}
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={close}>
              {readOnly ? <Trans>Close</Trans> : <Trans>Cancel</Trans>}
            </Button>
            {!readOnly ? (
              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={toggleRaw}>
                {draft.raw === null ? <Trans>Edit SKILL.md</Trans> : <Trans>Edit fields</Trans>}
              </Button>
            ) : null}
            {draft.skill && !readOnly ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => draft.skill && void remove(draft.skill)}
                className={`ms-auto text-destructive ${confirmingDelete ? "bg-destructive/10" : ""}`}
              >
                {confirmingDelete ? <Trans>Confirm delete</Trans> : <Trans>Delete</Trans>}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
