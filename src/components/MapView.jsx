// src/components/MapView.jsx

import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Circle, Popup, useMap, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { API_BASE, DEVICE_ID, REFRESH_MS, DEFAULT_ZOOM, FALLBACK_FENCE } from "../config";

/**
 * Leaflet + Vite quirk:
 * In Vite builds, Leaflet's default marker image URLs are not auto-resolved.
 * The next lines force Leaflet to use public CDN URLs for the marker images.
 */
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.3/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.3/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.3/dist/images/marker-shadow.png",
});

/**
 * Minimal fetch helper returning JSON
 * - u: URL
 * - opts: fetch options (method, headers, body, etc.)
 * - idToken: if provided, we attach it as an Authorization: Bearer <token>
 *   so protected API endpoints accept the request.
 * We read as text first for easier error logging, then JSON.parse.
 */
async function getJSON(u, opts = {}, idToken = null) {
  const headers = { ...(opts.headers || {}) };
  if (idToken) headers["Authorization"] = `Bearer ${idToken}`;

  const r = await fetch(u, { ...opts, headers });
  const text = await r.text();

  if (!r.ok) {
    // If API returned an error body, surface it; otherwise show status code.
    throw new Error(text || `${r.status} ${r.statusText}`);
  }

  try { 
    return JSON.parse(text); 
  } catch { 
    // Some endpoints might return an empty body or plain text
    return text; 
  }
}

/**
 * RecenterOnChange:
 * A tiny helper component that recenters the Leaflet map whenever
 * the 'center' or 'zoom' props change.
 */
function RecenterOnChange({ center, zoom }) {
  const map = useMap();
  useEffect(() => { map.setView(center, zoom); }, [center[0], center[1], zoom, map]);
  return null;
}

/**
 * MapClickHandler:
 * Listens to click events on the map.
 * Depending on the current 'mode', it either records a geofence center
 * or a tracker position. These are passed back up via callbacks.
 */
function MapClickHandler({ mode, onGeofencePick, onTrackerPick }) {
  useMapEvents({
    click(e) {
      if (mode === "editGeofence") onGeofencePick([e.latlng.lat, e.latlng.lng]);
      if (mode === "editTracker")  onTrackerPick([e.latlng.lat, e.latlng.lng]);
    },
  });
  return null;
}

/**
 * useDisplayLabels:
 * Pure UI labels stored locally (NOT backend rename).
 * We keep the visible names in localStorage so refreshes don't lose them.
 */
function useDisplayLabels() {
  const [trackerName, setTrackerName] = useState(
    () => localStorage.getItem("ui.trackerName") || "My Tracker"
  );
  const [fenceName, setFenceName] = useState(
    () => localStorage.getItem("ui.fenceName") || "My Geofence"
  );

  useEffect(() => { localStorage.setItem("ui.trackerName", trackerName); }, [trackerName]);
  useEffect(() => { localStorage.setItem("ui.fenceName", fenceName); }, [fenceName]);

  return { trackerName, setTrackerName, fenceName, setFenceName };
}

/**
 * useClickOutside:
 * A small hook to close popovers/menus when you click outside of them.
 * - ref: the element you want to watch
 * - onOutside: callback when user clicks outside the element
 */
function useClickOutside(ref, onOutside) {
  useEffect(() => {
    function handler(e) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target)) onOutside?.();
    }
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [ref, onOutside]);
}

/**
 * MapView:
 * - idToken: JWT from Cognito (used to call protected API routes)
 * - onLogout: callback to log out (handled by parent component)
 *
 * Responsibilities:
 * 1) Load the geofence from the API (protected) and show it.
 * 2) Poll the device status from the API (protected) on a timer.
 * 3) Let the user edit geofence center/radius and tracker position.
 * 4) Provide simple UI chips/menus for edit actions and renaming (UI only).
 */
