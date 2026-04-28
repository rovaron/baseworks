# Example runbook (test fixture)

This file is consumed by `scripts/__tests__/validate-docs.test.ts` to exercise
the 4th invariant's Pass A (cross-runbook markdown link integrity).

See [other](./other.md) for a sibling that DOES exist.
A relative path with subdir: [pages](./pages/page.md).

A link with an anchor that resolves: [other-anchor](./other.md#section).

A broken link: [broken](./does-not-exist.md).

A non-runbook link (HTTP) is out of scope: [google](https://google.com).

```markdown
[code-block-link](./should-be-ignored.md)
```

Note: the line above is inside a fenced code block. D-10 explicit: links inside
fences are out of scope; the validator's naïve line scan tolerates false-negatives
there (Pattern: line scan only). For this fixture the validator WILL still flag
that line because Pass A is line-naïve. The test asserts that the broken link
above (./does-not-exist.md) is reported, not the code-fence one specifically.
