// Sucursales / sedes (cadenas con varios locales).
// cliente.json → "sucursales": [{ "id": "beiro", "nombre": "Devoto", "direccion": "Av. Beiró 3425",
//   "whatsapp": "549…", "horarios": { "mar": [["12:00","02:00"]] }, "mapa": "https://maps…" }]
// Con 2 o más, el checkout pide en qué sede se retira (o desde cuál se envía), el pedido la guarda,
// el WhatsApp sale al número de esa sede (si tiene) y el panel filtra por sede.
export const sucursales = (config) => (Array.isArray(config?.sucursales) ? config.sucursales : []).filter(s => s && s.id);
export const sucursalPorId = (config, id) => sucursales(config).find(s => s.id === id) || null;
export const pideSucursal = (config) => sucursales(config).length > 1;
// Resumen que se guarda en el pedido (no depende de que la sede siga en cliente.json).
export const resumenSucursal = (s) => s ? { id: s.id, nombre: s.nombre || s.id, direccion: s.direccion || '' } : null;
