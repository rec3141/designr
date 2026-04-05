"use client";
import { useEffect } from "react";
import { applyTheme, loadTheme } from "@/lib/theme";

// Mounted once in the root layout. On every page load it re-applies the
// current evolving theme from localStorage to the document's CSS variables.
export default function ThemeTuner() {
  useEffect(() => {
    applyTheme(loadTheme());
    const handler = () => applyTheme(loadTheme());
    window.addEventListener("designr:theme", handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("designr:theme", handler);
      window.removeEventListener("storage", handler);
    };
  }, []);
  return null;
}
