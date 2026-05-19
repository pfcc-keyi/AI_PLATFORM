"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import Link from "next/link";
import { Layers3, ArrowRight, Database } from "lucide-react";
import { listDesigns } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatRelativeTime } from "@/lib/utils";

// Time strings depend on Date.now(), which differs between SSR and client.
// Defer rendering until after mount to avoid hydration mismatch.
function RelativeTime({ iso }: { iso: string | undefined }) {
  const [text, setText] = React.useState("");
  React.useEffect(() => {
    setText(formatRelativeTime(iso));
    const t = setInterval(() => setText(formatRelativeTime(iso)), 60_000);
    return () => clearInterval(t);
  }, [iso]);
  return <span suppressHydrationWarning>{text}</span>;
}

export function DesignList() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["designs"],
    queryFn: listDesigns,
    staleTime: 10_000
  });

  if (isLoading) {
    return (
      <div className="text-sm text-muted">Loading existing designs…</div>
    );
  }

  if (error) {
    return (
      <div className="text-sm text-danger">
        Failed to fetch designs: {String(error)}
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface/40 px-4 py-6 text-sm text-muted">
        No designs yet. Upload an Excel data dictionary above to begin.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {data.map((d, idx) => (
        <motion.div
          key={d.design_id}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: idx * 0.04 }}
        >
          <Link href={`/design/${d.design_id}`}>
            <Card className="group flex h-full cursor-pointer flex-col gap-3 p-4 transition-all hover:border-accent/60 hover:shadow-glow">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Layers3 className="h-4 w-4 text-accent" />
                  <span className="truncate" title={d.design_id}>
                    {d.filename || d.design_id}
                  </span>
                </div>
                <ArrowRight className="h-4 w-4 text-muted transition-transform group-hover:translate-x-1 group-hover:text-accent" />
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {d.domain_guess ? (
                  <Badge variant="accent">{d.domain_guess}</Badge>
                ) : null}
                <Badge variant="muted">
                  <Database className="h-3 w-3" />
                  {d.table_count ?? 0} tables
                </Badge>
              </div>
              <div className="mt-auto text-xs text-muted">
                <RelativeTime iso={d.created_at} />
              </div>
            </Card>
          </Link>
        </motion.div>
      ))}
    </div>
  );
}
