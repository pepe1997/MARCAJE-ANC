const CONFIG = {
  SPREADSHEET_PERSONAL_ID: "1til7_imoyx7_lqi5pEjDYxhRqL4z-8rfCZqtz_9Fyqs",
  SPREADSHEET_EVENTOS_ID: "1yKa-fG1tYp7Bzmzk57O9ActGc3ijVzBUvDl59IIUHSA",
  HOJA_PERSONAL: "REPORTE",
  HOJA_MARCACION: "MARCACION",
  HOJA_ABIERTOS: "EVENTOS_ABIERTOS",
  TIMEZONE: "America/Lima",
  CLIENTES: ["OSLO TRUJILLO", "CD OSLO TRUJILLO", "MULTIFORMATO TRUJILLO"],
  MOTIVOS: ["BANO", "BREAK", "AGUA", "OTRO"]
};

const HEADERS_MARCACION = ["ID_EVENTO","FECHA","HORA","FECHA_HORA","DNI","NOMBRE","APELLIDOS","TURNO","AREA","CARGO","CLIENTE","EVENTO","MOTIVO","DETALLE","DURACION_MIN","GRUPO"];
const HEADERS_ABIERTOS = ["ID_EVENTO","FECHA_HORA_SALIDA","DNI","NOMBRE","APELLIDOS","TURNO","AREA","CARGO","CLIENTE","MOTIVO","DETALLE","GRUPO"];

function doGet(e) {
  try {
    asegurarSistema_();
    const action = normalizar_(e && e.parameter && e.parameter.action || "health");
    if (action === "HEALTH") return json_({ ok:true, mensaje:"API operativa", actualizado:ahoraTexto_() });
    if (action === "PERSONA") return json_(consultarPersona_(e.parameter.dni));
    if (action === "BOOTSTRAP") return json_(bootstrap_(e.parameter.refresh === "1"));
    if (action === "ABIERTOS") return json_(abiertos_());
    if (action === "DASHBOARD") return json_(dashboard_(Number(e.parameter.dias || 1), e.parameter.refresh === "1"));
    return json_({ ok:false, mensaje:"Accion GET no reconocida." });
  } catch (error) {
    return json_({ ok:false, mensaje:error.message || String(error) });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    asegurarSistema_();
    const body = JSON.parse(e && e.postData && e.postData.contents || "{}");
    const action = normalizar_(body.action);
    if (action === "SALIDA") return json_(registrarSalida_(body));
    if (action === "RETORNO") return json_(registrarRetorno_(body));
    return json_({ ok:false, mensaje:"Accion POST no reconocida." });
  } catch (error) {
    return json_({ ok:false, mensaje:error.message || String(error) });
  } finally {
    try { lock.releaseLock(); } catch (error) {}
  }
}

function configurarSistema() {
  asegurarSistema_();
  CacheService.getScriptCache().remove("personal_dia_v2");
  return "Sistema configurado correctamente.";
}

function probarConexionPersonal() {
  const personal = obtenerPersonalDia_(true);
  return `Conexion correcta: ${personal.personas.length} colaboradores validos del ${personal.fechaTexto}.`;
}

function asegurarSistema_() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_EVENTOS_ID);
  ss.setSpreadsheetTimeZone(CONFIG.TIMEZONE);
  asegurarHoja_(ss, CONFIG.HOJA_MARCACION, HEADERS_MARCACION, false);
  asegurarHoja_(ss, CONFIG.HOJA_ABIERTOS, HEADERS_ABIERTOS, true);
}

