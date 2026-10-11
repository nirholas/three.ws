#!/bin/bash
# Remove dead Economic panel files
rm -v src/components/EconomicPanel.ts \
      src/services/fred.ts \
      src/services/oil-analytics.ts \
      src/services/usa-spending.ts \
      api/fred-data.js \
      "api/eia/[[...path]].js"
rmdir api/eia 2>/dev/null
rm -v scripts/cleanup-economic.sh  # self-destruct
echo "Done - dead Economic panel files removed."
