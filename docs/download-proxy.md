# GameBanana download proxy

Settings > Maintenance > GameBanana download proxy accepts an HTTP, HTTPS or SOCKS
proxy URL, such as `http://127.0.0.1:7890` or `socks5://127.0.0.1:1080`. Use the
listening address provided by the VPN/proxy client. Grimoire does not create a VPN
or provide a proxy server.

Enable the switch and save, then run Download servers > Test now. Server tests,
the GameBanana download redirects and the files themselves use that route. Browse
requests, other Grimoire services, Steam and the game keep their existing route.
SOCKS5 destination hostnames are resolved by the proxy.

The proxy starts disabled. A configured proxy that is unavailable causes a
download error instead of falling back to a direct connection. Save changes
between downloads. Disabling it restores direct downloads; Clear saved proxy
also removes its endpoint and credentials. Changing the route clears the old
server test results, so run Test now again.

Authenticated endpoints can include URL-encoded credentials, such as
`http://username:password@proxy.example:3128`. The main process encrypts credentials
with Electron safeStorage. The renderer receives only the endpoint and a flag
indicating saved credentials. Saving that endpoint again preserves credentials;
clear the saved proxy before replacing it with an unauthenticated endpoint at the
same address. Systems without a secure credential store can use an endpoint
without credentials, including a local VPN client's proxy.

The chosen proxy sees the download destinations and timing. HTTPS file requests
remain TLS-encrypted through the proxy; certificate validation stays enabled.
