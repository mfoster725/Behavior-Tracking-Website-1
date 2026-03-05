# Infractions Card Tab System — Specification for Reuse

This document describes how the **two-level tab system** in the Infractions card works so it can be recreated in another card (e.g. by Cursor’s Auto agent). The system has **main tabs** (Level 1) and **drilldown subtabs** (Level 2) that live inside a selected main tab.

---

## 1. High-Level Overview

- **Level 1 (main tabs):** One always-present tab (e.g. "Overview") plus zero or more **dynamic tabs** created when the user performs an action (e.g. clicking a row). Each main tab has one panel. Dynamic tabs can be **closed** via a × button; closing the active one switches back to the primary tab.
- **Level 2 (drilldown tabs):** Only exist **inside** a given main-tab panel. One always-present subtab (e.g. "Overview") plus zero or more **dynamic subtabs** created when the user drills (e.g. clicking a time or day row). Same close behavior: × removes that subtab and its panel; if the active subtab is closed, the primary subtab becomes active.

Important: **Level 2 tabs are scoped per Level 1 panel.** Each main-tab panel that uses drilldown has its own tab list and panel list. There is no shared state between different main panels’ drill tabs.

---

## 2. DOM Structure

### 2.1 Level 1 — Main Tabs (card-wide)

All of this lives inside a single card container (e.g. `.infractions-card`).

```html
<div class="dashboard-card infractions-card">
  <div class="dashboard-breakdown-card-inner">
    <div class="dashboard-card-header">...</div>

    <!-- Tab list: buttons with data-tab and optional close -->
    <div class="infractions-tabs" role="tablist">
      <button class="infractions-tab active" data-tab="overview" role="tab" aria-selected="true">
        <span class="infractions-tab-label">Overview</span>
        <!-- No close button on primary tab -->
      </button>
      <!-- Dynamic tabs get a close button: -->
      <!-- <button class="infractions-tab" data-tab="inf-NFD" role="tab" aria-selected="false">
           <span class="infractions-tab-label">NFD</span>
           <span class="infractions-tab-close" aria-label="Close" role="button">&times;</span>
         </button> -->
    </div>

    <!-- One panel per tab; data-tab-panel must match data-tab -->
    <div class="infractions-tab-panels">
      <div class="infractions-tab-panel infractions-tab-overview is-active" data-tab-panel="overview">
        <!-- Overview content -->
      </div>
      <!-- <div class="infractions-tab-panel" data-tab-panel="inf-NFD">...</div> -->
    </div>
  </div>
</div>
```

**Conventions:**
- **Tab:** `data-tab` = unique id (e.g. `"overview"` or `"inf-NFD"`). Primary tab has no `.infractions-tab-close`.
- **Panel:** `data-tab-panel` must equal the tab id. Exactly one panel has `.is-active`; the corresponding tab has `.active` and `aria-selected="true"`.

### 2.2 Level 2 — Drilldown Tabs (inside one main panel)

Level 2 markup is **inside** one main-tab panel (e.g. inside the panel with `data-tab-panel="inf-NFD"`). Each such panel has its **own** drill tab list and drill panels.

```html
<div class="infractions-tab-panel" data-tab-panel="inf-NFD">
  <div class="overview-detail-container infractions-by-time-day">
    <!-- Drill tab list -->
    <div class="infractions-drilldown-tabs" role="tablist">
      <button class="infractions-drill-tab active" data-drill-tab="overview" role="tab" aria-selected="true">
        <span class="infractions-drill-tab-label">Overview</span>
      </button>
      <!-- Dynamic drill tabs have close: -->
      <!-- <button class="infractions-drill-tab" data-drill-tab="time-8:30-9:00" ...>
           <span class="infractions-drill-tab-label">8:30-9:00</span>
           <span class="infractions-drill-tab-close" aria-label="Close" role="button">&times;</span>
         </button> -->
    </div>

    <!-- One drill panel per drill tab -->
    <div class="infractions-drilldown-panels">
      <div class="infractions-drill-tab-panel is-active" data-drill-tab-panel="overview">
        <!-- Overview content for this main tab (e.g. By Time / By Day tables) -->
      </div>
      <!-- <div class="infractions-drill-tab-panel" data-drill-tab-panel="time-8:30-9:00">...</div> -->
    </div>
  </div>
</div>
```

