"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import {
  CaretIcon, DocIcon, GearIcon, HistoryIcon, MenuIcon, PlusIcon, ThemeIcon, TrashIcon,
} from "./icons";

export interface SearchListItem {
  id: string;
  title: string;
}

/**
 * The persistent app frame: collapsible sidebar plus the main column.
 *
 * Sidebar state and theme live here rather than in a context, because nothing
 * below needs to read them and a context would only add re-renders.
 */
export function Shell({
  searches,
  user,
  children,
}: {
  searches: SearchListItem[];
  user: { name?: string | null; image?: string | null };
  children: React.ReactNode;
}) {
  const [rail, setRail] = useState(false);
  const [list, setList] = useState(searches);
  const pathname = usePathname();
  const router = useRouter();

  const toggleTheme = useCallback(() => {
    const root = document.documentElement;
    const current =
      root.dataset.theme ??
      (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = current === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    try {
      localStorage.setItem("heykels-theme", next);
    } catch {
      // Private browsing: the theme simply won't persist across reloads.
    }
  }, []);

  const remove = useCallback(
    async (id: string) => {
      setList((prev) => prev.filter((s) => s.id !== id));
      await fetch(`/api/searches/${id}`, { method: "DELETE" });
      if (pathname === `/search/${id}`) router.push("/search");
      router.refresh();
    },
    [pathname, router],
  );

  const initial = (user.name ?? "?").trim().charAt(0).toUpperCase() || "?";

  return (
    <div className={`app${rail ? " rail" : ""}`}>
      <aside className="sidebar">
        <div className="sb-top">
          <button
            className="icon-btn"
            onClick={() => setRail((r) => !r)}
            aria-label={rail ? "Expand menu" : "Collapse menu"}
          >
            <MenuIcon />
          </button>
        </div>

        <Link href="/search" className="new-btn">
          <PlusIcon />
          <span className="lbl">New Search</span>
        </Link>

        <div className="sb-list">
          <div className="sb-head">Recent</div>
          {list.length === 0 && !rail && (
            <div className="sb-head" style={{ color: "var(--text-mute)", fontWeight: 400 }}>
              No searches yet
            </div>
          )}
          {list.map((s) => (
            <div key={s.id} style={{ position: "relative", display: "flex" }}>
              <Link
                href={`/search/${s.id}`}
                className={`sb-item${pathname === `/search/${s.id}` ? " active" : ""}`}
              >
                <HistoryIcon />
                <span className="t">{s.title}</span>
                <span
                  role="button"
                  tabIndex={0}
                  className="kebab"
                  aria-label={`Delete ${s.title}`}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    void remove(s.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      void remove(s.id);
                    }
                  }}
                >
                  <TrashIcon />
                </span>
              </Link>
            </div>
          ))}
        </div>

        <div className="sb-foot">
          <Link href="/memory" className={`sb-item${pathname === "/memory" ? " active" : ""}`}>
            <DocIcon />
            <span className="t">Memory</span>
          </Link>
          <Link
            href="/settings/connections"
            className={`sb-item${pathname.startsWith("/settings") ? " active" : ""}`}
          >
            <GearIcon />
            <span className="t">Connections</span>
          </Link>
          <button className="sb-item" onClick={toggleTheme}>
            <ThemeIcon />
            <span className="t">Toggle theme</span>
          </button>
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <button className="brand-pill">
            HeyKels
            <CaretIcon />
          </button>
          <div className="top-right">
            <span className="badge">{process.env.NEXT_PUBLIC_MODEL_LABEL || "gemini-3.5-flash"}</span>
            <div className="avatar" title={user.name ?? undefined}>
              {initial}
            </div>
          </div>
        </div>
        {children}
      </main>
    </div>
  );
}
