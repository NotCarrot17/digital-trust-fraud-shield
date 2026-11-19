"""Shield agent: local, explainable tools for the elder-focused web app.

Tools: Downloads folder scanning (APK/manifest heuristics), quarantine and
cleanup, device security audit, breached-password and link checks, plus a
rule-based chat assistant that orchestrates the tools.
"""

from __future__ import annotations

import hashlib
import ipaddress
import json
import os
import platform
import re
import shutil
import subprocess
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from uuid import uuid4

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/agent", tags=["shield-agent"])


def _load_env_file() -> None:
    """Load api_python/.env (gitignored) so the Qwen key never lives in code."""
    env_path = Path(__file__).with_name(".env")
    if not env_path.exists():
        return
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_env_file()

QWEN_API_KEY = os.environ.get("QWEN_API_KEY", "").strip()
QWEN_BASE_URL = (os.environ.get("QWEN_BASE_URL") or "https://dashscope.aliyuncs.com/compatible-mode/v1").rstrip("/")
QWEN_MODEL = os.environ.get("QWEN_MODEL", "qwen-plus").strip()

DOWNLOADS_DIR = Path(os.environ.get("SHIELD_DOWNLOADS_DIR") or (Path.home() / "Downloads")).resolve()
QUARANTINE_DIR_NAME = ".ShieldGuardQuarantine"
QUARANTINE_DIR = DOWNLOADS_DIR / QUARANTINE_DIR_NAME
QUARANTINE_INDEX = QUARANTINE_DIR / "index.json"
STATE_FILE = Path(__file__).parent / "agent_state.json"

MAX_FILES = 200
MAX_HASH_BYTES = 200 * 1024 * 1024

APK_EXTENSIONS = {".apk"}
EXECUTABLE_EXTENSIONS = {".exe", ".msi", ".scr", ".bat", ".cmd", ".vbs", ".ps1", ".jar", ".hta", ".lnk", ".reg"}
ARCHIVE_EXTENSIONS = {".zip", ".rar", ".7z"}
DOCUMENT_EXTENSIONS = {".pdf", ".doc", ".docx", ".xls", ".xlsx", ".jpg", ".jpeg", ".png", ".txt"}

TRUSTED_BRANDS = [
    "maybank", "cimb", "public bank", "rhb", "hong leong", "bank islam", "bsn",
    "touch n go", "tng", "grab", "boost", "shopee", "lazada", "whatsapp",
    "telegram", "lhdn", "pdrm", "jpj", "pos malaysia", "myeg", "kwsp", "epf",
    "perkeso", "socso", "singpass", "dbs", "ocbc", "posb",
]

PERMISSION_IMPACTS = [
    ("SEND_SMS", "send text messages from your phone", 18),
    ("READ_SMS", "read your text messages (bank codes arrive there)", 22),
    ("RECEIVE_SMS", "read your text messages (bank codes arrive there)", 22),
    ("BIND_ACCESSIBILITY_SERVICE", "watch and control everything on your screen", 30),
    ("REQUEST_INSTALL_PACKAGES", "install other apps without asking", 20),
    ("SYSTEM_ALERT_WINDOW", "show pop-ups on top of other apps", 16),
    ("READ_CALL_LOG", "read your call history", 10),
    ("CALL_PHONE", "make phone calls for you", 8),
    ("READ_CONTACTS", "read your contacts", 10),
    ("RECORD_AUDIO", "listen through the microphone", 14),
    ("READ_EXTERNAL_STORAGE", "see the files on your phone", 8),
    ("MANAGE_EXTERNAL_STORAGE", "see and change all your files", 14),
    ("QUERY_ALL_PACKAGES", "see which apps you have installed", 8),
]

OFFICIAL_DOMAINS = {
    "maybank2u.com.my", "cimbclicks.com.my", "pbebank.com", "rhbgroup.com",
    "hlb.com.my", "bankislam.com", "bsn.com.my", "tngdigital.com.my",
    "touchngo.com.my", "grab.com", "shopee.com.my", "lazada.com.my",
    "lhdn.gov.my", "pdrm.gov.my", "jpj.gov.my", "pos.com.my", "kwsp.gov.my",
    "perkeso.gov.my", "google.com", "microsoft.com", "apple.com", "whatsapp.com",
}

RISKY_TLDS = {".xyz", ".top", ".click", ".lol", ".mom", ".icu", ".buzz", ".rest", ".cam", ".sbs", ".cyou"}
PHISHING_WORDS = [
    "verify", "verify-account", "login", "signin", "secure", "claim", "prize",
    "reward", "refund", "suspend", "blocked", "urgent", "lhdn", "pdrm", "pos",
    "parcel", "delivery", "freegift", "bonus", "update-bank",
]