**Conventions:**
- **Drill tab:** `data-drill-tab` = unique id (e.g. `"overview"` or `"time-8:30-9:00"`). Primary subtab has no close button.
- **Drill panel:** `data-drill-tab-panel` must equal the drill tab id. Exactly one drill panel has `.is-active`; the corresponding drill tab has `.active` and `aria-selected="true"`.

---

## 3. JavaScript Behavior

### 3.1 Level 1 — Main Tabs

**Containers (query once from the card element):**
- `tabsContainer` = `card.querySelector('.infractions-tabs')`
- `panelsContainer` = `card.querySelector('.infractions-tab-panels')`

**setActiveTab(tabName):**
- For every `.infractions-tab`: add `.active` and `aria-selected="true"` only when `tab.dataset.tab === tabName`.
- For every `.infractions-tab-panel`: add `.is-active` only when `panel.dataset.tabPanel === tabName`.

**Tab click handler (use a “wire” function so you can re-call after adding tabs):**
- If the click target is `.infractions-tab-close`:  
  - Do **not** close if `tab.dataset.tab === 'overview'` (or your primary id).  
  - Remove the panel: `panelsContainer.querySelector(\`.infractions-tab-panel[data-tab-panel="${name}"]\`)` then `panel.remove()`.  
  - Remove the tab button.  
  - If no tab has `.active`, call `setActiveTab('overview')` (or your primary id).  
  - Return.
- Otherwise: call `setActiveTab(tab.dataset.tab)`.

**Adding a dynamic main tab and panel:**
1. Create a `<button class="infractions-tab">` with `data-tab={uniqueId}`, inner HTML: label span + `<span class="infractions-tab-close" ...>&times;</span>`.
2. Append to `tabsContainer`.
3. Create a `<div class="infractions-tab-panel">` with `data-tab-panel={same uniqueId}`.
4. Append a content container (e.g. a div) into the panel, then append the panel to `panelsContainer`.
5. Call `wireTabClicks()` again so the new tab gets the handler.
6. Call `setActiveTab(uniqueId)`.

Use a guard (e.g. `tab._infractionsWired`) so each tab is only wired once.

### 3.2 Level 2 — Drilldown Tabs

**Containers (query from the panel’s content root, e.g. `target`):**
- `drillTabsContainer` = `target.querySelector('.infractions-drilldown-tabs')`
- `drillPanelsContainer` = `target.querySelector('.infractions-drilldown-panels')`

**setActiveDrillTab(tabName):**
- For every `.infractions-drill-tab`: toggle `.active` and `aria-selected` based on `tab.dataset.drillTab === tabName`.
- For every `.infractions-drill-tab-panel`: toggle `.is-active` based on `panel.dataset.drillTabPanel === tabName`.

**Drill tab click handler (wire after creating the drilldown markup):**
- If click is on `.infractions-drill-tab-close`:  
  - Do **not** close if `tab.dataset.drillTab === 'overview'`.  
  - Remove the drill panel and the drill tab; if no drill tab is `.active`, call `setActiveDrillTab('overview')`.  
  - Return.
- Otherwise: `setActiveDrillTab(tab.dataset.drillTab)`.

**Adding a dynamic drill tab and panel (e.g. createOrUpdateDrillSubtab(tabName, label, innerCardHtml)):**
1. If a tab with `data-drill-tab={tabName}` already exists, reuse it; else create a button with `data-drill-tab`, label span, and close button, append to `drillTabsContainer`.
2. If a panel with `data-drill-tab-panel={tabName}` already exists, reuse it; else create a div with `data-drill-tab-panel`, append to `drillPanelsContainer`.
3. Set the panel’s inner HTML (e.g. a card wrapper + `innerCardHtml`).
4. Call `wireDrillTabClicks()` and `setActiveDrillTab(tabName)`.

Use a guard (e.g. `tab._infractionsDrillWired`) so each drill tab is only wired once.

---

## 4. CSS Requirements

- **Tab list:** flex container, gap, border-bottom for the main row; similar for the drill row (smaller font/padding).
- **Tab button:** default and `.active` styles (e.g. background, border) so the active tab is clearly distinct.
- **Panels:** `.infractions-tab-panel` and `.infractions-drill-tab-panel` use `display: none` by default; `.is-active` uses `display: block`. Only one panel per list should have `.is-active`.
- **Close button:** small × (e.g. in a circle), hover style; prevent closing the primary tab (Overview) in both levels.

