import Database from 'better-sqlite3';
import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import type { ArchiveVpkCrcEntry } from './archiveCrc';

export type UnknownCrcStatus = 'pending' | 'parsed' | 'failed' | 'unsupported';

export interface UnknownCrcFileInput {
    fileId: number;
    modId: number;
    modName: string;
    section: string;
    categoryName: string | null;
    thumbnailUrl: string | null;
    nsfw: boolean;
    dateModified: number;
    fileName: string;
    fileSize: number;
    downloadUrl: string;
    isArchived: boolean;
    md5: string | null;
}

export interface UnknownCrcFile extends UnknownCrcFileInput {
    archiveType: string | null;
    status: UnknownCrcStatus;
    error: string | null;
    bytesFetched: number;
    checkedAt: number | null;
    parserVersion: number;
}

export interface UnknownCrcLookupMatch {
    modId: number;
    modName: string;
    section: string;
    categoryName: string | null;
    thumbnailUrl: string | null;
    nsfw: boolean;
    dateModified: number;
    fileId: number;
    fileName: string;
    isArchived: boolean;
    entryName: string;
    crc32: string;
    uncompressedSize: number;
    compressedSize: number;
}

let db: Database.Database | null = null;
const FAILED_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;
export const UNKNOWN_CRC_PARSER_VERSION = 2;

export interface UnknownCrcLookupQuery {
    key: string;
    crc32: string;
    uncompressedSize: number;
}

export interface UnknownCrcModRequest {
    modId: number;
    section: string;
    dateModified: number;
}

const LOOKUP_CRC_SQL = `
    SELECT
        files.mod_id,
        files.mod_name,
        files.section,
        files.category_name,
        files.thumbnail_url,
        files.nsfw,
        COALESCE(entries.source_date_modified, files.date_modified) AS date_modified,
        files.file_id,
        COALESCE(entries.source_file_name, files.file_name) AS file_name,
        COALESCE(entries.source_is_archived, files.is_archived) AS is_archived,
        entries.entry_name,
        entries.crc32,
        entries.uncompressed_size,
        entries.compressed_size
    FROM crc_entries entries
    JOIN crc_files files ON files.file_id = entries.file_id
    WHERE entries.crc32 = @crc32
      AND entries.uncompressed_size = @uncompressedSize
    ORDER BY
        COALESCE(entries.source_is_archived, files.is_archived) ASC,
        COALESCE(entries.source_date_modified, files.date_modified) DESC,
        files.file_id DESC
    LIMIT 1
`;

function dbPath(): string {
    return path.join(app.getPath('userData'), 'unknown-crc-cache.db');
}

function now(): number {
    return Math.floor(Date.now() / 1000);
}

function initUnknownCrcDb(): Database.Database {
    if (db) return db;

    const file = dbPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    db = new Database(file);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.exec(`
        CREATE TABLE IF NOT EXISTS crc_files (
            file_id INTEGER PRIMARY KEY,
            mod_id INTEGER NOT NULL,
            mod_name TEXT NOT NULL,
            section TEXT NOT NULL,
            category_name TEXT,
            thumbnail_url TEXT,
            nsfw INTEGER DEFAULT 0,
            date_modified INTEGER DEFAULT 0,
            file_name TEXT NOT NULL,
            file_size INTEGER DEFAULT 0,
            download_url TEXT NOT NULL,
            is_archived INTEGER DEFAULT 0,
            md5 TEXT,
            archive_type TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            error TEXT,
            bytes_fetched INTEGER DEFAULT 0,
            checked_at INTEGER,
            parser_version INTEGER DEFAULT 0,
            cached_at INTEGER DEFAULT (strftime('%s', 'now'))
        );

        CREATE INDEX IF NOT EXISTS idx_unknown_crc_files_status ON crc_files(status);
        CREATE INDEX IF NOT EXISTS idx_unknown_crc_files_mod ON crc_files(section, mod_id);

        CREATE TABLE IF NOT EXISTS crc_entries (
            file_id INTEGER NOT NULL,
            entry_name TEXT NOT NULL,
            crc32 TEXT NOT NULL,
            compressed_size INTEGER DEFAULT 0,
            uncompressed_size INTEGER NOT NULL,
            source_file_name TEXT,
            source_file_size INTEGER,
            source_md5 TEXT,
            source_date_modified INTEGER,
            source_is_archived INTEGER,
            parsed_at INTEGER DEFAULT (strftime('%s', 'now')),
            PRIMARY KEY(file_id, entry_name, crc32, uncompressed_size),
            FOREIGN KEY(file_id) REFERENCES crc_files(file_id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_unknown_crc_entries_lookup
            ON crc_entries(crc32, uncompressed_size);
        CREATE INDEX IF NOT EXISTS idx_unknown_crc_entries_file
            ON crc_entries(file_id);
    `);
    ensureCrcEntrySourceColumns(db);
    db.prepare(`
        DELETE FROM crc_files
        WHERE status = 'failed'
          AND checked_at IS NOT NULL
          AND checked_at < ?
          AND NOT EXISTS (
              SELECT 1 FROM crc_entries
              WHERE crc_entries.file_id = crc_files.file_id
          )
    `).run(now() - FAILED_CACHE_TTL_SECONDS);

    return db;
}

