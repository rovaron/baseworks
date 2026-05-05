# Pitfalls Research — File Storage & Signed Uploads (Baseworks v1.4)

**Domain:** File storage + signed direct uploads + image-transform pipeline in a multitenant Bun/Elysia/Drizzle/PostgreSQL/BullMQ SaaS starter kit
**Researched:** 2026-05-05
**Overall Confidence:** HIGH for stack-agnostic S3/sharp/multitenant pitfalls (well-documented territory); MEDIUM for Bun-specific items (sharp + AWS SDK v3 under Bun verified working in 2026 but require platform-specific spike before commitment)

---

## Phase Naming Convention

This document references generic v1.4 phase slots. The roadmapper will assign concrete phase numbers; references below use semantic slot names that should map to phases produced by `gsd-roadmapper`:

| Slot | Semantic | Typical Scope |
|------|----------|---------------|
| **PORT** | FileStorage port + scopedDb integration | `files` + `tenant_storage_usage` schema, port interface, tenant scoping rules |
| **ADAPTER-S3** | S3 + S3-compatible adapter | AWS SDK v3 client, signed URL generation, CORS docs |
| **ADAPTER-LOCAL** | Local filesystem adapter | Dev/self-host, proxied signing, named-volume docs |
| **SIGN-API** | Signing endpoints | `/api/files/sign-upload`, `/api/files/complete`, `/api/files/sign-read` |
| **TRANSFORM** | sharp pipeline + BullMQ jobs | Variant generation, decompression-bomb caps, async UX |
| **QUOTA** | Per-tenant storage usage | Counter + enforcement, reconciliation job |
| **CLEANUP** | Lifecycle + orphan reaping | Bucket lifecycle docs, orphan-file cleanup job |
| **UI-UPLOADER** | `packages/ui` Uploader component | Drag-drop, progress, preview, in both apps |
| **OPS** | Operations + docs | `/health/detailed` storage section, runbook, fork-user CORS guide |
| **TEST** | Integration test infrastructure | MinIO-in-CI, sharp-on-Bun smoke, adapter conformance |

---

## Critical Pitfalls

### Pitfall 1: Predictable storage keys leak content existence

**What goes wrong:**
Object keys derived from human-meaningful inputs (`tenants/{slug}/avatars/{userId}.jpg`, `invoices/inv_001.pdf`) become directly enumerable. An attacker who knows tenant slugs and user IDs can probe the bucket via signed-read endpoints to learn whether any particular avatar/invoice exists. Even with auth on the read endpoint, the *existence* signal leaks via 404-vs-403 differences and via successful HEAD on direct CDN URLs.

**Why it happens:**
The natural mental model is "store the file *as* its semantic identity." Developers conflate the database row's primary key (which can be guessable per-tenant) with the *storage key* (which faces the bucket and the CDN).

**Prevention:**
Storage keys MUST contain a server-generated unguessable component. Layout:

```
{env}/t/{tenantId}/{ownerModule}/{fileId}/{nanoid24}-{filenameSlug}.{ext}
                                ^^^^^^^^   ^^^^^^^^^
                                UUID v4    nanoid(24)
```

The `fileId` is the `files.id` UUID. The `nanoid(24)` segment makes the key unguessable even if the UUID leaks. Filename slug is for human-debuggability in the bucket browser only — never use unsanitized user input.

**Warning signs:**
- Storage keys constructible from public data (slugs, sequential IDs, email addresses)
- Code review reveals `key = \`${tenantSlug}/${userId}.jpg\``
- Read endpoint exposes consistent timing or status codes for "not found" vs "wrong tenant"

**Phase to address:** PORT (define the key-builder helper as part of the schema/port contract; make it impossible to construct a key without going through `buildStorageKey()`)

---

### Pitfall 2: Signed PUT without `Content-Type` + `Content-Length` constraints

**What goes wrong:**
Signed PUT URLs sign a method+key+expiry. If the client also controls `Content-Type` and `Content-Length`, they can:
1. Get a PUT URL signed for "user avatar (image/jpeg, 2 MB max)"
2. Upload a 500 MB ZIP at the same key
3. Server now hosts arbitrary content under a key the app trusts

The server's later "complete" call is too late — the bytes are already in the bucket, the bucket is paying egress, and if the key happens to be served via a CDN or as `image/*`, you have an XSS vector via SVG/HTML uploads.

**Why it happens:**
S3's PUT signature locks `Content-Type` only if you include it as a *signed header* via `SignableHeaders`. AWS SDK v3 `getSignedUrl` with `PutObjectCommand` requires you to pass `ContentType` AND tell the signer to include it. `Content-Length` cannot be enforced via PUT signature — only via POST policy `content-length-range`.

**Prevention:**
Use **signed POST policy** (not signed PUT) for uploads, with explicit conditions:

```ts
{
  conditions: [
    ["eq", "$bucket", BUCKET],
    ["eq", "$key", exactKey],                           // exact match, not starts-with
    ["eq", "$Content-Type", expectedMime],              // server-validated MIME
    ["content-length-range", 1, maxBytesForKind],       // hard size cap
    ["starts-with", "$x-amz-meta-tenant-id", tenantId], // bind to tenant
  ],
  expires: 300, // 5 min
}
```

