import Markdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";

import "highlight.js/styles/github-dark.css";

const LANGUAGE_ALIASES: Record<string, string> = {
  python: "python",
  typescript: "typescript",
  javascript: "javascript",
  rust: "rust",
  go: "go",
  java: "java",
  "c++": "cpp",
  cpp: "cpp",
};

/**
 * Models sometimes return a bare snippet and sometimes a fenced block. Wrap the
 * bare case so it still renders as code with syntax highlighting.
 */
function ensureFenced(code: string, language?: string): string {
  if (code.includes("```")) return code;
  const id = LANGUAGE_ALIASES[(language ?? "").toLowerCase()] ?? "";
  return `\`\`\`${id}\n${code.trim()}\n\`\`\``;
}

interface MarkdownContentProps {
  content: string;
  /** Used to pick a syntax-highlighting grammar when the snippet has no fence. */
  language?: string;
  /** Set when the input is known to be a raw code snippet rather than prose. */
  code?: boolean;
}

/**
 * Server-rendered markdown. No "use client": the LLM output is static once
 * generated, so there is no reason to ship a markdown parser to the browser.
 */
export function MarkdownContent({ content, language, code = false }: MarkdownContentProps) {
  const source = code ? ensureFenced(content, language) : content;

  return (
    <div
      className={[
        "text-sm leading-relaxed",
        "[&_p]:mb-3 [&_p:last-child]:mb-0",
        "[&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-5",
        "[&_ol]:mb-3 [&_ol]:list-decimal [&_ol]:pl-5",
        "[&_li]:mb-1",
        "[&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-base [&_h1]:font-semibold",
        "[&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold",
        "[&_h3]:mt-3 [&_h3]:mb-2 [&_h3]:text-sm [&_h3]:font-semibold",
        "[&_a]:underline [&_a]:underline-offset-4",
        "[&_code:not(pre_code)]:rounded [&_code:not(pre_code)]:bg-muted [&_code:not(pre_code)]:px-1.5 [&_code:not(pre_code)]:py-0.5 [&_code:not(pre_code)]:font-mono [&_code:not(pre_code)]:text-[0.8rem]",
        "[&_pre]:mb-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:bg-zinc-950 [&_pre]:p-4",
        "[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-[0.8rem] [&_pre_code]:leading-relaxed",
        "[&_blockquote]:border-l-2 [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground",
        "[&_table]:mb-3 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:px-2 [&_th]:py-1",
      ].join(" ")}
    >
      <Markdown rehypePlugins={[rehypeHighlight]}>{source}</Markdown>
    </div>
  );
}
