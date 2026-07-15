"use client";

import Link from "next/link";
import { useState } from "react";

const COMMUNITY_URL = "https://t.me/Degenhubtrade";

const links = [
  { href: "/", label: "Home" },
  { href: "/bots", label: "Bots" },
  { href: "/#how", label: "How it works" },
  { href: "/#community", label: "Community" },
];

/** Hamburger + dropdown panel for small screens (nav links are md:+ only). */
export function MobileMenu() {
  const [open, setOpen] = useState(false);

  return (
    <div className="md:hidden">
      <button
        type="button"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-panel text-white"
      >
        {open ? (
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        ) : (
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        )}
      </button>

      {open && (
        <div className="absolute inset-x-0 top-16 z-50 border-b border-border/60 bg-black/95 px-6 py-4 backdrop-blur-xl">
          <nav className="flex flex-col gap-1">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-2.5 text-sm font-medium text-zinc-300 hover:bg-panel hover:text-white"
              >
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="mt-3 flex flex-col gap-2 border-t border-border/60 pt-3">
            <a
              href={COMMUNITY_URL}
              target="_blank"
              rel="noreferrer"
              onClick={() => setOpen(false)}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-accent-2/40 bg-accent-2/10 text-sm font-medium text-white"
            >
              Join the community
            </a>
            <a
              href="https://t.me/De1trackBot"
              target="_blank"
              rel="noreferrer"
              onClick={() => setOpen(false)}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-white text-sm font-semibold text-black"
            >
              Launch bot
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
