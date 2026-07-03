import { useMemo, useState } from "react";
import {
  Button,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  Field,
  FieldSet,
  Input,
  Text,
  EmptyState,
} from "@glaze/core/components";
import { BanIcon, PlusIcon, XIcon } from "lucide-react";
import { useAllAccountLabels, useCombinedCounts } from "./hooks";
import { defaultRulesFor } from "./custom-views";
import { getAccountColor, getAccountDisplayName } from "./account-style";
import { SYSTEM_LABEL_NAMES, SYSTEM_LABEL_ORDER, labelDisplayName } from "./label-names";
import type { GmailAccount, GmailLabel, MailView, ViewRule } from "./types";

/**
 * Smart Mailbox-style view editor (Settings → Views). Each account is one
 * compact rule card with "Must have" / "Must not have" chip rows; labels are
 * added from a native menu. Mount with a `key` per view — initial state
 * derives from props at mount.
 */
type ViewEditorFormProps = {
  /** The view being edited; null when creating a new custom view. */
  view: MailView | null;
  accounts: GmailAccount[];
  onSave: (input: { id?: string; name: string; rules: ViewRule[] }) => Promise<unknown>;
  onDelete: (id: string) => Promise<unknown>;
  onReset: (id: string) => Promise<unknown>;
  onDone: () => void;
};

type AccountPicks = { allOf: string[]; noneOf: string[] };
type Picks = Record<string, AccountPicks>;

function rulesToPicks(rules: ViewRule[]): Picks {
  const picks: Picks = {};
  for (const rule of rules) picks[rule.accountId] = { allOf: [...rule.allOf], noneOf: [...rule.noneOf] };
  return picks;
}

function picksToRules(picks: Picks): ViewRule[] {
  return Object.entries(picks)
    .filter(([, p]) => p.allOf.length > 0 || p.noneOf.length > 0)
    .map(([accountId, p]) => ({ accountId, allOf: p.allOf, noneOf: p.noneOf }));
}

function sortSystemLabels(labels: GmailLabel[]): GmailLabel[] {
  return labels
    .filter((l) => l.type === "system")
    .sort((a, b) => {
      const ai = SYSTEM_LABEL_ORDER.indexOf(a.id);
      const bi = SYSTEM_LABEL_ORDER.indexOf(b.id);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });
}

function chipName(label: GmailLabel | undefined, labelId: string): string {
  if (!label) return SYSTEM_LABEL_NAMES[labelId] ?? labelId;
  const display = labelDisplayName(label);
  return label.type === "user" ? (display.split("/").pop() ?? display) : display;
}

const PILL =
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-pill text-small-strong px-1.5 py-0.5";

function LabelChipButton({
  label,
  labelId,
  excluded,
  onRemove,
}: {
  label: GmailLabel | undefined;
  labelId: string;
  excluded?: boolean;
  onRemove: () => void;
}) {
  const name = chipName(label, labelId);
  const style =
    !excluded && label?.color
      ? { backgroundColor: label.color.backgroundColor, color: label.color.textColor }
      : undefined;
  return (
    <span
      className={[PILL, excluded ? "bg-support-red/15 text-support-red" : label?.color ? "" : "bg-control"].join(" ")}
      style={style}
    >
      {excluded ? <BanIcon className="size-3" /> : null}
      {name}
      <button
        type="button"
        aria-label={`Remove ${name}`}
        onClick={onRemove}
        className="opacity-60 hover:opacity-100 cursor-pointer"
      >
        <XIcon className="size-3" />
      </button>
    </span>
  );
}

