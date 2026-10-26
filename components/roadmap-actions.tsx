"use client";

import { Download, Printer } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { markdownFilename, roadmapToMarkdown, type ExportInput } from "@/lib/export";

/**
 * Turns the roadmap that is already on screen into a file.
 *
 * No server round trip: the rows were rendered from data the page already has,
 * so the download works even if the network drops after paint. `print:hidden`
 * keeps both buttons off the printed page.
 */
export function RoadmapActions(input: ExportInput) {
  function handleDownload() {
    const markdown = roadmapToMarkdown(input);
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = markdownFilename(input.project.title);
    document.body.appendChild(link);
    link.click();
    link.remove();

    // The browser reads the blob asynchronously after the click.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success("Markdown downloaded.");
  }

  return (
    <div className="flex items-center gap-1 print:hidden">
      <Button variant="ghost" size="sm" onClick={handleDownload}>
        <Download className="size-3.5" />
        Markdown
      </Button>
      <Button variant="ghost" size="sm" onClick={() => window.print()}>
        <Printer className="size-3.5" />
        Print
      </Button>
    </div>
  );
}
