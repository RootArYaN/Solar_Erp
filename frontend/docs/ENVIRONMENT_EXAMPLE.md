# Frontend environment configuration

Use `frontend/.env.example` locally and `frontend/.env.production.example` for
the production build.

Only public browser configuration may use `VITE_` variables. Database
credentials, JWT secrets, storage configuration and malware-scanner settings
belong exclusively in `.env.hostinger` on the VPS.

The recommended deployment serves the frontend and `/api/v1` through one HTTPS
origin, so the production API base remains:

```env
VITE_API_BASE_URL=/api/v1
```