function AddLabelMenu({
  labels,
  usedIds,
  onPick,
}: {
  labels: GmailLabel[];
  usedIds: Set<string>;
  onPick: (labelId: string) => void;
}) {
  const user = labels.filter((l) => l.type === "user" && !usedIds.has(l.id));
  const system = sortSystemLabels(labels).filter((l) => !usedIds.has(l.id));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Add label"
          className="flex size-5 shrink-0 items-center justify-center rounded-full bg-control text-secondary hover:text-primary cursor-pointer"
        >
          <PlusIcon className="size-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {user.map((label) => (
          <DropdownMenuItem key={label.id} onSelect={() => onPick(label.id)}>
            {labelDisplayName(label)}
          </DropdownMenuItem>
        ))}
        {user.length > 0 && system.length > 0 ? <DropdownMenuSeparator /> : null}
        {system.map((label) => (
          <DropdownMenuItem key={label.id} onSelect={() => onPick(label.id)}>
            {labelDisplayName(label)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ChipRow({
  title,
  labelIds,
  excluded,
  emptyHint,
  labels,
  usedIds,
  onAdd,
  onRemove,
}: {
  title: string;
  labelIds: string[];
  excluded?: boolean;
  emptyHint?: string;
  labels: GmailLabel[];
  usedIds: Set<string>;
  onAdd: (labelId: string) => void;
  onRemove: (labelId: string) => void;
}) {
  const byId = new Map(labels.map((l) => [l.id, l]));
  return (
    <div className="flex items-start gap-2">
      <Text variant="mini" color="secondary" className="w-28 shrink-0 pt-[3px]">
        {title}
      </Text>
      <div className="flex flex-wrap items-center gap-1.5 flex-1 min-w-0">
        {labelIds.map((id) => (
          <LabelChipButton
            key={id}
            label={byId.get(id)}
            labelId={id}
            excluded={excluded}
            onRemove={() => onRemove(id)}
          />
        ))}
        {labelIds.length === 0 && emptyHint ? (
          <Text variant="mini" color="tertiary" className="pt-[3px]">
            {emptyHint}
          </Text>
        ) : null}
        <AddLabelMenu labels={labels} usedIds={usedIds} onPick={onAdd} />
      </div>
    </div>
  );
}

export function ViewEditorForm({ view, accounts, onSave, onDelete, onReset, onDone }: ViewEditorFormProps) {
  const accountIds = accounts.map((a) => a.id);
  const accountLabels = useAllAccountLabels(accountIds, true);
  const anyLoading = accountLabels.some((a) => a.isLoading);

  const initialRules = view == null ? [] : view.rules ?? defaultRulesFor(view.kind, accounts);

  const [name, setName] = useState(view?.name ?? "");
  const [picks, setPicks] = useState<Picks>(() => rulesToPicks(initialRules));

  const isDefault = view?.kind === "inbox" || view?.kind === "sent";

  const update = (accountId: string, fn: (p: AccountPicks) => AccountPicks) => {
    setPicks((prev) => ({ ...prev, [accountId]: fn(prev[accountId] ?? { allOf: [], noneOf: [] }) }));
  };

  const rules = useMemo(() => picksToRules(picks), [picks]);
  const draftCounts = useCombinedCounts(rules, `draft:${view?.id ?? "new"}`, true);

  const canSave = name.trim().length > 0 && rules.length > 0;

  const handleSave = () => {
    if (!canSave) return;
    void onSave({ id: view?.id, name: name.trim(), rules }).then(onDone);
  };

  if (accounts.length === 0) {
    return <EmptyState placement="inline" title="No accounts" description="Connect an account to build views." />;
  }

  return (
    <div className="flex flex-col gap-4">
      <FieldSet>
        <Field label="Name">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Action Required"
            autoFocus={view == null}
            className="w-64"
          />
        </Field>
      </FieldSet>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-2 px-1">
          <Text variant="small-strong">Show emails that match</Text>
          {rules.length > 0 && draftCounts.data ? (
            <Text variant="mini" color="secondary" className="shrink-0 tabular-nums">
              {draftCounts.data.total.toLocaleString()} messages
              {draftCounts.data.unread > 0 ? `, ${draftCounts.data.unread.toLocaleString()} unread` : ""}
            </Text>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          {accounts.map((account) => {
            const entry = accountLabels.find((a) => a.accountId === account.id);
            const labels = entry?.labels ?? [];
            const p = picks[account.id] ?? { allOf: [], noneOf: [] };
            const usedIds = new Set([...p.allOf, ...p.noneOf]);
            return (
              <div key={account.id} className="flex flex-col gap-2 rounded-control bg-control-subtle px-3 py-2.5">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: getAccountColor(account) }}
                  />
                  <Text variant="small-strong" className="shrink-0">
                    {getAccountDisplayName(account)}
                  </Text>
                  <Text variant="mini" color="tertiary" truncate>
                    {account.email}
                  </Text>
                </div>
                {labels.length === 0 && anyLoading ? (
                  <Text variant="mini" color="tertiary">
                    Loading labels…
                  </Text>
                ) : (
                  <>
                    <ChipRow
                      title="Must have"
                      labelIds={p.allOf}
                      emptyHint={p.noneOf.length > 0 ? "All mail" : "Not included — add a label"}
                      labels={labels}
                      usedIds={usedIds}
                      onAdd={(id) => update(account.id, (cur) => ({ ...cur, allOf: [...cur.allOf, id] }))}
                      onRemove={(id) =>
                        update(account.id, (cur) => ({ ...cur, allOf: cur.allOf.filter((x) => x !== id) }))
                      }
                    />
                    <ChipRow
                      title="Must not have"
                      labelIds={p.noneOf}
                      excluded
                      labels={labels}
                      usedIds={usedIds}
                      onAdd={(id) => update(account.id, (cur) => ({ ...cur, noneOf: [...cur.noneOf, id] }))}
                      onRemove={(id) =>
                        update(account.id, (cur) => ({ ...cur, noneOf: cur.noneOf.filter((x) => x !== id) }))
                      }
                    />
                  </>
                )}
              </div>
            );
          })}
        </div>
        <Text variant="mini" color="tertiary" className="px-1">
          A message must carry every "must have" label and none of the "must not have" ones; accounts add
          together.
        </Text>
      </div>

      <div className="flex items-center gap-2 pt-1">
        {view && view.kind === "custom" ? (
          <Button
            variant="filled"
            size="small"
            className="text-support-red"
            onClick={() => void onDelete(view.id).then(onDone)}
          >
            Delete
          </Button>
        ) : null}
        {view && isDefault ? (
          <Button variant="filled" size="small" onClick={() => void onReset(view.id).then(onDone)}>
            Reset to default
          </Button>
        ) : null}
        <div className="flex-1" />
        <Button variant="filled" size="small" onClick={onDone}>
          Cancel
        </Button>
        <Button variant="accent" size="small" disabled={!canSave} onClick={handleSave}>
          {view ? "Save" : "Create"}
        </Button>
      </div>
    </div>
  );
}
