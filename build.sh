#!/bin/zsh
set -euo pipefail
task_root="${0:A:h}"
task_destination="${1:-$task_root/dist}"
task_version="$(cat "$task_root/VERSION")"
[[ "$task_version" =~ '^[0-9]+\.[0-9]+\.[0-9]+$' ]] || { print -u2 'Invalid VERSION'; exit 2; }
task_archs_request="${RV_ARCHS:-$(uname -m)}"
task_archs=("${(@s: :)task_archs_request}")
for task_arch in "${task_archs[@]}"; do
  [[ "$task_arch" == arm64 || "$task_arch" == x86_64 ]] || { print -u2 "Unsupported architecture: $task_arch"; exit 2; }
done
task_bundle="$task_destination/重新定义价值.app"
mkdir -p "$task_bundle/Contents/MacOS" "$task_bundle/Contents/Resources/web"
task_temporary="$(mktemp -d "$task_destination/.build.XXXXXX")"
trap 'rm -rf "$task_temporary"' EXIT
task_sdk="$(xcrun --sdk macosx --show-sdk-path)"
task_frameworks=(-framework AppKit -framework WebKit -framework Security -framework CryptoKit -framework Network -framework UserNotifications)
task_executables=()
for task_arch in "${task_archs[@]}"; do
  print "Building $task_arch"
  task_executable="$task_temporary/Redefine-$task_arch"
  swiftc -parse-as-library -swift-version 5 -O -sdk "$task_sdk" -target "$task_arch-apple-macosx13.0" "$task_root/Native.swift" "$task_root/Integration.swift" "$task_root/FinanceVault.swift" -o "$task_executable" "${task_frameworks[@]}"
  task_executables+=("$task_executable")
done
lipo -create "${task_executables[@]}" -output "$task_bundle/Contents/MacOS/Redefine"
cp "$task_root"/web/{index.html,app.js,core.js,style.css} "$task_bundle/Contents/Resources/web/"
cat > "$task_bundle/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>Redefine</string>
<key>CFBundleIdentifier</key><string>local.zaichang.desktop</string>
<key>CFBundleName</key><string>重新定义价值</string>
<key>CFBundleDisplayName</key><string>重新定义价值</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>$task_version</string>
<key>CFBundleVersion</key><string>19</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>LSUIElement</key><true/>
<key>NSHighResolutionCapable</key><true/>
<key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>
PLIST
codesign --force --sign - "$task_bundle"
codesign --verify --deep --strict "$task_bundle"
print "已生成：$task_bundle"