If PUT is unavoidable (e.g., adapter doesn't support POST policies), refuse the upload during `complete` if `HEAD object` returns a `Content-Type` or `Content-Length` outside the agreed bounds, and `DeleteObject` immediately.

**Warning signs:**
- `getSignedUrl(s3, new PutObjectCommand({ Bucket, Key }))` with no `ContentType`/`ContentLength`
- Code review reveals signing function takes `{ key }` but no `{ mime, maxBytes }`
- E2E test: try uploading 100 MB to a URL signed for "1 MB avatar" — does it succeed?

**Phase to address:** SIGN-API (the signing endpoint design must default to POST policy with all 5 conditions; PUT path is escape hatch only)

---

### Pitfall 3: POST policy `$key` `starts-with` instead of `eq`

**What goes wrong:**
Common copy-paste pattern uses `["starts-with", "$key", "uploads/"]` to "let the client pick the filename." A malicious client picks `uploads/../../tenants/other-tenant/avatars/owner.jpg` (depending on bucket key normalization) or simply `uploads/very-large-file-1`, `uploads/very-large-file-2`, ... and floods the prefix.

**Why it happens:**
Almost every blog example uses `starts-with` because it's "more flexible." Devs copy-paste without realizing that *exact-match* on `$key` is what they actually want when the server already decided the key.

**Prevention:**
Server generates the full key during `/sign-upload` and pins it with `["eq", "$key", exactKey]`. The client never picks any part of the storage key. The original filename lives in the `files.original_filename` DB column, not in the storage key path.

**Warning signs:**
- Policy contains `starts-with` on `$key`
- Client request body to `/sign-upload` includes the desired key path
- Multiple files with similar prefixes appearing in the bucket from a single `/sign-upload` call

**Phase to address:** SIGN-API

---

### Pitfall 4: Trusting client-reported byte_size for quota math

**What goes wrong:**
Flow: client calls `/sign-upload` with `{ size: 1000000 }`, server checks quota, signs the URL. Client uploads a 500 MB file. Client calls `/complete` with `{ size: 1000000 }` (lying). Server increments `tenant_storage_usage.bytes_used` by 1 MB. Tenant now has 499 MB of unaccounted-for storage. Repeat → unbounded.

**Why it happens:**
The quota check at sign-time *is* needed (to reject before paying upload bandwidth). The bug is reusing the client's claimed size at `/complete` instead of fetching the truth from the storage backend.

**Prevention:**
At `/complete`, the server MUST `HeadObject` (or local stat) the actual storage key and use the returned `ContentLength` for both:
1. The DB `files.byte_size` column
2. The `tenant_storage_usage.bytes_used` increment

The client's claimed size at sign-time is used only for an *advisory* quota pre-check and to constrain the POST policy `content-length-range`. The post-upload HEAD is authoritative.

**Warning signs:**
- `/complete` handler signature includes `size: number` in the body schema
- Increment query reads `req.body.size` not the result of a HEAD call
- Quota-bypass test (claim 1 byte, upload max-bytes-for-kind worth) is missing or passes both ways

**Phase to address:** SIGN-API + QUOTA (jointly — `/complete` is the integration point)

---

### Pitfall 5: Cross-tenant authorization bypass on file read

**What goes wrong:**
Endpoint `/api/files/{id}/read-url` looks up the file by ID and returns a signed read URL. Developer forgets to verify `file.tenant_id === ctx.tenantId`. Tenant A's user enumerates UUIDs (or just guesses one) and reads Tenant B's invoices.

This is the classic IDOR but disguised: the tenant-scoped DB wrapper Baseworks already ships in v1.0 catches table queries, but a `SELECT * FROM files WHERE id = $1` *without* the wrapper bypasses scoping. Easy to write that direct query when you "just need the file metadata."

**Why it happens:**
Files are joined to many owners (auth, billing, custom modules) — devs reach for raw queries to avoid the scoping wrapper's friction, especially when "I just need to look up a file by ID."

**Prevention:**
1. The `files` table MUST be accessed exclusively through the existing tenant-scoped DB wrapper. The port should expose `fileStorage.getById(ctx, id)` which uses `ctx.scopedDb` internally — no `ctx.db` direct access permitted.
2. Add a Biome GritQL rule banning `db.select().from(files)` outside the FileStorage adapter.
3. Add an integration test that creates File X in Tenant A, then queries it as Tenant B — must return 404 (not 403, to avoid existence leak).

The tenant prefix in the storage key is informational only and DOES NOT constitute authorization. Server must verify `file.tenant_id === ctx.tenantId` on every read-sign + delete + metadata fetch.

**Warning signs:**
- Direct `ctx.db.select().from(filesTable)` calls in module code
- File handler accepts file ID without going through scoped lookup
- Tests pass with file IDs from any tenant
- Storage key tenant prefix is being parsed/trusted at read time

**Phase to address:** PORT (enforce scoping at the port boundary; ban direct `files` access via GritQL); TEST (cross-tenant integration test as gate)

---

### Pitfall 6: Concurrent quota race — two uploads pass the check, both succeed

**What goes wrong:**
Tenant has 100 MB quota, 95 MB used. Two requests arrive simultaneously to upload 4 MB each:

```
T1: SELECT bytes_used FROM tenant_storage_usage WHERE tenant_id = X  → 95 MB
T2: SELECT bytes_used FROM tenant_storage_usage WHERE tenant_id = X  → 95 MB
T1: 95 + 4 = 99 ≤ 100 → OK, sign URL
T2: 95 + 4 = 99 ≤ 100 → OK, sign URL
[both clients upload]
T1: UPDATE bytes_used = bytes_used + 4 → 99
T2: UPDATE bytes_used = bytes_used + 4 → 103
```

Tenant now exceeds quota by 3 MB. At enough concurrency this becomes a cheap quota-bypass.

**Why it happens:**
"Read-then-write" without locking. Naive translation of the spec: "check quota, sign URL, increment on completion." The increment-on-completion step happens *after* the upload is already done.

**Prevention:**
Two valid options:

**Option A (recommended): optimistic at sign-time, decrement on failure.**

```sql
-- /sign-upload (single transaction)
UPDATE tenant_storage_usage
SET bytes_pending = bytes_pending + $size
WHERE tenant_id = $tid
  AND (bytes_used + bytes_pending + $size) <= bytes_quota
RETURNING *;
-- 0 rows → quota would be exceeded → 413 Payload Too Large
```

`/complete` decrements `bytes_pending` and increments `bytes_used` in one UPDATE. A scheduled job decrements `bytes_pending` for entries whose corresponding `files` row is older than 1 hour and still status=`pending` (the upload was abandoned).

**Option B: row-level lock at sign-time.**

```sql
SELECT * FROM tenant_storage_usage WHERE tenant_id = $tid FOR UPDATE;
-- check, then UPDATE, then COMMIT
```

Simpler but serializes all upload signing per tenant — fine for low-concurrency tenants, contention risk for high-traffic ones.

Document the tradeoff for fork users; ship Option A as the default.

**Warning signs:**
- Quota check and increment happen in separate transactions
- No `bytes_pending` (or equivalent) column on the usage table
- Load test of 50 concurrent uploads from a near-quota tenant exceeds the quota

**Phase to address:** QUOTA (must ship the chosen mechanism with a load test that proves no over-allocation under concurrency)

---

### Pitfall 7: `tenant_storage_usage` row missing on first upload

**What goes wrong:**
The increment query is `UPDATE tenant_storage_usage SET bytes_used = bytes_used + $n WHERE tenant_id = $t`. If no row exists, the UPDATE affects 0 rows — silently no-ops. First upload succeeds in storage, file metadata is recorded, but `bytes_used` stays at 0. Tenant gets free unlimited storage until somebody manually `INSERT`s a row.

**Why it happens:**
Tenant creation flow doesn't initialize the usage row. The scenario fails silently because `UPDATE ... WHERE no_match` is not an error in PostgreSQL.

**Prevention:**
Two layers:

1. **At tenant creation:** the existing tenant-creation handler must `INSERT INTO tenant_storage_usage (tenant_id, bytes_used, bytes_pending, bytes_quota) VALUES ($t, 0, 0, $defaultQuota)` in the same transaction. Add an `ON CONFLICT DO NOTHING` for safety.

2. **At every increment site:** use `INSERT ... ON CONFLICT (tenant_id) DO UPDATE SET bytes_used = tenant_storage_usage.bytes_used + EXCLUDED.bytes_used` (UPSERT pattern). Belt-and-suspenders against the case where #1 was missed during a migration.

**Warning signs:**
- Tenant exists, has files, but no row in `tenant_storage_usage`
- Quota check passes for all amounts because `(NULL OR 0) + $n <= NULL` evaluates true-ish
- Migration that backfills pre-existing tenants is missing

**Phase to address:** PORT (schema + tenant-create hook); QUOTA (UPSERT on every write site)

---

### Pitfall 8: Quota counter drifts from actual usage over time

**What goes wrong:**
Edge cases — failed uploads not decrementing, soft-deleted files not decrementing, manual S3 console deletions, transform variants not counted, transactional rollbacks after the increment — all cause `tenant_storage_usage.bytes_used` to drift from `SUM(files.byte_size)`. After 6 months a tenant's counter says 500 MB but actual is 300 MB; or worse, says 80 MB while actual is 110 MB and quota silently fails to enforce.

**Why it happens:**
Counters and source-of-truth always diverge given enough time and edge cases. This is a "one-way function" pattern that needs a reconciliation oracle.

**Prevention:**
Ship a daily reconciliation BullMQ job `quota:reconcile-tenant-usage`:

```sql
UPDATE tenant_storage_usage tu SET
  bytes_used = COALESCE((
    SELECT SUM(byte_size) FROM files
    WHERE tenant_id = tu.tenant_id AND status = 'available'
  ), 0),
  reconciled_at = NOW()
WHERE tu.tenant_id = $tenantId;
```

Run nightly per tenant. Log any delta > 1% to the error tracker so drift is visible. Surface `reconciled_at` and `last_drift_bytes` in `/health/detailed` storage section.

For variants generated by transforms: each variant must INSERT a `files` row of its own (with `parent_file_id` FK to the original) so its bytes are summable. Avoid storing variants invisible to the `files` table.

**Warning signs:**
- No reconciliation job exists
- `bytes_used` is the sole source of truth for billing/enforcement
- Variants stored without corresponding `files` rows
- Manual S3 console deletes exist in operator runbook without a "reconcile after" step

**Phase to address:** QUOTA (reconciliation job ships with the counter); CLEANUP (job lives next to other lifecycle jobs)

---

### Pitfall 9: Image-decompression bombs OOM the worker

**What goes wrong:**
A 10 KB PNG that decompresses to 50000×50000 RGBA = 10 GB in memory. sharp's libvips streams much of this, but the operation still allocates >1 GB and a co-resident BullMQ worker process gets OOM-killed by the kernel. Other in-flight jobs are lost; queue restarts; attacker repeats. Effective DoS on any tenant who can upload an image.

**Why it happens:**
Default `sharp.metadata()` reads the header, but the *next* call to `.resize()` or `.toBuffer()` allocates based on actual pixel dimensions. Devs read the header but don't gate on the dimensions before processing.

**Prevention:**
Three-layer defense:

1. **Pre-flight header check** before any pixel-touching call:

```ts
const meta = await sharp(input, { failOn: "warning" }).metadata();
if (!meta.width || !meta.height) throw new Error("Invalid image");
const pixels = meta.width * meta.height;
if (pixels > 50_000_000) throw new Error("Image too large (>50 MP)");
```

2. **Sharp's own `limitInputPixels` option:**

```ts
sharp(input, { limitInputPixels: 50_000_000, failOn: "warning" })
```

`limitInputPixels` defaults to ~268M; explicitly lowering it to your real ceiling makes the throw happen inside sharp before allocation. `failOn: "warning"` aborts on truncated/malformed inputs that would otherwise log and continue.

3. **Worker process memory ceiling.** Run the transform worker as its own BullMQ Worker class with `concurrency: 2` (not 50 like the email worker). Set the Bun process flag to limit max heap. If a worker still OOMs, BullMQ's job-failure handler retries on a *different* worker — not the same one that's currently dying.

4. **Refuse to process before bytes hit sharp at all** for files claimed `image/*` but with `Content-Length > 20 MB` — the metadata check is moot if the file is already 100 MB on disk.

**Warning signs:**
- Transform worker OOM-killed in logs
- Sharp pipeline doesn't pass `limitInputPixels`
- Single worker process handling both transforms and other jobs (cross-contamination)
- No fixture in tests that uploads a 50000×50000 PNG bomb

**Phase to address:** TRANSFORM (sharp config + tests); OPS (worker resource limits + monitoring)

---

### Pitfall 10: MIME-type spoofing via client-supplied Content-Type

**What goes wrong:**
Client uploads `payload.exe` and sends `Content-Type: image/jpeg`. The signed POST policy enforces `$Content-Type = image/jpeg`, the upload succeeds, and the storage key is now an executable served as an image. Worse: an HTML file uploaded as `image/svg+xml` — many browsers will execute embedded `<script>` from SVG when served with `Content-Disposition: inline`, producing stored XSS scoped to the bucket's domain (or the app's domain if the file is proxied through the API).

