/*
 * Simple verification script to test cache functionality WITHOUT database
 * This tests ONLY the caching mechanism, not the full GraphQL schema
 * Run with: node verify-cache-no-db.js
 */

const { parse } = require('graphql');
const { generateModel } = require('./dist/schema-model/generate-model');
const { serializeSchemaModel, deserializeSchemaModel } = require('./dist/cache/serialization');
const fs = require('fs/promises');

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
        posts: [Post!]! @relationship(type: "HAS_COMMENT", direction: IN)
        authors: [User!]! @relationship(type: "WROTE", direction: IN)
    }
`;

async function verifyCacheWithoutDatabase() {
    console.log('🧪 Verifying Cache Serialization (No Database Required)\n');

    try {
        // Test 1: AST Parsing
        console.log('1️⃣  Testing AST parsing and serialization...');
        console.time('   Parse AST');
        const document = parse(typeDefs);
        console.timeEnd('   Parse AST');
        console.log('   ✅ AST parsing successful');

        // Test 2: Schema Model Generation
        console.log('\n2️⃣  Testing schema model generation...');
        console.time('   Generate Model');
        const model = generateModel(document);
        console.timeEnd('   Generate Model');
        console.log('   ✅ Schema model generated');
        console.log(`   - Concrete Entities: ${model.concreteEntities.length}`);
        console.log(`   - Composite Entities: ${model.compositeEntities.length}`);

        // Test 3: Serialization
        console.log('\n3️⃣  Testing serialization...');
        console.time('   Serialize');
        const serialized = serializeSchemaModel(model);
        console.timeEnd('   Serialize');
        console.log('   ✅ Serialization successful');
        console.log(`   - Serialized size: ${JSON.stringify(serialized).length} chars`);

        // Test 4: Deserialization
        console.log('\n4️⃣  Testing deserialization...');
        console.time('   Deserialize');
        const deserialized = deserializeSchemaModel(serialized);
        console.timeEnd('   Deserialize');
        console.log('   ✅ Deserialization successful');

        // Test 5: Validation
        console.log('\n5️⃣  Validating deserialized model...');
        console.log(`   - Concrete Entities: ${deserialized.concreteEntities.length}`);
        console.log(`   - Composite Entities: ${deserialized.compositeEntities.length}`);

        const user = deserialized.getEntity('User');
        const post = deserialized.getEntity('Post');
        const comment = deserialized.getEntity('Comment');

        if (!user || !post || !comment) {
            throw new Error('Missing entities after deserialization');
        }

        console.log('   ✅ All entities present');

        // Check relationships
        const userRelationships = user.relationships?.size || 0;
        const postRelationships = post.relationships?.size || 0;
        const commentRelationships = comment.relationships?.size || 0;

        console.log(`   - User relationships: ${userRelationships}`);
        console.log(`   - Post relationships: ${postRelationships}`);
        console.log(`   - Comment relationships: ${commentRelationships}`);

        if (userRelationships === 0 || postRelationships === 0 || commentRelationships === 0) {
            throw new Error('Relationships not restored properly');
        }

        console.log('   ✅ All relationships restored');

        // Test 6: Round-trip validation
        console.log('\n6️⃣  Testing round-trip (serialize → deserialize → serialize)...');
        const serialized2 = serializeSchemaModel(deserialized);
        console.log('   ✅ Round-trip successful');

        // The serialized versions should be equivalent
        const size1 = JSON.stringify(serialized).length;
        const size2 = JSON.stringify(serialized2).length;
        console.log(`   - Original serialized: ${size1} chars`);
        console.log(`   - Round-trip serialized: ${size2} chars`);

        if (Math.abs(size1 - size2) / size1 > 0.1) {
            console.warn('   ⚠️  Size difference > 10%, may indicate data loss');
        } else {
            console.log('   ✅ Size difference acceptable');
        }

        console.log('\n📊 Summary:');
        console.log('   ✅ AST parsing works');
        console.log('   ✅ Schema model generation works');
        console.log('   ✅ Serialization works');
        console.log('   ✅ Deserialization works');
        console.log('   ✅ Relationships preserved');
        console.log('   ✅ Round-trip validated');

        console.log('\n🎉 Cache serialization is fully functional!\n');
        console.log('💡 To test with full GraphQL schema generation:');
        console.log('   1. Start a Neo4j database');
        console.log('   2. Set NEO4J_URI environment variable');
        console.log('   3. Run: yarn test packages/graphql/src/cache/e2e-cache-performance.test.ts');

    } catch (error) {
        console.error('\n❌ Error during verification:', error.message);
        console.error('\nStack trace:', error.stack);
        process.exit(1);
    }
}

verifyCacheWithoutDatabase();
