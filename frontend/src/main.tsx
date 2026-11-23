import ReactDOM from 'react-dom/client';
import { StrictMode } from 'react';
import App from './App';
import { LoginPage, SessionSplash } from './LoginPage';
import { session, useSession } from './session';
import './styles.css';

/** The dashboard for a logged-in user, otherwise the login page */
function Root() {
  const { status, user, notice } = useSession();
  if (status === 'checking') return <SessionSplash />;
  if (status === 'signedOut' || !user) return <LoginPage notice={notice} />;
  return <App user={user} />;
}

// Logs back in with the refresh cookie, if there is one
void session.restore();

// iOS Safari ignores user-scalable=no, so cancel its pinch gesture too. Pinching the map still zooms the map.
for (const type of ['gesturestart', 'gesturechange']) {
  document.addEventListener(type, event => {
    if (!(event.target instanceof Element && event.target.closest('.map-stage'))) event.preventDefault();
  }, { passive: false });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
