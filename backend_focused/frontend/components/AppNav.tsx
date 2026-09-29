'use client';

import { AppBar, Box, Container, Tab, Tabs, Toolbar, Typography } from '@mui/material';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/', label: 'Vehicles' },
  { href: '/needing-maintenance', label: 'Needs service' },
  { href: '/offices', label: 'Offices' },
  { href: '/mechanics', label: 'Mechanics' },
];

export function AppNav() {
  const pathname = usePathname();
  // Longest matching prefix, so a nested route still highlights its section.
  const current =
    TABS.map((tab) => tab.href)
      .filter((href) => (href === '/' ? pathname === '/' : pathname.startsWith(href)))
      .sort((a, b) => b.length - a.length)[0] ?? '/';

  return (
    <AppBar
      position="sticky"
      color="inherit"
      elevation={0}
      sx={{ borderBottom: 1, borderColor: 'divider' }}
    >
      <Container maxWidth="xl">
        <Toolbar disableGutters sx={{ gap: 3, minHeight: { xs: 56, sm: 64 } }}>
          <Typography variant="h6" component="h1" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
            Fleet Tracker
          </Typography>
          <Box sx={{ overflowX: 'auto' }}>
            <Tabs value={current} variant="scrollable" scrollButtons={false}>
              {TABS.map((tab) => (
                <Tab
                  key={tab.href}
                  value={tab.href}
                  label={tab.label}
                  component={Link}
                  href={tab.href}
                  sx={{ textTransform: 'none', fontSize: '0.95rem' }}
                />
              ))}
            </Tabs>
          </Box>
        </Toolbar>
      </Container>
    </AppBar>
  );
}
