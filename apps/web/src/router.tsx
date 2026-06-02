// router.tsx — app routes (design §1 surfaces/routing table).
//   /              → landing (participants join by code → /j/:code; organizer → /login)
//   /login         → organizer login
//   /host          → organizer control (guards via me())
//   /host/builder  → puzzle builder (manual + AI generation)
//   /host/account  → organizer account (roster + password, guards via me())
//   /host/history  → past-rounds history (guards via me())
//   /host/branding  → event branding (guards via me())
//   /j/:code       → player
//   /tv            → booth prefix entry (asks for the organizer/booth prefix)
//   /tv/:slug      → full join code → direct display; 3-letter prefix → that
//                    booth's prefix-scoped standby (TvRoute dispatches)
import { createBrowserRouter } from 'react-router-dom';
import { Landing } from './surfaces/landing/Landing';
import { LoginPage } from './surfaces/host/LoginPage';
import { HostApp } from './surfaces/host/HostApp';
import { Builder } from './surfaces/host/Builder';
import { AccountPage } from './surfaces/host/AccountPage';
import { HistoryPage } from './surfaces/host/HistoryPage';
import { BrandingPage } from './surfaces/host/BrandingPage';
import { PlayerApp } from './surfaces/player/PlayerApp';
import { TvRoute } from './surfaces/display/TvRoute';
import { PrefixEntry } from './surfaces/display/PrefixEntry';

export const router = createBrowserRouter([
  { path: '/', element: <Landing /> },
  { path: '/login', element: <LoginPage /> },
  { path: '/host', element: <HostApp /> },
  { path: '/host/builder', element: <Builder /> },
  { path: '/host/account', element: <AccountPage /> },
  { path: '/host/history', element: <HistoryPage /> },
  { path: '/host/branding', element: <BrandingPage /> },
  { path: '/j/:code', element: <PlayerApp /> },
  { path: '/tv', element: <PrefixEntry /> },
  { path: '/tv/:slug', element: <TvRoute /> },
]);
