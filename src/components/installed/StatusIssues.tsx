import type { MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ChevronDown, type LucideIcon } from 'lucide-react';
import { Button } from '../common/ui';
import { MenuContent, MenuItem, MenuRoot, MenuTrigger } from '../common/menu';

export interface StatusIssue {
  key: string;
  variant: 'danger' | 'warning' | 'primary';
  icon: LucideIcon;
  label: string;
  title?: string;
  count: number;
  onOpen: () => void;
  onContextMenu?: (event: MouseEvent) => void;
}

const MENU_TONE = { danger: 'danger', warning: 'warning', primary: 'default' } as const;

// One issue keeps its direct button. Two or more collapse into a single
// dropdown so the toolbar row doesn't wrap under a stack of status pills.
export function StatusIssues({ issues }: { issues: StatusIssue[] }) {
  const { t } = useTranslation();

  if (issues.length === 0) return null;

  if (issues.length === 1) {
    const [issue] = issues;
    return (
      <Button
        variant={issue.variant}
        onClick={issue.onOpen}
        onContextMenu={issue.onContextMenu}
        icon={issue.icon}
        title={issue.title}
      >
        {issue.label}
      </Button>
    );
  }

  const total = issues.reduce((sum, issue) => sum + issue.count, 0);
  return (
    <MenuRoot kind="dropdown">
      <MenuTrigger asChild>
        <Button
          variant={issues.some((issue) => issue.variant === 'danger') ? 'danger' : 'warning'}
          icon={AlertTriangle}
        >
          {t('installed.status.issues', { count: total })}
          <ChevronDown className="h-3.5 w-3.5 opacity-70" aria-hidden />
        </Button>
      </MenuTrigger>
      <MenuContent>
        {issues.map((issue) => (
          <MenuItem
            key={issue.key}
            icon={issue.icon}
            tone={MENU_TONE[issue.variant]}
            title={issue.title}
            onSelect={issue.onOpen}
            onContextMenu={issue.onContextMenu}
          >
            {issue.label}
          </MenuItem>
        ))}
      </MenuContent>
    </MenuRoot>
  );
}
