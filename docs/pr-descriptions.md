# PR descriptions

Most PRs here are written by an agent and reviewed by one person who did not
watch the work happen. The description is the only place that reviewer learns
*why* — the diff already covers *what*. Everything below serves that.

Skeleton lives in `.github/pull_request_template.md`.

## Title

Imperative, names the outcome, ≤72 characters, no prefix noise.

> Add independent Border Width control to contour-pareidolia
> Improve contrast and legibility of add-to-cart error message

Not `border fix`, not `[FEAT] update shader`.

## Sections

Five, in this order. Drop the ones that don't apply; don't invent a sixth
without a reason.

### Problem

Lead with why this exists, stated concretely enough to argue with: the measured
value, the behaviour that breaks, the thing that couldn't be done. One or two
paragraphs of prose.

> Against the `#111` modal surface that's **4.29:1**, which fails WCAG AA
> (4.5:1) for normal text.

If the change is additive rather than corrective, title this **Context**
instead and describe the gap it fills.

### Change

Only what the diff doesn't already say. A reviewer can read the diff; they
cannot read the three approaches you discarded.

- Explain the approach and the reasoning that picked it.
- **If the obvious fix doesn't work, say why it doesn't.** This is the single
  highest-value paragraph in most of these PRs. See #610.
- Cite `path/to/file.ext:line` for the load-bearing spots.
- Tables for before/after value sets. Short snippets (5–10 lines) for the few
  lines that actually carry the change — not the whole function.
- Don't narrate the diff file by file.

### Notes

Optional. Trade-offs you accepted, compatibility, deliberate scope boundaries.

For shader and visual work, **state explicitly whether existing designs render
identically at default values.** Product designs are saved parameter sets; a
silent visual change breaks orders already placed.

> At `u_outline_width == u_contour_width` (both default `0.025`) the output is
> **identical to before**, so this is a purely opt-in control.

If you deliberately left related problems alone, say so and say why — an
untouched adjacent bug reads as an oversight otherwise.

### Not done here

Required whenever anything is deferred. Manual Shopify admin steps, secrets to
provision, cutover ordering, follow-up work, known gaps. Anything that merging
would silently assume is already handled.

This section is what keeps a merged PR from quietly being half-shipped.

### Testing

The command and its real result, with counts:

> `npm test` — 569 passed, 19 files.

Rules:

- Separate automated from visual verification.
- **If local visual verification is still outstanding, write that.** Never phrase
  a description so it sounds like a render was eyeballed when it wasn't.
- Pre-existing failures: name the test, say it's pre-existing, show it passes in
  isolation, and say why this PR can't be the cause.
- Screenshots or GIFs for anything that renders. `test-shaders.html` and
  `palette-lab.html` both produce usable grabs.

## After review rounds

When review produces fixes, append a **Review fixes** section rather than
rewriting history in the original text. Group by round, tag each with the commit
SHA, and lead each finding with the failure in bold — what actually went wrong,
not the name of the fix.

> **Round 2 — `f38ab68`**
> - **The claim-release race crashed the handler.** …

State whether each regression test was verified to fail against the pre-fix
source. A test that passes both before and after is not a regression test.

## Trailer

Every agent-authored PR body ends with:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_<id>
```

## Anti-patterns

- A bullet list that restates the diff (`- updated main-product.liquid`).
- "Improves performance" / "cleans things up" with no number and no mechanism.
- Testing sections that say "tested locally" and nothing else.
- Omitting the manual steps because they're obvious to whoever wrote it.
- Claiming verification that didn't happen.
