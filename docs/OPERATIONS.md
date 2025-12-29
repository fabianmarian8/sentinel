# Sentinel - Operačná príručka

Príručka pre správu a údržbu Sentinel servera.

## Server prístup

```bash
ssh root@135.181.99.192
```

---

## Rýchle príkazy

### Status všetkých služieb

```bash
systemctl status sentinel-api sentinel-worker sentinel-web redis-server cloudflare-tunnel
```

### Reštart služieb

```bash
# Všetky Sentinel služby
systemctl restart sentinel-api sentinel-worker sentinel-web

# Jednotlivé
systemctl restart sentinel-worker
systemctl restart sentinel-api
```

### Logy (real-time)

```bash
# Worker logy
journalctl -u sentinel-worker -f

# API logy
journalctl -u sentinel-api -f

# Posledných 100 riadkov
journalctl -u sentinel-worker -n 100
```

---

## Docker kontajnery

### Štart/Stop

```bash
cd /root/n8n

# Štart všetkých
docker compose up -d

# Stop všetkých
docker compose down

# Reštart jednotlivého
docker compose restart minio
docker compose restart postgres
docker compose restart flaresolverr
```

### Logy

```bash
# Všetky kontajnery
docker compose logs -f

# Jednotlivý
docker compose logs -f minio
docker compose logs -f flaresolverr
```

### Status

```bash
docker ps
```

---

## Databáza (PostgreSQL)

### Pripojenie

```bash
docker exec -it n8n-postgres-1 psql -U n8n -d sentinel
```

### Užitočné queries

```sql
-- Počet pravidiel
SELECT COUNT(*) FROM rules;

-- Pravidlá s chybami
SELECT id, name, last_error_code, last_error_at
FROM rules
WHERE last_error_code IS NOT NULL;

-- Posledné behy
SELECT r.id, ru.name, r.started_at, r.error_code, r.fetch_mode_used
FROM runs r
JOIN rules ru ON r.rule_id = ru.id
ORDER BY r.started_at DESC
LIMIT 20;

-- Alerty za posledných 24h
SELECT * FROM alerts
WHERE triggered_at > NOW() - INTERVAL '24 hours'
ORDER BY triggered_at DESC;
```

---

## Redis

### Pripojenie

```bash
redis-cli
```

### Užitočné príkazy

```bash
# Ping test
redis-cli ping

# Všetky fronty
redis-cli keys "bull:*"

# Počet jobov vo fronte
redis-cli llen "bull:rules:run:waiting"

# Vyčistiť frontu (POZOR!)
redis-cli del "bull:rules:run:waiting"
```

---

## MinIO (S3 Storage)

### Prístup

| Spôsob | URL |
|--------|-----|
| Console | https://minio.taxinearme.sk |
| S3 API | https://storage.taxinearme.sk |

**Credentials:**
- User: `sentinel_admin`
- Password: `sentinel_minio_2024_secure`

### CLI (mc)

```bash
# Konfigurácia
mc alias set local http://localhost:9000 sentinel_admin sentinel_minio_2024_secure

# List buckets
mc ls local/

# List files
mc ls local/sentinel-storage/

# Download súbor
mc cp local/sentinel-storage/rules/xxx/runs/yyy/screenshot.png ./
```

---

## Deployment

⚠️ **DÔLEŽITÉ:** Vždy používaj `git pull`, **NIKDY** `rsync`! Rsync prepíše .env súbory a spôsobí výpadky.

### Worker update

```bash
cd /root/sentinel
git pull
pnpm install
pnpm --filter @sentinel/worker build
systemctl restart sentinel-worker
```

### API update

```bash
cd /root/sentinel
git pull
pnpm install
pnpm --filter @sentinel/api build
systemctl restart sentinel-api
```

### Database migrácia

```bash
cd /root/sentinel/packages/shared
npx prisma migrate deploy
```

### Referenčná konfigurácia worker .env

```bash
# /root/sentinel/apps/worker/.env
NODE_ENV=production
DATABASE_URL=postgresql://n8n:n8n_password_2024@localhost:5432/sentinel?schema=public
REDIS_URL=redis://localhost:6379
PUPPETEER_HEADLESS=true
PUPPETEER_TIMEOUT=30000
PROXY_URL=
ENCRYPTION_KEY=sentinel-super-secret-encryption-key-32-chars-min
S3_BUCKET=sentinel-storage
S3_ENDPOINT=https://storage.taxinearme.sk
S3_ACCESS_KEY_ID=sentinel_admin
S3_SECRET_ACCESS_KEY=sentinel_minio_2024_secure
S3_REGION=us-east-1
S3_FORCE_PATH_STYLE=true
```

