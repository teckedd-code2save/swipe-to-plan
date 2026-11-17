# In-app booking website search

When a venue has no provider-linked website, **Search web for booking** opens a real isolated Cloudflare browser inside Unstressed. It also appears after form discovery fails. The existing Browser Run configuration is reused; no new search API key or subscription is required. Browser runtime usage still applies.

The search query contains only the venue's provider-bound public name, address and phone. The person sees the provider's actual page, not a generated or repackaged result list. They can follow visible links, scroll, go back and refresh. The view updates after each action; it is not an embedded native browser or continuous video stream.

Only links can be followed. There is no text input, arbitrary script, button click, login, CAPTCHA solver or form submission. Network requests retain the existing public-HTTPS and GET-only restrictions. Verification and consent screens stop forward interaction; Back and a clearly labelled external fallback remain available. No stealth or challenge bypass is used.

The person compares the venue/location and selects **Use this website**. This creates a short-lived, venue-bound destination identifier; it does not declare ownership verified. The normal read-only form-discovery flow then inspects that chosen website. Personal fields are handled only in the separate reviewed, network-disconnected form-fill step.

Sessions expire after three minutes, close on dismissal/abort, and share the existing limit of two active browser operations. Private transient link hitboxes bind user clicks to the displayed frame; they are never returned as a search-results API. Animated page pixels alone do not block navigation. Selected destinations are server-held, not caller-supplied URLs.

Live acceptance checklist: search within the app → open the correct venue → compare location → Use this website → inspect its form; also check changed-page clicks, Back from a blocked page, expiry, Close, browser failure fallback and no submission. A blocked search provider is a real limitation, not a successful booking search.
