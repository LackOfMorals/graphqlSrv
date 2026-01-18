/*
 * Performance Testing Script for Neo4j GraphQL Cache
 * 
 * This script measures cache performance with your actual type definitions.
 * 
 * Usage:
 *   node performance-test.js path/to/your/typedefs.graphql
 * 
 * Or with inline typedefs:
 *   TYPEDEFS="type User { ... }" node performance-test.js
 * 
 * Environment variables:
 *   NEO4J_URI - Neo4j connection string (optional for schema generation)
 *   NEO4J_USER - Neo4j username (default: neo4j)
 *   NEO4J_PASSWORD - Neo4j password
 *   TYPEDEFS - Inline type definitions
 *   ITERATIONS - Number of test iterations (default: 5)
 *   CACHE_DIR - Cache directory (default: .perf-test-cache)
 */

const { Neo4jGraphQL } = require('./dist/index.js');
const neo4j = require('neo4j-driver');
const fs = require('fs').promises;
const path = require('path');

// Configuration
const config = {
    neo4jUri: process.env.NEO4J_URI,
    neo4jUser: process.env.NEO4J_USER || 'neo4j',
    neo4jPassword: process.env.NEO4J_PASSWORD,
    iterations: parseInt(process.env.ITERATIONS) || 5,
    cacheDir: process.env.CACHE_DIR || '.perf-test-cache',
};

async function loadTypeDefs() {
    // Option 1: From environment variable
    if (process.env.TYPEDEFS) {
        return process.env.TYPEDEFS;
    }

    // Option 2: From file argument
    if (process.argv[2]) {
        const typedefsPath = path.resolve(process.argv[2]);
        console.log(`📖 Loading type definitions from: ${typedefsPath}`);
        return await fs.readFile(typedefsPath, 'utf-8');
    }

    // Option 3: Default example schema
    console.log('⚠️  No type definitions provided, using example schema');
    console.log('   Provide typedefs with: node performance-test.js path/to/schema.graphql');
    console.log('   Or set TYPEDEFS environment variable\n');
    
    return `
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
            tags: [Tag!]! @relationship(type: "HAS_TAG", direction: OUT)
        }

        type Tag @node {
            id: ID! @id
            name: String!
            posts: [Post!]! @relationship(type: "HAS_TAG", direction: IN)
        }
    `;
}

async function measureSchemaGeneration(typeDefs, cacheConfig) {
    const start = Date.now();
    
    let driver;
    if (config.neo4jUri && config.neo4jPassword) {
        driver = neo4j.driver(
            config.neo4jUri,
            neo4j.auth.basic(config.neo4jUser, config.neo4jPassword)
        );
    }

    const neoSchema = new Neo4jGraphQL({
        typeDefs,
        driver,
        cache: cacheConfig,
    });

    await neoSchema.getSchema();
    const duration = Date.now() - start;

    const stats = await neoSchema.getCacheStats();

    if (driver) {
        await driver.close();
    }

    return { duration, stats };
}

