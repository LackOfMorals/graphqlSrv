const { Neo4jGraphQL } = require('/Users/jgiffard/Projects/graphqlSrv/graphql/dist/index.js');
const neo4j = require('neo4j-driver');
const fs = require('fs').promises;
const path = require('path');
const { createServer } = require('node:http');
const { createYoga } = require('graphql-yoga');

const config = {
    neo4jUri: process.env.NEO4J_URI || `bolt://localhost:7687`,
    neo4jUser: process.env.NEO4J_USER || 'neo4j',
    neo4jPassword: process.env.NEO4J_PASSWORD || 'password',
    neo4jDatabase: process.env.NEO4J_DATABASE || 'neo4j',
    cacheDir: '/Users/jgiffard/Projects/graphqlSrv/.neo4j-schema-cache',
};

async function loadTypeDefs() {
    if (process.argv[2]) {
        return await fs.readFile(path.resolve(process.argv[2]), 'utf-8');
    }
}

async function runSrvr() {
    console.log('🚀 Yoga server with Neo4j library');
    console.log('======================================\n');
    console.log('Neo4j URI ', config.neo4jUri);
    console.log('Neo4j user ', config.neo4jUser);
    console.log('Neo4j pwd ', config.neo4jPassword);
    console.log('Neo4j db ', config.neo4jDatabase);


    let driver;
    if (config.neo4jUri && config.neo4jPassword) {
        driver = neo4j.driver(
            config.neo4jUri,
            neo4j.auth.basic(config.neo4jUser, config.neo4jPassword)
        );
    }


    const typeDefs = await loadTypeDefs();
    
    const neoSchema = new Neo4jGraphQL({
        typeDefs,
        driver,
        cache: { enabled: true, level: 'both', directory: config.cacheDir },
        debug: true,
    });
    
    // Create a Yoga instance with the neo4j schema and set the neo4j database to use
    const yoga = createYoga({
        schema: await neoSchema.getSchema(),
        context: async ({ request }) => ({
          driver,
          driverConfig: {
            database: config.neo4jDatabase // Set the database
          }
        })
      })

    // Pass it into a server to hook into request handlers.
    const server = createServer(yoga)
    
    // Start the server and you're done!
    server.listen(4000, () => {
    console.info('Server is running on http://localhost:4000/graphql')
    })
}

runSrvr().catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
});
