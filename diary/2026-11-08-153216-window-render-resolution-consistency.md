# Main menu and profile chooser are visible

The frontend rendered its 3D room while menu controls were missing. Inspection
showed a 1000x850 virtual client area with a 640x480 render target and cached game
viewport. Thrash mode changes now update the foreground game window's client
dimensions, retain its nonclient insets, and queue WM_SIZE to the owning thread.
The game, window API and canvas now report the same dimensions. The captured
frontend shows the main menu and profile chooser, including its Continue control.

Hardware-WebGPU validation passes 27 backend and 41 native-driver checks with
72 ABI calls. Added coverage creates a real guest window and verifies client
sizes and queued WM_SIZE at 640x480, 3840x2160, and restore/reopen. The original
frontend runs and produces visible menu controls; menu navigation, racing and
game saves still need verification. No gameplay performance claim is established.
