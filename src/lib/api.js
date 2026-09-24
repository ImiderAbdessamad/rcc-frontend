/* Client HTTP de l'API RCC. Une seule couche d'erreurs pour toute l'interface. */

import { getToken } from "./auth.js";

const BASE = "/api/v1";
const UNREACHABLE = "Serveur injoignable. Vérifiez que l'API est démarrée puis réessayez.";

export class ApiError extends Error {
  constructor(message, { status = 0, body = null } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
  get isAuth() { return this.status === 401; }
  get isConflict() { return this.status === 409; }
}

/** Handler installé par app.js : bascule sur l'écran de connexion en cas de 401. */
let onUnauthorized = null;
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

function detailToMessage(detail, fallback) {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    // Erreurs de validation Pydantic
    const first = detail[0];
    if (first?.msg) return `${first.msg}${first.loc ? ` (${first.loc.at(-1)})` : ""}`;
  }
  return fallback;
}

/** fetch vers l'API avec l'access token Keycloak. */
async function authorizedFetch(path, { headers, ...init } = {}) {
  const token = await getToken();
  const allHeaders = new Headers(headers);
  if (token) allHeaders.set("Authorization", `Bearer ${token}`);
  try {
    return await fetch(`${BASE}${path}`, { ...init, headers: allHeaders, credentials: "same-origin" });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new ApiError(UNREACHABLE, { status: 0 });
  }
}

function sessionExpired() {
  onUnauthorized?.();
  return new ApiError("Session expirée — reconnectez-vous.", { status: 401 });
}

async function request(path, { method = "GET", body, signal, isForm = false } = {}) {
  const response = await authorizedFetch(path, {
    method,
    signal,
    headers: isForm || body == null ? undefined : { "Content-Type": "application/json" },
    body: isForm ? body : body == null ? undefined : JSON.stringify(body),
  });

  if (response.status === 401) throw sessionExpired();

  if (response.status === 204) return null;

  const isJson = (response.headers.get("content-type") || "").includes("application/json");
  const payload = isJson ? await response.json().catch(() => null) : null;

  if (!response.ok) {
    throw new ApiError(
      detailToMessage(payload?.detail, `Erreur ${response.status} — ${response.statusText}`),
      { status: response.status, body: payload }
    );
  }
  return payload;
}

function filenameFromDisposition(value, fallback) {
  if (!value) return fallback;
  const encoded = value.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try { return decodeURIComponent(encoded); } catch { return encoded; }
  }
  return value.match(/filename="?([^";]+)"?/i)?.[1] || fallback;
}

/** Fichier binaire authentifié (export, PDF) : un lien <a href> n'enverrait pas le token. */
async function blobRequest(path, { signal, errorLabel }) {
  const response = await authorizedFetch(path, { signal });
  if (response.status === 401) throw sessionExpired();
  if (!response.ok) {
    const isJson = (response.headers.get("content-type") || "").includes("application/json");
    const payload = isJson ? await response.json().catch(() => null) : null;
    throw new ApiError(
      detailToMessage(payload?.detail, `Erreur ${response.status} ${errorLabel}.`),
      { status: response.status, body: payload }
    );
  }
  return { response, blob: await response.blob() };
}

async function downloadRequest(path, fallbackName) {
  const { response, blob } = await blobRequest(path, { errorLabel: "lors de l'export" });
  const filename = filenameFromDisposition(
    response.headers.get("content-disposition"),
    fallbackName
  );
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1200);
  return { filename, size: blob.size };
}

/* ------------------------------------------------------------ Session --- */

// Connexion et déconnexion passent par Keycloak (lib/auth.js).
export const auth = {
  me: () => request("/auth/me"),
};

/* ----------------------------------------------------------- Dossiers --- */

