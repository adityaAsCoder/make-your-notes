const AUTH_STORAGE_KEY = "user-platform-auth";

export function getAuthenticatedUser() {
  try {
    const storedUser = window.localStorage.getItem(AUTH_STORAGE_KEY);
    return storedUser ? JSON.parse(storedUser) : null;
  } catch {
    return null;
  }
}

export function saveAuthenticatedUser(user) {
  window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
}

export function clearAuthenticatedUser() {
  window.localStorage.removeItem(AUTH_STORAGE_KEY);
}
