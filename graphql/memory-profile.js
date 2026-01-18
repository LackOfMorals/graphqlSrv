/*
 * Memory Profiling Script for Neo4j GraphQL
 * 
 * Measures memory usage during schema generation with detailed breakdowns
 * 
 * Usage:
 *   node memory-profile.js path/to/schema.graphql
 * 
 * Environment variables:
 *   TYPEDEFS - Inline type definitions
 *   NEO4J_URI - Neo4j connection (optional)
 *   HEAP_SNAPSHOT - Set to 'true' to capture heap snapshots
 */

const { Neo4jGraphQL } = require('./dist/index.js');
const neo4j = require('neo4j-driver');
const fs = require('fs').promises;
const path = require('path');
const v8 = require('v8');

// Force garbage collection if available
if (global.gc) {
    console.log('✅ Garbage collection available (run with --expose-gc)\n');
} else {
    console.log('⚠️  Garbage collection not available');
    console.log('   Run with: node --expose-gc memory-profile.js\n');
}

// Memory utilities
function getMemoryUsage() {
    const usage = process.memoryUsage();
    return {
        heapUsed: usage.heapUsed,
        heapTotal: usage.heapTotal,
        external: usage.external,
        rss: usage.rss,
        arrayBuffers: usage.arrayBuffers,
    };
}

