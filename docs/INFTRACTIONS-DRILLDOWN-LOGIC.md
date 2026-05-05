# Infractions & drilldown UX (reports / summary)

This note complements [`INFTRACTIONS-CARD-TAB-SYSTEM.md`](INFTRACTIONS-CARD-TAB-SYSTEM.md), which defines the **reusable two-level tab DOM + JS pattern** (main tabs + drill subtabs).

It was reconstructed after accidental deletion of the original file. Restore finer detail from Git / OneDrive version history if you still have an older copy.

---

## 1. Where the pattern applies

- **Infractions card** (point-card summary / reports path): category rows open **main tabs**; time/day rows inside a category open **drill subtabs**.
- **Trigger Times card**: uses the **same tab + drill-subtab structure** so behavior matches Infractions (Overview row → drill into day-specific panels with time breakdowns).
- **Heatmap** (insights dashboard and similar grids): drilldown is **cell-driven** — selecting a heatmap cell opens a detail panel or tooltip stack rather than the Infractions tab strip. Prefer keeping visual hierarchy shallow (tooltip → optional side panel) so it does not collide with the Infractions tab model.

---

## 2. Behavioral rules

1. **Scope**: Level-2 drill tabs are scoped **inside** the active Level-1 panel only (see tab-system doc §2).
2. **Primary tabs**: The `"overview"` (or equivalent) tab has **no** close control; dynamic tabs always include a close affordance.
3. **Closing**: Removing the active tab activates the primary tab; removing a drill tab activates the drill `"overview"` subtab.
4. **IDs**: Use stable `data-tab` / `data-drill-tab` identifiers (slugified labels); avoid reusing IDs across different parent panels.

---

## 3. Heatmap vs table drilldown

| Aspect | Infractions / Trigger Times | Heatmap |
|--------|-----------------------------|---------|
| Entry | Row/column click in tables | Grid cell click/hover |
| Structure | `.infractions-tabs` + `.infractions-drilldown-tabs` | Tooltip + optional expanded region |
| State | Tab lists remember open tabs until closed | Usually ephemeral unless pinned |

---

## 4. Frontend anchor points (verify in repo)

Search in `static/app.js` for:

- `infractions-tabs`, `infractions-drilldown-tabs`
- `toggleTriggerTimesDayTable`, `trigger-times-drilldown-tabs`
- Heatmap render paths (`heatmap-cell`, behavioral insights API)

Backend aggregation rules for summary/frenzy live in `SUMMARY_FRENZY_STATS_LOGIC.md`.

---

## 5. If something still looks wrong

1. Confirm `templates/index.html` loads the same `static/app.js` you edited (hard refresh).
2. Compare against `_recovery_cursor_FULL/desktop/static/app.js` (Cursor Local History snapshot) — **do not** blindly overwrite a newer `app.py` / `app.js`.
