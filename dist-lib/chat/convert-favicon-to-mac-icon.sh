#!/bin/zsh

# Create necessary directories
mkdir -p android ios macos

# Create macOS icon with padding
padding=50 && convert -background none -density 300 three.ws-chat5.svg -resize $((512-2*$padding))x$((512-2*$padding)) -gravity center -extent 512x512 macos/icon.png

# Create Android launcher icon (no padding)
convert -background none -density 300 three.ws-chat5.svg -resize 512x512 android/android-launchericon-512-512.png

# Create iOS icon (no padding)
convert -background none -density 300 three.ws-chat5.svg -resize 180x180 ios/180.png

echo "✅ All icons generated successfully!"