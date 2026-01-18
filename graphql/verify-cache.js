/*
 * Simple verification script to test cache functionality
 * Run with: node verify-cache.js
 */

const { Neo4jGraphQL } = require('./dist/index.js');

const typeDefs = `
    type User @node {
        id: ID! @id
        name: String!
        email: String!
        posts: [Post!]! @relationship(type: "AUTHORED", direction: OUT)
    }

    type Post @node {
        id: ID! @id
        title: String!
        content: String!
        authors: [User!]! @relationship(type: "AUTHORED", direction: IN)
        comments: [Comment!]! @relationship(type: "HAS_COMMENT", direction: OUT)
    }

    type Comment @node {
        id: ID! @id
        text: String!
        post: [Post!]! @relationship(type: "HAS_COMMENT", direction: IN)
        authors: [User!]! @relationship(type: "WROTE", direction: IN)
    }
`;

async function verifyCache() {
    console.log('🧪 Verifying Neo4j GraphQL Cache Implementation\n');
    
    // Test 1: No cache baseline
    console.log('1️⃣  Testing WITHOUT cache...');
    console.time('   No cache');
    const noCacheSchema = new Neo4jGraphQL({
        typeDefs,
        cache: { enabled: false },
    });
    await noCacheSchema.getSchema();
    console.timeEnd('   No cache');
    
    // Test 2: First run with cache (miss)
    console.log('\n2️⃣  Testing WITH cache (first run - cache miss)...');
    console.time('   Cache miss');
    const schema1 = new Neo4jGraphQL({
        typeDefs,
        cache: {
            enabled: true,
            level: 'both',
            directory: '.test-verify-cache',
        },
    });
    await schema1.getSchema();
    console.timeEnd('   Cache miss');
    
    // Test 3: Second run with cache (hit)
    console.log('\n3️⃣  Testing WITH cache (second run - cache hit)...');
    console.time('   Cache hit');
    const schema2 = new Neo4jGraphQL({
        typeDefs,
        cache: {
            enabled: true,
            level: 'both',
            directory: '.test-verify-cache',
        },
    });
    await schema2.getSchema();
    console.timeEnd('   Cache hit');
    
    // Get statistics
    const stats = await schema2.getCacheStats();
    
    console.log('\n📊 Cache Statistics:');
    console.log('   AST Cache:');
    console.log('     Entries:', stats.ast.entries);
    console.log('     Size:', stats.ast.totalSize, 'bytes');
    console.log('   Model Cache:');
    console.log('     Entries:', stats.model.entries);
    console.log('     Size:', stats.model.totalSize, 'bytes');
    
    // Verify cache is working
    console.log('\n✅ Verification Results:');
    
    if (stats.ast.entries > 0) {
        console.log('   ✅ AST cache is working!');
    } else {
        console.log('   ❌ AST cache is NOT working');
    }
    
    if (stats.model.entries > 0) {
        console.log('   ✅ Schema model cache is working!');
    } else {
        console.log('   ❌ Schema model cache is NOT working');
    }
    
    // Cleanup
    await schema2.clearCache();
    console.log('\n🧹 Cache cleaned up');
    
    console.log('\n🎉 Verification complete!');
}

verifyCache().catch((error) => {
    console.error('❌ Error during verification:', error);
    process.exit(1);
});
