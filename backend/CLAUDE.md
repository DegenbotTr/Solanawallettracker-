# CLAUDE.md — Sol Wallet Watcher

> This file is the authoritative context document for AI assistants (Claude, Copilot, etc.) working on this codebase. Read it in full before making changes.

---

## Project Overview

**Sol Wallet Watcher** is a Telegram bot that monitors Solana wallets in real‑time and sends instant buy/sell alerts to users. It is built with **NestJS** and uses **Telegraf** for the Telegram integration and **@solana/web3.js** with the **Helius** RPC/WebSocket API for on‑chain monitoring.

### What it does

| Feature | Description |
|---|---|
| Real-time alerts | Subscribes to on-chain logs via WebSocket (`onLogs`) and fires on every confirmed trade |
| Portfolio snapshot | Fetches SPL token balances + SOL + USD value via Helius DAS API (`getAssetsByOwner`) |
| TX history | Retrieves and parses the last 10 transactions for any wallet |
| Token price | Looks up spot prices via Jupiter Price API v6 |
| Min-size filter | Per-user USD threshold; trades below threshold are silently dropped |
| Wallet labels | Users can assign human-readable names to watched wallets |
| Stats | Bot uptime, total users, active watchers, wallets tracked |
| Chain guard | Detects Ethereum / Bitcoin / Tron addresses and rejects them with a helpful message |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20+, TypeScript 5 |
| Framework | NestJS 10 (`@nestjs/common`, `@nestjs/core`, `@nestjs/config`) |
| Bot library | `nestjs-telegraf` v2 wrapping `telegraf` v4 |
| Solana SDK | `@solana/web3.js` v1 |
| RPC provider | Helius (mainnet RPC + WSS + DAS API) |
| Price data | CoinGecko (SOL price) · Jupiter Price API v6 (token prices) |
| Package manager | **pnpm** (always use `pnpm`, never npm/yarn) |
| Process manager | Heroku `Procfile` (`web: node dist/main`) |

---

## Repository Layout

```
src/
├── main.ts                  # Bootstrap: creates NestJS app, listens on port 3000
├── app.module.ts            # Root module — wires ConfigModule, TelegrafModule, BotModule, SolanaModule
├── bot/
│   ├── bot.module.ts        # Imports SolanaModule; declares BotUpdate
│   └── bot.update.ts        # ALL Telegram command/action/text handlers (Update class)
└── solana/
    ├── solana.module.ts     # Declares + exports SolanaService
    └── solana.service.ts    # All Solana logic: wallet watch, portfolio, TX parsing, alerts
```

**There is no database.** All state (watched wallets, labels, min-trade sizes, user list) is held entirely in **in-process Maps**. A restart clears all user state. Wallets listed in `WATCHED_WALLETS` env var are re-subscribed on startup.

---

## Environment Variables

Defined in `.env` (copy from `.env.example`):