### Referenčná konfigurácia API .env

```bash
# /root/sentinel/apps/api/.env
NODE_ENV=production
DATABASE_URL=postgresql://n8n:n8n_password_2024@localhost:5432/sentinel?schema=public
REDIS_URL=redis://localhost:6379
JWT_SECRET=<NIKDY NEMENIŤ!>
ENCRYPTION_KEY=sentinel-super-secret-encryption-key-32-chars-min
PORT=3000
```

---

## Cloudflare Tunnel

### Konfigurácia

```bash
cat /root/.cloudflared/config.yml
```

### Reštart

```bash
systemctl restart cloudflare-tunnel
```

### Status

```bash
cloudflared tunnel info hetzner-server
```

---

## Troubleshooting

### Worker nereaguje

1. Skontroluj status:
   ```bash
   systemctl status sentinel-worker
   ```

2. Skontroluj Redis:
   ```bash
   redis-cli ping
   systemctl restart redis-server
   ```

3. Pozri logy:
   ```bash
   journalctl -u sentinel-worker -n 50
   ```

### Screenshots sa neukladajú

1. Skontroluj MinIO:
   ```bash
   docker ps | grep minio
   ```

2. Over credentials v worker .env:
   ```bash
   cat /root/sentinel/apps/worker/.env | grep S3
   ```

3. Testuj S3 prístup:
   ```bash
   mc ls local/sentinel-storage/
   ```

### FlareSolverr nefunguje

1. Status:
   ```bash
   docker ps | grep flare
   ```

2. Reštart:
   ```bash
   docker restart flaresolverr
   ```

3. Test:
   ```bash
   curl http://localhost:8191/v1
   ```

### "Could not connect to API" v Dashboard

**Príčina:** JWT token v browseri je neplatný (napr. po zmene JWT_SECRET na serveri).

**Príznaky:**
- Dashboard zobrazuje "Could not connect to API"
- V console: `Error: Unauthorized`
- API health check (`curl https://sentinel.taxinearme.sk/api/health`) funguje

**Riešenie:**
1. Odhlásiť sa z dashboardu (kliknúť na logout ikonu)
2. Znova sa prihlásiť

**Prevencia:**
- Pri deployi **NIKDY** meniť `JWT_SECRET` v .env
- Ak sa zmení, všetci používatelia musia znova prihlásiť

---

### Frontend nefunguje (Cloudflare Pages)

**Príčina:** Browser cache alebo zlá konfigurácia API URL.

**Riešenie:**
1. Pozri `apps/web/DEPLOYMENT-FIX.md`
2. Deploy:
   ```bash
   cd apps/web
   npx @cloudflare/next-on-pages
   npx wrangler pages deploy .vercel/output/static --project-name=sentinel-app --branch=main
   ```
3. Hard refresh: `Cmd+Shift+R`

**API URL konfigurácia:**
- Nastavená v `apps/web/next.config.js` → `env.NEXT_PUBLIC_API_URL`
- Default: `https://sentinel.taxinearme.sk/api`

---

### Screenshots sa neukladajú (po reštarte workera)

**Príčina:** Worker .env nemá správnu S3 konfiguráciu, alebo systemd neloaduje .env súbor.

**Príznaky:**
- V logoch: `S3 storage not configured`
- Alebo: `The specified bucket does not exist`

**Riešenie:**
1. Skontroluj worker .env:
   ```bash
   cat /root/sentinel/apps/worker/.env | grep S3
   ```

2. Musí obsahovať (pre MinIO) - **POZOR na S3_ENDPOINT!**:
   ```
   S3_BUCKET=sentinel-storage
   S3_ENDPOINT=https://storage.taxinearme.sk
   S3_ACCESS_KEY_ID=sentinel_admin
   S3_SECRET_ACCESS_KEY=sentinel_minio_2024_secure
   S3_REGION=us-east-1
   S3_FORCE_PATH_STYLE=true
   ```

3. Skontroluj systemd service:
   ```bash
   cat /etc/systemd/system/sentinel-worker.service | grep EnvironmentFile
   ```
   Musí obsahovať: `EnvironmentFile=/root/sentinel/apps/worker/.env`

