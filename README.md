# Solana Wallet Tracker - Monorepo

A comprehensive Solana wallet tracking system with a Telegram bot backend and Next.js frontend.

## Project Structure

```
solana-wallet-tracker/
├── backend/          # NestJS Telegram bot
├── frontend/         # Next.js web application
├── package.json      # Root workspace configuration
└── pnpm-workspace.yaml
```

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm
- PostgreSQL database

### Installation

```bash
# Install all dependencies
pnpm install

# Setup backend environment
cp backend/.env.example backend/.env
# Edit backend/.env with your configuration
```

### Development

```bash
# Run both backend and frontend in parallel
pnpm dev

# Run backend only
pnpm dev:backend

# Run frontend only
pnpm dev:frontend
```

### Build

```bash
# Build both projects
pnpm build

# Build backend only
pnpm build:backend

# Build frontend only
pnpm build:frontend
```

### Production

```bash
# Start backend in production mode
pnpm start:prod:backend

# Start frontend in production mode
pnpm start:frontend
```

## Backend (Telegram Bot)

The backend is a NestJS application that provides:

- Real-time Solana wallet tracking via WebSocket
- Telegram bot interface for managing wallets
- Token information lookup with DexScreener & RugCheck
- Group chat support with trending tokens
- Per-wallet configuration (pause, min trade size, labels)

**Key Commands:**

- `/start` - Start the bot
- `/watch <address>` - Watch a Solana wallet
- `/unwatch <address>` - Stop watching a wallet
- `/list` - List all watched wallets
- `/trending` - Show trending tokens (groups only)

## Frontend (Next.js)

The frontend is a Next.js application with:

- TypeScript
- Tailwind CSS
- App Router
- Turbopack for fast builds

## Available Scripts

### Root Level

- `pnpm dev` - Start both apps in development mode
- `pnpm build` - Build both apps
- `pnpm lint` - Lint all projects
- `pnpm dev:backend` - Start backend only
- `pnpm dev:frontend` - Start frontend only
- `pnpm build:backend` - Build backend only
- `pnpm build:frontend` - Build frontend only

### Backend Specific

```bash
cd backend
pnpm prisma:generate    # Generate Prisma client
pnpm prisma:migrate     # Run migrations
```

## Environment Variables

### Backend

Required environment variables (see `backend/.env.example`):

- `DATABASE_URL` - PostgreSQL connection string
- `TELEGRAM_BOT_TOKEN` - Telegram bot token from BotFather
- `BOT_USERNAME` - Telegram bot username
- `HELIUS_RPC_URL` - Helius RPC endpoint (with WebSocket support)
- `HELIUS_API_KEY` - Helius API key

## Database

The backend uses PostgreSQL with Prisma ORM. Migrations are located in `backend/prisma/migrations/`.

## Deployment

Each app can be deployed independently:

- **Backend**: Deploy to any Node.js hosting (Railway, Heroku, etc.)
- **Frontend**: Deploy to Vercel, Netlify, or any Next.js-compatible host

## License

MIT
