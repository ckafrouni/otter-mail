import { useState } from "react";
import { Dialog } from "~/components/ui/dialog";
import { Text } from "~/components/ui/text";
import {
  ChevronRightIcon,
  CopyIcon,
  EllipsisIcon,
  LayersIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { useAccounts, useAllAccountLabels, useCombinedCounts } from "../gmail/hooks";
import { useMailViews } from "../gmail/custom-views";
import { ViewEditorForm } from "../gmail/view-editor-form";
import { getAccountColor, getAccountDisplayName } from "../gmail/account-style";
import { LabelChip } from "../gmail/label-chip";
import { SYSTEM_LABEL_NAMES } from "../gmail/label-names";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../gmail/menu";
import type { GmailAccount, GmailLabel, MailView } from "../gmail/types";
import { Btn, IconBtn } from "../gmail/ui";
import { SettingsGroup, SettingsPageContainer, SettingsRow } from "./settings-ui";

/**
 * Settings › Views: custom views grouped by the mailbox that owns them. Each
 * row says what it shows (label chips, accounts, live counts); editing opens
 * the rule editor in place.
 */

const COMBINED_MAILBOX = "__combined__";

type LabelLookup = Map<string, Map<string, GmailLabel>>;

/** A label's shown name: system labels by their friendly name ("Inbox"). */
function nameOf(id: string, label: GmailLabel | undefined): string {
  if (!label || label.type === "system") return SYSTEM_LABEL_NAMES[id] ?? label?.name ?? id;
  return label.name.split("/").pop() ?? label.name;
}

/** Must-have labels (deduped by name across accounts) and must-not-have names. */
function ruleSummary(view: MailView, lookup: LabelLookup) {
  const include = new Map<string, GmailLabel>();
  const exclude = new Set<string>();
  for (const rule of view.rules ?? []) {
    const labels = lookup.get(rule.accountId);
    for (const id of rule.allOf) {
      const label = labels?.get(id);
      const name = nameOf(id, label);
      if (!include.has(name)) include.set(name, { ...(label ?? { id, type: "system" }), name });
    }
    for (const id of rule.noneOf) exclude.add(nameOf(id, labels?.get(id)));
  }
  return { include: [...include.values()], exclude: [...exclude] };
}

function ViewRow({
  view,
  accounts,
  lookup,
  showAccounts,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  view: MailView;
  accounts: GmailAccount[];
  lookup: LabelLookup;
  showAccounts: boolean;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const rules = view.rules ?? [];
  const counts = useCombinedCounts(rules, view.id);
  const { include, exclude } = ruleSummary(view, lookup);
  const ruleAccounts = accounts.filter((a) => rules.some((r) => r.accountId === a.id));

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onEdit}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onEdit();
        }
      }}
      className="group/row flex w-full cursor-pointer items-center gap-3 px-3 py-3 text-left outline-none transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-accent-surface/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring sm:px-4"
    >
      <LayersIcon className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm font-medium text-foreground">{view.name}</span>
          {counts.data ? (
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground/70">
              {counts.data.total.toLocaleString()}
              {counts.data.unread > 0 ? ` · ${counts.data.unread.toLocaleString()} unread` : ""}
            </span>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {include.length === 0 ? (
            <span className="text-xs text-muted-foreground/80">All mail</span>
          ) : (
            include.map((label) => <LabelChip key={label.name} label={label} />)
          )}
          {exclude.map((name) => (
            <span
              key={name}
              className="inline-flex h-4.5 items-center rounded-sm border border-dashed border-input px-1 text-2xs font-medium leading-none text-muted-foreground/80"
            >
              not {name}
            </span>
          ))}
          {showAccounts && ruleAccounts.length > 0 ? (
            <span className="ms-1 inline-flex items-center gap-1 text-xs text-muted-foreground/70">
              <span className="text-muted-foreground/40">in</span>
              {ruleAccounts.map((a) => (
                <span key={a.id} className="inline-flex items-center gap-1">
                  <span
                    className="size-1.5 rounded-full"
                    style={{ backgroundColor: getAccountColor(a) }}
                  />
                  {getAccountDisplayName(a)}
                </span>
              ))}
            </span>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconBtn
              label={`More for ${view.name}`}
              className="opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100 data-[state=open]:opacity-100"
            >
              <EllipsisIcon className="size-4" />
            </IconBtn>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem icon={<PencilIcon />} onSelect={onEdit}>
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem icon={<CopyIcon />} onSelect={onDuplicate}>
              Duplicate
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem color="red" icon={<Trash2Icon />} onSelect={onDelete}>
              Delete…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <ChevronRightIcon className="size-4 text-icon-muted" />
      </div>
    </div>
  );
}

export function ViewsPane({
  editingId,
  editingMailbox,
  onOpenView,
  onDone,
}: {
  editingId: string | null;
  editingMailbox: string | null;
  onOpenView: (viewId: string, mailbox: string) => void;
  onDone: () => void;
}) {
  const { views, saveView, deleteView, resetView } = useMailViews();
  const accountsQuery = useAccounts();
  const accounts = accountsQuery.data ?? [];
  const accountLabels = useAllAccountLabels(accounts.map((a) => a.id));
  const [confirmDelete, setConfirmDelete] = useState<MailView | null>(null);

  if (editingId) {
    if (!accountsQuery.data) {
      return (
        <SettingsPageContainer>
          <p className="text-sm text-muted-foreground">Loading accounts…</p>
        </SettingsPageContainer>
      );
    }
    const editingView =
      editingId === "new" ? null : (views.find((v) => v.id === editingId) ?? null);
    const mailbox = editingView
      ? (editingView.mailbox ?? COMBINED_MAILBOX)
      : (editingMailbox ?? COMBINED_MAILBOX);
    // Account-owned views edit against that account's labels only.
    const scopedAccounts =
      mailbox === COMBINED_MAILBOX ? accounts : accounts.filter((a) => a.id === mailbox);
    const owner = accounts.find((a) => a.id === mailbox);
    return (
      <SettingsPageContainer>
        <ViewEditorForm
          key={editingId}
          view={editingView}
          accounts={scopedAccounts}
          mailboxName={owner ? getAccountDisplayName(owner) : "All mailboxes"}
          onSave={(input) => saveView({ ...input, mailbox })}
          onDelete={deleteView}
          onReset={resetView}
          onDone={onDone}
        />
      </SettingsPageContainer>
    );
  }

  const lookup: LabelLookup = new Map(
    accountLabels.map((a) => [a.accountId, new Map(a.labels.map((l) => [l.id, l]))]),
  );
  const custom = views.filter((v) => v.kind === "custom");
  const mailboxes = [
    ...(accounts.length > 1
      ? [{ id: COMBINED_MAILBOX, title: "All mailboxes", color: null as string | null }]
      : []),
    ...accounts.map((a) => ({
      id: a.id,
      title: getAccountDisplayName(a),
      color: getAccountColor(a),
    })),
  ];
  const ownerOf = (v: MailView) =>
    v.mailbox ?? (accounts.length > 1 ? COMBINED_MAILBOX : (accounts[0]?.id ?? COMBINED_MAILBOX));
  const sections = mailboxes
    .map((m) => ({ ...m, views: custom.filter((v) => ownerOf(v) === m.id) }))
    .filter((s) => s.views.length > 0);

  const newViewMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Btn size="xs" variant="outline">
          <PlusIcon className="size-3.5" />
          New view
        </Btn>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {mailboxes.map((m, i) => (
          <div key={m.id}>
            {i === 1 && mailboxes[0].id === COMBINED_MAILBOX ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem
              icon={
                m.color ? (
                  <span className="flex size-4 items-center justify-center">
                    <span className="size-2 rounded-full" style={{ backgroundColor: m.color }} />
                  </span>
                ) : (
                  <LayersIcon />
                )
              }
              onSelect={() => onOpenView("new", m.id)}
            >
              {m.id === COMBINED_MAILBOX ? "Across all mailboxes" : `In ${m.title}`}
            </DropdownMenuItem>
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <SettingsPageContainer>
      <section className="space-y-2.5">
        <div className="flex min-h-7 items-start justify-between gap-4 px-3 sm:px-4">
          <h2 className="flex min-h-7 items-center text-sm font-normal text-foreground/70">
            Views
          </h2>
          <div className="flex min-h-7 items-center">{newViewMenu}</div>
        </div>
        {sections.length === 0 ? (
          <SettingsGroup>
            <SettingsRow
              title="No views yet"
              description="A view is a saved filter — like “01 Action” across every account — that shows up in the sidebar."
            />
          </SettingsGroup>
        ) : (
          <div className="space-y-5">
            {sections.map((section) => (
              <div key={section.id} className="space-y-2">
                <h3 className="flex items-center gap-2 px-3 text-xs font-medium text-muted-foreground sm:px-4">
                  {section.color ? (
                    <span
                      className="size-2 rounded-full"
                      style={{ backgroundColor: section.color }}
                    />
                  ) : (
                    <LayersIcon className="size-3.5" />
                  )}
                  {section.title}
                </h3>
                <SettingsGroup>
                  {section.views.map((view) => (
                    <ViewRow
                      key={view.id}
                      view={view}
                      accounts={accounts}
                      lookup={lookup}
                      showAccounts={section.id === COMBINED_MAILBOX}
                      onEdit={() => onOpenView(view.id, section.id)}
                      onDuplicate={() =>
                        void saveView({
                          name: `${view.name} copy`,
                          rules: view.rules ?? [],
                          mailbox: view.mailbox,
                        })
                      }
                      onDelete={() => setConfirmDelete(view)}
                    />
                  ))}
                </SettingsGroup>
              </div>
            ))}
          </div>
        )}
        <p className="px-3 pt-1 text-xs text-muted-foreground/80 sm:px-4">
          Views show up in the sidebar of the mailbox they belong to.
        </p>
      </section>
      <Dialog
        open={confirmDelete !== null}
        onOpenChange={(o) => {
          if (!o) setConfirmDelete(null);
        }}
        title={`Delete “${confirmDelete?.name ?? ""}”?`}
        confirmLabel="Delete view"
        confirmVariant="accent"
        onConfirm={() => {
          if (confirmDelete) void deleteView(confirmDelete.id);
          setConfirmDelete(null);
        }}
      >
        <Text variant="small">
          The view leaves the sidebar. Your mail and labels aren't touched.
        </Text>
      </Dialog>
    </SettingsPageContainer>
  );
}
