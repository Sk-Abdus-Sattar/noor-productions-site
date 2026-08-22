# Reviews backend setup (Firestore + EmailJS, no Blaze plan)

This uses Firebase's **Spark (free) plan only** — no Cloud Functions,
so no billing account required. All the enforcement that Cloud
Functions would normally do is instead done by `firestore.rules`.

## 1. Firebase project

1. In the Firebase console, enable two Auth providers:
   - **Email/Password** — this is you, the admin, logging into `admin.html`.
   - **Google** — this is how clients sign in to leave a review.
2. Create your one admin user under Authentication (email + password),
   using the exact email already hardcoded as `ADMIN_EMAIL` in `admin.html`
   and as the admin address in `firestore.rules` (`noorproductions.as@gmail.com`
   by default — change all three places together if you use a different address).
3. Create a Firestore database (production mode).
4. Deploy `firestore.rules` (Firestore → Rules → paste the file's contents).
5. Copy your Firebase config object (Project settings → your web app) into
   the `firebaseConfig` constant in **both**:
   - `admin.html`
   - `js/reviews.js`
   These two must match exactly.
6. Under Authentication → Settings → **Authorized domains**, add the site's
   live domain (and any staging domain) once you know it. Google sign-in
   silently fails on domains that aren't listed here — this is an easy
   thing to forget until clients start reporting sign-in doesn't work.
7. Double-check you're editing the Google Cloud / Firebase project you
   actually mean to — it's easy to have two same-named projects (e.g. a
   leftover test project) and paste config from the wrong one. Confirm the
   `projectId` in `firebaseConfig` matches the project you deployed the
   rules to.

## 2. EmailJS (sends the actual emails — no server needed)

Create a free account at emailjs.com, then:

1. Add an **Email Service** (e.g. connect your Gmail) → note the **Service ID**
   (this build reuses the existing service named `Dream Boutique`, already
   hardcoded as `EMAILJS_SERVICE_ID` in `admin.html`, `js/reviews.js`, and
   `js/contact.js` — no change needed unless you create a different service).

2. Create **one** template — EmailJS's free plan caps you at 2 templates
   account-wide, and the other slot is already used by Delhi Boutique's
   live order-confirmation template, so everything on this site (client
   notifications, admin notifications, *and* the contact form) shares a
   single template:

   **`template_to_client`** — set the "To Email" field to `{{to_email}}`
   (a variable, not hardcoded — this is what makes it reusable for every
   direction). Body can use `{{to_name}}`, `{{subject}}`, `{{message}}`,
   e.g.:
   ```
   Hi {{to_name}},

   {{message}}

   — NOOR Productions
   ```
   Every use case (verified-client notice, admin reply, new review,
   edited review, contact form) sends through this one template — the
   code just fills in different `to_email`/`subject`/`message` values
   each time. When it's headed to you, `to_email` is set in code to
   `noorproductions.as@gmail.com`, not hardcoded in the template itself.

3. Get your **Public Key** from Account → API Keys.
4. Fill in `EMAILJS_PUBLIC_KEY` in **all three** of `admin.html`,
   `js/reviews.js`, and `js/contact.js`.

   If you ever upgrade off the free plan and want dedicated templates
   again, splitting this back into `template_to_admin` / 
   `template_contact_form` is a small, mechanical change — the shared
   `{{to_email}}/{{to_name}}/{{subject}}/{{message}}` shape still works
   fine as separate templates too.

## 3. What triggers what

| Action | Who does it | Emails sent |
|---|---|---|
| Admin verifies a client | `admin.html` | To client ("you're verified") + to admin ("client added") |
| Admin removes a client | `admin.html` | none |
| Client submits their first review | `js/reviews.js` | To admin ("new review") — also flips their `verifiedClients` status `active` → `used` in the same atomic write |
| Client edits their review (one edit allowed) | `js/reviews.js` | To admin ("review edited") |
| Admin replies to a review | `admin.html` | To client ("we replied") |
| Someone submits either contact form | `js/contact.js` | To admin ("new contact form submission") |

All of the above route through the single `template_to_client` template
described above — only the `to_email`/`subject`/`message` values differ
per case.

## 4. Data model

- `verifiedClients/{emailLowercased}` — `email`, `clientName`, `status`
  ("active" / "used" / "removed"), `verifiedAt`, `usedAt`. Status moves
  active → used automatically the moment the client submits their first
  review (see `js/reviews.js`'s `writeBatch`), and admin → removed at any
  point via the Remove button.
- `reviews/{emailLowercased}` — doc ID is the client's email, so each
  client can only ever have one review doc. Fields: `clientEmail`,
  `clientName`, `quote`, `rating` (integer 1–5), `createdAt`, `editedAt`,
  `editCount` (0 or 1), `adminReply`, `adminReplyAt`.

## 5. Notes / limits

- Without Cloud Functions, `firestore.rules` is the entire security
  boundary — it's what stops a client from verifying themself, replying
  to their own review, submitting a second review, writing an empty or
  oversized quote, an out-of-range rating, or extra/unexpected fields.
  Test it in the Firebase console's Rules Playground before going live.
- EmailJS's free tier has a monthly send cap — fine for a small client
  list, worth checking if volume grows.
- `error.html` already has the redirect codes wired in (`?code=01` not
  verified, `02` not signed in, `03` edit limit reached, `04` a Firestore
  read/write failed, `05` session expired) — no changes needed there
  beyond what's already in this build.

## 6. Open question

The write/edit review modal currently has one combined "Your name /
business name" field rather than two separate fields. Left as-is for now
— flag if you'd rather split it into two.