export const dossiers = {
  list: ({ status, search, signal } = {}) => {
    const params = new URLSearchParams();
    if (status && status !== "all") params.set("status", status);
    if (search) params.set("search", search);
    const query = params.toString();
    return request(`/rcc/dossiers${query ? `?${query}` : ""}`, { signal });
  },
  get: (id, { signal } = {}) => request(`/rcc/dossiers/${encodeURIComponent(id)}`, { signal }),
  create: (payload) => request("/rcc/dossiers", { method: "POST", body: payload }),
  patch: (id, payload) =>
    request(`/rcc/dossiers/${encodeURIComponent(id)}`, { method: "PATCH", body: payload }),
  remove: (id) =>
    request(`/rcc/dossiers/${encodeURIComponent(id)}`, { method: "DELETE" }),
  saveOverrides: (id, overrides) =>
    request(`/rcc/dossiers/${encodeURIComponent(id)}/overrides`, {
      method: "PUT",
      body: { overrides },
    }),
  attach: (id, payload) =>
    request(`/rcc/dossiers/${encodeURIComponent(id)}/attach`, { method: "POST", body: payload }),
  audit: (id, { signal } = {}) =>
    request(`/rcc/dossiers/${encodeURIComponent(id)}/audit`, { signal }),
  /** PDF original de la liasse, en Blob. */
  file: async (id, { signal } = {}) => {
    const { blob } = await blobRequest(`/rcc/dossiers/${encodeURIComponent(id)}/file`, {
      signal,
      errorLabel: "lors du chargement du PDF",
    });
    return blob;
  },
  exportFile: (id, format = "json") => {
    if (format !== "json") {
      throw new ApiError("Seul l'export JSON métier est disponible.", { status: 422 });
    }
    return downloadRequest(
      `/rcc/dossiers/${encodeURIComponent(id)}/export.json`,
      `RCC-${id}.json`
    );
  },
  /** Envoie le bilan extrait vers POST /ia-clients/bilans (noRcTiers = n° tiers). */
  pushBilan: (id, body = {}) =>
    request(`/rcc/dossiers/${encodeURIComponent(id)}/bilans/push`, {
      method: "POST",
      body,
    }),
  /** Envoie plusieurs bilans via POST /ia-clients/bilans/batch. */
  pushBilansBatch: (dossierIds, body = {}) =>
    request("/rcc/dossiers/bilans/batch", {
      method: "POST",
      body: { dossier_ids: dossierIds, ...body },
    }),
};

export const audit = {
  all: ({ signal } = {}) => request("/rcc/audit", { signal }),
};

export const system = {
  ocrHealth: ({ signal } = {}) => request("/rcc/system/ocr-health", { signal }),
};

/* --------------------------------------------------------------- Jobs --- */

export const jobs = {
  /** Envoi du PDF avec progression d'upload (fetch n'expose pas onprogress). */
  async create(file, { onUploadProgress } = {}) {
    const token = await getToken();
    return new Promise((resolve, reject) => {
      const form = new FormData();
      form.append("file", file);

      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${BASE}/rcc/jobs`);
      if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);

      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable) {
          onUploadProgress?.(Math.round((event.loaded / event.total) * 100));
        }
      });

      xhr.addEventListener("load", () => {
        let payload = null;
        try { payload = JSON.parse(xhr.responseText); } catch { /* réponse non JSON */ }
        if (xhr.status === 401) {
          reject(sessionExpired());
          return;
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(payload);
          return;
        }
        reject(new ApiError(
          detailToMessage(payload?.detail, `Erreur ${xhr.status} lors de l'envoi du fichier.`),
          { status: xhr.status, body: payload }
        ));
      });

      xhr.addEventListener("error", () =>
        reject(new ApiError("Envoi interrompu — vérifiez votre connexion.", { status: 0 })));
      xhr.addEventListener("abort", () =>
        reject(new ApiError("Envoi annulé.", { status: 0 })));

      xhr.send(form);
    });
  },

  progress: (jobId, { signal } = {}) =>
    request(`/rcc/jobs/${encodeURIComponent(jobId)}`, { signal }),

  result: (jobId, { signal } = {}) =>
    request(`/rcc/jobs/${encodeURIComponent(jobId)}/result`, { signal }),

  // EventSource n'envoie pas d'en-tête : le backend accepte le token en query sur ce seul flux.
  streamUrl: (jobId, token) =>
    `${BASE}/rcc/jobs/${encodeURIComponent(jobId)}/stream`
    + (token ? `?access_token=${encodeURIComponent(token)}` : ""),

  exportJson: (jobId) =>
    downloadRequest(
      `/rcc/jobs/${encodeURIComponent(jobId)}/export`,
      `RCC-${jobId}.json`
    ),
};