4. Reštartuj worker:
   ```bash
   systemctl daemon-reload
   systemctl restart sentinel-worker
   ```

**DÔLEŽITÉ:**
- `S3_FORCE_PATH_STYLE=true` je povinný pre MinIO!
- `S3_ENDPOINT` musí byť **verejná URL** (`https://storage.taxinearme.sk`), nie `localhost:9000`!

---

### Screenshot URL ukazuje na localhost (nefunguje v browseri)

**Príčina:** `S3_ENDPOINT` v worker .env je nastavený na `http://localhost:9000` namiesto verejnej URL.

**Príznaky:**
- V browseri "ERR_CONNECTION_REFUSED" pri otváraní screenshotu
- URL obsahuje `localhost:9000`

**Riešenie:**
1. Oprav S3_ENDPOINT v worker .env:
   ```bash
   sed -i 's|S3_ENDPOINT=http://localhost:9000|S3_ENDPOINT=https://storage.taxinearme.sk|' /root/sentinel/apps/worker/.env
   systemctl restart sentinel-worker
   ```

2. Oprav existujúce URL v databáze:
   ```bash
   docker exec n8n-postgres-1 psql -U n8n -d sentinel -c "
   UPDATE runs
   SET screenshot_path = REPLACE(screenshot_path, 'http://localhost:9000', 'https://storage.taxinearme.sk')
   WHERE screenshot_path LIKE '%localhost:9000%';
   "
   ```

---

### CAPTCHA warning na pravidle bez CAPTCHA

**Príčina:** Systém nastavuje `captcha_interval_enforced=true` keď použije FlareSolverr, ale FlareSolverr sa používa aj pre iné ochrany (Cloudflare JS challenge), nie len CAPTCHA.

**Príznaky:**
- Pravidlo zobrazuje "Interval zmenený na 1 deň (CAPTCHA ochrana)"
- Ale stránka nemá CAPTCHA, len Cloudflare ochranu

**Diagnóza:**
```bash
# Over či stránka naozaj potrebuje FlareSolverr
curl -s -o /dev/null -w '%{http_code}' 'https://example.com/' \
  -H 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
```
Ak vráti 200, stránka nepotrebuje FlareSolverr.

**Riešenie:**
```bash
docker exec n8n-postgres-1 psql -U n8n -d sentinel -c "
-- Nájdi pravidlo podľa domény
SELECT r.id, r.name, s.domain, r.captcha_interval_enforced
FROM rules r JOIN sources s ON r.source_id = s.id
WHERE s.domain LIKE '%example%';

-- Reset CAPTCHA flag pre konkrétne pravidlo
UPDATE rules
SET captcha_interval_enforced = false,
    schedule = original_schedule,
    original_schedule = NULL
WHERE id = 'RULE_ID_HERE';
"
```

---

### CAPTCHA interval sa nezmení na 1 deň

**Príčina:** Flag `captcha_interval_enforced` bol nastavený starým kódom pred fixom.

**Príznaky:**
- Dashboard ukazuje "Interval zmenený na 1 deň" ale reálny interval je stále 5 min
- V DB: `captcha_interval_enforced=true` ale `interval_sec=300`

**Riešenie:**
```bash
docker exec n8n-postgres-1 psql -U n8n -d sentinel -c "
UPDATE rules
SET schedule = jsonb_set(schedule::jsonb, '{intervalSeconds}', '86400')::json,
    next_run_at = NOW() + INTERVAL '1 day'
WHERE captcha_interval_enforced = true
  AND (schedule->>'intervalSeconds')::int < 86400;
"
```

---

### Databáza nedostupná

1. Status PostgreSQL:
   ```bash
   docker ps | grep postgres
   ```

2. Reštart:
   ```bash
   cd /root/n8n && docker compose restart postgres
   ```

3. Logy:
   ```bash
   docker logs n8n-postgres-1
   ```

---

## Zálohovanie

### Databáza

```bash
docker exec n8n-postgres-1 pg_dump -U n8n sentinel > backup-$(date +%Y%m%d).sql
```

### MinIO data

```bash
mc mirror local/sentinel-storage/ ./backup-storage/
```

---

## Kontakty

- **Server:** Hetzner Cloud
- **DNS/CDN:** Cloudflare
- **Monitoring:** N8N (https://n8n.taxinearme.sk)

---

*Posledná aktualizácia: 29. december 2025*
