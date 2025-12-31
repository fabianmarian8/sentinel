# Security Fixes Session - 31.12.2024

## Oponent Review vykonaný
Agent Oponent (Opus) zrevidoval celý Sentinel projekt.

## P0 Opravy (Kritické)

### P0-1: Race Condition v Scheduler ✅
- **Súbor:** `apps/api/src/scheduler/scheduler.service.ts`
- **Problém:** Duplicitné spracovanie pravidiel pri overlapping ticks
- **Riešenie:** Atomic claim pattern - `updateMany` s `nextRunAt` check pred enqueue
- **Commit:** `4ac7f5b`

### P0-2: Optimistic Locking RuleState ✅
- **Súbor:** `apps/worker/src/processors/run.processor.ts`
- **Stav:** Už bolo implementované (verifikované)
- **Detaily:** Version check + retry logika (MAX_RETRIES=3)

### P0-3: UUID Validácia v DTOs ✅
- **Súbory:** 7 DTO súborov v `apps/api/src/**/dto/`
- **Riešenie:** Pridané `@IsUUID()` na všetky ID polia
- **Commit:** `2aff046`

## P1 Opravy (Vysoká priorita)

### P1-2: Key Derivation pre Šifrovanie ✅
- **Súbor:** `apps/api/src/notification-channels/notification-channels.service.ts`
- **Problém:** Priame použitie encryption key bez stretching
- **Riešenie:** scrypt (N=16384, r=8, p=1) + backward compatibility
- **Nový formát:** `salt:iv:authTag:ciphertext`
- **Commit:** `4e5a7e7`

## Zostávajúce z Oponent Review (P2/P3)

- [ ] N+1 query v Sources.findByWorkspace
- [ ] Rate limiting na triggerNow()
- [ ] Audit logging
- [ ] Slack token refresh
- [ ] SSE polling → Redis pub/sub

## Verifikácia
- Build API: ✅ Prechádza
- Build Worker: ✅ Prechádza
- Testy: Neoverené (odporúčané)
