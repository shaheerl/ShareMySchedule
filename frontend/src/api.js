const API_BASE = process.env.REACT_APP_API_BASE_URL || "http://localhost:5000";

function getAccessToken() {
  const token =
    localStorage.getItem("accessToken") ||
    sessionStorage.getItem("accessToken") ||
    null;

  if (token) {
    console.log(
      "[API] Using token",
      token.slice(0, 20) + "...",
      "for request"
    );
  } else {
    console.log("[API] No access token found");
  }
  return token;
}

function getRefreshToken() {
  return (
    localStorage.getItem("refreshToken") ||
    sessionStorage.getItem("refreshToken") ||
    null
  );
}

async function refreshAccessToken() {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;

  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });

    if (!res.ok) {
      console.warn("[API] Refresh failed", res.status);
      return null;
    }

    const data = await res.json();
    if (data.accessToken) {
      localStorage.setItem("accessToken", data.accessToken);
      return data.accessToken;
    }
    return null;
  } catch (err) {
    console.error("[API] Refresh error:", err);
    return null;
  }
}

async function requestWithRetry(method, path, body) {
  let token = getAccessToken();

  const doFetch = async (tokenToUse) => {
    const headers = { "Content-Type": "application/json" };
    if (tokenToUse) headers["Authorization"] = `Bearer ${tokenToUse}`;

    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (res.status === 401) throw new Error("Unauthorized");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  };

  try {
    return await doFetch(token);
  } catch (err) {
    if (err.message === "Unauthorized") {
      // try refreshing
      token = await refreshAccessToken();
      if (token) {
        return doFetch(token);
      }
    }
    throw err;
  }
}

export async function apiGet(path) {
  console.log("[API GET]", path);
  return requestWithRetry("GET", path);
}

export async function apiPost(path, body) {
  console.log("[API POST]", path, body);
  return requestWithRetry("POST", path, body);
}

export async function apiDelete(path) {
  console.log("[API DELETE]", path);
  return requestWithRetry("DELETE", path);
}

export async function apiPut(path, body) {
  console.log("[API PUT]", path, body);
  return requestWithRetry("PUT", path, body);
}