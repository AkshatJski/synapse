"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";

/**
 * One-click light/dark switch for the header.
 *
 * The icon is chosen by CSS (`dark:`), not React state. `next-themes` puts the
 * `.dark` class on `<html>` before first paint, so the Sun is visible on a dark
 * page immediately - no mounted guard, no placeholder, no hydration mismatch.
 *
 * The click reads the class from the DOM instead of `resolvedTheme`: the class
 * is the source of truth from the first paint, while the hook value is only
 * available after the provider's effect runs. A very fast first click still
 * toggles the theme the user can actually see.
 */
export function ThemeToggle() {
  const { setTheme } = useTheme();

  function toggle() {
    const isDark = document.documentElement.classList.contains("dark");
    setTheme(isDark ? "light" : "dark");
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label="Toggle light and dark mode"
      title="Toggle light and dark mode"
      onClick={toggle}
    >
      <Sun className="hidden size-4 dark:block" />
      <Moon className="size-4 dark:hidden" />
    </Button>
  );
}
