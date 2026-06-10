import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
// CachedMod is single-sourced in src/types/electron.ts; re-exported because
// syncService and searchService import it from this module.
import type { CachedMod } from '../../../src/types/electron';
export type { CachedMod };

export interface SyncState {
    section: string;
    lastSync: number;
    totalCount: number;
    pagesSynced: number;
}

let db: Database.Database | null = null;

const SEARCH_SCHEMA_SQL = `
    CREATE VIRTUAL TABLE IF NOT EXISTS mods_fts USING fts5(
        name,
        category_name,
        submitter_name,
        content='mods',
        content_rowid='id',
        tokenize='porter unicode61'
    );

    CREATE TRIGGER IF NOT EXISTS mods_ai AFTER INSERT ON mods BEGIN
        INSERT INTO mods_fts(rowid, name, category_name, submitter_name)
        VALUES (new.id, new.name, new.category_name, new.submitter_name);
    END;

    CREATE TRIGGER IF NOT EXISTS mods_ad AFTER DELETE ON mods BEGIN
        INSERT INTO mods_fts(mods_fts, rowid, name, category_name, submitter_name)
        VALUES ('delete', old.id, old.name, old.category_name, old.submitter_name);
    END;

    CREATE TRIGGER IF NOT EXISTS mods_au AFTER UPDATE ON mods BEGIN
        INSERT INTO mods_fts(mods_fts, rowid, name, category_name, submitter_name)
        VALUES ('delete', old.id, old.name, old.category_name, old.submitter_name);
        INSERT INTO mods_fts(rowid, name, category_name, submitter_name)
        VALUES (new.id, new.name, new.category_name, new.submitter_name);
    END;
`;

/**
 * Get the database file path
 */
function getDbPath(): string {
    const userDataPath = app.getPath('userData');
    return path.join(userDataPath, 'mods-cache.db');
}

/**
 * Initialize the database connection and create tables
 * Includes error handling to prevent app crashes (P1 fix #7)
 */
