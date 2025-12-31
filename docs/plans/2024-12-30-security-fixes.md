# Security Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Opraviť kritické bezpečnostné problémy v projekte Sentinel

**Architecture:** Odstránenie hardcoded credentials z dokumentácie, pridanie stricter rate limiting na auth endpoints, oprava bcrypt mock v testoch, podmienené zapnutie Swagger len pre dev/staging

**Tech Stack:** NestJS, @nestjs/throttler, Jest, bcryptjs

---

## Task 1: Odstrániť credentials z ARCHITECTURE.md

**Files:**
- Modify: `docs/ARCHITECTURE.md`
- Create: `apps/api/.env.example`
- Create: `apps/worker/.env.example`

**Step 1: Nahradiť reálne credentials placeholdermi v ARCHITECTURE.md**

Nahradiť tieto hodnoty:
- `n8n_password_2024` → `<DB_PASSWORD>`
- `sentinel_minio_2024_secure` → `<MINIO_SECRET_KEY>`
- `135.181.99.192` → `<SERVER_IP>`
- `sentinel_admin` → `<MINIO_USER>`

**Step 2: Vytvoriť apps/api/.env.example**

```env
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/sentinel?schema=public

# JWT
JWT_SECRET=your-32-character-minimum-secret-here
JWT_EXPIRES_IN=7d

# API
PORT=3000
API_PREFIX=api/v1
CORS_ORIGINS=http://localhost:3001

# Rate Limiting
THROTTLE_TTL=60
THROTTLE_LIMIT=100

# Environment
NODE_ENV=development
```

**Step 3: Vytvoriť apps/worker/.env.example**

```env
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/sentinel?schema=public

# Redis
REDIS_URL=redis://localhost:6379

# S3 Storage (MinIO)
S3_ENDPOINT=http://localhost:9000
S3_BUCKET=sentinel-storage
S3_ACCESS_KEY_ID=your-access-key
S3_SECRET_ACCESS_KEY=your-secret-key
S3_REGION=us-east-1

# Email (Resend)
RESEND_API_KEY=re_xxxxx
EMAIL_FROM=Sentinel <alerts@yourdomain.com>

# Screenshots
SCREENSHOT_ENABLED=true
```

**Step 4: Commit**

```bash
git add docs/ARCHITECTURE.md apps/api/.env.example apps/worker/.env.example
git commit -m "security: remove hardcoded credentials from documentation"
```

---

## Task 2: Pridať stricter rate limiting na auth endpoints

**Files:**
- Modify: `apps/api/src/auth/auth.controller.ts`

**Step 1: Importovať Throttle decorator**

Na začiatok súboru pridať:
```typescript
import { Throttle, SkipThrottle } from '@nestjs/throttler';
```

**Step 2: Pridať stricter rate limiting na login endpoint**

```typescript
@Post('login')
@Throttle({ default: { limit: 5, ttl: 60000 } }) // 5 pokusov za minútu
@HttpCode(HttpStatus.OK)
@ApiOperation({ summary: 'Authenticate user and return JWT token' })
```

**Step 3: Pridať stricter rate limiting na register endpoint**

```typescript
@Post('register')
@Throttle({ default: { limit: 3, ttl: 60000 } }) // 3 registrácie za minútu
@ApiOperation({ summary: 'Register a new user account' })
```

**Step 4: Pridať @SkipThrottle na /me endpoint (je chránený JWT)**

```typescript
@Get('me')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'))
```

**Step 5: Spustiť testy**

```bash
cd apps/api && pnpm test auth
```

**Step 6: Commit**

```bash
git add apps/api/src/auth/auth.controller.ts
git commit -m "security: add stricter rate limiting on auth endpoints"
```

---

## Task 3: Opraviť bcrypt mock v testoch

**Files:**
- Modify: `apps/api/src/auth/auth.service.spec.ts`

**Step 1: Opraviť mock z 'bcrypt' na 'bcryptjs'**

Zmeniť riadok 8:
```typescript
// OLD:
jest.mock('bcrypt', () => ({

// NEW:
jest.mock('bcryptjs', () => ({
```

**Step 2: Opraviť require statement**

Zmeniť riadok 13:
```typescript
// OLD:
const bcrypt = require('bcrypt');

// NEW:
const bcrypt = require('bcryptjs');
```

**Step 3: Spustiť testy a overiť že prechádzajú**

```bash
cd apps/api && pnpm test auth.service
```

Expected: Všetky testy PASS

**Step 4: Commit**

