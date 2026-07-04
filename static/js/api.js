/**
 * TaskMana API Client — thin fetch wrapper for 10 REST endpoints.
 * Task:  GET/POST /tasks, GET/PATCH/DELETE /tasks/{id}
 * Link:  GET/POST /links, GET/PATCH/DELETE /links/{id}
 */
const API = (() => {
  const BASE = '/';

  async function _req(method, path, body) {
    const opts = { method, headers: {} };
    if (body) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(BASE + path, opts);
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      throw new Error(detail.detail || `HTTP ${res.status}`);
    }
    return res.json();
  }

  return {
    /* ── Task CRUD ── */
    listAllTasks() {
      return _req('GET', 'tasks');
    },
    createTask(data) {
      return _req('POST', 'tasks', data);
    },
    readTask(id) {
      return _req('GET', `tasks/${id}`);
    },
    updateTask(id, data) {
      return _req('PATCH', `tasks/${id}`, data);
    },
    deleteTask(id) {
      return _req('DELETE', `tasks/${id}`);
    },

    /* ── Link CRUD ── */
    listAllLinks() {
      return _req('GET', 'links');
    },
    createLink(data) {
      return _req('POST', 'links', data);
    },
    readLink(id) {
      return _req('GET', `links/${id}`);
    },
    updateLink(id, data) {
      return _req('PATCH', `links/${id}`, data);
    },
    deleteLink(id) {
      return _req('DELETE', `links/${id}`);
    },
  };
})();
