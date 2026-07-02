# Deploying to your Hostinger KVM VPS

This is the complete path from "code on my Mac" to "live at
https://portal.avixdigital.com". Follow it top to bottom the first time —
after that, deploying an update is one command.

**What you need before starting**
- A Hostinger **KVM VPS** (any size works; KVM 1 is fine to start). When
  creating it, choose **Ubuntu 24.04 LTS** as the OS.
- Your domain `avixdigital.com` with DNS managed in Hostinger hPanel.
- A free [Resend](https://resend.com) account (for the emails).
- A free private GitHub repository containing this project.

Throughout, replace `YOUR_VPS_IP` with the IP shown in Hostinger's VPS panel.

---

## 1. First login & server hardening (one time, ~15 min)

On your **Mac**, create an SSH key if you don't have one:

```bash
ssh-keygen -t ed25519 -C "avix-portal"     # press Enter through the prompts
ssh-copy-id root@YOUR_VPS_IP               # paste the VPS root password once
```

Log in and create a non-root user that will run everything:

```bash
ssh root@YOUR_VPS_IP

adduser deploy                 # choose a strong password, rest can be blank
usermod -aG sudo deploy
rsync -a ~/.ssh /home/deploy/ && chown -R deploy:deploy /home/deploy/.ssh
```

Lock down SSH — edit `/etc/ssh/sshd_config` (`nano /etc/ssh/sshd_config`):

```
PermitRootLogin no
PasswordAuthentication no
```

Then apply and set up the firewall + basics:

```bash
systemctl restart ssh
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw enable
apt update && apt install -y fail2ban unattended-upgrades
exit
```

From now on you log in as `ssh deploy@YOUR_VPS_IP`. fail2ban's default
jail already bans repeated SSH failures; unattended-upgrades keeps Ubuntu
patched automatically.

## 2. Install Docker (one time, ~2 min)

```bash
ssh deploy@YOUR_VPS_IP
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker deploy
exit   # log out and back in so the docker group applies
```

Verify: `ssh deploy@YOUR_VPS_IP docker ps` should print an empty table, not
a permission error.

## 3. Point the subdomain at the VPS (one time, ~2 min + wait)

In **hPanel → Domains → avixdigital.com → DNS / Name Servers**, add:

| Type | Name     | Content      | TTL |
|------|----------|--------------|-----|
| A    | `portal` | YOUR_VPS_IP  | 300 |

Wait until `dig +short portal.avixdigital.com` (run on your Mac) returns the
VPS IP — usually a few minutes. Caddy can't issue the HTTPS certificate until
this resolves.

## 4. Verify your domain with Resend (one time, ~10 min)

1. In [Resend → Domains](https://resend.com/domains), click **Add Domain**,
   enter `avixdigital.com`, region closest to you.
2. Resend shows 3–4 DNS records (DKIM TXT like `resend._domainkey`, an MX +
   SPF TXT on a `send` subdomain, and optionally DMARC). Add **each one** in
   the same hPanel DNS editor from step 3, copying names/values exactly.
3. Back in Resend, click **Verify DNS Records**. It usually flips to
   *Verified* within minutes (up to an hour).
4. Create an API key: **API Keys → Create** — you'll paste it into `.env`
   in step 5. Sending address: `portal@avixdigital.com` (already the default
   `EMAIL_FROM`).

## 5. First deploy (~10 min)

**GitHub deploy key** (lets the VPS pull your private repo, read-only):

```bash
ssh deploy@YOUR_VPS_IP
ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519   # if none exists yet
cat ~/.ssh/id_ed25519.pub
```

Copy that line into **GitHub → your repo → Settings → Deploy keys →
Add deploy key** (leave "write access" unchecked).

**Clone and configure:**

```bash
sudo mkdir -p /opt/portal && sudo chown deploy:deploy /opt/portal
git clone git@github.com:YOUR_GITHUB_USERNAME/avix-portal.git /opt/portal
cd /opt/portal
mkdir -p uploads backups
cp .env.example .env
nano .env
```

Fill in `.env` with **production** values:

```env
# DATABASE_URL is set by docker-compose — leave it out here, but DO set:
DB_PASSWORD=<openssl rand -hex 16>            # postgres password (compose uses it)
BETTER_AUTH_SECRET=<openssl rand -base64 32>  # generate a FRESH one, not the dev one
BETTER_AUTH_URL=https://portal.avixdigital.com
NEXT_PUBLIC_APP_URL=https://portal.avixdigital.com
RESEND_API_KEY=re_...                         # from step 4
EMAIL_FROM="Avix Digital <portal@avixdigital.com>"
ADMIN_NOTIFICATION_EMAIL=akibzawayed0079@gmail.com
SEED_ADMIN_EMAIL=akibzawayed0079@gmail.com
SEED_ADMIN_PASSWORD=<a strong password you'll use to log in>
```

Then protect it and launch:

```bash
chmod 600 .env
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml logs -f app
```

In the logs you should see the migrations apply, then
`[bootstrap] Super admin created: akibzawayed0079@gmail.com`, then the Next.js
ready line. Open **https://portal.avixdigital.com** — Caddy issues the TLS
certificate automatically on the first request (green padlock, no certbot,
renews itself forever).

Sign in with your seed credentials and, if you like, change the password via
"Forgot password".

## 6. Deploying updates (every time after)

Push your changes to GitHub, then:

```bash
ssh deploy@YOUR_VPS_IP '/opt/portal/deploy.sh'
```

That's it — it pulls, rebuilds the app image, restarts the container
(migrations run automatically on start), and prunes old images. Roughly a
minute of build time; the site is briefly unavailable during the container
swap.

## 7. Backups (one time, ~2 min)

```bash
ssh deploy@YOUR_VPS_IP
crontab -e     # add the line below
```

```
0 3 * * * /opt/portal/backup.sh >> /opt/portal/backups/backup.log 2>&1
```

Every night at 03:00 this saves a compressed database dump plus a tarball of
uploaded files into `/opt/portal/backups`, keeping 14 days.

**Do one restore drill before you rely on it:**

```bash
cd /opt/portal && ./backup.sh
docker compose -f docker-compose.prod.yml exec -T db \
  psql -U portal -d postgres -c "CREATE DATABASE restore_test;"
gunzip -c backups/db-$(date +%F).sql.gz | \
  docker compose -f docker-compose.prod.yml exec -T db psql -U portal -d restore_test
# check row counts, then clean up:
docker compose -f docker-compose.prod.yml exec -T db \
  psql -U portal -d postgres -c "DROP DATABASE restore_test;"
```

Optional off-site copies: `rclone` has a guided setup for Google Drive
(`sudo apt install rclone && rclone config`), then add
`rclone copy /opt/portal/backups gdrive:portal-backups` to the cron line.

## 8. Sanity checklist after going live

- [ ] `https://portal.avixdigital.com` loads with a green padlock
- [ ] Admin login works; wrong password 6× in a minute returns "too many attempts"
- [ ] Add a test client using an email you control → welcome email lands in
      the inbox (check spam the first time; mark "not spam" if needed)
- [ ] The invite link sets a password and the test client sees an empty portal
- [ ] Create a test invoice with a PDF and send it → email arrives, the client
      can download the PDF, a logged-out browser gets a 404/401 on the same URL
- [ ] Reboot the VPS (`sudo reboot`) → everything comes back by itself
- [ ] `backup.sh` runs and the restore drill in step 7 passed
- [ ] Optional: send a welcome email to [mail-tester.com](https://www.mail-tester.com)
      — with Resend DKIM/SPF verified you should score 9–10

## Troubleshooting

| Symptom | Fix |
|---|---|
| Browser shows a Caddy error / no certificate | DNS not propagated yet — check `dig +short portal.avixdigital.com`; then `docker compose -f docker-compose.prod.yml logs caddy` |
| `app` container restarts in a loop | `docker compose -f docker-compose.prod.yml logs app` — most often a bad `.env` value (`DB_PASSWORD` changed after the database volume was created, or malformed `BETTER_AUTH_SECRET`) |
| Emails not arriving | Resend dashboard → Logs shows every attempt; confirm domain is *Verified* and `RESEND_API_KEY` is the live key |
| Invite link says expired | Links last 24 h — use the **Resend invite** action on the client row |
| Need to inspect the database | `docker compose -f docker-compose.prod.yml exec db psql -U portal portal` |
| Locked yourself out of admin | `docker compose ... exec db psql -U portal portal -c "DELETE FROM users WHERE role='ADMIN';"` then restart the app container — the seed admin is recreated from `.env` |