**Why it happens:**
The `Content-Type` in the upload request is *the client's claim*. The signed POST policy can pin it but cannot verify the bytes match. Devs treat the policy match as proof of type.

**Prevention:**
At `/complete`, after HEAD-confirming the byte size, **read the first 4 KB and run magic-byte detection**:

```ts
import { fileTypeFromBuffer } from "file-type";

const head = await s3.send(new GetObjectCommand({ Bucket, Key, Range: "bytes=0-4095" }));
const buf = await streamToBuffer(head.Body);
const detected = await fileTypeFromBuffer(buf);
if (!detected) throw new Error("Unable to determine file type");
if (detected.mime !== expectedMime) {
  await s3.send(new DeleteObjectCommand({ Bucket, Key }));
  throw new Error(`Type mismatch: claimed ${expectedMime}, actual ${detected.mime}`);
}
```

Additional hardening:
- Disallow `image/svg+xml` in image kinds (or run a sanitizer if you must accept SVG)
- Always serve files with `Content-Disposition: attachment` unless the kind is explicitly inline-safe (jpeg/png/webp/gif)
- Set `X-Content-Type-Options: nosniff` on responses
- For polyglot files (valid as both PDF and JPEG): magic-bytes catches *one* of them; for high-security paths, run a structural validator on the detected type

**Warning signs:**
- `/complete` handler trusts `expectedMime` without reading bytes
- No `file-type` (or equivalent) dependency in package.json
- SVG accepted as image without sanitization
- `Content-Disposition: inline` is the default for all served files

**Phase to address:** SIGN-API (`/complete` magic-byte verification); ADAPTER-S3 (serve-with-attachment defaults)

---

### Pitfall 11: Bucket CORS misconfiguration blocks browser uploads

**What goes wrong:**
Several distinct failure modes, all in CORS:

1. **Browser PUT/POST blocked:** bucket CORS doesn't allow `PUT`/`POST` from the app origin — preflight OPTIONS fails, console fills with CORS errors.
2. **ETag header invisible to JS:** `Access-Control-Expose-Headers` doesn't include `ETag` — JS upload completes but cannot read the ETag for integrity verification.
3. **Checksum headers blocked:** `x-amz-checksum-sha256` not in `AllowedHeaders` — modern integrity verification fails preflight.
4. **Wildcard origin in production:** fork user copies an example with `AllowedOrigins: ["*"]` — bucket is now writable from any site (combined with leaked signed URL = bad day).
5. **Localhost vs prod mismatch:** CORS allows only `https://app.com`, dev environment runs on `http://localhost:3000`, "works in staging not locally" Slack-thread eternal recurrence.

**Why it happens:**
Bucket CORS is configured outside the app's IaC in most fork deployments — manual console click-ops. Examples in blog posts include wildcards because they "just work for the tutorial."

**Prevention:**
Ship a **CORS reference template** under `docs/file-storage/cors/{aws-s3,r2,minio,garage}.json` with the canonical configuration:

```json
{
  "CORSRules": [{
    "AllowedOrigins": ["https://app.example.com", "http://localhost:3000"],
    "AllowedMethods": ["PUT", "POST", "GET", "HEAD"],
    "AllowedHeaders": [
      "content-type", "content-length", "content-md5",
      "x-amz-meta-tenant-id", "x-amz-checksum-sha256",
      "x-amz-checksum-crc32", "x-amz-acl"
    ],
    "ExposeHeaders": ["ETag", "x-amz-version-id", "x-amz-checksum-sha256"],
    "MaxAgeSeconds": 3600
  }]
}
```

Add a `bun run validate-cors` script that fetches the live bucket's CORS via `GetBucketCorsCommand` and asserts: no wildcard origin, ETag exposed, all needed methods present. Gate this in the operator runbook.

Document explicitly in the "Add file storage" runbook: dev origin AND prod origin both belong in `AllowedOrigins`. If using preview deploys (Vercel preview URLs), include a regex or a wildcard *subdomain* (`*.vercel.app` is bad — `*.app.example.com` is the right shape).

**Warning signs:**
- Browser console shows `CORS error`, `preflight blocked`
- JS sees empty `headers` object after upload (ETag not visible)
- Bucket CORS in console shows `*` origin
- No `bun run validate-cors` exists; CORS is set up "once" per fork

**Phase to address:** OPS (CORS templates + validate script); ADAPTER-S3 (test-suite CORS check using local MinIO)

---

### Pitfall 12: Sharp under Bun — native-binding fragility

**What goes wrong:**
sharp depends on libvips via N-API native bindings. As of 2026, sharp's official packages support Bun on linux-x64/linux-arm64 reasonably, but:

- Apple Silicon dev machines — fine when the right `@img/sharp-darwin-arm64` package is hoisted
- Alpine/musl Docker images — **break** unless you install `@img/sharp-linuxmusl-arm64` / `@img/sharp-linuxmusl-x64` explicitly; default `node:alpine` images miss the right native package
- Bun's npm install behavior with optionalDependencies has historically been quirky for prebuilt-binary packages
- WASM fallback works but is 5-10× slower; acceptable for MVP, painful at scale

If you commit to sharp and your Docker image is debian-slim today, then a fork user switches to Alpine for size, the worker silently falls back to WASM (or fails to load) at runtime — discovered only after a real upload.

**Why it happens:**
Native bindings + multiple OS targets + Bun's evolving npm install semantics + prebuilt-binary packages = a matrix that's too easy to drift out of green.

**Prevention:**
1. **Spike before commitment.** Phase 0 of the milestone (or as part of TRANSFORM phase) MUST run a Bun + sharp smoke test on:
   - Local dev (likely macOS arm64)
   - The target Docker image (debian-slim x64 for v1.4 — pin this in the dockerfile)
   - CI runner OS

   The smoke test resizes a 1024×1024 PNG to 256×256 and asserts byte-exact-or-tolerance output. If any environment fails, decision: switch base image, switch to imagescript/wasm-vips, or extract transforms to a separate Node-runtime sidecar service.

2. **Pin the Docker base image** in the worker Dockerfile and surface it in `docs/configuration/docker.md`. Discourage Alpine for the worker image specifically.

3. **Define a fallback adapter** for `ImageTransform` port. If sharp fails to load at boot, swap to imagescript (pure-JS, slow but always works) — log a startup warning and continue. Catastrophic fallback beats silent crash.

4. **Document the "I switched to Alpine and uploads broke" failure mode** in the runbook.

**Warning signs:**
- Worker boot logs `Could not load the "sharp" module` or `prebuilt module not found for platform`
- Transform jobs all timeout / fail
- `sharp.versions` returns unexpected values
- Smoke test doesn't exist; CI doesn't import sharp

**Phase to address:** TRANSFORM (sharp spike as the *first* deliverable; fallback adapter); OPS (Docker base image pin + runbook)

---

### Pitfall 13: AWS SDK v3 bundle weight bleeds into Next.js server bundle

**What goes wrong:**
`@aws-sdk/client-s3` is ~1-2 MB minified+gzipped. If a Next.js Server Component or Route Handler imports the API package which transitively imports the S3 adapter, the entire SDK gets pulled into the Next.js server bundle. Cold-start latency on Vercel jumps 200-500 ms; bundle-size warnings cascade.

For Eden Treaty, this is not an issue — the type-only import doesn't pull runtime code. But devs mistakenly `import { fileStorage } from "@baseworks/api/file-storage"` from Next.js Server Components for "convenience," dragging the whole adapter into the Next.js runtime.

**Why it happens:**
Monorepo + barrel exports + "isomorphic" packages = transitive imports are invisible. Devs see `import` looking innocent and don't realize the cost.

**Prevention:**
1. **Architectural rule:** Next.js Server Components MUST NOT import adapters. They must call the API via Eden Treaty (which is type-only at compile time, network-only at runtime).
2. **Biome GritQL ban:** any file under `apps/web/**` that imports from `@baseworks/api/**` (except for type-only imports) fails the lint.
3. **Bundle-size CI gate** for the Next.js server bundle. If `apps/web` bundle grows by >100 KB in a PR, the PR must justify it.
4. **API package layout:** keep the file-storage adapter under `packages/modules/file-storage/server` so it's clearly server-only. Public types live in `packages/modules/file-storage/types`, importable from anywhere.

