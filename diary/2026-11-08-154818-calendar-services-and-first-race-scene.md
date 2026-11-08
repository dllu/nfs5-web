# Calendar services and the first race scene

Implemented GetLocalTime, GetSystemTime and GetTimeZoneInformation after the
original quick-race startup reached its CRT time routine at 005A17EB. Calendar
fields use the host wall clock with integer milliseconds, distinct from the
monotonic clocks used by the game loop. Time-zone output includes signed bias,
UTF-16 names, current DST state and absolute current-year transition dates for
zones with two seasonal changes. Zones with more complex changes receive a
fixed current-offset snapshot. The ABI follows Microsoft's
[TIME_ZONE_INFORMATION definition](https://learn.microsoft.com/en-us/windows/win32/api/timezoneapi/ns-timezoneapi-time_zone_information)
and [GetTimeZoneInformation return values](https://learn.microsoft.com/en-us/windows/win32/api/timezoneapi/nf-timezoneapi-gettimezoneinformation).

The 104 Windows-service checks pass in America/Los_Angeles, Asia/Kathmandu and
Australia/Lord_Howe. Coverage compares local/UTC fields and effective bias with
independent JavaScript dates, checks exact DST boundaries and output guards,
runs the APIs on a native pthread, and exercises the original CRT time routine.
The full Node suite passes. Browser coverage also checks native-worker calendar
and time-zone calls against browser Date values.

Manual Chrome navigation reached the profile chooser, single-player dialog,
quick-race car setup and Côte d'Azur race with a Porsche 356. The game chose
6144x3456, rendered the track/car and race HUD, and played game audio without
another missing import. Captures are local build artifacts. The HUD is tiny at
this resolution; clicks sometimes require retries. Driving response, race
fidelity, save/load and frame-rate targets remain unverified.
