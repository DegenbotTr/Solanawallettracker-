"use client";

import { useEffect, useRef, useState } from "react";

const GLYPHS = "!<>-_\\/[]{}=+*^?#$%&0123456789";
const TICK_MS = 30;

type Char = { ch: string; done: boolean };

/**
 * Decrypt-style text animation: every character cycles through random glyphs
 * and settles on the real letter, staggered left→right. One phrase = decode
 * once on mount; multiple phrases = rotate forever (hold → re-scramble).
 * Respects prefers-reduced-motion (renders static text).
 */
export function ScrambleText({
  phrases,
  className,
  holdMs = 4200,
  scrambleMs = 1100,
}: {
  phrases: string[];
  className?: string;
  holdMs?: number;
  scrambleMs?: number;
}) {
  // SSR/first paint: show the first phrase fully settled (SEO + no-JS safe).
  const [chars, setChars] = useState<Char[]>(() =>
    phrases[0].split("").map((ch) => ({ ch, done: true })),
  );
  const idxRef = useRef(0);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    let interval = 0;
    let timeout = 0;

    const run = (text: string) => {
      const totalFrames = Math.max(4, Math.round(scrambleMs / TICK_MS));
      // Per-char frame at which it settles — staggered with a little jitter.
      const reveals = text
        .split("")
        .map(
          (_, i) =>
            Math.floor((i / text.length) * totalFrames * 0.7) +
            2 +
            Math.floor(Math.random() * totalFrames * 0.3),
        );
      let frame = 0;
      interval = window.setInterval(() => {
        frame++;
        let allDone = true;
        setChars(
          text.split("").map((ch, i) => {
            if (ch === " " || frame >= reveals[i]) return { ch, done: true };
            allDone = false;
            return {
              ch: GLYPHS[Math.floor(Math.random() * GLYPHS.length)],
              done: false,
            };
          }),
        );
        if (allDone) {
          window.clearInterval(interval);
          if (phrases.length > 1) {
            timeout = window.setTimeout(() => {
              idxRef.current = (idxRef.current + 1) % phrases.length;
              run(phrases[idxRef.current]);
            }, holdMs);
          }
        }
      }, TICK_MS);
    };

    run(phrases[idxRef.current]);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <span className={className}>
      <span className="sr-only">{phrases[0]}</span>
      <span aria-hidden="true">
        {chars.map((c, i) => (
          <span
            key={i}
            className={c.done ? undefined : "scramble-pending"}
            // pre-wrap (not pre): spaces must stay soft-wrap points or the
            // headline can't break into lines on small screens.
            style={{ whiteSpace: "pre-wrap" }}
          >
            {c.ch}
          </span>
        ))}
      </span>
    </span>
  );
}
