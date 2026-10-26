import Link from "next/link";
import { Compass } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = {
  title: "Page not found",
};

/**
 * A missing project, a revoked share link and a typo all land here. The copy
 * deliberately does not guess which one happened: a revoked link and a slug
 * that never existed must look identical, or the page leaks that a link used
 * to exist.
 */
export default function NotFound() {
  return (
    <main id="main" className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-6 py-16">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Compass className="size-4 text-muted-foreground" />
            Nothing at this address
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            The page does not exist, the roadmap was deleted, or the share link was revoked. If
            someone sent you this link, ask them for a fresh one.
          </p>

          <div className="flex flex-wrap gap-2">
            <Button render={<Link href="/dashboard" />}>Your roadmaps</Button>
            <Button variant="outline" render={<Link href="/" />}>
              Home
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
