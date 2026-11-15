# Online library and market: plan

How Canopy sells single plants and packs, keeps track of who bought what, and lets buyers download them in the app. It is built to run on the Hostinger website and hosting we already have.

## 1. The short version

- **Website:** the Hostinger site, PHP plus the MySQL database included in the plan. There is no separate server to run.
- **Payments:** a merchant of record, Lemon Squeezy or Paddle.
  - It takes the card payment and handles VAT and sales tax worldwide.
  - It sends the receipt and handles refunds.
  - We never touch card data.
  - It calls our site (a webhook) when an order is paid or refunded.
- **Accounts:** sign in with email.
  - A one-time link or code is sent by mail, so there are no passwords to store or reset.
  - Optional later: Google sign-in.
- **Files:** stored on the Hostinger disk, outside public_html.
  - They are served only through a PHP download script.
  - The script checks the account first, then streams the file.
- **App:** the Library window reads the catalog from the website.
  - Each card shows Free, a price, or Owned.
  - Buy opens the checkout page in the browser.
  - After paying, the plant shows as Owned in the app and downloads on click.

```
App / website ──► canopy site (PHP + MySQL on Hostinger)
                     │  catalog.json, sign-in, my-library, download
                     ▼
              Lemon Squeezy / Paddle  ──webhook──►  /api/webhook.php
                (checkout, tax, receipts, refunds)
```

## 2. What we sell

| Thing | What it is | Example |
|---|---|---|
| **Asset** | One plant: a .canopy file with textures packed in, a thumbnail, preview images. | "Japanese maple" |
| **Pack** | A product made of several assets. Buying it owns every asset in it. | "Tropical pack" (8 plants) |
| **Free asset** | Price 0. Anyone can download it, no account needed. | Today's 28 samples |

**Packs:**
- An asset can be in several packs.
- Someone who bought a single plant and later buys a pack containing it simply owns it.
- Optional: a "complete the pack" discount coupon.

**Updates:** when an asset gets a new version, everyone who owns it gets the new file. Ownership is per asset, not per file version.

## 3. Database (MySQL on Hostinger)

```sql
users        (id, email UNIQUE, name, created_at, last_login_at)
login_codes  (id, email, code_hash, expires_at, used_at)            -- one-time sign-in codes
sessions     (id, user_id, token_hash, device, created_at, last_used_at, revoked_at)

assets       (id, slug UNIQUE, name, category, description, price_cents, currency,
              file_path, file_size, version, thumb_url, preview_urls JSON, published, created_at, updated_at)
packs        (id, slug UNIQUE, name, description, price_cents, currency, thumb_url, published)
pack_assets  (pack_id, asset_id, PRIMARY KEY (pack_id, asset_id))

products     (id, kind ENUM('asset','pack'), ref_id, store_variant_id UNIQUE)   -- links a store product to an asset or pack
orders       (id, user_id, store_order_id UNIQUE, status ENUM('paid','refunded'), total_cents, currency, created_at)
order_items  (order_id, product_id)
ownership    (user_id, asset_id, order_id NULL, granted_at, revoked_at NULL,
              PRIMARY KEY (user_id, asset_id))                      -- what the app checks
downloads    (id, user_id, asset_id, version, at, ip)               -- for support and abuse limits
```

**Ownership is the one table the app and the download script read:**
- Paying for a pack inserts a row for each of its assets.
- A refund sets revoked_at on the rows that order created.
- A free gift or a press copy is a row with no order.

## 4. Flows

### Buying

1. The user signs in, or the checkout asks for their email.
2. In the app or on the site they click **Buy**.
3. We open the checkout URL of that product with the email and our user id passed in.
4. The store takes the payment.
5. The store calls `POST /api/webhook.php` with the order.
6. The webhook checks the store's signature on the request.
7. It finds or creates the user by email.
8. It writes `orders`, `order_items` and `ownership`, and the purchase is done.
9. The webhook is idempotent: `store_order_id` is unique, so a repeated call changes nothing.

### Refunds and chargebacks

- The store sends a refund webhook.
- We revoke the ownership rows from that order.

### Signing in from the app (device code, like TVs do)

1. The app asks `POST /api/device/start` and gets a short code and a link: canopy-site/link?code=K7P-3QX.
2. It opens the link in the browser; the user signs in there with the email code and confirms.
3. The app polls `POST /api/device/poll` and receives a session token.
4. The token is stored by the app:
   - PC: in the user data folder.
   - Android: in Capacitor Preferences.
   - Web: in localStorage.
5. The token is a long random string. Only its hash is kept in `sessions`, and Settings can revoke a device.

### Downloading

1. The app calls `GET /api/download.php?asset=japanese-maple` with the header `Authorization: Bearer <token>`.
2. PHP checks:
   - the session,
   - ownership,
   - that the asset is published,
   - a rate limit (for example 30 downloads a day per account).
