# Sentinel API

NestJS backend API for Sentinel Change Intelligence Platform.

## Setup

1. Install dependencies:
```bash
pnpm install
```

2. Configure environment variables:
```bash
cp .env.example .env
# Edit .env with your configuration
```

3. Generate Prisma client:
```bash
pnpm prisma:generate
```

4. Run database migrations:
```bash
pnpm prisma:migrate
```

## Development

```bash
# Start development server
pnpm dev

# Run tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run tests with coverage
pnpm test:cov
```

## Build

```bash
# Build the application
pnpm build

# Start production server
pnpm start:prod
```

## API Documentation

When running in development mode, Swagger documentation is available at:
```
http://localhost:3000/api/docs
```

## Project Structure

```
src/
├── main.ts                 # Application entry point
├── app.module.ts          # Root module
├── app.controller.ts      # Root controller
├── config/                # Configuration module
│   ├── config.module.ts
│   ├── config.service.ts
│   └── env.validation.ts
├── prisma/                # Prisma database module
│   ├── prisma.module.ts
│   └── prisma.service.ts
└── common/                # Shared utilities
    ├── decorators/        # Custom decorators
    ├── filters/           # Exception filters
    ├── guards/            # Auth guards
    └── interceptors/      # Request/response interceptors
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | Environment (development/production/test) | development |
| `PORT` | Server port | 3000 |
| `DATABASE_URL` | PostgreSQL connection string | - |
| `JWT_SECRET` | Secret for JWT signing (min 32 chars) | - |
| `JWT_EXPIRATION` | JWT expiration time | 7d |
| `REDIS_URL` | Redis connection string | - |
| `API_PREFIX` | Global API prefix | api |
| `THROTTLE_TTL` | Rate limit time window (seconds) | 60 |
| `THROTTLE_LIMIT` | Max requests per TTL window | 10 |
| `CORS_ORIGINS` | Allowed CORS origins (comma-separated) | http://localhost:3000,http://localhost:5173 |
