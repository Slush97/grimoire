export type ModSafetyVerdict = 'no-findings' | 'requires-trust' | 'blocked';
export type ModSafetyReason = 'local-file' | 'browser' | 'remote-code' | 'dynamic-code' | 'executable' | 'uninspectable' | 'unreadable-archive' | 'native-code';

export interface ModSafetyFinding {
    entry: string;
    reason: ModSafetyReason;
}

export interface ModSafetyReport {
    policyVersion: number;
    fingerprint: string;
    verdict: ModSafetyVerdict;
    findings: ModSafetyFinding[];
}

export interface ModSafetySnapshot {
    report: ModSafetyReport;
    trusted: boolean;
}

export interface ModSafetyPrompt {
    id: string;
    name: string;
    report: ModSafetyReport;
    canTrust: boolean;
    restartRequired: boolean;
    context: 'installation' | 'activation' | 'startup';
}

export interface InstalledModSafety {
    modId: string;
    name: string;
    enabled: boolean;
    trusted: boolean;
    report: ModSafetyReport;
}
