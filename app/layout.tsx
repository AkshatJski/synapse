import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";

import { SiteHeader, SiteHeaderFallback } from "@/components/site-header";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Synapse — turn research papers into buildable projects",
    template: "%s · Synapse",
  },
  description:
    "Synapse searches arXiv for a recent paper in your field, then translates the dense abstract into a step-by-step coding roadmap matched to your language and skill level.",
  applicationName: "Synapse",
  keywords: ["arXiv", "research papers", "coding projects", "learning roadmap", "LLM"],
  authors: [{ name: "Synapse" }],
  openGraph: {
    title: "Synapse — turn research papers into buildable projects",
    description:
      "Pick a domain, a language and a skill level. Synapse finds a relevant paper and turns it into a project roadmap you can actually build.",
    type: "website",
    siteName: "Synapse",
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <a
          href="#main"
          className="sr-only rounded-md bg-background px-3 py-2 text-sm font-medium focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:ring-2 focus:ring-ring"
        >
          Skip to content
        </a>
        <Suspense fallback={<SiteHeaderFallback />}>
          <SiteHeader />
        </Suspense>
        {children}
        <Toaster position="bottom-right" />
      </body>
    </html>
  );
}
