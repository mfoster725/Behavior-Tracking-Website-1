# Teacher Presentation: Manny's Market (Pay, Bills, Marketplace)

A 15-slide deck for introducing students to how they get paid, pay bills, and shop at Manny's Market. Built from the app's own code (`economy_lib.py`, `bills_lib.py`, `app.py`, `economy_routes.py`, `assistance_forms.py` at commit `48b7e16`) and verified by re-running that code — see `verify_numbers.py` below.

**Live deck:** https://claude.ai/artifact/YAkDctD1uHpPUsS5gpMDmL (private — share it from the deck's Share menu before handing the link to anyone else). Downloads as PowerPoint or PDF from that page.

## Outline

**Getting paid**
1. Cover
2. How money moves every week (point card → Monday paycheck + bills → worksheet → deposit → bills due next Monday)
3. Your card color sets your pay (yellow/green/blue rates; the 30-day, 90%-average level-up rule)
4. Gross pay: paid days + bonuses (Starbucks $2, Star Student $50, Star Classroom $50)
5. The six deductions (Point Card, Citations, Federal, Social Security, Medicare, MN state)
6. A full worked example
7. Completing the Weekly Earnings Record (where to click, Submit, retries)

**Paying bills**
8. Bills arrive every Monday (a teacher must turn them on; required vs. optional bills)
9. My Plan (weekly price ranges for housing, internet, groceries, health, etc.)
10. Your plan has to fit your paycheck (take-home vs. bills by card color, with and without assistance)
11. Paying a bill, step by step (work it out or pay a 20% fee → coupon → receipt)
12. Late bills (rent 8% / other bills flat $5) and the emergency fund (3-week goal)
13. Assistance programs (SNAP, health coverage, Section 8 — modeled on real MN forms)

**Marketplace**
14. Shopping the Marketplace (browse → cart → checkout → fulfilled/denied; sample prices)
15. Closing: the weekly money routine, with a discussion prompt

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

- **Bonus counts never reset automatically.** An undeposited paycheck recalculates from the *current* Starbucks/Star Student/Star Classroom counts, so if staff don't zero them after a deposit, the same bonus can be paid again the next week.
- **Admins can't see or fulfill marketplace purchase orders** — only staff listed on the student's support team can (`get_support_team_user_ids` only returns staff; `get_purchase_orders` returns nothing for the `admin` role).
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
