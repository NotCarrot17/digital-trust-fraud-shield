# Digital Trust — Real-Time Fraud Shield for the Unbanked

**Silver Shield** is a local-first safety companion for underbanked and older users in ASEAN. It helps someone check a suspicious download, listen to a phone call for an AI-cloned voice, test a password against known data breaches, inspect a link, and audit their computer — without sending their files to a cloud service.

Behind the web app sits a FastAPI service that provides those local safety tools plus a calibrated machine-learning model for real-time payment fraud scoring, QR-transfer integrity checks, voice authenticity analysis, guardian approval workflows, and Malaysian police (PDRM) scam-account lookups.

> **Status:** The web app currently exposes four pages (Home, Downloads, Calls, Safety). The transaction-scoring, QR, and guardian features are implemented in the backend but are **API-only** — they are not yet wired into the UI.

---

## Why this exists

- Digital payments are spreading quickly across the Philippines, Thailand, Malaysia, and neighbouring markets, but fraud protection is often rule-based, expensive, or designed for Western banking customers.
- A single fraudulent transfer or a single malicious APK can wipe out a gig worker's or retiree's savings and destroy trust in digital finance.
- Scam delivery has moved to channels that transaction monitoring cannot see: fake banking apps in a Downloads folder, AI-cloned voices on a phone call, phishing links in WhatsApp, and reused breached passwords.

Silver Shield focuses on those channels. It runs locally on the user's machine, explains every warning in plain language, and keeps destructive actions (quarantine, delete) constrained to the Downloads folder.

---

## Features

| Page | What it does |
| --- | --- |
| **Home** (`/`) | Shows the latest scan and safety-check results in plain language, with a one-tap route to each tool and a recent-activity feed. |
| **Downloads Guard** (`/downloads`) | Scans up to 200 files in the Downloads folder, scores each one, and explains the risks. Handles APK permission analysis, unsigned or fake apps, double extensions, executables, archives, and brand impersonation. Supports quarantine, restore, and permanent deletion. |
| **Call Guard** (`/calls`) | Uses the microphone to capture 6-second samples while a call is on speaker, sends each sample to the voice-authenticity endpoint, and warns aloud when the voice shows synthetic-speech artefacts. |
| **Safety Check** (`/checks`) | Runs a weighted device audit (Downloads, virus protection, firewall, OS updates), checks a password against the Pwned Passwords range API, checks a URL with local phishing heuristics, and offers a rule-based chat assistant for guidance. |

All four pages are designed for clear, large-text, high-contrast use, with a built-in text-size control in the navigation bar.

---

## Architecture

```
┌──────────────────────────────────────────────┐
│  Browser — Silver Shield (React 19 + Vite)   │
│  Home · Downloads · Calls · Safety Check      │
│  Fetch JSON + multipart audio, port 3000      │
└───────────────────────┬──────────────────────┘
                        │ HTTP
┌───────────────────────▼──────────────────────┐
│  FastAPI service — port 8000                  │
│                                               │
│  /agent/*        local safety tools           │
│  /predict        transaction fraud model      │
│  /predict-qr     QR transfer + integrity      │
│  /voice-authenticity  librosa DSP analysis    │
│  /guardians/*    guardian workflows           │
│  /api/pdrm/*     Semak Mule scraper           │
└───────┬───────────────┬───────────────┬──────┘
        │               │               │
   joblib model     ~/Downloads    outbound only:
   (local inference)  + quarantine  Pwned Passwords,
                                    PDRM Semak Mule,
                                    optional SMTP
```

**Production serving:** `pnpm build` bundles the React app into `dist/public` and the Express helper into `dist/index.js`. Express serves the static app; the Python API runs separately.

---

## Tech stack

**Frontend**

- React 19, TypeScript 5.6, Vite 7
- Wouter (routing), Tailwind CSS 4, shadcn/ui + Radix primitives
- Framer Motion, Recharts, Lucide icons, Sonner toasts
- `html5-qrcode`, React Leaflet (available for QR scan and map views)
- Web Audio + Web Speech APIs for spoken warnings and feedback

**Backend**