3. It streams the file from outside public_html with `readfile`.
4. Free assets need no token.

Optional, for big files: PHP answers with a signed link that expires after 10 minutes, and a second script serves it. This keeps the download resumable.

### My library

- `GET /api/my.php` returns the slugs the account owns.
- The Library window marks them Owned and adds an **Owned** tab.

## 5. The catalog the app reads

`GET /api/catalog.json` is a static file regenerated whenever an asset or pack is published. Hostinger caches it.

```json
{
  "assets": [{ "slug": "japanese-maple", "name": "Japanese maple", "category": "Trees", "price": 6, "currency": "USD",
               "thumb": "https://…/thumbs/japanese-maple.png", "version": 3, "packs": ["autumn-pack"] }],
  "packs":  [{ "slug": "autumn-pack", "name": "Autumn pack", "price": 29, "assets": ["japanese-maple", "…"],
               "thumb": "https://…/thumbs/autumn-pack.png", "buy": "https://store…/checkout/…" }]
}
```

**Local samples and online assets together:**
- The app keeps the local `samples/index.json` for the free samples that ship with it, so they work offline.
- It merges in the online catalog when it can reach it.
- The tabs (Trees, Bushes, Flowers, Grass, Vines, Misc) come from `category`, the same field the local samples now use.

## 6. Admin (adding and selling a plant)

The admin is a small PHP page behind your own account, with `users.is_admin`. It has three steps.

1. **Upload:**
   - the .canopy file (thumbnail read from inside it),
   - name, category, price, description, preview images.
2. **Create the product** in Lemon Squeezy or Paddle and paste its variant id. A packs page picks its assets from a list.
3. **Publish:** this regenerates catalog.json.

**Other admin tools:**
- Grant or revoke an asset for any email (support, giveaways, reviewers).
- Orders and downloads lists, for support.

## 7. Website pages

| Page | What it shows |
|---|---|
| `/market` | All assets and packs, filters by category, search. |
| `/market/<slug>` | Asset or pack page: previews, what's in it, price, Buy or Download. |
| `/account` | Sign-in, owned assets with download buttons, orders and receipts (links to the store's receipts), devices. |
| `/link` | Confirms an app sign-in code. |

## 8. Security checklist

- **Files:** the .canopy files sit outside `public_html`. Never link them directly.
- **Webhooks:** check every webhook signature with the store's secret, and reject unsigned calls.
- **Secrets:** tokens, sign-in codes and webhook secrets are stored as hashes or in a config file outside public_html, never in git.
- **Database:** prepared statements (PDO) everywhere. HTTPS only (free SSL on Hostinger).
- **Rate limits:** on sign-in codes (5 an hour per email) and on downloads.
- **Personal data:**
  - We keep only email, name, orders and download log.
  - The store holds billing details.
  - Write a privacy page.
  - Offer account deletion; orders stay as records the law requires.

## 9. Why these choices

- **Merchant of record:** selling digital goods worldwide means VAT and sales-tax registration in many countries. Lemon Squeezy and Paddle take that on and are the seller on the receipt. Fees are about 5% plus 50¢, against Stripe's 2.9% plus 30¢ and doing tax yourself. Packs, coupons and refunds are built in. Gumroad is the simplest alternative but has higher fees and less control.
- **PHP + MySQL:** it is what Hostinger web hosting runs out of the box. It needs no Node server or VPS and is cheap to keep running.
- **Email codes:** there are no passwords to leak or reset, and they work the same in the PC app, on Android and on the website.
- **One ownership table:** packs, single purchases, gifts and refunds all end up as rows the download check reads, so every case is handled by the same code.

## 10. Build order

1. **Database and admin upload page; catalog.json; free downloads.** The app's Library shows the online free assets.
2. **Email sign-in and the account page; app device sign-in; Owned tab.**
3. **Store products and webhook; paid downloads; refunds.** Test everything in the store's test mode.
4. **Packs pages and pack ownership; coupons.**
5. **Updates:** a "new version" badge in the Library; update the file on download.

## 11. What we need to set up

- **Hostinger:**
  - a MySQL database,
  - PHP 8.2+,
  - a folder outside public_html for files,
  - SSL on,
  - a mail sender (Hostinger mail SMTP, or a service like Brevo for better delivery).
- **A Lemon Squeezy or Paddle account:**
  - store verification and payout details,
  - one product per asset and per pack,
  - a webhook secret.
- **Legal pages:**
  - terms of sale and the license (what buyers may do with the plants, for example use in games and renders but not resell the source files),
  - refund policy,
  - privacy.
- **In the app:**
  - catalog URL and API base URL in settings,
  - Sign in in Settings → Account,
  - Owned tab and Buy buttons in the Library.
