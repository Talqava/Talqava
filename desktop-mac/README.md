# Talqava for the Mac, as a native app

A small Swift app that starts Talqava's own server and shows it in a window, using the web view that comes with macOS. It does what the Electron build (`../desktop`) does, without carrying a browser inside the app. All of Talqava's own code stays in TypeScript: the Swift file only opens the window, runs the server and adds what belongs to the Mac.

## What the Mac app adds

- The window, with the Mac's own menus, dialogs, file pickers and Downloads folder.
- An item in the menu bar: open Talqava or start a new session from anywhere.
- Closing the window keeps Talqava running, so automations and agents carry on. Quit stops everything.
- Links to other sites open in your browser.
- The microphone, for voice memos and speaking instead of typing (macOS asks the first time).

## Building it

    ./build.sh

It needs Apple's command-line tools (no Xcode project) and Node 22.18 or newer. The result is `dist/Talqava.app`:

| Part | What it is |
|---|---|
| `Contents/MacOS/Talqava` | The Swift app (about 200 KB) |
| `Contents/Resources/server` | Talqava itself: the same files the Electron build ships |
| `Contents/Resources/node` | The Node program that runs the server, taken from the Mac that builds it |

The speech program is included when `vendor/whisper` is there (see `scripts/build-speech-program.md`).

## Trying a build beside the installed app

Only one copy of Talqava works on a data folder at a time. To try a build without touching your own data, give it another folder. A copy started this way also leaves Claude's settings alone:

    TALQAVA_DATA_DIR=/some/empty/folder ./dist/Talqava.app/Contents/MacOS/Talqava

## What is and is not done

- Built and started on an Apple-chip Mac: the server came up and the window showed the app. Size: about 205 MB, against 366 MB for the Electron build.
- Signed ad hoc, which runs on the Mac that built it. A download for other people needs a Developer ID signature and Apple's notarization; neither is set up here.
- Not built for Intel Macs. Windows and Linux stay on the Electron build.
- Not yet tried by hand in this window: the editor, drag and drop, file previews, saving a file, and the microphone. The web view is Safari's engine, not Chrome's, so each of these is worth a look.
- Open at Login, which the Electron build offers in its menu, is not in this one yet.
