let personaActual = null;
let eventoAbierto = null;
let motivoSeleccionado = "";
let ocupado = false;
let relojEvento = null;
let personalPorDni = new Map();
let abiertosPorDni = new Map();
let fechaRosterActual = "";

const contenido = document.getElementById("contenidoMarcacion");
const mensaje = document.getElementById("mensaje");
const titulo = document.getElementById("tituloVista");
const subtitulo = document.getElementById("subtituloVista");
const paso = document.getElementById("pasoActual");

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function formatearMinutos(total) {
  const minutos = Math.max(0, Math.floor(Number(total) || 0));
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return h ? `${h} h ${String(m).padStart(2, "0")} min` : `${m} min`;
}

function guardarCachePersonal(fechaRoster, personal) {
  fechaRosterActual = fechaRoster || fechaRosterActual;
  localStorage.setItem(window.AUSENCIAS_CONFIG.PERSONAL_CACHE_KEY, JSON.stringify({
    fechaRoster: fechaRosterActual, personal, abiertos: Array.from(abiertosPorDni.values()), guardado: new Date().toISOString()
  }));
}

function aplicarDatosLocales(data) {
  fechaRosterActual = data.fechaRoster || fechaRosterActual;
  personalPorDni = new Map((data.personal || []).map(persona => [String(persona.dni), persona]));
  abiertosPorDni = new Map((data.abiertos || []).map(abierto => [String(abierto.dni), abierto]));
}

function fusionarPersonal(nuevos) {
  (nuevos || []).forEach(persona => {
    const dni = String(persona.dni);
    const actual = personalPorDni.get(dni);
    if (!actual) personalPorDni.set(dni, persona);
    else if (!persona.turnoProvisional) personalPorDni.set(dni, { ...actual, ...persona });
    else personalPorDni.set(dni, { ...persona, turno:actual.turno || persona.turno, turnoProvisional:actual.turnoProvisional !== false });
  });
}

function leerCachePersonal() {
  try {
    const data = JSON.parse(localStorage.getItem(window.AUSENCIAS_CONFIG.PERSONAL_CACHE_KEY) || "null");
    if (!data?.personal?.length) return null;
    const hoy = new Date().toLocaleDateString("es-PE", { day: "2-digit", month: "2-digit", year: "numeric" });
    const diaCarga = new Date(data.guardado).toLocaleDateString("es-PE", { day: "2-digit", month: "2-digit", year: "numeric" });
    return diaCarga === hoy ? data : null;
  } catch {
    return null;
  }
}

async function prepararPersonal() {
  paso.textContent = "PREPARANDO";
  titulo.textContent = "Cargando personal";
  subtitulo.textContent = "Esta carga se realiza una sola vez por dia.";
  contenido.innerHTML = `<div class="success-view"><p>Sincronizando colaboradores...</p></div>`;
  const cache = leerCachePersonal();
  if (cache) {
    aplicarDatosLocales(cache);
    vistaDni();
    sincronizarDatos();
    return;
  }
  try {
    let data;
    try { data = await AusenciasApi.get("bootstrap"); }
    catch { data = await AusenciasApi.get("dashboard", { dias: 1 }); }
    aplicarDatosLocales(data);
    guardarCachePersonal(data.fechaRoster, data.personal || []);
    vistaDni();
  } catch (error) {
    mostrarMensaje(error.message);
    titulo.textContent = "No se pudo cargar el personal";
    subtitulo.textContent = "Usa Actualizar datos desde el panel administrador.";
  }
}

async function sincronizarDatos() {
  try {
    const data = await AusenciasApi.get("bootstrap");
    fechaRosterActual = data.fechaRoster || fechaRosterActual;
    fusionarPersonal(data.personal || []);
    abiertosPorDni = new Map((data.abiertos || []).map(abierto => [String(abierto.dni), abierto]));
    guardarCachePersonal(data.fechaRoster, Array.from(personalPorDni.values()));
  } catch {}
}

function mostrarMensaje(texto, tipo = "error") {
  mensaje.textContent = texto;
  mensaje.className = `mensaje ${tipo}`;
  mensaje.hidden = false;
}

function limpiarMensaje() {
  mensaje.hidden = true;
  mensaje.textContent = "";
}

