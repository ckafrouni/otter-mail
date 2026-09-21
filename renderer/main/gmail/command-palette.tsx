import { useEffect, useState, type ReactNode } from "react";
import {
  Command,
  CommandAccessory,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@glaze/core/components";
import {
  ArchiveXIcon,
  BookmarkIcon,
  FileIcon,
  InboxIcon,
  LayersIcon,
  PencilIcon,
  PlusIcon,
  SendIcon,
  SettingsIcon,
  StarIcon,
  Trash2Icon,
} from "lucide-react";
import { useDebouncedValue, useSearchMessages } from "./hooks";
import { gmailApi } from "./api";
import { getAccountColor } from "./account-style";
import type { GmailAccount, GmailMessageSummary, MailView } from "./types";

const MAX_MAIL_RESULTS = 12;

type CommandPaletteProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: GmailAccount[];
  views: MailView[];
  onOpenMessage: (message: GmailMessageSummary) => void;
  onGoToView: (viewId: string) => void;
  onCompose: () => void;
};

type StaticCommand = { id: string; label: string; icon: ReactNode; run: () => void };

function viewCommandIcon(view: MailView): ReactNode {
  if (view.kind === "inbox") return <InboxIcon />;
  if (view.kind === "starred") return <StarIcon />;
  if (view.kind === "sent") return <SendIcon />;
  if (view.kind === "drafts") return <FileIcon />;
  if (view.kind === "important") return <BookmarkIcon />;
  if (view.kind === "junk") return <ArchiveXIcon />;
  if (view.kind === "trash") return <Trash2Icon />;
  return <LayersIcon />;
}

function formatResultDate(timestamp: number): string {
  const date = new Date(timestamp);
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function CommandPalette({
  open,
  onOpenChange,
  accounts,
  views,
  onOpenMessage,
  onGoToView,
  onCompose,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query.trim(), 150);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  // Cross-account mail search (accountId null = every account).
  const searchResults = useSearchMessages(debouncedQuery, null, open);
  const mailResults = (searchResults.data?.pages[0]?.messages ?? []).slice(0, MAX_MAIL_RESULTS);

  const commands: StaticCommand[] = [
    { id: "compose", label: "Compose new message", icon: <PencilIcon />, run: onCompose },
    // Combined views are only offered when 2+ accounts are connected (matches the sidebar).
    ...(accounts.length > 1
      ? views.map((view) => ({
          id: `view:${view.id}`,
          label: `Go to ${view.name}`,
          icon: viewCommandIcon(view),
          run: () => onGoToView(view.id),
        }))
      : []),
    {
      id: "settings",
      label: "Go to Settings",
      icon: <SettingsIcon />,
      run: () => void gmailApi.openSettings(),
    },
    {
      id: "new-view",
      label: "New view",
      icon: <PlusIcon />,
      run: () => void gmailApi.openSettings({ pane: "views", viewId: "new" }),
    },
  ];
  const needle = query.trim().toLowerCase();
  const visibleCommands = needle
    ? commands.filter((c) => c.label.toLowerCase().includes(needle))
    : commands;

  const runAndClose = (fn: () => void) => {
    onOpenChange(false);
    fn();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader className="sr-only">
        <DialogTitle variant="large-strong">Command Palette</DialogTitle>
        <DialogDescription>Search mail or run a command</DialogDescription>
      </DialogHeader>
      <DialogContent size="large" className="p-0 overflow-hidden" showCloseButton={false}>
        {/* Bare Command (not CommandDialog): mail results are pre-filtered by the
            FTS query and commands are filtered above, so cmdk's own filtering is off. */}
        <Command
          shouldFilter={false}
          className="**:data-[slot=command-input-wrapper]:h-12 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:text-tertiary [&_[cmdk-group]]:px-2 [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5"
        >
          <CommandInput
            placeholder="Search mail or type a command…"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>
              {debouncedQuery && searchResults.isLoading ? "Searching…" : "No results found."}
            </CommandEmpty>
            {/* Commands lead: a matching command is almost always the intent,
                and cmdk highlights the first item for plain Enter. */}
            {visibleCommands.length > 0 ? (
              <CommandGroup heading="Commands">
                {visibleCommands.map((command) => (
                  <CommandItem
                    key={command.id}
                    value={command.id}
                    onSelect={() => runAndClose(command.run)}
                  >
                    {command.icon}
                    {command.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {mailResults.length > 0 ? (
              <CommandGroup heading="Mail">
                {mailResults.map((message) => {
                  const account = accounts.find((a) => a.id === message.accountId);
                  return (
                    <CommandItem
                      key={`${message.accountId}:${message.id}`}
                      value={`message:${message.accountId}:${message.id}`}
                      onSelect={() => runAndClose(() => onOpenMessage(message))}
                    >
                      <span
                        className="size-2 rounded-full shrink-0"
                        style={account ? { backgroundColor: getAccountColor(account) } : undefined}
                      />
                      <span className="truncate">
                        {message.fromName || message.fromEmail} —{" "}
                        {message.subject || "(no subject)"}
                      </span>
                      <CommandAccessory className="shrink-0 tabular-nums">
                        {formatResultDate(message.date)}
                      </CommandAccessory>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