_last_scan: dict[str, Any] | None = None
_last_audit: dict[str, Any] | None = None
_activity: list[dict[str, Any]] = []


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _log(kind: str, message: str, tone: str = "info") -> None:
    _activity.insert(0, {"id": str(uuid4()), "time": _now(), "kind": kind, "message": message, "tone": tone})
    del _activity[40:]


def _invalidate_scan() -> None:
    global _last_scan
    _last_scan = None


def _load_state() -> dict[str, Any]:
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save_state(patch: dict[str, Any]) -> None:
    state = _load_state()
    state.update(patch)
    try:
        STATE_FILE.write_text(json.dumps(state, indent=2), encoding="utf-8")
    except Exception:
        pass


def _ensure_downloads() -> None:
    if not DOWNLOADS_DIR.exists():
        raise HTTPException(status_code=409, detail=f"The Downloads folder was not found at {DOWNLOADS_DIR}.")


def _inside_downloads(path: Path) -> bool:
    try:
        path.resolve().relative_to(DOWNLOADS_DIR)
        return True
    except ValueError:
        return False


def _sha256(path: Path) -> str | None:
    try:
        if path.stat().st_size > MAX_HASH_BYTES:
            return None
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()
    except OSError:
        return None


def _double_extension(name: str) -> bool:
    return bool(re.search(r"\.(pdf|jpe?g|png|docx?|xlsx?|txt|zip)\.(apk|exe|msi|scr|bat|cmd|vbs|ps1)$", name.lower()))


def _brand_hits(name: str) -> list[str]:
    lowered = name.lower()
    return [brand for brand in TRUSTED_BRANDS if brand in lowered]


def _apk_permissions(manifest_bytes: bytes) -> set[str]:
    found: set[str] = set()
    for encoding in ("utf-16-le", "utf-8"):
        try:
            text = manifest_bytes.decode(encoding, errors="ignore")
        except Exception:
            continue
        found.update(re.findall(r"android\.permission\.[A-Z_]+", text))
    return found


def _is_apk_signed(path: Path, entries: set[str]) -> bool:
    if any(e.upper().startswith("META-INF/") and e.upper().endswith((".RSA", ".DSA", ".EC")) for e in entries):
        return True
    try:
        with path.open("rb") as handle:
            handle.seek(max(0, path.stat().st_size - 1024 * 1024))
            tail = handle.read()
        return b"APK Sig Block 42" in tail
    except OSError:
        return False


def _analyze_apk(path: Path) -> tuple[int, list[str], list[str]]:
    """Return (risk score, plain-language findings, technical details)."""
    score = 0
    findings: list[str] = []
    details: list[str] = []

    name = path.name.lower()
    if _double_extension(path.name):
        score += 30
        findings.append("The name pretends to be a document, but it is really an app. This is a common trick.")

    brands = _brand_hits(path.name)
    if brands:
        score += 20
        findings.append(f"The file uses the trusted name \"{brands[0].title()}\". Real bank apps should be installed from the official app store, not from a download link.")

    try:
        size = path.stat().st_size
    except OSError:
        size = 0
    if size < 30 * 1024:
        score += 30
        findings.append("The app is far too small to be a real application. It is probably a fake.")

    try:
        with zipfile.ZipFile(path) as archive:
            names = archive.namelist()
            entry_set = set(names)
            has_manifest = "AndroidManifest.xml" in entry_set
            has_dex = any(n.endswith(".dex") for n in names)

            if not has_manifest or not has_dex:
                score += 35
                findings.append("This file is named like an app but is not a working Android app. It is likely a disguise for something else.")

            permissions: set[str] = set()
            if has_manifest:
                try:
                    manifest = archive.read("AndroidManifest.xml")
                    if len(manifest) < 8 * 1024 * 1024:
                        permissions = _apk_permissions(manifest)
                except Exception:
                    pass

            seen_impacts: list[str] = []
            for permission, impact, weight in PERMISSION_IMPACTS:
                if any(permission in p for p in permissions):
                    score += weight
                    seen_impacts.append(impact)
                    details.append(permission)
            if seen_impacts:
                unique_impacts = list(dict.fromkeys(seen_impacts))
                findings.append("This app asks for permission to " + ", ".join(unique_impacts) + ".")

            sms_perm = any("SMS" in p for p in permissions)
            if sms_perm and any("BIND_ACCESSIBILITY_SERVICE" in p for p in permissions):
                score += 30
                findings.append("This combination of permissions is the classic tool kit for stealing banking codes. Treat it as dangerous.")
            elif sms_perm and any("REQUEST_INSTALL_PACKAGES" in p for p in permissions):
                score += 15
                findings.append("It can read messages and install more apps. Scammers use this to take over a phone.")

            if not _is_apk_signed(path, entry_set):
                score += 15
                findings.append("The app is not properly signed by a known developer. Official apps always are.")
    except zipfile.BadZipFile:
        score += 40
        findings.append("This file is damaged or fake. It cannot be opened as a real app.")
    except OSError:
        findings.append("The file could not be fully read. Check it in person before opening it.")

    return min(score, 100), findings, details


