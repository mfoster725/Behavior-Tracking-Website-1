# Marketplace Feature — Technical & UX Implementation Plan

This document is a technical and UX implementation plan for a new **Marketplace** tab in the existing student banking application. It is based on the stated requirements and on the current codebase (Flask, SQLAlchemy, Bank Account / Accounts UI patterns). **Decisions from product clarification are recorded in Section 8 (Resolved).**

---

## 1. High-Level Architecture Overview

### 1.1 Current Context (Existing App)

- **Stack:** Flask backend, SQLAlchemy (PostgreSQL in production, SQLite locally), server-rendered `index.html` with vanilla JS, `style.css` for layout.
- **Navigation:** Tab-based; tabs include Period Entry, Daily Entry, Summary, Frenzy Stats, Schedules, **Bank Account**, **Accounts**, Admin Panel, User Management. Tab switching is via `data-view` and `.view` sections.
- **Bank Account tab:** Uses `.form-section.accounts-ui`: student selector (staff/admin), balance card, subsections (Paychecks, Marketplace section, Purchase Orders, Transaction History). Reusable patterns: search/autocomplete, balance card, list/grid layouts, modals.
- **Existing marketplace:** Implemented as a **section inside** the Bank Account view (not a separate tab). Uses `MarketplaceItem` (no grade range, no image, no type/category), `PurchaseOrder` (tied to `case_manager_id`), and `MarketplaceItemRequest` for global/creation requests. No cart; single-item purchase flow.
- **Roles:** `student`, `staff`, `admin`. Staff have `designation` (e.g. Case Manager, Practitioner) and `grades_taught` (e.g. `"9-12"`). `OutsideStaffStudent` links outside staff to specific students. “Support team” is **not** currently a first-class concept in the API; purchase orders are assigned to the student’s Case Manager only.

### 1.2 Target Architecture for Marketplace Tab

- **New top-level tab:** “Marketplace” (same nav pattern as Bank Account).
- **Same UI scheme as Bank Account tab:** Reuse `.form-section.accounts-ui`, balance card style, search/filter patterns, card grids, and modal patterns so the Marketplace tab feels like the same app.
- **Backend:** New/updated API routes under e.g. `/api/marketplace/...` for catalog, cart, checkout, purchase orders, notifications, and (staff) item management. Existing `MarketplaceItem` / `PurchaseplaceOrder` / `MarketplaceItemRequest` can be extended or kept and wrapped by new logic where appropriate.
- **Student path:** Marketplace tab → browse (grade-filtered) → search/filter → item cards → add to cart → checkout → purchase order created (no money moved until approval) → student sees status and gets approval/rejection notification.
- **Staff path:** Purchase orders sent to “support team”; any support team member can approve (except school-wide item approval, which is admin-only). Item creation/suggestions and approval follow role rules (see below).

---

## 2. Database / Data Model Suggestions

### 2.1 Existing Tables to Reuse or Extend

| Table | Use |
|------|-----|
| `users` | Roles, `grades_taught`, `designation`. |
| `students` | `grade` (e.g. K, 1–12) for visibility filtering. |
| `bank_accounts` | Balance check at checkout; debit on approval. |
| `transactions` | Already has `purchase_order_id`; record purchase on approval. |
| `team_members` | Links student to staff **by name** (Case Manager, Practitioner, etc.). |
| `outside_staff_students` | Links outside staff users to students. |
| `marketplace_items` | Extend with grade range, type, category, image (see below). |
| `purchase_orders` | Extend for “support team” and approver (see below). |
| `marketplace_item_requests` | Reuse or extend for “suggest item” and approval workflow. |

### 2.2 Suggested New/Extended Fields

**MarketplaceItem (extend)**

- `grade_range` — enum or string: `k_3`, `4_8`, `9_12`, `school_wide`. Determines visibility to students.
- `item_type` — string; **admin-managed** (e.g. from a configurable list or lookup table), used for filters.
- `category` — optional string; **admin-managed**, used for sub-filtering.
- `image_url` or `image_path` — optional; store URL or path for item card image.
- `status` — e.g. `draft | pending_approval | active | inactive` if you want “suggested” items to be pending approval.
- Optional: `suggested_by_user_id` (for staff-suggested items) and `approved_by_user_id` / `approved_at` for approval audit.