export function initDatabase(): Database.Database {
    if (db) return db;

    const dbPath = getDbPath();
    console.log('[ModDatabase] Initializing database at:', dbPath);

    try {
        // Ensure directory exists
        const dir = path.dirname(dbPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        db = new Database(dbPath);
        db.pragma('journal_mode = WAL');
        db.pragma('foreign_keys = ON');

        // Create tables
        db.exec(`
            -- Core mod data
            CREATE TABLE IF NOT EXISTS mods (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                section TEXT NOT NULL,
                category_id INTEGER,
                category_name TEXT,
                submitter_name TEXT,
                submitter_id INTEGER,
                like_count INTEGER DEFAULT 0,
                view_count INTEGER DEFAULT 0,
                download_count INTEGER,
                date_added INTEGER,
                date_modified INTEGER,
                has_files INTEGER DEFAULT 1,
                is_nsfw INTEGER DEFAULT 0,
                thumbnail_url TEXT,
                audio_url TEXT,
                profile_url TEXT,
                cached_at INTEGER DEFAULT (strftime('%s', 'now'))
            );

            -- Create indexes for common queries
            CREATE INDEX IF NOT EXISTS idx_mods_section ON mods(section);
            CREATE INDEX IF NOT EXISTS idx_mods_category_id ON mods(category_id);
            CREATE INDEX IF NOT EXISTS idx_mods_date_modified ON mods(date_modified);
            CREATE INDEX IF NOT EXISTS idx_mods_like_count ON mods(like_count);

            -- Sync state tracking
            CREATE TABLE IF NOT EXISTS sync_state (
                section TEXT PRIMARY KEY,
                last_sync INTEGER,
                total_count INTEGER,
                pages_synced INTEGER
            );

            -- GameBanana category trees (JSON), keyed by category model name
            -- (ModCategory, SoundCategory, ...). Served offline-first so the
            -- Locker hero grid doesn't hang on a GameBanana outage.
            CREATE TABLE IF NOT EXISTS category_cache (
                model TEXT PRIMARY KEY,
                fetched_at INTEGER NOT NULL,
                payload TEXT NOT NULL
            );

            ${SEARCH_SCHEMA_SQL}
        `);

        // Run migrations for existing databases
        runMigrations(db);

        console.log('[ModDatabase] Database initialized successfully');
        return db;
    } catch (error) {
        console.error('[ModDatabase] Failed to initialize database:', error);

        // If database is corrupted, try to recover by deleting and recreating
        if (error instanceof Error && (
            error.message.includes('database disk image is malformed') ||
            error.message.includes('SQLITE_CORRUPT') ||
            error.message.includes('file is not a database')
        )) {
            console.warn('[ModDatabase] Database appears corrupted, attempting recovery...');
            try {
                // Close any existing connection
                if (db) {
                    try { db.close(); } catch { /* ignore */ }
                    db = null;
                }

                // Delete corrupted database files
                const filesToRemove = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`];
                for (const file of filesToRemove) {
                    if (fs.existsSync(file)) {
                        fs.unlinkSync(file);
                    }
                }

                // Retry initialization
                console.log('[ModDatabase] Retrying database initialization...');
                return initDatabase();
            } catch (recoveryError) {
                console.error('[ModDatabase] Recovery failed:', recoveryError);
                throw new Error(`Database initialization failed and recovery was unsuccessful: ${error.message}`);
            }
        }

        throw new Error(`Failed to initialize mod database: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * Close the database connection
 */
export function closeDatabase(): void {
    if (db) {
        db.close();
        db = null;
    }
}

/**
 * Wipe the local cache database (mods + FTS + sync state).
 */
export function wipeDatabase(): void {
    const dbPath = getDbPath();
    closeDatabase();

    const filesToRemove = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`];
    for (const file of filesToRemove) {
        if (fs.existsSync(file)) {
            fs.unlinkSync(file);
        }
    }

    initDatabase();
}

/**
 * Upsert a mod into the database
 */
export function upsertMod(mod: CachedMod): void {
    const database = initDatabase();
    const stmt = database.prepare(`
        INSERT INTO mods (
            id, name, section, category_id, category_name,
            submitter_name, submitter_id, like_count, view_count,
            date_added, date_modified, has_files, is_nsfw,
            thumbnail_url, audio_url, profile_url, cached_at
        ) VALUES (
            @id, @name, @section, @categoryId, @categoryName,
            @submitterName, @submitterId, @likeCount, @viewCount,
            @dateAdded, @dateModified, @hasFiles, @isNsfw,
            @thumbnailUrl, @audioUrl, @profileUrl, @cachedAt
        )
        ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            section = excluded.section,
            category_id = excluded.category_id,
            category_name = excluded.category_name,
            submitter_name = excluded.submitter_name,
            submitter_id = excluded.submitter_id,
            like_count = excluded.like_count,
            view_count = excluded.view_count,
            date_added = excluded.date_added,
            date_modified = excluded.date_modified,
            has_files = excluded.has_files,
            is_nsfw = excluded.is_nsfw,
            thumbnail_url = excluded.thumbnail_url,
            audio_url = excluded.audio_url,
            profile_url = excluded.profile_url,
            cached_at = excluded.cached_at
    `);
    stmt.run({
        ...mod,
        hasFiles: mod.hasFiles ? 1 : 0,
        isNsfw: mod.isNsfw ? 1 : 0,
    });
}

/**
 * Batch upsert mods
 */
export function upsertMods(mods: CachedMod[]): void {
    const database = initDatabase();
    const upsertStmt = database.prepare(`
        INSERT INTO mods (
            id, name, section, category_id, category_name,
            submitter_name, submitter_id, like_count, view_count,
            date_added, date_modified, has_files, is_nsfw,
            thumbnail_url, audio_url, profile_url, cached_at
        ) VALUES (
            @id, @name, @section, @categoryId, @categoryName,
            @submitterName, @submitterId, @likeCount, @viewCount,
            @dateAdded, @dateModified, @hasFiles, @isNsfw,
            @thumbnailUrl, @audioUrl, @profileUrl, @cachedAt
        )
        ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            section = excluded.section,
            category_id = excluded.category_id,
            category_name = excluded.category_name,
            submitter_name = excluded.submitter_name,
            submitter_id = excluded.submitter_id,
            like_count = excluded.like_count,
            view_count = excluded.view_count,
            date_added = excluded.date_added,
            date_modified = excluded.date_modified,
            has_files = excluded.has_files,
            is_nsfw = excluded.is_nsfw,
            thumbnail_url = excluded.thumbnail_url,
            audio_url = excluded.audio_url,
            profile_url = excluded.profile_url,
            cached_at = excluded.cached_at
    `);

    const insertMany = database.transaction((items: CachedMod[]) => {
        for (const mod of items) {
            upsertStmt.run({
                ...mod,
                hasFiles: mod.hasFiles ? 1 : 0,
                isNsfw: mod.isNsfw ? 1 : 0,
            });
        }
    });

    insertMany(mods);
}

export interface CachedCategoryTree {
    fetchedAt: number;
    /** JSON-serialized GameBananaCategoryNode[]. Stored opaque: the GameBanana
     *  service owns (de)serialization and shape validation. */
    payload: string;
}

/** Get the locally cached category tree for a category model, or null. */
export function getCachedCategoryTree(model: string): CachedCategoryTree | null {
    const database = initDatabase();
    const stmt = database.prepare('SELECT fetched_at, payload FROM category_cache WHERE model = ?');
    const row = stmt.get(model) as { fetched_at: number; payload: string } | undefined;
    if (!row) return null;
    return { fetchedAt: row.fetched_at, payload: row.payload };
}

/** Store (or replace) the cached category tree for a category model. */
export function saveCachedCategoryTree(model: string, payload: string): void {
    const database = initDatabase();
    const stmt = database.prepare(`
        INSERT INTO category_cache (model, fetched_at, payload)
        VALUES (?, ?, ?)
        ON CONFLICT(model) DO UPDATE SET
            fetched_at = excluded.fetched_at,
            payload = excluded.payload
    `);
    stmt.run(model, Date.now(), payload);
}

/**
 * Get sync state for a section
 */
export function getSyncState(section: string): SyncState | null {
    const database = initDatabase();
    const stmt = database.prepare('SELECT * FROM sync_state WHERE section = ?');
    const row = stmt.get(section) as { section: string; last_sync: number; total_count: number; pages_synced: number } | undefined;
    if (!row) return null;
    return {
        section: row.section,
        lastSync: row.last_sync,
        totalCount: row.total_count,
        pagesSynced: row.pages_synced,
    };
}

/**
 * Update sync state for a section
 */
export function updateSyncState(state: SyncState): void {
    const database = initDatabase();
    const stmt = database.prepare(`
        INSERT INTO sync_state (section, last_sync, total_count, pages_synced)
        VALUES (@section, @lastSync, @totalCount, @pagesSynced)
        ON CONFLICT(section) DO UPDATE SET
            last_sync = excluded.last_sync,
            total_count = excluded.total_count,
            pages_synced = excluded.pages_synced
    `);
    stmt.run(state);
}

/**
 * Get total mod count in database
 */
export function getModCount(section?: string): number {
    const database = initDatabase();
    if (section) {
        const stmt = database.prepare('SELECT COUNT(*) as count FROM mods WHERE section = ?');
        const row = stmt.get(section) as { count: number };
        return row.count;
    }
    const stmt = database.prepare('SELECT COUNT(*) as count FROM mods');
    const row = stmt.get() as { count: number };
    return row.count;
}

/**
 * Get mod by ID
 */
export function getModById(id: number): CachedMod | null {
    const database = initDatabase();
    const stmt = database.prepare('SELECT * FROM mods WHERE id = ?');
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return mapRowToMod(row);
}

/**
 * Map database row to CachedMod
 */
export function mapRowToMod(row: Record<string, unknown>): CachedMod {
    return {
        id: row.id as number,
        name: row.name as string,
        section: row.section as string,
        categoryId: row.category_id as number | null,
        categoryName: row.category_name as string | null,
        submitterName: row.submitter_name as string | null,
        submitterId: row.submitter_id as number | null,
        likeCount: (row.like_count as number) ?? 0,
        viewCount: (row.view_count as number) ?? 0,
        downloadCount: row.download_count as number | null,
        dateAdded: (row.date_added as number) ?? 0,
        dateModified: (row.date_modified as number) ?? 0,
        hasFiles: row.has_files != null ? (row.has_files as number) === 1 : true,
        isNsfw: row.is_nsfw != null ? (row.is_nsfw as number) === 1 : false,
        thumbnailUrl: row.thumbnail_url as string | null,
        audioUrl: row.audio_url as string | null,
        profileUrl: (row.profile_url as string) ?? '',
        cachedAt: (row.cached_at as number) ?? 0,
    };
}

/**
 * Update just the NSFW flag for a mod (used to enrich cache from detail fetches)
 */
export function updateModNsfw(modId: number, isNsfw: boolean): void {
    const database = initDatabase();
    const stmt = database.prepare('UPDATE mods SET is_nsfw = ? WHERE id = ?');
    stmt.run(isNsfw ? 1 : 0, modId);
}

/**
 * Update the download count for a mod (used to enrich cache from detail fetches)
 */
export function updateModDownloadCount(modId: number, downloadCount: number): void {
    const database = initDatabase();
    const stmt = database.prepare('UPDATE mods SET download_count = ? WHERE id = ?');
    stmt.run(downloadCount, modId);
}

/**
 * Get download counts for multiple mods by their IDs
 * Returns a map of modId -> downloadCount (only includes mods that have cached counts)
 */
export function getModsDownloadCounts(ids: number[]): Record<number, number> {
    if (ids.length === 0) return {};

    const database = initDatabase();
    const placeholders = ids.map(() => '?').join(',');
    const stmt = database.prepare(
        `SELECT id, download_count FROM mods WHERE id IN (${placeholders}) AND download_count IS NOT NULL`
    );
    const rows = stmt.all(...ids) as Array<{ id: number; download_count: number }>;

    const result: Record<number, number> = {};
    for (const row of rows) {
        result[row.id] = row.download_count;
    }
    return result;
}

/**
 * Get NSFW status for multiple mods by their IDs
 * Returns a map of modId -> isNsfw (only includes mods that exist in cache)
 */
export function getModsNsfwStatus(ids: number[]): Record<number, boolean> {
    if (ids.length === 0) return {};

    const database = initDatabase();
    const placeholders = ids.map(() => '?').join(',');
    const stmt = database.prepare(`SELECT id, is_nsfw FROM mods WHERE id IN (${placeholders})`);
    const rows = stmt.all(...ids) as Array<{ id: number; is_nsfw: number }>;

    const result: Record<number, boolean> = {};
    for (const row of rows) {
        result[row.id] = row.is_nsfw === 1;
    }
    return result;
}

/**
 * Run database migrations for schema updates
 */
function runMigrations(database: Database.Database): void {
    dropLegacyCrcTables(database);

    let tableInfo = getTableColumns(database, 'mods');
    const legacyColumns = ['tags', 'file_metadata_source_date_modified', 'file_metadata_checked_at'];
    const hasLegacyColumns = legacyColumns.some((column) => tableInfo.includes(column));
    const rebuildSearch = hasLegacyColumns || shouldRebuildSearch(database);
    if (rebuildSearch) {
        console.log('[ModDatabase] Running migration: rebuilding mods search index');
        dropSearchObjects(database);
    }

    const hasDownloadCount = tableInfo.includes('download_count');

    if (!hasDownloadCount) {
        console.log('[ModDatabase] Running migration: adding download_count column');
        database.exec('ALTER TABLE mods ADD COLUMN download_count INTEGER');
    }

    const hasAudioUrl = tableInfo.includes('audio_url');
    if (!hasAudioUrl) {
        console.log('[ModDatabase] Running migration: adding audio_url column');
        database.exec('ALTER TABLE mods ADD COLUMN audio_url TEXT');
    }

    tableInfo = getTableColumns(database, 'mods');
    for (const column of legacyColumns) {
        if (tableInfo.includes(column)) {
            console.log(`[ModDatabase] Running migration: removing legacy ${column} column`);
            database.exec(`ALTER TABLE mods DROP COLUMN ${column}`);
        }
    }

    database.exec(SEARCH_SCHEMA_SQL);

    // Recreating mods_fts above leaves the index empty: its sync triggers only
    // fire on future writes, not for rows already in `mods`. Repopulate it from
    // the existing content table so search keeps working immediately, instead of
    // returning nothing until the next full catalog sync.
    if (rebuildSearch) {
        try {
            database.exec(`INSERT INTO mods_fts(mods_fts) VALUES('rebuild');`);
            console.log('[ModDatabase] Repopulated mods search index from existing rows');
        } catch (err) {
            console.warn('[ModDatabase] Failed to repopulate search index (will refill on next sync):', err);
        }
    }
}

function dropLegacyCrcTables(database: Database.Database): void {
    const legacyTables = [
        'gamebanana_file_sync_state',
        'archive_crc_probes',
        'archive_vpk_crc_entries',
        'gamebanana_files',
    ];
    const existing = database.prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name IN (${legacyTables.map(() => '?').join(',')})
    `).all(...legacyTables) as Array<{ name: string }>;

    if (existing.length === 0) return;

    const names = existing.map((row) => row.name);
    console.log(`[ModDatabase] Removing legacy CRC cache tables: ${names.join(', ')}`);
    database.exec(names.map((name) => `DROP TABLE IF EXISTS ${name};`).join('\n'));
}

function getTableColumns(database: Database.Database, tableName: string): string[] {
    return (database.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>).map((column) => column.name);
}

function shouldRebuildSearch(database: Database.Database): boolean {
    const columns = getTableColumns(database, 'mods_fts');
    return columns.length > 0 && columns.join('|') !== 'name|category_name|submitter_name';
}

function dropSearchObjects(database: Database.Database): void {
    database.exec(`
        DROP TRIGGER IF EXISTS mods_ai;
        DROP TRIGGER IF EXISTS mods_ad;
        DROP TRIGGER IF EXISTS mods_au;
        DROP TABLE IF EXISTS mods_fts;
    `);
}
