#!/usr/bin/env bash
# Creates the dev-cycle labels (docs/process/dev-cycle.md) on the current repo's GitHub remote.
# Safe to re-run: existing labels are updated in place.
set -euo pipefail

label() { gh label create "$1" --color "$2" --description "$3" --force; }

label "status:planning"       "c5def5" "Being written by the planner"
label "status:plan-review"    "bfd4f2" "Waiting for plan review"
label "status:needs-approval" "fbca04" "Waiting on an owner-approved gate"
label "status:ready"          "0e8a16" "Planned, reviewed, gates approved"
label "status:in-progress"    "1d76db" "Being implemented"
label "status:in-review"      "5319e7" "PR open; testing and review"
label "status:blocked"        "d93f0b" "Question for the owner"

label "type:feature"  "a2eeef" "User-visible behaviour"
label "type:bug"      "d73a4a" "Behaviour differs from spec"
label "type:chore"    "ededed" "Tooling, infra, maintenance"
label "type:decision" "f9d0c4" "ADR proposal"
label "type:design"   "fef2c0" "Owner-requested UI mockup"

label "gate:technology" "b60205" "Owner approves the ADR"
label "gate:production" "b60205" "Owner approves the production release"

label "area:frontend" "0052cc" "Angular app"
label "area:backend"  "006b75" "Convex"
label "area:payments" "5319e7" "Stripe"
label "area:infra"    "333333" "CI, hosting, tooling"
