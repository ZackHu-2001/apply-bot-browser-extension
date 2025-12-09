#!/bin/bash
# Package extension for distribution without macOS extended attributes

set -e

DIST_DIR="dist"
PACKAGE_NAME="apply-bot-extension.zip"

echo "Creating clean distribution package..."

# Remove old package
rm -f "$PACKAGE_NAME"

# Create zip file excluding macOS extended attributes and metadata
# -r: recursive
# -X: exclude extended attributes
# -x: exclude .DS_Store files
echo "Creating zip package without extended attributes..."
cd "$DIST_DIR" && zip -r -X "../$PACKAGE_NAME" . -x "*.DS_Store" && cd ..

echo "✓ Package created: $PACKAGE_NAME"
echo "This package should work on Windows Chrome"