- FastAPI + Uvicorn, Pydantic v2
- scikit-learn, imbalanced-learn (SMOTE), pandas, NumPy, joblib
- librosa + soundfile for voice-signal analysis
- httpx + BeautifulSoup + lxml for breach lookup and PDRM scraping

**Tooling**

- pnpm 10, TypeScript, Prettier, Vitest (config present; no test suite yet)
- Python 3.10/3.11 (tested on 3.11.7)

---

## Repository layout

```
client/                     React application
  src/pages/                Home, DownloadsGuard, CallGuard, SecurityChecks
  src/components/           Navigation, assistant chat, error boundary, UI kit
  src/lib/agentApi.ts       Typed client for /agent/* endpoints
  src/const.ts              API base-URL resolution
  public/                   PWA manifest, service worker, offline page, icons

server/index.ts             Express static server for production builds

api_python/                 FastAPI backend
  main.py                   Transaction, QR, voice, guardian, PDRM endpoints
  shield_agent.py           /agent/* local safety tools and chat router
  pdrm_service.py           Semak Mule lookup service
  guardian_email.py         Optional SMTP guardian notifications
  fraud_model.pkl           Trained, calibrated transaction model
  model_columns.pkl         Exact training-column order for inference
  requirements.txt          Python dependencies

ml/train_model.py           PaySim training and evaluation pipeline
ml/models/plots/            Generated evaluation plots

data/                       Reference data (crime statistics workbook)
shared/                     Constants shared by client and server
```

Model artifacts are loaded from the **current working directory**, so the API must be started from `api_python/`.

---

## Getting started

### Prerequisites

- **Node.js 20.19+** (Vite 7 requirement) and **pnpm 10**
- **Python 3.11** (3.10 also supported)
- A microphone for Call Guard
- Internet access for the password breach check and PDRM lookups (the rest works offline)
- Windows for full Safety Check results; on other platforms, OS-specific checks report `unknown` instead of failing

### 1. Start the API

```bash
cd api_python
python -m venv .venv

# Windows
.venv\Scripts\activate
# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Open <http://127.0.0.1:8000/docs> for the interactive OpenAPI reference. A quick health probe:

```bash
curl http://127.0.0.1:8000/api/pdrm/health
```

Do **not** start the API with `python main.py`; the `__main__` block is not at the end of the file, so some routes are never registered. Use `uvicorn main:app`.

### 2. Start the web app

From the repository root:

```bash
pnpm install
pnpm dev
```

Open <http://localhost:3000>. The frontend calls `http://127.0.0.1:8000` by default when served from localhost. When opened from another device on the same LAN, it targets port `8000` on the same host as the page.