**Warning signs:**
- `next build` output shows `@aws-sdk/*` in the server bundle analysis
- Cold-start time on Vercel preview deploys regresses
- Files under `apps/web/` have non-type imports from `@baseworks/api`
- No `import-cost` data on the API package barrel

**Phase to address:** PORT (package layout decisions); ADAPTER-S3 (lazy-load the SDK inside the adapter constructor, not at module top level)

---

### Pitfall 14: Local adapter — missing volume + no real signing

**What goes wrong:**

**Subpitfall A — Docker volume not persisted.** Local adapter writes to `./storage/`. Without a named volume in `docker-compose.yml`, files vanish on container restart. Dev confusion: "uploads work, but after `docker-compose down -v` they're gone." Then someone deploys the local adapter to staging without volume config and prod files vanish on next restart.

**Subpitfall B — Cannot truly sign.** S3-style signed URLs depend on a shared secret with the storage backend. Local FS has no such backend. The "signed URL" must therefore proxy through the API (`/api/files/local/{token}` where `token` is an HMAC of `{key, expires, ip?}`). Devs frequently skip the HMAC and just pass the file ID — making local adapter URLs trivially enumerable.

**Subpitfall C — Different upload contract.** S3 adapter signs a direct PUT/POST URL pointing at S3. Local adapter must sign a URL pointing at the API's own `/api/files/local/upload/{token}` — this is a *different* request shape. If the UI uploader hardcodes "POST to AWS-style URL," it breaks for local.

**Why it happens:**
Local adapter is treated as "the simple one" and skipped over in design reviews. The S3-flavored API contract is assumed, then local is shoehorned in.

**Prevention:**
1. **Adapter contract discipline:** the FileStorage port returns an `UploadDescriptor` object, not a URL string. Shape:

```ts
type UploadDescriptor =
  | { kind: "s3-post"; url: string; fields: Record<string, string> }
  | { kind: "s3-put"; url: string; headers: Record<string, string> }
  | { kind: "local"; url: string; method: "POST"; headers: { authorization: string } };
```

The UI uploader switches on `kind`. No assumption of "this is always a presigned-S3 URL."

2. **HMAC-signed local tokens.** Use a server secret to HMAC `{fileId, expiresAt, op}` for local upload/download tokens. Never expose raw file IDs as the only auth on local URLs.

3. **Named volume mandatory in compose:**

```yaml
services:
  api:
    volumes:
      - baseworks-storage:/app/storage
volumes:
  baseworks-storage:
```

Document loudly in the local adapter README: "this adapter is for development. Do not run in production."

4. **Boot-time refusal:** if `STORAGE_ADAPTER=local` and `NODE_ENV=production`, refuse to boot with a clear error message.

**Warning signs:**
- Files disappear after `docker-compose restart api`
- Local adapter URLs are guessable file IDs
- `UploadDescriptor` discriminated union not present
- Production deployment uses `STORAGE_ADAPTER=local`

**Phase to address:** ADAPTER-LOCAL (volume + HMAC token + boot guard); UI-UPLOADER (switch on `kind` in the descriptor)

---

### Pitfall 15: S3-compatible adapter fragmentation (R2/MinIO/Garage/Ceph)

**What goes wrong:**
"S3-compatible" is a spectrum, not a standard. Real differences hit you:

| Backend | Quirk |
|---------|-------|
| Cloudflare R2 | No support for `ListObjectsV2 StartAfter` semantics matching AWS; account-id virtual-hosted only (or path-style with `forcePathStyle`); no Multipart Copy edge cases |
| MinIO | Path-style required for older versions; CORS uses different XML schema; ETag is MD5 not SHA-256 by default |
| Garage | No multipart in older releases; no presigned POST policy on some versions |
| Ceph RGW | Signature v4 generally fine, but checksum SHA-256 trailer support varies by version |

A naive `new S3Client({ endpoint, credentials })` works for "upload small file from US-East to AWS" but breaks on "upload 200 MB to R2 from Europe with multipart." The dreaded `forcePathStyle: true` toggle is the most common debug step — undocumented in many "switch to R2" tutorials.

**Why it happens:**
"S3-compatible" markets a uniform API; reality is feature subsets and addressing-style quirks.

**Prevention:**
1. **Adapter conformance test suite.** Same pattern as Stripe/Pagar.me adapter conformance from v1.1 — ship a fixture suite that runs against every supported S3-compatible backend, asserting:
   - Sign POST policy → upload → HEAD → checksum match
   - Multipart upload (10 MB threshold) → assemble → HEAD
   - List objects with prefix
   - Delete object → HEAD returns 404
   - CORS preflight succeeds for app origin

   Run against MinIO in CI by default; document how to run against R2/Garage/Ceph as fork-user-side validation.

2. **Adapter config schema** with backend-specific defaults:

```ts
type S3CompatConfig = {
  endpoint: string;
  region: string;
  forcePathStyle?: boolean;  // R2: false, MinIO old: true
  multipartThresholdBytes?: number;  // 10 MB default; tune per backend
  checksumAlgorithm?: "SHA256" | "CRC32" | "MD5";  // MinIO old: MD5
};
```

Ship preset configs: `r2Preset()`, `minioPreset()`, `garagePreset()` — each with verified-working defaults.

3. **Docs page per backend** in `docs/file-storage/backends/{aws,r2,minio,garage}.md` — addressing style, CORS XML, env var template, "I tried X and got Y error" troubleshooting.

**Warning signs:**
- Single S3-compatible adapter with no preset configs
- All `forcePathStyle: false` or all `true` regardless of backend
- Conformance tests run against AWS only
- Switching backends requires code changes, not env changes

**Phase to address:** ADAPTER-S3 (conformance suite + presets); OPS (per-backend docs)

---

### Pitfall 16: Async transform UX — user sees old avatar for 30 seconds

**What goes wrong:**
User uploads new avatar. Upload PUT returns 200 in 2 seconds. UI shows "saved." Variant generation runs as a BullMQ job — typically 5-30 seconds end-to-end (worker pickup + sharp + write). For 5-30 seconds, the page still shows the old avatar.

If the 256-px variant URL is what the UI requests, and it doesn't exist yet, the request 404s. UI handling differs by case: stale image cached, broken-image icon, fallback to original (which is huge), error toast. All bad.

**Why it happens:**
Optimistic UX assumption — "upload finishes" = "transformation finishes." Async-by-design is correct architecturally but invisible to the user.

**Prevention:**
1. **Eager render at original first.** On upload completion, the UI immediately replaces the avatar with the original-resolution upload. Variants swap in as they're ready (server-sent event, polling, or explicit refresh on next page load).

2. **Variant fallback chain in the URL helper:**

```ts
fileStorage.variantUrl(fileId, "256") // returns 256 if exists, 128 if not, original if neither, placeholder if none
```

Server-side: HEAD-check variant existence with a short cache; client-side: CSS `<picture>` with multiple sources; or a single endpoint that 302-redirects to the best available.

3. **"Processing" state surfaced in the file metadata.** `files.transform_status: "pending" | "complete" | "failed"`. UI reads this and shows a spinner overlay until `complete`. The Uploader component subscribes (poll every 2s for 60s after upload) and triggers a re-fetch on transition.

4. **Out-of-order completion.** Variants 64 and 128 may finish before 256. Each variant write must be independently handled; the UI must not assume "complete" means all variants exist. `transform_status: "complete"` flips only when *all* variants for the kind are written.

5. **Failed-transform UX.** If variants fail, the original file is still usable. Show a banner "thumbnails unavailable, retrying" — never the broken-image icon. Failed transforms enqueue a retry; max retries → escalate to the error tracker so an operator notices.

**Warning signs:**
- UI immediately requests `/variants/256.jpg` after upload completion
- No `transform_status` column on `files`
- Broken-image icon in the avatar UI shortly after upload
- Failed transforms produce no Sentry-visible signal

**Phase to address:** TRANSFORM (status field + variant rows); UI-UPLOADER (fallback chain + processing state)

---

### Pitfall 17: Page navigation kills in-flight upload

**What goes wrong:**
User picks 200 MB video. Upload begins. User clicks navigation link 30% in. Browser cancels the XHR. No partial-upload recovery. User restarts from 0%, swears.

Worse: the half-uploaded blob in S3 is now an orphan — counted toward AWS billing if multipart was used and `AbortIncompleteMultipartUpload` lifecycle isn't configured.

**Why it happens:**
Default browser behavior is to cancel pending requests on navigation. SPAs that block-route-with-confirm don't cover full-page nav. Resume requires multipart upload + persisted `uploadId` + client-side state — meaningful work.

**Prevention:**
1. **Block navigation while upload is in flight.** `beforeunload` event listener registered when uploads start, unregistered on completion/cancel. In Next.js: `useBeforeUnload`. In React Router: `useBlocker`.

