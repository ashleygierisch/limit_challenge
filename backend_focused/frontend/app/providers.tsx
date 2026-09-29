'use client';

import { CssBaseline, ThemeProvider, createTheme } from '@mui/material';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { PropsWithChildren, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError } from 'axios';

const theme = createTheme({
  palette: {
    primary: {
      main: '#0f62fe',
    },
    background: {
      default: '#f5f7fb',
    },
  },
  shape: { borderRadius: 8 },
  components: {
    MuiTableCell: {
      styleOverrides: {
        head: {
          fontWeight: 600,
          whiteSpace: 'nowrap',
          backgroundColor: '#fafbfd',
          color: '#475569',
          fontSize: '0.78rem',
          letterSpacing: '0.02em',
          textTransform: 'uppercase',
        },
        // Fixed-layout tables need per-cell clipping, or a long VIN
        // pushes its column past the width the header reserved.
        body: { overflow: 'hidden', textOverflow: 'ellipsis' },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: { '&:last-child td': { borderBottom: 0 } },
      },
    },
  },
});

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        // A 4xx means the request itself was wrong, so repeating it verbatim
        // only delays the error the user needs to see. Retry server and network
        // faults, which are the ones that plausibly succeed on a second try.
        retry: (failureCount, error) => {
          const status = error instanceof AxiosError ? error.response?.status : undefined;
          if (status && status >= 400 && status < 500) return false;
          return failureCount < 2;
        },
      },
      mutations: {
        retry: false,
      },
    },
  });
}

export default function Providers({ children }: PropsWithChildren) {
  const [queryClient] = useState(makeQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {/* One adapter for the whole tree, so every date picker shares a
            calendar and locale rather than configuring them per field. */}
        <LocalizationProvider dateAdapter={AdapterDayjs}>{children}</LocalizationProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
