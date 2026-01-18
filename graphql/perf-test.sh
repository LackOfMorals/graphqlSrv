#!/bin/bash

# Comprehensive performance test script
# Usage: ./perf-test.sh [schema-file]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "🚀 Neo4j GraphQL Cache Performance Test"
echo "========================================"
echo ""

# Check if build exists
if [ ! -d "dist" ]; then
    echo "❌ Build not found. Building..."
    yarn build
    echo ""
fi

# Configuration
SCHEMA_FILE=${1:-""}
NEO4J_URI=${NEO4J_URI:-""}
ITERATIONS=${ITERATIONS:-5}

if [ -n "$SCHEMA_FILE" ]; then
    echo "📖 Schema: $SCHEMA_FILE"
else
    echo "📖 Schema: Example (no file provided)"
fi

echo "🔢 Iterations: $ITERATIONS"

if [ -n "$NEO4J_URI" ]; then
    echo "🗄️  Database: $NEO4J_URI"
else
    echo "🗄️  Database: None (schema generation only)"
fi

echo ""
echo "🧪 Running performance tests..."
echo ""

# Run the performance test
if [ -n "$SCHEMA_FILE" ]; then
    ITERATIONS=$ITERATIONS node performance-test.js "$SCHEMA_FILE"
else
    ITERATIONS=$ITERATIONS node performance-test.js
fi

# Show results
echo ""
echo "📊 Results saved to: .perf-test-cache/performance-results.json"
echo ""

# Pretty print key results
if command -v jq &> /dev/null; then
    echo "🔑 Key Metrics:"
    jq '.improvement' .perf-test-cache/performance-results.json
    echo ""
fi

echo "✅ Performance test complete!"
echo ""
echo "💡 Next steps:"
echo "   - Review detailed results in .perf-test-cache/performance-results.json"
echo "   - Compare with different cache levels"
echo "   - Test with your production schema"
echo ""