function setOcupado(valor) {
  ocupado = valor;
  document.querySelectorAll("button,input").forEach(el => {
    if (!el.classList.contains("config-link")) el.disabled = valor;
  });
}

function personaHtml(persona) {
  const inicial = (persona.nombre || persona.dni || "P").charAt(0).toUpperCase();
  const turno = persona.turnoProvisional ? "TURNO POR CONFIRMAR" : persona.turno;
  return `<div class="person-card"><div class="person-avatar">${escapeHtml(inicial)}</div><div><strong>${escapeHtml(persona.nombreCompleto)}</strong><span>${escapeHtml(persona.dni)} | ${escapeHtml(turno)} | ${escapeHtml(persona.cargo || persona.area || persona.cliente)}</span></div></div>`;
}

function vistaDni() {
  clearInterval(relojEvento);
  personaActual = null;
  eventoAbierto = null;
  motivoSeleccionado = "";
  paso.textContent = "MARCACION";
  titulo.textContent = "Ingresa tu DNI";
  subtitulo.textContent = "Consulta rapida de salida o retorno.";
  contenido.innerHTML = `<form id="formDni" class="dni-form"><input id="dni" inputmode="numeric" autocomplete="off" maxlength="12" placeholder="DNI" aria-label="DNI" required><button type="submit">CONTINUAR</button></form>`;
  contenido.querySelector("form").addEventListener("submit", consultarDni);
  limpiarMensaje();
  setTimeout(() => contenido.querySelector("input")?.focus(), 30);
}

async function consultarDni(event) {
  event.preventDefault();
  if (ocupado) return;
  const dni = String(document.getElementById("dni").value || "").replace(/\D/g, "");
  if (dni.length < 6) return mostrarMensaje("Ingresa un DNI valido.");
  limpiarMensaje();
  const cacheActual = leerCachePersonal();
  if (cacheActual) aplicarDatosLocales(cacheActual);
  personaActual = personalPorDni.get(dni) || null;
  if (!personaActual) return mostrarMensaje(`El DNI ${dni} no existe en el personal cargado para hoy.`);
  eventoAbierto = abiertosPorDni.get(dni) || null;
  if (eventoAbierto) vistaRetorno();
  else vistaMotivos();
  validarEstadoActual(dni);
}

async function validarEstadoActual(dni) {
  try {
    const teniaAbierto = Boolean(eventoAbierto);
    const data = await AusenciasApi.get("persona", { dni });
    if (!personaActual || String(personaActual.dni) !== String(dni)) return;
    personaActual = data.persona || personaActual;
    eventoAbierto = data.abierto || null;
    if (eventoAbierto) abiertosPorDni.set(String(dni), eventoAbierto);
    else abiertosPorDni.delete(String(dni));
    guardarCachePersonal(data.fechaRoster || fechaRosterActual, Array.from(personalPorDni.values()));
    if (eventoAbierto) vistaRetorno();
    else if (teniaAbierto) vistaMotivos();
  } catch {}
}

function vistaMotivos() {
  clearInterval(relojEvento);
  paso.textContent = "REGISTRAR SALIDA";
  titulo.textContent = "Selecciona el motivo";
  subtitulo.textContent = "Solo puedes mantener una salida activa.";
  contenido.innerHTML = `${personaHtml(personaActual)}<div class="reason-grid">${[
    ["BANO", "BAÑO", "10 minutos"], ["BREAK", "BREAK", "60 minutos"], ["AGUA", "AGUA", "5 minutos"], ["OTRO", "OTRO", "Evaluacion manual"]
  ].map(([value, label, note]) => `<button class="reason-card" type="button" data-motivo="${value}" onclick="seleccionarMotivo(this)"><strong>${label}</strong><span>${note}</span></button>`).join("")}</div><div id="otroBox"></div><div class="action-row"><button class="secondary" type="button" onclick="vistaDni()">CANCELAR</button><button id="btnSalida" class="primary-action" type="button" onclick="registrarSalida()" disabled>REGISTRAR SALIDA</button></div>`;
}

