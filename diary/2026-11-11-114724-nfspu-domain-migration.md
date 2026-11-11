# nfspu.com deployment

Cloudflare reports an active full zone delegated to `kim.ns.cloudflare.com`
and `lakas.ns.cloudflare.com`, with an active Universal SSL certificate. The
imported web records initially pointed to Squarespace. The apex now has one
proxied A record for `96.126.98.50`, and the proxied www CNAME targets the apex.
HTTPS redirects are enabled and the SSL mode is Full (strict).

The game is served from `/www/nfspu` on `pupserver.linode`. Caddy obtained
Let's Encrypt certificates for both hostnames. The public deployment script
updates the dedicated site and the legacy routes using delimited blocks,
backs up and validates the configuration, and restores it if reload fails.
The existing asset history was copied and checked before `/www/misc/nfs5`
was removed. www and both previous `/nfs5` routes redirect permanently to
`https://nfspu.com/`, preserving nested paths and query strings.

Saved profiles belong to each browser origin. The `/nfs5-saves/` page on each
previous hostname exports those profiles through the existing backup modules,
served from the new directory. The new game's Info panel and README link to
both export pages. The exports retain file bytes, timestamps, attributes, and
deletion records, and restore through the existing backup format.

Release `1288f9ad5517b21b` passed the public browser test at nfspu.com, including
direct launch, fresh profiles, browser-restart persistence, backup/restore,
skyboxes, and fullscreen race resizing. The check brings its page to the
foreground before menu actions so the native fullscreen request has focus.
Exports from both previous origins were restored at the new origin in a
separate browser check. HTTP and www redirects, legacy redirects, isolation
headers, streaming music byte ranges, deployed file matches, and the removal
of the old directory were checked.

Authoritative DNS, 1.1.1.1, and 8.8.8.8 resolve the Cloudflare addresses. The
development machine and its router still cache the prior Squarespace A
records, so the browser check explicitly resolved nfspu.com to a current
Cloudflare edge address. HTTPS certificates were validated normally.
