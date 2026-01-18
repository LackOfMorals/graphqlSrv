/*
 * Cluster Mode Example for Neo4j GraphQL
 * 
 * Runs multiple worker processes to utilize all CPU cores
 * Workers share the cache, so only first worker generates it
 * 
 * Usage:
 *   node cluster.js
 * 
 * Environment:
 *   WORKERS - Number of workers (default: CPU count)
 */

const cluster = require('cluster');
const os = require('os');
const path = require('path');

const numWorkers = parseInt(process.env.WORKERS) || os.cpus().length;

if (cluster.isMaster || cluster.isPrimary) {
    console.log('🚀 Neo4j GraphQL Cluster Mode');
    console.log('==============================\n');
    console.log(`Master process ${process.pid} is running`);
    console.log(`Starting ${numWorkers} workers...\n`);

    const workers = [];

    // Fork workers
    for (let i = 0; i < numWorkers; i++) {
        const worker = cluster.fork();
        workers.push(worker);
        
        worker.on('message', (msg) => {
            if (msg.type === 'ready') {
                console.log(`✅ Worker ${worker.process.pid} ready (${msg.cacheHit ? 'cache hit' : 'cache miss'})`);
            }
            
            if (msg.type === 'metrics') {
                console.log(`📊 Worker ${worker.process.pid}: ${msg.data}`);
            }
        });
    }

    // Handle worker crashes
    cluster.on('exit', (worker, code, signal) => {
        console.log(`⚠️  Worker ${worker.process.pid} died (${signal || code}). Restarting...`);
        const newWorker = cluster.fork();
        
        newWorker.on('message', (msg) => {
            if (msg.type === 'ready') {
                console.log(`✅ Replacement worker ${newWorker.process.pid} ready`);
            }
        });
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
        console.log('\n🛑 Shutting down cluster...');
        
        workers.forEach(worker => {
            worker.send({ type: 'shutdown' });
        });

        setTimeout(() => {
            workers.forEach(worker => worker.kill());
            process.exit(0);
        }, 5000);
    });

    // Monitor overall health
    setInterval(() => {
        const memUsage = process.memoryUsage();
        console.log(`\n📊 Cluster Stats (Master ${process.pid}):`);
        console.log(`   Workers: ${Object.keys(cluster.workers || {}).length}/${numWorkers}`);
        console.log(`   Memory: ${(memUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`);
    }, 60000);

} else {
    // Worker process
    const express = require('express');
    const { Neo4jGraphQL } = require('./dist/index.js');
    const neo4j = require('neo4j-driver');
    const fs = require('fs/promises');

    async function startWorker() {
        const workerId = process.pid;
        console.log(`Worker ${workerId} starting...`);

        const startTime = Date.now();
        const memBefore = process.memoryUsage();

        // Load schema with cache
        const typeDefs = await fs.readFile('supply_chain_pharma.graphql', 'utf-8');

        const driver = neo4j.driver(
            process.env.NEO4J_URI || 'bolt://localhost:7687',
            neo4j.auth.basic(
                process.env.NEO4J_USER || 'neo4j',
                process.env.NEO4J_PASSWORD || 'password'
            )
        );

        const neoSchema = new Neo4jGraphQL({
            typeDefs,
            driver,
            cache: {
                enabled: true,
                level: 'both',
                directory: './.neo4j-graphql-cache', // Shared cache location
            },
        });

        const schema = await neoSchema.getSchema();

        const duration = Date.now() - startTime;
        const memAfter = process.memoryUsage();
        const stats = await neoSchema.getCacheStats();

        const cacheHit = stats.ast.entries > 0 || stats.model.entries > 0;

        // Notify master
        process.send({
            type: 'ready',
            workerId,
            duration,
            memory: (memAfter.heapUsed / 1024 / 1024).toFixed(2) + ' MB',
            cacheHit,
        });

        // Create Express app
        const app = express();
        const { ApolloServer } = require('@apollo/server');
        const { expressMiddleware } = require('@apollo/server/express4');

        const server = new ApolloServer({ schema });
        await server.start();

        app.use(express.json());
        
        app.use('/graphql', expressMiddleware(server, {
            context: async () => ({ driver }),
        }));

        // Health check
        app.get('/health', async (req, res) => {
            const mem = process.memoryUsage();
            res.json({
                status: 'healthy',
                worker: workerId,
                uptime: process.uptime(),
                memory: {
                    heapUsed: (mem.heapUsed / 1024 / 1024).toFixed(2) + ' MB',
                    rss: (mem.rss / 1024 / 1024).toFixed(2) + ' MB',
                },
                cache: {
                    hit: cacheHit,
                    ast: stats.ast.entries,
                    model: stats.model.entries,
                },
            });
        });

        // Metrics endpoint
        app.get('/metrics', async (req, res) => {
            const mem = process.memoryUsage();
            
            process.send({
                type: 'metrics',
                data: `heap=${(mem.heapUsed / 1024 / 1024).toFixed(2)}MB uptime=${process.uptime()}s`,
            });

            res.json({
                worker: workerId,
                memory: mem,
                uptime: process.uptime(),
            });
        });

        const PORT = process.env.PORT || 4000;
        app.listen(PORT, () => {
            console.log(`Worker ${workerId} listening on port ${PORT}`);
        });

        // Handle shutdown
        process.on('message', (msg) => {
            if (msg.type === 'shutdown') {
                console.log(`Worker ${workerId} shutting down...`);
                server.stop();
                driver.close();
                process.exit(0);
            }
        });
    }

    startWorker().catch((error) => {
        console.error(`Worker ${process.pid} error:`, error);
        process.exit(1);
    });
}
