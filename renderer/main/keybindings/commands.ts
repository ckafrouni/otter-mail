/**
 * Every command a keybinding can trigger, and the default bindings (the Otter
 * Code model: a closed set of command ids; titles derive from the id, e.g.
 * `message.markUnread` → "Message: Mark Unread").
 *
 * `when` context keys (see dispatch.ts):
 * - editableFocus: typing in an input, textarea, or rich-text field
 * - dialogOpen:    a dialog, popover, or menu is open
 * - settingsOpen:  the settings page is showing
 * - messageOpen:   a conversation is open in the reader
 */

export const MAILBOX_JUMP_COMMANDS = [
  "mailbox.jump.1",
  "mailbox.jump.2",
  "mailbox.jump.3",
  "mailbox.jump.4",
  "mailbox.jump.5",
  "mailbox.jump.6",
  "mailbox.jump.7",
  "mailbox.jump.8",
  "mailbox.jump.9",
] as const;

export const KEYBINDING_COMMANDS = [
  "commandPalette.toggle",
  "sidebar.toggle",
  "assistant.toggle",
  "search.focus",
  "compose.new",
  "composer.send",
  "keybindings.show",
  "mail.undo",
  "go.inbox",
  "go.sent",
  "go.starred",
  "go.drafts",
  ...MAILBOX_JUMP_COMMANDS,
  "list.next",
  "list.previous",
  "message.close",
  "message.reply",
  "message.replyAll",
  "message.forward",
  "message.archive",
  "message.trash",
  "message.junk",
  "message.star",
  "message.markRead",
  "message.markUnread",
  "message.label",
  "message.move",
] as const;

export type KeybindingCommand = (typeof KEYBINDING_COMMANDS)[number];

export function isKeybindingCommand(value: string): value is KeybindingCommand {
  return (KEYBINDING_COMMANDS as readonly string[]).includes(value);
}

export type KeybindingRule = { key: string; command: KeybindingCommand; when?: string };

/** Context keys offered in the When editor (plus the literals). */
export const WHEN_VARIABLES = [
  "editableFocus",
  "dialogOpen",
  "settingsOpen",
  "messageOpen",
  "true",
  "false",
] as const;

const OUTSIDE_FIELDS = "!editableFocus && !dialogOpen";
const IN_MAIL = "!editableFocus && !dialogOpen && !settingsOpen";
const ON_MESSAGE = `${IN_MAIL} && messageOpen`;

export const DEFAULT_KEYBINDINGS: ReadonlyArray<KeybindingRule> = [
  { key: "mod+k", command: "commandPalette.toggle" },
  // ⌘B / ⌘I mean bold / italic while typing.
  { key: "mod+b", command: "sidebar.toggle", when: OUTSIDE_FIELDS },
  { key: "mod+i", command: "assistant.toggle", when: OUTSIDE_FIELDS },
  { key: "/", command: "search.focus", when: OUTSIDE_FIELDS },
  { key: "mod+f", command: "search.focus", when: "!dialogOpen" },
  { key: "c", command: "compose.new", when: OUTSIDE_FIELDS },
  { key: "mod+enter", command: "composer.send" },
  { key: "?", command: "keybindings.show", when: OUTSIDE_FIELDS },
  { key: "z", command: "mail.undo", when: OUTSIDE_FIELDS },
  { key: "g i", command: "go.inbox", when: IN_MAIL },
  { key: "g t", command: "go.sent", when: IN_MAIL },
  { key: "g s", command: "go.starred", when: IN_MAIL },
  { key: "g d", command: "go.drafts", when: IN_MAIL },
  ...MAILBOX_JUMP_COMMANDS.map(
    (command, i): KeybindingRule => ({ key: `mod+${i + 1}`, command, when: "!dialogOpen" }),
  ),
  { key: "j", command: "list.next", when: IN_MAIL },
  { key: "arrowdown", command: "list.next", when: IN_MAIL },
  { key: "k", command: "list.previous", when: IN_MAIL },
  { key: "arrowup", command: "list.previous", when: IN_MAIL },
  { key: "u", command: "message.close", when: ON_MESSAGE },
  { key: "escape", command: "message.close", when: ON_MESSAGE },
  { key: "r", command: "message.reply", when: ON_MESSAGE },
  { key: "a", command: "message.replyAll", when: ON_MESSAGE },
  { key: "f", command: "message.forward", when: ON_MESSAGE },
  { key: "e", command: "message.archive", when: IN_MAIL },
  { key: "#", command: "message.trash", when: IN_MAIL },
  { key: "backspace", command: "message.trash", when: IN_MAIL },
  { key: "delete", command: "message.trash", when: IN_MAIL },
  { key: "!", command: "message.junk", when: IN_MAIL },
  { key: "s", command: "message.star", when: IN_MAIL },
  { key: "shift+i", command: "message.markRead", when: IN_MAIL },
  { key: "shift+u", command: "message.markUnread", when: IN_MAIL },
  { key: "l", command: "message.label", when: IN_MAIL },
  { key: "v", command: "message.move", when: IN_MAIL },
];

function titleCaseSegment(segment: string): string {
  return segment
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** "message.markUnread" → "Message: Mark Unread". */
export function commandLabel(command: string): string {
  return command.split(".").map(titleCaseSegment).join(": ");
}