function asegurarHoja_(ss, nombre, headers, ocultar) {
  let sheet = ss.getSheetByName(nombre);
  if (!sheet) sheet = ss.insertSheet(nombre);
  const actuales = sheet.getLastColumn() ? sheet.getRange(1,1,1,Math.max(sheet.getLastColumn(),headers.length)).getDisplayValues()[0] : [];
  if (headers.some((header,index) => actuales[index] !== header)) {
    sheet.getRange(1,1,1,headers.length).setValues([headers]);
    sheet.getRange(1,1,1,headers.length).setBackground("#172033").setFontColor("#ffffff").setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  if (ocultar && !sheet.isSheetHidden()) sheet.hideSheet();
  return sheet;
}

function consultarPersona_(dniRaw) {
  const dni = soloDigitos_(dniRaw);
  if (!dni) throw new Error("Ingresa un DNI valido.");
  const personal = obtenerPersonalDia_();
  const persona = personal.personas.find(item => item.dni === dni);
  if (!persona) throw new Error(`El DNI ${dni} no existe en el personal del ${personal.fechaTexto}.`);
  return { ok:true, persona:persona, abierto:buscarAbierto_(dni), fechaRoster:personal.fechaTexto };
}

function registrarSalida_(body) {
  const consulta = consultarPersona_(body.dni);
  if (consulta.abierto) throw new Error("Ya tienes una salida activa. Primero registra tu retorno.");
  const motivo = normalizarMotivo_(body.motivo);
  if (CONFIG.MOTIVOS.indexOf(motivo) === -1) throw new Error("Selecciona un motivo valido.");
  const detalle = limpiar_(body.detalle);
  if (motivo === "OTRO" && !detalle) throw new Error("Describe el motivo de la salida.");

  const persona = consulta.persona;
  const ahora = new Date();
  const id = `EVT-${Utilities.formatDate(ahora,CONFIG.TIMEZONE,"yyyyMMdd-HHmmss")}-${persona.dni}-${Utilities.getUuid().slice(0,8)}`;
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_EVENTOS_ID);
  ss.getSheetByName(CONFIG.HOJA_MARCACION).appendRow([
    id, fechaTexto_(ahora), horaTexto_(ahora), ahora, persona.dni, persona.nombre, persona.apellidos,
    persona.turno, persona.area, persona.cargo, persona.cliente, "SALIDA", motivo, detalle, "", persona.grupo
  ]);
  ss.getSheetByName(CONFIG.HOJA_ABIERTOS).appendRow([
    id, ahora, persona.dni, persona.nombre, persona.apellidos, persona.turno, persona.area,
    persona.cargo, persona.cliente, motivo, detalle, persona.grupo
  ]);
  SpreadsheetApp.flush();
  return { ok:true, idEvento:id, evento:"SALIDA", motivo:motivo, hora:horaTexto_(ahora) };
}

function registrarRetorno_(body) {
  const dni = soloDigitos_(body.dni);
  if (!dni) throw new Error("DNI invalido.");
  const abierto = buscarAbiertoConFila_(dni);
  if (!abierto) throw new Error("No existe una salida activa para este DNI.");
  const ahora = new Date();
  const duracionMin = Math.max(0, Math.round(((ahora.getTime() - abierto.fecha.getTime()) / 60000) * 100) / 100);
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_EVENTOS_ID);
  ss.getSheetByName(CONFIG.HOJA_MARCACION).appendRow([
    abierto.idEvento, fechaTexto_(ahora), horaTexto_(ahora), ahora, abierto.dni, abierto.nombre, abierto.apellidos,
    abierto.turno, abierto.area, abierto.cargo, abierto.cliente, "RETORNO", abierto.motivo, abierto.detalle, duracionMin, abierto.grupo
  ]);
  ss.getSheetByName(CONFIG.HOJA_ABIERTOS).deleteRow(abierto.fila);
  SpreadsheetApp.flush();
  return { ok:true, idEvento:abierto.idEvento, evento:"RETORNO", motivo:abierto.motivo, hora:horaTexto_(ahora), duracionMin:duracionMin };
}

function dashboard_(diasRaw, refresh) {
  const dias = Math.max(1, Math.min(Number(diasRaw) || 1, 3650));
  const personal = obtenerPersonalDia_(refresh);
  const desde = new Date();
  desde.setHours(0,0,0,0);
  desde.setDate(desde.getDate() - (dias - 1));
  const marcaciones = leerObjetos_(CONFIG.HOJA_MARCACION).filter(row => {
    const fecha = fechaCelda_(row.FECHA_HORA) || parseFechaTexto_(row.FECHA);
    return fecha && fecha >= desde;
  }).map(marcacionApi_);
  const personalPorDni = {};
  personal.personas.forEach(persona => personalPorDni[persona.dni] = persona);
  marcaciones.forEach(item => {
    const persona = personalPorDni[item.dni];
    if (persona && !persona.turnoProvisional && item.fecha === personal.fechaTexto) item.turno = persona.turno;
  });
  const abiertos = leerAbiertos_().map(abiertoApi_).map(item => {
    const persona = personalPorDni[item.dni];
    return persona && !persona.turnoProvisional ? Object.assign(item, { turno:persona.turno }) : item;
  });
  return {
    ok:true,
    fechaRoster:personal.fechaTexto,
    totalPersonal:personal.personas.length,
    personal:personal.personas,
    abiertos:abiertos,
    marcaciones:marcaciones,
    actualizado:ahoraTexto_()
  };
}

function bootstrap_(refresh) {
  const personal = obtenerPersonalDia_(refresh);
  return { ok:true, fechaRoster:personal.fechaTexto, personal:personal.personas, abiertos:leerAbiertos_().map(abiertoApi_), actualizado:ahoraTexto_() };
}

