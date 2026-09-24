import { forwardRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useDebouncedValue, useSuggestContacts } from "./hooks";
import { splitAddressList, parseAddressEntry, formatAddressEntry } from "./address";
import { SenderAvatar } from "./sender-avatar";

/**
 * Comma-separated recipients input with contact autocomplete (backed by the
 * local mail cache via gmail:suggestContacts). Suggestions target the token
 * after the last comma; ↑/↓ + Enter/Tab accept, Escape dismisses (marked with
 * data-ac-open so composer-level Escape handlers stand down).
 */
export const RecipientInput = forwardRef<
  HTMLInputElement,
  {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    ariaLabel: string;
    className?: string;
  }
>(function RecipientInput({ value, onChange, placeholder, ariaLabel, className }, ref) {
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);

  const lastComma = value.lastIndexOf(",");
  const committed = lastComma >= 0 ? value.slice(0, lastComma + 1) : "";
  const token = value.slice(lastComma + 1).trim();

  const query = useDebouncedValue(token, 120);
  const suggestQuery = useSuggestContacts(query, focused && query.length > 0);

  const existing = new Set(
    splitAddressList(value)
      .map((entry) => parseAddressEntry(entry).email.toLowerCase())
      .filter((email) => email.includes("@")),
  );
  const suggestions = (suggestQuery.data ?? [])
    .filter((s) => !existing.has(s.email.toLowerCase()))
    .slice(0, 6);

  const open = focused && !dismissed && token.length > 0 && suggestions.length > 0;

  const accept = (index: number) => {
    const suggestion = suggestions[index];
    if (!suggestion) return;
    const entry = formatAddressEntry(suggestion.name, suggestion.email);
    onChange(`${committed}${committed ? " " : ""}${entry}, `);
    setActiveIdx(0);
    setDismissed(false);
  };

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    // Modified keys (⌘↩ send) belong to the composer, not the suggestions.
    if (!open || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => (i - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      accept(activeIdx);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setDismissed(true);
    }
  };

  return (
    <span className="relative min-w-0 flex-1" data-ac-open={open ? "true" : "false"}>
      <input
        ref={ref}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setDismissed(false);
          setActiveIdx(0);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        aria-label={ariaLabel}
        autoComplete="off"
        spellCheck={false}
        className={
          className ??
          "w-full min-w-0 bg-transparent text-sm text-foreground outline-none placeholder:text-placeholder"
        }
      />
      {open ? (
        <div className="dropdown-glass absolute left-0 top-full z-50 mt-1.5 max-h-64 w-full min-w-64 overflow-y-auto rounded-lg p-1 shadow-[0_16px_40px_-18px_rgb(0_0_0/55%)] dark:shadow-[0_18px_44px_-18px_rgb(0_0_0/80%)]">
          {suggestions.map((suggestion, i) => (
            <button
              key={suggestion.email}
              type="button"
              // preventDefault keeps the input focused through the click.
              onMouseDown={(e) => {
                e.preventDefault();
                accept(i);
              }}
              onMouseEnter={() => setActiveIdx(i)}
              className={[
                "flex w-full items-center gap-2.5 px-3 py-1.5 text-left",
                i === activeIdx ? "bg-accent-surface" : "",
              ].join(" ")}
            >
              <SenderAvatar name={suggestion.name} email={suggestion.email} size="sm" />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-semibold text-foreground">
                  {suggestion.name || suggestion.email}
                </span>
                {suggestion.name ? (
                  <span className="truncate text-2xs text-muted-foreground">
                    {suggestion.email}
                  </span>
                ) : null}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </span>
  );
});
