# Sentinel - Change Intelligence Platform

Monitor, extract, and analyze critical changes from any web source.

## Project Structure

```
sentinel/
├── apps/
│   ├── api/          # NestJS REST API
│   ├── worker/       # BullMQ background worker
│   ├── web/          # Next.js dashboard (placeholder)
│   └── extension/    # Chrome MV3 extension (placeholder)
├── packages/
│   ├── shared/       # TypeScript types, DTOs, Prisma schema
│   ├── extractor/    # Web content extraction & normalization
│   ├── notify/       # Notification channels (Slack, email, webhooks)
│   └── storage/      # S3-compatible storage client
└── .loki/           # Loki Mode state and task management
```

## Tech Stack

- **Runtime:** Node.js 20+
- **Package Manager:** pnpm workspaces
- **Language:** TypeScript 5.x
- **Backend:** NestJS + BullMQ + Redis
- **Frontend:** Next.js 14
- **Database:** PostgreSQL + Prisma ORM
- **Storage:** S3-compatible object storage
- **Browser:** Chrome Manifest V3 extension

## Getting Started

### Prerequisites

- Node.js >= 20.0.0
- pnpm >= 9.0.0
- Docker & Docker Compose (for Redis, PostgreSQL)

### Installation

```bash
# Install dependencies
pnpm install

# Generate Prisma client
cd packages/shared
pnpm prisma:generate
```

### Development

```bash
# Run all apps in development mode
pnpm dev

# Run specific app
pnpm --filter @sentinel/api dev
pnpm --filter @sentinel/worker dev

# Build all packages and apps
pnpm build

# Run tests
pnpm test
```

## Workspace Commands

```bash
# Install dependency to specific workspace
pnpm --filter @sentinel/api add express

# Run command in all workspaces
pnpm -r build

# Run tests in parallel
pnpm --filter "./packages/*" --parallel test
```

## License

Proprietary - All Rights Reserved
