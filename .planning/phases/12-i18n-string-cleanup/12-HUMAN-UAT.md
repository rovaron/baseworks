---
status: partial
phase: 12-i18n-string-cleanup
source: [12-VERIFICATION.md]
started: 2026-04-14T19:35:00Z
updated: 2026-04-14T19:35:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Team invite email renders in Portuguese end-to-end
expected: An invite sent while the inviter has `NEXT_LOCALE=pt-BR` arrives with Portuguese subject ("Você foi convidado para uma equipe"), heading, body, CTA button ("Aceitar Convite"), and footer. Requires running Redis + BullMQ worker + Resend API key.
result: [pending]

### 2. Skip link label renders in Portuguese in all three layouts
expected: With `NEXT_LOCALE=pt-BR` cookie set, tabbing into `apps/web (auth)`, `apps/web (dashboard)`, and `apps/admin` shows the focused skip link reading "Pular para o conteúdo". Requires browser rendering with the `:focus` state.
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
