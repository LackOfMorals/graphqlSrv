/*
 * Combined Performance and Memory Test
 * 
 * Measures both time AND memory for complete picture
 * 
 * Usage:
 *   node perf-memory-test.js path/to/schema.graphql
 */

const { Neo4jGraphQL } = require('./dist/index.js');
const neo4j = require('neo4j-driver');
const fs = require('fs').promises;
const path = require('path');

const config = {
    neo4jUri: process.env.NEO4J_URI,
    neo4jUser: process.env.NEO4J_USER || 'neo4j',
    neo4jPassword: process.env.NEO4J_PASSWORD,
    iterations: parseInt(process.env.ITERATIONS) || 3,
    cacheDir: '.perf-memory-cache',
};

function formatBytes(bytes) {
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

async function forceGC() {
    if (global.gc) {
        global.gc();
        await new Promise(resolve => setTimeout(resolve, 100));
    }
}

async function measureWithMemory(name, fn) {
    await forceGC();
    
    const memBefore = process.memoryUsage();
    const start = Date.now();
    
    await fn();
    
    const duration = Date.now() - start;
    const memAfter = process.memoryUsage();
    
    return {
        name,
        duration,
        memory: {
            before: memBefore.heapUsed,
            after: memAfter.heapUsed,
            delta: memAfter.heapUsed - memBefore.heapUsed,
            peak: memAfter.heapUsed,
        },
    };
}

async function loadTypeDefs() {
    if (process.argv[2]) {
        return await fs.readFile(path.resolve(process.argv[2]), 'utf-8');
    }
    
    return `
        type User @node {
            id: ID! @id
            name: String!
            posts: [Post!]! @relationship(type: "AUTHORED", direction: OUT)
        }
        type Post @node {
            id: ID! @id
            title: String!
            authors: [User!]! @relationship(type: "AUTHORED", direction: IN)
        }
    `;
}

async function runTest() {
    console.log('🚀 Combined Performance & Memory Test');
    console.log('======================================\n');

    const typeDefs = await loadTypeDefs();
    const typeCount = (typeDefs.match(/type\s+\w+/g) || []).length;

    console.log(`📊 Schema: ${typeCount} types`);
    console.log(`🔢 Iterations: ${config.iterations}\n`);

    const results = {
        noCache: [],
        bothCaches: [],
    };

    // Clean cache
    await fs.rm(config.cacheDir, { recursive: true, force: true }).catch(() => {});

    // Test without cache
    console.log('1️⃣  Without Cache');
    for (let i = 0; i < config.iterations; i++) {
        const result = await measureWithMemory(`No cache ${i + 1}`, async () => {
            let driver;
            if (config.neo4jUri && config.neo4jPassword) {
                driver = neo4j.driver(
                    config.neo4jUri,
                    neo4j.auth.basic(config.neo4jUser, config.neo4jPassword)
                );
            }
            
            const schema = new Neo4jGraphQL({
                typeDefs,
                driver,
                cache: { enabled: false },
            });
            await schema.getSchema();
            
            if (driver) await driver.close();
        });
        
        results.noCache.push(result);
        console.log(`   ${i + 1}. ${result.duration}ms | Heap: ${formatBytes(result.memory.peak)} (+${formatBytes(result.memory.delta)})`);
    }

    // Clean cache
    await fs.rm(config.cacheDir, { recursive: true, force: true }).catch(() => {});

    // Test with cache - first run (miss)
    console.log('\n2️⃣  With Cache - First Run (miss)');
    const cacheMiss = await measureWithMemory('Cache miss', async () => {
        let driver;
        if (config.neo4jUri && config.neo4jPassword) {
            driver = neo4j.driver(
                config.neo4jUri,
                neo4j.auth.basic(config.neo4jUser, config.neo4jPassword)
            );
        }
        
        const schema = new Neo4jGraphQL({
            typeDefs,
            driver,
            cache: { enabled: true, level: 'both', directory: config.cacheDir },
        });
        await schema.getSchema();
        
        if (driver) await driver.close();
    });
    console.log(`   ${cacheMiss.duration}ms | Heap: ${formatBytes(cacheMiss.memory.peak)} (+${formatBytes(cacheMiss.memory.delta)})`);

    // Test with cache - subsequent runs (hit)
    console.log('\n3️⃣  With Cache - Subsequent Runs (hit)');
    for (let i = 0; i < config.iterations; i++) {
        const result = await measureWithMemory(`Cache hit ${i + 1}`, async () => {
            let driver;
            if (config.neo4jUri && config.neo4jPassword) {
                driver = neo4j.driver(
                    config.neo4jUri,
                    neo4j.auth.basic(config.neo4jUser, config.neo4jPassword)
                );
            }
            
            const schema = new Neo4jGraphQL({
                typeDefs,
                driver,
                cache: { enabled: true, level: 'both', directory: config.cacheDir },
            });
            await schema.getSchema();
            
            if (driver) await driver.close();
        });
        
        results.bothCaches.push(result);
        console.log(`   ${i + 1}. ${result.duration}ms | Heap: ${formatBytes(result.memory.peak)} (+${formatBytes(result.memory.delta)})`);
    }

    // Calculate averages
    const avg = (arr, key) => {
        const sum = arr.reduce((acc, r) => acc + r[key], 0);
        return sum / arr.length;
    };

    const avgNoCacheTime = avg(results.noCache, 'duration');
    const avgCacheTime = avg(results.bothCaches, 'duration');
    const avgNoCacheMem = avg(results.noCache.map(r => ({ m: r.memory.peak })), 'm');
    const avgCacheMem = avg(results.bothCaches.map(r => ({ m: r.memory.peak })), 'm');
    const avgNoCacheAlloc = avg(results.noCache.map(r => ({ m: r.memory.delta })), 'm');
    const avgCacheAlloc = avg(results.bothCaches.map(r => ({ m: r.memory.delta })), 'm');

    console.log('\n\n📊 Results Summary');
    console.log('==================\n');

    console.log('⏱️  Time Performance:');
    console.log(`   No cache:     ${avgNoCacheTime.toFixed(2)}ms`);
    console.log(`   With cache:   ${avgCacheTime.toFixed(2)}ms`);
    console.log(`   Improvement:  ${((1 - avgCacheTime / avgNoCacheTime) * 100).toFixed(1)}% faster ⚡\n`);

    console.log('🧠 Memory Usage (Peak Heap):');
    console.log(`   No cache:     ${formatBytes(avgNoCacheMem)}`);
    console.log(`   With cache:   ${formatBytes(avgCacheMem)}`);
    
    const memDiff = avgNoCacheMem - avgCacheMem;
    if (memDiff > 0) {
        console.log(`   Reduction:    ${formatBytes(memDiff)} (${((memDiff / avgNoCacheMem) * 100).toFixed(1)}% less)\n`);
    } else {
        console.log(`   Difference:   ${formatBytes(Math.abs(memDiff))} (${((Math.abs(memDiff) / avgNoCacheMem) * 100).toFixed(1)}% more)\n`);
    }

    console.log('📈 Memory Allocated During Generation:');
    console.log(`   No cache:     ${formatBytes(avgNoCacheAlloc)}`);
    console.log(`   With cache:   ${formatBytes(avgCacheAlloc)}`);
    
    const allocDiff = avgNoCacheAlloc - avgCacheAlloc;
    if (allocDiff > 0) {
        console.log(`   Reduction:    ${formatBytes(allocDiff)} (${((allocDiff / avgNoCacheAlloc) * 100).toFixed(1)}% less)\n`);
    } else {
        console.log(`   Difference:   ${formatBytes(Math.abs(allocDiff))}\n`);
    }

    // Save detailed results
    const detailedResults = {
        timestamp: new Date().toISOString(),
        config,
        schema: { types: typeCount },
        summary: {
            time: {
                noCacheAvg: avgNoCacheTime,
                cacheHitAvg: avgCacheTime,
                improvement: ((1 - avgCacheTime / avgNoCacheTime) * 100).toFixed(1) + '%',
            },
            memory: {
                noCachePeakMB: formatBytes(avgNoCacheMem),
                cacheHitPeakMB: formatBytes(avgCacheMem),
                peakReduction: formatBytes(Math.abs(memDiff)),
                noCacheAllocMB: formatBytes(avgNoCacheAlloc),
                cacheHitAllocMB: formatBytes(avgCacheAlloc),
                allocReduction: formatBytes(Math.abs(allocDiff)),
            },
        },
        detailed: {
            noCache: results.noCache.map(r => ({
                duration: r.duration,
                heapUsedMB: formatBytes(r.memory.peak),
                allocatedMB: formatBytes(r.memory.delta),
            })),
            cacheHit: results.bothCaches.map(r => ({
                duration: r.duration,
                heapUsedMB: formatBytes(r.memory.peak),
                allocatedMB: formatBytes(r.memory.delta),
            })),
        },
    };

    await fs.mkdir(config.cacheDir, { recursive: true });
    await fs.writeFile(
        path.join(config.cacheDir, 'perf-memory-results.json'),
        JSON.stringify(detailedResults, null, 2)
    );

    console.log('💡 Tips:');
    console.log('   - Run with --expose-gc for accurate GC measurements');
    console.log('   - Use HEAP_SNAPSHOT=true for Chrome DevTools analysis');
    console.log('   - Test with production data for realistic results\n');

    console.log(`📄 Detailed results: ${path.join(config.cacheDir, 'perf-memory-results.json')}\n`);
}

runTest().catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
});
