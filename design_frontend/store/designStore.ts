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
  /** When set, the chat panel pops open with this text pre-filled. Used so
   *  any panel (open-questions, critique issues, etc.) can hand a follow-up
   *  prompt to the refinement chat. Cleared after the chat picks it up. */
  pendingChatPrompt: string | undefined;
  /** User-dismissed open questions (local only). */
  dismissedQuestions: Set<string>;

  setDesign: (design: FullDesign | undefined) => void;
  setDesignId: (id: string | undefined) => void;
  setSelection: (selection: Selection) => void;
  setFocusedCluster: (cluster: string | undefined) => void;
  setQuestions: (qs: string[]) => void;
  setClarificationRound: (n: number) => void;
  upsertPendingRevision: (rev: DesignRevision) => void;
  removePendingRevision: (revisionId: string) => void;
  setPendingChatPrompt: (text: string | undefined) => void;
  dismissQuestion: (q: string) => void;
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
  pendingChatPrompt: undefined,
  dismissedQuestions: new Set<string>(),

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
  setPendingChatPrompt: (text) => set({ pendingChatPrompt: text }),
  dismissQuestion: (q) =>
    set((state) => {
      const next = new Set(state.dismissedQuestions);
      next.add(q);
      return { dismissedQuestions: next };
    }),
  getTable: (name) =>
    get().design?.schema_designs.find((sd) => sd.table_name === name)
}));
