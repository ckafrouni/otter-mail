import { memo } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Agent replies rendered as GitHub-flavored markdown, styled for the TE skin.
 * Links open in the default browser (never navigate the WKWebView). Memoized
 * on the text so streaming deltas only re-parse the growing string.
 */
export const ChatMarkdown = memo(function ChatMarkdown({ text }: { text: string }) {
  return (
    <div className="flex flex-col gap-2 text-[13px] leading-relaxed text-(--te-text)">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="whitespace-pre-wrap">{children}</p>,
          a: ({ href, children }) => (
            <a
              href={href}
              onClick={(e) => {
                e.preventDefault();
                if (href) void window.glazeAPI.shell.openExternal(href);
              }}
              className="text-(--te-blue) underline underline-offset-2 hover:opacity-80"
            >
              {children}
            </a>
          ),
          ul: ({ children }) => <ul className="list-disc pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-5">{children}</ol>,
          li: ({ children }) => <li className="my-0.5">{children}</li>,
          h1: ({ children }) => <h1 className="text-[15px] font-bold text-(--te-strong)">{children}</h1>,
          h2: ({ children }) => <h2 className="text-[14px] font-bold text-(--te-strong)">{children}</h2>,
          h3: ({ children }) => (
            <h3 className="text-[13px] font-bold text-(--te-strong)">{children}</h3>
          ),
          strong: ({ children }) => <strong className="font-semibold text-(--te-strong)">{children}</strong>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-(--te-border) pl-2.5 text-(--te-muted)">
              {children}
            </blockquote>
          ),
          code: ({ className, children }) =>
            className?.includes("language-") ? (
              <code className={className}>{children}</code>
            ) : (
              <code className="rounded-[3px] bg-(--te-ctl) px-1 text-[12px]">{children}</code>
            ),
          pre: ({ children }) => (
            <pre className="te-scroll overflow-x-auto rounded-[5px] border border-(--te-border) bg-(--te-panel) px-2.5 py-2 text-[12px] leading-relaxed">
              {children}
            </pre>
          ),
          table: ({ children }) => (
            <div className="te-scroll overflow-x-auto">
              <table className="w-full border-collapse text-[12px]">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-(--te-border) px-2 py-1 text-left font-semibold">{children}</th>
          ),
          td: ({ children }) => <td className="border border-(--te-border) px-2 py-1">{children}</td>,
          hr: () => <hr className="border-(--te-border)" />,
        }}
      >
        {text}
      </Markdown>
    </div>
  );
});
