const fs = require("fs");
const vm = require("vm");

const context = vm.createContext({
  console,
  Date,
  Intl,
  window: { AUSENCIAS_CONFIG: { LIMITES: { BANO: 10, BREAK: 60, AGUA: 5, OTRO: null }, ADMIN_SESSION_KEY: "test", ADMIN_USER: "admin", ADMIN_PASSWORD: "1234", POLL_MS: 15000 } },
  document: { getElementById: () => null, querySelectorAll: () => [] },
  sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  setInterval: () => 0,
  clearInterval: () => {},
  prompt: () => null
});

vm.runInContext(fs.readFileSync("admin/js/app.js", "utf8"), context);

const states = vm.runInContext(`[
  estadoMotivo("BANO", 7).key,
  estadoMotivo("BANO", 8).key,
  estadoMotivo("BANO", 10).key,
  estadoMotivo("BANO", 10.01).key,
  estadoMotivo("OTRO", 100).label
]`, context);
if (JSON.stringify(states) !== JSON.stringify(["green","amber","amber","red","MANUAL"])) throw new Error(`Semaforos incorrectos: ${states}`);

const events = vm.runInContext(`agruparEventos([
  {idEvento:"E1",dni:"1",evento:"SALIDA",motivo:"AGUA",fechaHora:"2026-06-21T10:00:00-05:00"},
  {idEvento:"E1",dni:"1",evento:"RETORNO",motivo:"AGUA",fechaHora:"2026-06-21T10:05:00-05:00",duracionMin:5},
  {idEvento:"E2",dni:"2",evento:"SALIDA",motivo:"BREAK",fechaHora:new Date().toISOString()}
])`, context);
if (events.length !== 2 || events[0].abierto || !events[1].abierto || events[0].duracionMin !== 5) throw new Error("Emparejamiento SALIDA/RETORNO incorrecto.");

console.log("SMOKE_OK semaforos y eventos");
