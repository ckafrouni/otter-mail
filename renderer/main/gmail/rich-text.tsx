import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import {
  BoldIcon,
  ItalicIcon,
  UnderlineIcon,
  StrikethroughIcon,
  Link2Icon,
  ListIcon,
  ListOrderedIcon,
  TextQuoteIcon,
  RemoveFormattingIcon,
} from "lucide-react";

export type RichTextRef = {
  getHTML: () => string;
  getText: () => string;
  clear: () => void;
  focus: () => void;
};

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Plain text → simple HTML (escaped, newlines as <br>). */
export function textToHtml(value: string): string {
  return escapeHtml(value).replace(/\n/g, "<br>");
}

type ToolbarState = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
};

function ToolBtn({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      // preventDefault keeps the editor selection alive through the click.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={[
        "flex size-6 shrink-0 items-center justify-center rounded-[4px]",
        active
          ? "bg-(--te-ctl) text-(--te-strong)"
          : "text-(--te-muted) hover:bg-(--te-hover) hover:text-(--te-strong)",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

/**
 * Gmail-style rich-text area: contentEditable body with a formatting strip
 * (execCommand — deprecated but the exact engine Gmail's composer grew up
 * on, and fully supported by WebKit). Uncontrolled; read via the ref.
 */
export const RichTextArea = forwardRef<
  RichTextRef,
  {
    placeholder: string;
    ariaLabel: string;
    onTextChange?: (plainText: string) => void;
    autoFocus?: boolean;
    minHeightClass?: string;
    /** Seeds the editor once on mount (e.g. resuming a draft). */
    initialHTML?: string;
  }
>(function RichTextArea(
  { placeholder, ariaLabel, onTextChange, autoFocus, minHeightClass, initialHTML },
  ref,
) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [empty, setEmpty] = useState(true);
  const [toolbar, setToolbar] = useState<ToolbarState>({
    bold: false,
    italic: false,
    underline: false,
    strike: false,
  });
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const savedRange = useRef<Range | null>(null);

  const readText = () => editorRef.current?.innerText ?? "";

  const emitChange = () => {
    const text = readText();
    setEmpty(text.trim().length === 0);
    onTextChange?.(text);
  };

  useImperativeHandle(ref, () => ({
    getHTML: () => editorRef.current?.innerHTML ?? "",
    getText: readText,
    clear: () => {
      if (editorRef.current) editorRef.current.innerHTML = "";
      emitChange();
    },
    focus: () => editorRef.current?.focus(),
  }));

  const seededRef = useRef(false);
  useEffect(() => {
    if (!seededRef.current && initialHTML && editorRef.current) {
      seededRef.current = true;
      editorRef.current.innerHTML = initialHTML;
      emitChange();
    }
    if (autoFocus) editorRef.current?.focus();
  }, [autoFocus, initialHTML]);

  const refreshToolbar = () => {
    const el = editorRef.current;
    if (!el || !el.contains(document.getSelection()?.anchorNode ?? null)) return;
    setToolbar({
      bold: document.queryCommandState("bold"),
      italic: document.queryCommandState("italic"),
      underline: document.queryCommandState("underline"),
      strike: document.queryCommandState("strikeThrough"),
    });
  };

  // Reflect the caret's formatting in the strip while moving around.
  useEffect(() => {
    document.addEventListener("selectionchange", refreshToolbar);
    return () => document.removeEventListener("selectionchange", refreshToolbar);
  }, []);

  const exec = (command: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    emitChange();
    // Toggling with a still caret fires no selectionchange — sync immediately
    // so the button reflects the new typing style.
    refreshToolbar();
  };

  // Gmail formatting shortcuts. stopPropagation keeps app-level
  // listeners (⌘K palette, ⌘digit account switch) out of the way while typing.
  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
    const key = e.key.toLowerCase();
    const run = (fn: () => void) => {
      e.preventDefault();
      e.stopPropagation();
      fn();
    };
    if (!e.shiftKey) {
      if (key === "b") return run(() => exec("bold"));
      if (key === "i") return run(() => exec("italic"));
      if (key === "u") return run(() => exec("underline"));
      if (key === "k") return run(openLinkInput);
      if (key === "\\") return run(() => exec("removeFormat"));
      return;
    }
    if (key === "x") return run(() => exec("strikeThrough"));
    if (e.code === "Digit7") return run(() => exec("insertOrderedList"));
    if (e.code === "Digit8") return run(() => exec("insertUnorderedList"));
    if (e.code === "Digit9") return run(() => exec("formatBlock", "blockquote"));
  };

  const openLinkInput = () => {
    const selection = document.getSelection();
    savedRange.current =
      selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
    setLinkUrl("");
    setLinkOpen(true);
  };

  const applyLink = () => {
    const raw = linkUrl.trim();
    setLinkOpen(false);
    if (!raw) return;
    const url = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    const selection = document.getSelection();
    if (savedRange.current && selection) {
      selection.removeAllRanges();
      selection.addRange(savedRange.current);
    }
    if (selection && !selection.isCollapsed) {
      document.execCommand("createLink", false, url);
    } else {
      document.execCommand(
        "insertHTML",
        false,
        `<a href="${escapeHtml(url)}">${escapeHtml(raw)}</a>`,
      );
    }
    emitChange();
  };

  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex items-center gap-0.5 border-b border-(--te-border) px-2 py-1">
        <ToolBtn label="Bold (⌘B)" active={toolbar.bold} onClick={() => exec("bold")}>
          <BoldIcon className="size-3.5" />
        </ToolBtn>
        <ToolBtn label="Italic (⌘I)" active={toolbar.italic} onClick={() => exec("italic")}>
          <ItalicIcon className="size-3.5" />
        </ToolBtn>
        <ToolBtn
          label="Underline (⌘U)"
          active={toolbar.underline}
          onClick={() => exec("underline")}
        >
          <UnderlineIcon className="size-3.5" />
        </ToolBtn>
        <ToolBtn label="Strikethrough (⇧⌘X)" active={toolbar.strike} onClick={() => exec("strikeThrough")}>
          <StrikethroughIcon className="size-3.5" />
        </ToolBtn>
        <span className="mx-1 h-4 w-px shrink-0 bg-(--te-border)" aria-hidden />
        <ToolBtn label="Link (⌘K)" onClick={openLinkInput}>
          <Link2Icon className="size-3.5" />
        </ToolBtn>
        <span className="mx-1 h-4 w-px shrink-0 bg-(--te-border)" aria-hidden />
        <ToolBtn label="Bulleted list (⇧⌘8)" onClick={() => exec("insertUnorderedList")}>
          <ListIcon className="size-3.5" />
        </ToolBtn>
        <ToolBtn label="Numbered list (⇧⌘7)" onClick={() => exec("insertOrderedList")}>
          <ListOrderedIcon className="size-3.5" />
        </ToolBtn>
        <ToolBtn label="Quote (⇧⌘9)" onClick={() => exec("formatBlock", "blockquote")}>
          <TextQuoteIcon className="size-3.5" />
        </ToolBtn>
        <span className="mx-1 h-4 w-px shrink-0 bg-(--te-border)" aria-hidden />
        <ToolBtn label="Clear formatting (⌘\\)" onClick={() => exec("removeFormat")}>
          <RemoveFormattingIcon className="size-3.5" />
        </ToolBtn>
      </div>

      {linkOpen ? (
        <div className="flex items-center gap-2 border-b border-(--te-border) px-3 py-1.5">
          <span className="te-label shrink-0 text-(--te-faint)">Link</span>
          <input
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                applyLink();
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setLinkOpen(false);
              }
            }}
            placeholder="https://example.com"
            aria-label="Link URL"
            autoFocus
            className="min-w-0 flex-1 bg-transparent text-[13px] text-(--te-strong) outline-none placeholder:text-(--te-faint)"
          />
          <button
            type="button"
            onClick={applyLink}
            className="te-label shrink-0 text-(--te-blue) hover:brightness-110"
          >
            Apply
          </button>
        </div>
      ) : null}

      <div
        ref={editorRef}
        contentEditable
        role="textbox"
        aria-multiline="true"
        aria-label={ariaLabel}
        data-rt=""
        data-empty={empty ? "true" : "false"}
        data-placeholder={placeholder}
        onInput={emitChange}
        onKeyDown={handleKeyDown}
        className={[
          "te-scroll max-h-56 w-full overflow-y-auto bg-transparent px-3 py-2.5",
          "text-[15px] leading-relaxed text-(--te-strong) outline-none",
          minHeightClass ?? "min-h-[38px]",
        ].join(" ")}
      />
    </div>
  );
});
