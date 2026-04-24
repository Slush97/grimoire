import { type CSSProperties } from 'react';

interface SkeletonProps {
  className?: string;
  style?: CSSProperties;
  rounded?: 'none' | 'sm' | 'md' | 'lg' | 'xl' | 'full';
}

const roundedClass: Record<NonNullable<SkeletonProps['rounded']>, string> = {
  none: '',
  sm: 'rounded-sm',
  md: 'rounded-md',
  lg: 'rounded-lg',
  xl: 'rounded-xl',
  full: 'rounded-full',
};

export function Skeleton({ className = '', style, rounded = 'md' }: SkeletonProps) {
  return (
    <div
      aria-hidden
      className={`bg-bg-tertiary skeleton-shimmer ${roundedClass[rounded]} ${className}`}
      style={style}
    />
  );
}

interface SkeletonTextProps {
  lines?: number;
  className?: string;
  lineClassName?: string;
}

export function SkeletonText({ lines = 3, className = '', lineClassName = '' }: SkeletonTextProps) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={`h-3 ${i === lines - 1 ? 'w-2/3' : 'w-full'} ${lineClassName}`}
        />
      ))}
    </div>
  );
}