**PurchaseOrder (extend)**

- `approved_by_user_id` — FK to `users`; set when a support team member approves; display “approving staff member’s name.”
- `denied_by_user_id` — FK to `users`; set when a support team member denies.
- `denial_reason` — text; optional reason shown to the student when denied.
- Support team is derived from team_members + outside_staff_students + admins; no need to store a single “case_manager_id” for routing (can keep for legacy/reporting if desired).

**New table: Cart / CartItem (optional)**

- **Checkout:** Client sends a list of `{ item_id, quantity }`; backend creates **one purchase order per cart line** (one order per item/quantity line).

**New table: Notifications (recommended)**

- `notifications` — `id`, `user_id`, `type` (e.g. `purchase_approved`, `purchase_denied`, `item_suggested_approved`), `title`, `body` or `payload` (JSON), `read_at`, `created_at`, optional `purchase_order_id` / `marketplace_item_request_id` for linking. Allows in-app (and later email/push if needed) for “purchase approved/rejected” and related events.

### 2.3 Grade Range and Visibility

- **Storage:** Store one `grade_range` per item: `k_3`, `4_8`, `9_12`, `school_wide`.
- **Student visibility:** A student with `student.grade` in [K,1,2,3] sees items with `grade_range` = `k_3` or `school_wide`; similarly for 4–8 and 9–12. Exact mapping (e.g. “K” vs “0”) should match how `students.grade` is stored in your app (currently K, 1–12).
- **Index:** Add index on `(marketplace_items.grade_range, is_active)` for catalog queries.

---

## 3. Role-Based Permission Logic

### 3.1 “Support Team” Definition (Decided)

- **Support team** = all staff associated with the student. In the current data model this is implemented as:
  - users in `team_members` for that student (matched by `TeamMember.name` to `User.name`), **or**
  - users in `outside_staff_students` for that student, **or**
  - users with `role = 'admin'`.
- **Purchase order routing:** When a purchase order is created, all support team members can see the pending order and approve/deny it (subject to school-wide rule below). The **approver** is stored in `approved_by_user_id`; denial in `denied_by_user_id` and `denial_reason`.

### 3.2 Who Can See Purchase Orders

- **Students:** Only their own orders.
- **Staff/Admin:** Orders for students they have access to (e.g. `has_student_access`). Optionally filter “orders for my support team students” (e.g. orders where I am in the support team) so staff see a clear queue.
- **Approval:** Any support team member can approve **except** for the school-wide item rule below.

### 3.3 Item Creation and Approval

| Actor | Create item | Approve item (within grade) | Approve school-wide item |
|-------|-------------|-----------------------------|---------------------------|
| **Case Manager** | Yes (within their `grades_taught`) | Yes (within their `grades_taught`) | No |
| **Admin** | Yes (any grade / school-wide) | Yes (any) | Yes (only role that can) |
| **Other staff** | Suggest only (creates “pending” item or request) | No | No |
| **Student** | No | No | No |

- **“Teacher” for item create/approve** = staff with designation **Case Manager** only (not all staff with `grades_taught`).
- **Grade range vs `grades_taught`:** An item has a single `grade_range` (k_3, 4_8, 9_12, school_wide). A teacher can create/approve an item only if that item’s `grade_range` is within the teacher’s `grades_taught` (you need a mapping from `grade_range` to grades, e.g. 9_12 → 9,10,11,12). School-wide is a special case: only admin can approve.
- **Suggestions:** “Other staff” create a record (e.g. `MarketplaceItemRequest` with type `create_new` and payload or link to a draft item). Teachers can approve within their grade; admins can approve any; school-wide suggestions require admin approval.

### 3.4 Purchase Order Approval and School-Wide Items

