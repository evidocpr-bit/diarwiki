export class DirectusApi {
  constructor(baseUrl, token, fetchImplementation = fetch) {
    this.baseUrl = new URL(baseUrl);
    this.token = token;
    this.fetchImplementation = fetchImplementation;
  }

  async request(path, options = {}) {
    const response = await this.fetchImplementation(new URL(path, this.baseUrl), {
      ...options,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${this.token}`,
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        ...options.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`Directus API ${options.method ?? 'GET'} ${path}: HTTP ${response.status}`);
    }
    if (response.status === 204) return undefined;
    const payload = await response.json();
    return payload.data;
  }

  get(path) {
    return this.request(path);
  }

  post(path, body) {
    return this.request(path, { method: 'POST', body: JSON.stringify(body) });
  }

  patch(path, body) {
    return this.request(path, { method: 'PATCH', body: JSON.stringify(body) });
  }

  delete(path) {
    return this.request(path, { method: 'DELETE' });
  }

  fetch(path, options = {}) {
    return this.fetchImplementation(new URL(path, this.baseUrl), {
      ...options,
      headers: {
        authorization: `Bearer ${this.token}`,
        ...options.headers,
      },
    });
  }
}

export function managedDescription(key, description) {
  return `[diarwiki:${key}] ${description}`;
}

export function managedKey(description) {
  return typeof description === 'string'
    ? description.match(/^\[diarwiki:([a-z\d_-]+)\]/iu)?.[1]
    : undefined;
}
