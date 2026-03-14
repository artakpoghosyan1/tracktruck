/**
 * Global fetch interceptor to inject JWT token into /api requests
 */
const originalFetch = window.fetch;

window.fetch = async (resource, config) => {
  if (typeof resource === 'string' && resource.startsWith('/api')) {
    const token = localStorage.getItem('tracktruck_token');
    if (token) {
      config = config || {};
      const headers = new Headers(config.headers);
      headers.set('Authorization', `Bearer ${token}`);
      config.headers = headers;
    }
  }

  const response = await originalFetch(resource, config);
  
  // Handle unauthorized globally
  if (response.status === 401 && !resource.toString().includes('/auth/login')) {
    localStorage.removeItem('tracktruck_token');
    if (window.location.pathname.startsWith('/admin')) {
      window.location.href = '/login';
    }
  }

  return response;
};

export {};