- **Normal items (k_3, 4_8, 9_12):** Any support team member can approve the purchase (first one to approve wins; then order moves to “approved” and then “fulfilled” when money is debited).
- **School-wide items:** Requirement: “Only admin can approve school-wide items.” So when the item’s `grade_range = school_wide`, only users with `role = 'admin'` may approve the purchase order. Other support team members can still see it but not approve.

---

## 4. UI/UX Flow (Step-by-Step)

### 4.1 Adding the Marketplace Tab

- In `templates/index.html`, add a nav button: `<button class="nav-btn" data-view="marketplace">Marketplace</button>` (e.g. next to Bank Account).
- Add a new section: `<div id="marketplace-view" class="view">...</div>`.
- Structure inside `marketplace-view` mirrors Bank Account: same `.form-section.accounts-ui`, same header style, then:
  - **Staff/Admin:** At the **top** of the Marketplace tab, a **separate section** for **Purchase order approvals** (list of pending orders for students they have access to; Approve/Deny with reason). Below that, a **student selector** so staff can “view as” a selected student (catalog, cart, orders). Then the same student view as below.
  - **Student (or selected student):** Balance summary card (reuse Bank Account balance card component), then search, filters, item grid, cart, checkout.

### 4.2 Student View — Browse and Filter

1. **Entry:** Student opens Marketplace tab. Balance card at top (read-only; same as Bank Account).
2. **Search bar:** Single text input; search by item name/description (backend: filter by name/description).
3. **Filters:** Type (dropdown), Category (dropdown), Price (e.g. min/max or ranges). Filters are applied in addition to grade-based visibility (backend always enforces grade range + school-wide).
4. **Item cards:** Grid of cards. Each card: image (or placeholder), name, short description, cost. Buttons: “Add to cart” (and optionally “View details” if you add a detail modal).
5. **Grade visibility:** No UI for “my grade”; backend only returns items valid for the student’s grade (and school-wide). So students do not see a grade filter; they see only what they’re allowed to see.

### 4.3 Student View — Cart and Checkout

1. **Cart:** Visible on the same view (e.g. sidebar or collapsible section) or a small “Cart (n)” link that opens a cart panel/modal. List: item name, quantity, unit price, line total. Actions: change quantity, remove line.
2. **Checkout:** Button “Checkout”. On click:
   - Backend checks balance for **total** of cart.
   - If total > balance: show warning “You do not have enough money” and **do not** create orders; optionally highlight balance in red.
   - If total ≤ balance: create **one purchase order per cart line**. Status = `pending`. Show success message and clear cart (or redirect to “My orders”).
3. **Post-checkout:** Redirect or in-place message: “Your purchase request has been sent to your support team. You’ll be notified when it’s approved or denied.”

### 4.4 Staff View — Purchase Orders and Approval

1. **Where:** **At the top of the Marketplace tab**, a dedicated **Purchase order approvals** section (separate from the “view as student” area). List of pending (and optionally approved/denied) orders for students the staff has access to.
2. **Row:** Student name, item, price, date, status. Actions: Approve, Deny (with **required** reason field for Deny).
3. **Approval:** Any support team member can approve (except school-wide items: admin only). On Approve: re-check balance; if sufficient, set `approved_by_user_id`, `approved_at`, status → approved; then fulfill (debit bank, create transaction, mark fulfilled). Create **notification** for student: “Your purchase of … was approved by [approver name].” If balance is insufficient at approval time, **auto-deny** and create notification: “Your purchase was denied due to insufficient funds.”
4. **Denial:** Staff can enter a **reason**; store `denied_by_user_id` and `denial_reason`. Create **notification** for student: “Your purchase of … was not approved.” (Include reason if provided.)

### 4.5 Item Creation and Approval (Staff/Admin)

