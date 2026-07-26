# Environment example

## Frontend

```env
VITE_API_BASE_URL=/api/v1
```

Only public browser configuration may use `VITE_` variables. Never place database, JWT, email, encryption or storage credentials in the frontend.

## Backend: local development

```env
ENVIRONMENT=development
DATABASE_URL=sqlite:///./solar_erp.db
JWT_SECRET=replace-with-a-private-random-value-at-least-32-characters
ACCESS_TOKEN_MINUTES=30
REFRESH_TOKEN_DAYS=14
SESSION_COOKIE_NAME=solar_erp_refresh
SESSION_COOKIE_SECURE=false
SESSION_COOKIE_SAMESITE=lax
FRONTEND_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
STORAGE_TYPE=local
STORAGE_PATH=./storage
MAX_UPLOAD_MB=20
ARCHIVE_KEEP_DAYS=30
ARCHIVE_WORKER_LIMIT=1
ARCHIVE_JOB_TIMEOUT_MINUTES=60
DEFAULT_PAGE_SIZE=25
MAX_PAGE_SIZE=100
LOGIN_LIMIT=8
LOGIN_WINDOW_SECONDS=300
DB_POOL_SIZE=5
DB_MAX_OVERFLOW=10
```

## Backend: production preparation

```env
ENVIRONMENT=production
DATABASE_URL=postgresql+psycopg://USER:PASSWORD@HOST/DATABASE
JWT_SECRET=use-a-generated-private-secret
ACCESS_TOKEN_MINUTES=15
REFRESH_TOKEN_DAYS=14
SESSION_COOKIE_NAME=solar_erp_refresh
SESSION_COOKIE_SECURE=true
SESSION_COOKIE_SAMESITE=lax
FRONTEND_ORIGINS=https://erp.example.com
STORAGE_TYPE=local
STORAGE_PATH=/var/lib/solar-erp/storage
MAX_UPLOAD_MB=20
ARCHIVE_KEEP_DAYS=30
ARCHIVE_WORKER_LIMIT=1
ARCHIVE_JOB_TIMEOUT_MINUTES=60
DEFAULT_PAGE_SIZE=25
MAX_PAGE_SIZE=100
LOGIN_LIMIT=8
LOGIN_WINDOW_SECONDS=300
DB_POOL_SIZE=5
DB_MAX_OVERFLOW=10
```

`STORAGE_TYPE=local` is intentional before cloud integration. A non-local value fails startup rather than silently storing data on temporary container disk.

## Generate a secret

```bash
python -c "import secrets; print(secrets.token_urlsafe(64))"
```

Keep the resulting value in the deployment platform's secret manager, not in Git.
