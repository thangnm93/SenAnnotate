# Plan — strategy

Engine, report, card, mode — the same order the measurement releases used, and for the
same reason: the arithmetic and the stored shape are testable without a browser, and
settling them first stops the UI inventing a second shape for the same data.

1. `content/css-edit.ts` — apply, revert, and the override registry. Unit tests.
2. `Settings.cssEditor`, the `CssOverride` shapes, and the report section.
3. `ui/css-card.ts` — the declaration list and the Changes tab.
4. Mode 5 and its gating, thin in `index.ts`.
5. Fixture and e2e, including the off state and a revert that restores a prior inline
   value rather than clearing it.
