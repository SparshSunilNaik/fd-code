# FD CODE

FD CODE is Faheem's customised T3 Code app, based on the newer Alpha codebase. It includes Brain continuity, ARTsie tools, a persistent General chat, and local Laya routing.

## Install on macOS

Download the Apple Silicon DMG from this repository's Releases page, open it, and drag **FD CODE.app** into Applications. Quit the existing FD CODE normally before replacing it. The app keeps its existing T3 data directory and desktop profile; installing it does not import or erase the older Beta profile.

This release is locally signed, not Apple-notarized. macOS may require you to allow it under System Settings → Privacy & Security after the first launch attempt.

## General chat and Laya

Use **General chat** at the top of the sidebar. It reopens a persistent, pinned conversation. Ordinary questions and web requests remain there; a confidently identified project request can continue in its matching existing conversation. General retains a link to the destination. Uncertain decisions and busy destinations stay in General.

Local Laya is optional. Without it, General chat still works, and explicitly named destinations can be resolved directly. To prepare Laya on a new machine with Python 3.11 installed, run from this checkout:

```sh
node scripts/laya-setup.mjs
```

The setup installs Laya 0.4.11 in an isolated environment under `~/.t3/laya`, creates a local token and downloads its model cache. For a custom T3 data directory, pass `--home-dir /your/data/directory`. General starts the authenticated loopback service on demand. No model account is needed for Laya. Chat providers still use your own configured accounts.

Routing applies to plain-text, single-model messages in the primary desktop/web environment. Messages with attachments, thread context, slash commands, or multiple selected models use the normal chat flow. The separate mobile client has not been given a General navigation control in this release.

ARTsie and Brain use their installed local services. Their data, provider credentials, chat histories and Laya tokens are not bundled in the DMG.
