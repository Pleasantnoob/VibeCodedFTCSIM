# Internet multiplayer (port forward)

Play with friends **outside your Wi‑Fi** by forwarding **TCP port 5191** on your router to the host PC. The match server runs on the **host**; friends join with `YOUR_PUBLIC_IP:5191`. **Joiners need nothing extra** — same Electron app, paste the address, connect.

## Quick setup (host)

1. **Router:** forward **TCP 5191** → your PC’s LAN IP (e.g. `192.168.1.50:5191`).
2. **Windows firewall:** allow **FTC Sim** / inbound **TCP 5191** on private networks.
3. **Public IP:** open [whatismyip.com](https://whatismyip.com) or use **Detect IP** in the FTC Sim launcher.
4. Start **FTC Sim** → **Host Match** → **Multiplayer → Connect as Host**.
5. Paste `PUBLIC_IP:5191` in **Internet address** → **Save** → **Copy** → send to friends.
6. Press **INF** to drive.

Friends: **Join Match** → paste `PUBLIC_IP:5191` → Connect. No router setup on their side.

## Using the zip / exe

- **Host:** Electron launcher + router port forward (one-time).
- **Joiners:** only the shared address — no port forward, no VPN, no tunnel app.

## LAN vs internet

| | LAN | Internet (port forward) |
|---|-----|-------------------------|
| Address | `192.168.x.x:5191` | `73.x.x.x:5191` |
| Same Wi‑Fi required? | Yes | No |
| Host router setup? | No | Yes (once) |
| Extra latency | ~0–5 ms | ~10–40 ms (direct) |

## Troubleshooting

**Friend can't connect**
- Host: **Host Match** started, lobby shows connected as host.
- Router forward: **TCP 5191** → correct LAN IP (check `ipconfig`).
- Share **public IP:5191**, not `127.0.0.1`.
- Windows firewall allows inbound 5191.
- **CGNAT:** many mobile/residential ISPs block inbound port forward — see [Alternatives](#alternatives-if-port-forward-fails) below.

**Connects but laggy**
- Host on wired Ethernet helps.
- Phase 6 will add client prediction for smoother feel at higher ping.

**SmartScreen on exe**
- Unsigned build: **More info** → **Run anyway**.

## Alternatives if port forward fails

If your ISP uses **CGNAT** (port forward never works from outside):

1. **Tailscale** (free) — both install, friend joins your Tailscale IP `:5191`. See [tailscale.com/download](https://tailscale.com/download).
2. **playit.gg** — generic TCP may require Premium; Minecraft Java tunnel with local port `5191` sometimes works on free tier.
3. **LAN only** — same Wi‑Fi, use `192.168.x.x:5191` from the launcher.

## Router tips

- Find PC LAN IP: `ipconfig` → IPv4 on your Wi‑Fi/Ethernet adapter.
- Forward **external 5191** → **internal LAN IP :5191**, protocol **TCP** only.
- If your public IP changes (DHCP), re-share the new address or use a dynamic DNS service.

See also: [`MULTIPLAYER_MANIFEST.md`](./MULTIPLAYER_MANIFEST.md) §10.
