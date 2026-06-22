# Sistema de Control de Ausencias Operativas

El sistema utiliza dos Google Sheets:

- Personal diario (`REPORTE`): `1til7_imoyx7_lqi5pEjDYxhRqL4z-8rfCZqtz_9Fyqs`
- Historial permanente (`MARCACION` y `EVENTOS_ABIERTOS`): `1yKa-fG1tYp7Bzmzk57O9ActGc3ijVzBUvDl59IIUHSA`

## Estructura

- `marcacion/`: pantalla rapida para registrar salida y retorno.
- `admin/`: dashboard, alertas y reportes.
- `apps-script/Code.gs`: API que escribe en Google Sheets.
- `shared/`: configuracion y cliente de la API.

## Preparar Google Apps Script

1. Abre el Google Sheet del historial permanente.
2. Ve a `Extensiones > Apps Script`.
3. Reemplaza el contenido de `Code.gs` con el archivo `apps-script/Code.gs` de este proyecto.
4. Ejecuta manualmente `configurarSistema` una vez y acepta los permisos.
5. Pulsa `Implementar > Nueva implementacion`.
6. Selecciona `Aplicacion web`.
7. Ejecutar como: `Yo`.
8. Quien tiene acceso: usuarios autorizados por tu politica o cualquier persona con el enlace para el marcador interno.
9. Copia la URL terminada en `/exec`.
10. Abre Marcacion o Admin, pulsa `Configurar conexion` y pega la URL.

La API crea automaticamente los encabezados de `MARCACION` y una hoja oculta `EVENTOS_ABIERTOS`.

## Iniciar localmente

```powershell
node server.js
```

Luego abre:

- Marcacion: `http://127.0.0.1:8090/marcacion/index.html`
- Admin: `http://127.0.0.1:8090/admin/index.html`

Credenciales iniciales de Admin:

- Usuario: `admin`
- Clave: `1234`

Cambialas en `shared/config.js` antes de publicar.

## Reglas

- La marcacion admite `OSLO TRUJILLO`, `CD OSLO TRUJILLO` y `MULTIFORMATO TRUJILLO`.
- El dashboard evalua juntos a Oslo y CD Oslo bajo `Oslo + CD Oslo`.
- `MULTIFORMATO TRUJILLO` se evalua por separado mediante el filtro de operacion.

- BANO: 10 minutos.
- BREAK: 60 minutos.
- AGUA: 5 minutos.
- OTRO: evaluacion manual.
- Verde: menor al 80% del limite.
- Amarillo: desde el 80% hasta el limite.
- Rojo: mayor al limite.
- Un DNI solo puede tener un evento abierto.