In this project, all of the above are scoped under `.infractions-card` (e.g. `.infractions-card .infractions-tab { ... }`). For another card, replace the scope class (e.g. `.my-card`) and optionally rename the BEM block (e.g. `my-card-tab`, `my-card-drill-tab`).

---

## 5. Recreating This System in Another Card

### 5.1 Naming Mapping

| Infractions usage           | Generic / your card usage        |
|----------------------------|----------------------------------|
| `.infractions-card`        | Your card wrapper class          |
| `.infractions-tabs`        | Main tab list container          |
| `.infractions-tab`         | Main tab button                  |
| `data-tab`                 | Main tab id                      |
| `.infractions-tab-panels`  | Main panels container            |
| `.infractions-tab-panel`    | Main panel                       |
| `data-tab-panel`           | Main panel id (must match tab)   |
| `.infractions-tab-close`   | Main tab close button            |
| `.infractions-drilldown-tabs`   | Drill tab list container     |
| `.infractions-drill-tab`   | Drill tab button                 |
| `data-drill-tab`           | Drill tab id                     |
| `.infractions-drilldown-panels` | Drill panels container      |
| `.infractions-drill-tab-panel` | Drill panel                  |
| `data-drill-tab-panel`     | Drill panel id (must match tab)  |
| `.infractions-drill-tab-close`  | Drill tab close button      |
| Primary tab id              | e.g. `"overview"` (not closeable) |
| Primary drill tab id       | e.g. `"overview"` (not closeable) |

### 5.2 Checklist for Implementation

1. **HTML:** In the card, render the primary main tab (no close) and one main panel with `data-tab-panel` matching the primary `data-tab`. Inside that panel, if you need drilldown, render the primary drill tab (no close) and one drill panel with matching `data-drill-tab-panel` / `data-drill-tab`.
2. **Level 1 JS:** Implement `setActiveTab(tabName)` and `wireTabClicks()`; in the click handler, handle close (skip for primary tab) and activate tab. When creating a new main tab (e.g. from a row click), create tab + panel, append, re-run wire, then `setActiveTab(id)`.
3. **Level 2 JS:** In the code that renders the main panel content, implement `setActiveDrillTab(tabName)` and `wireDrillTabClicks()`; handle close (skip for primary) and activate. Provide a helper like `createOrUpdateDrillSubtab(id, label, html)` that creates or reuses tab/panel, sets content, re-wires, and activates.
4. **CSS:** Copy the tab/drill-tab and panel visibility rules; change the scope from `.infractions-card` to your card class and rename classes if desired.
5. **Scoping:** Ensure Level 2 containers (`drillTabsContainer`, `drillPanelsContainer`) are always queried from the **specific** main panel’s content root (e.g. the div you set `innerHTML` on for that tab), so each main tab has its own independent drill tabs.

### 5.3 Important Details

- **Only one active main tab and one active drill tab per drill list:** Toggle `.active` / `.is-active` so exactly one tab and one panel are active in each level.
- **Re-wire after adding tabs:** After appending new tab buttons, call the wire function again so the new buttons get the click handler (and use a per-element guard to avoid duplicate listeners).
- **Close fallback:** When the active tab is closed, set the primary tab (e.g. "overview") active. Same for drill tabs.
- **IDs:** Use stable, unique ids for dynamic tabs (e.g. `inf-${type}`, `time-${timeLabel}`) so the same tab/panel can be found when the user clicks the same row again.

---

## 6. File References in This Project

- **Main tab creation and wiring:** `static/app.js` — search for `infractions-tabs`, `setActiveTab`, `wireTabClicks`, and the row click that creates `infTab` / `panel` and calls `renderInfractionTypeBreakdown`.
- **Drill tab creation and wiring:** `static/app.js` — `renderInfractionTypeBreakdown` (builds drilldown markup), `setActiveDrillTab`, `wireDrillTabClicks`, `createOrUpdateDrillSubtab`; time/day row handlers call `createOrUpdateDrillSubtab(...)`.
- **Styles:** `static/style.css` — `.infractions-card .infractions-tabs`, `.infractions-tab`, `.infractions-tab-panel`, `.infractions-drilldown-tabs`, `.infractions-drill-tab`, `.infractions-drill-tab-panel`, and close-button styles.

Using this spec and the naming mapping, the same two-level tab system can be replicated in any other card with a different scope and optional class-name prefix.