function seleccionarMotivo(button) {
  motivoSeleccionado = button.dataset.motivo;
  document.querySelectorAll(".reason-card").forEach(el => el.classList.toggle("selected", el === button));
  document.getElementById("btnSalida").disabled = false;
  document.getElementById("otroBox").innerHTML = motivoSeleccionado === "OTRO" ? `<div class="other-box"><input id="detalleOtro" maxlength="120" placeholder="Describe brevemente el motivo"></div>` : "";
  if (motivoSeleccionado === "OTRO") setTimeout(() => document.getElementById("detalleOtro")?.focus(), 20);
}

async function registrarSalida() {
  if (ocupado || !motivoSeleccionado) return;
  const detalle = String(document.getElementById("detalleOtro")?.value || "").trim();
  if (motivoSeleccionado === "OTRO" && !detalle) return mostrarMensaje("Describe el motivo de la salida.");
  limpiarMensaje();
  setOcupado(true);
  try {
    const data = await AusenciasApi.post({ action: "salida", dni: personaActual.dni, motivo: motivoSeleccionado, detalle });
    abiertosPorDni.set(String(personaActual.dni), { dni: personaActual.dni, motivo: data.motivo, horaSalida: data.hora, fechaHoraSalida: new Date().toISOString(), transcurridoMin: 0 });
    guardarCachePersonal(fechaRosterActual, Array.from(personalPorDni.values()));
    vistaExito("SALIDA REGISTRADA", `${data.motivo} | ${data.hora}`);
  } catch (error) {
    if (/salida activa/i.test(error.message)) {
      await validarEstadoActual(personaActual.dni);
      if (eventoAbierto) return setOcupado(false);
    }
    mostrarMensaje(error.message);
    setOcupado(false);
  }
}

function vistaRetorno() {
  clearInterval(relojEvento);
  const evento = eventoAbierto;
  if (!evento) return vistaMotivos();
  paso.textContent = "SALIDA ACTIVA";
  titulo.textContent = "Registra tu entrada / retorno";
  subtitulo.textContent = "Tu salida permanece abierta.";
  contenido.innerHTML = `${personaHtml(personaActual)}<div class="return-panel"><strong>${escapeHtml(evento.motivo)}</strong><span id="tiempoAbierto" class="elapsed">-- min</span><p>Salida: ${escapeHtml(evento.horaSalida)}</p><button class="return-button" type="button" onclick="registrarRetorno()">REGISTRAR RETORNO</button></div><button class="secondary" type="button" onclick="vistaDni()" style="width:100%;margin-top:14px">CANCELAR</button>`;
  const actualizar = () => {
    const el = document.getElementById("tiempoAbierto");
    if (!el) { clearInterval(relojEvento); return; }
    const salida = new Date(evento.fechaHoraSalida);
    const minutos = Number.isNaN(salida.getTime()) ? Number(evento.transcurridoMin || 0) : Math.max(0,(Date.now()-salida.getTime())/60000);
    el.textContent = formatearMinutos(minutos);
  };
  actualizar();
  relojEvento = setInterval(actualizar, 1000);
}

async function registrarRetorno() {
  if (ocupado) return;
  limpiarMensaje();
  setOcupado(true);
  try {
    const data = await AusenciasApi.post({ action: "retorno", dni: personaActual.dni });
    abiertosPorDni.delete(String(personaActual.dni));
    guardarCachePersonal(fechaRosterActual, Array.from(personalPorDni.values()));
    clearInterval(relojEvento);
    vistaExito("RETORNO REGISTRADO", `Duracion: ${formatearMinutos(data.duracionMin)}`);
  } catch (error) {
    mostrarMensaje(error.message);
    setOcupado(false);
  }
}

function vistaExito(tituloExito, detalle) {
  paso.textContent = "COMPLETADO";
  titulo.textContent = "Marcacion correcta";
  subtitulo.textContent = "El evento fue guardado.";
  contenido.innerHTML = `<div class="success-view"><strong>${escapeHtml(tituloExito)}</strong><p>${escapeHtml(detalle)}</p><button class="primary-action" type="button" onclick="vistaDni()" style="width:100%">NUEVA MARCACION</button></div>`;
  setOcupado(false);
  setTimeout(vistaDni, 5000);
}

setInterval(() => { document.getElementById("reloj").textContent = new Date().toLocaleTimeString("es-PE", { hour12: false }); }, 1000);
setInterval(sincronizarDatos, window.AUSENCIAS_CONFIG.ROSTER_SYNC_MS || 300000);
prepararPersonal();
