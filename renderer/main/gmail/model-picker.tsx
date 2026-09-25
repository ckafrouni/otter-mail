/**
 * The chat composer's model controls, ported from T3 Code:
 *  - ProviderModelPicker: trigger (provider icon + model, ⇧⌘M) opening a
 *    popover with the provider rail (favorites + one button per provider),
 *    model search, and model rows (⌘1…⌘9 jumps, favorite stars).
 *  - TraitsPicker: the model's options (Codex: Reasoning, Service Tier) as a
 *    radio menu, with the fast-tier bolt on the trigger.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Popover } from "radix-ui";
import {
  ChevronDownIcon,
  LockIcon,
  LockOpenIcon,
  PenLineIcon,
  SearchIcon,
  StarIcon,
  ZapIcon,
} from "lucide-react";
import type {
  ProviderKind,
  ProviderModel,
  ProviderModelOption,
  ProviderSnapshot,
  RuntimeMode,
} from "./api";
import { ProviderIcon, isProviderUsable } from "./assistant-providers";
import { modelKey, toggleFavorite, useModelPrefs } from "./model-prefs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./menu";
import { HintTooltip, Kbd, cn, restoreFocusForKeyboardOnly } from "./ui";
import { MODEL_PICKER_JUMP_COMMANDS } from "../keybindings/commands";
import { matchesCommand, useCommandHandlers, useKeybindingContext } from "../keybindings/dispatch";
import { shortcutLabelFor, useKeybindingsState } from "../keybindings/store";

// ---------------------------------------------------------------------------
// Composer control look (T3's ComposerControl, size "sm")
// ---------------------------------------------------------------------------

export const COMPOSER_CONTROL =
  "relative inline-flex shrink-0 cursor-pointer items-center justify-center whitespace-nowrap rounded-(--control-radius) border border-transparent outline-none hover:bg-accent-surface data-[state=open]:bg-accent-surface focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-1 focus-visible:ring-offset-canvas disabled:pointer-events-none disabled:opacity-64 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:-mx-0.5 [&_svg[data-composer-control-icon]]:mx-0 h-7 gap-1.5 px-2.5 text-sm font-medium text-secondary-label [&_svg:not([class*='text-'])]:text-muted-foreground hover:text-foreground [&_svg:not([class*='size-'])]:size-4";

export function ComposerControlChevron() {
  return (
    <ChevronDownIcon
      aria-hidden
      className="size-3.5 shrink-0 text-icon-muted"
      data-composer-control-chevron
      strokeWidth={2.25}
    />
  );
}

/** Composer menus hand focus back to the composer, so typing just continues. */
function closeFocus(event: Event, returnFocus?: () => void): void {
  if (!returnFocus) return restoreFocusForKeyboardOnly(event);
  event.preventDefault();
  returnFocus();
}

export function ComposerControlSeparator() {
  return <span className="mx-0.5 h-4 w-px shrink-0 bg-border" aria-hidden />;
}

// ---------------------------------------------------------------------------
// Search (tokenized; every token must hit name, slug, or provider)
// ---------------------------------------------------------------------------

type PickerItem = {
  key: string;
  kind: ProviderKind;
  slug: string;
  name: string;
  providerName: string;
};

function searchScore(item: PickerItem, query: string, favorite: boolean): number | null {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 0;
  const fields = [item.name, item.slug, item.kind, item.providerName].map((f) => f.toLowerCase());
  let score = 0;
  for (const token of tokens) {
    let best: number | null = null;
    fields.forEach((field, i) => {
      const at = field.indexOf(token);
      if (at === -1) return;
      const s =
        i * 10 +
        (field === token ? 0 : at === 0 ? 2 : /[\s\-_.]/.test(field[at - 1] ?? "") ? 4 : 6);
      best = best === null ? s : Math.min(best, s);
    });
    if (best === null) return null;
    score += best;
  }
  return favorite ? score - 24 : score;
}

// ---------------------------------------------------------------------------
// Provider rail (T3's ModelPickerSidebar)
// ---------------------------------------------------------------------------

