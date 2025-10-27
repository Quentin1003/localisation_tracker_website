// src/App.jsx
import { useEffect, useRef, useState } from "react";
import { API_BASE, COGNITO_CLIENT_ID, COGNITO_DOMAIN, REDIRECT_URI } from "./config";
import MapView from "./components/MapView";

/**
 * Build the Hosted UI authorization URL.
 * - We ask Cognito for an OAuth2 "authorization code".
 * - After sign-in, Cognito will redirect the browser back to REDIRECT_URI
 *   with ?code=... in the URL.
 */
function buildAuthorizeUrl() {
  const q = new URLSearchParams({
    client_id: COGNITO_CLIENT_ID,
    response_type: "code",            // "code" = Authorization Code Flow
    scope: "openid email profile",    // what info/permissions we request
    redirect_uri: REDIRECT_URI,       // must exactly match the app client settings
  });
  return `${COGNITO_DOMAIN}/oauth2/authorize?${q.toString()}`;
}

/**
 * Build the Hosted UI logout URL.
 * - This ends the Cognito Hosted UI session and then sends you back
 *   to REDIRECT_URI when done.
 */
function buildLogoutUrl() {
  const q = new URLSearchParams({
    client_id: COGNITO_CLIENT_ID,
    logout_uri: REDIRECT_URI,
  });
  return `${COGNITO_DOMAIN}/logout?${q.toString()}`;
}

/**
 * Exchange the authorization "code" for tokens by calling our backend.
 * Security reason: the backend (Lambda) knows the client secret and talks to Cognito.
 * Frontend should NEVER hold secrets.
 *
 * Returns a JSON object like:
 *   { id_token, access_token, refresh_token, token_type, expires_in }
 */
async function exchangeCodeForTokens(code) {
  const r = await fetch(`${API_BASE}/auth/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // No "credentials: include" here: we only need the JSON tokens response
    body: JSON.stringify({ code, redirectUri: REDIRECT_URI, clientId: COGNITO_CLIENT_ID }),
  });

  // Read as text first (helps when the server returns a non-JSON error string)
  const txt = await r.text();
  let data;
  try { data = JSON.parse(txt); } catch { data = { raw: txt }; }

  if (!r.ok) {
    // If backend sent an error with details, surface it. Otherwise show the raw.
    throw new Error(data?.detail || JSON.stringify(data));
  }

  return data;
}

/**
 * Root component:
 * - On load, checks if the URL contains ?code=... (coming back from Cognito).
 * - If found, it exchanges the code for tokens via our backend.
 * - Stores idToken in state and renders the authenticated MapView.
 */
export default function App() {
  // Simple UI state machine: "idle" -> "loading" -> "ok" or "error"
  const [status, setStatus]   = useState("idle"); // idle | loading | ok | error
  const [error, setError]     = useState(null);

  // JWT used to call protected API routes (Authorization: Bearer <idToken>)
  const [idToken, setIdToken] = useState(null);

  // Prevents double exchange when React/Vite HMR or re-renders occur
  const exchangedRef = useRef(false);

  useEffect(() => {
    // Read the "code" parameter that Cognito appended to the URL after login
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (!code) return;                 // Not coming back from login yet
    if (exchangedRef.current) return;  // Avoid double exchange in dev
    exchangedRef.current = true;

    (async () => {
      try {
        setStatus("loading");

        // Ask our backend to swap the code for tokens
        const tokens = await exchangeCodeForTokens(code);

        // We only keep id_token on the client for calling protected APIs.
        // (access_token could be used too depending on your API config.)
        setIdToken(tokens.id_token);

        // Optional: tiny log to verify we got something
        console.log("[auth] idToken (first 20 chars) =", tokens.id_token?.slice(0,20));

        setStatus("ok");

        // Clean the URL so refreshing the page doesn't try to re-exchange the code
        window.history.replaceState({}, "", REDIRECT_URI);
      } catch (e) {
        setStatus("error");
        setError(e.message);
      }
    })();
  }, []);

  // Start the Hosted UI login (full-page redirect)
  const goToLogin = () => window.location.assign(buildAuthorizeUrl());

  // End Hosted UI session and return to our app
  const logout = () => window.location.assign(buildLogoutUrl());

  // If authenticated and we have a token, render the map application
  if (status === "ok" && idToken) {
    return <MapView idToken={idToken} onLogout={logout} />;
  }

  // Otherwise, render a simple centered sign-in card
  return (
    <div style={{
      display:"grid", placeItems:"center", minHeight:"100vh",
      background:"#0a1320ff", color:"#fff", padding:16
    }}>
      <div style={{ width:360, maxWidth:"90vw", background:"#3360a3ff", padding:24, borderRadius:12 }}>
        <h3 style={{marginTop:0}}>Sign in</h3>
        <p>Veuillez vous connecter pour afficher la carte.</p>
        <button
          style={{width:"100%", padding:"10px 12px", borderRadius:8, border:0, cursor:"pointer", fontWeight:700}}
          onClick={goToLogin}
          disabled={status === "loading"}
        >
          {status === "loading" ? "Connexion…" : "Continue with Cognito"}
        </button>
        {status === "error" && (
          <p style={{ color: "#f88", marginTop: 12 }}>Erreur: {String(error)}</p>
        )}
      </div>
    </div>
  );
}
