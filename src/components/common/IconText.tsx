import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

interface IconTextProps {
  icon: LucideIcon;
  children: ReactNode;
  title?: string;
  className?: string;
  iconClassName?: string;
  valueClassName?: string;
}

export function IconText({
  icon: Icon,
  children,
  title,
  className = '',
  iconClassName = '',
  valueClassName = '',
}: IconTextProps) {
  return (
    <span className={`icon-text ${className}`} title={title}>
      <span className={`icon-text__icon ${iconClassName}`}>
        <Icon aria-hidden="true" />
      </span>
      <span className={`icon-text__value ${valueClassName}`}>{children}</span>
    </span>
  );
}