| Variable | Required | Description |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | ✅ | Bot token from [@BotFather](https://t.me/BotFather) |
| `HELIUS_API_KEY` | ✅ | API key from [helius.dev](https://helius.dev) — used for both RPC/WSS and DAS API |
| `WATCHED_WALLETS` | ❌ | Comma-separated Solana addresses to watch on startup (no user chat tied) |

---

## Development Commands

```bash
pnpm install            # Install dependencies

pnpm run start:dev      # Watch mode (ts-node + nest watch) — use during development
pnpm run start          # Start without watch
pnpm run build          # Compile TypeScript → dist/
pnpm run start:prod     # Run compiled output (production)
```

> ⚠️ There are currently **no test scripts configured** in `package.json` beyond the stubs in `test/`. Do not run `pnpm run test` expecting output.

---

## Architecture & Key Design Decisions

### 1. Single-service Solana layer (`SolanaService`)

`SolanaService` owns the Helius WebSocket connection and all wallet subscriptions. It implements `OnModuleInit` / `OnModuleDestroy` to set up and tear down WebSocket listeners cleanly.

```
onModuleInit()
  → reads HELIUS_API_KEY from ConfigService
  → creates Connection(rpcUrl, { wsEndpoint: wsUrl, commitment: 'confirmed' })
  → re-subscribes any WATCHED_WALLETS from env

onModuleDestroy()
  → calls connection.removeOnLogsListener(subId) for every active subscription
```

### 2. Wallet watch/unwatch lifecycle

- `watchWallet(address, chatId)` — validates the address as a valid `PublicKey`, registers `connection.onLogs(...)`, stores `{ subId, chatIds: Set<number> }` in `watchedWallets` Map.
- Multiple users can watch the same wallet — they share a **single subscription**; `chatIds` accumulates all subscribers.
- `unwatchWallet(address, chatId)` — removes the chatId from the set; only removes the WebSocket subscription when the set is empty.

### 3. Trade detection logic (`detectAction`)

For each incoming log signature, the service fetches the parsed transaction and applies this heuristic:

1. Find the wallet's index in `accountKeys`.
2. Compute `solChange = (postBalances[i] - preBalances[i]) / 1e9`.
3. If `solChange < -0.001` → **BUY** (SOL left the wallet to buy a token).
4. If `solChange > 0.001` → **SELL** (SOL entered the wallet from selling a token).
5. Confirm by finding a changed SPL token balance in `postTokenBalances`.
6. Plain SOL transfers (no token change) are **ignored**.

### 4. Pending action state machine (`BotUpdate`)

Because Telegram is message-driven, multi-step flows (e.g. "watch wallet → paste address") use two module-level Maps:

```typescript
const pendingAction = new Map<number, PendingAction>();     // chatId → next expected action
const pendingLabelAddress = new Map<number, string>();      // chatId → address being labeled
```

The `@On('text')` handler reads and clears these maps. Commands that accept an inline argument (e.g. `/watch <address>`) bypass the pending-action flow entirely.

### 5. Inline keyboard pattern

Every reply uses `InlineKeyboardMarkup`. The persistent bottom keyboard (`ReplyKeyboardMarkup`) is shown only during `/start` and stays visible throughout the session. The inline menu is rebuilt fresh on each relevant callback.

### 6. External API usage

| API | Endpoint | Used for |
|---|---|---|
| Helius RPC | `https://mainnet.helius-rpc.com/?api-key=...` | All `@solana/web3.js` calls |
| Helius DAS | Same RPC URL with `getAssetsByOwner` JSON-RPC method | Portfolio fetch |
| CoinGecko | `api.coingecko.com/api/v3/simple/price?ids=solana` | SOL/USD price |
| Jupiter | `price.jup.ag/v6/price?ids=<mint>` | Token spot price |

All external fetches are best-effort; failures are caught and a user-friendly error is returned.

---

## Coding Conventions

- **TypeScript strict mode** is on (`tsconfig.json`). Avoid `any` except where the telegraf context shape requires it (e.g., `(ctx as any).match[1]`).
- **Decorators**: Use `nestjs-telegraf` decorators (`@Update`, `@Start`, `@Command`, `@Action`, `@On`) — do not call `bot.command(...)` imperatively anywhere.
- **Logging**: Use `new Logger(ClassName.name)` from `@nestjs/common`. Never use `console.log` in service files.
- **HTML parse mode**: All bot messages use `{ parse_mode: 'HTML' }`. Use `<b>`, `<i>`, `<code>`, and `<a href="...">` tags. Never use Markdown.
- **Formatting**: `.prettierrc` is present — run Prettier before committing. Config: `singleQuote: true`, `trailingComma: 'all'`, `printWidth: 80`.
- **ESLint**: `eslint.config.mjs` is present with `@typescript-eslint` rules.

---

## Common Patterns

### Adding a new slash command

1. Add the handler to `BotUpdate` in `src/bot/bot.update.ts`:
   ```typescript
   @Command('mycommand')
   async onMyCommand(@Ctx() ctx: Context): Promise<void> { ... }
   ```
2. Add a corresponding inline menu entry in `mainMenuKeyboard()` and a matching `@Action('menu_mycommand')` handler.
3. If the command needs user input, add the new action type to the `PendingAction` union type and handle it in the `@On('text')` handler.
4. Add the command name to the help text in `onHelp()` and `onMenuHelp()`.

### Adding a new Solana data feature

1. Add the method to `SolanaService` in `src/solana/solana.service.ts`.
2. Inject `SolanaService` into `BotUpdate` (already injected via constructor).
3. Call the service method from the relevant command or action handler.

### Adding a persistent keyboard button

Add the button text to `persistentKeyboard` in `bot.update.ts` and add a matching `if (text === '...')` branch at the top of `@On('text')`.

---

## State & Persistence Caveats

> ⚠️ **All state is in-memory.** Restarting the process loses all watched wallets, labels, and user filters.

If you add persistence (Redis, SQLite, etc.), these are the Maps to persist:

| Map | Key | Value |
|---|---|---|
| `SolanaService.watchedWallets` | wallet address | `{ subId, chatIds }` |
| `walletLabels` (module-level) | chatId | Map of address → label |
| `minTradeSize` (module-level) | chatId | USD threshold number |
| `allUsers` (module-level) | chatId | `{ username, firstSeen, lastSeen }` |

Note: `subId` values from WebSocket are not serializable — on restore, re-call `watchWallet()` to get fresh subscription IDs.

---

## Deployment

The project uses a **Heroku `Procfile`**:
```
web: node dist/main
```

Typical deploy flow:
```bash
pnpm run build          # Compile TypeScript
# Set env vars on Heroku dashboard or via heroku config:set
git push heroku main    # Deploy
```

The app binds to `port 3000` (hardcoded in `main.ts`). Heroku expects `process.env.PORT` — update `main.ts` if needed:
```typescript
await app.listen(process.env.PORT || 3000);
```

---

## Known Limitations & Future Work

- **No persistence** — restart wipes all user data.
- **No pagination** — wallet list, portfolio, and TX history are capped (50 tokens, 10 txs).
- **Token symbol lookup is partial** — symbol comes from `content.metadata.symbol` or `token_info.symbol`; some obscure tokens show a truncated mint address.
- **Price data may lag** — CoinGecko free tier is rate-limited; heavy usage may hit 429 errors.
- **No rate limiting** — a user could spam commands and trigger many RPC calls simultaneously.
- **`validateWallet` is not called in `watchWallet`** — the two methods are separate; only the bot command flow uses the validator.
- **Platform** — Solana mainnet only. Devnet/testnet is not supported.
