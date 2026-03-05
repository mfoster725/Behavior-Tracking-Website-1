# Table Styles — Description for Agents

Use this description when asking another agent (e.g. Cursor Auto) to create or match the table styling used in this project, especially in dashboard and infractions cards.

---

## 1. Design principle: horizontal lines only

Tables use **only horizontal separators** between rows. There are **no vertical borders** and **no outer box border** around the table. Rows are separated by a single thin line so the table reads as a simple list with a header.

---

## 2. Global table base (CSS)

The app has a global table style that you can build on or override per card:

- **Layout:** `border-collapse: collapse`, `width: 100%`, optional `margin-top`.
- **Cells:** `padding: 0.75rem 1rem` (global); in dashboard/infractions we often use **smaller padding**: `padding: 4px 8px` or `padding: 6px 8px`.
- **Row separator:** `border-bottom: 1px solid var(--border)` on both `th` and `td`. No `border-left`, `border-right`, or `border` on the table.
- **Header row:** `background: var(--bg-elevated)`, `font-weight: 600`, optional `text-transform: uppercase`, `letter-spacing`, smaller `font-size` (e.g. `0.75rem`). Text color can be `var(--text-secondary)` or inherit.
- **Alignment:** First column (labels) `text-align: left`; numeric/second column often `text-align: right`.
- **Font size:** For compact dashboard tables we use `font-size: 0.85rem` on the table.

---

## 3. Inline pattern used in JS (dashboard / infractions)

When building tables in JavaScript (e.g. in the infractions card or similar), use this pattern so all such tables look the same.

**Table element:**
- `style="border-collapse: collapse; font-size: 0.85rem; margin-top: 4px;"`

**Header cells (`<th>`):**
- `style="padding: 4px 8px; border-bottom: 1px solid var(--border); text-align: left; background: var(--bg-elevated);"`
- For a **right-aligned** column (e.g. "Count", "Value"): use `text-align: right` instead of `text-align: left`.

**Body cells (`<td>`):**
- `style="padding: 4px 8px; border-bottom: 1px solid var(--border);"`
- Add `text-align: right` for numeric columns.

**Last row (optional):** To avoid a double line at the bottom, you can omit `border-bottom` on the last row’s cells (e.g. via CSS like `.table-class tr:last-child td { border-bottom: none; }` or a class on the last row).

---

## 4. Token summary for agents

- **Border:** `1px solid var(--border)` — only on **bottom** of `th`/`td`.
- **No** vertical or outer borders.
- **Header background:** `var(--bg-elevated)`.
- **Cell padding:** `4px 8px` or `6px 8px` for compact tables.
- **Table:** `border-collapse: collapse`, `font-size: 0.85rem`, `margin-top: 4px`.
- **Label column:** `text-align: left`.
- **Number column:** `text-align: right`.

---

## 5. Example HTML snippet

```html
<table style="border-collapse: collapse; font-size: 0.85rem; margin-top: 4px;">
  <thead>
    <tr>
      <th style="padding: 6px 8px; border-bottom: 1px solid var(--border); text-align: left; background: var(--bg-elevated);">Label</th>
      <th style="padding: 6px 8px; border-bottom: 1px solid var(--border); text-align: right; background: var(--bg-elevated);">Count</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td style="padding: 6px 8px; border-bottom: 1px solid var(--border);">Item A</td>
      <td style="padding: 6px 8px; border-bottom: 1px solid var(--border); text-align: right;">12</td>
    </tr>
    <tr>
      <td style="padding: 6px 8px; border-bottom: 1px solid var(--border);">Item B</td>
      <td style="padding: 6px 8px; border-bottom: 1px solid var(--border); text-align: right;">8</td>
    </tr>
  </tbody>
</table>
```

---

## 6. List-style “tables” (breakdown lists)

Some cards use a **list** that looks like a two-column table (e.g. `.dashboard-breakdown-list` with `.dashboard-breakdown-item`). Each item has:

- Two-column layout (e.g. CSS Grid: `grid-template-columns: auto minmax(5rem, auto)`), labels left, values right.
- Same horizontal rule: `border-bottom: 1px solid var(--border)` per item; last item has `border-bottom: none`.
- Same tokens: `var(--border)`, `var(--bg-elevated)`, `var(--text-primary)` / `var(--text-secondary)`.

When that list is implemented as an actual **table** (e.g. infractions overview), the same rules apply: horizontal borders only, header with `var(--bg-elevated)`, compact padding, label left / number right.

---

Using this pattern across all dashboard/infractions tables keeps a consistent, minimal “horizontal lines only” look and works with the app’s CSS variables (`--border`, `--bg-elevated`, etc.).