export default function MapView({ idToken, onLogout }) {
  // Live device status (position, state, etc.)
  const [status, setStatus]   = useState(null);

  // Geofence stored in DB (center + radius)
  const [fence, setFence]     = useState(null);

  // If the API responded OK for geofence, we color it blue; otherwise red.
  const [apiOk, setApiOk]     = useState(false);

  // A simple error message bar shown at the bottom-left
  const [error, setError]     = useState("");

  // UI-only labels (nicknames) for the chips
  const { trackerName, setTrackerName, fenceName, setFenceName } = useDisplayLabels();

  // Edit modes & temporary values while the user is editing
  const [mode, setMode] = useState(null); // "editGeofence" | "editTracker" | null
  const [newCenter, setNewCenter] = useState(null); // temp geofence center picked on map
  const [newRadius, setNewRadius] = useState(200);  // temp geofence radius from slider
  const [newTracker, setNewTracker] = useState(null); // temp tracker position picked on map

  // Menu visibility for the top "chips" (small pill bars)
  const [showTrackerMenu, setShowTrackerMenu] = useState(false);
  const [showFenceMenu, setShowFenceMenu] = useState(false);
  const trackerRef = useRef(null);
  const fenceRef = useRef(null);
  useClickOutside(trackerRef, () => setShowTrackerMenu(false));
  useClickOutside(fenceRef, () => setShowFenceMenu(false));

  const fenceColor = apiOk ? "#2563eb" : "#ef4444";

  /**
   * Load the geofence from the backend (protected endpoint).
   * Requires a valid idToken (JWT). We also prefill the edit radius from it.
   */
  useEffect(() => {
    if (!idToken) return;
    getJSON(`${API_BASE}/geofence/${encodeURIComponent(DEVICE_ID)}`, {}, idToken)
      .then(f => {
        setFence(f);
        setApiOk(true);
        if (f?.radius_m) setNewRadius(Number(f.radius_m));
      })
      .catch(e => {
        console.warn("Geofence API error:", e);
        setApiOk(false);
        setFence(null);
      });
  }, [idToken]);

  /**
   * Poll the device status every REFRESH_MS.
   * We keep looping until the component unmounts.
   */
  useEffect(() => {
    if (!idToken) return;

    let stop = false;
    async function loop() {
      try {
        const s = await getJSON(`${API_BASE}/devices/${encodeURIComponent(DEVICE_ID)}/status`, {}, idToken);
        if (!stop) setStatus(s);
      } catch (e) {
        if (!stop) setError(String(e));
      } finally {
        if (!stop) setTimeout(loop, REFRESH_MS);
      }
    }

    loop();
    return () => { stop = true; };
  }, [idToken]);

  /**
   * If geofence is not yet available (or API failed), we show a fallback
   * geofence so the map still renders nicely.
   */
  const useFence = fence?.center_lat ? fence : FALLBACK_FENCE;

  /**
   * The map center follows the last known tracker position if available,
   * otherwise it uses the geofence center. useMemo avoids recomputing
   * unless inputs change.
   */
  const center = useMemo(() => {
    const lat = status?.last_lat ?? useFence.center_lat;
    const lon = status?.last_lon ?? useFence.center_lon;
    return [lat, lon];
  }, [status, useFence]);

  // ------------------------------------------------------------------
  // Actions (these call your API). We only show errors; success is silent.
  // ------------------------------------------------------------------

  /**
   * Save (PUT) the edited geofence to the backend.
   * Requires Authorization: Bearer <idToken>.
   * On success, we refresh the geofence from the API and exit edit mode.
   */
  async function saveGeofence() {
    if (!newCenter) { 
      setError("Click on the map to choose the geofence center."); 
      return; 
    }
    try {
      const r = await fetch(`${API_BASE}/geofence/${encodeURIComponent(DEVICE_ID)}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${idToken}`
        },
        body: JSON.stringify({
          center_lat: newCenter[0],
          center_lon: newCenter[1],
          radius_m: newRadius
        })
      });
      if (!r.ok) throw new Error(await r.text());

      // Refresh fence from server to reflect saved values
      const fresh = await getJSON(`${API_BASE}/geofence/${encodeURIComponent(DEVICE_ID)}`, {}, idToken);
      setFence(fresh);

      // Reset UI state
      setMode(null);
      setNewCenter(null);
      setShowFenceMenu(false);
    } catch (e) {
      setError(e.message || String(e));
    }
  }

  /**
   * Save (POST) the tracker position to the backend.
   * This is how we "create or move" the tracker in your system.
   */
  async function saveTracker() {
    if (!newTracker) { 
      setError("Click on the map to place the tracker."); 
      return; 
    }
    try {
      const r = await fetch(`${API_BASE}/trackers`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${idToken}`
        },
        body: JSON.stringify({
          tracker_id: DEVICE_ID,   // the logical name (backend scopes it with user sub)
          lat: newTracker[0],
          lon: newTracker[1]
        })
      });
      if (!r.ok) throw new Error(await r.text());

      // Reset UI state
      setMode(null);
      setNewTracker(null);
      setShowTrackerMenu(false);
    } catch (e) {
      setError(e.message || String(e));
    }
  }

  /**
   * UI-only rename handlers:
   * They change the labels shown in the chips (localStorage),
   * but do NOT rename the backend keys. (You already added a true
   * rename API elsewhere; these are just the visual names.)
   */
  function promptTrackerName() {
    const v = window.prompt("Tracker name:", trackerName || "My Tracker");
    if (v && v.trim()) setTrackerName(v.trim());
    setShowTrackerMenu(false);
  }
  function promptFenceName() {
    const v = window.prompt("Geofence name:", fenceName || "My Geofence");
    if (v && v.trim()) setFenceName(v.trim());
    setShowFenceMenu(false);
  }

  return (
    <div style={{height:"100vh", width:"100vw", position:"relative"}}>
      {/* Top chips bar (centered). Each chip opens a small menu. */}
      <div style={{
        position:"absolute", top:16, left:"50%", transform:"translateX(-50%)",
        zIndex: 1000, display:"flex", gap:12, alignItems:"center"
      }}>
        {/* Tracker chip */}
        <div ref={trackerRef} style={chipStyle}>
          <button
            type="button"
            onClick={() => { setShowTrackerMenu(v => !v); setShowFenceMenu(false); }}
            style={chipToggle}
            aria-haspopup="menu"
            aria-expanded={showTrackerMenu}
            title="Tracker actions"
          >
            {trackerName}
            <span style={caret} aria-hidden>▾</span>
          </button>
          {showTrackerMenu && (
            <div role="menu" style={chipMenu}>
              <button onClick={() => { setMode("editTracker"); }} style={chipBtn}>Edit location</button>
              <button onClick={promptTrackerName} style={chipBtn}>Edit name</button>
            </div>
          )}
        </div>

        {/* Geofence chip */}
        <div ref={fenceRef} style={chipStyle}>
          <button
            type="button"
            onClick={() => { setShowFenceMenu(v => !v); setShowTrackerMenu(false); }}
            style={chipToggle}
            aria-haspopup="menu"
            aria-expanded={showFenceMenu}
            title="Geofence actions"
          >
            {fenceName}
            <span style={caret} aria-hidden>▾</span>
          </button>
          {showFenceMenu && (
            <div role="menu" style={chipMenu}>
              <button onClick={() => { setMode("editGeofence"); }} style={chipBtn}>Edit location</button>
              <button onClick={promptFenceName} style={chipBtn}>Edit name</button>
            </div>
          )}
        </div>
      </div>

      {/* Bottom-left controls so they don't overlap the map +/- controls */}
      <div style={{
        position:"absolute", left:16, bottom:16, zIndex: 1000,
        display:"flex", gap:8, alignItems:"center", flexWrap:"wrap"
      }}>
        <button onClick={onLogout} style={{...btnPrimary, background:"#2966e0ff"}}>Logout</button>
      </div>

      {/* Editing panel (appears when you are in an edit mode) */}
      {mode && (
        <div style={{
          position:"absolute", left:16, bottom:80, zIndex: 1000,
          background:"#ffffff", color:"#111", borderRadius:10, padding:12, minWidth:260,
          boxShadow:"0 6px 24px rgba(0,0,0,.15)"
        }}>
          {mode === "editGeofence" ? (
            <>
              <div style={{fontWeight:700, marginBottom:6}}>Edit Geofence</div>
              <div style={{fontSize:13, opacity:.8, marginBottom:8}}>
                Click on the map to choose the center, then adjust the radius.
              </div>
              <input
                type="range" min={50} max={1000} step={10}
                value={newRadius}
                onChange={(e)=>setNewRadius(parseInt(e.target.value))}
                style={{width:"100%"}}
              />
              <div style={{fontSize:13, marginTop:6}}>Radius: <b>{newRadius} m</b></div>
              <div style={{display:"flex", gap:8, marginTop:10}}>
                <button onClick={saveGeofence} style={btnPrimary}>Save</button>
                <button onClick={() => { setMode(null); setNewCenter(null); }} style={btnGhost}>Cancel</button>
              </div>
            </>
          ) : (
            <>
              <div style={{fontWeight:700, marginBottom:6}}>Move Tracker</div>
              <div style={{fontSize:13, opacity:.8, marginBottom:8}}>
                Click on the map to place (or move) the tracker.
              </div>
              <div style={{display:"flex", gap:8, marginTop:10}}>
                <button onClick={saveTracker} style={btnPrimary}>Save</button>
                <button onClick={() => { setMode(null); setNewTracker(null); }} style={btnGhost}>Cancel</button>
              </div>
            </>
          )}
        </div>
      )}

      {/* The actual map */}
      <MapContainer center={center} zoom={DEFAULT_ZOOM} style={{height:"100%", width:"100%"}}>
        <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

        {/* Keep map centered on latest device/fence center */}
        <RecenterOnChange center={center} zoom={DEFAULT_ZOOM} />

        {/* Listen for clicks for edit modes */}
        <MapClickHandler
          mode={mode}
          onGeofencePick={(pt)=>setNewCenter(pt)}
          onTrackerPick={(pt)=>setNewTracker(pt)}
        />

        {/* Current geofence from server (or fallback) */}
        <Circle
          center={[useFence.center_lat, useFence.center_lon]}
          radius={useFence.radius_m}
          pathOptions={{ color: fenceColor, fillOpacity: 0.15 }}
        />

        {/* Preview of a new geofence while editing */}
        {newCenter && (
          <Circle center={newCenter} radius={newRadius} pathOptions={{ color:"#22c55e", fillOpacity:.2 }} />
        )}

        {/* Current tracker position from status */}
        {status?.last_lat && (
          <Marker position={[status.last_lat, status.last_lon]}>
            <Popup>
              <b>{trackerName}</b><br />
              State: {status.device_state}<br />
              {new Date((status.last_update_ts || 0) * 1000).toLocaleString()}
            </Popup>
          </Marker>
        )}

        {/* Preview of a new tracker position while editing */}
        {newTracker && (<Marker position={newTracker} />)}
      </MapContainer>

      {/* Error bar (we only show errors to avoid noisy success toasts) */}
      {error && (
        <div style={{
          position:"fixed", bottom:10, left:10, background:"#fee2e2", color:"#991b1b",
          padding:"8px 10px", borderRadius:8, zIndex: 1000, maxWidth: "60vw"
        }}>
          ⚠️ {error}
        </div>
      )}
    </div>
  );
}

/* Simple inline styles (you could move these to CSS modules or Tailwind) */
const btnPrimary = {
  background:"#1e40af", color:"#fff", border:0,
  padding:"8px 12px", borderRadius:8, cursor:"pointer", fontWeight:600
};
const btnGhost = { ...btnPrimary, background:"#e5e7eb", color:"#111" };

const chipStyle = {
  position:"relative",
  background:"#0b1220", color:"#fff",
  padding:"0", borderRadius: 9999, fontSize: 14,
  boxShadow:"0 4px 18px rgba(0,0,0,.25)",
};
const chipToggle = {
  display:"flex", alignItems:"center", gap:8,
  background:"transparent", color:"#fff", border:0,
  padding:"8px 12px", cursor:"pointer", fontWeight:700
};
const caret = { marginLeft:6, opacity:.8, fontSize:12 };

const chipMenu = {
  position:"absolute",
  top:"calc(100% + 8px)", left:"50%", transform:"translateX(-50%)",
  background:"#111827", color:"#fff", borderRadius:10,
  padding:8, display:"flex", flexDirection:"column", gap:6,
  boxShadow:"0 10px 30px rgba(0,0,0,.35)", minWidth:160,
  zIndex: 500
};
const chipBtn = {
  ...btnPrimary,
  background:"#1f2937", borderRadius:8, fontWeight:500, padding:"6px 10px", width:"100%", textAlign:"left"
};