function abiertos_() {
  const personal = obtenerPersonalDia_();
  return { ok:true, fechaRoster:personal.fechaTexto, abiertos:leerAbiertos_().map(abiertoApi_), actualizado:ahoraTexto_() };
}

function obtenerPersonalDia_(refresh) {
  const cache = CacheService.getScriptCache();
  if (refresh) cache.remove("personal_dia_v2");
  const cacheado = cache.get("personal_dia_v2");
  if (cacheado) return JSON.parse(cacheado);
  const rows = leerObjetos_(CONFIG.HOJA_PERSONAL).filter(row => {
    const cliente = normalizar_(campo_(row,"CLIENTE"));
    const estado = normalizar_(campo_(row,"ESTADO") || "ACTIVO");
    return CONFIG.CLIENTES.indexOf(cliente) !== -1 && estado === "ACTIVO" && soloDigitos_(campo_(row,"DNI"));
  });
  if (!rows.length) throw new Error("No hay personal valido en la hoja REPORTE.");
  const fechas = rows.map(row => fechaReporte_(campo_(row,"FECHA"))).filter(Boolean);
  const ultima = new Date(Math.max.apply(null, fechas.map(f => f.getTime())));
  const fechaKey = Utilities.formatDate(ultima,CONFIG.TIMEZONE,"yyyyMMdd");
  const mapa = {};
  rows.filter(row => {
    const fecha = fechaReporte_(campo_(row,"FECHA"));
    return fecha && Utilities.formatDate(fecha,CONFIG.TIMEZONE,"yyyyMMdd") === fechaKey;
  }).forEach(row => {
    const dni = soloDigitos_(campo_(row,"DNI"));
    const nombre = limpiar_(campo_(row,"NOMBRE"));
    const apellidos = limpiar_(campo_(row,"APELLIDOS"));
    const cliente = limpiar_(campo_(row,"CLIENTE"));
    const area = limpiar_(campo_(row,"AREA")) || cliente;
    const candidato = {
      dni:dni,
      nombre:nombre,
      apellidos:apellidos,
      nombreCompleto:`${nombre} ${apellidos}`.trim(),
      turno:resolverTurno_(row),
      area:area,
      cargo:limpiar_(campo_(row,"CARGO")) || "SIN CARGO",
      cliente:cliente,
      grupo:normalizar_(cliente) === "MULTIFORMATO TRUJILLO" ? "MULTIFORMATO" : "PRINCIPAL",
      turnoProvisional:!tieneEntradaMarcada_(row),
      fecha:fechaTexto_(ultima)
    };
    if (!mapa[dni] || (mapa[dni].turnoProvisional && !candidato.turnoProvisional)) mapa[dni] = candidato;
  });
  const resultado = { fechaTexto:fechaTexto_(ultima), personas:Object.keys(mapa).map(key => mapa[key]) };
  cache.put("personal_dia_v2", JSON.stringify(resultado), 21600);
  return resultado;
}

function tieneEntradaMarcada_(row) {
  const hora = campo_(row,"HORA ENTRADA");
  if (hora instanceof Date && !isNaN(hora.getTime())) return true;
  return limpiar_(hora) !== "";
}

function resolverTurno_(row) {
  const original = normalizar_(campo_(row,"TURNO AUTOMATICO"));
  if (["DIA","TARDE","NOCHE"].indexOf(original) !== -1) return original;
  const hora = limpiar_(campo_(row,"HORA ENTRADA"));
  if (!hora) return "SIN TURNO";
  const partes = hora.split(":").map(Number);
  if (!isFinite(partes[0])) return "SIN TURNO";
  const minutos = partes[0] * 60 + (partes[1] || 0);
  const opciones = [{turno:"DIA",inicio:420},{turno:"TARDE",inicio:720},{turno:"NOCHE",inicio:1260}];
  opciones.forEach(item => { let diff=Math.abs(minutos-item.inicio);item.diff=Math.min(diff,1440-diff); });
  opciones.sort((a,b)=>a.diff-b.diff);
  return opciones[0].turno;
}

function buscarAbierto_(dni) {
  const encontrado = leerAbiertos_().find(row => row.dni === dni);
  return encontrado ? abiertoApi_(encontrado) : null;
}

function buscarAbiertoConFila_(dni) {
  return leerAbiertos_().find(row => row.dni === dni) || null;
}