2. **Multipart upload for large files.** Threshold: 10 MB. Upload in 5 MB parts; persist the `uploadId` and per-part `ETag`s in `localStorage`. On reload, "resume upload" UI offers continuation. Caveat: complex, ship for v1.5+. For v1.4, block-nav is the MVP.

3. **AbortIncompleteMultipartUpload lifecycle rule** on every bucket — required by docs and operator runbook. 7-day expiry for multipart abandonments.

4. **Stream from File, never read into Buffer.** `XMLHttpRequest` with the `File` object directly streams; `await file.arrayBuffer()` reads the whole thing into memory and OOMs the browser tab on 1 GB files. Use `xhr.upload.onprogress` for progress; use `fetch` only with `ReadableStream` body (not all browsers, careful) or stick with XHR.

**Warning signs:**
- No `beforeunload` handler registered during upload
- `await file.arrayBuffer()` in the uploader code
- Bucket has no lifecycle rule for incomplete multipart
- Memory usage spikes in browser dev tools when picking large files

**Phase to address:** UI-UPLOADER (block-nav + streaming); CLEANUP (multipart lifecycle rule docs); v1.5+ for multipart resume

---

### Pitfall 18: No bucket lifecycle = unbounded cost growth

**What goes wrong:**
Three classes of orphan accumulate forever:
- **Abandoned multipart uploads:** parts uploaded, `complete-multipart` never called → S3 keeps the parts for billing
- **`pending` files never completed:** signed POST issued, browser uploads, browser crashes before calling `/complete` → file in bucket, no `files` row
- **Soft-deleted files:** `files.status = "deleted"` flag set, bucket object never removed → bytes still on S3 invoice

After 6 months, the bucket has 3× the live data. Egress and storage costs compound silently.

**Why it happens:**
"We'll add cleanup later." Storage is cheap right up until it isn't. Multipart aborts in particular cost money even for files that *failed* — counterintuitive.

**Prevention:**
Three lifecycle layers:

1. **Bucket lifecycle rules** (config in `docs/file-storage/lifecycle/{aws,r2,minio}.json`):

```json
[
  {
    "Id": "AbortIncompleteMultipartUpload",
    "Status": "Enabled",
    "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 7 }
  },
  {
    "Id": "ExpirePendingTempPrefix",
    "Status": "Enabled",
    "Filter": { "Prefix": "tmp/" },
    "Expiration": { "Days": 1 }
  }
]
```

2. **`cleanup:reap-orphan-files` BullMQ job (daily):**
   - SELECT files WHERE status = 'pending' AND created_at < now() - interval '24 hours'
   - DELETE storage object + DELETE files row
   - Decrement quota counters

3. **`cleanup:reap-soft-deleted` BullMQ job (weekly):**
   - SELECT files WHERE status = 'deleted' AND deleted_at < now() - interval '30 days'
   - DELETE storage object + hard-DELETE row
   - Quota was already decremented at soft-delete time

4. **Surface in `/health/detailed`:** orphan count, last-reap-run timestamp. Alert when orphan count > N.

**Warning signs:**
- S3 cost line item growing faster than user growth
- Bucket has no lifecycle rules
- No `cleanup:*` jobs in the BullMQ queue list
- `files` table has rows in `pending` state older than 24 hours

**Phase to address:** CLEANUP (jobs + bucket lifecycle docs)

---

### Pitfall 19: No Cache-Control on uploaded files

**What goes wrong:**
Avatar served fresh from S3 for every page view. CDN doesn't cache (no `Cache-Control` header on the object). Bandwidth bill scales linearly with views. For tenant-private files served via signed URLs that expire every 5 minutes, the URL itself prevents CDN caching even with the right headers.

**Why it happens:**
S3 uploads default to no `Cache-Control` unless explicitly set. Devs forget to attach metadata at upload time.

**Prevention:**
1. **Set Cache-Control at upload time** based on kind. Public assets (variants, avatars when bucket is public): `public, max-age=31536000, immutable` (the storage key already contains an unguessable nanoid, so the URL is effectively content-hashed). Private assets: `private, max-age=300`.

```ts
// signed POST policy or PUT signed headers
{ "Cache-Control": kindIsPublic ? "public, max-age=31536000, immutable" : "private, max-age=300" }
```

2. **Two-bucket pattern** (or two prefixes): public bucket for variants/avatars served via CDN, private bucket for tenant-content served via signed read URLs. CDN sits in front of the public bucket.

3. **Signed read URL caching.** For tenant-private files behind signed URLs, generate URLs with longer expiries (1 hour) and cache the URL itself in the API for that duration so multiple frontend requests don't each generate a unique URL.

**Warning signs:**
- `HeadObject` on uploaded files returns no `Cache-Control`
- CDN dashboard shows 0% cache hit rate on file-storage origin
- Bandwidth costs scale with page-view, not with uploads

**Phase to address:** ADAPTER-S3 (Cache-Control on every PutObject/POST); OPS (CDN guidance docs)

---

### Pitfall 20: Owner-record cascade vs orphan files

**What goes wrong:**
User deletes their account. The `users` table CASCADEs to `user_files` (or whatever the join is) and removes the rows. But the storage objects *and* the `files` rows themselves linger. Tenant's quota counter is now stale. Bucket bills forever.

Reverse case: storage object is manually deleted via S3 console for compliance (right-to-be-forgotten request). `files` row stays, points to a now-404 storage key. Read URL signs successfully but fetching it 404s.

**Why it happens:**
Files are referenced from many modules (auth user, billing invoice, custom records). Cascading deletes break either way:
- Cascade-delete from owner table → file rows vanish before cleanup logic runs
- No-cascade → orphans accumulate

**Prevention:**
1. **Soft-delete pattern for files.** `files.status` enum includes `deleted` with `deleted_at` timestamp. Owner-record deletion handlers explicitly call `fileStorage.softDelete(ctx, fileId)` rather than `DELETE FROM files`. Soft-delete:
   - Decrements quota immediately
   - Schedules storage object hard-delete in 30 days (gives recovery window)
   - Does NOT cascade from owner deletion via FK

2. **Owner-record-delete hook contract.** The FileStorage port exposes `attachToOwner(ctx, fileId, ownerModule, ownerRecordId)` and `detachFromOwner(ctx, ownerModule, ownerRecordId)`. Modules that own files MUST call `detachFromOwner` in their delete handler. This is documented in the Add-a-Module tutorial as a hard contract.

3. **Daily orphan-detection job.** SELECT files where (owner_module is set AND no row with owner_record_id exists in the owner table). Log to error tracker — operator sees orphans.

4. **GDPR/right-to-be-forgotten path.** Hard-delete API: `fileStorage.hardDelete(ctx, fileId)` — removes both row and storage object atomically (DELETE row, then DELETE storage; DELETE storage in finally block; on partial failure, re-enqueue). Used by user-deletion flow.

**Warning signs:**
- Module delete handlers don't call `detachFromOwner`
- `files` rows exist with no corresponding owner records
- Storage 404s when fetching via valid signed URL
- No orphan-detection job

**Phase to address:** PORT (port API + soft-delete schema); CLEANUP (orphan-detection job); plus per-module integration when modules adopt file ownership

---

### Pitfall 21: Module-aware file ACLs (billing PDFs leaking via /api/files/{id})

**What goes wrong:**
Generic file-read endpoint `/api/files/{id}/read-url` checks `tenant_id` match (per Pitfall 5) but doesn't check *module-level* permissions. Billing module attaches an invoice PDF; only org owners should see invoices. Generic endpoint signs read URLs for any tenant member who knows the file ID.

Worse: a future module attaches a "private notes" file. Same endpoint serves it to anyone with the tenant + ID combo.

**Why it happens:**
Centralizing the read endpoint loses the module's custom permission logic. "It's tenant-scoped, that's enough" — but RBAC inside a tenant matters too.

**Prevention:**
1. **Module declares an authorize hook.** When a module attaches files, it registers an authorizer:

```ts
fileStorage.registerAuthorizer("billing", {
  canRead: async (ctx, file) => ctx.session.role === "owner",
  canDelete: async (ctx, file) => ctx.session.role === "owner",
});
```

