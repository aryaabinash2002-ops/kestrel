import * as React from 'react';
import { cn } from '@renderer/lib/utils';

export const Label = ({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) => (
  <label className={cn('text-xs font-medium leading-none text-muted-foreground', className)} {...props} />
);
