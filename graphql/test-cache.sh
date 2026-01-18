#!/bin/bash

# Quick test script for cache implementation
# Usage: ./test-cache.sh

echo "🧪 Testing Neo4j GraphQL Cache Implementation"
echo "=============================================="
echo ""

echo "1️⃣  Testing Serialization System..."
npm test -- src/cache/serialization/schema-model-serializer.test.ts
SERIALIZATION_RESULT=$?

echo ""
echo "2️⃣  Testing AST Cache..."
npm test -- src/cache/ASTCache.test.ts
AST_RESULT=$?

echo ""
echo "3️⃣  Testing Schema Model Cache..."
npm test -- src/cache/SchemaModelCache.test.ts
MODEL_RESULT=$?

echo ""
echo "4️⃣  Testing Neo4jGraphQL Integration..."
npm test -- src/classes/Neo4jGraphQL.cache.test.ts
INTEGRATION_RESULT=$?

echo ""
echo "5️⃣  Testing E2E Performance..."
npm test -- src/cache/e2e-cache-performance.test.ts
E2E_RESULT=$?

echo ""
echo "=============================================="
echo "📊 Test Results Summary"
echo "=============================================="

if [ $SERIALIZATION_RESULT -eq 0 ]; then
    echo "✅ Serialization tests: PASSED"
else
    echo "❌ Serialization tests: FAILED"
fi

if [ $AST_RESULT -eq 0 ]; then
    echo "✅ AST cache tests: PASSED"
else
    echo "❌ AST cache tests: FAILED"
fi

if [ $MODEL_RESULT -eq 0 ]; then
    echo "✅ Schema model cache tests: PASSED"
else
    echo "❌ Schema model cache tests: FAILED"
fi

if [ $INTEGRATION_RESULT -eq 0 ]; then
    echo "✅ Integration tests: PASSED"
else
    echo "❌ Integration tests: FAILED"
fi

if [ $E2E_RESULT -eq 0 ]; then
    echo "✅ E2E tests: PASSED"
else
    echo "❌ E2E tests: FAILED"
fi

echo ""

# Overall result
if [ $SERIALIZATION_RESULT -eq 0 ] && [ $AST_RESULT -eq 0 ] && [ $MODEL_RESULT -eq 0 ] && [ $INTEGRATION_RESULT -eq 0 ] && [ $E2E_RESULT -eq 0 ]; then
    echo "🎉 All tests passed! Implementation is complete and working."
    exit 0
else
    echo "⚠️  Some tests failed. Review the output above."
    exit 1
fi
