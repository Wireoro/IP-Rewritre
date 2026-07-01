# WordCraft Rewriter — Setup Guide

## What this app does

1. You paste a WordPress admin URL like `https://intellectualprestige.com/wp-admin/post.php?post=3937&action=edit`
2. It fetches the live article from WordPress via a small companion plugin
3. Claude reads it and rewrites it based on your instructions
4. You click **Save to WordPress** — the same post is updated in place

**This requires the WordCraft Rewriter Connector plugin to be installed and activated on the target WordPress site.** The app authenticates to that plugin using a shared secret key (not your WP login), so there's nothing to log in with — just a secret string that must match on both sides.

---

## Step 1 — Install the plugin on your WordPress site

1. Take the file `plugin/wordcraft-rewriter-connector.php`.
2. In `intellectualprestige.com/wp-admin` → **Plugins → Add New → Upload Plugin**, upload it directly (WordPress will accept a single `.php` file zipped, or you can zip the file yourself first — zip just the `.php` file, not the folder).
   - Alternatively, upload it via FTP/SFTP/hosting file manager to `wp-content/plugins/wordcraft-rewriter-connector.php`.
3. Go to **Plugins** and click **Activate** on "WordCraft Rewriter Connector."

### About the secret key

The plugin file ships with this secret already set:

```
944575b11e7f3dc73d0796ec04329563a39dbe0c14641743277c45d22cb7a7fa
```

This matches the default fallback already built into `server.js`, so **if you haven't set a `WORDCRAFT_SECRET` environment variable on your server, it'll work immediately with no extra steps.**

If you'd rather use your own secret (recommended for anything beyond quick testing, since this default value has been shared in this conversation):

1. Generate a new random string — e.g. run `openssl rand -hex 32` in a terminal, or ask Claude to generate one.
2. Open `wordcraft-rewriter-connector.php`, find this line near the top:
   ```php
   define( 'WORDCRAFT_SECRET', '944575b11e7f3dc73d0796ec04329563a39dbe0c14641743277c45d22cb7a7fa' );
   ```
   Replace the string with your new secret, then re-upload the file to WordPress.
3. On your server (Render, or wherever it's hosted), set the environment variable `WORDCRAFT_SECRET` to that **same exact string**.
4. Redeploy/restart the server so the new env var takes effect.

> ⚠️ Treat this secret like a password. Anyone who has it can read and edit posts on your site through this connector. Don't commit it to a public repo — use the environment variable on the server side rather than hardcoding it in `server.js` for anything beyond local testing.

---

## Step 2 — Deploy the app to Render (5 minutes)

### 2a. Push to GitHub

```bash
cd wordcraft-rewriter
git init
git add .
git commit -m "WordCraft Rewriter"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/wordcraft-rewriter.git
git push -u origin main
```

### 2b. Create a Render Web Service

1. Go to https://render.com → **New +** → **Web Service**
2. Connect GitHub → select `wordcraft-rewriter`
3. Settings:
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Instance Type:** Free
4. Click **Create Web Service**

### 2c. Add environment variables

1. Render dashboard → your service → **Environment**
2. Add: `ANTHROPIC_API_KEY` = your key from https://console.anthropic.com
3. (Optional but recommended) Add: `WORDCRAFT_SECRET` = your own secret, matching Step 1 above
4. Save — Render redeploys automatically

---

## Step 3 — Use it

1. Open your app at `https://wordcraft-rewriter-XXXX.onrender.com`
2. On the connect screen, enter your **Site URL**: `https://intellectualprestige.com` → click **Connect Site**
   - If this succeeds, you'll land in the main app with a green "connected" pill in the sidebar.
   - If you get **"Secret key mismatch"** — the secret in the plugin file doesn't match the one your server is using. See "About the secret key" above.
   - If you get **"plugin not found"** — the plugin isn't installed/activated on that site yet.
3. Paste the **Admin Post URL**, e.g. `https://intellectualprestige.com/wp-admin/post.php?post=3937&action=edit` → **Fetch Article**
4. Type your rewrite instructions in the sidebar → **Rewrite with Claude**
5. Review the result, then **Save to WordPress** — the post is updated in place, keeping its existing status (draft stays draft, published stays published)
6. Click **Open in WordPress editor** to review/publish

---

## Local development

```bash
cd wordcraft-rewriter
cp .env.example .env
# Edit .env and add ANTHROPIC_API_KEY (and optionally WORDCRAFT_SECRET)
npm install
npm start
# Open http://localhost:3000
```

---

## Notes

- The connector plugin is required — there is no "no plugin" mode.
- The app preserves the post's existing status when saving (draft stays draft, published stays published).
- Free Render tier sleeps after 15 min of inactivity — first load after idle ~30s.
- Uses `claude-opus-4-8` for rewriting quality.
