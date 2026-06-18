# S3 / object store unreachable — storage adapter down

> Source alert: [docs/alerts/sentry/s3-unreachable.json](../alerts/sentry/s3-unreachable.json)

## Trigger

The storage health contributor reports `details.storage.adapter.reachable === false`, which rolls the storage contributor (and therefore `/health/detailed`) up to `unhealthy` (Phase 31 / OPS-03). The reachability probe is a short-timeout `stat()` of a sentinel key (`STORAGE_HEALTH_PROBE_MS`, default 1500ms); a network failure or a hung endpoint resolves to `reachable:false`. Maps to `docs/alerts/sentry/s3-unreachable.json`.

## Symptoms

- `/health/detailed` `data.storage.adapter.reachable` is `false`, `adapter.kind` is `object-store`, `data.storage.status` is `unhealthy`.
- `POST /api/files/sign-upload` may still succeed (signing is a local crypto op for presigned URLs), but the browser's PUT to the object store fails.
- `POST /api/files/:id/complete` fails: the server-authoritative `stat()` to verify byte size throws.
- `GET /api/files/:id/read-url` returns a URL that 5xx/times-out at the object store.
- The `image-transform` worker cannot `getObject` the source or `putObject` variants → transform jobs fail (see [image-transform-failure.md](./image-transform-failure.md)).
- API/worker logs show S3 SDK errors: `getaddrinfo ENOTFOUND`, `ECONNREFUSED`, `AccessDenied`, `SignatureDoesNotMatch`, `NoSuchBucket`, or TLS errors.

## Triage

> These commands assume `docker-compose.yml` from the repo root. K8s / PaaS users translate to `kubectl exec` / equivalent.

1. `curl -s -H "cookie: <owner session>" http://localhost:3000/health/detailed | jq '.data.storage.adapter'` — confirm `reachable=false` and read `detail` (a sanitized summary; never a key/secret).
2. Identify the provider: `docker compose exec api printenv STORAGE_PROVIDER` (`s3` | `s3-compat` | `local`).
3. Check credentials/endpoint presence (NAMES only, never echo values): `docker compose exec api sh -c 'for v in AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_REGION S3_BUCKET S3_ENDPOINT S3_FORCE_PATH_STYLE; do printf "%s=%s\n" "$v" "$([ -n "$(printenv $v)" ] && echo set || echo MISSING)"; done'`.
4. For `s3-compat` (MinIO/R2/Garage): confirm the endpoint container is up — `docker compose ps` — and reachable from the API container: `docker compose exec api sh -c 'curl -sS -o /dev/null -w "%{http_code}\n" "$S3_ENDPOINT" || echo unreachable'`.
5. Check egress / DNS from the API host to the bucket endpoint.

## Resolution

### Credentials or endpoint misconfiguration

A `SignatureDoesNotMatch` / `AccessDenied` means the key pair or region/endpoint is wrong; a `getaddrinfo ENOTFOUND` means DNS/endpoint is wrong. Fix the offending env var and restart the API + worker. `validateStorageEnv()` crash-checks for MISSING required vars at boot, but it cannot validate that the values are CORRECT.

### Bucket policy / CORS

If signed PUTs from the browser fail with 403 but server-side `stat()` works, the bucket CORS policy is the issue — see the per-backend CORS templates in [file-storage.md](../integrations/file-storage.md) and `bun run validate-cors`.

### Network egress

If the bucket is reachable from your laptop but not the API container, it is a network/security-group/egress problem. Open the required outbound 443 (or the MinIO/Garage port) from the API + worker.

### MinIO / self-hosted container down (s3-compat)

```bash
docker compose ps
docker compose up -d minio   # or your s3-compat service name
docker compose logs minio --tail 200 -f
```

## Escalation

If stuck longer than 30 minutes:

- Open an issue with `data.storage.adapter` JSON, `STORAGE_PROVIDER`, the env-presence table from step 3 (NAMES only — never paste secrets), and the API/worker log excerpt.
- For managed S3/R2, open a provider support ticket alongside debugging; check the provider status page.
- Do NOT switch `STORAGE_PROVIDER=local` in production to "fix" it — the local adapter is banned in production (`validateStorageEnv()` crash-hard, Pitfall 14) and is not durable.

See also:

- [redis-down.md](./redis-down.md) — if both the object store and Redis are unreachable, suspect a shared network/egress outage rather than two independent failures.