- **Create item (teachers/admins):** Form: name, description, cost, image (upload or URL), grade range (K-3, 4-8, 9-12, School-wide), type, category. Teachers: grade range must match their `grades_taught`; admins: any. On submit, item is `active` (or `pending_approval` if you use that for suggestions).
- **Suggest item (other staff):** Same form but submitted as “suggestion”; creates `MarketplaceItemRequest` (or draft item with status `pending_approval`). Visible in “Item requests” or “Pending items” for teachers/admins. Teacher approves within grade; admin approves any; school-wide requires admin.
- **Approve/deny item requests:** List of pending requests; Approve/Deny buttons with same grade/school-wide rules as above.

### 4.6 Notifications (In-App)

- **Place:** Nav bar or header: bell icon with unread count; clicking opens dropdown or panel listing notifications (e.g. “Purchase approved: …”, “Purchase denied: …”). Mark as read on click or when viewed.
- **Trigger:** On purchase order approved or denied, create a `notifications` row for the student user. Optionally notify staff when a new purchase order is created (e.g. “New purchase request from [student]”).

---

## 5. State Management and Edge Cases

### 5.1 Cart

- **Client-side cart:** Store in `sessionStorage` (or `localStorage`) keyed by user/student so it survives refresh but not across devices. On checkout, send item IDs and quantities; backend validates availability, price, and grade visibility again.
- **Concurrent edits:** If two tabs open, last write wins for client-side cart. No strong consistency required for cart.
- **Item removed or deactivated:** If an item in the cart was deleted or deactivated or changed price, backend should reject that line at checkout and return a clear error (“Item X is no longer available” or “Price changed”).

### 5.2 Purchase Order Lifecycle

- **pending** → **approved** (by support team member) → **fulfilled** (debit account, create transaction). Or **pending** → **denied**.
- **Double approval:** Only one approver; once `approved_by_user_id` is set, no one else can approve. Idempotent “Approve” is safe.
- **Balance change between checkout and approval:** At **approval** time, re-check balance. If balance has dropped below order total, **auto-deny** the order and create a notification to the student: “Your purchase was denied due to insufficient funds.”

### 5.3 Item Availability and Price

- **Stock:** Requirements do not mention inventory. Assumption: no stock limit; only “active” and grade visibility.
- **Price change:** Store `item_price` on `PurchaseOrder` at checkout so approval always uses the price at time of order.

### 5.4 Grade and Support Team Changes

- **Student grade change:** Already-purchased orders keep their snapshot. Catalog visibility uses current grade; no need to re-validate old orders.
- **Support team change:** Pending orders are already “sent”; no need to re-assign. New staff added to team see existing pending orders; removed staff lose access (normal `has_student_access` behavior).

---

## 6. Notification Flow Design

### 6.1 Events to Notify

| Event | Recipient | Content (example) |
|-------|------------|--------------------|
| Purchase approved | Student | “Your purchase of [item name(s)] was approved by [approver name].” |
| Purchase denied | Student | “Your purchase of [item name(s)] was not approved.” Include denial reason if provided. |
| Purchase denied (insufficient funds at approval) | Student | “Your purchase was denied due to insufficient funds.” |
| (Optional) New purchase order | Support team members | “New purchase request from [student name].” |

### 6.2 Implementation Outline

- **Table:** `notifications` (see Section 2.2).
- **Create:** In the API that updates purchase order to approved/denied, after commit, insert one notification per student (and optionally per support team user for “new order”).
- **Delivery:** In-app only in this phase: GET `/api/notifications` (unread first, limit 50). PATCH “mark as read” by id or “mark all read.”
- **UI:** Bell icon + count in header; dropdown/panel with list; link to Marketplace or “My orders” where relevant.

---

## 7. Assumptions (Explicit)