def _analyze_executable(path: Path) -> tuple[int, list[str], list[str]]:
    score = 55
    findings = ["This is a program that can change your computer. Only open it if you were expecting it from someone you know."]
    if _double_extension(path.name):
        score += 30
        findings.append("The name pretends to be a document or picture, but it is really a program. This is a common trick.")
    brands = _brand_hits(path.name)
    if brands:
        score += 15
        findings.append(f"It uses the trusted name \"{brands[0].title()}\" to look official.")
    return min(score, 100), findings, []


def _analyze_archive(path: Path) -> tuple[int, list[str], list[str]]:
    score = 0
    findings: list[str] = []
    details: list[str] = []
    if path.suffix.lower() == ".zip":
        try:
            with zipfile.ZipFile(path) as archive:
                entries = [n for n in archive.namelist() if not n.endswith("/")]
                apk_entries = [n for n in entries if n.lower().endswith(".apk")]
                if apk_entries:
                    score += 25
                    findings.append("This zip file contains an app. Zip files are a common way to hide apps that banks never send.")
                    details.append(apk_entries[0])
        except zipfile.BadZipFile:
            findings.append("This zip file is damaged and could not be inspected.")
    brands = _brand_hits(path.name)
    if brands:
        score += 10
        findings.append(f"The name uses the trusted name \"{brands[0].title()}\".")
    return min(score, 100), findings, details


def _verdict(score: int) -> str:
    if score >= 70:
        return "DANGEROUS"
    if score >= 35:
        return "SUSPICIOUS"
    return "SAFE"


def _plain_kind(suffix: str) -> str:
    suffix = suffix.lower()
    if suffix in APK_EXTENSIONS:
        return "Android app"
    if suffix in EXECUTABLE_EXTENSIONS:
        return "Program"
    if suffix in ARCHIVE_EXTENSIONS:
        return "Zip file"
    if suffix in DOCUMENT_EXTENSIONS:
        return "Document"
    return "File"


def _analyze_file(path: Path) -> dict[str, Any]:
    suffix = path.suffix.lower()
    if suffix in APK_EXTENSIONS:
        score, findings, details = _analyze_apk(path)
    elif suffix in EXECUTABLE_EXTENSIONS:
        score, findings, details = _analyze_executable(path)
    elif suffix in ARCHIVE_EXTENSIONS:
        score, findings, details = _analyze_archive(path)
    else:
        score, findings, details = 0, [], []

    try:
        stat = path.stat()
    except OSError:
        stat = None
    if stat is None:
        return {}

    if not findings:
        findings = ["Nothing suspicious found. This looks like a normal file."]

    return {
        "name": path.name,
        "path": str(path),
        "kind": _plain_kind(suffix),
        "size_bytes": stat.st_size,
        "modified_at": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
        "sha256": _sha256(path),
        "risk_score": score,
        "verdict": _verdict(score),
        "findings": findings,
        "details": details,
    }


def _skip_name(name: str) -> bool:
    return name.startswith(".") or name.lower() in {"desktop.ini", "thumbs.db"}


@router.post("/scan-downloads")
def scan_downloads() -> dict[str, Any]:
    global _last_scan
    _ensure_downloads()

    try:
        children = [p for p in DOWNLOADS_DIR.iterdir() if p.is_file() and not _skip_name(p.name)]
    except OSError as exc:
        raise HTTPException(status_code=500, detail="The Downloads folder could not be read.") from exc

    children.sort(key=lambda p: p.stat().st_mtime if p.exists() else 0, reverse=True)
    files = []
    for path in children[:MAX_FILES]:
        try:
            result = _analyze_file(path)
            if result:
                files.append(result)
        except Exception:
            continue

    order = {"DANGEROUS": 0, "SUSPICIOUS": 1, "SAFE": 2}
    files.sort(key=lambda item: (order[item["verdict"]], -item["risk_score"]))

    counts = {
        "total": len(files),
        "dangerous": sum(1 for f in files if f["verdict"] == "DANGEROUS"),
        "suspicious": sum(1 for f in files if f["verdict"] == "SUSPICIOUS"),
        "safe": sum(1 for f in files if f["verdict"] == "SAFE"),
    }

    _last_scan = {"scanned_at": _now(), "files": files, "counts": counts}
    _save_state({"last_scan": _last_scan["scanned_at"]})
    if counts["dangerous"]:
        _log("scan", f"Download check finished: {counts['dangerous']} dangerous and {counts['suspicious']} suspicious file(s).", "danger")
    else:
        _log("scan", f"Download check finished: {counts['suspicious']} suspicious file(s), nothing dangerous.", "success")

    return {
        "scanned_at": _last_scan["scanned_at"],
        "downloads_dir": str(DOWNLOADS_DIR),
        "counts": counts,
        "files": files,
    }


