import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import { EventProvider } from './lib/event';
import './styles/global.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root not found');

createRoot(rootEl).render(
  <StrictMode>
    <EventProvider>
      <RouterProvider router={router} />
    </EventProvider>
  </StrictMode>,
);
