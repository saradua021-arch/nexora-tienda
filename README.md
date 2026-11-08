# NEXORA Tech · Tienda con Node.js + PostgreSQL

Sitio de ventas con catálogo, cotizaciones, pedidos y panel de administración.
La pasarela de pago es una **simulación**: el servidor nunca recibe datos de tarjeta.

## 1. Requisitos
- Node.js 18 o superior
- Una base de datos PostgreSQL (local o en la nube: Neon, Supabase, Render, Railway…)

## 2. Instalación
```bash
npm install
cp .env.example .env      # edita DATABASE_URL y ADMIN_TOKEN
npm run init-db           # crea las tablas y carga los 10 productos
npm start                 # http://localhost:3000
```

- Tienda: `http://localhost:3000`
- Panel: `http://localhost:3000/admin.html` (usa la clave `ADMIN_TOKEN`)

## 3. Qué guarda la base de datos
| Tabla | Contenido |
|---|---|
| `products` | Catálogo: nombre, categoría, precio, precio anterior, stock, imagen, activo |
| `orders` / `order_items` | Pedidos de la pasarela con copia del precio al momento de comprar |
| `quotes` / `quote_items` | Solicitudes de cotización con descuento por volumen |

## 4. API
Pública: `GET /api/products`, `POST /api/orders`, `POST /api/quotes`.
Admin (cabecera `x-admin-token`): productos (CRUD), pedidos y cotizaciones (listar y cambiar estado).

El servidor recalcula siempre precios, descuentos, envío y stock con los datos de la base:
lo que envía el navegador solo indica *qué* productos y *cuántas* unidades.

## 5. Publicar en tu dominio
1. Sube el proyecto a tu servidor o a un servicio como Render o Railway.
2. Define las variables de `.env` en el panel del servicio y pon `NODE_ENV=production`.
3. Usa **HTTPS** (certificado gratuito de Let's Encrypt o el que ofrezca el servicio).
4. Ejecuta `npm run init-db` una sola vez contra la base de producción.
5. Si usas Nginx, apunta el dominio al puerto 3000 con `proxy_pass`.

## 6. Imágenes
Están en `public/img/`. Para cambiar una, reemplaza el archivo o edita la ruta en el panel
(acepta `img/archivo.jpg` o una URL `https://…`).

## 7. Usar MySQL en vez de PostgreSQL
Cambia `pg` por `mysql2`, usa `?` en lugar de `$1…`, `AUTO_INCREMENT` en vez de `SERIAL`
y `FOR UPDATE` dentro de la transacción (se mantiene). Pídeme la versión MySQL si la necesitas.