def _read_quarantine_index() -> dict[str, str]:
    try:
        return json.loads(QUARANTINE_INDEX.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _write_quarantine_index(index: dict[str, str]) -> None:
    QUARANTINE_DIR.mkdir(parents=True, exist_ok=True)
    QUARANTINE_INDEX.write_text(json.dumps(index, indent=2), encoding="utf-8")


class PathsRequest(BaseModel):
    paths: list[str]


class DeleteRequest(PathsRequest):
    confirmed: bool = False


@router.get("/quarantine")
def list_quarantine() -> dict[str, Any]:
    items = []
    if QUARANTINE_DIR.exists():
        index = _read_quarantine_index()
        for entry in QUARANTINE_DIR.iterdir():
            if not entry.is_file() or entry.name == "index.json" or _skip_name(entry.name):
                continue
            try:
                stat = entry.stat()
            except OSError:
                continue
            items.append({
                "name": entry.name,
                "original_name": index.get(entry.name, entry.name),
                "size_bytes": stat.st_size,
                "quarantined_at": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
            })
    return {"quarantine_dir": str(QUARANTINE_DIR), "count": len(items), "items": items}


def _validate_download_file(raw_path: str) -> Path:
    path = Path(raw_path)
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail=f"File not found: {path.name}")
    if path.is_symlink() or not _inside_downloads(path):
        raise HTTPException(status_code=403, detail="Only files inside the Downloads folder can be changed.")
    if QUARANTINE_DIR in path.resolve().parents:
        raise HTTPException(status_code=400, detail="That file is already in quarantine.")
    return path


@router.post("/quarantine")
def quarantine_files(request: PathsRequest) -> dict[str, Any]:
    _ensure_downloads()
    QUARANTINE_DIR.mkdir(exist_ok=True)
    index = _read_quarantine_index()
    moved, failed = [], []

    for raw in request.paths:
        try:
            path = _validate_download_file(raw)
        except HTTPException as exc:
            failed.append({"path": raw, "reason": exc.detail})
            continue

        target = QUARANTINE_DIR / path.name
        counter = 1
        while target.exists():
            target = QUARANTINE_DIR / f"{path.stem}-{counter}{path.suffix}"
            counter += 1
        try:
            shutil.move(str(path), str(target))
            index[target.name] = path.name
            moved.append({"name": target.name, "original_name": path.name})
        except OSError:
            failed.append({"path": raw, "reason": "The file could not be moved."})

    if index:
        _write_quarantine_index(index)
    if moved:
        _log("quarantine", f"Moved {len(moved)} file(s) to the quarantine folder on this computer.", "success")
        _invalidate_scan()

    return {"moved": moved, "failed": failed}


class QuarantineNamesRequest(BaseModel):
    names: list[str]


@router.post("/restore")
def restore_files(request: QuarantineNamesRequest) -> dict[str, Any]:
    index = _read_quarantine_index()
    restored, failed = [], []

    for name in request.names:
        source = QUARANTINE_DIR / Path(name).name
        if not source.exists() or not source.is_file():
            failed.append({"name": name, "reason": "The file is no longer in quarantine."})
            continue
        original = index.get(source.name, source.name)
        target = DOWNLOADS_DIR / Path(original).name
        counter = 1
        while target.exists():
            target = DOWNLOADS_DIR / f"{Path(original).stem}-{counter}{Path(original).suffix}"
            counter += 1
        try:
            shutil.move(str(source), str(target))
            index.pop(source.name, None)
            restored.append({"name": target.name})
        except OSError:
            failed.append({"name": name, "reason": "The file could not be restored."})

    _write_quarantine_index(index)
    if restored:
        _log("quarantine", f"Restored {len(restored)} file(s) from quarantine.", "info")
        _invalidate_scan()
    return {"restored": restored, "failed": failed}


