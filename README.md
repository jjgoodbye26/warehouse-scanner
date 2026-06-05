# Warehouse Scanner

A warehouse packing tracker for WhatNot and TikTok orders. Packers scan USPS barcodes to log their work; admins see live stats and can export to CSV.

---

## Setup (5 steps)

### 1. Create a Supabase project
1. Go to [supabase.com](https://supabase.com) and create a free account
2. Create a new project (save your database password)
3. Wait for the project to finish setting up (~1 min)

### 2. Run the database schema
1. In your Supabase project, go to **SQL Editor**
2. Open `supabase-schema.sql` from this folder
3. Paste the entire contents and click **Run**

### 3. Add your Supabase credentials
1. In Supabase, go to **Project Settings → API**
2. Copy your **Project URL** and **anon/public key**
3. Open `js/config.js` and replace the placeholders:
   ```js
   const SUPABASE_URL = 'https://YOUR_PROJECT_ID.supabase.co';
   const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY_HERE';
   ```

### 4. Create your admin account
You need to create the first admin account manually via Supabase:

1. Go to **Authentication → Users** in your Supabase dashboard
2. Click **Add User** → **Create new user**
3. Email: `youradminname@warehouse.packer`  (replace `youradminname`)
4. Password: choose a strong password
5. Click **Create User**
6. Now go to **SQL Editor** and run:
   ```sql
   INSERT INTO profiles (id, username, role)
   SELECT id, 'youradminname', 'admin'
   FROM auth.users
   WHERE email = 'youradminname@warehouse.packer';
   ```

### 5. Deploy to Vercel
1. Push this folder to a GitHub repo
2. Go to [vercel.com](https://vercel.com) → **New Project** → import the repo
3. Click **Deploy** (no build settings needed — it's static)
4. Your app is live! Share the URL with your packing team.

---

## How it works

| Page | URL | Who uses it |
|------|-----|-------------|
| Login | `/index.html` | Everyone |
| Scan | `/scan.html` | Packers |
| Admin | `/admin.html` | Admin only |

### Adding packers
- Log in as admin → click **+ Add Packer**
- Enter username + password → done
- Packers log in with just their username and password (no email needed)

### Scanning
- Packer logs in → selects **WhatNot** or **TikTok**
- Scans USPS label with USB barcode scanner (auto-submits)
- Each scan is logged with packer name, tracking number, platform, and timestamp
- Duplicate tracking numbers on the same day trigger a warning

### Admin dashboard
- **Overview tab**: per-packer stats cards (today / this week / all time)
- **All Scans tab**: filterable table with CSV export
- **Packers tab**: list of all accounts with scan counts

---

## Local testing
Just open `index.html` in a browser — no server needed.
For best results, use a simple local server:
```bash
npx serve .
# or
python3 -m http.server 3000
```
