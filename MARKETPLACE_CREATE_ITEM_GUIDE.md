# How to Create a Marketplace Item

This guide explains how to create items in the marketplace, with instructions broken down by **Staff** and **Admin** permissions.

---

## Who Can Create Items?

| Role | Can Create Items? | Notes |
|------|-------------------|-------|
| **Admin** | Yes | Full access: any grade range including School-wide |
| **Staff** (regular) | Yes | K–3, 4–8, or 9–12 only (no School-wide) |
| **Outside Staff** | No | Cannot create marketplace items |
| **Student** | No | Students can only browse and purchase |

---

## Where to Find the Add Item Button

1. **Log in** to the app with a staff or admin account.
2. **Open the Marketplace view** (click the **Marketplace** tab in the main navigation).
3. In the **Add marketplace items** section near the top, click the **Add item** button.
4. The **Add marketplace item** modal will open.

> **Note:** If you do not see the "Add marketplace items" section or the "Add item" button, your account may not have permission (e.g., you are Outside Staff or a Student).

---

## Step-by-Step: Creating an Item

### Required Fields (All Users)

| Field | Description | Example |
|-------|-------------|---------|
| **Name** | The item name shown to students | "Pizza Slice" |
| **Price ($)** | Cost in dollars (must be greater than 0) | 5.00 |

### Optional Fields

| Field | Description |
|------|-------------|
| **Description** | Brief description of the item |
| **Grade range** | Which students can see the item (see permissions below) |
| **Type** | Item type for filtering (e.g., "Food", "Activity") |
| **Category** | Category for organization (e.g., "Snacks", "Rewards") |
| **Image URL** | Direct link to an image (e.g., from Imgur or a website) |

### Grade Range Options

| Option | Who Can Select | Who Can See the Item |
|--------|----------------|----------------------|
| **K–3** | Staff, Admin | Students in grades K–3 |
| **4–8** | Staff, Admin | Students in grades 4–8 |
| **9–12** | Staff, Admin | Students in grades 9–12 |
| **School-wide** | **Admin only** | All students regardless of grade |

> **Staff restriction:** If you are Staff (not Admin), the **School-wide** option is disabled. Only admins can create items visible to all grades.

---

## Staff Instructions

### What Staff Can Do

- Create items with grade range **K–3**, **4–8**, or **9–12**
- Add new **Types** and **Categories** on the fly (type a new name and select "Add [name]")
- Edit items they created
- Delete items they created
- Hide items from specific students, card colors, or grade sections

### What Staff Cannot Do

- Create **School-wide** items (only admins can)
- Edit or delete items created by other users

### Steps for Staff

1. Go to **Marketplace** → **Add item**.
2. Enter **Name** (required) and **Price** (required).
3. Optionally add a description, type, category, or image URL.
4. Select a **Grade range** (K–3, 4–8, or 9–12). School-wide will be disabled.
5. Click **Save**.

---

## Admin Instructions

### What Admins Can Do

- Everything Staff can do
- Create **School-wide** items (visible to all students)
- Edit **any** marketplace item (not just their own)
- Delete **any** marketplace item (not just their own)

### Steps for Admins

1. Go to **Marketplace** → **Add item**.
2. Enter **Name** (required) and **Price** (required).
3. Optionally add a description, type, category, or image URL.
4. Select a **Grade range** (K–3, 4–8, 9–12, or **School-wide**).
5. Click **Save**.

---

## Adding Types and Categories

Types and categories help organize items and let students filter the catalog. Both Staff and Admin can add them when creating an item:

1. In the **Type** or **Category** field, type a new name (e.g., "Snacks").
2. If it does not exist, an option **Add "[name]"** appears in the dropdown.
3. Click **Add "[name]"** to create it and select it for the item.
4. The new type or category is saved and available for future items.

> **Tip:** Ensure types and categories are set up before creating many items. You can add them as needed when creating each item.

---

## Adding an Image URL

1. Find an image online (not from Google Images search results—use the actual image page).
2. Right-click the image → **Copy image address** (or **Copy image link**).
3. Paste the URL into the **Image URL** field.
4. Or upload an image to a host (e.g., Imgur, Google Drive with "Anyone with the link") and use the direct image link. URLs ending in `.jpg`, `.png`, or `.gif` work best.

Leave the field blank if you do not have an image.

---

## After Creating an Item

- The item appears in the marketplace catalog for students in the selected grade range.
- Staff and Admin can **Edit**, **Delete**, or **Hide from students** using the buttons on each item card.
- Staff can only edit or delete items they created; Admins can edit or delete any item.

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Add item" button not visible | Your role may not allow it. Regular Staff and Admin can create items; Outside Staff and Students cannot. |
| "Only admins can create school-wide items" | Select K–3, 4–8, or 9–12 instead, or ask an admin to create the item. |
| "Outside staff cannot create marketplace items" | Outside Staff accounts cannot create items. Ask a regular Staff or Admin to create it. |
| "Name and valid price required" | Ensure Name is not empty and Price is a positive number. |
| Type or Category not saving | Use the "Add [name]" option in the dropdown to create it first. |

$env:DATABASE_URL = "postgres://avnadmin:YOUR_AIVEN_PASSWORD@your-host.aivencloud.com:23771/defaultdb?sslmode=require"
python migrate_linked_case_manager_id.py