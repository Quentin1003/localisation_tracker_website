// src/config.js
export const API_BASE = "https://ga9ov2g4qc.execute-api.us-east-1.amazonaws.com";
export const COGNITO_DOMAIN = "https://us-east-13c5r7lfm6.auth.us-east-1.amazoncognito.com";
export const COGNITO_CLIENT_ID = "6e2c5qo5j2thd6mopicc91g90f";
export const REDIRECT_URI = "http://localhost:5173/";

export const DEVICE_ID = "tracker1";              // id par défaut
export const REFRESH_MS = 5000;                   // polling
export const DEFAULT_ZOOM = 17;
export const FALLBACK_FENCE = {
  center_lat: 10.0440679,
  center_lon: 76.3263556,
  radius_m: 200
};
