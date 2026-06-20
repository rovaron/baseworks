# Image transform failures — variants not being generated

> Source alert: [docs/alerts/sentry/image-transform-failure-rate.json](../alerts/sentry/image-transform-failure-rate.json)

## Trigger

A spike of `file.transform-failed` events / `image-transform` queue job failures. The Sentry issue alert `image-transform-failure-rate` fires when the `file.transform-failed` event frequency exceeds the configured threshold in a 5-minute window (Phase 31 / OPS-03). Maps to `docs/alerts/sentry/image-transform-failure-rate.json`.

## Symptoms

- Uploaded images complete (`status='ready'` or `'uploaded'`) but their variants are missing: `files.transforms` is an empty `[]` for affected rows.
- `/health/detailed` `data.queues[]` shows the `image-transform` queue with a rising `failed` count.
- Worker pino logs show `Job handler error` / `Job failed` for queue `image-transform`, and the ErrorTracker captures exceptions tagged `queue=image-transform`.
- Decompression-bomb defenses fire as structured `file.transform-failed` + `status='failed'` (NOT a crash): a `> 50_000_000`-pixel source is refused pre-decode, and a `> 20 MB` byte cap is refused earlier.
- On an Alpine/musl base image: the worker fails to load `sharp`'s native binding at all (every transform job throws on import).

## Triage

> These commands assume `docker-compose.yml` from the repo root. K8s / PaaS users translate to `kubectl exec` / equivalent.

1. `curl -s -H "cookie: <owner session>" http://localhost:3000/health/detailed | jq '.data.queues[] | select(.name=="image-transform")'` — confirm the `failed` count is climbing.
2. `docker compose logs worker --tail 200 | grep -i transform` — look for the failure class: native-binding load error (sharp), decode/encode error, `putObject` failure (storage), or the structured bomb refusal.
3. Confirm the worker base image: `docker compose exec worker cat /etc/os-release | head -1`. `sharp` needs **glibc** (Debian) — see [file-storage.md](../integrations/file-storage.md). On Alpine/musl the prebuilt binary will not load.
4. Check `IMAGE_TRANSFORM_PROVIDER`: `docker compose exec worker printenv IMAGE_TRANSFORM_PROVIDER` (default `sharp`).
5. Inspect a failed file: `docker compose exec postgres psql -U baseworks -d baseworks -c "SELECT id, mime_type, byte_size, status, transforms FROM files WHERE status='failed' ORDER BY updated_at DESC LIMIT 5;"`.

## Resolution

### Most likely: sharp native binding unavailable (wrong base image)

`sharp` works under Bun on a **Debian/glibc** base (`oven/bun:1-debian-slim`), NOT on Alpine/musl (Phase 28 spike fact). Pin the worker base image to Debian — see the Docker base-image section of [file-storage.md](../integrations/file-storage.md) — and redeploy. To restore service immediately on a host where glibc is impossible, switch to the pure-JS fallback:

```bash
# Set in the worker environment, then restart the worker:
IMAGE_TRANSFORM_PROVIDER=imagescript
```

`imagescript` is slower and produces larger output but needs no native binding.

### Decode/encode errors on specific files

A single corrupt or unsupported source fails its own job (atomic per-job policy: one variant failing fails the whole job, no partial manifest); a BullMQ retry regenerates ALL variants under the same deterministic keys (net-zero byte delta, no double-count). These are expected for hostile/corrupt inputs and self-heal — no action unless the rate is high.

### Decompression-bomb 413s / structured failures

If legitimate large images are being refused, tune the limits cautiously. The pixel ceiling (`50_000_000`) and byte cap are deliberate defenses; raising them increases worker memory/DoS exposure. SVG is intentionally never transformed (librsvg SSRF/XSS surface) — that is by design, not a bug.

### Storage `putObject` failures

If the transform decodes fine but the variant write fails, the object store is the problem — see [s3-unreachable.md](./s3-unreachable.md).

## Escalation

If stuck longer than 30 minutes:

- Open an issue with the worker `/etc/os-release`, `IMAGE_TRANSFORM_PROVIDER`, a sample failed `files` row, and the worker log excerpt.
- Check upstream sharp issues — https://github.com/lovell/sharp/issues — for Bun/native-binding regressions.
- If switching to `imagescript` as a stopgap, note it in the incident so the Debian base-image fix is still tracked.

See also:

- [s3-unreachable.md](./s3-unreachable.md) — the transform worker must `getObject` the source and `putObject` the variants; an unreachable object store presents as transform failures.