function leerAbiertos_() {
  const sheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_EVENTOS_ID).getSheetByName(CONFIG.HOJA_ABIERTOS);
  if (!sheet || sheet.getLastRow() < 2) return [];
  return sheet.getRange(2,1,sheet.getLastRow()-1,HEADERS_ABIERTOS.length).getValues().map((row,index) => ({
    fila:index+2,idEvento:limpiar_(row[0]),fecha:fechaCelda_(row[1]),dni:soloDigitos_(row[2]),nombre:limpiar_(row[3]),apellidos:limpiar_(row[4]),turno:normalizar_(row[5])||"SIN TURNO",area:limpiar_(row[6]),cargo:limpiar_(row[7]),cliente:limpiar_(row[8]),motivo:normalizarMotivo_(row[9]),detalle:limpiar_(row[10]),grupo:normalizar_(row[11])||"PRINCIPAL"
  })).filter(row => row.idEvento && row.dni && row.fecha);
}

function leerObjetos_(nombre) {
  const spreadsheetId = nombre === CONFIG.HOJA_PERSONAL ? CONFIG.SPREADSHEET_PERSONAL_ID : CONFIG.SPREADSHEET_EVENTOS_ID;
  const sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName(nombre);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const values = sheet.getDataRange().getValues();
  const headers = values.shift().map(limpiar_);
  return values.map(row => {
    const item = {};
    headers.forEach((header,index) => item[header] = row[index]);
    return item;
  });
}

function marcacionApi_(row) {
  return {
    idEvento:limpiar_(row.ID_EVENTO),fecha:limpiar_(row.FECHA),hora:limpiar_(row.HORA),fechaHora:fechaIso_(row.FECHA_HORA),dni:soloDigitos_(row.DNI),nombre:limpiar_(row.NOMBRE),apellidos:limpiar_(row.APELLIDOS),turno:normalizar_(row.TURNO)||"SIN TURNO",area:limpiar_(row.AREA),cargo:limpiar_(row.CARGO),cliente:limpiar_(row.CLIENTE),grupo:normalizar_(row.GRUPO)||"PRINCIPAL",evento:normalizar_(row.EVENTO),motivo:normalizarMotivo_(row.MOTIVO),detalle:limpiar_(row.DETALLE),duracionMin:Number(row.DURACION_MIN||0)
  };
}

function abiertoApi_(row) {
  return {
    idEvento:row.idEvento,fechaHoraSalida:fechaIso_(row.fecha),horaSalida:horaTexto_(row.fecha),dni:row.dni,nombre:row.nombre,apellidos:row.apellidos,nombreCompleto:`${row.nombre} ${row.apellidos}`.trim(),turno:row.turno,area:row.area,cargo:row.cargo,cliente:row.cliente,grupo:row.grupo||"PRINCIPAL",motivo:row.motivo,detalle:row.detalle,transcurridoMin:Math.max(0,(new Date().getTime()-row.fecha.getTime())/60000)
  };
}

function normalizarMotivo_(value) {
  const motivo = normalizar_(value);
  return motivo === "BANO" || motivo === "BAÑO" ? "BANO" : motivo;
}
function campo_(row,nombre) {
  const buscado = normalizar_(nombre);
  const key = Object.keys(row || {}).find(item => normalizar_(item) === buscado);
  return key === undefined ? "" : row[key];
}
function normalizar_(value) { return limpiar_(value).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase(); }
function limpiar_(value) { return value === null || value === undefined ? "" : String(value).trim(); }
function soloDigitos_(value) { return limpiar_(value).replace(/\D/g,""); }
function fechaTexto_(date) { return Utilities.formatDate(date,CONFIG.TIMEZONE,"dd/MM/yyyy"); }
function horaTexto_(date) { return Utilities.formatDate(date,CONFIG.TIMEZONE,"HH:mm:ss"); }
function ahoraTexto_() { return `${fechaTexto_(new Date())} ${horaTexto_(new Date())}`; }
function fechaIso_(value) { const date=fechaCelda_(value); return date ? Utilities.formatDate(date,CONFIG.TIMEZONE,"yyyy-MM-dd'T'HH:mm:ss'-05:00'") : ""; }
function fechaCelda_(value) { if (value instanceof Date && !isNaN(value.getTime())) return value; const date=new Date(value); return isNaN(date.getTime()) ? null : date; }
function fechaReporte_(value) { return value instanceof Date && !isNaN(value.getTime()) ? value : parseFechaTexto_(value); }
function parseFechaTexto_(value) { const text=limpiar_(value); const p=text.split(/[\/-]/).map(Number); if(p.length!==3||!p[0]||!p[1]||!p[2])return null; return new Date(p[2],p[1]-1,p[0],0,0,0); }
function json_(data) { return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON); }
