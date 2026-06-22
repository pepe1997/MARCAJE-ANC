const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const port = Number(process.env.PORT || 8090);
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8" };

http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  let target = path.join(root, pathname === "/" ? "index.html" : pathname);
  if (!target.startsWith(root)) return res.writeHead(403).end("Forbidden");
  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) target = path.join(target, "index.html");
  fs.readFile(target, (error, data) => {
    if (error) return res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("No encontrado");
    res.writeHead(200, { "Content-Type": mime[path.extname(target)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(data);
  });
}).listen(port, "127.0.0.1", () => console.log(`Control de ausencias: http://127.0.0.1:${port}`));
