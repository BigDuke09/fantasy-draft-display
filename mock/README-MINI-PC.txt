
Draft Board – Mini PC Setup (Windows)
=====================================

This guide walks you through moving your files to a new Windows mini PC and running the site locally with the smallest possible setup.

What you’ll get in this folder:
- start_static_server.ps1  → Starts a local web server for your site (Python http.server)
- launch_board.cmd         → Opens Microsoft Edge in full-screen kiosk mode to your local site
- (you already have) index.html, style.css, script.live.cors.js, fleaflicker_team_meta.json, etc.

OPTION A — Minimal (recommended now; uses the AllOrigins proxy already built into script.live.cors.js)
------------------------------------------------------------------------------------------------------
1) Create a folder for your site (example): C:\draftboard
2) Copy these files into C:\draftboard
   - index.html
   - style.css
   - script.live.cors.js
   - fleaflicker_team_meta.json
   - (any other images or assets you use)

3) Start the local server
   - Right‑click start_static_server.ps1 → Run with PowerShell
     (or open PowerShell and run:  .\start_static_server.ps1  -SiteDir "C:\draftboard" -Port 5172 )

   This serves your files at: http://localhost:5172/

4) Open the board in full‑screen kiosk mode
   - Double‑click launch_board.cmd
   (or run from a Run box:  msedge --kiosk http://localhost:5172/index.html --edge-kiosk-type=fullscreen)

5) Verify it loads live data
   - Your script is the CORS-friendly build (script.live.cors.js), which routes API calls through the AllOrigins proxy.
   - If you later set up your own local proxy, update CONFIG.PROXY_TEMPLATE inside script.live.cors.js and keep FORCE_PROXY: true.

OPTION B — Robust (optional): Run your own local proxy and point the script at it
----------------------------------------------------------------------------------
If you prefer not to rely on a public CORS proxy on draft day, set up a local proxy.

• .NET 8 Minimal API (Microsoft stack):
  1. Install .NET 8 SDK (only needs to be installed once).
  2. Create a folder (e.g., C:\ffproxy) and create Program.cs with the Minimal API proxy code we discussed.
  3. Run:  dotnet run
  4. In script.live.cors.js, set:
       FORCE_PROXY: true,
       PROXY_TEMPLATE: "http://localhost:5173/proxy?url={url}"
  5. Refresh the board.

• Node/Express:
  1. Install Node.js (LTS).
  2. Create server.mjs from the code we discussed; run:  node server.mjs
  3. Point PROXY_TEMPLATE to http://localhost:5173/proxy?url={url}

Quality-of-life tips for the mini PC
------------------------------------
• Keep the PC awake: Settings → System → Power & battery → Screen & sleep → set both to “Never” during the event.
• Disable screen saver. Ensure no lock screen timeouts kick in.
• Put shortcuts to start_static_server.ps1 and launch_board.cmd in Startup (Win+R → shell:startup) so the board auto-launches.
• Test on the TV/projector ahead of time; set Windows scaling so the grid text is crisp.
• If the board shows “no data,” open DevTools (F12) → Console/Network for any errors (proxy down, API changed, etc.).

Common paths / ports
--------------------
• Site folder: C:\draftboard
• Local server: http://localhost:5172/
• Proxy (if you host one): http://localhost:5173/proxy?url=...

Rollback
--------
• If you switch back to mock data, set MODE: "mock" and adjust MOCK_URL in your script, or just swap back to your earlier script.js file.
• You can keep both scripts side-by-side (script.live.cors.js for live; script.dual.js for local mocked testing).