@router.post("/delete")
def delete_files(request: DeleteRequest) -> dict[str, Any]:
    if not request.confirmed:
        raise HTTPException(status_code=400, detail="Deleting files needs explicit confirmation.")
    _ensure_downloads()
    flagged = {f["path"] for f in (_last_scan or {}).get("files", []) if f["verdict"] != "SAFE"}
    deleted, failed = [], []

    for raw in request.paths:
        path = Path(raw)
        in_quarantine = QUARANTINE_DIR in path.resolve().parents
        if in_quarantine:
            allowed = path.exists() and path.is_file()
        else:
            allowed = path.exists() and path.is_file() and not path.is_symlink() and _inside_downloads(path) and str(path) in flagged
        if not allowed:
            failed.append({"path": raw, "reason": "Only files flagged by the latest scan can be deleted."})
            continue
        try:
            path.unlink()
            if in_quarantine:
                index = _read_quarantine_index()
                index.pop(path.name, None)
                _write_quarantine_index(index)
            deleted.append({"name": path.name})
        except OSError:
            failed.append({"path": raw, "reason": "The file could not be deleted."})

    if deleted:
        _log("delete", f"Permanently deleted {len(deleted)} file(s).", "success")
        _invalidate_scan()
    return {"deleted": deleted, "failed": failed}


def _powershell_json(script: str, timeout: float = 10.0) -> Any | None:
    if platform.system() != "Windows":
        return None
    try:
        result = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", script],
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        if result.returncode != 0 or not result.stdout.strip():
            return None
        return json.loads(result.stdout)
    except Exception:
        return None


def _check_defender() -> dict[str, Any]:
    data = _powershell_json(
        "Get-MpComputerStatus | Select-Object AntivirusEnabled,RealTimeProtectionEnabled,AntivirusSignatureLastUpdated | ConvertTo-Json"
    )
    if not isinstance(data, dict):
        return {"id": "defender", "label": "Virus protection", "status": "unknown", "message": "Virus protection status could not be read."}
    enabled = bool(data.get("AntivirusEnabled")) and bool(data.get("RealTimeProtectionEnabled"))
    return {
        "id": "defender",
        "label": "Virus protection",
        "status": "pass" if enabled else "fail",
        "message": "Windows virus protection is on." if enabled else "Windows virus protection is turned off. Please turn it on.",
    }


def _check_firewall() -> dict[str, Any]:
    data = _powershell_json("Get-NetFirewallProfile | Select-Object Name,Enabled | ConvertTo-Json -Compress")
    if data is None:
        return {"id": "firewall", "label": "Firewall", "status": "unknown", "message": "Firewall status could not be read."}
    if isinstance(data, dict):
        data = [data]
    disabled = [str(item.get("Name")) for item in data if not item.get("Enabled")]
    return {
        "id": "firewall",
        "label": "Firewall",
        "status": "pass" if not disabled else "fail",
        "message": "The firewall is on." if not disabled else f"The firewall is off for: {', '.join(disabled)}.",
    }


def _check_downloads(summary: dict[str, Any] | None) -> dict[str, Any]:
    if summary is None:
        return {
            "id": "downloads",
            "label": "Downloads folder",
            "status": "unknown",
            "message": "Your Downloads folder has not been checked yet.",
        }
    if summary["counts"]["dangerous"]:
        return {
            "id": "downloads",
            "label": "Downloads folder",
            "status": "fail",
            "message": f"{summary['counts']['dangerous']} dangerous file(s) found in Downloads.",
        }
    if summary["counts"]["suspicious"]:
        return {
            "id": "downloads",
            "label": "Downloads folder",
            "status": "warn",
            "message": f"{summary['counts']['suspicious']} file(s) need a closer look.",
        }
    return {"id": "downloads", "label": "Downloads folder", "status": "pass", "message": "No dangerous files were found in Downloads."}


def _check_updates() -> dict[str, Any]:
    if platform.system() != "Windows":
        return {"id": "updates", "label": "Windows updates", "status": "unknown", "message": "This computer is not running Windows."}
    data = _powershell_json("Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,LastBootUpTime | ConvertTo-Json")
    if not isinstance(data, dict):
        return {"id": "updates", "label": "Windows updates", "status": "unknown", "message": "Windows information could not be read."}
    return {
        "id": "updates",
        "label": "Windows updates",
        "status": "pass",
        "message": f"{data.get('Caption', 'Windows')} is installed. Turn on automatic updates in Windows Settings.",
    }


