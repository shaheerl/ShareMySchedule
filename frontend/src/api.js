const API_BASE = process.env.REACT_APP_API_BASE_URL || "http://localhost:5000";

function getAccessToken() {
  const token =
    localStorage.getItem("accessToken") ||
    sessionStorage.getItem("accessToken") ||
    null;

  // 👇 Debug log (trim so you don't expose the full token)
  if (token) {
    console.log("[API] Using token", token.slice(0, 20) + "...", "for request");
  } else {
    console.log("[API] No access token found");
  }

  return token;
}

export async function apiPost(path, body) {
  const token = getAccessToken();
  console.log("[API GET]", path, "token?", !!token);
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

export async function apiGet(path) {
  const token = getAccessToken();
  console.log("[API GET]", path, "token?", !!token);
  const res = await fetch(`${API_BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}
