"use client";

import { motion } from "framer-motion";
import { CloudUpload, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { useDropzone } from "react-dropzone";
import { uploadDesign } from "@/lib/api";
import { cn } from "@/lib/utils";

export function UploadDropzone() {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const onDrop = React.useCallback(
    async (accepted: File[]) => {
      const file = accepted[0];
      if (!file) return;
      setBusy(true);
      setError(null);
      try {
        const resp = await uploadDesign(file);
        if (!resp.design_id) {
          throw new Error("upload returned no design_id");
        }
        router.push(`/design/${resp.design_id}`);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setError(message);
        setBusy(false);
      }
    },
    [router]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: false,
    accept: {
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [
        ".xlsx"
      ],
      "application/vnd.ms-excel": [".xls"]
    }
  });

  return (
    <div className="w-full">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
      >
        <div
          {...getRootProps()}
          className={cn(
            "group cursor-pointer rounded-2xl border-2 border-dashed bg-surface/40 backdrop-blur-sm",
            "p-12 text-center transition-colors",
            isDragActive
              ? "border-accent bg-accent/10"
              : "border-border hover:border-accent/60 hover:bg-surface/60"
          )}
        >
          <input {...getInputProps()} />
          <div className="mx-auto flex flex-col items-center gap-4">
            {busy ? (
              <Loader2 className="h-12 w-12 animate-spin text-accent" />
            ) : (
              <CloudUpload className="h-12 w-12 text-accent" />
            )}
            <div className="text-lg font-medium">
              {busy
                ? "Uploading and parsing your schema..."
                : isDragActive
                  ? "Drop your .xlsx here"
                  : "Drop an Excel schema dictionary"}
            </div>
            <div className="text-sm text-muted max-w-md">
              Multi-sheet workbooks are supported. The AI cockpit parses tables,
              clusters them by FK graph, asks clarifying questions, then renders
              a 3D ERD with per-table state machines.
            </div>
          </div>
        </div>
      </motion.div>
      {error ? (
        <div className="mt-4 rounded-md border border-danger/40 bg-danger/10 px-4 py-2 text-sm text-danger">
          Upload failed: {error}
        </div>
      ) : null}
    </div>
  );
}