If the API lives elsewhere, create a `.env` file at the repository root (Vite's `envDir` is the project root):

```bash
VITE_FRAUD_API_BASE_URL=http://192.168.1.20:8000
```

### 3. Production build

```bash
pnpm build
node dist/index.js   # Express static server, default port 3000
```

The Python API still runs as a separate process. Set `PORT` to change the Express port.

### Configuration

| Variable | Loaded from | Default | Purpose |
| --- | --- | --- | --- |
| `VITE_FRAUD_API_BASE_URL` | root `.env` | `http://127.0.0.1:8000` (localhost) | Backend base URL used by the browser |
| `SHIELD_DOWNLOADS_DIR` | backend environment | `~/Downloads` | Folder scanned and quarantined by the agent |
| `SMTP_HOST` | `api_python/.env` | `smtp.gmail.com` | SMTP server for guardian emails |
| `SMTP_PORT` | `api_python/.env` | `587` | SMTP port (STARTTLS) |
| `EMAIL_USER` / `EMAIL_PASS` | `api_python/.env` | empty | SMTP credentials |
| `APP_BASE_URL` | `api_python/.env` | `http://localhost:3000` | Base URL used in emailed links |
| `GUARDIAN_EMAIL` / `SENIOR_EMAIL` | `api_python/.env` | empty | Recipients for the email smoke test |

`api_python/.env` is git-ignored. Guardian emails are optional; the API runs without SMTP configured.

---

## How it works

### Downloads Guard

1. `POST /agent/scan-downloads` enumerates at most 200 files in the Downloads folder, skipping the quarantine directory.
2. Each file is scored from 0 to 100 using rule-based heuristics:
   - APK files are opened as ZIP archives and checked for a manifest and DEX code, then scored on dangerous permissions (SMS, accessibility, install-packages, overlay, audio), suspicious permission combinations, and missing signatures.
   - Executables and scripts are scored on double extensions and trusted-brand impersonation; ZIP archives are also checked for hidden APKs. Other document types are listed but not deeply inspected.
   - Files up to 200 MB are hashed with SHA-256 for identification.
3. Verdicts: `SAFE` below 35, `SUSPICIOUS` from 35, `DANGEROUS` from 70. Every finding is returned as a plain-language sentence plus a technical detail list.
4. `POST /agent/quarantine` moves files into `.ShieldGuardQuarantine` inside Downloads, keeping an index for restoration. `POST /agent/restore` and `POST /agent/delete` operate only on paths validated to be inside the Downloads folder; deletion requires `confirmed: true`.

### Call Guard

The browser records a 6-second audio sample, pauses for 1.5 seconds, and repeats while enabled. Each sample is posted as `audio_file` (multipart) to `POST /voice-authenticity`, which:

- resamples to 16 kHz mono and normalises the peak;
- rejects samples shorter than half a second or with no audible voice;
- extracts MFCC variability, spectral artefact ratio in the 4–8 kHz band, pitch smoothness/jitter, and speech-band energy;
- returns a 0–1 synthetic-speech score with reasoning.

This is a **signal-processing heuristic**, not a trained deepfake classifier. It is an early warning, not forensic proof, and the UI says so.

### Safety Check

`POST /agent/security-audit` combines four checks and starts from a score of 100:

| Check | Penalty when failing |
| --- | --- |
| Downloads folder (dangerous/suspicious files) | −30 / −10 |
| Windows virus protection and real-time protection | −25 |
| Windows firewall profiles | −25 |
| OS version / update information | informational |

Unknown results cost 5 points. Scores of 90+ read as well protected, 70+ as mostly safe, and lower scores trigger specific recommendations. Results are persisted to `api_python/agent_state.json` and surfaced on the Home page.

### Password and link checks

- `POST /agent/check-password` computes a SHA-1 hash locally and sends only the first five characters to the Pwned Passwords range API (k-anonymity). The password is never stored or logged; the full hash never leaves the machine.
- `POST /agent/check-link` performs local heuristics only: IP-address hosts, punycode, risky TLDs, lookalike/trusted-brand domains, insecure schemes, embedded credentials, excessive subdomains, and phishing keywords. It does not query a reputation service.

### Assistant

`POST /agent/chat` is a **rule-based intent router**, not an LLM. It matches keywords to tools (scan, quarantine, audit, password, link, call) and can return a navigation action such as "Take me to Call Guard". It never executes a destructive action without the user confirming it in the UI.

### Transaction scoring

`POST /predict` feeds a PaySim-style transaction through the calibrated Random Forest:

- **Features:** transaction type, amount, balances before/after, balance-math errors, merchant destination, account-emptying flag, hour of day, day index, amount-to-balance ratio, and balance deltas.
- **Model:** Random Forest (50 trees, depth 10) wrapped in `CalibratedClassifierCV` (sigmoid, 3 folds), trained on SMOTE-balanced data.

Probability thresholds and guardrails:

| Rule | Result |
| --- | --- |
| Probability < 0.15 | `APPROVED` |
| 0.15 ≤ probability < 0.45 | `FLAGGED` — step-up OTP |
| Probability ≥ 0.45 | `BLOCKED` |
| Amount ≥ 10,000 | At least `FLAGGED` |
| Amount ≥ 50,000, or amount exceeds balance | `BLOCKED` |
| Amount ≥ 80% of balance, account emptied, or balance math anomaly | At least `FLAGGED` |
| IP risk ≥ 0.7 combined with an untrusted device, a new recipient ≥ 2,000, or a late-night new recipient ≥ 500 | `BLOCKED` |
| Any single contextual signal on an approved transaction | `FLAGGED` |

Rules only escalate risk; they never downgrade a model decision. Each response includes a human-readable reason.

`POST /predict-qr` adds QR payload integrity checks, recipient validation, and a live PDRM scam-account lookup before scoring. `POST /context` returns the mock sender/recipient/device/IP context used by the demo.

### Guardian and PDRM workflows

The backend implements a full guardian system, currently API-only:

- linking seniors and guardians with 6-digit invite codes and email invites;
- guardian verification through ID photo checks and Bluetooth signal-strength proximity (GPS coordinates are accepted in the request but do not affect the decision);
- permission tiers (view-only, co-signer, full protector) and trusted-recipient whitelists;
- notifications for high-risk transactions, pending approvals, and approval decisions;
- recovery reports and report submissions to MCMC, Google Safe Browsing, and PDRM.

`POST /api/pdrm/check-account` and `POST /validate-recipient` query the public **Semak Mule** portal for accounts reported in scams. This is a best-effort HTML scrape of a third-party government site: it can be slow, rate-limited, or unavailable, and it must not be treated as an authoritative or legally binding result.

---

## API reference

Full, always-current documentation is available at `http://127.0.0.1:8000/docs`.

### Shield Agent — `/agent`

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/agent/status` | Last scan, audit, score, and quarantine count |
| `GET` | `/agent/activity` | Recent local activity feed |
| `POST` | `/agent/scan-downloads` | Scan the Downloads folder |
| `POST` | `/agent/quarantine` | Move files to quarantine |
| `GET` | `/agent/quarantine` | List quarantined files |
| `POST` | `/agent/restore` | Restore quarantined files |
| `POST` | `/agent/delete` | Permanently delete files (requires confirmation) |
| `POST` | `/agent/security-audit` | Run the device safety audit |
| `POST` | `/agent/check-password` | Breach lookup via k-anonymity |
| `POST` | `/agent/check-link` | Local URL phishing heuristics |
| `POST` | `/agent/chat` | Rule-based assistant |

### Fraud and signals

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/predict` | Score a transaction with the ML model and rules |
| `POST` | `/context` | Build sender/recipient/device/IP context |
| `POST` | `/predict-qr` | Score a QR-initiated transfer with integrity checks |
| `POST` | `/scan-qr-threat` | Inspect a QR payload for threats |
| `POST` | `/voice-authenticity` | Score an audio sample for synthetic speech (multipart `audio_file`) |

### Trust, guardians, and reporting

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/guardians/link` | Link a guardian to a senior account |
| `GET` | `/api/guardians/{sender_account}` | List linked guardians |
| `POST` | `/guardians/generate-invite-code` | Create a 6-digit invite code |
| `POST` | `/api/guardians/send-email-invite` | Email a guardian invitation |
| `POST` | `/api/guardians/verify-code` | Verify a guardian invite code |
| `POST` | `/guardians/check-proximity` | Validate GPS/Bluetooth proximity |
| `PUT` | `/guardians/{sender}/{guardian}/permission-tier` | Set guardian permissions |
| `GET`/`POST` | `/guardian-pending-approvals/...` | List, inspect, and decide approvals |
| `POST` | `/api/recovery-report/generate` | Generate a recovery report |
| `POST` | `/api/v1/onboarding/score` | Onboarding risk questionnaire score |
| `POST` | `/api/v1/reports/mcmc` | Submit an MCMC report |
| `POST` | `/api/v1/reports/google-safe-browsing` | Submit a Safe Browsing report |

### PDRM and recipient validation

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/pdrm/check-account` | Check an account against Semak Mule |
| `GET` | `/api/pdrm/health` | PDRM service health probe |
| `POST` | `/validate-recipient` | Validate recipient name and account number |

---

## Model training

The training pipeline is in [`ml/train_model.py`](ml/train_model.py). It expects a filtered PaySim dataset at `data/filtered_paysim.csv` (CSV files under `data/` are git-ignored and not shipped):

1. Engineer behavioural features: balance errors, merchant destination, empty-account flag, hour, day index, amount-to-balance ratio, balance deltas.
2. Split by time (last 20% of days as holdout) with a stratified fallback.
3. Apply SMOTE to a 10% fraud ratio.
4. Train a Random Forest and calibrate probabilities with sigmoid.
5. Print classification metrics, threshold sweeps, ROC-AUC, PR-AUC, Brier score, and log loss.
6. Save evaluation plots to `ml/models/plots/` and write `fraud_model.pkl` and `model_columns.pkl`.

Run it from the repository root:

```bash
python ml/train_model.py
```

The script writes the artifacts to the current directory. Copy them into `api_python/` before starting the API:

```bash
cp fraud_model.pkl model_columns.pkl api_python/
```

The checked-in artifacts match the feature contract in the training script. Regenerate them whenever features or column order change, and treat the script's console output as the source of truth for performance numbers rather than fixed figures in this document.

---

## Privacy and security notes

**What stays local**

- Files, names, hashes, findings, and quarantine contents stay on the machine.
- The transaction model runs locally through joblib; no inference data is sent to a third party.
- The assistant is deterministic and makes no outbound LLM calls.

**What leaves the machine**

- The first five characters of a SHA-1 password hash, to the Pwned Passwords range API.
- Account numbers and recipient names, to the public PDRM Semak Mule portal.
- Guardian emails, only if SMTP credentials are configured.

**Operational cautions**

- CORS is currently `allow_origins=["*"]` and there is **no authentication or rate limiting**. Treat this build as a local demo. Before exposing it beyond localhost, add authentication, restrict CORS, enforce TLS, and add rate limits.
- Quarantine and delete endpoints are destructive. They validate that target paths resolve inside the configured Downloads directory, and deletion requires an explicit `confirmed: true` flag, but they should still be restricted to trusted users.
- PDRM lookups scrape a third-party government portal. Respect its terms of use, avoid high request volumes, and present results as advisory.
- The voice check is a heuristic and can be fooled by codecs, background noise, or speakers. It should support, not replace, human judgement.

---

## Known limitations

- The UI covers four pages; transaction simulation, QR scanning, guardian management, and recovery reports are backend-only.
- Safety Check's deepest signals (Defender, firewall, update details) rely on PowerShell and are Windows-specific.
- Agent state is stored in memory and `api_python/agent_state.json`; there is no database, user accounts, or multi-tenant isolation.
- PDRM scraping is brittle by nature and depends on the portal's current HTML and availability.
- The assistant and file scoring are rule-based; the only trained model is the transaction classifier.
- There is no automated test suite yet (`vitest` is present in dev dependencies).
- The `pnpm start` script calls `cross-env`, which is not declared in `package.json`. Use `node dist/index.js`, or install `cross-env` first.

---

## Roadmap

- Wire the transaction simulator, QR flow, and guardian console into the web app.
- Add authentication, role-based access, and rate limiting for shared deployments.
- Add unit and integration tests for scanning, scoring, and API contracts.
- Persist agents, guardians, and audit history in a proper database.
- Add SHAP-based explanations to the transaction model and a user-facing "why was this blocked?" view.
- Expand scam heuristics and localisation (Bahasa Melayu, Thai, Tagalog, Vietnamese).
- Package a mobile client and an offline mode for low-connectivity regions.

---

## Contributing

1. Create a feature branch.
2. Keep TypeScript type-safe (`pnpm check`) and formatted (`pnpm format`).
3. Test the affected flow manually with both servers running.
4. Open a pull request describing the change and the user-facing impact.

---

## Acknowledgements

- [PaySim](https://www.kaggle.com/datasets/ealaxi/paysim1) synthetic financial dataset for the fraud model.
- [Pwned Passwords](https://haveibeenpwned.com/Passwords) range API for k-anonymous breach checks.
- [Semak Mule](https://semakmule.rmp.gov.my/), Royal Malaysia Police, for public scam-account records.
- [shadcn/ui](https://ui.shadcn.com) and Radix UI for accessible interface primitives.

---

## License

MIT, as declared in [`package.json`](package.json).