@router.post("/security-audit")
def security_audit() -> dict[str, Any]:
    global _last_audit
    _ensure_downloads()

    files_summary = _last_scan
    if files_summary is None:
        try:
            files_summary = scan_downloads()
        except HTTPException:
            files_summary = None

    checks = [
        _check_downloads(files_summary),
        _check_defender() if platform.system() == "Windows" else {
            "id": "defender", "label": "Virus protection", "status": "unknown",
            "message": "Virus protection is managed by this computer's operating system.",
        },
        _check_firewall() if platform.system() == "Windows" else {
            "id": "firewall", "label": "Firewall", "status": "unknown",
            "message": "Firewall status is managed by this computer's operating system.",
        },
        _check_updates(),
    ]

    score = 100
    for check in checks:
        if check["status"] == "fail":
            score -= 25 if check["id"] != "downloads" else 30
        elif check["status"] == "warn":
            score -= 10
        elif check["status"] == "unknown":
            score -= 5
    score = max(0, min(100, score))

    if score >= 90:
        headline = "You are well protected."
        tone = "success"
    elif score >= 70:
        headline = "Mostly safe. A few things need your attention."
        tone = "warning"
    else:
        headline = "Please fix the items below. Your computer needs attention."
        tone = "danger"

    recommendations = []
    for check in checks:
        if check["status"] in {"fail", "warn"}:
            recommendations.append(check["message"])
    if not recommendations:
        recommendations.append("Nothing to fix. Keep using this check every week.")

    _last_audit = {
        "audited_at": _now(),
        "score": score,
        "headline": headline,
        "tone": tone,
        "checks": checks,
        "recommendations": recommendations,
    }
    _save_state({"last_audit": _last_audit["audited_at"], "last_score": score})
    _log("audit", f"Safety check finished with a score of {score} out of 100. {headline}", tone)

    return _last_audit


class PasswordRequest(BaseModel):
    password: str


@router.post("/check-password")
def check_password(request: PasswordRequest) -> dict[str, Any]:
    password = request.password
    if len(password) < 4:
        raise HTTPException(status_code=400, detail="Please enter a longer password.")
    if len(password) > 256:
        raise HTTPException(status_code=400, detail="That password is too long.")

    digest = hashlib.sha1(password.encode("utf-8")).hexdigest().upper()
    prefix, suffix = digest[:5], digest[5:]
    try:
        # trust_env=False: an invalid system proxy setting must not break the check.
        with httpx.Client(trust_env=False, timeout=8.0) as client:
            response = client.get(
                f"https://api.pwnedpasswords.com/range/{prefix}",
                headers={"Add-Padding": "true"},
            )
        response.raise_for_status()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=503, detail="The internet check service could not be reached. Please try again later.") from exc

    count = 0
    for line in response.text.splitlines():
        parts = line.split(":")
        if len(parts) == 2 and parts[0].strip().upper() == suffix:
            try:
                count = int(parts[1].strip())
            except ValueError:
                count = 0
            break

    breached = count > 0
    if breached:
        message = f"This password has appeared in {count:,} known data breaches. Do not use it. Change it today, especially on your bank and email."
    else:
        message = "Good news: this password was not found in known data breaches. Keep it private and never share it."

    _log("password", "A password was checked against known data breaches.", "warning" if breached else "success")
    return {"breached": breached, "count": count, "message": message}


class LinkRequest(BaseModel):
    url: str


def _check_link(raw: str) -> dict[str, Any]:
    url = raw.strip()
    if not url:
        raise HTTPException(status_code=400, detail="Please paste a link first.")
    if "://" not in url:
        url = "http://" + url

    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    if not host:
        raise HTTPException(status_code=400, detail="That does not look like a web link.")

    score = 0
    reasons: list[str] = []

    if parsed.scheme == "http":
        score += 15
        reasons.append("The link does not use the secure 'https' connection.")
    try:
        ipaddress.ip_address(host)
        score += 35
        reasons.append("The link goes straight to a numbered computer address instead of a real website name.")
    except ValueError:
        pass

    if host.startswith("xn--") or ".xn--" in host:
        score += 35
        reasons.append("The website name uses disguised characters. This is a common trick to imitate real sites.")

    registered = ".".join(host.split(".")[-2:]) if host.count(".") >= 1 else host
    official = any(host == domain or host.endswith("." + domain) for domain in OFFICIAL_DOMAINS)

    for tld in RISKY_TLDS:
        if host.endswith(tld):
            score += 30
            reasons.append(f"The website ends with '{tld}', which scammers use very often.")
            break

    for word in PHISHING_WORDS:
        if word in host or word in parsed.path.lower():
            score += 12
            reasons.append(f"The link contains the word '{word}', often used in fake bank and parcel messages.")
            break

    brands = [brand for brand in TRUSTED_BRANDS if brand.replace(" ", "") in host.replace("-", "").replace(".", "")]
    if brands and not official:
        score += 30
        reasons.append(f"The link uses the name '{brands[0].title()}' but it is not the official website.")

    if official:
        score = max(0, min(score, 20))
        reasons.insert(0, "This is the official website of a known company or government agency.")

    score = min(score, 100)
    if score >= 60:
        verdict, advice = "DANGEROUS", "Do not open this link. Delete the message it came in."
    elif score >= 25:
        verdict, advice = "SUSPICIOUS", "Be careful. Only open it if you are sure who sent it."
    else:
        verdict, advice = "SAFE", "This link looks safe, but still check who sent it."

    _log("link", f"A link was checked: {host}. Result: {verdict.lower()}.", "danger" if verdict == "DANGEROUS" else "info")
    return {"url": url, "host": host, "risk_score": score, "verdict": verdict, "reasons": reasons, "advice": advice}