```bash
git add apps/api/src/auth/auth.service.spec.ts
git commit -m "fix: correct bcrypt mock to bcryptjs in auth tests"
```

---

## Task 4: Podmienené zapnutie Swagger (len dev/staging)

**Files:**
- Modify: `apps/api/src/main.ts`
- Modify: `apps/api/src/config/config.service.ts` (ak treba)

**Step 1: Pridať podmienku pre Swagger v main.ts**

Nahradiť Swagger sekciu (riadky 33-61):

```typescript
// Swagger documentation (only in development and staging)
const nodeEnv = configService.nodeEnv;
if (nodeEnv !== 'production') {
  const config = new DocumentBuilder()
    .setTitle('Sentinel API')
    .setDescription('Change Intelligence Platform REST API')
    .setVersion('0.0.1')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'JWT',
        description: 'Enter JWT token',
        in: 'header',
      },
      'JWT-auth',
    )
    .addTag('Health', 'Health check endpoints')
    .addTag('Auth', 'Authentication endpoints')
    .addTag('Users', 'User management endpoints')
    .addTag('Monitors', 'Monitor management endpoints')
    .addTag('Changes', 'Change detection endpoints')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup(`${configService.apiPrefix}/docs`, app, document, {
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  console.log(`📚 Swagger docs available at http://localhost:${port}/${configService.apiPrefix}/docs`);
}
```

**Step 2: Upraviť root redirect**

```typescript
// Root redirect
const httpAdapter = app.getHttpAdapter();
httpAdapter.get('/', (_req: any, res: any) => {
  if (nodeEnv !== 'production') {
    res.redirect(`/${configService.apiPrefix}/docs`);
  } else {
    res.json({ status: 'ok', message: 'Sentinel API' });
  }
});
```

**Step 3: Overiť že ConfigService má nodeEnv property**

Skontrolovať `apps/api/src/config/config.service.ts` - ak nemá `nodeEnv`, pridať:
```typescript
get nodeEnv(): string {
  return this.configService.get<string>('NODE_ENV') || 'development';
}
```

**Step 4: Commit**

```bash
git add apps/api/src/main.ts apps/api/src/config/config.service.ts
git commit -m "security: disable Swagger in production environment"
```

---

## Task 5: Vyčistiť .next-old priečinky

**Files:**
- Delete: `apps/web/.next-old-backup/`
- Delete: `apps/web/.next-old-2/`
- Modify: `apps/web/.gitignore`

**Step 1: Pridať do .gitignore**

Pridať do `apps/web/.gitignore`:
```
.next-old*/
```

**Step 2: Odstrániť priečinky**

```bash
rm -rf /Users/marianfabian/Projects/sentinel/apps/web/.next-old-backup
rm -rf /Users/marianfabian/Projects/sentinel/apps/web/.next-old-2
```

**Step 3: Commit**

```bash
git add apps/web/.gitignore
git commit -m "chore: clean up old Next.js build directories"
```

---

## Task 6: Opraviť typed Request v auth controller

**Files:**
- Modify: `apps/api/src/auth/auth.controller.ts`

**Step 1: Vytvoriť interface pre typed request**

Pridať pred @Controller:
```typescript
interface RequestWithUser extends Request {
  user: {
    id: string;
    email: string;
    createdAt: Date;
    lastLoginAt: Date | null;
  };
}
```

**Step 2: Použiť typed request**

Zmeniť:
```typescript
// OLD:
async getMe(@Req() req: any) {

// NEW:
async getMe(@Req() req: RequestWithUser) {
```

**Step 3: Pridať import Request**

```typescript
import { Request } from 'express';
```

**Step 4: Commit**

```bash
git add apps/api/src/auth/auth.controller.ts
git commit -m "refactor: add proper typing for request in auth controller"
```

---

## Záverečný krok: Rotácia secrets

**MANUÁLNE (mimo kód):**

1. Zmeniť heslo PostgreSQL databázy
2. Zmeniť MinIO access key a secret
3. Vygenerovať nový JWT_SECRET
4. Aktualizovať všetky .env súbory na serveri

---

## Sumár

| Task | Popis | Priorita |
|------|-------|----------|
| 1 | Odstrániť credentials z docs | KRITICKÁ |
| 2 | Rate limiting na auth | KRITICKÁ |
| 3 | Opraviť bcrypt mock | KRITICKÁ |
| 4 | Swagger len pre dev | VYSOKÁ |
| 5 | Vyčistiť .next-old | NÍZKA |
| 6 | Typed Request | NÍZKA |
