import { Sparkles } from "lucide-react";
import { DesignList } from "@/components/landing/DesignList";
import { UploadDropzone } from "@/components/upload/UploadDropzone";
import { QueryProvider } from "@/components/QueryProvider";

export default function LandingPage() {
  return (
    <QueryProvider>
      <main className="mx-auto flex max-w-5xl flex-col gap-12 px-6 py-16">
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
              Backend: <code className="font-mono">/api/design</code>
            </div>
          </div>
          <DesignList />
        </section>
      </main>
    </QueryProvider>
  );
}