@router.post("/check-link")
def check_link(request: LinkRequest) -> dict[str, Any]:
    return _check_link(request.url)


@router.get("/status")
def agent_status() -> dict[str, Any]:
    state = _load_state()
    file_count = 0
    if DOWNLOADS_DIR.exists():
        try:
            file_count = sum(1 for p in DOWNLOADS_DIR.iterdir() if p.is_file() and not _skip_name(p.name))
        except OSError:
            file_count = 0
    quarantine_count = 0
    if QUARANTINE_DIR.exists():
        quarantine_count = sum(1 for p in QUARANTINE_DIR.iterdir() if p.is_file() and p.name != "index.json" and not _skip_name(p.name))

    return {
        "downloads_dir": str(DOWNLOADS_DIR),
        "downloads_file_count": file_count,
        "quarantine_count": quarantine_count,
        "last_scan": (_last_scan or {}).get("scanned_at") or state.get("last_scan"),
        "last_scan_counts": (_last_scan or {}).get("counts"),
        "last_audit": (_last_audit or {}).get("audited_at") or state.get("last_audit"),
        "last_score": (_last_audit or {}).get("score") or state.get("last_score"),
        "activity": _activity[:10],
    }


@router.get("/activity")
def agent_activity() -> dict[str, Any]:
    return {"activity": _activity[:30]}


class ChatRequest(BaseModel):
    message: str


def _reply(text: str, suggestions: list[str] | None = None, action: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "reply": text,
        "suggestions": suggestions or ["Check my downloads", "Run a safety check", "Is this link safe?"],
        "action": action,
    }


def _chat_scan() -> dict[str, Any]:
    result = scan_downloads()
    counts = result["counts"]
    if counts["dangerous"]:
        text = (
            f"I checked {counts['total']} files in your Downloads folder. "
            f"{counts['dangerous']} of them look dangerous and {counts['suspicious']} need a closer look. "
            "I can move the dangerous ones to a safe quarantine folder so they cannot hurt you."
        )
        return _reply(text, ["Yes, clean them up", "Show me the files", "Run a safety check"], {"type": "quarantine_prompt"})
    if counts["suspicious"]:
        text = (
            f"I checked {counts['total']} files. Nothing is clearly dangerous, but "
            f"{counts['suspicious']} file(s) are suspicious. Open the Downloads page to see them."
        )
        return _reply(text, ["Show me the files", "Run a safety check"], {"type": "navigate", "target": "/downloads"})
    return _reply(
        f"Good news. I checked {counts['total']} files in your Downloads folder and found nothing dangerous.",
        ["Run a safety check", "Check a link", "Guard my call"],
        {"type": "navigate", "target": "/downloads"},
    )


def _chat_audit() -> dict[str, Any]:
    audit = security_audit()
    text = f"Your safety score is {audit['score']} out of 100. {audit['headline']}"
    if audit["recommendations"]:
        text += " " + audit["recommendations"][0]
    return _reply(text, ["Show my safety check", "Check my downloads", "Check a link"], {"type": "navigate", "target": "/checks"})


def _chat_quarantine() -> dict[str, Any]:
    if _last_scan is None:
        scan_downloads()
    dangerous = [f for f in (_last_scan or {}).get("files", []) if f["verdict"] == "DANGEROUS"]
    if not dangerous:
        return _reply(
            "I could not find any dangerous files to clean up. Your Downloads folder looks fine.",
            ["Check my downloads", "Run a safety check"],
            {"type": "navigate", "target": "/downloads"},
        )
    return _reply(
        f"I found {len(dangerous)} dangerous file(s). Open the Downloads page and press 'Clean up dangerous files'. I will ask you to confirm first.",
        ["Take me there", "Run a safety check"],
        {"type": "navigate", "target": "/downloads", "highlight": "cleanup"},
    )


