# Presentation Decks: Manny's Market

Two separate decks — one for staff, one for students — for introducing the classroom economy (getting paid, paying bills, the Marketplace). Built from the app's own code (`economy_lib.py`, `bills_lib.py`, `app.py`, `economy_routes.py`, `assistance_forms.py` at commit `48b7e16`) and verified by re-running that code — see the script at the bottom.

## The two decks

| Deck | Audience | Covers |
|---|---|---|
| **[Teacher Guide](https://claude.ai/artifact/T2Xt7J3vFuurHyMJB2yftu)** | Staff and admins | Why the system is designed this way (a token economy needs a felt consequence, and the money has to matter), and the controls you use to run it: turning bills on, generating paychecks, managing bonuses, approving level-ups, staff bill tools, assistance staff actions, marketplace setup, and admin-only Economy settings. |
| **[Student Guide](https://claude.ai/artifact/YAkDctD1uHpPUsS5gpMDmL)** | Students | What Manny's Market is and how to use it: where things live in the app, how a paycheck is calculated and how to complete the worksheet, how weekly bills work, and how to shop the Marketplace. Ends with a placeholder slide for tutorial videos (in production, not yet linked). |

Both are private — share each from its own Share menu before handing the link to anyone else. Both download as PowerPoint or PDF from that page.

**A note on the Teacher deck's philosophy slides:** the "why this exists" framing (behavior needs a felt consequence; the money has to matter) is a synthesis of why the system is built this way, based on its design — not a document the school wrote elsewhere. Reword those two slides if you have specific program language already in use.

## Student deck outline

**Getting paid:** cover, where to find it in the app, how money moves every week, card colors and leveling up, gross pay and bonuses, the six deductions, a full worked example, completing the Weekly Earnings Record.

**Paying bills:** bills arrive every Monday, My Plan price ranges, a statement slide showing take-home vs. bills by card color (with and without assistance), paying a bill step by step, late fees and the emergency fund, the assistance programs.

**Marketplace:** shopping the Marketplace, video walkthroughs (coming soon), closing recap with a discussion prompt.

## Teacher deck outline

**Why this exists:** cover, why a token economy needs a felt consequence, why the money has to matter, the three systems at a glance.

**Running paychecks:** turning it on for a student, generating paychecks (automatic vs. manual), managing bonuses (and the reset gotcha), approving a level-up.

**Running bills and the Marketplace:** staff tools on any bill (pay it, waive it, PTO), assistance staff actions (revoke/reset), creating marketplace items and handling purchase orders, admin-only Economy settings.

**Before you run it:** a few known gotchas, then a closing slide pointing to the Student deck.

## Key verified numbers (defaults — an admin may have changed Economy settings)

| Card | Daily rate | 5-day gross | Take-home @ 90% |
|---|---|---|---|
| Yellow | $74.16 | $370.80 | $274.21 |
| Green | $129.16 | $645.80 | $477.57 |
| Blue | $162.76 | $813.80 | $601.80 |

Default weekly plan ≈ **$326.61** (yellow/green) or **$370.08** (blue, with the student loan). A yellow card at 90% runs **−$53.62** a week with no assistance; all three assistance programs turn that into **+$107.18**.

## A documentation bug this surfaced (fixed in this branch)

`STUDENT_PAYCHECK_WORKSHEET_GUIDE.md`'s worked example used a 3% state tax instead of the real **5.35%** (Minnesota), even though the same document states 5.35% earlier. Fixed in this branch: state tax $8.82 → $15.73, total deductions $69.68 → $76.59, take-home $224.32 → $217.41.

## Known app behavior worth knowing (not fixed — outside a presentation's scope)

- **Bonus counts never reset automatically.** An undeposited paycheck recalculates from the *current* Starbucks/Star Student/Star Classroom counts, so if staff don't zero them after a deposit, the same bonus can be paid again the next week. (This is on the Teacher deck's "watch for" slide.)
- **Admins can't see or fulfill marketplace purchase orders** — only staff listed on the student's support team can (`get_support_team_user_ids` only returns staff; `get_purchase_orders` returns nothing for the `admin` role). (Also on the "watch for" slide.)
- `MARKETPLACE_IMPLEMENTATION_PLAN.md` describes an approval-then-charge flow; the code actually charges checking at checkout and refunds automatically on denial.

## Re-verifying the numbers

Save the block below as `verify_numbers.py` and run `python3 verify_numbers.py` from the repo root (standard library only; recomputes every number above from `economy_lib.py`/`bills_lib.py` directly, so it stays correct even if Economy settings or prices change).

```python
import os
import sys
from datetime import date
from decimal import Decimal

sys.path.insert(0, os.getcwd())  # run this from the repo root

import bills_lib as bl
import economy_lib as eco

print("== Full week (5 paid days, no bonuses, no citations): gross -> take-home")
for color in ("yellow", "green", "blue"):
    rate = eco.daily_rate_for_color(color)
    row = [f"{color}: rate {rate}"]
    for pct in (100, 90, 80):
        r = eco.compute_stub_paycheck(rate, 5, pct)
        row.append(f"{pct}% gross {r['gross']} net {r['final_pay']}")
    print("  " + " | ".join(row))

print("\n== Worked example: yellow, 4 paid days, 2 Starbucks, 1 Star Classroom, P=88%, 1 citation")
r = eco.compute_stub_paycheck(eco.daily_rate_for_color("yellow"), 4, 88, starbucks_count=2,
                              star_student_count=0, star_classroom_count=1, citation_count=1)
for k in ("regular_pay", "starbucks_pay", "star_student_pay", "star_classroom_pay", "gross",
          "point_card_gap_percent", "point_card_deduction", "citation_deduction", "federal_tax",
          "ss_tax", "medicare_tax", "state_tax", "total_deductions", "final_pay"):
    print(f"  {k}: {r[k]}")

print("\n== Corrected worksheet-guide example ($80 x 3 days, 2 SB, 1 Star Student, 90%)")
g = eco.compute_stub_paycheck(Decimal("80.00"), 3, 90, starbucks_count=2, star_student_count=1)
print(f"  gross {g['gross']} state {g['state_tax']} total_ded {g['total_deductions']} take-home {g['final_pay']}")

settings = bl.merged_settings({})
cat = bl.adjusted_catalog({s["slug"]: s["options_json"] for s in bl.BILL_PRODUCTS_V2}, settings)
plan = bl.normalize_plan(dict(bl.DEFAULT_PLAN), cat)

print("\n== Student prices per week (catalog x cost of living)")
for slug in ("rent", "internet", "renters", "groceries", "health", "savings", "cell", "car_loan", "car_insurance"):
    opts = ", ".join(f"{o['label']} {o.get('weekly', o.get('loan_weekly'))}" for o in bl.product_options(cat[slug]))
    print(f"  {slug}: {opts}")

print("\n== Default plan estimate and savings goal")
for color in ("yellow", "blue"):
    total, _items = bl.weekly_plan_total(plan, cat, color)
    goal, weeks = bl.savings_goal(plan, cat, color, settings)
    print(f"  {color}: {total}/wk, emergency-fund goal {goal} ({weeks} weeks)")

print("\n== One real week of bills (week of 2026-09-21), take-home at 90%, with/without all 3 programs")
for color in ("yellow", "green", "blue"):
    net90 = eco.compute_stub_paycheck(eco.daily_rate_for_color(color), 5, 90)["final_pay"]
    for programs in ([], ["housing", "snap", "health"]):
        benefits = {p: {"income_weekly": net90} for p in programs}
        total = sum((bl.lines_total(bl.statement_lines(slug, cat, plan, {
            "student_id": 1, "monday": date(2026, 9, 21), "card_color": color, "benefits": benefits,
            "loan_balance": None, "settings": settings})[0]) for slug in bl.selected_slugs(plan, cat, color)), Decimal("0"))
        print(f"  {color} take-home {net90}, programs={programs or 'none'}: bills {total}, left {net90 - total}")

print("\n== Fees: rent late fee on $152.02 =", bl.late_fee("rent", Decimal("152.02"), Decimal("152.02"), settings),
      "| other late fee =", bl.late_fee("internet", Decimal("10.58"), None, settings),
      "| convenience fee on $17.20 =", bl.convenience_fee(Decimal("17.20"), settings))
```
