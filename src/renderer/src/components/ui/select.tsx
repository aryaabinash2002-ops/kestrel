import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@renderer/lib/utils';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<
  React.SelectHTMLAttributes<HTMLSelectElement>,
  'onChange'
> {
  options: SelectOption[];
  onValueChange?: (value: string) => void;
  placeholder?: string;
}

/** Native select styled to match — reliable inside Electron and accessible. */
export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, options, onValueChange, placeholder, value, ...props }, ref) => (
    <div className={cn('relative', className)}>
      <select
        ref={ref}
        value={value ?? ''}
        onChange={(e) => onValueChange?.(e.target.value)}
        className="h-9 w-full appearance-none rounded-md border border-input bg-background/60 pl-3 pr-8 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50 no-drag"
        {...props}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  ),
);
Select.displayName = 'Select';
