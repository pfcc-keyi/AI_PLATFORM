import { AlertTriangle } from "lucide-react";
import { DesignList } from "@/components/landing/DesignList";
import { UploadDropzone } from "@/components/upload/UploadDropzone";
import { QueryProvider } from "@/components/QueryProvider";
import { API_BASE_CONFIGURED } from "@/lib/api";

export default function LandingPage() {
  return (
    <QueryProvider>
      <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-10 px-6 pb-16 pt-10">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium tracking-tight">
            <span className="inline-block h-2 w-2 rounded-full bg-accent" />
            Schema Cockpit
          </div>
        </header>

        {!API_BASE_CONFIGURED ? (
          <div className="flex items-start gap-3 rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            <div>
              <div className="font-semibold">Backend not configured.</div>
              <div className="mt-1 text-danger/90">
                Set <code className="font-mono">NEXT_PUBLIC_AI_API_URL</code>{" "}
                on this service and redeploy.
              </div>
            </div>
          </div>
        ) : null}

        <UploadDropzone />

        <section className="flex flex-col gap-3">
          <h2 className="text-xs font-medium uppercase tracking-[0.18em] text-muted">
            Recent
          </h2>
          <DesignList />
        </section>
      </main>
    </QueryProvider>
  );
}
