#!/bin/bash
# Builds Talqava's native Mac app: dist/Talqava.app.
#
# It needs only what a Mac with Apple's command-line tools has (swiftc, lipo, sips, iconutil, codesign) and Node,
# the same Node that runs Talqava from source. No Xcode project: the app is one Swift file, and the bundle is put
# together here. The app is signed ad hoc, which is enough to run it on the Mac that built it; a release for other
# people needs a Developer ID signature and Apple's notarization, which this script does not do.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/.." && pwd)"
app="$here/dist/Talqava.app"
version="$(node -p "require('$root/desktop/package.json').version")"
arch="$(uname -m)"
[ "$arch" = "arm64" ] || { echo "This script builds for Apple-chip Macs. This Mac is $arch."; exit 1; }

echo "1. The server (the same files the Electron build uses)"
node "$root/desktop/prepare-server.mjs" >/dev/null

echo "2. The app"
rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
swiftc -O -swift-version 5 -target arm64-apple-macos13 "$here/Sources/main.swift" -o "$app/Contents/MacOS/Talqava"
cp -R "$root/desktop/build/server" "$app/Contents/Resources/server"

echo "3. Node, to run the server"
node_from="$(node -p process.execPath)"
node -e 'const [a,b]=process.versions.node.split(".").map(Number); if (a<22||(a===22&&b<18)) { console.error("Talqava needs Node 22.18 or newer; this is "+process.versions.node); process.exit(1) }'
if lipo -info "$node_from" 2>/dev/null | grep -q "Architectures in the fat file"; then lipo -thin arm64 "$node_from" -output "$app/Contents/Resources/node"; else cp "$node_from" "$app/Contents/Resources/node"; fi
chmod 755 "$app/Contents/Resources/node"
# Names used only for debugging are taken out, which makes it about a quarter smaller; it is signed again below.
strip -x "$app/Contents/Resources/node" 2>/dev/null || true
# Node's own licence travels with it.
node_licence="$(dirname "$(dirname "$node_from")")/share/doc/node/LICENSE"
[ -f "$node_licence" ] && cp "$node_licence" "$app/Contents/Resources/LICENSE.node.txt" || echo "   (Node's LICENSE file was not found beside it; add it before giving the app to anyone)"

echo "4. The icon"
set="$here/build/Talqava.iconset"
rm -rf "$set" && mkdir -p "$set"
for size in 16 32 128 256 512; do
  sips -z $size $size "$root/desktop/assets/icon.png" --out "$set/icon_${size}x${size}.png" >/dev/null
  sips -z $((size * 2)) $((size * 2)) "$root/desktop/assets/icon.png" --out "$set/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$set" -o "$app/Contents/Resources/Talqava.icns"

cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Talqava</string>
  <key>CFBundleDisplayName</key><string>Talqava</string>
  <key>CFBundleIdentifier</key><string>com.talqava.agents</string>
  <key>CFBundleExecutable</key><string>Talqava</string>
  <key>CFBundleIconFile</key><string>Talqava</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${version}</string>
  <key>CFBundleVersion</key><string>${version}</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.productivity</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
  <key>NSHumanReadableCopyright</key><string>Copyright © 2026 GR Investments LLC</string>
  <key>NSMicrophoneUsageDescription</key><string>Talqava uses the microphone only when you press Record a voice memo in a note, or the microphone button to speak instead of typing. What you say stays on this computer.</string>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict>
</plist>
PLIST

echo "5. Signing (ad hoc)"
[ -f "$app/Contents/Resources/server/vendor/whisper/darwin-arm64/whisper-server" ] && codesign --force -s - "$app/Contents/Resources/server/vendor/whisper/darwin-arm64/whisper-server"
codesign --force -s - "$app/Contents/Resources/node"
codesign --force -s - "$app"
codesign --verify --strict "$app"

echo "Built $app ($(du -sh "$app" | cut -f1)), version $version"
