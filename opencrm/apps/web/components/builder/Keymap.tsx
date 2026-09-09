"use client";
import { useEffect } from "react";
import { useBuilder } from "./store";

/**
 * Keyboard shortcuts:
 *   Ctrl/Cmd+Z     undo
 *   Ctrl/Cmd+Shift+Z  redo   (also Ctrl+Y)
 *   Ctrl/Cmd+D     duplicate selection
 *   Delete/BackSpace   delete selection (only when not typing in a field)
 *   Ctrl/Cmd+S     save (already bound to Save button via form)
 *   Escape         deselect
 */
export function Keymap() {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const st = useBuilder.getState();
      const meta = e.ctrlKey || e.metaKey;
      const isTyping = (e.target as HTMLElement)?.tagName === "INPUT" ||
                       (e.target as HTMLElement)?.tagName === "TEXTAREA" ||
                       (e.target as HTMLElement)?.isContentEditable === true;
      if (isTyping && !meta) return;

      if (meta && e.key === "z" && !e.shiftKey) { e.preventDefault(); st.flushLive(); st.undo(); }
      else if (meta && (e.key === "y" || (e.key === "z" && e.shiftKey))) { e.preventDefault(); st.flushLive(); st.redo(); }
      else if (meta && e.key === "d" && st.selectedId) { e.preventDefault(); st.duplicateSelected(); }
      else if (meta && e.key === "s") { e.preventDefault(); st.flushLive(); document.dispatchEvent(new CustomEvent("builder-save")); }
      else if ((e.key === "Delete" || e.key === "Backspace") && !isTyping && st.selectedId) { e.preventDefault(); st.removeSelected(); }
      else if (e.key === "Escape") { st.select(null); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return null;
}