// src/config.js
export const API_BASE = import.meta.env.VITE_API_BASE;
export const COGNITO_DOMAIN = import.meta.env.VITE_COGNITO_DOMAIN;
export const COGNITO_CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID;
export const REDIRECT_URI = import.meta.env.VITE_REDIRECT_URI;

// autres constantes (zoom, etc.) peuvent rester hardcodées
export const REFRESH_MS = 5000;
export const DEFAULT_ZOOM = 17;
export const FALLBACK_FENCE = { center_lat: 10.0440679, center_lon: 76.3263556, radius_m: 200 };
export const DEVICE_ID = "tracker1"; // Ou récupère depuis l’UI si tu laisses le renommage côté front
