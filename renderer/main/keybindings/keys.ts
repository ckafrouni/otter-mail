/**
 * Keybinding grammar (ported from Otter Code's shared/keybindings + web
 * keybindings): key strings, `when` expressions, event matching, and labels.
 *
 * Key string: `mod+shift+k` — `+`-joined modifiers then exactly one key.
 * Modifiers: `mod` (⌘ on macOS, Ctrl elsewhere), `cmd`/`meta`, `ctrl`/`control`,
 * `alt`/`option`, `shift`. Keys: a character (`k`, `#`, `/`, `[`), or a name
 * (`enter`, `escape`/`esc`, `space`, `tab`, `backspace`, `delete`,
 * `arrowup`…, `home`, `end`, `pageup`, `pagedown`, `f1`…).
 *
 * Mail additions: a space-separated two-stroke sequence (`g i`, Gmail's
 * go-to combos), and symbol keys that need Shift to type (`#`, `!`, `?`) match
 * whether or not Shift is held unless the binding names `shift` explicitly.
 */

export type KeyStroke = {
  key: string;
  modKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};

/** One stroke, or a two-stroke sequence (`g i`). */
export type Shortcut = KeyStroke[];

export const isMacPlatform =
  typeof navigator === "undefined" || /mac|iphone|ipad|ipod/i.test(navigator.platform);

const KEY_ALIASES: Record<string, string> = {
  space: " ",
  esc: "escape",
  return: "enter",
  del: "delete",
  up: "arrowup",
  down: "arrowdown",
  left: "arrowleft",
  right: "arrowright",
};

export function parseStroke(value: string): KeyStroke | null {
  const raw = value.trim().toLowerCase();
  if (!raw) return null;
  // The plus key itself: "+" alone or a trailing "++" ("mod++").
  let body = raw;
  let plusKey = false;
  if (raw === "+") {
    body = "";
    plusKey = true;
  } else if (raw.endsWith("++")) {
    body = raw.slice(0, -2);
    plusKey = true;
  }
  const tokens = body ? body.split("+") : [];
  if (tokens.some((t) => t === "")) return null;
  if (plusKey) tokens.push("+");
  const stroke: KeyStroke = {
    key: "",
    modKey: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
  };
  for (const token of tokens) {
    if (token === "mod") stroke.modKey = true;
    else if (token === "cmd" || token === "meta" || token === "command") stroke.metaKey = true;
    else if (token === "ctrl" || token === "control") stroke.ctrlKey = true;
    else if (token === "alt" || token === "option" || token === "opt") stroke.altKey = true;
    else if (token === "shift") stroke.shiftKey = true;
    else {
      if (stroke.key) return null; // exactly one key
      stroke.key = KEY_ALIASES[token] ?? token;
    }
  }
  return stroke.key ? stroke : null;
}

export function parseShortcut(value: string): Shortcut | null {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0 || parts.length > 2) return null;
  const strokes = parts.map(parseStroke);
  if (strokes.some((s) => s === null)) return null;
  return strokes as KeyStroke[];
}

function encodeStroke(s: KeyStroke): string {
  const parts: string[] = [];
  if (s.modKey) parts.push("mod");
  if (s.metaKey) parts.push("meta");
  if (s.ctrlKey) parts.push("ctrl");
  if (s.altKey) parts.push("alt");
  if (s.shiftKey) parts.push("shift");
  parts.push(s.key === " " ? "space" : s.key);
  return parts.join("+");
}

/** Canonical key string, so equivalent spellings compare equal. */
export function normalizeKey(value: string): string {
  const shortcut = parseShortcut(value);
  return shortcut ? shortcut.map(encodeStroke).join(" ") : value.trim().toLowerCase();
}

// ── Matching ─────────────────────────────────────────────────────────────────

/** Physical keys, for layouts/Option combos where `event.key` isn't the label. */
function codeKey(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  const map: Record<string, string> = {
    BracketLeft: "[",
    BracketRight: "]",
    Minus: "-",
    Equal: "=",
    Comma: ",",
    Period: ".",
    Slash: "/",
    Backslash: "\\",
    Semicolon: ";",
    Quote: "'",
    Backquote: "`",
  };
  return map[code] ?? null;
}

function eventKeys(event: KeyboardEvent): string[] {
  const keys = [event.key.toLowerCase()];
  const physical = codeKey(event.code);
  // Option on macOS turns letters/digits into symbols (⌥G → ©), and non-Latin
  // layouts produce other scripts: fall back to the physical key then.
  if (physical && !keys.includes(physical) && !/^[a-z]$/.test(keys[0])) keys.push(physical);
  return keys;
}

