import { create } from "zustand";
import type {
  DesignRevision,
  FullDesign,
  SchemaDesign
} from "@/lib/types";

type Selection =
  | { kind: "none" }
  | { kind: "table"; tableName: string }
  | {
      kind: "field";
      tableName: string;
      fieldName: string;
      stateName?: string;
    };

interface DesignState {
  designId: string | undefined;
  design: FullDesign | undefined;
  pendingRevisions: DesignRevision[];
  selection: Selection;
  focusedCluster: string | undefined;
  questions: string[];
  clarificationRound: number;

  setDesign: (design: FullDesign | undefined) => void;
  setDesignId: (id: string | undefined) => void;
  setSelection: (selection: Selection) => void;
  setFocusedCluster: (cluster: string | undefined) => void;
  setQuestions: (qs: string[]) => void;
  setClarificationRound: (n: number) => void;
  upsertPendingRevision: (rev: DesignRevision) => void;
  removePendingRevision: (revisionId: string) => void;
  getTable: (name: string) => SchemaDesign | undefined;
}

export const useDesignStore = create<DesignState>((set, get) => ({
  designId: undefined,
  design: undefined,
  pendingRevisions: [],
  selection: { kind: "none" },
  focusedCluster: undefined,
  questions: [],
  clarificationRound: 0,

  setDesign: (design) => set({ design }),
  setDesignId: (designId) => set({ designId }),
  setSelection: (selection) => set({ selection }),
  setFocusedCluster: (focusedCluster) => set({ focusedCluster }),
  setQuestions: (questions) => set({ questions }),
  setClarificationRound: (clarificationRound) => set({ clarificationRound }),
  upsertPendingRevision: (rev) =>
    set((state) => {
      const others = state.pendingRevisions.filter(
        (r) => r.revision_id !== rev.revision_id
      );
      return { pendingRevisions: [...others, rev] };
    }),
  removePendingRevision: (revisionId) =>
    set((state) => ({
      pendingRevisions: state.pendingRevisions.filter(
        (r) => r.revision_id !== revisionId
      )
    })),
  getTable: (name) =>
    get().design?.schema_designs.find((sd) => sd.table_name === name)
}));
