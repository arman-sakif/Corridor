# Linting

`npm run lint` runs [oxlint](https://oxc.rs), not ESLint.

## Why not ESLint

Next 16 removed `next lint`, and the replacement it points at cannot run on
this project. Every ESLint-on-TypeScript setup — `eslint-config-next`
included — depends on `typescript-eslint`, which refuses to load:

```
typescript-eslint does not support TS 7.0.
```

This is not a configuration problem. 8.68.0 is the latest published version and
it throws at import time; support for TS >= 7.1 is tracked in
typescript-eslint#10940. The project is on TypeScript 7.0.2, the native
compiler, and the alternative — downgrading to TS 6 to satisfy a linter — is a
larger change to the toolchain than the linting is worth.

oxlint parses TypeScript itself and has no `typescript` dependency at all, so
the version question does not arise. It also runs the whole repo in well under
a second, which is the difference between a check that runs and one that gets
skipped.

Revisit ESLint when typescript-eslint supports TS 7. Nothing here is hard to
move; the rule set below is close to what `next lint` gave.

## What is switched off, and why

The defaults are kept except for ten rules. Each is off because it argues
with something this codebase does deliberately — a linter that cries wolf gets
ignored, and an ignored linter is the same as no linter.

| Rule | Why it is off |
|---|---|
| `react/react-in-jsx-scope` | Wrong for the modern JSX transform. React does not need to be in scope, and Next has not required it for years. |
| `import/no-unassigned-import` | `import 'server-only'` is the whole point of that module — it is imported for the build error it causes in a client bundle, never for a value. |
| `unicorn/no-new-array` | `new Array(n).fill(0)` in `legLoads` is immediately filled, so the ambiguity the rule warns about does not exist. That is per-leg capacity, the most load-bearing code in the app, and not somewhere to churn for style. |
| `unicorn/no-array-sort` | Insists on `toSorted()`. Every call site here sorts an array it just built, where mutation is correct and the copy is waste. |
| `unicorn/no-array-reverse` | Same reasoning as above. |
| `unicorn/consistent-function-scoping` | Hoisting a helper out of the function it belongs to, to save an allocation nobody measured, makes the code harder to read. |
| `jsx-a11y/prefer-tag-over-role` | Wants `<output>` instead of `role="status"` on `Alert`. `<output>` is for a calculation's result; `role="status"` is the correct announcement for an alert. |
| `no-underscore-dangle` | `_runtime` and `query_` are deliberate naming here, and a leading underscore is the conventional mark for a deliberately unused binding. |
| `jsx-a11y/label-has-associated-control` | Three false positives. The card-style checkbox and radio inputs nest their text in spans inside the wrapping `<label>`, which is correct implicit association; the rule cannot see through the nesting. |
| `jsx-a11y/no-autofocus` | One deliberate use, on the sign-in code step where the field is the only control on screen and the reader arrived by asking for it. Off globally rather than suppressed at the call site because oxlint honours neither an inline nor a file-scoped disable directive for this rule — the justification lives in a comment there instead. |

`react-perf` is not enabled at all. Its rules are about re-render cost, and
most components here are Server Components that do not re-render.

## What the first run found

Nine issues, in code that had gone unchecked since `next lint` broke:

- four dead imports and an unused variable,
- a needless spread in the manifest test,
- a `quote` local shadowing the imported `quote()` in the surcharge tests,
- a migration failure in the test harness that threw away the original
  Postgres error instead of passing it as `cause`,
- and a filter in `boardingsFor` written as a predicate on `to` that only read
  `from`, so it was invariant across the inner loop and re-decided the same
  answer for every pair. Hoisted to where it belongs.

Two more turned up in the recovery form written the same day: an `autoFocus`
(kept, and justified above) and a `setState` inside an effect, which is now
derived during render instead.

None of them would have broken anything today. That is the point of running it.

## One the linter got wrong

The first run flagged a spread in the manifest test as useless:

    `first bytes ${[...bytes.slice(0, 3)].map((b) => b.toString(16)).join(' ')}`

It was not. `bytes` is a `Uint8Array`, and a typed array's `map()` returns
another typed array — it coerces whatever the callback returns back to a
number, so `'ef'` became `NaN` became `0`. The spread was what turned it into a
real array first.

Removing it did not fail anything. The assertion on the next line reads the
bytes directly and kept passing; only the message changed, from
`first bytes ef bb bf` to `first bytes 0 0 0` — a diagnostic that lies exactly
when you need it. It was caught by running the suite and reading the output,
not by any check.

It now uses `Array.from(bytes.slice(0, 3), (b) => b.toString(16))`, which says
what it means and does not trip the rule. The lesson is not to switch the rule
off: it is right nearly always, and typed arrays are the exception worth
knowing. Read what a rule is telling you before applying its fix.
