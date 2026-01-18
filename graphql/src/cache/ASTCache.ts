/*
 * Copyright (c) "Neo4j"
 * Neo4j Sweden AB [http://neo4j.com]
 *
 * This file is part of Neo4j.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { parse, print, type DocumentNode } from "graphql";
import * as crypto from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import Debug from "debug";
import { BSON } from "bson";

const debug = Debug("@neo4j/graphql:cache");

interface ASTCacheEntry {
    version: string;
    hash: string;
    ast: string; // serialized AST using print()
    timestamp: number;
}

export interface ASTCacheOptions {
    directory?: string;
    ttl?: number; // Time to live in milliseconds
    version: string; // Library version for cache invalidation
}

export interface CacheStats {
    entries: number;
    totalSize: number;
    oldestEntry?: Date;
    newestEntry?: Date;
}

/**
 * Cache for GraphQL AST (Abstract Syntax Tree) to speed up startup time.
 *
 * This cache stores the parsed DocumentNode as a serialized string,
 * avoiding the need to re-parse type definitions on every startup.
 *
 * @example
 * ```typescript
 * const cache = new ASTCache({ version: '5.0.0' });
 *
 * // Try to get from cache
 * let ast = await cache.get(typeDefs);
 * if (!ast) {
 *   // Cache miss - parse and cache
 *   ast = parse(typeDefs);
 *   await cache.set(typeDefs, ast);
 * }
 * ```
 */
export class ASTCache {
    private cacheDir: string;
    private ttl?: number;
    private version: string;

    constructor(options: ASTCacheOptions) {
        this.cacheDir = options.directory || ".neo4j-graphql-cache";
        this.ttl = options.ttl;
        this.version = options.version;
        debug("Initialized ASTCache with directory: %s, version: %s", this.cacheDir, this.version);
    }

    /**
     * Generate a hash of the type definitions for cache key
     */
    private getHash(typeDefs: string): string {
        return crypto.createHash("sha256").update(typeDefs + this.version).digest("hex");
    }

    /**
     * Get the file path for a cached entry
     */
    private getCachePath(hash: string): string {
        return path.join(this.cacheDir, "ast", `${hash}.bson`);
    }

    /**
     * Check if a cache entry is still valid
     */
    private isValid(entry: ASTCacheEntry): boolean {
        // Check version
        if (entry.version !== this.version) {
            debug("Cache entry invalid: version mismatch (entry: %s, current: %s)", entry.version, this.version);
            return false;
        }

        // Check TTL if configured
        if (this.ttl) {
            const age = Date.now() - entry.timestamp;
            if (age > this.ttl) {
                debug("Cache entry invalid: TTL expired (age: %dms, ttl: %dms)", age, this.ttl);
                return false;
            }
        }

        return true;
    }

    /**
     * Get a cached AST if it exists and is valid
     *
     * @param typeDefs - The GraphQL type definitions as a string
     * @returns The cached DocumentNode or null if not found/invalid
     */
    async get(typeDefs: string): Promise<DocumentNode | null> {
        const hash = this.getHash(typeDefs);
        const cachePath = this.getCachePath(hash);

        try {
            debug("Attempting to read cache from: %s", cachePath);
            const cached = await fs.readFile(cachePath);
            const entry = BSON.deserialize(cached) as ASTCacheEntry;

            // Validate the cache entry
            if (!this.isValid(entry)) {
                // Invalid - delete and return null
                debug("Cache entry invalid, removing: %s", cachePath);
                await fs.unlink(cachePath).catch(() => {
                    /* ignore errors */
                });
                return null;
            }

            // Parse the serialized AST
            debug("Cache hit for hash: %s", hash);
            return parse(entry.ast);
        } catch (error) {
            // Cache miss or read error
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                debug("Cache miss for hash: %s", hash);
            } else {
                debug("Error reading cache: %s", error);
            }
            return null;
        }
    }

    /**
     * Store an AST in the cache
     *
     * @param typeDefs - The GraphQL type definitions as a string
     * @param ast - The parsed DocumentNode to cache
     */
    async set(typeDefs: string, ast: DocumentNode): Promise<void> {
        const hash = this.getHash(typeDefs);
        const cachePath = this.getCachePath(hash);

        try {
            // Ensure cache directory exists
            await fs.mkdir(path.dirname(cachePath), { recursive: true });

            const entry: ASTCacheEntry = {
                version: this.version,
                hash,
                ast: print(ast), // Serialize AST to string
                timestamp: Date.now(),
            };

            await fs.writeFile(cachePath, BSON.serialize(entry));
            debug("Cache written to: %s", cachePath);
        } catch (error) {
            // Log error but don't throw - cache is optional
            debug("Failed to write AST cache: %s", error);
        }
    }

    /**
     * Clear all cached AST entries
     */
    async clear(): Promise<void> {
        const astCacheDir = path.join(this.cacheDir, "ast");
        try {
            await fs.rm(astCacheDir, { recursive: true, force: true });
            debug("Cache cleared: %s", astCacheDir);
        } catch (error) {
            debug("Error clearing cache: %s", error);
        }
    }

    /**
     * Get cache statistics
     */
    async getStats(): Promise<CacheStats> {
        const astCacheDir = path.join(this.cacheDir, "ast");

        try {
            const files = await fs.readdir(astCacheDir);
            let totalSize = 0;
            let oldestTimestamp = Infinity;
            let newestTimestamp = 0;

            await Promise.all(
                files.map(async (file) => {
                    const filePath = path.join(astCacheDir, file);
                    const stats = await fs.stat(filePath);
                    totalSize += stats.size;

                    try {
                        const content = await fs.readFile(filePath);
                        const entry = BSON.deserialize(content) as ASTCacheEntry;
                        oldestTimestamp = Math.min(oldestTimestamp, entry.timestamp);
                        newestTimestamp = Math.max(newestTimestamp, entry.timestamp);
                    } catch {
                        // Ignore invalid entries
                    }
                })
            );

            return {
                entries: files.length,
                totalSize,
                oldestEntry: oldestTimestamp !== Infinity ? new Date(oldestTimestamp) : undefined,
                newestEntry: newestTimestamp > 0 ? new Date(newestTimestamp) : undefined,
            };
        } catch {
            return {
                entries: 0,
                totalSize: 0,
            };
        }
    }

    /**
     * Clean up expired cache entries
     */
    async cleanup(): Promise<number> {
        if (!this.ttl) {
            debug("No TTL configured, skipping cleanup");
            return 0;
        }

        const astCacheDir = path.join(this.cacheDir, "ast");
        let cleaned = 0;

        try {
            const files = await fs.readdir(astCacheDir);
            debug("Cleaning up expired entries from %d files", files.length);

            await Promise.all(
                files.map(async (file) => {
                    const filePath = path.join(astCacheDir, file);
                    try {
                        const content = await fs.readFile(filePath);
                        const entry = BSON.deserialize(content) as ASTCacheEntry;

                        if (!this.isValid(entry)) {
                            await fs.unlink(filePath);
                            cleaned++;
                            debug("Removed expired entry: %s", filePath);
                        }
                    } catch {
                        // Invalid file - delete it
                        await fs.unlink(filePath).catch(() => {
                            /* ignore */
                        });
                        cleaned++;
                        debug("Removed invalid entry: %s", filePath);
                    }
                })
            );

            debug("Cleanup complete, removed %d entries", cleaned);
        } catch (error) {
            debug("Error during cleanup: %s", error);
        }

        return cleaned;
    }
}
