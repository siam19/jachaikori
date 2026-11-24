import type { ReactNode } from 'react';

interface ClippingProps {
  children: ReactNode;
  className?: string;
  torn?: boolean;
  inkRule?: boolean;
  as?: 'article' | 'section' | 'div';
}

export function Clipping({
  children,
  className = '',
  torn = false,
  inkRule = false,
  as: Tag = 'article',
}: ClippingProps) {
  return (
    <Tag
      className={`clipping-surface rounded-2xl p-5 sm:p-6 ${torn ? 'torn-edge' : ''} ${
        inkRule ? 'clipping-ink-rule' : ''
      } ${className}`.trim()}
    >
      {children}
    </Tag>
  );
}