def _chat_link(message: str) -> dict[str, Any] | None:
    match = re.search(r"(https?://\S+|www\.\S+|\b[\w-]+\.(?:com|net|my|xyz|top|info|org|co)\b\S*)", message)
    if not match:
        return None
    result = _check_link(match.group(0))
    return _reply(
        f"{result['advice']} The link safety score is {result['risk_score']} out of 100.",
        ["Check another link", "Run a safety check"],
        {"type": "navigate", "target": "/checks", "highlight": "link"},
    )


def _ai_context() -> str:
    parts: list[str] = []
    if _last_scan:
        counts = _last_scan.get("counts") or {}
        parts.append(
            f"last downloads check: {counts.get('dangerous', 0)} dangerous, "
            f"{counts.get('suspicious', 0)} suspicious, {counts.get('safe', 0)} safe files"
        )
    else:
        parts.append("downloads folder has not been checked yet")
    if _last_audit:
        parts.append(f"last safety score: {_last_audit.get('score')} out of 100")
    return "; ".join(parts)


def _qwen_reply(message: str) -> str | None:
    """Ask Qwen for a plain-language answer. Only counts are shared, never file names."""
    if not QWEN_API_KEY:
        return None
    system = (
        "You are Shield Helper, a calm and friendly assistant for elderly people. "
        "Reply in short sentences and everyday words. Never ask for passwords, bank codes or personal details. "
        "You cannot open files or perform actions yourself: the app has big buttons for checking downloads, "
        "guarding a call and running a safety check. If the person seems worried, tell them to hang up or stop, "
        "and to ask a family member they trust. Keep replies under 90 words. "
        f"Current app status: {_ai_context()}."
    )
    payload = {
        "model": QWEN_MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": message[:1000]},
        ],
        "temperature": 0.4,
        "max_tokens": 220,
    }
    with httpx.Client(trust_env=False, timeout=20.0) as client:
        response = client.post(
            f"{QWEN_BASE_URL}/chat/completions",
            headers={"Authorization": f"Bearer {QWEN_API_KEY}"},
            json=payload,
        )
    response.raise_for_status()
    data = response.json()
    choices = data.get("choices") or []
    if not choices:
        return None
    content = ((choices[0].get("message") or {}).get("content") or "").strip()
    return content or None


@router.get("/ai-status")
def ai_status() -> dict[str, Any]:
    return {"configured": bool(QWEN_API_KEY), "model": QWEN_MODEL if QWEN_API_KEY else None}


@router.post("/chat")
def agent_chat(request: ChatRequest) -> dict[str, Any]:
    message = request.message.strip()
    if not message:
        return _reply("How can I help you stay safe today?")

    lowered = message.lower()

    if "password" in lowered:
        return _reply(
            "I never store passwords. Open the Safety Check page and type it in the password box. "
            "I will tell you if it has appeared in known data breaches.",
            ["Take me to the password checker", "Run a safety check"],
            {"type": "navigate", "target": "/checks", "highlight": "password"},
        )

    link_result = _chat_link(message)
    if link_result is not None:
        return link_result

    if any(word in lowered for word in ["clean", "delete", "remove", "quarantine"]):
        return _chat_quarantine()

    if any(word in lowered for word in ["download", "file", "apk", "app check", "scan"]):
        return _chat_scan()

    if any(word in lowered for word in ["call", "phone", "voice", "scam call"]):
        return _reply(
            "I can listen to a suspicious phone call and warn you if the voice sounds artificial, "
            "which is how many scam calls start. Open Call Guard and press 'Start listening'.",
            ["Take me to Call Guard", "Check my downloads", "Run a safety check"],
            {"type": "navigate", "target": "/calls"},
        )

    if any(word in lowered for word in ["check", "audit", "safe", "security", "protect", "test"]):
        return _chat_audit()

    if re.search(r"\b(hello|hi|hey|help)\b", lowered) or "what can you do" in lowered:
        return _reply(
            "Hello. I am your Shield Assistant. I can check your Downloads for dangerous apps, "
            "watch a suspicious call, or run a full safety check on this computer. What would you like me to do?",
        )

    if QWEN_API_KEY:
        try:
            ai_text = _qwen_reply(message)
            if ai_text:
                return _reply(ai_text)
        except httpx.HTTPError as exc:
            print(f"[shield] Qwen request failed: {exc}")
        except (KeyError, TypeError, ValueError) as exc:
            print(f"[shield] Qwen response was unusable: {exc}")

    return _reply(
        "I can check your Downloads folder, guard a phone call, check a link, or run a full safety check. "
        "Please choose one of the buttons below.",
    )
