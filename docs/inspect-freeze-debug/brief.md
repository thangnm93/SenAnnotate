# Brief — page stays frozen after inspect, and a debug log

## Problem

A tester reported that after choosing inspect the page "seems to freeze" when they click
other things, and offered to send logs if it could not be reproduced.

## Goal

1. Find out whether the page really freezes, and fix it if so.
2. Ship a debug mode regardless, so the next report that cannot be reproduced arrives with
   a log: a setting that records what the overlay did, and a way to save it as a file.

## Non-goals

- Page clicks being swallowed *while* inspect is on. That is inspect working — a click
  annotates instead of reaching the page.
- Freezing motion inside child frames (`docs/freeze-frame-scope/`).
- Annotation storage: untouched.
- Any new permission.
