# Environment configuration

Use `backend/.env.example` only for local development. Hostinger production
uses the repository-level `.env.hostinger.example`, which is loaded by
`compose.hostinger.yml` and then constrained by its production environment
overrides.

Never place PostgreSQL passwords, JWT secrets, administrator passwords, or
other private values in frontend `VITE_*` variables. Generate the PostgreSQL
password and JWT secret independently with `openssl rand -hex 32`.

Run the Hostinger environment validator before every deployment:

```bash
python3 deploy/validate_hostinger_env.py .env.hostinger
```
