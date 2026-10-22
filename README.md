# SAO Portal - Student Activities Office

Web app for the GUC Student Activities Office: club bank accounts, paperwork with e-signatures,
and the announcement banner. Everyone signs in with an email and a password; the server decides
what each person may see and do.

## Run it

Needs **Node.js 22.13 or newer** (it uses Node's built-in SQLite).

```
npm install
node server.js
```

Open http://localhost:5173. The first time, the app asks you to create the **SAO Office account**
(name, email, password). You can also tick "Fill with demo data" to try it with 16 sample clubs; demo accounts
are `<id>@demo.local` with the password `Demo1234` and are listed on the sign-in page.

Everything is stored in the `data/` folder (`data/sao.db` + `data/uploads/`). To start again from zero,
stop the server and delete `data/`.

## Who can do what

| Account | Can see and do |
|---|---|
| SAO Office (main account) | Everything: every club's bank account, all paperwork and its status, announcements, approvals, final signed forms, clubs, advisors and accounts. Signs as Youth Welfare Director (Mr. Yehia Al-Razaz) |
| Vice President (Dr. Ehab Abo El-Kheir) | Only the papers waiting for his signature |
| Academic Advisors (one per club) | Only the papers from their club waiting for their signature |
| GUC Clinic | Only Food & Beverages Sponsorship Agreements waiting for its signature (it signs first) |
| Club Representatives (students) | Their own club's bank account, submitting requests and announcements, and a status window on Home showing where each request is |

These rules are enforced by the server, not just hidden in the page: a person's browser only ever
receives the data they are allowed to see, and every change is checked again on the server.

## Accounts

The SAO Office manages sign-ins on the **Accounts** page:

- Give each person (advisor, rep, VP, Clinic) an email and a starting password. Passwords need at least
  8 characters with letters and numbers.
- Disable an account to block sign-in at once (for example when a rep graduates).
- Everyone can change their own password with the **Password** button at the top.
- After 8 wrong passwords, sign-in for that email is locked for 15 minutes.

## Features

- **Look**: the SAO brand kit (`assets/brand/`): the SAO mark (three fanned papers with a check) and wordmark in the
  header, GUC black / red / yellow on a warm "Paper" background, Source Sans 3 and IBM Plex Sans Arabic fonts, and status
  chips that use a shape, colour and word. Yellow is kept for the one main action on a screen (Sign in, Submit, Approve & sign).
  The GUC university logo sits separately in the page footer, as the brand guide asks; official PDFs still carry the GUC logo.
  The opening animation plays once on a person's first visit (click to skip). Browser tab icon, phone home-screen icon and
  `manifest.webmanifest` use the SAO app icon.
- **Club logos**: each rep uploads their logo on **Club Profile**; the SAO Office manages all of them on **Clubs**.
- **Finance** (private per club): balance, Add money / Withdraw, 14% tax taken from every deposit,
  sponsors, cash in this year, taxes paid, money out, charts and transaction history. Withdrawals cannot exceed the balance.
- **Paperwork** - only the SAO's own forms (the Word files in `templates/`, fields defined in `forms.js`):
  - Events: General, Entertainment, Educational, Sports, Opening/Closing, Recruitment, Marketing Booth
  - Sponsorship: Sponsorship Agreement, Food & Beverages Sponsorship Agreement (Clinic signs first)
  - Finance: Expense Approval with a **memo** ("Draft with AI" helps), printed on `templates/memo.docx`.
    When the Vice President approves, the amount is taken from the club account automatically.
  - Chain: Club Rep -> (Clinic) -> Academic Advisor -> SAO Office Head -> Vice President -> signed form back to SAO Office.
    Any signer can reject with a comment; the club can resubmit.
  - Late-submission rules (10 working days, 4 lates then a 2-month block) and required attachments are checked on the server.
- **Downloads** are the original Word forms, filled in. Final approvals are PDFs (memo + form for expenses).
- **Attachments** are stored on the server in `data/uploads` (PDF, Word, Excel or images, max 10 MB) and
  can only be opened by people allowed to see that request.
- **E-signatures**: drawn once per signer, stamped on every approval.
- **Announcement banner**: reps send announcements with an optional photo; the SAO Office approves them.
  The photo fills the slide with the GUC logo faint in the bottom-right corner.
- **Clubs** (SAO Office): add, edit or remove clubs and advisors (one advisor per club). Removing a club
  moves its money to the SAO Office account and disables its rep.
- **Reports**: bank statement (any period, PDF or Excel) and year report for any account or all clubs.

## Putting it online (hosting guide)

1. **Server**: any machine that can run Node.js 22.13+ (a university server, a Windows PC that stays on,
   or a small Linux VPS). Copy the project folder there (without `data/` and `node_modules/`) and run `npm install`.
2. **Finish setup straight away**: until the SAO Office account exists, *anyone* who opens the site can create it.
   Open the site and create the account right after starting the server for the first time.
3. **HTTPS**: put the app behind a web server with a certificate (IIS, nginx, Caddy, or your hosting
   provider's HTTPS) so passwords and sign-in tokens only travel encrypted.
4. **Keep it running**: run it as a service so it restarts after a reboot, for example with
   [pm2](https://pm2.keymetrics.io/) (`pm2 start server.js --name sao` then `pm2 save`) or a Windows service.
5. **Backups**: copy the whole `data/` folder every day (stop the server first, or copy `sao.db` with
   `sqlite3 sao.db ".backup backup.db"`). That folder is the entire system: accounts, money, paperwork and files.
6. **AI memo drafting** (optional): set `ANTHROPIC_API_KEY` to a Claude API key. Without it,
   "Draft with AI" inserts a simple ready-made draft instead.

### Quick setup on an Ubuntu 24.04 cloud server

`deploy/setup.sh` does all of the above in one go: Node.js 22, LibreOffice and fonts, HTTPS with Caddy, a firewall,
the app as a service that restarts by itself, and a daily backup to `/var/backups/sao-portal` (kept 14 days).
Copy the project to `/opt/sao-portal` on the server, then run as root:

```
bash /opt/sao-portal/deploy/setup.sh                # free address: <server-ip>.sslip.io
bash /opt/sao-portal/deploy/setup.sh sao.example.com  # or your own domain (point its DNS to the server first)
```

Data lives in `/var/lib/sao-portal`; settings such as `ANTHROPIC_API_KEY` go in `/etc/sao-portal.env`.
To install a new version later: copy the new code over `/opt/sao-portal` and run `bash /opt/sao-portal/deploy/update.sh`.

### Free hosting: GitHub Pages + Supabase (no card)

- **Pages** (index.html, app.js, ...) are published on GitHub Pages by `.github/workflows/deploy-pages.yml`.
- **The server** is the Supabase Edge Function `sao` (`supabase/functions/sao/index.ts`), deployed by
  `.github/workflows/deploy-supabase.yml`. It runs the same code as `node server.js` (`supabase/functions/_shared/core`),
  with Supabase's Postgres database (tables locked with row level security, so only the function can use them)
  and a private Storage bucket (`sao-data`) for attached files.
- `config.js` tells the pages where the server is (the Supabase function when the site runs on github.io).
- Sign-in uses a token sent with each request (`Authorization: Bearer ...`), not a cookie.
- Final approvals download as the filled Word form with all signatures; save it as PDF in Word.

One-time setup:
1. GitHub: make the repository public; Settings > Pages > Source: **GitHub Actions**.
2. Supabase: create a personal access token (Account > Access Tokens) and add it to GitHub as the Actions secret
   `SUPABASE_ACCESS_TOKEN`; then run the "Deploy server (Supabase)" workflow.
3. Move the data once: double-click `deploy/move-data-to-supabase.cmd` and paste the project's secret key.
   The function imports it the first time it sees an empty database (on Supabase the "create the SAO account"
   screen is off, so nobody can take over an empty portal; set the function secret `SAO_ALLOW_SETUP=1` only to
   start a brand-new portal).
4. Optional: add `ANTHROPIC_API_KEY` as a function secret (Supabase > Edge Functions > Secrets) for AI memo drafting.

`.github/workflows/keep-awake.yml` calls the server daily so the free Supabase project never pauses.

### Settings (environment variables)

| Variable | What it does | Default |
|---|---|---|
| `PORT` | Port the site runs on | `5173` |
| `SAO_DATA_DIR` | Folder for the database and uploaded files | `data/` in the project |
| `SAO_SECURE_COOKIES` | Set to `1` when the site runs on HTTPS | off |
| `ANTHROPIC_API_KEY` | Claude API key for "Draft with AI" | none |

Windows example:

```
set PORT=8080
set SAO_SECURE_COOKIES=1
set ANTHROPIC_API_KEY=your-key
node server.js
```

Other settings: `TAX_RATE` (0.14) and `CURRENCY` ('EGP') at the top of `app.js` and in `server/actions.js`.
To update a form, replace its file in `templates/` (keep the same box labels so the filler can find them).

## Security check

With the app running on demo data, this script signs in as different people and confirms each one only
sees and changes what they should:

```
node scripts/security-check.js http://localhost:5173
```

Set `SAO_EMAIL` and `SAO_PASSWORD` to the SAO Office account you created (for example `set SAO_EMAIL=...` on Windows) before running it.

## Project layout

| Path | What it is |
|---|---|
| `server.js` | Web server and API routes |
| `supabase/functions/_shared/core/` | The server code (data, sign-in, permissions, every action, setup, uploads, AI memo) - used by both `server.js` and Supabase |
| `supabase/functions/sao/` | The Supabase Edge Function that runs that code on Supabase |
| `config.js` | Where the pages find the server |
| `index.html`, `app.js`, `styles.css` | The app in the browser |
| `forms.js` | Form definitions and rules, shared by the browser and the server |
| `docfill.js` | Fills the Word templates |
| `templates/`, `assets/` | Word forms, memo template, GUC logos |
| `data/` | Database and uploads (created on first run; never commit or share it) |

## Still to add later

- Email notifications when a request is waiting for someone's signature.
- Sign-in with university (Microsoft) accounts instead of separate passwords.
