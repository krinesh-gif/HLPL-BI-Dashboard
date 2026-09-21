# HLPL Business Intelligence Platform

Real MIS/P&L for Hivefy Lifestyle Pvt Ltd (Aravi Organic). Every figure on
these screens is a real company number that someone makes a decision on, so
nothing here is ever filled in with a plausible-looking estimate.

## Git

**Work on `Main` and push to `Main`.** The owner asked for one branch, so
there is no scratch branch and no pull request unless he asks for one.

`Main` is what Vercel deploys, so a push here is a release to the team. That
makes the checks below the gate, since there is no second branch to be the
gate. Run all four and have them clean **before** committing:

```
npx tsc -b
npx vitest run
npx oxlint src api
npm run build
```

Where a change touches how a number is computed, also run the owner's own
file through it and check the result against the source document before
pushing — the test suite proves the code does what it was told, not that it
was told the right thing.

## Vercel

Hobby plan, capped at 12 serverless functions. `tests/api/functionBudget.test.ts`
holds the budget at 11 and currently sits on it, so **no new file may be added
under `api/`**. A new channel goes through the `FACT_TABLES` map in
`api/facts/[channel].ts`, which costs no function.
