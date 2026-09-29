'use client';

/**
 * One place that decides what a data-driven panel shows.
 *
 * Loading, error and empty are the three states every list in this app has to
 * handle, and handling them ad hoc per component is how one of them quietly
 * goes missing. Callers pass the query result and render only the happy path.
 */

import { Alert, AlertTitle, Box, Button, Skeleton, Stack, Typography } from '@mui/material';
import type { ReactNode } from 'react';

import { parseApiError } from '@/lib/api';

interface QueryStateProps {
  isPending: boolean;
  isError: boolean;
  error?: unknown;
  /** True when the request succeeded but there is nothing to show. */
  isEmpty?: boolean;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyMessage?: string;
  emptyAction?: ReactNode;
  /** Rows of skeleton to show while pending. */
  skeletonRows?: number;
  children: ReactNode;
}

export function QueryState({
  isPending,
  isError,
  error,
  isEmpty = false,
  onRetry,
  emptyTitle = 'Nothing to show',
  emptyMessage,
  emptyAction,
  skeletonRows = 5,
  children,
}: QueryStateProps) {
  if (isPending) {
    return (
      <Stack spacing={1} aria-busy aria-live="polite" sx={{ p: 2 }}>
        {Array.from({ length: skeletonRows }).map((_, index) => (
          <Skeleton key={index} variant="rounded" height={44} />
        ))}
      </Stack>
    );
  }

  if (isError) {
    const { message } = parseApiError(error);
    return (
      <Box sx={{ p: 2 }}>
        <Alert
          severity="error"
          action={
            onRetry ? (
              <Button color="inherit" size="small" onClick={onRetry}>
                Retry
              </Button>
            ) : undefined
          }
        >
          <AlertTitle>Could not load this data</AlertTitle>
          {message}
        </Alert>
      </Box>
    );
  }

  if (isEmpty) {
    return (
      <Stack spacing={1.5} alignItems="center" sx={{ py: 8, px: 2 }}>
        <Typography variant="subtitle1">{emptyTitle}</Typography>
        {emptyMessage ? (
          <Typography variant="body2" color="text.secondary" textAlign="center">
            {emptyMessage}
          </Typography>
        ) : null}
        {emptyAction}
      </Stack>
    );
  }

  return <>{children}</>;
}
