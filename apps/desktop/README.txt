FTC Sim — Windows app
=====================

Download FTC-Sim-win-x64.zip from GitHub Releases.

IMPORTANT — use WinRAR or 7-Zip to unzip. Windows "Extract All" often says the zip is invalid; WinRAR/7-Zip works fine.

Then open the "FTC Sim" folder and run FTC Sim.exe.
(SmartScreen? Click More info, then Run anyway.)

Play Solo — practice by yourself.
Host Match — you run the game; friends join with your address.
Join Match — paste the host address (example: 192.168.1.50:5191).

Same Wi-Fi: share the LAN address from the launcher.
Internet: host forwards TCP port 5191 on their router, then shares public IP:5191.

https://github.com/Pleasantnoob/VibeCodedFTCSIM/releases/latest

Local dev / build layout (repo):
  apps/desktop/release/FTC-Sim/     — run locally after pnpm dist
  apps/desktop/release/electron/    — electron-builder cache (win-unpacked)
  apps/desktop/release/FTC-Sim-win-x64.zip — release zip for GitHub

Updates: launcher checks GitHub latest.yml and can download the zip to Downloads.
