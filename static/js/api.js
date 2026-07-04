/**
 * TaskMana API Client — thin fetch wrapper for REST endpoints.
 * Task:  GET/POST /tasks, GET/PATCH/DELETE /tasks/{id}
 * Link:  GET/POST /links, GET/PATCH/DELETE /links/{id}
 * Auth:  POST /auth/login, GET /auth/me
 *
 * Token is stored in localStorage and auto-attached to every request.
 * On 401, dispatches a 'taskmana:unauthorized' event.
 */
const API = (() => {
  const BASE = '/';
  const TOKEN_KEY = 'taskmana_token';
  const USER_KEY = 'taskmana_user';

  function _req(method, path, body) {
    const opts = { method, headers: {} };
    if (body) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const token = getToken();
    if (token) {
      opts.headers['Authorization'] = 'Bearer ' + token;
    }
    return fetch(BASE + path, opts).then(res => {
      if (res.status === 401) {
        clearToken();
        window.dispatchEvent(new CustomEvent('taskmana:unauthorized'));
      }
      if (!res.ok) {
        return res.json().then(detail => {
          throw new Error(detail.detail || 'HTTP ' + res.status);
        });
      }
      return res.json();
    });
  }

  function getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }

  function setToken(token) {
    localStorage.setItem(TOKEN_KEY, token);
  }

  function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  function setUser(user) {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }

  function getUser() {
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }

  function isAuthenticated() {
    return !!getToken();
  }

  return {
    getToken, setToken, clearToken, setUser, getUser, isAuthenticated,
    /* ── Auth ── */
    login(username, password) {
      return _req('POST', 'auth/login', { username, password });
    },
    me() {
      return _req('GET', 'auth/me');
    },

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
