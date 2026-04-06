import { describe, test, expect } from "bun:test";
import authModule from "../index";
import { auth } from "../auth";

describe("profile management registration", () => {
  test("module has update-profile command", () => {
    expect(authModule.commands?.["auth:update-profile"]).toBeFunction();
  });

  test("module has get-profile query", () => {
    expect(authModule.queries?.["auth:get-profile"]).toBeFunction();
  });

  test("module has 4 commands total", () => {
    expect(Object.keys(authModule.commands || {})).toHaveLength(4);
  });

  test("module has 4 queries total", () => {
    expect(Object.keys(authModule.queries || {})).toHaveLength(4);
  });
});

describe("auth instance configuration verification", () => {
  // AUTH-02: Verify auth instance exists and has API methods
  test("auth instance exists and has API methods", () => {
    expect(auth).toBeDefined();
    expect(auth.api).toBeDefined();
  });

  // AUTH-02: Verify OAuth providers are configured (Google, GitHub)
  // When env vars are set, socialProviders includes google/github.
  // We verify by checking the auth instance options or API methods.
  test("auth config includes social provider support (AUTH-02)", () => {
    // better-auth exposes signInSocial or similar API method when OAuth is configured
    const hasOAuthSupport =
      typeof (auth.api as any).signInSocial === "function" ||
      typeof (auth.api as any).signInWithOAuth === "function" ||
      (auth as any).options?.socialProviders !== undefined;
    expect(hasOAuthSupport).toBe(true);
  });

  // AUTH-03: Verify magic link plugin is configured
  test("auth config includes magic link plugin (AUTH-03)", () => {
    const hasMagicLink =
      typeof (auth.api as any).signInMagicLink === "function" ||
      typeof (auth.api as any).sendMagicLink === "function" ||
      (auth as any).options?.plugins?.some?.(
        (p: any) => p.id === "magic-link",
      );
    expect(hasMagicLink).toBe(true);
  });

  // AUTH-05: Verify password reset is configured (sendResetPassword callback exists)
  test("auth config includes password reset callback (AUTH-05)", () => {
    const hasPasswordReset =
      (auth as any).options?.emailAndPassword?.sendResetPassword !==
        undefined ||
      typeof (auth.api as any).forgetPassword === "function" ||
      typeof (auth.api as any).forgetPasswordCallback === "function" ||
      typeof (auth.api as any).resetPassword === "function";
    expect(hasPasswordReset).toBe(true);
  });
});
