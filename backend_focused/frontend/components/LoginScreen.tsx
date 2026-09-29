'use client';

import { Alert, Box, Button, Container, Paper, Stack, TextField, Typography } from '@mui/material';
import { useState, type FormEvent } from 'react';

import { parseApiError } from '@/lib/api';

interface LoginScreenProps {
  onSignIn: (username: string, password: string) => Promise<void>;
}

export function LoginScreen({ onSignIn }: LoginScreenProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    // A real form, so Enter submits and password managers recognise it.
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSignIn(username.trim(), password);
    } catch (caught) {
      const { message } = parseApiError(caught);
      // The API answers a bad password with a 401 whose detail is about the
      // token, which would read as a system fault rather than a typo.
      setError(
        message.toLowerCase().includes('no active account')
          ? 'That username and password do not match an account.'
          : message,
      );
      setBusy(false);
    }
  };

  return (
    <Container maxWidth="xs" sx={{ py: 10 }}>
      <Paper variant="outlined" sx={{ p: 4 }}>
        <Stack spacing={1} sx={{ mb: 3 }}>
          <Typography variant="h5" component="h1">
            Fleet Tracker
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Sign in to manage vehicles, offices and maintenance.
          </Typography>
        </Stack>

        <Box component="form" onSubmit={submit}>
          <Stack spacing={2}>
            {error ? <Alert severity="error">{error}</Alert> : null}

            <TextField
              label="Username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              autoFocus
              fullWidth
              required
            />
            <TextField
              label="Password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              fullWidth
              required
            />

            <Button
              type="submit"
              variant="contained"
              size="large"
              disabled={busy || !username.trim() || !password}
            >
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
          </Stack>
        </Box>

        <Typography variant="caption" color="text.secondary" sx={{ mt: 3, display: 'block' }}>
          The seed command creates <strong>demo</strong> / <strong>demo12345</strong>.
        </Typography>
      </Paper>
    </Container>
  );
}
