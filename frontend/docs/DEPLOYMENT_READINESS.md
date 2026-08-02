# Hostinger frontend readiness

The production frontend is built from `package-lock.json` and served by
unprivileged Nginx on container port 8080. Hostinger Traefik terminates HTTPS
and routes the public hostname to this container.

- `VITE_API_BASE_URL=/api/v1` keeps browser traffic same-origin.
- Nginx proxies `/api/` to the private FastAPI service.
- SPA deep links fall back to `index.html`.
- Hashed assets receive immutable caching; HTML receives no-cache headers.
- Security headers and a 21 MB reverse-proxy body limit are applied.
- Nginx and FastAPI ports are not published on the VPS.

Build and verify with:

```bash
npm ci
npm test
npm run build
```

The complete production procedure is in `deploy/HOSTINGER_VPS.md`.
