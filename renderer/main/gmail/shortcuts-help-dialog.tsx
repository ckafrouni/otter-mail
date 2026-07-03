import { Dialog, Text } from "@glaze/core/components";

const SECTIONS: { title: string; rows: [string, string][] }[] = [
  {
    title: "Navigation",
    rows: [
      ["j / k", "Next / previous conversation"],
      ["u", "Back to list"],
      ["g then i", "Go to Inbox"],
      ["g then t", "Go to Sent"],
      ["g then s", "Go to Starred"],
      ["g then d", "Go to Drafts"],
      ["/", "Search"],
      ["⌘K", "Command palette"],
    ],
  },
  {
    title: "Actions",
    rows: [
      ["c", "Compose"],
      ["e", "Archive"],
      ["#", "Move to trash"],
      ["!", "Move to junk"],
      ["s", "Toggle flag"],
      ["⇧U", "Mark as unread"],
      ["⇧I", "Mark as read"],
      ["r", "Reply"],
      ["a", "Reply all"],
      ["f", "Forward"],
      ["?", "This help"],
    ],
  },
];

export function ShortcutsHelpDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Keyboard Shortcuts" confirmLabel="Done">
      <div className="grid grid-cols-2 gap-6">
        {SECTIONS.map((section) => (
          <div key={section.title} className="flex flex-col gap-1.5">
            <Text variant="small-strong">{section.title}</Text>
            {section.rows.map(([keys, label]) => (
              <div key={keys} className="flex items-center justify-between gap-3">
                <Text variant="small" color="secondary">
                  {label}
                </Text>
                <span className="shrink-0 rounded-control bg-control px-1.5 py-0.5 text-mini font-medium tabular-nums">
                  {keys}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </Dialog>
  );
}
