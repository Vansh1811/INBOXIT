"use client";

import { createContext, useContext, useState, useCallback, ReactNode } from "react";

export type ActionType = "archive" | "delete";

interface ActionContextValue {
  pendingActions: Record<string, ActionType>;
  addPendingAction: (id: string, action: ActionType) => void;
  addPendingActions: (ids: string[], action: ActionType) => void;
  removePendingAction: (id: string) => void;
}

const ActionContext = createContext<ActionContextValue | null>(null);

export function useActionContext() {
  const ctx = useContext(ActionContext);
  if (!ctx) throw new Error("useActionContext must be used within ActionProvider");
  return ctx;
}

export function ActionProvider({ children }: { children: ReactNode }) {
  const [pendingActions, setPendingActions] = useState<Record<string, ActionType>>({});

  const addPendingAction = useCallback((id: string, action: ActionType) => {
    setPendingActions((prev) => ({ ...prev, [id]: action }));
  }, []);

  const addPendingActions = useCallback((ids: string[], action: ActionType) => {
    setPendingActions((prev) => {
      const next = { ...prev };
      ids.forEach(id => next[id] = action);
      return next;
    });
  }, []);

  const removePendingAction = useCallback((id: string) => {
    setPendingActions((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  return (
    <ActionContext.Provider value={{ pendingActions, addPendingAction, addPendingActions, removePendingAction }}>
      {children}
    </ActionContext.Provider>
  );
}