2. **Generic read endpoint dispatches to the authorizer based on `file.owner_module`.** Default authorizer = "tenant member" (matching v1.0's default). Modules that need stricter logic register their own.

3. **Test fixture per module.** Each module's test suite includes a "non-owner cannot read this module's file" case.

**Warning signs:**
- `/api/files/{id}/read-url` doesn't dispatch by `owner_module`
- Billing PDFs accessible to non-owner tenant members
- No `registerAuthorizer` / equivalent in the FileStorage port

**Phase to address:** PORT (authorizer registry); SIGN-API (`/sign-read` calls into the registry); per-module integration during module adoption (not v1.4 scope for billing-PDF specifically — flag for the milestone that adds invoice PDFs)

---

### Pitfall 22: Testing — no real S3 in CI, no sharp smoke

**What goes wrong:**
1. Adapter integration tests use `aws-sdk-client-mock` only. CI is green; first deploy hits real S3 and fails on signature-v4 quirks the mock didn't simulate. Or: mock doesn't validate the POST policy, real S3 rejects it.
2. Sharp tests use a fixed 100×100 PNG; production hits a 5000×5000 photo and OOM-kills the worker.
3. `aws-sdk-client-mock` Bun compatibility was historically rough; tests pass under Node, fail or hang under Bun's test runner.
4. Local adapter tests pass (FS is just FS), but those don't cover the S3 code path that 95% of fork users will hit.

**Why it happens:**
"Tests are green" ≠ "this works against the real backend." Mocks lie; real-S3-in-CI was historically painful before MinIO containers became cheap.

**Prevention:**
1. **MinIO in CI.** GitHub Actions service container:

```yaml
services:
  minio:
    image: quay.io/minio/minio
    ports: [9000:9000]
    env: { MINIO_ROOT_USER: minioadmin, MINIO_ROOT_PASSWORD: minioadmin }
    options: --health-cmd "mc ready local" ...
```

Test suite spins up a bucket via MinIO admin CLI, runs the S3-compatible adapter against it. Same conformance suite from Pitfall 15.

2. **Sharp smoke test.** Test fixture set:
   - 100×100 PNG (baseline)
   - 5000×5000 JPEG (real-world photo)
   - 50000×50000 PNG bomb (must reject before processing)
   - Truncated PNG (must error, not OOM)
   - SVG with `<script>` (must reject in image kind)
   - Animated GIF (decision: process first frame or reject)

   Run on every CI build. Worker memory gets a hard ceiling so an OOM fails the test instead of hanging.

3. **Bun-native test of `aws-sdk-client-mock`.** Run the existing v1.2 test suite pattern (mock.module) against the SDK. If shaky, switch to a thin custom `S3Client` test double with the precise methods the adapter calls.

4. **Local adapter tests are fine but insufficient alone.** S3 conformance suite is the *primary* test. Local tests cover adapter parity (same port → same observable behavior).

**Warning signs:**
- CI doesn't have a MinIO service container
- Sharp tests use only one fixture
- `aws-sdk-client-mock` in package.json with no MinIO complement
- Adapter conformance suite missing or local-only

**Phase to address:** TEST (CI infrastructure: MinIO + sharp fixtures); each adapter phase adds tests against the conformance harness

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Storage key based on `tenantSlug + filename` | Human-readable bucket browsing | Enumerable keys, content existence leaks, GDPR pain | **Never** for prod |
| Trust client-reported `size` at /complete | Skip a HEAD round-trip | Quota bypass via lying clients | **Never** — HEAD is cheap |
| Sign PUT with no Content-Type lock | "Just works" demo | Arbitrary content uploaded under signed key | **Never** — use POST policy |
| Skip magic-byte verification | Faster /complete | XSS via SVG, executable served as image | Acceptable for fully-private buckets where files are never inlined into HTML, otherwise no |
| Single S3 bucket for public + private | One adapter config | Cache-Control conflicts, CDN caching private files | MVP only; split into two prefixes/buckets before public launch |
| No reconciliation job | Less code now | Drift over months → silent quota failures | MVP-only acceptable, ship the job before paid plans |
| Sharp without `limitInputPixels` | Less config | OOM-kill DoS | **Never** |
| Local adapter in production | Zero infra setup | File loss on restart, no signing | **Never** |
| `aws-sdk-client-mock` only (no MinIO) | Faster CI | Real-S3 quirks slip through | Acceptable until first prod issue, then add MinIO |
| Global file-read ACL = "tenant member" | Simpler | Module-private files leak inside tenant | Acceptable until first stricter module (e.g., billing PDFs); flag in TODO |
| `forcePathStyle: true` everywhere | Works on R2 + MinIO | Slower DNS resolution on AWS, breaks some CloudFront patterns | Acceptable for self-hosted; switch per-backend via preset |
| No bucket lifecycle | One less config step | Unbounded cost from orphan/multipart abandonment | **Never** for prod |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| AWS S3 (PUT signing) | `getSignedUrl(s3, new PutObjectCommand({ Bucket, Key }))` with no Content-Type | Pass `ContentType` AND verify via HEAD at /complete; prefer POST policy |
| AWS S3 (POST policy) | `["starts-with", "$key", "uploads/"]` | `["eq", "$key", exactKey]` — server controls full key |
| Cloudflare R2 | Default S3 SDK config fails with cryptic errors | Set `endpoint: \`https://${accountId}.r2.cloudflarestorage.com\``, use account-id-style or `forcePathStyle: true`; pass `region: "auto"` |
| MinIO | CORS XML different from AWS, "AllowedOrigins" missing causes preflight fail | Apply via `mc admin policy set` or via `aws s3api put-bucket-cors` against the MinIO endpoint; ship template `docs/file-storage/cors/minio.json` |
| Sharp on Bun | `npm install sharp` and assume it works | Run sharp smoke test in CI on target Docker image; pin `@img/sharp-{platform}` packages; fallback adapter |
| BullMQ transform jobs | Use the same Worker as `email-send` queue | Separate Worker with `concurrency: 2`, lower memory ceiling, dedicated queue `file-storage:transform` |
| better-auth user-avatar wiring | Store URL in user metadata | Store `files.id` FK in user metadata; resolve to URL via FileStorage port (so URL can be signed/private) |
| Eden Treaty + Next.js | Import API package directly from RSC for "convenience" | Always go through Eden Treaty client; ban non-type imports of `@baseworks/api` from `apps/web` |
| Next.js Server Component | Reads file via `fileStorage.read()` directly | Streams via API endpoint that signs + 302s; or fetches signed URL and 302s itself |
| Resend (transactional email with PDF) | Attach 10 MB PDF inline in email | Generate signed read URL with 7-day expiry, link in email body; do not inline-attach |
| Stripe invoice download | Re-host Stripe's invoice PDF on our storage | Serve Stripe's hosted invoice URL directly; only re-host if customization required |
| pino + upload paths | Log entire request body including file bytes | Pino redact paths to drop request body for upload routes; only log metadata |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Sync image transform on upload response path | /complete latency 5-30s, gateway timeouts | Enqueue BullMQ job, return immediately, transform_status pending | First upload of >2MB image |
| Single transform worker for all queues | OOM kills email worker too | Separate Worker per queue with own concurrency + memory | First decompression-bomb upload |
| `await file.arrayBuffer()` in browser uploader | Tab freezes / OOM on >500 MB files | Stream via XHR with File as body; fetch with ReadableStream | First user uploads phone-recorded video |
| No CDN in front of public bucket | Bandwidth bill scales with views | CDN + Cache-Control + content-hashed keys | ~10K MAU |
| Sign read URL on every page render | API CPU spent on signing | Cache signed URLs in memory for 50% of expiry | ~1K req/s on file-heavy pages |
| `LIMIT/OFFSET` on `files` for tenant listings | Slow at deep pages | Cursor pagination via `(created_at, id)` | First tenant with >10K files |
| `SUM(byte_size)` on every quota check | Quota check 100-500ms | Counter table (already designed); only SUM in reconciliation job | First tenant with >1K files |
| Variant generation produces same variant set for all kinds | Uploading 100 docs spawns 400 transform jobs | Variant matrix per kind; documents get no image variants | First doc-heavy module |
| Reading whole file into memory in adapter | Memory pressure on large uploads | Stream from req body to S3 PUT body; `Bun.file()` as ReadableStream | Files >100 MB |
| No multipart upload threshold | 1 GB single PUT fails on flaky network | Multipart for >10 MB; client-side chunking; retry per part | First user uploads from cell network |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Predictable storage keys | Existence leaks; bucket enumeration | nanoid(24) segment in every key; key built only by server |
| Signed URL with 24h expiry | Replay attack window | 5-min upload signing, 1-hour read signing; rotate signing key on incident |
| `Content-Type` not signed | Arbitrary content under signed key | POST policy with `["eq", "$Content-Type", expected]`; magic-byte verify at /complete |
| `Content-Length` not bounded | Storage exhaustion / quota bypass | POST policy `content-length-range`; HEAD-verify post-upload |
| Tenant prefix in key trusted as auth | Cross-tenant read | Always verify `file.tenant_id === ctx.tenantId` from DB; key prefix is informational |
| Direct SQL on `files` table bypassing scopedDb | Cross-tenant IDOR | Biome ban + port-only access |
| Generic file ACL = tenant member | Module-private files leak | Authorizer registry per `owner_module` |
| Serve any file `Content-Disposition: inline` | XSS via SVG/HTML upload | Default `attachment`; whitelist inline kinds (jpg/png/webp/gif) |
| `X-Content-Type-Options: nosniff` missing | Browser MIME-sniffs uploaded files | Set on all file responses |
| Wildcard CORS origin | Bucket writable from any site | Strict allowlist; `bun run validate-cors` |
| HMAC token for local adapter missing | Local URLs trivially enumerable | Server-secret HMAC of `{fileId, expiresAt, op}` |
| Store URL (not file ID) in DB | URL embeds storage layout; can't rotate adapter | Store `files.id` FK; resolve via port |
| Read body bytes without auth check | Auth bypass via ID enumeration | Auth middleware before file lookup; lookup before signing |
| Stripe webhook PDF → re-host on our bucket | Increases attack surface | Link Stripe-hosted URL directly |
| Sentry breadcrumb captures file bytes | PII leak in error tracker | Pino redact + Sentry beforeBreadcrumb scrub for file routes (Phase 18 pattern from v1.3 covers this; verify) |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| New avatar shows old image for 30s | Confusion; "did it save?" | Optimistic UI swap to original; variants swap in async |
| 404 broken-image icon during transform | "Upload failed" perception | Fallback chain: variant → original → placeholder |
| No upload progress | "Is it stuck?" anxiety on large files | XHR progress events; 2-state (uploading / processing) |
| Drag-drop on wrong DOM element | Page navigates to file:// | `dragover preventDefault` on body, drop zone owns UX |
| Page nav cancels upload | Frustration on large files | `beforeunload` block while uploads in flight |
| Mobile camera picker missing | Users can't use phone camera | `<input capture="environment" accept="image/*">` |
| Generic "upload failed" toast | User doesn't know why | Surface validation errors: "File too large", "wrong type", "quota exceeded" |
| Avatar preview = original-resolution download | Slow on mobile | Show local `URL.createObjectURL` preview pre-upload |
| No optimistic image | Page jumps after upload | Insert local-blob preview, swap to server URL on completion |
| Drop zone doesn't accept file picker | Power users hate it | Click-to-pick + drag-drop both wired |
| File picker accepts wrong types client-side then rejects server-side | Slow feedback | `accept` attribute + client-side magic-byte for first 4 KB |
| Transform failure silent | "Why is my thumbnail broken?" | Banner + retry CTA; admin sees Sentry alert |
| Deleted file still appears | Cache confusion | Optimistic UI removal; refresh on /complete |
| Quota-exceeded error during upload mid-flight | Wasted bandwidth | Pre-flight quota check at /sign-upload returns 413; UI shows quota bar before pick |
| Image upload accepts heic | iPhone uploads, web can't render | Convert HEIC server-side to JPEG variant; or reject with clear message |

---

## "Looks Done But Isn't" Checklist

- [ ] **Signed PUT URL:** Often missing `ContentType` constraint — verify "upload arbitrary file at signed key" test fails (server rejects)
- [ ] **POST policy:** Often uses `starts-with` on `$key` — verify exact-match `eq`
- [ ] **/complete handler:** Often trusts client `size` — verify HEAD call before quota increment
- [ ] **Cross-tenant read:** Often verified by tenant prefix in key — verify DB `tenant_id` is checked too
- [ ] **Quota concurrency:** Often passes single-request tests — verify load test with concurrent uploads on near-quota tenant
- [ ] **`tenant_storage_usage` row:** Often missing for pre-existing tenants — verify migration backfills + UPSERT on every increment
- [ ] **Quota reconciliation:** Often skipped — verify daily job exists and logs drift
- [ ] **Sharp `limitInputPixels`:** Often default — verify explicit lower limit + decompression-bomb test fixture
- [ ] **Magic-byte verification:** Often skipped — verify SVG-with-script-as-image test rejects
- [ ] **Bucket CORS:** Often configured with wildcard — verify `bun run validate-cors` rejects wildcard
- [ ] **CORS ETag exposure:** Often missing — verify upload XHR can read `xhr.getResponseHeader('ETag')`
- [ ] **Bun + sharp Docker image:** Often only tested on dev OS — verify CI runs on target Linux image
- [ ] **Next.js bundle bleed:** Often invisible — verify `apps/web` server bundle has no `@aws-sdk/*`
- [ ] **Local adapter HMAC:** Often plain file ID — verify token is HMAC-signed
- [ ] **Local adapter in prod:** Often unguarded — verify boot fails with `STORAGE_ADAPTER=local && NODE_ENV=production`
- [ ] **R2 forcePathStyle:** Often forgotten — verify R2 preset includes correct flag
- [ ] **Adapter conformance:** Often AWS-only — verify MinIO runs same suite in CI
- [ ] **Bucket lifecycle:** Often missing AbortIncompleteMultipartUpload — verify `GetBucketLifecycleConfiguration` returns rule
- [ ] **Cache-Control on uploads:** Often missing — verify HEAD on uploaded variant returns Cache-Control
- [ ] **Soft-delete pattern:** Often hard-DELETE — verify `softDelete` decrements quota and schedules hard-delete
- [ ] **Owner-record cascade:** Often FK-cascades — verify deleting owner row leaves files row, then `detachFromOwner` runs
- [ ] **Module ACL registry:** Often defaults to tenant-member — verify per-module authorizer hooks dispatch correctly
- [ ] **Transform status field:** Often only "pending/complete" — verify out-of-order variant completion handled
- [ ] **Failed-transform UX:** Often silent — verify Sentry receives event + UI banner + retry
- [ ] **Multipart abort cleanup:** Often missing — verify lifecycle rule + `cleanup:reap-orphan-files` job
- [ ] **`/health/detailed` storage:** Often missing — verify quota-used, orphan count, last-reap-run surfaced
- [ ] **Page nav block during upload:** Often missing — verify beforeunload registered
- [ ] **`file.arrayBuffer()` in uploader:** Often present — verify XHR with File body, not Buffer
- [ ] **Drag-drop on body element:** Often missing preventDefault — verify dropping anywhere doesn't navigate
- [ ] **Sharp smoke on Docker base image:** Often dev-only — verify CI uses same image as prod
- [ ] **MinIO in CI:** Often absent — verify `services.minio` block in CI workflow

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Predictable keys deployed | HIGH | New uploads use unguessable keys; bulk-rename old keys (S3 copy + delete); update files.storage_key; rotate any cached URLs |
| Quota counter drift | LOW | Run reconciliation job manually; commit reconciled values; ship daily job |
| Missing CORS for ETag | LOW | Update bucket CORS via `put-bucket-cors`; no code change |
| Sharp OOM in production | MEDIUM | Add `limitInputPixels` + restart workers; quarantine the offending file; backfill failed transform jobs |
| MIME-spoofed file already in bucket | MEDIUM | Run magic-byte audit job over all files; quarantine mismatches; review for impact (XSS already exploited?) |
| Local adapter deployed to prod | HIGH | Hot-swap to S3 adapter; copy files from container disk to S3 (backed up first?); no recovery if files already lost on restart |
| R2 forcePathStyle wrong | LOW | Toggle env var; restart |
| Quota race over-allocated | LOW-MEDIUM | Reconciliation job sets bytes_used to actual SUM; quota over-shoots until users delete files; monitor |
| Orphan files in bucket | LOW | Run `cleanup:reap-orphan-files` once + ship cron |
| Cache-Control missing on legacy files | LOW | One-shot job runs CopyObject with `MetadataDirective: REPLACE` + new headers; no re-upload needed |
| Cross-tenant IDOR exposed | CRITICAL | Audit logs for cross-tenant access; rotate all signing keys; force user re-login; legal/comms response; patch + tests in same hour |
| Bundle bleed into Next.js | LOW | Move adapter import to lazy/dynamic in API; verify with bundle analyzer |
| Mass orphan after schema migration | MEDIUM | One-shot reconciliation + orphan-detection job + temporary alert escalation |
| Sharp Bun-incompat in CI but not dev | LOW-MEDIUM | Switch to fallback adapter; or downgrade Bun to last-known-good; or pin sharp version |
| Bucket lifecycle never set | LOW | Apply lifecycle JSON via CLI; AWS reaps eligible objects within 24h |

---

## Pitfall-to-Phase Mapping

| # | Pitfall | Prevention Phase | Verification |
|---|---------|------------------|--------------|
| 1 | Predictable storage keys | PORT | Code review: `buildStorageKey()` is the only key constructor; key contains nanoid(24) |
| 2 | Signed PUT without Content-Type/Length | SIGN-API | Test: arbitrary upload at signed key returns 4xx; POST policy used by default |
| 3 | POST policy `$key` starts-with | SIGN-API | Test: client cannot inject key path; policy uses `eq` |
| 4 | Trusting client byte_size | SIGN-API + QUOTA | Test: lying client (claim 1B, upload 10MB) → quota correctly increments by 10MB |
| 5 | Cross-tenant authorization bypass | PORT (+TEST) | Test: Tenant B reading Tenant A's file → 404; Biome rule blocks direct `files` access |
| 6 | Concurrent quota race | QUOTA | Load test: 50 concurrent near-quota uploads → none exceed quota |
| 7 | Missing `tenant_storage_usage` row | PORT (+QUOTA) | Test: new tenant signup creates usage row; UPSERT on every increment site |
| 8 | Quota counter drift | QUOTA (+CLEANUP) | Daily reconciliation job runs; `/health/detailed` shows last reconciled timestamp |
| 9 | Image decompression bomb OOM | TRANSFORM (+OPS) | Test fixture: 50000×50000 PNG bomb rejected before sharp processes; worker memory ceiling enforced |
| 10 | MIME-type spoofing | SIGN-API | Test: upload SVG-with-script as image/png → /complete rejects via magic-byte |
| 11 | CORS misconfiguration | OPS (+ADAPTER-S3) | `bun run validate-cors` passes; ETag exposed; no wildcard origin |
| 12 | Sharp-on-Bun fragility | TRANSFORM (+OPS) | Smoke test runs on target Docker image in CI; fallback adapter wired |
| 13 | Next.js bundle bleed | PORT (+ADAPTER-S3) | Bundle analyzer in CI; Biome ban on apps/web non-type imports of api package |
| 14 | Local adapter (volume + signing) | ADAPTER-LOCAL | Volume in compose; HMAC token; boot guard against `local + production` |
| 15 | S3-compatible fragmentation | ADAPTER-S3 (+OPS) | Conformance suite runs against MinIO in CI; per-backend preset config |
| 16 | Async transform UX | TRANSFORM + UI-UPLOADER | `transform_status` field; UI fallback chain; processing indicator |
| 17 | Page nav kills upload | UI-UPLOADER | beforeunload registered while uploading; XHR streams from File |
| 18 | No bucket lifecycle | CLEANUP | Lifecycle JSON template; `cleanup:reap-*` jobs running |
| 19 | No Cache-Control | ADAPTER-S3 (+OPS) | HEAD on uploaded file returns Cache-Control; CDN docs page |
| 20 | Owner-record cascade vs orphan | PORT + CLEANUP | Soft-delete pattern; orphan-detection job; modules call `detachFromOwner` |
| 21 | Module-aware ACLs | PORT + SIGN-API | Authorizer registry; default = tenant member; per-module override hook |
| 22 | Testing infrastructure | TEST | MinIO in CI; sharp fixture suite; conformance harness |

---

## Phase Ordering Implications

Based on the pitfall-to-phase mapping, the roadmapper should consider this ordering rationale:

1. **PORT first.** Pitfalls 1, 5, 7, 13, 20, 21 all require the right schema and port API up front. Storage-key builder, scoped-db enforcement, soft-delete schema, authorizer registry — these are foundational and expensive to retrofit.

2. **TEST infrastructure (MinIO in CI + sharp smoke fixtures) before either adapter.** Pitfalls 12, 15, 22 surface adapter behavior that mocks miss. Stand up MinIO before writing the S3 adapter so the conformance suite drives the adapter, not the other way around. This mirrors the v1.1 PaymentProvider pattern: conformance tests defined the contract.

3. **ADAPTER-S3 + ADAPTER-LOCAL in parallel after PORT/TEST.** Both implement the same port; conformance suite verifies parity. Pitfalls 11, 14, 15, 19 fall here.

4. **SIGN-API.** Depends on adapters and port. This is where the highest-leverage security pitfalls live (2, 3, 4, 10) — concentrate review here. Joint with QUOTA because /complete is the integration point for Pitfall 4.

5. **QUOTA.** Pitfalls 6, 7, 8 — depends on schema (PORT) and the /sign-upload + /complete endpoints (SIGN-API). Reconciliation job ships in same phase to prevent drift from day one.

6. **TRANSFORM.** Pitfalls 9, 12, 16. Sharp spike must run *first* in this phase; if sharp fails on Bun, fallback adapter or scope cut. Async pattern + variant rows + `transform_status` field.

7. **CLEANUP.** Pitfalls 18, 20, 8 (reconciliation tie-in). Lifecycle docs + orphan-reaping jobs. Late phase because it depends on every prior schema decision.

8. **UI-UPLOADER.** Pitfalls 16, 17. Latest phase that needs the API contract stable. Switch on `UploadDescriptor` `kind`.

9. **OPS.** Pitfalls 11, 12, 18, 19, plus runbook integration. CORS templates, per-backend docs, `/health/detailed` storage section, Docker base-image pin. Polish-and-document phase before milestone close.

---

## Sources

- AWS S3 POST Policy docs — [POST Policy specification](https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-HTTPPOSTConstructPolicy.html), [Presigned URL upload](https://docs.aws.amazon.com/AmazonS3/latest/userguide/PresignedUrlUploadObject.html)
- [Differences between PUT and POST S3 signed URLs — Advanced Web Machinery](https://advancedweb.hu/differences-between-put-and-post-s3-signed-urls/) — confirms POST policy `content-length-range` advantage over PUT
- [The illustrated guide to S3 pre-signed URLs — fourTheorem](https://fourtheorem.com/the-illustrated-guide-to-s3-pre-signed-urls/) — POST policy condition shapes
- [S3 POST Policy hidden feature — Matano](https://www.matano.dev/blog-archive/2022/02/14/s3-post-policy) — operational POST policy patterns
- [Cloudflare R2 S3 API compatibility](https://developers.cloudflare.com/r2/api/s3/api/) — addressing-style + forcePathStyle behavior
- [BucketMate R2 setup guide](https://www.bucketmate.app/blogs/s3-compatible-setup-cloudflare-r2) — confirms `forcePathStyle: true` workaround
- [Bun compatibility 2026 — DEV Community](https://dev.to/alexcloudstar/bun-compatibility-in-2026-what-actually-works-what-does-not-and-when-to-switch-23eb) — sharp via WASM fallback, native bindings caveats
- [Bun production guide 2026 — byteiota](https://byteiota.com/bun-runtime-production-guide-2026-speed-vs-stability/) — native module reliability matrix
- Sharp documentation (training data, MEDIUM confidence) — `limitInputPixels` defaults to 0x7FFFFFFF (~268M), `failOn: "warning"` aborts on truncated input
- Pillow `DecompressionBombError` — used as cross-language reference confirming pixel-bomb attack vector is well-documented across image libraries
- Baseworks v1.0 patterns: scopedDb wrapper, port + adapter pattern (PaymentProvider precedent in v1.1), conformance test pattern (Stripe + Pagar.me parity tests)
- Baseworks v1.3 patterns: AsyncLocalStorage observability context, `HealthContributor` rollup (Phase 22), Biome GritQL ban precedent (`enterWith` ban from Phase 19), `validate-docs.ts` CI gate (Phase 23)
- Personal experience / well-documented community wisdom: signed URL replay windows, MIME spoofing via SVG, CORS ETag exposure, multipart abort billing, sharp OOM patterns

---

## Confidence Assessment

| Class | Confidence | Notes |
|-------|-----------|-------|
| Signed-URL security | HIGH | Well-documented S3 patterns; AWS docs + multiple guides confirm POST policy advantages |
| Multitenancy / authorization | HIGH | Stack-aligned with Baseworks v1.0 scopedDb pattern; integration is well-understood |
| Quota races | HIGH | Standard read-modify-write race; UPSERT and `bytes_pending` patterns are textbook |
| Image decompression bombs | HIGH | sharp `limitInputPixels` documented; pixel-bomb pattern cross-confirmed in Pillow ecosystem |
| MIME-type spoofing | HIGH | `file-type` package widely used; SVG XSS well-documented |
| CORS configuration | HIGH | Standard S3/R2/MinIO behavior; documented per-backend |
| Bun-specific issues | MEDIUM | Sharp + AWS SDK v3 both *generally* work in 2026 but require platform spike; explicit fallback adapter recommendation reflects this uncertainty |
| Async transform UX | MEDIUM | UX patterns are recommendations, not standards; specific implementations vary |
| Adapter portability | HIGH | `forcePathStyle` behavior confirmed; per-backend quirks well-documented |
| Operational pitfalls | HIGH | Lifecycle rules, Cache-Control, deduplication trade-offs are standard ops territory |
| Frontend uploader UX | HIGH | XHR vs fetch streaming, beforeunload, drag-drop are well-trodden ground |
| Testing pitfalls | MEDIUM | MinIO-in-CI is standard; `aws-sdk-client-mock` + Bun is the uncertain piece |

Overall confidence: **HIGH** for prevention strategies; **MEDIUM** for the Bun-platform-specific items (sharp loading, AWS SDK bundle weight) that need empirical validation in the Phase TRANSFORM spike.

---

*Pitfalls research for: Baseworks v1.4 — File Storage & Signed Uploads*
*Researched: 2026-05-05*
*Output consumed by: gsd-roadmapper (phase ordering + success criteria), gsd-phase-researcher (per-phase deep dives)*
