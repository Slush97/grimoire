export type ModSafetyVerdict = 'no-findings' | 'requires-trust' | 'blocked' | 'incomplete';
export type ModSafetyReason = 'local-file' | 'browser' | 'remote-code' | 'dynamic-code' | 'uninspectable' | 'unreadable-archive' | 'inspection-failed' | 'native-code';

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
    context: 'installation' | 'activation' | 'startup' | 'server';
}

export interface InstalledModSafety {
    modId: string;
    name: string;
    enabled: boolean;
    trusted: boolean;
    report: ModSafetyReport;
}