async function runPerformanceTest() {
    console.log('🚀 Neo4j GraphQL Cache Performance Test');
    console.log('=========================================\n');

    const typeDefs = await loadTypeDefs();

    console.log('📊 Configuration:');
    console.log(`   Iterations: ${config.iterations}`);
    console.log(`   Cache directory: ${config.cacheDir}`);
    console.log(`   Database: ${config.neo4jUri || 'None (schema only)'}`);
    console.log(`   Type definitions: ${typeDefs.split('\n').filter(l => l.includes('type ')).length} types\n`);

    // Clean up old cache
    await fs.rm(config.cacheDir, { recursive: true, force: true }).catch(() => {});

    const results = {
        noCache: [],
        astCache: [],
        modelCache: [],
        bothCaches: [],
    };

    console.log('🧪 Running tests...\n');

    // Test 1: No cache baseline
    console.log('1️⃣  No Cache (baseline)');
    for (let i = 0; i < config.iterations; i++) {
        process.stdout.write(`   Iteration ${i + 1}/${config.iterations}...`);
        const { duration } = await measureSchemaGeneration(typeDefs, { enabled: false });
        results.noCache.push(duration);
        console.log(` ${duration}ms`);
    }

    // Clean cache between tests
    await fs.rm(config.cacheDir, { recursive: true, force: true }).catch(() => {});

    // Test 2: AST cache only
    console.log('\n2️⃣  AST Cache Only');
    console.log('   First run (cache miss):');
    const { duration: astMiss } = await measureSchemaGeneration(typeDefs, {
        enabled: true,
        level: 'ast',
        directory: config.cacheDir,
    });
    console.log(`   ${astMiss}ms`);

    console.log('   Subsequent runs (cache hit):');
    for (let i = 0; i < config.iterations; i++) {
        process.stdout.write(`   Iteration ${i + 1}/${config.iterations}...`);
        const { duration } = await measureSchemaGeneration(typeDefs, {
            enabled: true,
            level: 'ast',
            directory: config.cacheDir,
        });
        results.astCache.push(duration);
        console.log(` ${duration}ms`);
    }

    // Clean cache between tests
    await fs.rm(config.cacheDir, { recursive: true, force: true }).catch(() => {});

    // Test 3: Schema model cache only
    console.log('\n3️⃣  Schema Model Cache Only');
    console.log('   First run (cache miss):');
    const { duration: modelMiss } = await measureSchemaGeneration(typeDefs, {
        enabled: true,
        level: 'model',
        directory: config.cacheDir,
    });
    console.log(`   ${modelMiss}ms`);

    console.log('   Subsequent runs (cache hit):');
    for (let i = 0; i < config.iterations; i++) {
        process.stdout.write(`   Iteration ${i + 1}/${config.iterations}...`);
        const { duration } = await measureSchemaGeneration(typeDefs, {
            enabled: true,
            level: 'model',
            directory: config.cacheDir,
        });
        results.modelCache.push(duration);
        console.log(` ${duration}ms`);
    }

    // Clean cache between tests
    await fs.rm(config.cacheDir, { recursive: true, force: true }).catch(() => {});

    // Test 4: Both caches
    console.log('\n4️⃣  Both Caches (Recommended)');
    console.log('   First run (cache miss):');
    const { duration: bothMiss } = await measureSchemaGeneration(typeDefs, {
        enabled: true,
        level: 'both',
        directory: config.cacheDir,
    });
    console.log(`   ${bothMiss}ms`);

    console.log('   Subsequent runs (cache hit):');
    for (let i = 0; i < config.iterations; i++) {
        process.stdout.write(`   Iteration ${i + 1}/${config.iterations}...`);
        const { duration, stats } = await measureSchemaGeneration(typeDefs, {
            enabled: true,
            level: 'both',
            directory: config.cacheDir,
        });
        results.bothCaches.push(duration);
        console.log(` ${duration}ms`);
        
        if (i === config.iterations - 1) {
            console.log(`\n   📊 Cache Stats:`);
            console.log(`      AST: ${stats.ast.entries} entries (${(stats.ast.totalSize / 1024).toFixed(2)} KB)`);
            console.log(`      Model: ${stats.model.entries} entries (${(stats.model.totalSize / 1024).toFixed(2)} KB)`);
        }
    }

    // Calculate statistics
    const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
    const min = (arr) => Math.min(...arr);
    const max = (arr) => Math.max(...arr);

    console.log('\n\n📈 Performance Results');
    console.log('======================\n');

    const avgNoCache = avg(results.noCache);
    const avgAstCache = avg(results.astCache);
    const avgModelCache = avg(results.modelCache);
    const avgBothCaches = avg(results.bothCaches);

    console.log('Average Times:');
    console.log(`   No cache:       ${avgNoCache.toFixed(2)}ms (baseline)`);
    console.log(`   AST cache:      ${avgAstCache.toFixed(2)}ms (${((1 - avgAstCache / avgNoCache) * 100).toFixed(1)}% faster)`);
    console.log(`   Model cache:    ${avgModelCache.toFixed(2)}ms (${((1 - avgModelCache / avgNoCache) * 100).toFixed(1)}% faster)`);
    console.log(`   Both caches:    ${avgBothCaches.toFixed(2)}ms (${((1 - avgBothCaches / avgNoCache) * 100).toFixed(1)}% faster) ⚡`);

    console.log('\nMin/Max Times:');
    console.log(`   No cache:       ${min(results.noCache)}ms - ${max(results.noCache)}ms`);
    console.log(`   AST cache:      ${min(results.astCache)}ms - ${max(results.astCache)}ms`);
    console.log(`   Model cache:    ${min(results.modelCache)}ms - ${max(results.modelCache)}ms`);
    console.log(`   Both caches:    ${min(results.bothCaches)}ms - ${max(results.bothCaches)}ms`);

    console.log('\n🎯 Recommendation:');
    if (avgBothCaches < avgNoCache * 0.5) {
        console.log(`   ✅ Excellent! Both caches provide ${((1 - avgBothCaches / avgNoCache) * 100).toFixed(1)}% improvement`);
        console.log(`   💡 Use: cache: { enabled: true, level: 'both' }`);
    } else if (avgAstCache < avgNoCache * 0.8) {
        console.log(`   ✅ Good! AST cache provides ${((1 - avgAstCache / avgNoCache) * 100).toFixed(1)}% improvement`);
        console.log(`   💡 Use: cache: { enabled: true, level: 'ast' }`);
    } else {
        console.log(`   ℹ️  Cache provides modest improvement`);
        console.log(`   💡 Benefits increase with schema complexity`);
    }

    console.log('\n📝 Export Results:');
    const resultsFile = path.join(config.cacheDir, 'performance-results.json');
    await fs.mkdir(config.cacheDir, { recursive: true });
    await fs.writeFile(resultsFile, JSON.stringify({
        timestamp: new Date().toISOString(),
        config,
        typeDefs: typeDefs.substring(0, 200) + '...',
        results: {
            noCache: { avg: avgNoCache, min: min(results.noCache), max: max(results.noCache), all: results.noCache },
            astCache: { avg: avgAstCache, min: min(results.astCache), max: max(results.astCache), all: results.astCache },
            modelCache: { avg: avgModelCache, min: min(results.modelCache), max: max(results.modelCache), all: results.modelCache },
            bothCaches: { avg: avgBothCaches, min: min(results.bothCaches), max: max(results.bothCaches), all: results.bothCaches },
        },
        improvement: {
            astCache: ((1 - avgAstCache / avgNoCache) * 100).toFixed(1) + '%',
            modelCache: ((1 - avgModelCache / avgNoCache) * 100).toFixed(1) + '%',
            bothCaches: ((1 - avgBothCaches / avgNoCache) * 100).toFixed(1) + '%',
        }
    }, null, 2));
    
    console.log(`   Results saved to: ${resultsFile}`);
    console.log('\n✅ Performance test complete!\n');
}

// Run the test
runPerformanceTest().catch((error) => {
    console.error('❌ Error during performance test:', error);
    process.exit(1);
});