/**
 * Suit un job jusqu'à son terme : SSE en priorité, repli sur du polling si le
 * flux se coupe (proxy, veille de l'onglet…).
 *
 * @returns {{ promise: Promise<object>, cancel: () => void }}
 */
export function followJob(jobId, { onProgress } = {}) {
  let source = null;
  let cancelled = false;
  let pollTimer = null;
  let settle = { resolve: null, reject: null };

  const cleanup = () => {
    source?.close();
    source = null;
    clearTimeout(pollTimer);
  };

  const finish = async () => {
    if (cancelled) return;
    cleanup();
    try {
      settle.resolve(await jobs.result(jobId));
    } catch (error) {
      settle.reject(error);
    }
  };

  const fail = (message) => {
    if (cancelled) return;
    cleanup();
    settle.reject(new ApiError(message, { status: 422 }));
  };

  // Un job peut disparaître (redémarrage du serveur, expiration du TTL) :
  // sans plafond, le client interrogerait indéfiniment un job inexistant.
  const MAX_CONSECUTIVE_FAILURES = 4;
  let consecutiveFailures = 0;

  const poll = async () => {
    if (cancelled) return;
    try {
      const progress = await jobs.progress(jobId);
      consecutiveFailures = 0;
      onProgress?.(progress);
      if (progress.status === "completed") return finish();
      if (progress.status === "failed") return fail(progress.error || "L'extraction a échoué.");
    } catch (error) {
      if (error.isAuth) { cleanup(); settle.reject(error); return; }
      if (error.status === 404) {
        return fail(
          "Le job d'extraction n'existe plus (serveur redémarré ou délai dépassé). "
          + "Relancez l'import."
        );
      }
      consecutiveFailures += 1;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        return fail("Suivi de l'extraction interrompu — le serveur ne répond plus.");
      }
    }
    pollTimer = setTimeout(poll, 2500);
  };

  const openStream = (token) => {
    if (cancelled) return;
    try {
      source = new EventSource(jobs.streamUrl(jobId, token));
    } catch {
      poll();
      return;
    }

    const handleProgress = (event) => {
      try { onProgress?.(JSON.parse(event.data)); } catch { /* évènement non JSON */ }
    };

    for (const name of [
      "job_status", "pdf_validated", "job_started", "pages_rendered",
      "page_classified", "page_extracted", "page_skipped", "page_failed",
      "resolving_fields", "running_controls",
    ]) {
      source.addEventListener(name, handleProgress);
    }
    source.onmessage = handleProgress;

    source.addEventListener("result_ready", (event) => {
      handleProgress(event);
      finish();
    });
    source.addEventListener("job_failed", (event) => {
      let message = "L'extraction a échoué.";
      try {
        const data = JSON.parse(event.data);
        message = data.error || data.message || message;
      } catch { /* évènement non JSON */ }
      fail(message);
    });

    source.onerror = () => {
      // EventSource retente seul ; s'il a définitivement fermé (coupure, token
      // expiré → 401), on bascule en polling, qui renouvelle le token à chaque appel.
      if (!source || source.readyState === EventSource.CLOSED) {
        cleanup();
        poll();
      }
    };
  };

  const promise = new Promise((resolve, reject) => {
    settle = { resolve, reject };
    getToken().then(openStream);
  });

  return {
    promise,
    cancel() {
      cancelled = true;
      cleanup();
    },
  };
}
