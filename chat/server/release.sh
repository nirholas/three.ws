#!/bin/bash

# Define the list of GOOS values
GOOS_VALUES=("darwin" "linux" "windows")

rm -r ./dist
mkdir -p ./dist

# Loop through each GOOS value
for GOOS in "${GOOS_VALUES[@]}"; do
    # Set GOARCH to arm64 for Mac (darwin)
    if [ "$GOOS" == "darwin" ]; then
        GOARCH="arm64"
    else
        GOARCH="amd64"
    fi

    # Set the output file name
    OUTPUT_FILE="./dist/three.ws-chat-${GOOS}-${GOARCH}"

    # Append .exe for Windows builds
    if [ "$GOOS" == "windows" ]; then
        OUTPUT_FILE="${OUTPUT_FILE}.exe"
    fi

    echo "Building for GOOS=$GOOS GOARCH=$GOARCH"

    # Build the Go project
    GOOS=$GOOS GOARCH=$GOARCH go build -tags release -o $OUTPUT_FILE

    # Check if the build was successful
    if [ $? -ne 0 ]; then
        echo "Build failed for GOOS=$GOOS GOARCH=$GOARCH"
        exit 1
    fi
done

# Create a new release with the new builds
gh release create v0.0.6 dist/* --notes '' && echo "Build and release process completed successfully."