const isSymbolKey = (key: string) => key.length === 1 && !/[a-z0-9 ]/.test(key);

export function matchesStroke(event: KeyboardEvent, stroke: KeyStroke): boolean {
  const expectedMeta = stroke.metaKey || (stroke.modKey && isMacPlatform);
  const expectedCtrl = stroke.ctrlKey || (stroke.modKey && !isMacPlatform);
  if (event.metaKey !== expectedMeta || event.ctrlKey !== expectedCtrl) return false;
  if (event.altKey !== stroke.altKey) return false;
  // "#", "!", "?" need Shift to type; don't make users spell it out.
  if (!(isSymbolKey(stroke.key) && !stroke.shiftKey) && event.shiftKey !== stroke.shiftKey)
    return false;
  return eventKeys(event).includes(stroke.key);
}

export const isModifierOnly = (event: KeyboardEvent) =>
  event.key === "Shift" ||
  event.key === "Meta" ||
  event.key === "Control" ||
  event.key === "Alt" ||
  event.key === "CapsLock" ||
  event.key === "Fn";

// ── Recording ────────────────────────────────────────────────────────────────

const NAMED_KEYS = new Set([
  "enter",
  "escape",
  "tab",
  "backspace",
  "delete",
  "arrowup",
  "arrowdown",
  "arrowleft",
  "arrowright",
  "home",
  "end",
  "pageup",
  "pagedown",
]);

/** The key string for a pressed stroke (for the recorder), or null if unusable. */
export function strokeFromEvent(event: KeyboardEvent): string | null {
  if (isModifierOnly(event)) return null;
  let key = event.key.toLowerCase();
  if (key === "dead" || key === "unidentified") key = codeKey(event.code) ?? "";
  // Option-modified letters/digits type symbols; record the physical key.
  if (event.altKey && !/^[a-z0-9]$/.test(key)) key = codeKey(event.code) ?? key;
  if (key === " ") key = "space";
  const allowed =
    key.length === 1 || key === "space" || NAMED_KEYS.has(key) || /^f\d{1,2}$/.test(key);
  if (!allowed) return null;
  const parts: string[] = [];
  if (event.metaKey) parts.push(isMacPlatform ? "mod" : "meta");
  if (event.ctrlKey) parts.push(isMacPlatform ? "ctrl" : "mod");
  if (event.altKey) parts.push("alt");
  // Shift is implied by symbols it types ("#", "?"); keep it for letters/named keys.
  if (event.shiftKey && !isSymbolKey(key)) parts.push("shift");
  parts.push(key);
  return parts.join("+");
}

export const strokeHasModifier = (key: string) =>
  /(^|\+)(mod|meta|ctrl|alt)\+/.test(key.toLowerCase());

// ── Labels ───────────────────────────────────────────────────────────────────

function keyLabel(key: string): string {
  const named: Record<string, string> = {
    " ": "Space",
    escape: "Esc",
    enter: "↩",
    tab: "⇥",
    backspace: "⌫",
    delete: "⌦",
    arrowup: "↑",
    arrowdown: "↓",
    arrowleft: "←",
    arrowright: "→",
    home: "Home",
    end: "End",
    pageup: "PgUp",
    pagedown: "PgDn",
  };
  if (named[key]) return named[key];
  if (key.length === 1) return key.toUpperCase();
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/** One chip per modifier then the key, in macOS order (⌃ ⌥ ⇧ ⌘ K). */
export function strokeTokens(stroke: KeyStroke): string[] {
  const meta = stroke.metaKey || (stroke.modKey && isMacPlatform);
  const ctrl = stroke.ctrlKey || (stroke.modKey && !isMacPlatform);
  const tokens: string[] = [];
  if (isMacPlatform) {
    if (ctrl) tokens.push("⌃");
    if (stroke.altKey) tokens.push("⌥");
    if (stroke.shiftKey) tokens.push("⇧");
    if (meta) tokens.push("⌘");
  } else {
    if (ctrl) tokens.push("Ctrl");
    if (stroke.altKey) tokens.push("Alt");
    if (stroke.shiftKey) tokens.push("Shift");
    if (meta) tokens.push("Meta");
  }
  tokens.push(keyLabel(stroke.key));
  return tokens;
}

/** Compact label for tooltips/menus/palette: `⇧⌘K`, `G then I`. */
export function formatShortcut(shortcut: Shortcut): string {
  return shortcut.map((s) => strokeTokens(s).join(isMacPlatform ? "" : "+")).join(" then ");
}

// ── `when` expressions ───────────────────────────────────────────────────────

export type WhenNode =
  | { type: "identifier"; name: string }
  | { type: "not"; node: WhenNode }
  | { type: "and"; left: WhenNode; right: WhenNode }
  | { type: "or"; left: WhenNode; right: WhenNode };

type Token = { type: "id"; value: string } | { type: "op"; value: "!" | "&&" | "||" | "(" | ")" };

function tokenize(expr: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expr.length) {
    const c = expr[i];
    if (/\s/.test(c)) {
      i++;
    } else if (c === "!" || c === "(" || c === ")") {
      tokens.push({ type: "op", value: c });
      i++;
    } else if (expr.startsWith("&&", i) || expr.startsWith("||", i)) {
      tokens.push({ type: "op", value: expr.slice(i, i + 2) as "&&" | "||" });
      i += 2;
    } else {
      const m = /^[A-Za-z_][A-Za-z0-9_.-]*/.exec(expr.slice(i));
      if (!m) return null;
      tokens.push({ type: "id", value: m[0] });
      i += m[0].length;
    }
  }
  return tokens;
}

