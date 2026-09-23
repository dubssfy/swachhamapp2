# Swachham — Google Play release notes

Working document for the Play Store submission. Everything here was checked
against the code in this repository; anything that could not be verified from
the code is marked **CONFIRM** and is yours to answer.

---

## 1. Data Safety declaration

Derived from the manifest, the app source, the backend routes and the database
schema. Every row names the evidence.

### Collected and sent off the device

| Data | Where from | Purpose | Required? | Shared with | On deletion |
|---|---|---|---|---|---|
| Name | `users.name`, registration | Account, order handling | Required | — | Erased |
| Email address | `users.email` | Account, invoices/receipts by email | Optional (nullable) | Email provider (`nodemailer`) | Erased |
| Mobile number | `users.mobile_number` | Account identity, OTP sign-in, delivery contact | Required | Meta (WhatsApp OTP), SMS provider | Replaced with a non-identifying tombstone |
| Password | `users.password_hash` (bcrypt) | Sign-in for staff/business roles | Required for those roles | — | Erased |
| Profile photo | `users.profile_image` | Profile display | Optional | — | Erased |
| Postal address + coordinates | `customer_addresses` incl. `latitude`/`longitude` | Pickup and delivery | Required to order | — | Deleted |
| Approximate/precise location | `expo-location`, `POST /api/location/check-service-area` | Check the address is inside a service area | Optional — the app works without it | — | Not stored as a separate record |
| Photos / camera | `expo-camera`, `expo-image-picker` (barcode scan, defect capture) | Sorting and delivery verification | Required for staff roles | — | Defect photos attach to orders (retained) |
| Order history | `orders` and related | Fulfilment, billing, tax records | Required | — | **Retained** — see §2 |
| Push token | `push_tokens.token` | Order status notifications | Optional | Google (Firebase Cloud Messaging) | Deleted |
| Device identifier (hashed) | `otp_verifications.device_id_hash` (SHA-256) | Binds an OTP to the device that asked for it | Required | — | Row detaches on delete (`ON DELETE SET NULL`) |

### Not collected

- **No payment data.** There is no payment SDK in `mobile/package.json` and no
  gateway code in the backend. **CONFIRM** payment is genuinely handled
  off-app (cash / external transfer) before declaring this.
- **No microphone audio.** `expo-audio` is used only via `createAudioPlayer` /
  `setAudioModeAsync`; `RECORD_AUDIO` has been removed from the manifest.
- **No background location.** No `ACCESS_BACKGROUND_LOCATION`, no
  `startLocationUpdatesAsync`. Foreground only, and only when checking a
  service area.
- **No contacts, calendar, SMS reading, or health data.**

### Third-party processors — **CONFIRM each**

| Processor | What it receives | Evidence |
|---|---|---|
| Google (Firebase Cloud Messaging) | Push token, notification payloads | `firebase-messaging:25.0.1`, `google-services.json` |
| Meta (WhatsApp Business API) | Mobile number + OTP template values | `whatsapp.service.ts` → `graph.facebook.com` |
| SMS provider | Mobile number + OTP text | `sms.service.ts` → `api.smsprovider.com` — **CONFIRM the real provider**; the URL in the code looks like a placeholder |
| Email provider | Email address, invoice/receipt contents | `nodemailer` |
| Railway | Hosts the API and database — all of the above | `backend/railway.json` |

### Security answers

- **In transit:** yes. Release builds refuse a non-HTTPS public API host
  (`mobile/src/constants/api.ts`).
- **Deletion available:** yes — in-app and web, see §2.
- **Passwords:** bcrypt hashed, never stored or logged in clear.

---

## 2. Account deletion

Two routes, both ending in the same backend code.

- **In app:** Profile → *Delete account*. Authorised by the access token, so it
  can only ever delete the caller's own account.
- **On the web:** the deletion page, which works with the app uninstalled.
  It takes the registered mobile number, sends a 6-digit code under its own
  `ACCOUNT_DELETION` purpose, and deletes **only** after the code is entered.
  A form submission alone deletes nothing.

### What happens

