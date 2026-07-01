# WordCraft Rewriter — Setup Guide

## What this app does

1. You paste a WordPress admin URL like `https://yoursite.com/wp-admin/post.php?post=3937&action=edit`
2. It fetches the live article from WordPress using the REST API + Application Password
3. Claude reads it and rewrites it based on your instructions
4. You click **Save to WordPress** — the same post is updated in place

No plugin needed. No WP plugin to install. Uses WordPress's built-in REST API.

---

## Step 1 — Deploy to Render (5 minutes)

### 1a. Push to GitHub

```bash
cd wordcraft-rewriter
git init
git add .
git commit -m "WordCraft Rewriter"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/wordcraft-rewriter.git
git push -u origin main
```

### 1b. Create a Render Web Service

1. Go to https://render.com → **New +** → **Web Service**
2. Connect GitHub → select `wordcraft-rewriter`
3. Settings:
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Instance Type:** Free
4. Click **Create Web Service**

### 1c. Add your Anthropic API key

1. Render dashboard → your service → **Environment**
2. Add variable: `ANTHROPIC_API_KEY` = your key from https://console.anthropic.com
3. Save — Render redeploys automatically

---

## Step 2 — Create a WordPress Application Password

This replaces your WP login password for API calls (much safer).

1. Log into your WordPress admin
2. Go to **Users → Profile** (or **Users → All Users → Edit your user**)
3. Scroll down to **Application Passwords**
4. Enter a name like `WordCraft Rewriter` → click **Add New Application Password**
5. **Copy the generated password** — it's shown only once
6. Paste it into the app's **Application Password** field

> Your regular WP login password is never used or stored.

---

## Step 3 — Use it

1. Open your app at `https://wordcraft-rewriter-XXXX.onrender.com`
2. Fill in the sidebar:
   - **Admin Post URL:** the full URL from your browser when editing a post, e.g.  
     `https://intellectualprestige.com/wp-admin/post.php?post=3937&action=edit`
   - **Site URL:** `https://intellectualprestige.com`
   - **Username:** your WP username (not email)
   - **Application Password:** the password you created in Step 2
3. Click **Fetch Article** — the original appears on the left
4. Type your rewrite instructions in the box below
5. Click **Rewrite with Claude** — the new version appears on the right
6. Review it, then click **Save to WordPress** — the post is updated in place
7. Click **Open in WordPress editor** to review / publish

---

## Local development

```bash
cd wordcraft-rewriter
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY
npm install
npm start
# Open http://localhost:3000
```

---

## Notes

- **No WordPress plugin needed** — uses the built-in WP REST API
- The app updates the post as a **draft** (preserves its current status)
- Application Passwords require HTTPS on your WordPress site
- Free Render tier sleeps after 15 min of inactivity — first load ~30s
- Uses `claude-opus-4-6` for best rewriting quality
