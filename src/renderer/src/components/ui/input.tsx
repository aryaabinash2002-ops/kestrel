import * as React from 'react';
import { cn } from '@renderer/lib/utils';

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type, ...props }, ref) => (
  <input
    type={type}
    className={cn(
      'flex h-9 w-full rounded-md border border-input bg-background/60 px-3 py-1 text-sm shadow-xs transition-colors selectable placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 no-drag',
      className,
    )}
    ref={ref}
    {...props}
  />
));
Input.displayName = 'Input';
