---
title: Running your own relay
status: current
date: 2026-10-10
---

# Running your own relay

You only need this if you are the person who runs sharing for a group. If
someone already runs a relay for you, you can skip this page.

## What it is

The relay is one small container. It passes edits between the devices sharing
a folder and keeps a copy of each shared folder so new devices can catch up.
**Run one relay per group** of people who share with each other; everyone in
the group must be able to reach it over a secure connection (`wss://`, with a
real certificate).

## Start it

The relay is built from the Oh hi markdown repository. From the repository
root:

```sh
docker build -f apps/relay/Dockerfile -t ohhi-relay .
printf 'OPERATOR_SECRET=%s\n' "$(openssl rand -hex 32)" > relay.env && chmod 600 relay.env
docker run -d --name ohhi-relay --restart unless-stopped --env-file relay.env \
  -p 127.0.0.1:8787:8787 -v ohhi-relay-data:/data ohhi-relay
```

Or, from `apps/relay`, `docker compose up -d --build`.

It listens on port 8787 on the machine's own loopback only, keeps its data in
the `ohhi-relay-data` volume, and restarts by itself. `GET /healthz` answers
`{"ok":true}` while it is healthy.

## The secret

`OPERATOR_SECRET` is what lets people create and remove share links; the app
calls it **the team's secret** (the relay's `OPERATOR_SECRET`), and asks for
it in its *Team secret* field. The command above generates a long random one
into `relay.env`.

- Put it in your group's password manager, under a name everyone will find.
  The people who share enter it once per device, in the app.
- Never put it in the image, a repository, a chat or a note.
- To change it, edit `relay.env`, recreate the container, and tell the
  people who share to enter the new one.

People who only open links never need it.

## TLS, behind Caddy

The relay speaks plain HTTP and websockets on loopback; put a reverse proxy
with a certificate in front of it. With Caddy it is three lines, and Caddy
gets the certificate itself:

```caddy
relay.example.com {
	reverse_proxy 127.0.0.1:8787
}
```

The relay's address is then `wss://relay.example.com`. Each person sets it
once in **Settings › Sync & devices**; every link made after that carries it, so the
people you share with never type it.

Links made in the web app at `app.ohhi.md` are clickable
`https://app.ohhi.md/join#…` URLs for any `wss://` relay: the relay's address
rides inside the link, and the join page checks that the relay answers before
anyone joins. A desktop app that has no web origin to point at makes a bare
link starting with `editor1:` instead, which the person you share with pastes
into the app (*Add a folder someone shared with you*).

## Behind a Cloudflare Tunnel

If the machine sits behind a home or office router, a tunnel beats opening a
port: `cloudflared` dials out to Cloudflare, and your public hostname routes
back through it, so nothing listens on your network and your address is not
published. Create a tunnel in the Cloudflare dashboard (Zero Trust › Networks
› Tunnels), add a public hostname with service URL `http://relay:8787` (the
relay service's name in `apps/relay/compose.yaml` and its port, at the root
path), and run the connector beside the relay with its token:

```yaml
  cloudflared:
    image: cloudflare/cloudflared:2026.10.0   # pin it; --no-autoupdate below
    restart: unless-stopped
    command: tunnel --no-autoupdate run
    env_file: cloudflared.env                 # TUNNEL_TOKEN=…, mode 600
```

WebSockets pass through a tunnel as they are, and the relay's own pings keep
an idle connection alive under Cloudflare's hundred-second idle limit. The
relay's address is then `wss://<your hostname>`, with no path.

One caution about private addresses in general: a relay reachable only on a
private network (a VPN, a home LAN) does not work from the web app at
`app.ohhi.md` in Chrome, whose Local Network Access check blocks a public page
from connecting to a private address. Firefox has no such check. A public
hostname, or the desktop app, has no such limit.

If the relay is reachable from the internet, it is reachable by anyone. Each
folder is still protected by its links, but consider keeping the admin
routes (`/shares`) reachable only from your own network, and rate-limiting at
the proxy.

## What you can read

The relay stores shared folders **unencrypted**. As the person who runs it,
you (and anyone with access to the machine or its backups) can read every
folder shared through it. Say so to the people who share with your relay.

It never holds anyone's unshared notes, and it is never the only copy: every
device keeps a full copy and the files are on disk. Losing the relay costs
the share links, not notes.

## Backups

A nightly backup saves re-creating every share after a lost disk:

```sh
docker exec ohhi-relay node --experimental-strip-types src/cli.ts backup /data/backups/relay-$(date +%F).db
```

Copy `/data/backups` off the machine too. Upgrading is a rebuild and a
recreate; the data volume carries over.
