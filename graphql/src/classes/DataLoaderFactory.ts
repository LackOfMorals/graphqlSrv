/*
 * DataLoader factory for batching Neo4j queries
 * Prevents N+1 query problems
 */

import DataLoader from 'dataloader';
import type { Driver, Session } from 'neo4j-driver';
import type { Neo4jGraphQLContext } from '../types/neo4j-graphql-context';

interface BatchLoadConfig {
    driver: Driver;
    sessionConfig?: any;
}

export class DataLoaderFactory {
    private loaders: Map<string, DataLoader<any, any>> = new Map();

    constructor(private config: BatchLoadConfig) {}

    /**
     * Get or create a DataLoader for a specific entity type
     */
    getNodeLoader(entityName: string): DataLoader<string, any> {
        const key = `node:${entityName}`;
        
        if (!this.loaders.has(key)) {
            this.loaders.set(
                key,
                new DataLoader(
                    async (ids: readonly string[]) => this.batchLoadNodes(entityName, ids),
                    {
                        cache: true,
                        maxBatchSize: 100, // Tune based on your needs
                    }
                )
            );
        }

        return this.loaders.get(key)!;
    }

    /**
     * Get or create a DataLoader for relationship batching
     */
    getRelationshipLoader(
        fromEntity: string,
        relationship: string,
        toEntity: string
    ): DataLoader<string, any[]> {
        const key = `rel:${fromEntity}:${relationship}:${toEntity}`;

        if (!this.loaders.has(key)) {
            this.loaders.set(
                key,
                new DataLoader(
                    async (sourceIds: readonly string[]) =>
                        this.batchLoadRelationships(fromEntity, relationship, toEntity, sourceIds),
                    {
                        cache: true,
                        maxBatchSize: 50,
                    }
                )
            );
        }

        return this.loaders.get(key)!;
    }

    private async batchLoadNodes(entityName: string, ids: readonly string[]): Promise<any[]> {
        const session: Session = this.config.driver.session(this.config.sessionConfig);

        try {
            const result = await session.run(
                `
                UNWIND $ids AS id
                MATCH (n:${entityName} {id: id})
                RETURN n, id
                ORDER BY id
                `,
                { ids: Array.from(ids) }
            );

            // Create a map for O(1) lookups
            const nodeMap = new Map(
                result.records.map((record) => [
                    record.get('id'),
                    record.get('n').properties,
                ])
            );

            // Return nodes in the same order as requested IDs
            return ids.map((id) => nodeMap.get(id) || null);
        } finally {
            await session.close();
        }
    }

    private async batchLoadRelationships(
        fromEntity: string,
        relationship: string,
        toEntity: string,
        sourceIds: readonly string[]
    ): Promise<any[][]> {
        const session: Session = this.config.driver.session(this.config.sessionConfig);

        try {
            const result = await session.run(
                `
                UNWIND $ids AS sourceId
                MATCH (source:${fromEntity} {id: sourceId})-[:${relationship}]->(target:${toEntity})
                RETURN sourceId, collect(target) AS targets
                ORDER BY sourceId
                `,
                { ids: Array.from(sourceIds) }
            );

            const relationshipMap = new Map(
                result.records.map((record) => [
                    record.get('sourceId'),
                    record.get('targets').map((node: any) => node.properties),
                ])
            );

            return sourceIds.map((id) => relationshipMap.get(id) || []);
        } finally {
            await session.close();
        }
    }

    /**
     * Clear all caches - useful for testing or after mutations
     */
    clearAll(): void {
        this.loaders.forEach((loader) => loader.clearAll());
    }

    /**
     * Clear specific loader cache
     */
    clear(key: string): void {
        this.loaders.get(key)?.clearAll();
    }
}

/**
 * Context plugin to inject DataLoaders
 */
export function createDataLoaderContext(driver: Driver, sessionConfig?: any): any {
    return {
        dataLoaders: new DataLoaderFactory({ driver, sessionConfig }),
    };
}
