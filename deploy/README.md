# Deploy

Push to `development` → GitHub Actions runs the tests, builds the image `ghcr.io/igorchugurov/studio-desk-backend:<commit>`, copies `docker-compose.yml`, `deploy.sh` and the PostgreSQL init script to `/opt/studio-desk/` and runs `deploy.sh`.

Design and rules: `studio-desk-docs/03-architecture/deployment.md`.

## Files

| File                                         | On the server                                                          |
| -------------------------------------------- | ---------------------------------------------------------------------- |
| `docker-compose.yml`                         | `/opt/studio-desk/docker-compose.yml`                                  |
| `deploy.sh`                                  | `/opt/studio-desk/deploy.sh`                                           |
| `../docker/postgres/init/01-init.sh`         | `/opt/studio-desk/postgres-init/01-init.sh`                            |
| `nginx/api.studio-desk.axondigital.xyz.conf` | `/etc/nginx/sites-available/api.studio-desk.axondigital.xyz` (by hand) |
| —                                            | `/opt/studio-desk/.env` (by hand, once)                                |
| —                                            | `/opt/studio-desk/image.env` (written by `deploy.sh`: running version) |

## One-time server setup (as root)

### 1. Docker Compose

```bash
apt-get update && apt-get install -y docker-compose-v2
docker compose version
```

### 2. Deploy user, key login only

`<PUBLIC KEY>` is the public half of the deploy key (`ssh-ed25519 ...`).

```bash
useradd --create-home --shell /bin/bash studio-desk
usermod -aG docker studio-desk
passwd -l studio-desk
install -d -m 700 -o studio-desk -g studio-desk /home/studio-desk/.ssh
echo '<PUBLIC KEY>' > /home/studio-desk/.ssh/authorized_keys
chown studio-desk:studio-desk /home/studio-desk/.ssh/authorized_keys
chmod 600 /home/studio-desk/.ssh/authorized_keys
```

### 3. Deploy folder and `.env`

Passwords are generated on the server and never leave it.

```bash
install -d -m 750 -o studio-desk -g studio-desk /opt/studio-desk
install -d -m 755 -o studio-desk -g studio-desk /opt/studio-desk/postgres-init
runuser -u studio-desk -- bash -c 'umask 077; gen() { openssl rand -hex 24; }; cat > /opt/studio-desk/.env <<EOF
APP_ENV=production
PORT=3000
DB_HOST=postgres
DB_PORT=5432
DB_NAME=studio_desk
DB_OWNER_PASSWORD=$(gen)
DB_PLATFORM_API_PASSWORD=$(gen)
DB_STUDIO_API_PASSWORD=$(gen)
DB_PUBLIC_API_PASSWORD=$(gen)
POSTGRES_SUPERUSER_PASSWORD=$(gen)
EOF'
ls -l /opt/studio-desk/.env
```

### 4. nginx site and certificate

Other sites are not touched.

```bash
curl -fsSL https://raw.githubusercontent.com/IgorChugurov/studio-desk-backend/development/deploy/nginx/api.studio-desk.axondigital.xyz.conf \
  -o /etc/nginx/sites-available/api.studio-desk.axondigital.xyz
ln -s /etc/nginx/sites-available/api.studio-desk.axondigital.xyz /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d api.studio-desk.axondigital.xyz --redirect
```

### 5. Server fingerprint

To compare with `DEPLOY_KNOWN_HOSTS`:

```bash
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

## GitHub secrets (repository `studio-desk-backend`)

`DEPLOY_HOST`, `DEPLOY_USER` (`studio-desk`), `DEPLOY_SSH_KEY` (private half of the deploy key), `DEPLOY_KNOWN_HOSTS` (`ssh-keyscan` output of the server).

After the first image is published, switch the package `studio-desk-backend` to Public once: GitHub → profile → Packages → `studio-desk-backend` → Package settings → Change visibility.

## Manual operations (as studio-desk, in /opt/studio-desk)

```bash
docker compose --env-file .env --env-file image.env ps
docker compose --env-file .env --env-file image.env logs --tail 100 backend
bash deploy.sh <older-tag>          # roll back; migrations are not reverted
```

Database from the Mac through an SSH tunnel: the database port is not published, so first find the container address (`docker inspect studio-desk-postgres-1`) and tunnel to it.
