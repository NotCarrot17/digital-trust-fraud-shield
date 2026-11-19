Digital Trust — Real-Time Fraud Shield for the Unbanked

Silver Shield is a local-first safety companion for underbanked and older users in ASEAN. It helps someone check a suspicious download, listen to a phone call for an AI-cloned voice, test a password against known data breaches, inspect a link, and audit their computer — without sending their files to a cloud service.

Behind the web app sits a FastAPI service that provides those local safety tools plus a calibrated machine-learning model for real-time payment fraud scoring, QR-transfer integrity checks, voice authenticity analysis, guardian approval workflows, and Malaysian police (PDRM) scam-account lookups.

Status: The web app currently exposes four pages (Home, Downloads, Calls, Safety). The transaction-scoring, QR, and guardian features are implemented in the backend but are API-only — they are not yet wired into the UI.



Why this exists

•Digital payments are spreading quickly across the Philippines, Thailand, Malaysia, and neighbouring markets, but fraud protection is often rule-based, expensive, or designed for Western banking customers.
•A single fraudulent transfer or a single malicious APK can wipe out a gig worker's or retiree's savings and destroy trust in digital finance.
•Scam delivery has moved to channels that transaction monitoring cannot see: fake banking apps in a Downloads folder, AI-cloned voices on a phone call, phishing links in WhatsApp, and reused breached passwords.

Silver Shield focuses on those channels. It runs locally on the user's machine, explains every warning in plain language, and keeps destructive actions (quarantine, delete) constrained to the Downloads folder.



Features

Page	What it does
Home (/)	Shows the latest scan and safety-check results in plain language, with a one-tap route to each tool and a recent-activity feed.
Downloads Guard (/downloads)	Scans up to 200 files in the Downloads folder, scores each one, and explains the risks. Handles APK permission analysis, unsigned or fake apps, double extensions, executables, archives, and brand impersonation. Supports quarantine, restore, and permanent deletion.
Call Guard (/calls)	Uses the microphone to capture 6-second samples while a call is on speaker, sends each sample to the voice-authenticity endpoint, and warns aloud when the voice shows synthetic-speech artefacts.
Safety Check (/checks)	Runs a weighted device audit (Downloads, virus protection, firewall, OS updates), checks a password against the Pwned Passwords range API, checks a URL with local phishing heuristics, and offers a rule-based chat assistant for guidance.
