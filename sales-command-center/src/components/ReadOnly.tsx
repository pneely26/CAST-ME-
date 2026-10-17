"use client";

import { createContext, useContext, type ReactNode } from "react";

/** True for view-only users (sales reps). The server refuses their changes regardless; this just hides the controls. */
export const ReadOnlyContext = createContext(false);

export function ReadOnlyProvider({ readOnly, children }: { readOnly: boolean; children: ReactNode }) {
  return <ReadOnlyContext.Provider value={readOnly}>{children}</ReadOnlyContext.Provider>;
}

export const useReadOnly = () => useContext(ReadOnlyContext);

/** Renders its children only for users who can make changes. */
export function WriteOnly({ children }: { children: ReactNode }) {
  return useReadOnly() ? null : <>{children}</>;
}
