#!/bin/bash
# Remove macOS extended attributes from dist directory
# This ensures the extension works on Windows

if [ -d "dist" ]; then
  echo "Removing macOS extended attributes from dist directory..."
  find dist -print0 | xargs -0 xattr -c 2>/dev/null || true
  echo "✓ Extended attributes removed"
else
  echo "No dist directory found"
fi
