export interface CrashReportSummary {
  id: string;
  crashedAt: number;
  kind: 'resource-error' | 'fatal-error' | 'access-violation' | 'exception' | 'unknown' | 'unreadable';
  error?: string;
  exceptionCode?: string;
  resource?: string;
  gameBuild?: string;
  suspectedMod?: string;
  attribution?: 'recorded' | 'last-known';
  copies: number;
}

export interface CrashReportDetail extends CrashReportSummary {
  diagnostics: string;
  files: { name: string; size: number; source: 'game' | 'steam' }[];
}

export interface CrashHistoryPage {
  reports: CrashReportSummary[];
  total: number;
}