1. **Marketplace is a new tab**; the existing Marketplace section inside Bank Account is **removed**; all marketplace functionality is driven from the new Marketplace tab.
2. **“Teacher” for item create/approve** = staff with designation **Case Manager** only.
3. **Grade ranges** are exactly K-3, 4-8, 9-12, School-wide; student grade is stored as in current DB (K, 1…12).
4. **Support team** = all staff associated with the student (team_members + outside_staff_students + admins).
5. **Cart:** Client-side (e.g. sessionStorage); checkout sends cart lines; backend creates **one purchase order per cart line**.
6. **One approval per order:** First support team member to approve wins. Any support team member can approve purchase orders (school-wide items: admin only).
7. **No inventory/quantity limits** for items unless added later.
8. **Notifications** are in-app only in this plan; email/push can be added later.
9. **Image** for items: **URL only** — staff enters an image URL when creating/editing an item; app stores the URL and displays it on the card. No file upload or server storage.
10. **Type and category** are **admin-managed** (configurable list or lookup table).

---

## 8. Resolved Decisions

### 8.1 Resolved (from product clarification)

| # | Decision |
|---|----------|
| 1 | **Support team** = all staff associated with the student (implemented via team_members + outside_staff_students + admins). |
| 2 | **One purchase order per cart line** (not one order with multiple lines). |
| 3 | **Staff/admins can “view as” student** in Marketplace; **purchase order approvals** are in a **separate section at the top** of the Marketplace tab. |
| 4 | **Yes:** Any support team member (including other staff) can approve **purchase orders**. Only Case Managers and admins can create/approve **items**. |
| 5 | **Yes:** Denial includes an optional reason shown to the student; store `denial_reason` and `denied_by_user_id`. |
| 6 | **Balance at approval:** **Auto-deny** with notification: “Your purchase was denied due to insufficient funds.” |
| 7 | **Type/category:** **Admin-managed** (configurable list or lookup table). |
| 9 | **Existing Marketplace section** in Bank Account: **Remove it**; drive everything from the new Marketplace tab. |
| 10 | **“Teacher” for items** = **Case Manager** designation only (not all staff with `grades_taught`). |
| 8  | **Item images** = **URL only** — staff enters image URL when creating/editing item; store URL, display on card; placeholder when missing. |

### 8.2 Item images (decided)

**Item images = URL only.** Staff enters an image URL when creating/editing an item; the app stores the URL (e.g. `image_url` on `marketplace_items`) and displays it on the card. No file upload or server storage. Placeholder used when URL is missing or invalid.

### 8.3 Dependencies

- **Notification table and API** must exist before purchase approval/denial can send in-app notifications.
- **Grade range and visibility** logic must be implemented and tested for all four ranges and for “school-wide” (admin-only approval for orders).
- **Support team resolution** (team_members + outside_staff_students + admins) must be implemented and performant (e.g. cached or query per student).
- **Admin-managed type/category** requires a small lookup table or config (e.g. `marketplace_item_types`, `marketplace_categories`) and admin UI to manage them.

---

## 9. Suggested Implementation Order

1. **Data model:** Add `grade_range`, `item_type`, `category`, `image_url` (or similar) to `marketplace_items`; add `approved_by_user_id` (and optionally `denied_by_user_id`, `denial_reason`) to `purchase_orders`; create `notifications` table.
2. **Support team helper:** Implement `get_support_team_user_ids(student_id)` and use it for “who can see/approve this order” and for school-wide vs. non–school-wide approval rule.
3. **Catalog API:** GET marketplace items filtered by student grade (and school-wide), with search and filters; reuse/extend existing `MarketplaceItem` and item APIs.
4. **Marketplace tab UI:** Add tab and view; balance card; search; filters; item grid (reuse Bank Account card style); client-side cart; checkout API that validates balance and creates purchase order(s).
5. **Purchase order list for staff:** In Marketplace (or Bank Account) show pending orders for students they have access to; filter by “my support team” if desired; Approve/Deny with school-wide check.
6. **Fulfillment and notifications:** On Approve, debit account, create transaction, create student notification. On Deny, create student notification. Bell + notification API + dropdown UI.
7. **Item creation/approval:** Create/suggest item forms; grade range and school-wide rules; approval queue for suggested items.
8. **Testing and edge cases:** Insufficient balance at checkout and at approval; item deactivated mid-cart; support team and admin-only school-wide approval.

---

This plan is ready for review. Once the open questions above are decided, the implementation can proceed along the suggested order with minimal ambiguity.