function ensureCrcEntrySourceColumns(database: Database.Database): void {
    const columns = new Set(
        (database.prepare('PRAGMA table_info(crc_entries)').all() as Array<{ name: string }>)
            .map((column) => column.name)
    );
    const addColumn = (name: string, definition: string) => {
        if (!columns.has(name)) {
            database.exec(`ALTER TABLE crc_entries ADD COLUMN ${definition}`);
            columns.add(name);
        }
    };

    addColumn('source_file_name', 'source_file_name TEXT');
    addColumn('source_file_size', 'source_file_size INTEGER');
    addColumn('source_md5', 'source_md5 TEXT');
    addColumn('source_date_modified', 'source_date_modified INTEGER');
    addColumn('source_is_archived', 'source_is_archived INTEGER');

    const fileColumns = new Set(
        (database.prepare('PRAGMA table_info(crc_files)').all() as Array<{ name: string }>)
            .map((column) => column.name)
    );
    if (!fileColumns.has('parser_version')) {
        database.exec('ALTER TABLE crc_files ADD COLUMN parser_version INTEGER DEFAULT 0');
    }
}

function rowToFile(row: Record<string, unknown>): UnknownCrcFile {
    return {
        fileId: row.file_id as number,
        modId: row.mod_id as number,
        modName: row.mod_name as string,
        section: row.section as string,
        categoryName: row.category_name as string | null,
        thumbnailUrl: row.thumbnail_url as string | null,
        nsfw: row.nsfw === 1,
        dateModified: (row.date_modified as number) ?? 0,
        fileName: row.file_name as string,
        fileSize: (row.file_size as number) ?? 0,
        downloadUrl: row.download_url as string,
        isArchived: row.is_archived === 1,
        md5: row.md5 as string | null,
        archiveType: row.archive_type as string | null,
        status: (row.status as UnknownCrcStatus | null) ?? 'pending',
        error: row.error as string | null,
        bytesFetched: (row.bytes_fetched as number) ?? 0,
        checkedAt: row.checked_at as number | null,
        parserVersion: (row.parser_version as number) ?? 0,
    };
}

export function lookupUnknownCrcMatch(crc32: string, uncompressedSize: number): UnknownCrcLookupMatch | null {
    const database = initUnknownCrcDb();
    const row = database.prepare(LOOKUP_CRC_SQL).get({
        crc32: crc32.toLowerCase(),
        uncompressedSize,
    }) as Record<string, unknown> | undefined;

    return row ? rowToLookupMatch(row) : null;
}

export function lookupUnknownCrcMatches(queries: UnknownCrcLookupQuery[]): Map<string, UnknownCrcLookupMatch> {
    const database = initUnknownCrcDb();
    const stmt = database.prepare(LOOKUP_CRC_SQL);
    const matches = new Map<string, UnknownCrcLookupMatch>();

    for (const query of queries) {
        const row = stmt.get({
            crc32: query.crc32.toLowerCase(),
            uncompressedSize: query.uncompressedSize,
        }) as Record<string, unknown> | undefined;
        if (row) {
            matches.set(query.key, rowToLookupMatch(row));
        }
    }

    return matches;
}

