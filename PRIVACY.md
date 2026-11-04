# Cloakpaste privacy policy

_Last updated: 5 November 2026_

Cloakpaste is a browser extension by DhivaLabs that hides secrets and personal
data in text you paste into AI chat sites.

## What Cloakpaste processes

When you paste text into a site Cloakpaste protects, it reads that text to
find items such as email addresses, phone numbers, API keys, card numbers and
people's names. It then replaces them with placeholders like `[EMAIL_1]`
before the text enters the page.

All of this happens on your device. Detection uses pattern rules and a small
language model packaged with the extension. Neither one sends text anywhere.

## What Cloakpaste stores

- **Placeholder mappings** (for example, which email `[EMAIL_1]` stands for)
  are kept in your browser's session storage, separately for each site. They
  are held in memory only and are deleted when you close the browser. You can
  also forget them from the Cloakpaste menu at any time. In Firefox, the
  extension's background page hands a site's mappings to Cloakpaste's content
  script on that site when the script asks for them; they stay on your device.
- **Settings** (which kinds of data to hide, your "always hide" and "never
  hide" lists, which sites are switched off) are kept in your browser's local
  extension storage until you change them or remove the extension.
- **Counts** of how many items were hidden, used for the toolbar badge, are
  kept in session storage and deleted when the browser closes.

## What Cloakpaste does not do

- It makes no network requests. The model and all code ship inside the
  extension package.
- It has no account, server, analytics, telemetry, ads or tracking.
- It does not sell, share or transfer any data, and does not use data for
  anything other than hiding it in your pastes.
- It does not read pages beyond the text you paste and the placeholders it
  inserted, which it looks for in replies so it can show you the originals.

## Permissions

- **Access to the built-in AI chat sites:** needed to catch pastes and mark
  placeholders on those sites.
- **storage:** saves your settings and the session-only placeholder mappings.
- **offscreen:** runs the on-device model in a hidden extension page (Chrome
  only; in Firefox the model runs in the extension's background page).
- **scripting** and **optional site access:** used only when you choose
  "Protect this site" for a site that isn't built in. Cloakpaste asks for
  access to that one site at that moment.

## Contact

Questions or concerns: open an issue at
https://github.com/Dhiva-Labs/Cloakpaste/issues.
