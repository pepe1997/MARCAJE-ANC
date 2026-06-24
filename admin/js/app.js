let respuesta = { abiertos: [], marcaciones: [], personal: [] };
let timerCarga = null;
let timerReloj = null;
let timerAbiertos = null;
let timerFiltro = null;
let detalleExportable = [];
let resumenExportable = [];

const config = window.AUSENCIAS_CONFIG;
const limites = config.LIMITES;

function limpiar(value) { return String(value ?? "").trim(); }
function normalizar(value) { return limpiar(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase(); }
function html(value) { return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function fmt(value) { return Number(value || 0).toLocaleString("es-PE", { maximumFractionDigits: 2 }); }
function fechaCorta(value) { const d = new Date(value); return Number.isNaN(d.getTime()) ? limpiar(value) : d.toLocaleDateString("es-PE"); }
function minutosEntre(a, b = new Date()) { const ini = new Date(a); const fin = new Date(b); return Number.isNaN(ini.getTime()) || Number.isNaN(fin.getTime()) ? 0 : Math.max(0, (fin - ini) / 60000); }
function duracion(value) { const min = Math.max(0, Math.round(Number(value) || 0)); const h = Math.floor(min / 60); return h ? `${h} h ${String(min % 60).padStart(2, "0")} min` : `${min} min`; }
function fechaHora(value) { const d = new Date(value); return Number.isNaN(d.getTime()) ? limpiar(value) : d.toLocaleString("es-PE", { hour12:false }); }

function estadoMotivo(motivo, minutos) {
  const limite = limites[normalizar(motivo)];
  if (!limite) return { key: "green", label: "MANUAL", limite: null };
  if (minutos > limite) return { key: "red", label: "EXCEDIDO", limite };
  if (minutos >= limite * .8) return { key: "amber", label: "POR VENCER", limite };
  return { key: "green", label: "EN TIEMPO", limite };
}

function agruparEventos(marcaciones) {
  const mapa = new Map();
  marcaciones.forEach(row => {
    const id = limpiar(row.idEvento || row.ID_EVENTO);
    if (!id) return;
    if (!mapa.has(id)) mapa.set(id, { idEvento: id });
    const item = mapa.get(id);
    Object.assign(item, {
      dni: limpiar(row.dni || row.DNI), nombre: limpiar(row.nombre || row.NOMBRE), apellidos: limpiar(row.apellidos || row.APELLIDOS),
      turno: normalizar(row.turno || row.TURNO) || "SIN TURNO", area: limpiar(row.area || row.AREA), cargo: limpiar(row.cargo || row.CARGO),
      cliente: limpiar(row.cliente || row.CLIENTE), grupo: normalizar(row.grupo || row.GRUPO) || "PRINCIPAL",
      motivo: normalizar(row.motivo || row.MOTIVO), detalle: limpiar(row.detalle || row.DETALLE)
    });
    const evento = normalizar(row.evento || row.EVENTO);
    const fechaHora = row.fechaHora || row.FECHA_HORA;
    if (evento === "SALIDA") item.salida = fechaHora;
    if (evento === "RETORNO") { item.retorno = fechaHora; item.duracionMin = Number(row.duracionMin || row.DURACION_MIN || 0); }
  });
  return Array.from(mapa.values()).filter(x => x.salida).map(x => ({ ...x, abierto: !x.retorno, duracionMin: x.retorno ? (x.duracionMin || minutosEntre(x.salida, x.retorno)) : minutosEntre(x.salida) }));
}

function filtrosActuales() {
  return { grupo: document.getElementById("filtroGrupo")?.value || "", turno: document.getElementById("filtroTurno")?.value || "", motivo: document.getElementById("filtroMotivo")?.value || "", q: normalizar(document.getElementById("filtroBuscar")?.value || "") };
}

function renderDashboardFiltrado() {
  clearTimeout(timerFiltro);
  timerFiltro = setTimeout(renderDashboard, 120);
}

function coincide(row, filtros) {
  if (filtros.grupo && (normalizar(row.grupo) || "PRINCIPAL") !== filtros.grupo) return false;
  if (filtros.turno && normalizar(row.turno) !== filtros.turno) return false;
  if (filtros.motivo && normalizar(row.motivo) !== filtros.motivo) return false;
  if (filtros.q && ![row.dni,row.nombre,row.apellidos,row.cargo,row.area,row.cliente,row.motivo].map(normalizar).join(" ").includes(filtros.q)) return false;
  return true;
}

function filaActiva(row) {
  const min = minutosEntre(row.fechaHoraSalida || row.salida);
  const estado = estadoMotivo(row.motivo, min);
  return `<tr data-salida="${html(row.fechaHoraSalida || row.salida)}" data-motivo="${html(row.motivo)}"><td><strong>${html(row.nombreCompleto || `${row.nombre || ""} ${row.apellidos || ""}`)}</strong><small style="display:block;color:#64748b">${html(row.dni)}</small></td><td>${html(row.grupo === "MULTIFORMATO" ? "MULTIFORMATO" : "OSLO + CD")}</td><td>${html(row.turno)}</td><td>${html(row.cargo || row.area || row.cliente)}</td><td><strong>${html(row.motivo)}</strong>${row.detalle ? `<small style="display:block">${html(row.detalle)}</small>` : ""}</td><td>${html(row.horaSalida || new Date(row.fechaHoraSalida || row.salida).toLocaleTimeString("es-PE", { hour12:false }))}</td><td class="number live-elapsed">${html(duracion(min))}</td><td><span class="status ${estado.key} live-status">${estado.label}</span></td></tr>`;
}

function tabla(headers, rows, clase = "") {
  return `<div class="table-wrap ${clase}"><table><thead><tr>${headers.map(h => `<th>${html(h)}</th>`).join("")}</tr></thead><tbody>${rows.join("") || `<tr><td colspan="${headers.length}" class="empty">Sin datos para mostrar.</td></tr>`}</tbody></table></div>`;
}

function resumenMotivos(eventos) {
  return ["BANO","BREAK","AGUA","OTRO"].map(motivo => {
    const data = eventos.filter(x => x.motivo === motivo);
    const total = data.reduce((a,b) => a + b.duracionMin, 0);
    return { motivo, salidas:data.length, total, promedio:data.length ? total/data.length : 0 };
  });
}

function resumenColaboradores(eventos) {
  const mapa = new Map();
  eventos.forEach(x => {
    if (!mapa.has(x.dni)) mapa.set(x.dni,{dni:x.dni,nombre:`${x.nombre || ""} ${x.apellidos || ""}`.trim(),grupo:x.grupo,turno:x.turno,cargo:x.cargo,total:0,frecuencia:0,banos:0,breaks:0,excesos:0});
    const p=mapa.get(x.dni); p.total+=x.duracionMin; p.frecuencia+=1; if(x.motivo==="BANO")p.banos+=1;if(x.motivo==="BREAK")p.breaks+=1;if(estadoMotivo(x.motivo,x.duracionMin).key==="red")p.excesos+=1;
  });
  return Array.from(mapa.values()).sort((a,b)=>b.total-a.total||b.frecuencia-a.frecuencia);
}

function detalleEvento(row) {
  const minutos = row.abierto ? minutosEntre(row.salida) : row.duracionMin;
  const estado = estadoMotivo(row.motivo, minutos);
  return { ...row, minutos, estado:row.abierto ? `ABIERTA / ${estado.label}` : estado.label, limite:estado.limite, exceso:estado.limite === null ? null : Math.max(0,minutos-estado.limite) };
}

function filaDetalle(row) {
  const color = estadoMotivo(row.motivo,row.minutos).key;
  return `<tr><td>${html(fechaHora(row.salida))}</td><td>${html(row.dni)}</td><td><strong>${html(`${row.nombre || ""} ${row.apellidos || ""}`.trim())}</strong></td><td>${html(row.grupo === "MULTIFORMATO" ? "MULTIFORMATO" : "OSLO + CD")}</td><td>${html(row.turno)}</td><td>${html(row.cargo || row.area)}</td><td>${html(row.motivo)}</td><td>${html(fechaHora(row.salida))}</td><td>${html(row.retorno ? fechaHora(row.retorno) : "PENDIENTE")}</td><td class="number">${html(duracion(row.minutos))}</td><td class="number">${row.limite === null ? "MANUAL" : `${fmt(row.limite)} min`}</td><td class="number">${row.exceso === null ? "-" : `${fmt(row.exceso)} min`}</td><td><span class="status ${color}">${html(row.estado)}</span></td></tr>`;
}

function descargarExcel(nombre, headers, rows) {
  const contenido = `<meta charset="UTF-8"><style>td{mso-number-format:"\\@";}th{background:#273248;color:#fff;font-weight:bold}</style><table border="1"><thead><tr>${headers.map(x=>`<th>${html(x)}</th>`).join("")}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(value=>`<td>${html(value)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  const blob = new Blob([contenido],{type:"application/vnd.ms-excel"});
  const enlace = document.createElement("a");
  enlace.href = URL.createObjectURL(blob); enlace.download = `${nombre}.xls`; enlace.click();
  setTimeout(()=>URL.revokeObjectURL(enlace.href),1000);
}

function exportarDetalleAusencias() {
  descargarExcel("detalle_ausencias_filtrado",["Fecha","DNI","Colaborador","Operacion","Turno","Cargo","Motivo","Salida","Retorno","Duracion min","Limite min","Exceso min","Estado"],detalleExportable.map(row=>[fechaCorta(row.salida),row.dni,`${row.nombre || ""} ${row.apellidos || ""}`.trim(),row.grupo === "MULTIFORMATO" ? "MULTIFORMATO" : "OSLO + CD",row.turno,row.cargo || row.area,row.motivo,fechaHora(row.salida),row.retorno ? fechaHora(row.retorno) : "PENDIENTE",Math.round(row.minutos*100)/100,row.limite === null ? "MANUAL" : row.limite,row.exceso === null ? "-" : Math.round(row.exceso*100)/100,row.estado]));
}

function exportarResumenAusencias() {
  descargarExcel("resumen_ausencias_por_persona",["DNI","Colaborador","Operacion","Turno","Cargo","Salidas","Banos","Breaks","Tiempo total min","Excesos"],resumenExportable.map(row=>[row.dni,row.nombre,row.grupo === "MULTIFORMATO" ? "MULTIFORMATO" : "OSLO + CD",row.turno,row.cargo,row.frecuencia,row.banos,row.breaks,Math.round(row.total*100)/100,row.excesos]));
}

function renderDashboard() {
  const filtros = filtrosActuales();
  const eventos = agruparEventos(respuesta.marcaciones || []).filter(x => coincide(x, filtros));
  const abiertos = (respuesta.abiertos || []).filter(x => coincide(x, filtros));
  const cerrados = eventos.filter(x => !x.abierto);
  const totalMin = cerrados.reduce((a,b)=>a+b.duracionMin,0);
  const excesos = cerrados.filter(x=>estadoMotivo(x.motivo,x.duracionMin).key==="red").length;
  const motivos = resumenMotivos(cerrados);
  const colaboradores = resumenColaboradores(cerrados);
  detalleExportable = eventos.map(detalleEvento).sort((a,b)=>new Date(b.salida)-new Date(a.salida));
  resumenExportable = colaboradores;
  document.getElementById("fueraAhora").textContent = fmt(abiertos.length);

  const maxMotivo=Math.max(...motivos.map(x=>x.salidas),1);
  const diasMap=new Map(); cerrados.forEach(x=>{const key=fechaCorta(x.salida);diasMap.set(key,(diasMap.get(key)||0)+1)});
  const dias=Array.from(diasMap.entries()).slice(-14); const maxDia=Math.max(...dias.map(x=>x[1]),1);
  const turnos=["DIA","TARDE","NOCHE"].map(turno=>{const d=cerrados.filter(x=>x.turno===turno);return{turno,salidas:d.length,total:d.reduce((a,b)=>a+b.duracionMin,0)}});

  document.getElementById("contenido").innerHTML = `
    <section class="kpi-grid">
      <article class="kpi red"><span>Personal fuera</span><strong>${fmt(abiertos.length)}</strong><small>Actualizacion en tiempo real</small></article>
      <article class="kpi"><span>Total de salidas</span><strong>${fmt(eventos.length)}</strong><small>Periodo seleccionado</small></article>
      <article class="kpi green"><span>Tiempo total fuera</span><strong>${html(duracion(totalMin))}</strong><small>Eventos cerrados</small></article>
      <article class="kpi amber"><span>Excesos</span><strong>${fmt(excesos)}</strong><small>Superaron el limite</small></article>
    </section>
    <section class="section-grid">
      <article class="card"><div class="section-head"><h2>Personal actualmente fuera</h2><span>${fmt(abiertos.length)} personas</span></div>${tabla(["Personal","Operacion","Turno","Cargo / Area","Motivo","Salida","Transcurrido","Estado"],abiertos.map(filaActiva),"live-table")}</article>
      <article class="card"><div class="section-head"><h2>Promedio por motivo</h2><span>Eventos cerrados</span></div><div class="reason-list">${motivos.map(x=>`<div class="reason-row"><strong>${x.motivo}</strong><div class="bar"><i style="width:${(x.salidas/maxMotivo)*100}%"></i></div><span>${fmt(x.promedio)} min</span></div>`).join("")}</div></article>
    </section>
    <section class="analytics-grid">
      <article class="card"><div class="section-head"><h2>Tendencia de salidas</h2><span>Por fecha</span></div><div class="trend">${dias.map(([fecha,n])=>`<div class="trend-item"><strong>${n}</strong><div class="trend-bar"><i style="height:${(n/maxDia)*100}%"></i></div><small>${html(fecha.slice(0,5))}</small></div>`).join("")||`<div class="empty">Sin eventos cerrados.</div>`}</div></article>
      <article class="card"><div class="section-head"><h2>Comparativo por turno</h2><span>Frecuencia y tiempo</span></div><div class="shift-grid">${turnos.map(x=>`<div class="shift-card"><span>${x.turno}</span><strong>${fmt(x.salidas)}</strong><small>${html(duracion(x.total))} fuera</small></div>`).join("")}</div></article>
    </section>
    <section class="card" style="margin-top:13px"><div class="section-head"><h2>Detalle de salidas y retornos</h2><button onclick="exportarDetalleAusencias()">Excel detalle</button></div>${tabla(["Fecha y hora","DNI","Colaborador","Operacion","Turno","Cargo","Motivo","Salida","Retorno","Duracion","Limite","Exceso","Estado"],detalleExportable.map(filaDetalle),"collab-table")}</section>
    <section class="card" style="margin-top:13px"><div class="section-head"><h2>Resumen por colaborador</h2><button onclick="exportarResumenAusencias()">Excel resumen</button></div>${tabla(["#","DNI","Colaborador","Turno","Cargo","Banos","Breaks","Salidas","Tiempo total","Excesos"],colaboradores.map((x,i)=>`<tr><td><strong>${i+1}</strong></td><td>${html(x.dni)}</td><td><strong>${html(x.nombre)}</strong></td><td>${html(x.turno)}</td><td>${html(x.cargo)}</td><td>${fmt(x.banos)}</td><td>${fmt(x.breaks)}</td><td>${fmt(x.frecuencia)}</td><td class="number">${html(duracion(x.total))}</td><td class="number">${fmt(x.excesos)}</td></tr>`),"collab-table")}</section>`;
  actualizarRelojesActivos();
}

function actualizarRelojesActivos() {
  document.querySelectorAll("tr[data-salida]").forEach(row=>{
    const min=minutosEntre(row.dataset.salida);const estado=estadoMotivo(row.dataset.motivo,min);const tiempo=row.querySelector(".live-elapsed");const badge=row.querySelector(".live-status");if(tiempo)tiempo.textContent=duracion(min);if(badge){badge.textContent=estado.label;badge.className=`status ${estado.key} live-status`;}
  });
}

function guardarCachePersonal(personal, fechaRoster, abiertos) {
  let anterior = {};
  try { anterior = JSON.parse(localStorage.getItem(config.PERSONAL_CACHE_KEY) || "null") || {}; } catch {}
  const previos = new Map((anterior.personal || []).map(persona => [String(persona.dni), persona]));
  const combinado = (personal || []).map(persona => {
    const previo = previos.get(String(persona.dni));
    if (!previo || !persona.turnoProvisional) return persona;
    return { ...persona, turno: previo.turno || persona.turno, turnoProvisional: previo.turnoProvisional !== false };
  });
  localStorage.setItem(config.PERSONAL_CACHE_KEY, JSON.stringify({ fechaRoster, personal:combinado, abiertos:abiertos || [], guardado:new Date().toISOString() }));
}

function guardarCacheDashboard(data) {
  try {
    localStorage.setItem(config.DASHBOARD_CACHE_KEY, JSON.stringify({ ...data, guardado:new Date().toISOString() }));
  } catch {}
}

function leerCacheDashboard() {
  try {
    const data = JSON.parse(localStorage.getItem(config.DASHBOARD_CACHE_KEY) || "null");
    return data?.marcaciones ? data : null;
  } catch {
    return null;
  }
}

function firmaAbiertos(items) {
  return (items || []).map(item => `${item.idEvento || ""}:${item.dni || ""}:${item.motivo || ""}`).sort().join("|");
}

async function cargarDashboard(manual=false) {
  if (!AusenciasApi.apiUrl()) { document.getElementById("contenido").innerHTML=`<div class="notice">Configura la URL de Google Apps Script para comenzar.</div>`; return; }
  if (manual) localStorage.removeItem(config.PERSONAL_CACHE_KEY);
  document.getElementById("estadoCarga").textContent=manual?"Actualizando...":"Conectando...";
  try { respuesta=await AusenciasApi.get("dashboard",{dias:document.getElementById("filtroPeriodo").value,refresh:manual?1:""});if(respuesta.personal?.length)guardarCachePersonal(respuesta.personal,respuesta.fechaRoster,respuesta.abiertos);guardarCacheDashboard(respuesta);document.getElementById("estadoCarga").textContent=`${respuesta.fechaRoster||"Sin fecha"} | ${respuesta.actualizado||"Actualizado"}`;renderDashboard(); }
  catch(error){document.getElementById("estadoCarga").textContent="Error de conexion";document.getElementById("contenido").innerHTML=`<div class="notice">${html(error.message)}</div>`;}
}

async function cargarAbiertosRapido() {
  if (!respuesta.marcaciones?.length) return;
  try {
    const data = await AusenciasApi.get("abiertos");
    if (firmaAbiertos(data.abiertos) === firmaAbiertos(respuesta.abiertos)) return;
    respuesta = { ...respuesta, abiertos:data.abiertos || [], actualizado:data.actualizado || respuesta.actualizado };
    guardarCacheDashboard(respuesta);
    document.getElementById("estadoCarga").textContent=`${respuesta.fechaRoster||data.fechaRoster||"Sin fecha"} | ${data.actualizado||"Actualizado"}`;
    renderDashboard();
  } catch {}
}

function login(event){event.preventDefault();const u=limpiar(document.getElementById("usuario").value),p=limpiar(document.getElementById("password").value);if(u!==config.ADMIN_USER||p!==config.ADMIN_PASSWORD){document.getElementById("loginError").textContent="Credenciales incorrectas.";return;}sessionStorage.setItem(config.ADMIN_SESSION_KEY,"1");mostrarAdmin();}
function logout(){sessionStorage.removeItem(config.ADMIN_SESSION_KEY);clearInterval(timerCarga);clearInterval(timerReloj);clearInterval(timerAbiertos);document.getElementById("adminView").hidden=true;document.getElementById("loginView").hidden=false;document.getElementById("password").value="";}
function mostrarAdmin(){document.getElementById("loginView").hidden=true;document.getElementById("adminView").hidden=false;const cache=leerCacheDashboard();if(cache){respuesta=cache;document.getElementById("estadoCarga").textContent=`${cache.fechaRoster||"Cache local"} | Cargando actualizacion...`;renderDashboard();}cargarDashboard();clearInterval(timerCarga);clearInterval(timerReloj);clearInterval(timerAbiertos);timerCarga=setInterval(()=>cargarDashboard(false),config.POLL_MS);timerAbiertos=setInterval(cargarAbiertosRapido,config.ABIERTOS_POLL_MS||10000);timerReloj=setInterval(actualizarRelojesActivos,1000);}
if(sessionStorage.getItem(config.ADMIN_SESSION_KEY)==="1")mostrarAdmin();
