import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { bots, getBot } from "@/lib/bots";

export function generateStaticParams() {
  return bots.map((bot) => ({ slug: bot.slug }));
}

export async function generateMetadata(
  props: PageProps<"/bots/[slug]">,
): Promise<Metadata> {
  const { slug } = await props.params;
  const bot = getBot(slug);
  if (!bot) return { title: "Bot not found — DegenHub" };
  return {
    title: `${bot.name} — DegenHub`,
    description: bot.tagline,
  };
}

const statusLabel = {
  live: "Live",
  beta: "Beta",
  "coming-soon": "Coming soon",
};

export default async function BotDetailPage(props: PageProps<"/bots/[slug]">) {
  const { slug } = await props.params;
  const bot = getBot(slug);
  if (!bot) notFound();

  return (
    <div className="bg-background">
      {/* HEADER */}
      <section className="relative overflow-hidden border-b border-border/60">
        <div className="grid-bg absolute inset-0 opacity-70" />
        <div className="pointer-events-none absolute inset-0 opacity-70">
          <div className="absolute -top-40 left-1/4 h-80 w-96 rounded-full bg-accent/10 blur-3xl" />
          <div className="absolute top-10 right-1/4 h-60 w-96 rounded-full bg-accent-2/10 blur-3xl" />
        </div>

        <div className="relative mx-auto max-w-5xl px-6 pt-16 pb-16 sm:pt-24">
          <Link
            href="/bots"
            className="inline-flex items-center gap-2 text-xs text-muted hover:text-white"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-3 w-3"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M19 12H5M11 18l-6-6 6-6" />
            </svg>
            All bots
          </Link>

          <div className="mt-8 flex flex-col items-start justify-between gap-6 md:flex-row md:items-end">
            <div>
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest">
                <span className="text-accent">{bot.category}</span>
                <span className="text-border">•</span>
                <span className="text-muted">{bot.chain}</span>
                <span className="text-border">•</span>
                <span className="inline-flex items-center gap-1.5 text-muted">
                  <span
                    className={`h-1.5 w-1.5 rounded-full bg-emerald-400 ${bot.status === "live" ? "pulse-dot" : ""}`}
                  />
                  {statusLabel[bot.status]}
                </span>
              </div>
              <h1 className="mt-3 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                {bot.name}
              </h1>
              <p className="mt-4 max-w-xl text-base leading-relaxed text-zinc-400">
                {bot.description}
              </p>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <a
                href={bot.telegramUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-white px-5 text-sm font-semibold text-black hover:bg-zinc-200"
              >
                <TelegramIcon className="h-4 w-4" />
                Launch on Telegram
              </a>
              <a
                href={`${bot.telegramUrl}?start=help`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-border bg-panel px-5 text-sm font-medium text-white hover:border-white/20 hover:bg-panel-2"
              >
                See /help
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* CONTENT */}
      <section className="mx-auto max-w-5xl px-6 py-16">
        <div className="grid gap-8 lg:grid-cols-3">
          {/* Features */}
          <div className="lg:col-span-2">
            <SectionHeading eyebrow="What it does" title="Features" />
            <ul className="mt-6 grid gap-3 sm:grid-cols-2">
              {bot.features.map((feature) => (
                <li
                  key={feature}
                  className="flex gap-3 rounded-xl border border-border bg-panel p-4"
                >
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
                    <svg
                      viewBox="0 0 24 24"
                      className="h-3 w-3"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  </span>
                  <span className="text-sm leading-relaxed text-zinc-300">
                    {feature}
                  </span>
                </li>
              ))}
            </ul>

            {/* How to interact */}
            <div className="mt-14">
              <SectionHeading
                eyebrow="How to use it"
                title="Get started in 30 seconds"
              />
              <ol className="mt-6 space-y-3">
                <HowStep
                  step="1"
                  title="Open the bot"
                  body={
                    <>
                      Tap{" "}
                      <a
                        href={bot.telegramUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-white underline underline-offset-2 hover:text-accent"
                      >
                        {bot.telegramUrl.replace("https://t.me/", "@")}
                      </a>{" "}
                      or search for the handle inside Telegram.
                    </>
                  }
                />
                <HowStep
                  step="2"
                  title="Hit /start"
                  body="A pinned menu keyboard appears with every command one tap away. No signup, no wallet connection."
                />
                <HowStep
                  step="3"
                  title="Paste a Solana address"
                  body="Use /watch to subscribe. The bot validates the address, opens a WebSocket, and shares the subscription across all users watching the same wallet."
                />
                <HowStep
                  step="4"
                  title="Tune your filters"
                  body="Set /minsize in USD to silence dust trades, and /label wallets so alerts read like real names instead of hex."
                />
              </ol>
            </div>

            {/* Commands */}
            <div className="mt-14">
              <SectionHeading eyebrow="Reference" title="Every command" />
              <div className="mt-6 overflow-hidden rounded-2xl border border-border bg-panel">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-border bg-panel-2 text-[11px] uppercase tracking-widest text-muted">
                    <tr>
                      <th className="px-5 py-3 font-medium">Command</th>
                      <th className="px-5 py-3 font-medium">What it does</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bot.commands.map((cmd, i) => (
                      <tr
                        key={cmd.command}
                        className={
                          i === bot.commands.length - 1
                            ? ""
                            : "border-b border-border/60"
                        }
                      >
                        <td className="px-5 py-3 align-top">
                          <code className="font-mono text-xs text-emerald-300">
                            {cmd.command}
                          </code>
                        </td>
                        <td className="px-5 py-3 align-top text-zinc-300">
                          {cmd.description}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <aside className="space-y-6">
            <div className="rounded-2xl border border-border bg-panel p-6">
              <div className="text-[11px] font-semibold uppercase tracking-widest text-muted">
                Try it
              </div>
              <p className="mt-3 text-sm text-zinc-300">
                Fastest way to see the bot in action — open it in Telegram and
                paste any Solana wallet.
              </p>
              <a
                href={bot.telegramUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full bg-white px-4 py-2.5 text-sm font-semibold text-black hover:bg-zinc-200"
              >
                <TelegramIcon className="h-4 w-4" />
                Launch bot
              </a>
              <p className="mt-3 text-[11px] leading-relaxed text-muted">
                Read-only. No custody. No wallet signature required.
              </p>
            </div>

            <div className="rounded-2xl border border-border bg-panel p-6">
              <div className="text-[11px] font-semibold uppercase tracking-widest text-muted">
                Built with
              </div>
              <ul className="mt-4 flex flex-wrap gap-2">
                {bot.stack.map((tech) => (
                  <li
                    key={tech}
                    className="rounded-full border border-border bg-black/40 px-2.5 py-1 text-xs text-zinc-300"
                  >
                    {tech}
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-2xl border border-border bg-panel p-6">
              <div className="text-[11px] font-semibold uppercase tracking-widest text-muted">
                At a glance
              </div>
              <dl className="mt-4 space-y-3 text-sm">
                <InfoRow label="Category" value={bot.category} />
                <InfoRow label="Chain" value={bot.chain} />
                <InfoRow label="Status" value={statusLabel[bot.status]} />
                <InfoRow label="Cost" value="Free" />
              </dl>
            </div>
          </aside>
        </div>
      </section>

      <section className="border-t border-border/60 bg-panel/30">
        <div className="mx-auto max-w-3xl px-6 py-16 text-center">
          <h2 className="text-2xl font-semibold text-white sm:text-3xl">
            Want a different bot?
          </h2>
          <p className="mt-3 text-sm text-zinc-400 sm:text-base">
            The portfolio is growing. Browse the other bots or come back soon —
            new drops land regularly.
          </p>
          <div className="mt-6">
            <Link
              href="/bots"
              className="inline-flex h-10 items-center gap-2 rounded-full border border-border bg-panel px-5 text-xs font-medium text-white hover:border-white/20 hover:bg-panel-2"
            >
              See all bots
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

function SectionHeading({
  eyebrow,
  title,
}: {
  eyebrow: string;
  title: string;
}) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-widest text-accent">
        {eyebrow}
      </div>
      <h2 className="mt-2 text-2xl font-semibold text-white">{title}</h2>
    </div>
  );
}

function HowStep({
  step,
  title,
  body,
}: {
  step: string;
  title: string;
  body: React.ReactNode;
}) {
  return (
    <li className="flex gap-4 rounded-2xl border border-border bg-panel p-5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-black/40 text-xs font-semibold text-accent">
        {step}
      </span>
      <div>
        <div className="text-sm font-semibold text-white">{title}</div>
        <div className="mt-1 text-sm leading-relaxed text-zinc-400">{body}</div>
      </div>
    </li>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border/60 pb-2 last:border-none last:pb-0">
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium text-white">{value}</dd>
    </div>
  );
}

function TelegramIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M21.05 3.05 2.98 9.98c-1.23.48-1.22 1.16-.22 1.46l4.63 1.44 10.72-6.76c.51-.31.97-.14.59.2l-8.69 7.85-.34 5.05c.5 0 .72-.22 1-.5l2.4-2.34 4.98 3.68c.92.51 1.58.24 1.81-.85l3.28-15.46c.34-1.38-.53-2-1.42-1.7Z" />
    </svg>
  );
}
