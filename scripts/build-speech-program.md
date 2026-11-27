# Building the speech program

Talqava writes out speech with whisper.cpp's server, run beside the app (see `src/local/speech.ts`). The program is not kept in this repository. The computer that makes a release builds it once and puts it where the desktop build picks it up:

    vendor/whisper/<system>-<chip>/whisper-server      for example vendor/whisper/darwin-arm64/whisper-server
    vendor/whisper/LICENSE.whisper.cpp.txt             whisper.cpp's licence, shipped beside it

`vendor/whisper/` is ignored by git. `desktop/prepare-server.mjs` copies it into the app when it is there; without it the app works and simply shows no microphone.

## On a Mac with Apple's command-line tools

It needs CMake (any recent one; `python3 -m venv venv && ./venv/bin/pip install cmake` gives one without installing anything system-wide).

    git clone --depth 1 --branch v1.9.6 https://github.com/ggml-org/whisper.cpp
    cd whisper.cpp
    cmake -B build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_EXAMPLES=ON -DWHISPER_BUILD_SERVER=ON
    cmake --build build --target whisper-server -j 6
    strip -x build/bin/whisper-server
    codesign --force -s - build/bin/whisper-server

`BUILD_SHARED_LIBS=OFF` gives one file that needs only what macOS already has (Accelerate and Metal), checked with `otool -L`. Copy `build/bin/whisper-server` and the repository's `LICENSE` to the places above.

## What was checked, 27 November 2026

Built from v1.9.6 on an Apple-chip Mac (about 8 MB). With the Standard model (`ggml-base.bin`, 142 MiB, SHA-1 `465707469ff3a37a2b9b8d8f89f2f99de7299dac`) Talqava's own code wrote out whisper.cpp's 11-second sample recording correctly. The first request took about 13 seconds (the model loads and the graphics code is prepared); the next took under a second.

Not built or tried: Intel Macs, Windows and Linux.
