/**
 * Global fetch interceptor to inject JWT token into /api requests
 * and rewrite relative /api paths to the configured backend base URL.
 */
const originalFetch = window.fetch;

window.fetch = async (resource, config) => {
  if (typeof resource === 'string' && resource.startsWith('/api')) {
    const apiUrl = import.meta.env.VITE_API_URL;
    if (apiUrl) {
      resource = `${apiUrl}${resource}`;
    }

    const token = localStorage.getItem('tracktruck_token');
    if (token) {
      config = config || {};
      const headers = new Headers(config.headers);
      headers.set('Authorization', `Bearer ${token}`);
      config.headers = headers;
    }
  }

  const response = await originalFetch(resource, config);

  const urlString = typeof resource === 'string' ? resource : (resource instanceof URL ? resource.toString() : resource.url);
  
  // Safely parse URL to check just the pathname
  let isPathApi = false;
  try {
    const parsedUrl = new URL(urlString, window.location.origin);
    isPathApi = parsedUrl.pathname.startsWith('/api');
  } catch {
    isPathApi = urlString.startsWith('/api');
  }

  // Handle unauthorized globally (only if it's OUR api, not mapbox)
  if (response.status === 401 && isPathApi && !urlString.includes('/auth/login')) {
    localStorage.removeItem('tracktruck_token');
    if (window.location.pathname.startsWith('/admin')) {
      const returnUrl = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = `/login?returnUrl=${returnUrl}`;
    }
  }

  return response;
};

export { };
