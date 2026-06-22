(function () {
  const config = window.AUSENCIAS_CONFIG;

  function apiUrl() {
    const guardada = String(localStorage.getItem(config.API_STORAGE_KEY) || "").trim();
    const valida = /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec(?:\?.*)?$/i.test(guardada);
    return valida ? guardada : String(config.DEFAULT_API_URL || "").trim();
  }

  function guardarApiUrl(url) {
    const limpia = String(url || "").trim();
    if (limpia) localStorage.setItem(config.API_STORAGE_KEY, limpia);
    else localStorage.removeItem(config.API_STORAGE_KEY);
    return limpia;
  }

  function exigirUrl() {
    const url = apiUrl();
    if (!url) throw new Error("Falta configurar la URL de Google Apps Script.");
    return url;
  }

  async function leerJson(response) {
    const texto = await response.text();
    let data;
    try {
      data = JSON.parse(texto);
    } catch {
      throw new Error("La API devolvio una respuesta no valida.");
    }
    if (!response.ok || data.ok === false) throw new Error(data.mensaje || `Error HTTP ${response.status}`);
    return data;
  }

  async function get(action, params = {}) {
    const url = new URL(exigirUrl());
    url.searchParams.set("action", action);
    url.searchParams.set("_", Date.now());
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
    });
    return leerJson(await fetch(url, { cache: "no-store", redirect: "follow" }));
  }

  async function post(payload) {
    return leerJson(await fetch(exigirUrl(), {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
      redirect: "follow"
    }));
  }

  window.AusenciasApi = Object.freeze({ apiUrl, guardarApiUrl, get, post });
})();
