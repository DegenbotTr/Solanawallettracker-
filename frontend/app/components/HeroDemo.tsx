"use client";

import { useEffect, useState } from "react";

const ROTATE_MS = 7000;

const scenes = [
  {
    id: "dm",
    label: "DM · Wallet alerts",
    header: "@De1trackBot",
    body: (
      <>
        <ChatLine role="you">/watch 7xKX...aB2v</ChatLine>
        <ChatLine role="bot">
          <span className="text-accent">Watching</span> 7xKX...aB2v.
          You&apos;ll get alerts for every trade over your min size.
        </ChatLine>
        <ChatLine role="bot" alert>
          <div className="text-emerald-300">◎ BUY detected</div>
          <div className="mt-1 text-zinc-400">
            <span className="text-white">7xKX...aB2v</span> bought{" "}
            <span className="text-white">1,240 BONK</span> for{" "}
            <span className="text-white">2.15 SOL</span>
          </div>
          <div className="text-zinc-500">≈ $312.40 • 2s ago</div>
        </ChatLine>
        <ChatLine role="you">0x95ad…c4ce</ChatLine>
        <ChatLine role="bot">
          <div className="text-white">🪙 SHIBA INU ($SHIB)</div>
          <div className="mt-1 text-zinc-400">
            MC <span className="text-white">$4.2B</span> · LP{" "}
            <span className="text-white">$12M</span> ·{" "}
            <span className="text-violet-300">⟠ Ethereum</span>
          </div>
          <div className="text-zinc-500">
            🔒 Honeypot: No · Tax 0/0 · Verified ✓
          </div>
        </ChatLine>
      </>
    ),
  },
  {
    id: "group",
    label: "Group · Alpha calls",
    header: "Degen Alpha Lounge",
    body: (
      <>
        <ChatLine role="you">9BB6NF…pump</ChatLine>
        <ChatLine role="bot">
          <div className="text-white">🪙 MOONCAT ($MCAT)</div>
          <div className="mt-1 text-zinc-400">
            MC <span className="text-white">$1.2M</span> · LP{" "}
            <span className="text-white">$340K</span> ·{" "}
            <span className="text-accent">◎ Solana</span>
          </div>
          <div className="mt-1 text-zinc-400">
            🎯 <span className="text-white">First called by @degenwhale</span>
          </div>
          <div className="text-zinc-500">
            MC then $250K · now $1.2M ·{" "}
            <span className="text-emerald-300">🟢 +380%</span> · 2h ago
          </div>
        </ChatLine>
        <ChatLine role="you">/leaderboard</ChatLine>
        <ChatLine role="bot" alert>
          <div className="text-white">📊 Caller Leaderboard</div>
          <div className="mt-1 text-zinc-400">
            🥇 <span className="text-white">@degenwhale</span> ·{" "}
            <span className="text-emerald-300">+412% avg</span> · 8 calls
          </div>
          <div className="text-zinc-400">
            🥈 <span className="text-white">@solmaxi</span> ·{" "}
            <span className="text-emerald-300">+180% avg</span> · 5 calls
          </div>
          <div className="text-zinc-400">
            🥉 <span className="text-white">@apedegen</span> ·{" "}
            <span className="text-emerald-300">+95% avg</span> · 12 calls
          </div>
        </ChatLine>
      </>
    ),
  },
];

export function HeroDemo() {
  const [active, setActive] = useState(0);

  // Auto-rotate; re-arming on every scene change means a manual tab click
  // also gets a full interval before the next auto-advance.
  useEffect(() => {
    const id = setInterval(
      () => setActive((a) => (a + 1) % scenes.length),
      ROTATE_MS,
    );
    return () => clearInterval(id);
  }, [active]);

  const scene = scenes[active];

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-panel/80 p-1 shadow-2xl backdrop-blur">
      <div className="rounded-xl border border-border/70 bg-black/60 p-5">
        <div className="flex items-center justify-between gap-2 border-b border-border/60 pb-3">
          <div className="flex items-center gap-2">
            <div className="flex gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-red-500/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-yellow-500/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/70" />
            </div>
            <span className="ml-3 text-xs text-muted">{scene.header}</span>
          </div>
          <div className="flex gap-1">
            {scenes.map((s, i) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setActive(i)}
                className={`rounded-full border px-2.5 py-1 text-[10px] font-medium transition-colors ${
                  i === active
                    ? "border-accent-2/50 bg-accent-2/15 text-white"
                    : "border-border bg-transparent text-muted hover:text-white"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <div
          key={scene.id}
          className="demo-fade mt-4 min-h-[300px] space-y-3 font-mono text-[12px] leading-relaxed"
        >
          {scene.body}
        </div>
      </div>
    </div>
  );
}

function ChatLine({
  role,
  children,
  alert,
}: {
  role: "you" | "bot";
  children: React.ReactNode;
  alert?: boolean;
}) {
  const isYou = role === "you";
  return (
    <div className={`flex ${isYou ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3 py-2 ${
          isYou
            ? "bg-white/10 text-white"
            : alert
              ? "border border-emerald-500/30 bg-emerald-500/5 text-zinc-200"
              : "bg-panel-2 text-zinc-200"
        }`}
      >
        {children}
      </div>
    </div>
  );
}
