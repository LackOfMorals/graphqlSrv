#!/bin/bash

# Optimized Node.js Startup Script for GraphQL
# Automatically configures optimal Node.js flags based on system

set -e

# Detect available memory
if command -v free &> /dev/null; then
    # Linux
    TOTAL_MEM=$(free -m | awk '/^Mem:/{print $2}')
elif command -v sysctl &> /dev/null; then
    # macOS
    TOTAL_MEM=$(($(sysctl -n hw.memsize) / 1024 / 1024))
else
    # Default fallback
    TOTAL_MEM=4096
fi

# Calculate heap size (50% of available RAM, max 8GB)
HEAP_SIZE=$((TOTAL_MEM / 2))
if [ $HEAP_SIZE -gt 8192 ]; then
    HEAP_SIZE=8192
fi

# Minimum heap size
if [ $HEAP_SIZE -lt 512 ]; then
    HEAP_SIZE=512
fi

echo "🚀 Starting Neo4j GraphQL Server"
echo "================================="
echo ""
echo "System Configuration:"
echo "  Total RAM: ${TOTAL_MEM} MB"
echo "  Heap Size: ${HEAP_SIZE} MB"
echo "  CPUs: $(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 'unknown')"
echo ""

# Determine if we should use cluster mode
USE_CLUSTER=${USE_CLUSTER:-false}
if [ "$USE_CLUSTER" = "true" ]; then
    echo "🔀 Mode: Cluster (multi-process)"
    echo ""
    exec node \
        --max-old-space-size=$HEAP_SIZE \
        --optimize-for-size \
        --max-semi-space-size=64 \
        --gc-interval=100 \
        cluster.js
else
    echo "🔹 Mode: Single process"
    echo ""
    
    # Development vs Production
    if [ "${NODE_ENV}" = "production" ]; then
        echo "Environment: Production"
        echo ""
        exec node \
            --max-old-space-size=$HEAP_SIZE \
            --optimize-for-size \
            --max-semi-space-size=64 \
            --gc-interval=100 \
            dist/index.js
    else
        echo "Environment: Development"
        echo ""
        exec node \
            --max-old-space-size=$HEAP_SIZE \
            --expose-gc \
            dist/index.js
    fi
fi
