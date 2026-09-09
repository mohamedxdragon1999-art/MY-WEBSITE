"use client";
import { tokensToCssVars } from "@opencrm/shared";
import { useBuilder } from "./store";

/**
 * Renders the design-system tokens as CSS variables the canvas can use.
 * Lets blocks reference var(--accent), var(--surface), etc. directly.
 */
export function DesignTokenStyle() {
  const doc = useBuilder((s) => s.doc);
  const tokens = doc.theme.tokens;
  if (!tokens || Object.keys(tokens).length === 0) return null;
  return <style>{tokensToCssVars(tokens)}</style>;
}