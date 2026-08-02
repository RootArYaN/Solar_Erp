# Production deployment

The supported production target is a single Hostinger Ubuntu 24.04 Docker VPS.
Use [`HOSTINGER_VPS.md`](HOSTINGER_VPS.md) as the canonical installation,
update, backup, restore, and verification guide.

The production topology is:

```text
Internet → Hostinger Traefik → unprivileged Nginx frontend → FastAPI
                                                        ├→ PostgreSQL
                                                        ├→ ClamAV
                                                        └→ private Docker document volume
```

Only Traefik owns public ports 80/443. PostgreSQL, FastAPI, ClamAV, and document
storage remain private to Docker networks or volumes. Do not deploy the old
multi-provider or public object-storage topology.