function rowToLookupMatch(row: Record<string, unknown>): UnknownCrcLookupMatch {
    return {
        modId: row.mod_id as number,
        modName: row.mod_name as string,
        section: row.section as string,
        categoryName: row.category_name as string | null,
        thumbnailUrl: row.thumbnail_url as string | null,
        nsfw: row.nsfw === 1,
        dateModified: (row.date_modified as number) ?? 0,
        fileId: row.file_id as number,
        fileName: row.file_name as string,
        isArchived: row.is_archived === 1,
        entryName: row.entry_name as string,
        crc32: row.crc32 as string,
        uncompressedSize: row.uncompressed_size as number,
        compressedSize: (row.compressed_size as number) ?? 0,
    };
}

export function upsertUnknownCrcFiles(files: UnknownCrcFileInput[]): UnknownCrcFile[] {
    if (files.length === 0) return [];
    const database = initUnknownCrcDb();
    const cachedAt = now();
    const existingStmt = database.prepare('SELECT * FROM crc_files WHERE file_id = ?');
    const upsertStmt = database.prepare(`
        INSERT INTO crc_files (
            file_id, mod_id, mod_name, section, category_name, thumbnail_url,
            nsfw, date_modified, file_name, file_size, download_url, is_archived,
            md5, archive_type, status, error, bytes_fetched, checked_at, parser_version, cached_at
        ) VALUES (
            @fileId, @modId, @modName, @section, @categoryName, @thumbnailUrl,
            @nsfw, @dateModified, @fileName, @fileSize, @downloadUrl, @isArchived,
            @md5, @archiveType, @status, @error, @bytesFetched, @checkedAt, @parserVersion, @cachedAt
        )
        ON CONFLICT(file_id) DO UPDATE SET
            mod_id = excluded.mod_id,
            mod_name = excluded.mod_name,
            section = excluded.section,
            category_name = excluded.category_name,
            thumbnail_url = excluded.thumbnail_url,
            nsfw = excluded.nsfw,
            date_modified = excluded.date_modified,
            file_name = excluded.file_name,
            file_size = excluded.file_size,
            download_url = excluded.download_url,
            is_archived = excluded.is_archived,
            md5 = excluded.md5,
            archive_type = excluded.archive_type,
            status = excluded.status,
            error = excluded.error,
            bytes_fetched = excluded.bytes_fetched,
            checked_at = excluded.checked_at,
            parser_version = excluded.parser_version,
            cached_at = excluded.cached_at
    `);

    const run = database.transaction(() => {
        const deleteEntriesStmt = database.prepare('DELETE FROM crc_entries WHERE file_id = ?');
        for (const file of files) {
            const existing = existingStmt.get(file.fileId) as Record<string, unknown> | undefined;
            const changed = !existing ||
                existing.file_name !== file.fileName ||
                existing.file_size !== file.fileSize ||
                existing.download_url !== file.downloadUrl ||
                existing.is_archived !== (file.isArchived ? 1 : 0) ||
                existing.md5 !== file.md5;

            if (changed && existing) {
                deleteEntriesStmt.run(file.fileId);
            }

            upsertStmt.run({
                ...file,
                nsfw: file.nsfw ? 1 : 0,
                isArchived: file.isArchived ? 1 : 0,
                archiveType: changed ? null : (existing?.archive_type ?? null),
                status: changed ? 'pending' : (existing?.status ?? 'pending'),
                error: changed ? null : (existing?.error ?? null),
                bytesFetched: changed ? 0 : (existing?.bytes_fetched ?? 0),
                checkedAt: changed ? null : (existing?.checked_at ?? null),
                parserVersion: changed ? 0 : (existing?.parser_version ?? 0),
                cachedAt,
            });
        }
    });
    run();

    const placeholders = files.map(() => '?').join(',');
    const rows = database
        .prepare(`SELECT * FROM crc_files WHERE file_id IN (${placeholders})`)
        .all(...files.map((file) => file.fileId)) as Record<string, unknown>[];
    const byId = new Map(rows.map((row) => [row.file_id as number, rowToFile(row)]));
    return files.map((file) => byId.get(file.fileId)).filter(Boolean) as UnknownCrcFile[];
}