/** Recursive descent: `!` > `&&` > `||`, left-associative, parentheses. */
export function parseWhen(expr: string): WhenNode | null {
  const tokens = tokenize(expr);
  if (!tokens || tokens.length === 0) return null;
  let pos = 0;
  let depth = 0;
  const peek = () => tokens[pos];
  const isOp = (v: string) => peek()?.type === "op" && peek()?.value === v;

  const parsePrimary = (): WhenNode | null => {
    const t = peek();
    if (!t) return null;
    if (t.type === "id") {
      pos++;
      return { type: "identifier", name: t.value };
    }
    if (t.value === "(") {
      if (++depth > 64) return null;
      pos++;
      const node = parseOr();
      if (!node || !isOp(")")) return null;
      pos++;
      depth--;
      return node;
    }
    return null;
  };
  const parseUnary = (): WhenNode | null => {
    if (isOp("!")) {
      pos++;
      const node = parseUnary();
      return node ? { type: "not", node } : null;
    }
    return parsePrimary();
  };
  const parseAnd = (): WhenNode | null => {
    let left = parseUnary();
    while (left && isOp("&&")) {
      pos++;
      const right = parseUnary();
      if (!right) return null;
      left = { type: "and", left, right };
    }
    return left;
  };
  function parseOr(): WhenNode | null {
    let left = parseAnd();
    while (left && isOp("||")) {
      pos++;
      const right = parseAnd();
      if (!right) return null;
      left = { type: "or", left, right };
    }
    return left;
  }
  const ast = parseOr();
  return ast && pos === tokens.length ? ast : null;
}

export type WhenContext = Record<string, boolean | undefined>;

export function evaluateWhen(node: WhenNode | undefined, context: WhenContext): boolean {
  if (!node) return true;
  switch (node.type) {
    case "identifier":
      if (node.name === "true") return true;
      if (node.name === "false") return false;
      return Boolean(context[node.name]);
    case "not":
      return !evaluateWhen(node.node, context);
    case "and":
      return evaluateWhen(node.left, context) && evaluateWhen(node.right, context);
    case "or":
      return evaluateWhen(node.left, context) || evaluateWhen(node.right, context);
  }
}

export function whenIdentifiers(node: WhenNode | undefined, out = new Set<string>()): Set<string> {
  if (!node) return out;
  if (node.type === "identifier") out.add(node.name);
  else if (node.type === "not") whenIdentifiers(node.node, out);
  else {
    whenIdentifiers(node.left, out);
    whenIdentifiers(node.right, out);
  }
  return out;
}

/** Canonical text for an expression (for comparing `when` clauses). */
export function whenToString(node: WhenNode | undefined): string {
  if (!node) return "";
  const wrap = (child: WhenNode, parent: "and" | "or") =>
    (child.type === "and" || child.type === "or") && child.type !== parent
      ? `(${whenToString(child)})`
      : whenToString(child);
  switch (node.type) {
    case "identifier":
      return node.name;
    case "not":
      return node.node.type === "identifier" || node.node.type === "not"
        ? `!${whenToString(node.node)}`
        : `!(${whenToString(node.node)})`;
    case "and":
      return `${wrap(node.left, "and")} && ${wrap(node.right, "and")}`;
    case "or":
      return `${wrap(node.left, "or")} || ${wrap(node.right, "or")}`;
  }
}

export function normalizeWhen(expr: string | undefined): string {
  if (!expr?.trim()) return "";
  const ast = parseWhen(expr);
  return ast ? whenToString(ast) : expr.trim();
}
