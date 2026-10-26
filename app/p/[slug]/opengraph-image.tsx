import { ImageResponse } from "next/og";

import { isSupabaseConfigured } from "@/lib/env";
import { isMissingSharingColumn } from "@/lib/sharing";
import { createPublicClient } from "@/lib/supabase/public";

/**
 * The 1200x630 card a share link renders as in Slack, X, Discord, iMessage…
 *
 * A share link with no image is a bare URL, which is the one thing a share
 * feature cannot afford. This route is separate from `generateMetadata` because
 * images are fetched on their own; it repeats the slug lookup, keeps the query
 * to four columns, and must never throw — a broken image would take the whole
 * metadata preview down with it.
 */

export const alt = "A Synapse roadmap generated from an arXiv paper";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

type ProjectCard = {
  title: string;
  domain: string;
  language: string;
  skill_level: string;
  steps: { id: string }[] | null;
};

const FALLBACK = {
  title: "Read the paper. Then actually build it.",
  domain: "arXiv paper",
  language: "buildable roadmap",
  skillLevel: "",
  stepCount: null as number | null,
};

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

async function loadCard(slug: string): Promise<ProjectCard | null> {
  if (!isSupabaseConfigured()) return null;

  try {
    const supabase = createPublicClient();
    const { data, error } = await supabase
      .from("projects")
      .select("title, domain, language, skill_level, steps(id)")
      .eq("share_slug", slug)
      .maybeSingle<ProjectCard>();

    if (error && !isMissingSharingColumn(error)) {
      console.error("[share] og image lookup failed", error);
    }

    return data ?? null;
  } catch (error) {
    console.error("[share] og image lookup threw", error);
    return null;
  }
}

export default async function OpengraphImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const card = await loadCard(slug);

  const title = truncate(card?.title ?? FALLBACK.title, 110);
  const domain = card?.domain ?? FALLBACK.domain;
  const language = card?.language ?? FALLBACK.language;
  const stepCount = card?.steps?.length ?? null;
  const site = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? "synapse-seven-ebon.vercel.app";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px",
          background: "linear-gradient(135deg, #09090b 0%, #18181b 55%, #1f1a2e 100%)",
          color: "#fafafa",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                background: "#a78bfa",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#09090b",
                fontSize: 26,
                fontWeight: 700,
              }}
            >
              S
            </div>
            <div style={{ display: "flex", fontSize: 30, fontWeight: 600, letterSpacing: -0.5 }}>
              Synapse
            </div>
          </div>

          <div
            style={{
              display: "flex",
              padding: "10px 20px",
              borderRadius: 999,
              border: "1px solid rgba(250,250,250,0.28)",
              fontSize: 24,
              color: "#d4d4d8",
            }}
          >
            {domain}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
          <div
            style={{
              display: "flex",
              fontSize: title.length > 70 ? 58 : 70,
              fontWeight: 700,
              lineHeight: 1.12,
              letterSpacing: -1.5,
            }}
          >
            {title}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 28, color: "#a1a1aa" }}>
            <span>{language}</span>
            {stepCount !== null && stepCount > 0 && (
              <>
                <span style={{ color: "#52525b" }}>•</span>
                <span>{stepCount} build steps</span>
              </>
            )}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", fontSize: 26, color: "#a1a1aa" }}>
            Read the paper. Then actually build it.
          </div>
          <div style={{ display: "flex", fontSize: 24, color: "#71717a" }}>{site}</div>
        </div>
      </div>
    ),
    size,
  );
}
