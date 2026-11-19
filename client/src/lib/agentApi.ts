import { FRAUD_API_BASE_URL } from '@/const';

export type Verdict = 'DANGEROUS' | 'SUSPICIOUS' | 'SAFE';

export type ScannedFile = {
  name: string;
  path: string;
  kind: string;
  size_bytes: number;
  modified_at: string;
  sha256: string | null;
  risk_score: number;
  verdict: Verdict;
  findings: string[];
  details: string[];
};

export type ScanResult = {
  scanned_at: string;
  downloads_dir: string;
  counts: { total: number; dangerous: number; suspicious: number; safe: number };
  files: ScannedFile[];
};

export type QuarantineItem = {
  name: string;
  original_name: string;
  size_bytes: number;
  quarantined_at: string;
};

export type AuditCheck = {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail' | 'unknown';
  message: string;
};

export type AuditResult = {
  audited_at: string;
  score: number;
  headline: string;
  tone: 'success' | 'warning' | 'danger';
  checks: AuditCheck[];
  recommendations: string[];
};

export type AgentStatus = {
  downloads_dir: string;
  downloads_file_count: number;
  quarantine_count: number;
  last_scan: string | null;
  last_scan_counts: ScanResult['counts'] | null;
  last_audit: string | null;
  last_score: number | null;
  activity: { id: string; time: string; kind: string; message: string; tone: string }[];
};

export type LinkResult = {
  url: string;
  host: string;
  risk_score: number;
  verdict: Verdict;
  reasons: string[];
  advice: string;
};

export type PasswordResult = {
  breached: boolean;
  count: number;
  message: string;
};

export type ChatAction =
  | { type: 'navigate'; target: string; highlight?: string }
  | { type: 'quarantine_prompt' }
  | null;

export type ChatResponse = {
  reply: string;
  suggestions: string[];
  action: ChatAction;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${FRAUD_API_BASE_URL}${path}`, init);
  } catch {
    throw new Error('The Shield service is not running. Please start the helper on this computer and try again.');
  }

  if (!response.ok) {
    let detail = `The request failed (${response.status}).`;
    try {
      const body = await response.json();
      if (typeof body.detail === 'string') detail = body.detail;
    } catch {
      // Keep the generic message when the body is not JSON.
    }
    throw new Error(detail);
  }
  return (await response.json()) as T;
}

function post<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
}

export const agentApi = {
  status: () => request<AgentStatus>('/agent/status'),
  scanDownloads: () => post<ScanResult>('/agent/scan-downloads'),
  quarantineFiles: (paths: string[]) => post<{ moved: { name: string; original_name: string }[]; failed: { path: string; reason: string }[] }>('/agent/quarantine', { paths }),
  listQuarantine: () => request<{ quarantine_dir: string; count: number; items: QuarantineItem[] }>('/agent/quarantine'),
  restoreFiles: (names: string[]) => post<{ restored: { name: string }[]; failed: { name: string; reason: string }[] }>('/agent/restore', { names }),
  deleteFiles: (paths: string[]) => post<{ deleted: { name: string }[]; failed: { path: string; reason: string }[] }>('/agent/delete', { paths, confirmed: true }),
  securityAudit: () => post<AuditResult>('/agent/security-audit'),
  checkPassword: (password: string) => post<PasswordResult>('/agent/check-password', { password }),
  checkLink: (url: string) => post<LinkResult>('/agent/check-link', { url }),
  chat: (message: string) => post<ChatResponse>('/agent/chat', { message }),
};

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function formatWhen(iso: string | null): string {
  if (!iso) return 'Never';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  const diffMinutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(diffMinutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return date.toLocaleDateString();
}