function formatBytes(bytes) {
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function getMemoryDiff(before, after) {
    return {
        heapUsed: after.heapUsed - before.heapUsed,
        heapTotal: after.heapTotal - before.heapTotal,
        external: after.external - before.external,
        rss: after.rss - before.rss,
    };
}

async function forceGC() {
    if (global.gc) {
        global.gc();
        // Wait a bit for GC to complete
        await new Promise(resolve => setTimeout(resolve, 100));
    }
}

async function captureHeapSnapshot(name) {
    if (process.env.HEAP_SNAPSHOT !== 'true') {
        return;
    }
    
    const filename = `heap-${name}-${Date.now()}.heapsnapshot`;
    const snapshot = v8.writeHeapSnapshot(filename);
    console.log(`   📸 Heap snapshot saved: ${snapshot}`);
}

async function loadTypeDefs() {
    if (process.env.TYPEDEFS) {
        return process.env.TYPEDEFS;
    }

    if (process.argv[2]) {
        const typedefsPath = path.resolve(process.argv[2]);
        return await fs.readFile(typedefsPath, 'utf-8');
    }

    // Default example
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

async function profileMemory() {
    console.log('🧠 Neo4j GraphQL Memory Profiling');
    console.log('==================================\n');

    const typeDefs = await loadTypeDefs();
    const typeCount = (typeDefs.match(/type\s+\w+/g) || []).length;
    
    console.log('📊 Schema Info:');
    console.log(`   Types: ${typeCount}`);
    console.log(`   Size: ${(typeDefs.length / 1024).toFixed(2)} KB\n`);

    let driver;
    if (process.env.NEO4J_URI && process.env.NEO4J_PASSWORD) {
        driver = neo4j.driver(
            process.env.NEO4J_URI,
            neo4j.auth.basic(process.env.NEO4J_USER || 'neo4j', process.env.NEO4J_PASSWORD)
        );
        console.log('🗄️  Database connection: Enabled\n');
    } else {
        console.log('🗄️  Database connection: Disabled (schema generation only)\n');
    }

    // ==========================================
    // Test 1: Without Cache
    // ==========================================
    
    console.log('1️⃣  Memory Usage WITHOUT Cache');
    console.log('================================\n');

    await forceGC();
    const baseline = getMemoryUsage();
    console.log('📍 Baseline memory:');
    console.log(`   Heap Used:  ${formatBytes(baseline.heapUsed)}`);
    console.log(`   Heap Total: ${formatBytes(baseline.heapTotal)}`);
    console.log(`   RSS:        ${formatBytes(baseline.rss)}\n`);

    await captureHeapSnapshot('before-no-cache');

    console.log('⏱️  Generating schema...');
    const startTime1 = Date.now();
    const memBefore1 = getMemoryUsage();

    const neoSchema1 = new Neo4jGraphQL({
        typeDefs,
        driver,
        cache: { enabled: false },
    });

    await neoSchema1.getSchema();
    
    const duration1 = Date.now() - startTime1;
    const memAfter1 = getMemoryUsage();
    const memDiff1 = getMemoryDiff(memBefore1, memAfter1);

    await captureHeapSnapshot('after-no-cache');

    console.log(`   ✅ Complete in ${duration1}ms\n`);
    console.log('📊 Memory Impact:');
    console.log(`   Heap Used:  ${formatBytes(memAfter1.heapUsed)} (+${formatBytes(memDiff1.heapUsed)})`);
    console.log(`   Heap Total: ${formatBytes(memAfter1.heapTotal)} (+${formatBytes(memDiff1.heapTotal)})`);
    console.log(`   RSS:        ${formatBytes(memAfter1.rss)} (+${formatBytes(memDiff1.rss)})`);
    console.log(`   External:   ${formatBytes(memAfter1.external)} (+${formatBytes(memDiff1.external)})\n`);

    if (driver) {
        await driver.close();
    }

    // ==========================================
    // Test 2: With Cache (First Run)
    // ==========================================

    console.log('2️⃣  Memory Usage WITH Cache (First Run - Building Cache)');
    console.log('==========================================================\n');

    await forceGC();
    const cacheDir = '.memory-profile-cache';
    await fs.rm(cacheDir, { recursive: true, force: true }).catch(() => {});

    await captureHeapSnapshot('before-cache-miss');

    console.log('⏱️  Generating schema with cache (miss)...');
    const startTime2 = Date.now();
    const memBefore2 = getMemoryUsage();

    let driver2;
    if (process.env.NEO4J_URI && process.env.NEO4J_PASSWORD) {
        driver2 = neo4j.driver(
            process.env.NEO4J_URI,
            neo4j.auth.basic(process.env.NEO4J_USER || 'neo4j', process.env.NEO4J_PASSWORD)
        );
    }

    const neoSchema2 = new Neo4jGraphQL({
        typeDefs,
        driver: driver2,
        cache: {
            enabled: true,
            level: 'both',
            directory: cacheDir,
        },
    });

    await neoSchema2.getSchema();
    
    const duration2 = Date.now() - startTime2;
    const memAfter2 = getMemoryUsage();
    const memDiff2 = getMemoryDiff(memBefore2, memAfter2);

    await captureHeapSnapshot('after-cache-miss');

    console.log(`   ✅ Complete in ${duration2}ms\n`);
    console.log('📊 Memory Impact:');
    console.log(`   Heap Used:  ${formatBytes(memAfter2.heapUsed)} (+${formatBytes(memDiff2.heapUsed)})`);
    console.log(`   Heap Total: ${formatBytes(memAfter2.heapTotal)} (+${formatBytes(memDiff2.heapTotal)})`);
    console.log(`   RSS:        ${formatBytes(memAfter2.rss)} (+${formatBytes(memDiff2.rss)})\n`);

    if (driver2) {
        await driver2.close();
    }

    // ==========================================
    // Test 3: With Cache (Second Run - Using Cache)
    // ==========================================

    console.log('3️⃣  Memory Usage WITH Cache (Second Run - Using Cache)');
    console.log('========================================================\n');

    await forceGC();
    
    await captureHeapSnapshot('before-cache-hit');

    console.log('⏱️  Generating schema with cache (hit)...');
    const startTime3 = Date.now();
    const memBefore3 = getMemoryUsage();

    let driver3;
    if (process.env.NEO4J_URI && process.env.NEO4J_PASSWORD) {
        driver3 = neo4j.driver(
            process.env.NEO4J_URI,
            neo4j.auth.basic(process.env.NEO4J_USER || 'neo4j', process.env.NEO4J_PASSWORD)
        );
    }

    const neoSchema3 = new Neo4jGraphQL({
        typeDefs,
        driver: driver3,
        cache: {
            enabled: true,
            level: 'both',
            directory: cacheDir,
        },
    });

    await neoSchema3.getSchema();
    
    const duration3 = Date.now() - startTime3;
    const memAfter3 = getMemoryUsage();
    const memDiff3 = getMemoryDiff(memBefore3, memAfter3);

    await captureHeapSnapshot('after-cache-hit');

    console.log(`   ✅ Complete in ${duration3}ms\n`);
    console.log('📊 Memory Impact:');
    console.log(`   Heap Used:  ${formatBytes(memAfter3.heapUsed)} (+${formatBytes(memDiff3.heapUsed)})`);
    console.log(`   Heap Total: ${formatBytes(memAfter3.heapTotal)} (+${formatBytes(memDiff3.heapTotal)})`);
    console.log(`   RSS:        ${formatBytes(memAfter3.rss)} (+${formatBytes(memDiff3.rss)})\n`);

    // Get cache stats
    const stats = await neoSchema3.getCacheStats();
    console.log('📦 Cache Size:');
    console.log(`   AST:   ${formatBytes(stats.ast.totalSize)}`);
    console.log(`   Model: ${formatBytes(stats.model.totalSize)}`);
    console.log(`   Total: ${formatBytes(stats.ast.totalSize + stats.model.totalSize)}\n`);

    if (driver3) {
        await driver3.close();
    }

    // ==========================================
    // Summary
    // ==========================================

    console.log('📈 Summary');
    console.log('===========\n');

    console.log('Time:');
    console.log(`   No cache:       ${duration1}ms`);
    console.log(`   Cache (miss):   ${duration2}ms`);
    console.log(`   Cache (hit):    ${duration3}ms`);
    console.log(`   Improvement:    ${((1 - duration3 / duration1) * 100).toFixed(1)}% faster\n`);

    console.log('Peak Memory (Heap Used):');
    console.log(`   No cache:       ${formatBytes(memAfter1.heapUsed)}`);
    console.log(`   Cache (miss):   ${formatBytes(memAfter2.heapUsed)}`);
    console.log(`   Cache (hit):    ${formatBytes(memAfter3.heapUsed)}`);
    
    const memSavings = memAfter1.heapUsed - memAfter3.heapUsed;
    if (memSavings > 0) {
        console.log(`   Savings:        ${formatBytes(memSavings)} (${((memSavings / memAfter1.heapUsed) * 100).toFixed(1)}% reduction)\n`);
    } else {
        console.log(`   Difference:     ${formatBytes(Math.abs(memSavings))} (${((Math.abs(memSavings) / memAfter1.heapUsed) * 100).toFixed(1)}% increase)\n`);
    }

    console.log('Memory Allocated During Generation:');
    console.log(`   No cache:       ${formatBytes(memDiff1.heapUsed)}`);
    console.log(`   Cache (miss):   ${formatBytes(memDiff2.heapUsed)}`);
    console.log(`   Cache (hit):    ${formatBytes(memDiff3.heapUsed)}`);
    
    const allocSavings = memDiff1.heapUsed - memDiff3.heapUsed;
    if (allocSavings > 0) {
        console.log(`   Reduction:      ${formatBytes(allocSavings)} (${((allocSavings / memDiff1.heapUsed) * 100).toFixed(1)}% less)\n`);
    } else {
        console.log(`   Difference:     ${formatBytes(Math.abs(allocSavings))}\n`);
    }

    // Save results
    const results = {
        timestamp: new Date().toISOString(),
        schema: {
            types: typeCount,
            sizeKB: (typeDefs.length / 1024).toFixed(2),
        },
        time: {
            noCache: duration1,
            cacheMiss: duration2,
            cacheHit: duration3,
            improvement: ((1 - duration3 / duration1) * 100).toFixed(1) + '%',
        },
        memory: {
            noCache: {
                heapUsed: memAfter1.heapUsed,
                heapUsedMB: formatBytes(memAfter1.heapUsed),
                allocated: memDiff1.heapUsed,
                allocatedMB: formatBytes(memDiff1.heapUsed),
            },
            cacheMiss: {
                heapUsed: memAfter2.heapUsed,
                heapUsedMB: formatBytes(memAfter2.heapUsed),
                allocated: memDiff2.heapUsed,
                allocatedMB: formatBytes(memDiff2.heapUsed),
            },
            cacheHit: {
                heapUsed: memAfter3.heapUsed,
                heapUsedMB: formatBytes(memAfter3.heapUsed),
                allocated: memDiff3.heapUsed,
                allocatedMB: formatBytes(memDiff3.heapUsed),
            },
            savings: {
                heapUsed: memSavings,
                heapUsedMB: formatBytes(Math.abs(memSavings)),
                allocated: allocSavings,
                allocatedMB: formatBytes(Math.abs(allocSavings)),
            },
        },
        cache: {
            astSizeBytes: stats.ast.totalSize,
            modelSizeBytes: stats.model.totalSize,
            totalSizeMB: formatBytes(stats.ast.totalSize + stats.model.totalSize),
        },
        v8Stats: {
            heapSizeLimit: formatBytes(v8.getHeapStatistics().heap_size_limit),
            totalHeapSize: formatBytes(v8.getHeapStatistics().total_heap_size),
            usedHeapSize: formatBytes(v8.getHeapStatistics().used_heap_size),
            mallocedMemory: formatBytes(v8.getHeapStatistics().malloced_memory),
        },
    };

    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(
        path.join(cacheDir, 'memory-profile-results.json'),
        JSON.stringify(results, null, 2)
    );

    console.log('💾 V8 Heap Statistics:');
    console.log(`   Heap Size Limit:    ${results.v8Stats.heapSizeLimit}`);
    console.log(`   Total Heap Size:    ${results.v8Stats.totalHeapSize}`);
    console.log(`   Used Heap Size:     ${results.v8Stats.usedHeapSize}`);
    console.log(`   Malloced Memory:    ${results.v8Stats.mallocedMemory}\n`);

    console.log(`📁 Results saved to: ${path.join(cacheDir, 'memory-profile-results.json')}\n`);

    if (process.env.HEAP_SNAPSHOT === 'true') {
        console.log('💡 Analyze heap snapshots:');
        console.log('   1. Open Chrome DevTools');
        console.log('   2. Go to Memory tab');
        console.log('   3. Load heap snapshot files');
        console.log('   4. Compare snapshots to see memory differences\n');
    }

    console.log('✅ Memory profiling complete!\n');
}

profileMemory().catch((error) => {
    console.error('❌ Error during memory profiling:', error);
    process.exit(1);
});
