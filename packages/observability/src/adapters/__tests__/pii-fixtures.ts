/**
 * PII conformance fixtures (Phase 18 / ERR-04 / D-14).
 *
 * A reusable fixture suite fed through every ErrorTracker adapter via the
 * plan-05 conformance test AND through `scrubPii` directly via the plan-02
 * unit test. Covers every documented PII leak vector (D-14):
 *
 * - Plain password in scope.extra (deny-key path)
 * - Bearer token in request.headers.authorization (deny-key + regex)
 * - Email inside error message strings (string-regex path)
 * - Stripe/Pagar.me webhook bodies (nested deny-key path)
 * - CPF/CNPJ Brazilian PII (regex + deny-key)
 * - Better-auth session objects nested deep (recursive deny-key)
 * - Email at depth 3 (recursive walk)
 * - Bearer tokens embedded in string leaves (regex-only path)
 * - Stripe key pattern in string leaves (regex-only path)
 * - tenantId positive case (must NOT redact — legitimate context)
 * - Plain stack trace pass-through (no PII, nothing changes)
 * - Webhook-route rule (drops request.data entirely)
 * - CQRS error preserves command name (legitimate context survives)
 *
 * Fixtures are data-only — they do NOT import `scrubPii`. Consumers apply
 * the scrubber themselves and assert against `shouldSurvive` / `shouldNotAppear`.
 */

import type { CaptureScope } from "../../ports/error-tracker";

/**
 * A PII-conformance fixture fed through every ErrorTracker adapter.
 *
 * `input` describes the `captureException` call; `expected` is the adapter's
 * emitted event AFTER scrubPii runs (shape only — leaf values normalized to
 * redaction markers). `shouldSurvive` and `shouldNotAppear` are the
 * grep-style invariants that make the conformance test's final assertion
 * trivial.
 */
export interface PiiFixture {
  /** Unique human-readable fixture name, used as the test title. */
  name: string;
  /** The captureException input. `event` is an optional pre-built event-shape for Sentry-side fixtures. */
  input: {
    err: unknown;
    scope?: CaptureScope;
    event?: Record<string, unknown>;
  };
  /** Partial shape the scrubbed output must match. Omit for pass-through fixtures. */
  expected?: Partial<Record<string, unknown>>;
  /** Substrings that MUST remain in the scrubbed output (positive assertions). */
  shouldSurvive?: string[];
  /** Secret values that MUST NOT appear in the scrubbed output (negative assertions). */
  shouldNotAppear?: string[];
}

export const PII_FIXTURES: PiiFixture[] = [
  {
    name: "plain-password-in-scope-extra",
    input: {
      err: new Error("auth failed"),
      scope: {
        tenantId: "tnt-alpha",
        extra: { password: "hunter2", userId: "u-7" },
      },
    },
    shouldSurvive: ["tnt-alpha"],
    shouldNotAppear: ["hunter2"],
  },
  {
    name: "bearer-token-in-auth-header",
    input: {
      err: new Error("unauthorized"),
      event: {
        request: {
          headers: { authorization: "Bearer abc123def456" },
        },
      },
    },
    shouldNotAppear: ["abc123def456"],
  },
  {
    name: "email-in-error-message-string",
    input: {
      err: new Error("failed for user alice@example.com"),
      scope: { extra: { message: "failed for user alice@example.com" } },
    },
    shouldNotAppear: ["alice@example.com"],
  },
  {
    name: "stripe-webhook-body-in-extra",
    input: {
      err: new Error("webhook handler threw"),
      scope: {
        extra: {
          webhookPayload: {
            data: {
              object: {
                customer: {
                  email: "cust@x.com",
                  card_last4: "4242",
                },
              },
            },
            type: "checkout.session.completed",
          },
        },
      },
    },
    shouldSurvive: ["checkout.session.completed"],
    shouldNotAppear: ["cust@x.com", "4242"],
  },
  {
    name: "pagarme-cpf-cnpj",
    input: {
      err: new Error("pagarme validation failed"),
      scope: {
        extra: {
          customer: {
            cpf: "123.456.789-00",
            cnpj: "12.345.678/0001-90",
          },
        },
      },
    },
    shouldNotAppear: ["123.456.789-00", "12.345.678/0001-90"],
  },
  {
    name: "better-auth-session-nested-deep",
    input: {
      err: new Error("session expired"),
      scope: {
        extra: {
          session: {
            user: { id: "u-1", email: "dev@x.com" },
            token: "sess_abc",
          },
        },
      },
    },
    shouldSurvive: ["u-1"],
    shouldNotAppear: ["dev@x.com", "sess_abc"],
  },
  {
    name: "email-at-depth-3-nested-object",
    input: {
      err: new Error("deep nested PII"),
      scope: {
        extra: {
          response: {
            data: {
              user: { email: "depth3@x.com" },
            },
          },
        },
      },
    },
    shouldNotAppear: ["depth3@x.com"],
  },
  {
    name: "stale-bearer-in-string-leaf",
    input: {
      err: new Error("auth rejected"),
      scope: {
        extra: {
          errorContext: "Failed with Bearer stale_token_xyz on POST",
        },
      },
    },
    shouldNotAppear: ["stale_token_xyz"],
  },
  {
    name: "stripe-key-in-leaf",
    input: {
      err: new Error("stripe init failed"),
      scope: {
        extra: {
          debug: "tried sk_live_abcXYZ12345",
        },
      },
    },
    shouldNotAppear: ["sk_live_abcXYZ12345"],
  },
  {
    name: "tenantId-positive-case",
    input: {
      err: new Error("generic failure"),
      scope: {
        tenantId: "tnt-beta",
        extra: { request_id: "req-42" },
      },
    },
    shouldSurvive: ["tnt-beta", "req-42"],
    shouldNotAppear: [],
  },
  {
    name: "plain-stack-trace-passthrough",
    input: {
      err: new Error("Database connection refused"),
      scope: {
        extra: { command: "connectDb" },
      },
    },
    shouldSurvive: ["Database connection refused", "connectDb"],
    shouldNotAppear: [],
  },
  {
    name: "webhook-route-drops-request-data",
    input: {
      err: new Error("webhook handler threw"),
      event: {
        request: {
          url: "https://api.example.com/api/webhooks/stripe",
          data: { secret: "should-be-dropped-entirely" },
        },
      },
    },
    shouldNotAppear: ["should-be-dropped-entirely"],
  },
  {
    name: "cqrs-error-preserves-command-name",
    input: {
      err: new Error("handler throw"),
      scope: {
        extra: { commandName: "createTenant" },
      },
    },
    shouldSurvive: ["createTenant"],
    shouldNotAppear: [],
  },
];
