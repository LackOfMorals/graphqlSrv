/*
 * Advanced Performance Test - Tests both schema generation AND query execution
 * 
 * This shows the full performance impact including actual GraphQL queries
 * 
 * Usage:
 *   node advanced-perf-test.js path/to/typedefs.graphql
 */

const { Neo4jGraphQL } = require('./dist/index.js');
const { graphql } = require('graphql');
const neo4j = require('neo4j-driver');
const fs = require('fs').promises;
const path = require('path');

const config = {
    neo4jUri: process.env.NEO4J_URI,
    neo4jUser: process.env.NEO4J_USER || 'neo4j',
    neo4jPassword: process.env.NEO4J_PASSWORD,
    iterations: parseInt(process.env.ITERATIONS) || 3,
    cacheDir: process.env.CACHE_DIR || '.adv-perf-test-cache',
};

async function loadTypeDefs() {
    if (process.argv[2]) {
        const typedefsPath = path.resolve(process.argv[2]);
        return await fs.readFile(typedefsPath, 'utf-8');
    }

    // Default example
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
        }
    `;
}

function extractTypes(typeDefs) {
    // Extract type names from typedefs
    const typeMatches = typeDefs.match(/type\s+(\w+)/g) || [];
    return typeMatches.map(m => m.replace('type ', '').trim()).filter(t => !['Query', 'Mutation', 'Subscription'].includes(t));
}

function generateTestQueries(types) {
    // Generate simple queries for each type
    return types.map(type => ({
        query: `query { ${type.toLowerCase()}s { id } }`,
        name: `List ${type}s`,
    }));
}

async function measureFullCycle(typeDefs, cacheConfig) {
    const timings = {
        schemaGeneration: 0,
        queryExecution: [],
    };

    let driver;
    if (config.neo4jUri && config.neo4jPassword) {
        driver = neo4j.driver(
            config.neo4jUri,
            neo4j.auth.basic(config.neo4jUser, config.neo4jPassword)
        );
    }

    // Measure schema generation
    const schemaStart = Date.now();
    const neoSchema = new Neo4jGraphQL({
        typeDefs,
        driver,
        cache: cacheConfig,
    });
    const schema = await neoSchema.getSchema();
    timings.schemaGeneration = Date.now() - schemaStart;

    const stats = await neoSchema.getCacheStats();

    // Measure query execution (if database available)
    if (driver) {
        const types = extractTypes(typeDefs);
        const queries = generateTestQueries(types);

        for (const { query, name } of queries.slice(0, 3)) { // Test first 3 types
            const queryStart = Date.now();
            try {
                await graphql({
                    schema,
                    source: query,
                    contextValue: { driver },
                });
                timings.queryExecution.push({
                    name,
                    duration: Date.now() - queryStart,
                });
            } catch (error) {
                // Query might fail if data doesn't exist, that's ok
                timings.queryExecution.push({
                    name,
                    duration: Date.now() - queryStart,
                    error: error.message,
                });
            }
        }

        await driver.close();
    }

    return { timings, stats };
}

async function runAdvancedPerformanceTest() {
    console.log('🚀 Advanced Neo4j GraphQL Performance Test');
    console.log('==========================================\n');

    const typeDefs = await loadTypeDefs();
    const types = extractTypes(typeDefs);

    console.log('📊 Schema Information:');
    console.log(`   Types: ${types.length} (${types.slice(0, 5).join(', ')}${types.length > 5 ? '...' : ''})`);
    console.log(`   Database: ${config.neo4jUri || 'None (schema only)'}`);
    console.log(`   Iterations: ${config.iterations}\n`);

    // Clean cache
    await fs.rm(config.cacheDir, { recursive: true, force: true }).catch(() => {});

    const results = {
        noCache: { schema: [], queries: [] },
        bothCaches: { schema: [], queries: [] },
    };

    // Test without cache
    console.log('1️⃣  Testing WITHOUT cache...');
    for (let i = 0; i < config.iterations; i++) {
        process.stdout.write(`   Iteration ${i + 1}/${config.iterations}...`);
        const { timings } = await measureFullCycle(typeDefs, { enabled: false });
        results.noCache.schema.push(timings.schemaGeneration);
        if (i === 0 && timings.queryExecution.length > 0) {
            results.noCache.queries = timings.queryExecution;
        }
        console.log(` ${timings.schemaGeneration}ms`);
    }

    // Clean and prepare cache
    await fs.rm(config.cacheDir, { recursive: true, force: true }).catch(() => {});

    // Test with both caches
    console.log('\n2️⃣  Testing WITH cache (both levels)...');
    console.log('   First run (cache miss):');
    const { timings: firstRun } = await measureFullCycle(typeDefs, {
        enabled: true,
        level: 'both',
        directory: config.cacheDir,
    });
    console.log(`   ${firstRun.schemaGeneration}ms`);

    console.log('   Subsequent runs (cache hit):');
    for (let i = 0; i < config.iterations; i++) {
        process.stdout.write(`   Iteration ${i + 1}/${config.iterations}...`);
        const { timings, stats } = await measureFullCycle(typeDefs, {
            enabled: true,
            level: 'both',
            directory: config.cacheDir,
        });
        results.bothCaches.schema.push(timings.schemaGeneration);
        if (i === 0 && timings.queryExecution.length > 0) {
            results.bothCaches.queries = timings.queryExecution;
        }
        console.log(` ${timings.schemaGeneration}ms`);
        
        if (i === config.iterations - 1) {
            console.log(`\n   📊 Cache Size:`);
            console.log(`      AST: ${(stats.ast.totalSize / 1024).toFixed(2)} KB`);
            console.log(`      Model: ${(stats.model.totalSize / 1024).toFixed(2)} KB`);
            console.log(`      Total: ${((stats.ast.totalSize + stats.model.totalSize) / 1024).toFixed(2)} KB`);
        }
    }

    // Calculate statistics
    const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
    
    const avgNoCacheSchema = avg(results.noCache.schema);
    const avgCachedSchema = avg(results.bothCaches.schema);
    const improvement = ((1 - avgCachedSchema / avgNoCacheSchema) * 100).toFixed(1);

    console.log('\n\n📈 Performance Results');
    console.log('======================\n');

    console.log('Schema Generation:');
    console.log(`   Without cache: ${avgNoCacheSchema.toFixed(2)}ms (avg)`);
    console.log(`   With cache:    ${avgCachedSchema.toFixed(2)}ms (avg)`);
    console.log(`   Improvement:   ${improvement}% faster ⚡\n`);

    if (results.noCache.queries.length > 0) {
        console.log('Query Execution (First Run):');
        console.log('   Without cache:');
        results.noCache.queries.forEach(q => {
            console.log(`      ${q.name}: ${q.duration}ms ${q.error ? '(error)' : ''}`);
        });
        console.log('   With cache:');
        results.bothCaches.queries.forEach(q => {
            console.log(`      ${q.name}: ${q.duration}ms ${q.error ? '(error)' : ''}`);
        });
        console.log('');
    }

    console.log('🎯 Recommendation:');
    if (parseFloat(improvement) > 60) {
        console.log(`   ✅ Excellent ${improvement}% improvement!`);
        console.log(`   💡 Deploy with: cache: { enabled: true, level: 'both' }`);
    } else if (parseFloat(improvement) > 30) {
        console.log(`   ✅ Good ${improvement}% improvement`);
        console.log(`   💡 Consider: cache: { enabled: true, level: 'both' }`);
    } else {
        console.log(`   ℹ️  Modest ${improvement}% improvement`);
        console.log(`   💡 Benefits increase with schema complexity`);
    }

    console.log('\n📊 Detailed Results:');
    console.log(`   JSON: ${path.join(config.cacheDir, 'advanced-results.json')}\n`);

    // Save results
    await fs.mkdir(config.cacheDir, { recursive: true });
    await fs.writeFile(
        path.join(config.cacheDir, 'advanced-results.json'),
        JSON.stringify({
            timestamp: new Date().toISOString(),
            schema: {
                types: types.length,
                typeDefs: typeDefs.substring(0, 200) + '...',
            },
            config,
            results: {
                schemaGeneration: {
                    noCache: {
                        avg: avgNoCacheSchema,
                        all: results.noCache.schema,
                    },
                    withCache: {
                        avg: avgCachedSchema,
                        all: results.bothCaches.schema,
                    },
                    improvement: improvement + '%',
                },
                queryExecution: {
                    noCache: results.noCache.queries,
                    withCache: results.bothCaches.queries,
                },
            },
        }, null, 2)
    );

    console.log('✅ Performance test complete!\n');
}

runAdvancedPerformanceTest().catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
});
