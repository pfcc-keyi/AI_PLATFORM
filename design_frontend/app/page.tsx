import { AlertTriangle, Sparkles } from "lucide-react";
import { DesignList } from "@/components/landing/DesignList";
import { UploadDropzone } from "@/components/upload/UploadDropzone";
import { QueryProvider } from "@/components/QueryProvider";
import { API_BASE, API_BASE_CONFIGURED } from "@/lib/api";

export default function LandingPage() {
  return (
    <QueryProvider>
      <main className="mx-auto flex max-w-5xl flex-col gap-12 px-6 py-16">
        {!API_BASE_CONFIGURED ? (
          <div className="flex items-start gap-3 rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            <div>
              <div className="font-semibold">
                Backend URL not configured.
              </div>
              <div className="mt-1 text-danger/90">
                Set{" "}
                <code className="font-mono">NEXT_PUBLIC_AI_API_URL</code> on
                this Railway service (e.g.{" "}
                <code className="font-mono">
                  https://your-ai-platform.up.railway.app
                </code>
                ) and trigger a redeploy. Next.js bakes{" "}
                <code className="font-mono">NEXT_PUBLIC_*</code> values into
                the bundle at build time, so a redeploy is required.
              </div>
            </div>
          </div>
        ) : null}

        <header className="flex flex-col items-center text-center gap-4">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface/70 px-3 py-1 text-xs text-muted">
            <Sparkles className="h-3.5 w-3.5 text-accent" />
            Schema Design Cockpit
          </div>
          <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">
            Turn a schema spreadsheet into a{" "}
            <span className="bg-gradient-to-r from-accent to-accentAlt bg-clip-text text-transparent">
              living 3D design
            </span>
            .
          </h1>
          <p className="max-w-2xl text-base text-muted">
            Upload an Excel data dictionary, answer a few clarifying questions,
            then explore your tables as a 3D ERD with per-table state machines
            and AI-suggested handlers — refine with natural language.
          </p>
        </header>

        <UploadDropzone />

        <section className="flex flex-col gap-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-semibold">Recent designs</h2>
            <div className="text-xs text-muted">
              Backend:{" "}
              <code className="font-mono">
                {API_BASE_CONFIGURED ? `${API_BASE}/api/design` : "(not set)"}
              </code>
            </div>
          </div>
          <DesignList />
        </section>
      </main>
    </QueryProvider>
  );
}
