"use client";

import { ThemeProvider as NextThemesProvider, type ThemeProviderProps } from "next-themes";

/**
 * Thin client boundary around `next-themes`.
 *
 * `next-themes` injects a tiny inline script that applies the saved theme to
 * `<html>` before the browser paints, so the app never flashes light before a
 * dark page. Keeping the provider in its own file makes the client boundary
 * explicit: the rest of the root layout stays a Server Component.
 */
export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
