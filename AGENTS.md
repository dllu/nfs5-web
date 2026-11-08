# Need For Speed Porsche Unleashed on web

This project aims to get NFS Porsche Unleashed working on web.

- I have previously purchased the game in 2000 but it is now abandonware. This reverse engineering project is for personal enjoyment so that I can continue to play the game despite not having 2000-era hardware.
- We have a working Need For Speed Porsche Unleashed working in ~/wines/prefixes/nfs5. It uses Wine + FEX to get it working plus Verok's patches for OpenGL3. It works smoothly on this machine although not at 120 Hz.
  - NFS5_V.ISO and the patch nfs5_pu_patch_1.06.zip are also in that directory.
- Aim for great performance. 4K resolution at 120 Hz should be achievable since modern hardware are vastly better than the Voodoo era hardware of 1999.
  - Use latest web technologies as necessary.
  - Decompile/recompile the game for Webassembly.
  - This dev machine is an NVIDIA DGX Spark with GB10. The web port should obviously be mostly hardware agnostic although we may assume hardware on par with this machine with a GPU.
  - This dev machine is equipped with a 6K 165 Hz display. Bonus points if the game can run at 6K 165 Hz, but 4K 120 hz should suffice for most users.
- Google Chrome and Firefox are installed. Feel free to try it out on real browsers.
- The game should be static and support save games in local storage.
  - No need to support multiplayer.
- Steering wheel and controller support is a bonus but for now keyboard input should be fine as I do not own a steering wheel or controller.
- Don't make changes to ~/wines/ or anywhere else other than this directory (~/proj/nfs5-web).
- Maintain a README.md concisely documenting the CURRENT STATE of the project and aggressively remove stale information such as mentions of previous revisions and fixes.
- Commit and push whenever you make concrete progress.
- Put progress reports into the diary directory as markdown files prefixed by local datetime, e.g. yyyy-mm-dd-timestamp-title.md.
