import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bug, Check, Copy, FileText, Github, LifeBuoy } from 'lucide-react';
import { useAppStore } from '../../../stores/appStore';
import { buildDiagnosticReport } from '../../../lib/api';
import { Button, Card } from '../../common/ui';
import { Textarea } from '../../common/forms';
import Tx from '../../translation/Tx';

const DISCORD_INVITE = 'https://discord.gg/KgYGHEMq2P';

function DiscordIcon({ className }: { className: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className}>
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

// Where to reach us, plus the sanitized diagnostic report users paste into
// Discord or a GitHub issue.
export default function SupportSection() {
  const { t } = useTranslation();
  const { settings, saveSettings } = useAppStore();

  const [bugDescription, setBugDescription] = useState('');
  const [bugReportText, setBugReportText] = useState<string | null>(null);
  const [isBuildingReport, setIsBuildingReport] = useState(false);
  const [bugReportError, setBugReportError] = useState<string | null>(null);
  const [bugCopyState, setBugCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [includeFullLog, setIncludeFullLog] = useState(false);

  const handleGenerateBugReport = async () => {
    setIsBuildingReport(true);
    setBugReportError(null);
    setBugCopyState('idle');
    try {
      const text = await buildDiagnosticReport(bugDescription, { includeFullLog });
      setBugReportText(text);
    } catch (err) {
      setBugReportError(t('settings.support.reportBuildFailed', { error: String(err) }));
    } finally {
      setIsBuildingReport(false);
    }
  };

  const handleCopyBugReport = async () => {
    if (!bugReportText) return;
    try {
      await navigator.clipboard.writeText(bugReportText);
      setBugCopyState('copied');
      window.setTimeout(() => setBugCopyState('idle'), 2000);
    } catch {
      setBugCopyState('failed');
    }
  };

  // Prefill the GitHub "new issue" URL with the user's description as the
  // title and a stub body that tells them to paste the diagnostic. We can't
  // jam the full sanitized report into the URL (GitHub caps issue-create
  // URLs around 8 KB and our log tail is up to 256 KB), so the contract is:
  // "copy the report, then click the button, then paste."
  const githubIssueUrl = useMemo(() => {
    const firstLine = bugDescription.split('\n').find((l) => l.trim().length > 0) ?? '';
    const title = firstLine.trim().slice(0, 100) || t('settings.support.bugReportTitle');
    const body = [
      bugDescription.trim() || '<!-- describe what happened -->',
      '',
      '---',
      '',
      'Diagnostic report (copied from Grimoire → Settings → Share a bug report):',
      '',
      '```',
      'paste the report here',
      '```',
    ].join('\n');
    const q = `?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
    return `https://github.com/Slush97/grimoire/issues/new${q}`;
  }, [bugDescription, t]);

  return (
    <Card title={<Tx k="settings.sections.support" fallback="Support" />} icon={LifeBuoy}>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <p className="text-sm text-text-secondary">
            <Tx
              k="settings.support.description"
              fallback="Found a bug or have a feature request? File an issue on GitHub or drop into our Discord."
            />
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <a
              href="https://github.com/Slush97/grimoire/issues"
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center justify-center gap-2 rounded-sm px-4 py-2 text-sm font-medium border border-border bg-bg-tertiary/40 text-text-primary hover:bg-bg-tertiary/70 hover:border-text-secondary/60 transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-text-secondary/60 whitespace-nowrap"
            >
              <Github className="w-4 h-4" aria-hidden="true" />
              <Tx k="settings.support.githubIssues" fallback="GitHub Issues" />
            </a>
            <a
              href={DISCORD_INVITE}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center justify-center gap-2 rounded-sm px-4 py-2 text-sm font-medium border border-brand-discord/40 bg-brand-discord/10 text-text-primary hover:bg-brand-discord/20 hover:border-brand-discord/60 transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-discord/60 whitespace-nowrap"
            >
              <DiscordIcon className="w-4 h-4 fill-current" />
              <Tx k="settings.support.joinDiscord" fallback="Join Discord" />
            </a>
          </div>
        </div>

        <div className="h-px bg-white/5" />

        <div className="space-y-3">
          <div>
            <h4 className="font-medium text-sm flex items-center gap-2">
              <Bug className="w-4 h-4 text-text-secondary" aria-hidden="true" />
              <Tx k="settings.support.shareBugReport" fallback="Share a bug report" />
            </h4>
            <p className="text-xs text-text-secondary mt-1">
              <Tx
                k="settings.support.bugReportDescription"
                fallback="Describe what went wrong, generate a sanitized report, then paste it into Discord or a GitHub issue. The report bundles app and OS info plus the tail of your log; home paths, Steam IDs, bearer tokens, and emails are stripped before it leaves the app."
              />
            </p>
          </div>

          <Textarea
            value={bugDescription}
            onChange={(e) => setBugDescription(e.target.value)}
            placeholder={t('settings.support.bugPlaceholder')}
            rows={3}
          />

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Button
              onClick={handleGenerateBugReport}
              isLoading={isBuildingReport}
              size="sm"
              variant="secondary"
              icon={FileText}
            >
              {bugReportText ? (
                <Tx k="settings.support.regenerateReport" fallback="Regenerate report" />
              ) : (
                <Tx k="settings.support.generateReport" fallback="Generate report" />
              )}
            </Button>
            <label className="inline-flex items-center gap-2 text-xs text-text-secondary cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includeFullLog}
                onChange={(e) => setIncludeFullLog(e.target.checked)}
                className="h-3.5 w-3.5 rounded-sm border border-white/20 bg-bg-tertiary accent-accent focus:outline-none focus:ring-2 focus:ring-accent"
              />
              <Tx
                k="settings.support.includeFullLog"
                fallback="Include full log (up to 5 MB; Discord auto-attaches as a file)"
              />
            </label>
            <label className="inline-flex items-center gap-2 text-xs text-text-secondary cursor-pointer select-none">
              <input
                type="checkbox"
                checked={settings?.verboseModTrace ?? false}
                onChange={(e) => settings && saveSettings({ ...settings, verboseModTrace: e.target.checked })}
                className="h-3.5 w-3.5 rounded-sm border border-white/20 bg-bg-tertiary accent-accent focus:outline-none focus:ring-2 focus:ring-accent"
              />
              <Tx
                k="settings.support.verboseModTrace"
                fallback="Verbose mod logging (traces enable/disable/scan to the log; turn off when done)"
              />
            </label>
          </div>

          {bugReportError && (
            <p className="text-xs text-state-danger break-all">{bugReportError}</p>
          )}

          {bugReportText && (
            <div className="space-y-2 animate-fade-in">
              <p className="text-[11px] text-text-secondary/70">
                <Tx
                  k="settings.support.reviewBeforeSharing"
                  fallback="Review before sharing. Nothing is sent automatically."
                />
              </p>
              <textarea
                value={bugReportText}
                readOnly
                rows={10}
                className="w-full px-3 py-2 text-[11px] font-mono leading-relaxed bg-bg-tertiary/60 border border-white/5 rounded-sm text-text-secondary focus:outline-none focus:ring-2 focus:ring-accent resize-y"
                onFocus={(e) => e.currentTarget.select()}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={handleCopyBugReport}
                  size="sm"
                  icon={bugCopyState === 'copied' ? Check : Copy}
                >
                  {bugCopyState === 'copied'
                    ? <Tx k="common.status.copied" fallback="Copied" />
                    : bugCopyState === 'failed'
                      ? <Tx k="settings.support.copyFailed" fallback="Copy failed: select and Ctrl+C" />
                      : <Tx k="settings.support.copyReport" fallback="Copy report" />}
                </Button>
                <a
                  href={DISCORD_INVITE}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center justify-center gap-2 rounded-sm px-3 py-1.5 text-sm font-medium border border-brand-discord/40 bg-brand-discord/10 text-text-primary hover:bg-brand-discord/20 hover:border-brand-discord/60 transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-discord/60"
                >
                  <DiscordIcon className="w-4 h-4 fill-current" />
                  <Tx k="settings.support.openDiscord" fallback="Open Discord" />
                </a>
                <a
                  href={githubIssueUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center justify-center gap-2 rounded-sm px-3 py-1.5 text-sm font-medium border border-border bg-bg-tertiary/40 text-text-primary hover:bg-bg-tertiary/70 hover:border-text-secondary/60 transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-text-secondary/60"
                >
                  <Github className="w-4 h-4" aria-hidden="true" />
                  <Tx k="settings.support.openGithubIssue" fallback="Open GitHub issue" />
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
