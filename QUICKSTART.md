# Quick Start Guide

## Monorepo Structure

```
Solanawallettracker-/
├── backend/              # Telegram bot (NestJS)
│   ├── src/             # Bot source code
│   ├── prisma/          # Database schema & migrations
│   ├── .env             # Backend environment variables
│   └── package.json     # Backend dependencies
├── frontend/            # Web app (Next.js)
│   ├── app/            # Next.js app router
│   └── package.json    # Frontend dependencies
├── package.json        # Root workspace scripts
└── pnpm-workspace.yaml # Workspace configuration
```

## Setup Steps

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Configure Backend

```bash
# Copy example env file
cp backend/.env.example backend/.env

# Edit backend/.env with your values:
# - DATABASE_URL
# - TELEGRAM_BOT_TOKEN
# - BOT_USERNAME
# - HELIUS_RPC_URL
# - HELIUS_API_KEY
```

### 3. Setup Database

```bash
cd backend
pnpm prisma:migrate
cd ..
```

### 4. Run Development

**Option A: Run both apps**

```bash
pnpm dev
```

**Option B: Run individually**

```bash
# Terminal 1 - Backend
pnpm dev:backend

# Terminal 2 - Frontend
pnpm dev:frontend
```

## Common Commands

### Development

- `pnpm dev` - Run both apps
- `pnpm dev:backend` - Run backend only (port 3000)
- `pnpm dev:frontend` - Run frontend only (port 3001)

### Build

- `pnpm build` - Build both apps
- `pnpm build:backend` - Build backend only
- `pnpm build:frontend` - Build frontend only

### Production

- `pnpm start:prod:backend` - Start backend (requires build first)
- `pnpm start:frontend` - Start frontend (requires build first)

### Database (from root)

```bash
cd backend
pnpm prisma:generate    # Generate Prisma client
pnpm prisma:migrate     # Run migrations
cd ..
```

## Verifying Setup

### Backend

```bash
pnpm build:backend
# Should complete without errors
```

### Frontend

```bash
pnpm build:frontend
# Should complete without errors
```

### Full Build

```bash
pnpm build
# Should build both projects successfully
```

## Troubleshooting

### Backend won't start

- Check `.env` file exists in `backend/`
- Verify DATABASE_URL is correct
- Run `cd backend && pnpm prisma:generate`

### Frontend won't start

- Clear `.next` folder: `rm -rf frontend/.next`
- Rebuild: `pnpm build:frontend`

### Database issues

- Check PostgreSQL is running
- Verify connection string in `backend/.env`
- Run migrations: `cd backend && pnpm prisma:migrate`

## Next Steps

1. **Backend**: Open Telegram and start a chat with your bot
2. **Frontend**: Customize the UI in `frontend/app/page.tsx`
3. **Deploy**: Each app can be deployed independently

## Resources

- Backend docs: `backend/README.md`
- Frontend docs: `frontend/README.md`
- Main README: `README.md`