| Case | Behaviour |
|---|---|
| Account with **no** orders | Row deleted outright; every child row cascades away. |
| Account **with** orders | Personal fields erased (name, email, mobile, password, photo), account deactivated, and addresses, cart, profile, notifications, reviews, push tokens and refresh tokens deleted explicitly. Order rows stay. |

Order rows stay because `orders.user_id` is `ON DELETE RESTRICT` — the database
refuses to remove a customer who has ordered, deliberately, because those rows
carry the billing and GST record.

**CONFIRM the retention period.** The policy commits to keeping such records
"only for the period required" and deliberately names no number. If a definite
period is wanted it must come from whoever owns the tax position, and belongs
in the source legal document, not in code.

---

## 3. Play Console → App access

**This is the highest remaining rejection risk, and it needs a decision.**

Every role signs in with an OTP sent to an Indian mobile number by WhatsApp or
SMS. `PASSWORD_ROLES` covers `ADMIN, SUPER_ADMIN, MANAGER, SORTER, RIDER,
BUSINESS`, but even those ask for the OTP *first* and the password second.
`CUSTOMER` is OTP-only.

A Google Play reviewer cannot receive that message. As the app stands they
cannot sign in at all, and "we could not access the app" is a rejection.

There is no test-account mechanism in the code today — this was checked.

### Options

1. **Scoped reviewer account (recommended).** One dedicated mobile number whose
   OTP is a fixed value read from a server environment variable, never
   committed. The account holds only synthetic data. Everything else —
   rate limiting, attempt caps, expiry — still applies, and the exemption can
   be removed after review.
   *It is still a scoped exemption to production auth, so it needs your
   explicit approval before I implement it.*

2. **Reviewer-accessible delivery.** Route that one account's OTP to a mailbox
   the reviewer is given, instead of WhatsApp. No fixed code, but more moving
   parts and the reviewer must check a second inbox.

3. **Video walkthrough only.** Allowed as a supplement, not a substitute.
   Reviewers can still reject if they cannot reach the functionality.

### Draft App access text — usable once option 1 or 2 exists

```
All accounts sign in with a one-time code sent to a mobile number.
A reviewer account is provided below that does not require receiving that code.

Username / mobile: <reviewer number>
One-time code:     <fixed code>

Steps:
1. Open the app and allow the location and camera permissions when asked.
2. Enter the mobile number above on the sign-in screen.
3. Enter the one-time code above.
4. The app opens on the customer home screen. Browse services, add an item to
   the cart and open checkout to see the core booking flow.
5. Account deletion is at Profile > Delete account.

This account contains test data only. No real customer data is reachable from it.
```

---

## 4. Permissions

Reduced from nine to five; each remaining one is used.

| Permission | Used by |
|---|---|
| `INTERNET` | API |
| `ACCESS_FINE_LOCATION` / `ACCESS_COARSE_LOCATION` | Service-area check (foreground only, disclosed before the prompt) |
| `CAMERA` | Barcode scanning, defect capture |
| `VIBRATE` | Notifications |

Removed: `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE` (declared by
`expo-image-picker` already, capped at `maxSdkVersion=32`), `RECORD_AUDIO`
(playback only), `SYSTEM_ALERT_WINDOW` (dev overlay; still in the debug
manifest).

---

## 5. Hosting

Generate the public pages from the app's own legal content so the two cannot
drift:

```bash
node web/build-legal-pages.js
```

Produces `web/privacy-policy/index.html` and `web/terms/index.html`, alongside
the hand-written `web/delete-account/index.html`.

Host `web/` at a public HTTPS URL (GitHub Pages serves it directly). Then:

| Play Console field | URL |
|---|---|
| Privacy policy | `https://<host>/privacy-policy/` |
| Account deletion | `https://<host>/delete-account/` |

**CORS:** the deletion page calls the API cross-origin. `server.ts` uses
`cors({ origin: config.CLIENT_URL || '*' })`. If `CLIENT_URL` is set on
Railway, add the hosting origin to it, or the page will fail in the browser
with no visible error. **CONFIRM the current value.**

**Re-run the generator after any change to `legalContent.ts`,** or the hosted
policy silently stops matching the one in the app — precisely the mismatch a
Data Safety review looks for.