const RAIL_BUTTON =
  "relative isolate flex aspect-square w-full cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-[color-mix(in_srgb,var(--popover)_90%,var(--contrast-foreground))] focus-visible:bg-foreground/10 focus-visible:outline-none";

function describeProvider(p: ProviderSnapshot): string {
  if (isProviderUsable(p)) return p.displayName;
  const kind =
    p.status === "error" ? "Unavailable" : p.status === "warning" ? "Limited" : "Not ready";
  return p.message ? `${p.displayName} — ${kind}. ${p.message}` : `${p.displayName} — ${kind}.`;
}

function ModelPickerRail({
  providers,
  selected,
  lockedKind,
  onSelect,
}: {
  providers: ProviderSnapshot[];
  selected: ProviderKind | "favorites";
  lockedKind: ProviderKind | null;
  onSelect: (value: ProviderKind | "favorites") => void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [indicatorTop, setIndicatorTop] = useState<number | null>(null);
  useLayoutEffect(() => {
    const item = contentRef.current?.querySelector<HTMLElement>(
      `[data-model-picker-provider="${selected}"]`,
    );
    setIndicatorTop(item ? item.offsetTop + item.offsetHeight / 2 - 10 : null);
  }, [providers, selected]);

  return (
    <div
      className="w-11 shrink-0 overflow-hidden bg-muted/30"
      data-model-picker-sidebar
      aria-label="Providers"
    >
      <div className="h-full overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div ref={contentRef} className="relative flex min-h-full flex-col gap-1 p-1">
          {indicatorTop !== null ? (
            <div
              className="pointer-events-none absolute right-0 z-10 h-5 w-0.75 rounded-l-full bg-primary transition-[top] duration-200 ease-out"
              style={{ top: indicatorTop }}
            />
          ) : null}
          <div className="relative w-full" data-model-picker-provider="favorites">
            <HintTooltip label="Favorites">
              <button
                type="button"
                className={RAIL_BUTTON}
                onClick={() => onSelect("favorites")}
                aria-label="Favorites"
                aria-pressed={selected === "favorites"}
              >
                <StarIcon className="size-5 shrink-0 fill-current" aria-hidden />
              </button>
            </HintTooltip>
          </div>
          <div className="border-b border-border/70" aria-hidden />
          {providers.map((p) => {
            const locked = lockedKind !== null && lockedKind !== p.kind;
            const disabled = !isProviderUsable(p) || locked;
            const tooltip = locked
              ? `${p.displayName} is unavailable in this chat. Start a new chat to switch providers.`
              : describeProvider(p);
            return (
              <div key={p.kind} className="relative w-full" data-model-picker-provider={p.kind}>
                <HintTooltip label={tooltip}>
                  <button
                    type="button"
                    className={cn(
                      RAIL_BUTTON,
                      disabled && "cursor-not-allowed opacity-50 hover:bg-transparent",
                    )}
                    onClick={() => !disabled && onSelect(p.kind)}
                    aria-disabled={disabled}
                    aria-pressed={selected === p.kind}
                    aria-label={tooltip}
                  >
                    <ProviderIcon kind={p.kind} className="size-5" />
                  </button>
                </HintTooltip>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Model row (T3's ModelListRow)
// ---------------------------------------------------------------------------

function ModelListRow({
  item,
  highlighted,
  selected,
  favorite,
  jumpLabel,
  onHover,
  onPick,
  onToggleFavorite,
}: {
  item: PickerItem;
  highlighted: boolean;
  selected: boolean;
  favorite: boolean;
  jumpLabel: string | null;
  onHover: () => void;
  onPick: () => void;
  onToggleFavorite: () => void;
}) {
  return (
    <div
      role="option"
      aria-selected={selected}
      data-highlighted={highlighted || undefined}
      onMouseMove={onHover}
      onClick={onPick}
      className={cn(
        "group relative flex min-h-7 w-full min-w-0 cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-sm outline-none",
        selected && "bg-foreground/[0.08] text-foreground",
        highlighted && "bg-accent-surface text-foreground",
      )}
    >
      <div className="min-w-0 flex-1 text-left">
        <div className="min-w-0 truncate text-xs font-medium leading-snug">{item.name}</div>
        <div className="mt-1 flex items-center gap-1.5">
          <ProviderIcon kind={item.kind} className="size-3 shrink-0" />
          <span className="truncate text-xs font-normal leading-snug text-muted-foreground/70">
            {item.providerName}
          </span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {jumpLabel ? <Kbd>{jumpLabel}</Kbd> : null}
        <button
          type="button"
          className="-mr-1 inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-(--control-radius) text-muted-foreground hover:bg-accent-surface hover:text-foreground"
          onClick={(event) => {
            event.stopPropagation();
            onToggleFavorite();
          }}
          aria-label={favorite ? "Remove from favorites" : "Add to favorites"}
          title={favorite ? "Remove from favorites" : "Add to favorites"}
        >
          <StarIcon className={cn("size-3", favorite && "fill-current text-yellow-500")} />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Popover content (T3's ModelPickerContent)
// ---------------------------------------------------------------------------

function ModelPickerContent({
  providers,
  activeKind,
  lockedKind,
  onPick,
  onClose,
}: {
  providers: ProviderSnapshot[];
  activeKind: ProviderKind;
  lockedKind: ProviderKind | null;
  onPick: (kind: ProviderKind, slug: string) => void;
  onClose: () => void;
}) {
  useKeybindingContext("modelPickerOpen", true);
  const { resolved } = useKeybindingsState();
  const { favorites, hidden } = useModelPrefs();
  const hiddenSet = useMemo(() => new Set(hidden), [hidden]);
  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);
  const [query, setQuery] = useState("");
  const [rail, setRail] = useState<ProviderKind | "favorites">(() =>
    lockedKind === null && favorites.length > 0 ? "favorites" : activeKind,
  );
  const [highlight, setHighlight] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const active = providers.find((p) => p.kind === activeKind);
  const activeKey = active?.model ? modelKey(activeKind, active.model) : null;
  const railProviders = providers.filter((p) => p.enabled);

  const allItems = useMemo(
    () =>
      railProviders
        .filter((p) => isProviderUsable(p))
        .flatMap((p) =>
          p.models
            // Hidden in Settings → Models, unless it's the model in use.
            .filter(
              (m) =>
                !hiddenSet.has(modelKey(p.kind, m.slug)) ||
                (p.kind === activeKind && m.slug === p.model),
            )
            .map((m: ProviderModel) => ({
              key: modelKey(p.kind, m.slug),
              kind: p.kind,
              slug: m.slug,
              name: m.name,
              providerName: m.subProvider ? `${p.displayName} · ${m.subProvider}` : p.displayName,
            })),
        ),
    [railProviders, hiddenSet, activeKind],
  );

  const items = useMemo(() => {
    const allowed = allItems.filter((i) => lockedKind === null || i.kind === lockedKind);
    if (query.trim()) {
      return allowed
        .map((item) => ({
          item,
          score: searchScore(item, query, favoriteSet.has(item.key)),
        }))
        .filter((r): r is { item: PickerItem; score: number } => r.score !== null)
        .sort((a, b) => a.score - b.score || a.item.name.localeCompare(b.item.name))
        .map((r) => r.item);
    }
    const inRail =
      rail === "favorites"
        ? allowed.filter((i) => favoriteSet.has(i.key))
        : allowed.filter((i) => i.kind === rail);
    // Favorites float to the top of a provider's list.
    return rail === "favorites"
      ? inRail
      : [
          ...inRail.filter((i) => favoriteSet.has(i.key)),
          ...inRail.filter((i) => !favoriteSet.has(i.key)),
        ];
  }, [allItems, favoriteSet, lockedKind, query, rail]);

  // Highlight the active model when it's in view, else the first row.
  useLayoutEffect(() => {
    const index = items.findIndex((i) => i.key === activeKey);
    setHighlight(index >= 0 ? index : 0);
  }, [items, activeKey]);
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>("[data-highlighted]")
      ?.scrollIntoView({ block: "nearest" });
  }, [highlight]);
  useLayoutEffect(() => {
    searchRef.current?.focus({ preventScroll: true });
  }, [rail]);

  const pick = (item: PickerItem | undefined) => {
    if (item) onPick(item.kind, item.slug);
  };
  const switchRail = (direction: 1 | -1) => {
    const order: Array<ProviderKind | "favorites"> = [
      "favorites",
      ...railProviders
        .filter((p) => isProviderUsable(p) && (lockedKind === null || p.kind === lockedKind))
        .map((p) => p.kind),
    ];
    const index = order.indexOf(rail);
    setQuery("");
    setRail(order[(index + direction + order.length) % order.length]);
  };

  const showRail = !query.trim() && railProviders.length > 0;
  return (
    <div
      className="relative flex h-screen max-h-86.5 w-screen max-w-90 flex-row overflow-hidden"
      data-model-picker-content
    >
      {showRail ? (
        <ModelPickerRail
          providers={railProviders}
          selected={rail}
          lockedKind={lockedKind}
          onSelect={(value) => {
            setRail(value);
            searchRef.current?.focus({ preventScroll: true });
          }}
        />
      ) : null}
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col overflow-hidden bg-muted/40",
          showRail && "border-l border-border/70",
        )}
      >
        <div className="min-w-0 shrink-0 px-3 pt-2.5">
          <div className="relative -translate-y-px border-b border-border/70 pb-1.5 transition-colors focus-within:border-focus-ring">
            <SearchIcon
              aria-hidden
              className="pointer-events-none absolute left-0 top-1.5 size-4 shrink-0 text-muted-foreground/55"
            />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search models..."
              aria-label="Search models"
              className="h-6.5 w-full bg-transparent ps-5 font-sans text-sm leading-6.5 text-foreground outline-none placeholder:text-muted-foreground/70"
              onKeyDown={(e) => {
                const native = e.nativeEvent;
                const jump = MODEL_PICKER_JUMP_COMMANDS.findIndex((c) => matchesCommand(native, c));
                if (jump >= 0) {
                  e.preventDefault();
                  e.stopPropagation();
                  pick(items[jump]);
                  return;
                }
                if (
                  matchesCommand(native, "modelPicker.nextProvider") ||
                  matchesCommand(native, "modelPicker.previousProvider")
                ) {
                  e.preventDefault();
                  e.stopPropagation();
                  switchRail(matchesCommand(native, "modelPicker.nextProvider") ? 1 : -1);
                  return;
                }
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  const delta = e.key === "ArrowDown" ? 1 : -1;
                  setHighlight((h) =>
                    items.length ? (h + delta + items.length) % items.length : 0,
                  );
                  return;
                }
                if (e.key === "Enter") {
                  e.preventDefault();
                  pick(items[highlight]);
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  onClose();
                  return;
                }
                e.stopPropagation();
              }}
            />
          </div>
        </div>
        <div
          ref={listRef}
          role="listbox"
          className="relative min-h-0 flex-1 overflow-y-auto overscroll-y-contain py-1.5 pl-2 pr-px"
        >
          <div className="flex flex-col gap-0.5">
            {items.map((item, index) => (
              <ModelListRow
                key={item.key}
                item={item}
                highlighted={index === highlight}
                selected={item.key === activeKey}
                favorite={favoriteSet.has(item.key)}
                jumpLabel={
                  index < MODEL_PICKER_JUMP_COMMANDS.length
                    ? shortcutLabelFor(resolved, MODEL_PICKER_JUMP_COMMANDS[index])
                    : null
                }
                onHover={() => setHighlight(index)}
                onPick={() => pick(item)}
                onToggleFavorite={() => toggleFavorite(item.key)}
              />
            ))}
          </div>
          {items.length === 0 ? (
            <div className="p-2 text-center text-sm text-muted-foreground">
              {rail === "favorites" && !query.trim() ? "No favorite models yet" : "No models found"}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trigger + popover (T3's ProviderModelPicker)
// ---------------------------------------------------------------------------

export function ProviderModelPicker({
  providers,
  activeKind,
  lockedKind,
  onPick,
  returnFocus,
}: {
  providers: ProviderSnapshot[];
  activeKind: ProviderKind;
  /** A chat with turns stays on its provider. */
  lockedKind: ProviderKind | null;
  onPick: (kind: ProviderKind, slug: string) => void;
  /** Where focus goes when the popover closes (the composer). */
  returnFocus?: () => void;
}) {
  const [open, setOpen] = useState(false);
  useCommandHandlers({ "modelPicker.toggle": () => setOpen((o) => !o) });
  const active = providers.find((p) => p.kind === activeKind);
  const model = active?.models.find((m) => m.slug === active.model);
  const label = model?.name ?? active?.model ?? active?.displayName ?? "Choose model";

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <HintTooltip label={label} shortcut="modelPicker.toggle">
        <Popover.Trigger asChild>
          <button
            type="button"
            aria-label={label}
            data-chat-provider-model-picker
            className={cn(COMPOSER_CONTROL, "min-w-0 max-w-48 shrink justify-between sm:max-w-56")}
          >
            <span className="flex min-w-0 flex-1 items-center gap-1.5">
              <ProviderIcon kind={activeKind} className="size-4" />
              <span className="min-w-0 flex-1 truncate">{label}</span>
            </span>
            <span aria-hidden className="flex items-center">
              <ComposerControlChevron />
            </span>
          </button>
        </Popover.Trigger>
      </HintTooltip>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={4}
          collisionPadding={8}
          onCloseAutoFocus={(event) => closeFocus(event, returnFocus)}
          className="dropdown-glass z-[130] overflow-hidden rounded-lg text-foreground shadow-[0_16px_40px_-18px_rgb(0_0_0/55%)] outline-none dark:shadow-[0_18px_44px_-18px_rgb(0_0_0/80%)]"
        >
          <ModelPickerContent
            providers={providers}
            activeKind={activeKind}
            lockedKind={lockedKind}
            onClose={() => setOpen(false)}
            onPick={(kind, slug) => {
              onPick(kind, slug);
              setOpen(false);
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ---------------------------------------------------------------------------
// Traits (T3's TraitsPicker): Reasoning / Service Tier
// ---------------------------------------------------------------------------

function DefaultBadge() {
  return (
    <span className="ms-1 inline-flex h-4.5 items-center rounded-sm border border-border px-1 align-middle text-2xs font-medium text-foreground/80">
      Default
    </span>
  );
}

/** The value in effect for an option: the chosen one when valid, else the model default. */
export function currentChoice(option: ProviderModelOption, chosen: string): string | undefined {
  return (
    option.choices.find((c) => c.id === chosen)?.id ?? option.choices.find((c) => c.isDefault)?.id
  );
}

export function TraitsPicker({
  options,
  values,
  onChange,
  returnFocus,
}: {
  options: ProviderModelOption[];
  values: Partial<Record<ProviderModelOption["id"], string>>;
  onChange: (id: ProviderModelOption["id"], value: string) => void;
  returnFocus?: () => void;
}) {
  if (options.length === 0) return null;
  // Like T3: the Fast service tier is a bolt, not text; efforts are the label.
  const labels: string[] = [];
  let fast = false;
  for (const option of options) {
    const value = currentChoice(option, values[option.id] ?? "");
    const choice = option.choices.find((c) => c.id === value);
    if (option.id === "serviceTier") {
      fast = choice?.label === "Fast";
      continue;
    }
    if (choice) labels.push(choice.label);
  }
  const label = labels.join(" · ") || (fast ? "Fast" : "Standard");
  const accessible = fast ? `${label}, Fast mode on` : label;

  return (
    <DropdownMenu>
      <HintTooltip label={accessible}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={accessible}
            className={cn(
              COMPOSER_CONTROL,
              "min-w-0 max-w-40 shrink justify-start overflow-hidden sm:max-w-48",
            )}
          >
            <span className="flex w-full min-w-0 items-center gap-1.5">
              {fast ? (
                <ZapIcon
                  aria-hidden
                  data-composer-control-icon
                  className="size-4 shrink-0 fill-current text-foreground opacity-80"
                />
              ) : null}
              <span className="min-w-0 truncate">{label}</span>
              <ComposerControlChevron />
            </span>
          </button>
        </DropdownMenuTrigger>
      </HintTooltip>
      <DropdownMenuContent
        align="start"
        side="bottom"
        className="min-w-44"
        onCloseAutoFocus={(event) => closeFocus(event, returnFocus)}
      >
        {options.map((option, index) => {
          const selected = currentChoice(option, values[option.id] ?? "");
          return (
            <div key={option.id}>
              {index > 0 ? <DropdownMenuSeparator /> : null}
              <div className="px-2 pb-1 pt-1.5 text-xs font-medium text-muted-foreground">
                {option.label}
              </div>
              {option.choices.map((choice) => (
                <DropdownMenuItem
                  key={choice.id}
                  onSelect={() => onChange(option.id, choice.id)}
                  className={cn(choice.id === selected && "bg-foreground/[0.08] text-foreground")}
                >
                  <span className="flex w-full min-w-0 flex-col">
                    <span className="min-w-0 truncate">
                      {choice.label}
                      {choice.isDefault ? <DefaultBadge /> : null}
                    </span>
                    {choice.description ? (
                      <span className="max-w-56 text-pretty text-xs text-muted-foreground/80">
                        {choice.description}
                      </span>
                    ) : null}
                  </span>
                </DropdownMenuItem>
              ))}
            </div>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---------------------------------------------------------------------------
// Runtime mode (T3's runtimeModeConfig + ComposerFooterModeControls)
// ---------------------------------------------------------------------------

export const RUNTIME_MODE_OPTIONS: {
  value: RuntimeMode;
  label: string;
  description: string;
  icon: typeof LockIcon;
}[] = [
  {
    value: "approval-required",
    label: "Supervised",
    description: "Ask before commands and file changes.",
    icon: LockIcon,
  },
  {
    value: "auto-accept-edits",
    label: "Auto-accept edits",
    description: "Auto-approve edits, ask before other actions.",
    icon: PenLineIcon,
  },
  {
    value: "full-access",
    label: "Full access",
    description: "Allow commands and edits without prompts.",
    icon: LockOpenIcon,
  },
];

export function RuntimeModePicker({
  value,
  onChange,
  returnFocus,
}: {
  value: RuntimeMode;
  onChange: (mode: RuntimeMode) => void;
  returnFocus?: () => void;
}) {
  const [open, setOpen] = useState(false);
  useCommandHandlers({ "composer.mode": () => setOpen((o) => !o) });
  const current = RUNTIME_MODE_OPTIONS.find((o) => o.value === value) ?? RUNTIME_MODE_OPTIONS[2];
  const Icon = current.icon;
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <HintTooltip label={current.description} shortcut="composer.mode">
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Runtime mode"
            className={cn(COMPOSER_CONTROL, "shrink-0")}
          >
            <Icon aria-hidden data-composer-control-icon className="size-4 shrink-0" />
            <span>{current.label}</span>
            <ComposerControlChevron />
          </button>
        </DropdownMenuTrigger>
      </HintTooltip>
      <DropdownMenuContent
        align="start"
        side="bottom"
        onCloseAutoFocus={(event) => closeFocus(event, returnFocus)}
      >
        {RUNTIME_MODE_OPTIONS.map((option) => {
          const OptionIcon = option.icon;
          return (
            <DropdownMenuItem
              key={option.value}
              onSelect={() => onChange(option.value)}
              className={cn(
                "min-w-64",
                option.value === value && "bg-foreground/[0.08] text-foreground",
              )}
            >
              <div className="grid min-w-0 flex-1 gap-0.5">
                <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                  <OptionIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  {option.label}
                </span>
                <span className="text-xs leading-4 text-muted-foreground">
                  {option.description}
                </span>
              </div>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