export function getUnknownCrcFilesForMods(requests: UnknownCrcModRequest[]): Map<string, UnknownCrcFile[]> {
    const result = new Map<string, UnknownCrcFile[]>();
    if (requests.length === 0) return result;

    const database = initUnknownCrcDb();
    const stmt = database.prepare(`
        SELECT *
        FROM crc_files
        WHERE section = @section
          AND mod_id = @modId
          AND date_modified = @dateModified
    `);

    for (const request of requests) {
        const key = `${request.section}:${request.modId}`;
        const rows = stmt.all(request) as Record<string, unknown>[];
        if (rows.length > 0) {
            result.set(key, rows.map(rowToFile));
        }
    }

    return result;
}

export function replaceUnknownCrcEntries(
    fileId: number,
    entries: ArchiveVpkCrcEntry[],
    update: { archiveType: string; bytesFetched: number }
): void {
    const database = initUnknownCrcDb();
    const parsedAt = now();
    const source = database.prepare(`
        SELECT file_name, file_size, md5, date_modified, is_archived
        FROM crc_files
        WHERE file_id = ?
    `).get(fileId) as Record<string, unknown> | undefined;
    const updateStmt = database.prepare(`
        UPDATE crc_files
        SET status = 'parsed',
            archive_type = @archiveType,
            error = NULL,
            bytes_fetched = @bytesFetched,
            checked_at = @checkedAt,
            parser_version = @parserVersion
        WHERE file_id = @fileId
    `);
    const run = database.transaction(() => {
        const insertStmt = database.prepare(`
            INSERT INTO crc_entries (
                file_id, entry_name, crc32, compressed_size, uncompressed_size,
                source_file_name, source_file_size, source_md5, source_date_modified,
                source_is_archived, parsed_at
            ) VALUES (
                @fileId, @entryName, @crc32, @compressedSize, @uncompressedSize,
                @sourceFileName, @sourceFileSize, @sourceMd5, @sourceDateModified,
                @sourceIsArchived, @parsedAt
            )
            ON CONFLICT(file_id, entry_name, crc32, uncompressed_size) DO UPDATE SET
                compressed_size = excluded.compressed_size,
                source_file_name = excluded.source_file_name,
                source_file_size = excluded.source_file_size,
                source_md5 = excluded.source_md5,
                source_date_modified = excluded.source_date_modified,
                source_is_archived = excluded.source_is_archived,
                parsed_at = excluded.parsed_at
        `);
        for (const entry of entries) {
            insertStmt.run({
                fileId,
                entryName: entry.name,
                crc32: entry.crc32.toLowerCase(),
                compressedSize: entry.compressedSize,
                uncompressedSize: entry.uncompressedSize,
                sourceFileName: source?.file_name ?? null,
                sourceFileSize: source?.file_size ?? null,
                sourceMd5: source?.md5 ?? null,
                sourceDateModified: source?.date_modified ?? null,
                sourceIsArchived: source?.is_archived ?? null,
                parsedAt,
            });
        }
        updateStmt.run({
            fileId,
            archiveType: update.archiveType,
            bytesFetched: update.bytesFetched,
            checkedAt: parsedAt,
            parserVersion: UNKNOWN_CRC_PARSER_VERSION,
        });
    });
    run();
}

export function updateUnknownCrcFileStatus(
    fileId: number,
    update: {
        status: UnknownCrcStatus;
        archiveType: string | null;
        bytesFetched: number;
        error: string | null;
    }
): void {
    const database = initUnknownCrcDb();
    database.prepare(`
        UPDATE crc_files
        SET status = @status,
            archive_type = @archiveType,
            error = @error,
            bytes_fetched = @bytesFetched,
            checked_at = @checkedAt,
            parser_version = @parserVersion
        WHERE file_id = @fileId
    `).run({
        fileId,
        status: update.status,
        archiveType: update.archiveType,
        error: update.error,
        bytesFetched: update.bytesFetched,
        checkedAt: now(),
        parserVersion: UNKNOWN_CRC_PARSER_VERSION,
    });
}

export function getUnknownCrcEntryCount(): number {
    const database = initUnknownCrcDb();
    const row = database.prepare('SELECT COUNT(*) AS count FROM crc_entries').get() as { count: number };
    return row.count;
}
