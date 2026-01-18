#!/usr/bin/env node

/*
 * Build-Time Cache Generator
 * 
 * Generates GraphQL cache during build process so runtime startup is instant.
 * This gives you the same benefit as an external language tool but with
 * zero reimplementation effort!
 * 
 * Usage:
 *   node scripts/generate-cache.js
 * 
 * In CI/CD:
 *   yarn build && node scripts/generate-cache.js
 * 
 * Environment variables:
 *   SCHEMA_FILE - Path to schema file (default: supply_chain_pharma.graphql)
 *   CACHE_DIR - Output directory (default: ./cache-prebuilt)
 */

const { Neo4jGraphQL } = require('../dist/index.js');
const fs = require('fs/promises');
const path = require('path');

const config = {
    schemaFile: process.env.SCHEMA_FILE || 'supply_chain_pharma.graphql',
    cacheDir: process.env.CACHE_DIR || './cache-prebuilt',
};

async function generateBuildTimeCache() {
    console.log('📦 Build-Time GraphQL Cache Generator');
    console.log('=====================================\n');

    const schemaPath = path.resolve(config.schemaFile);
    console.log(`📖 Schema file: ${schemaPath}`);
    console.log(`📁 Cache directory: ${config.cacheDir}\n`);

    // Load schema
    let typeDefs;
    try {
        typeDefs = await fs.readFile(schemaPath, 'utf-8');
        const typeCount = (typeDefs.match(/type\s+\w+/g) || []).length;
        console.log(`✅ Loaded schema (${typeCount} types)\n`);
    } catch (error) {
        console.error(`❌ Failed to load schema from ${schemaPath}:`, error.message);
        process.exit(1);
    }

    // Clean old cache
    await fs.rm(config.cacheDir, { recursive: true, force: true }).catch(() => {});
    console.log('🧹 Cleaned old cache\n');

    // Generate cache
    console.log('⚙️  Generating cache...');
    const memBefore = process.memoryUsage();
    const startTime = Date.now();

    try {
        const neoSchema = new Neo4jGraphQL({
            typeDefs,
            cache: {
                enabled: true,
                level: 'both',
                directory: config.cacheDir,
            },
            // Don't validate against database during build
            validate: true, // Validate schema structure only
        });

        await neoSchema.getSchema();

        const duration = Date.now() - startTime;
        const memAfter = process.memoryUsage();
        const memDelta = (memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024;

        console.log(`✅ Cache generated in ${duration}ms`);
        console.log(`   Memory used: ${memDelta.toFixed(2)} MB\n`);

        // Get cache statistics
        const stats = await neoSchema.getCacheStats();

        console.log('📊 Cache Statistics:');
        console.log(`   AST Cache:`);
        console.log(`     Entries: ${stats.ast.entries}`);
        console.log(`     Size: ${(stats.ast.totalSize / 1024).toFixed(2)} KB`);
        console.log(`   Model Cache:`);
        console.log(`     Entries: ${stats.model.entries}`);
        console.log(`     Size: ${(stats.model.totalSize / 1024).toFixed(2)} KB`);
        console.log(`   Total: ${((stats.ast.totalSize + stats.model.totalSize) / 1024).toFixed(2)} KB\n`);

        // Verify cache files exist
        const astFiles = await fs.readdir(path.join(config.cacheDir, 'ast')).catch(() => []);
        const modelFiles = await fs.readdir(path.join(config.cacheDir, 'model')).catch(() => []);

        console.log('📁 Cache Files:');
        console.log(`   ${config.cacheDir}/ast/: ${astFiles.length} files`);
        console.log(`   ${config.cacheDir}/model/: ${modelFiles.length} files\n`);

        // Save metadata
        const metadata = {
            generated: new Date().toISOString(),
            schema: {
                file: config.schemaFile,
                types: (typeDefs.match(/type\s+\w+/g) || []).length,
                sizeKB: (typeDefs.length / 1024).toFixed(2),
            },
            generation: {
                durationMs: duration,
                memoryUsedMB: memDelta.toFixed(2),
            },
            cache: {
                astEntries: stats.ast.entries,
                modelEntries: stats.model.entries,
                astSizeKB: (stats.ast.totalSize / 1024).toFixed(2),
                modelSizeKB: (stats.model.totalSize / 1024).toFixed(2),
                totalSizeKB: ((stats.ast.totalSize + stats.model.totalSize) / 1024).toFixed(2),
            },
            nodeVersion: process.version,
            platform: process.platform,
        };

        await fs.writeFile(
            path.join(config.cacheDir, 'cache-metadata.json'),
            JSON.stringify(metadata, null, 2)
        );

        console.log('💾 Metadata saved: cache-metadata.json\n');

        console.log('✅ Build-time cache generation complete!');
        console.log('\n💡 Next steps:');
        console.log(`   1. Include ${config.cacheDir} in your Docker image`);
        console.log(`   2. Configure app to use: cache: { directory: '${config.cacheDir}' }`);
        console.log(`   3. App will start in ~300ms using pre-built cache! ⚡\n`);

    } catch (error) {
        console.error('❌ Cache generation failed:', error.message);
        console.error('\nThis usually means:');
        console.error('  - Invalid schema syntax');
        console.error('  - Missing type definitions');
        console.error('  - Schema validation errors');
        console.error('\nFix the schema and try again.');
        process.exit(1);
    }
}

generateBuildTimeCache();
