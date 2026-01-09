import { initDatabase, CachedMod, mapRowToMod } from './modDatabase';

/**
 * Escape special FTS5 characters in search terms
 * FTS5 treats these as operators: AND, OR, NOT, -, ", *, ^, :
 */
function escapeFts5Term(term: string): string {
    // Remove characters that could break FTS5 queries
    // Keep alphanumeric and basic punctuation that's safe
    return term.replace(/["\-*^:()]/g, ' ').trim();
}

export interface SearchOptions {
    query?: string;
    section?: string;
    categoryId?: number;
    sortBy?: 'relevance' | 'likes' | 'date' | 'date_added' | 'views' | 'name';
    limit?: number;
    offset?: number;
}

export interface SearchResult {
    mods: CachedMod[];
    totalCount: number;
    offset: number;
    limit: number;
}

/**
 * Search mods using FTS5 full-text search
 */
export function searchMods(options: SearchOptions): SearchResult {
    const database = initDatabase();
    const {
        query,
        section,
        categoryId,
        sortBy = 'relevance',
    } = options;

    // Validate and cap pagination values
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 500);
    const offset = Math.max(options.offset ?? 0, 0);

    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    // FTS5 search if query provided
    let fromClause = 'FROM mods';
    let rankSelect = '0 as rank';
    if (query && query.trim()) {
        // P2 fix #15: Limit query length to prevent ReDoS/expensive queries
        const truncatedQuery = query.slice(0, 500);

        // Escape special FTS5 characters and use prefix matching
        const escapedQuery = escapeFts5Term(truncatedQuery);
        if (escapedQuery) {
            const searchTerms = escapedQuery.split(/\s+/)
                .filter(term => term.length > 0)
                .slice(0, 20) // Limit number of search terms
                .map(term => `${term}*`)
                .join(' ');
            if (searchTerms) {
                params.query = searchTerms;
                fromClause = 'FROM mods JOIN mods_fts ON mods.id = mods_fts.rowid';
                rankSelect = 'bm25(mods_fts) as rank';
                conditions.push('mods_fts MATCH @query');
            }
        }
    }

    // Filter by section
    if (section) {
        conditions.push('mods.section = @section');
        params.section = section;
    }

    // Filter by category/hero
    if (categoryId !== undefined) {
        conditions.push('mods.category_id = @categoryId');
        params.categoryId = categoryId;
    }

    // Build WHERE clause
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Determine ORDER BY
    let orderBy: string;
    switch (sortBy) {
        case 'relevance':
            orderBy = query?.trim() ? 'rank ASC' : 'date_modified DESC';
            break;
        case 'likes':
            orderBy = 'like_count DESC';
            break;
        case 'date':
            orderBy = 'date_modified DESC';
            break;
        case 'date_added':
            orderBy = 'date_added DESC';
            break;
        case 'views':
            orderBy = 'view_count DESC';
            break;
        case 'name':
            orderBy = 'name COLLATE NOCASE ASC';
            break;
        default:
            orderBy = 'date_modified DESC';
    }

    // Count query
    const countQuery = `SELECT COUNT(*) as count ${fromClause} ${whereClause}`;
    const countStmt = database.prepare(countQuery);
    const countRow = countStmt.get(params) as { count: number };
    const totalCount = countRow.count;

    // Main query with pagination
    const mainQuery = `SELECT mods.*, ${rankSelect} ${fromClause} ${whereClause} ORDER BY ${orderBy} LIMIT @limit OFFSET @offset`;
    params.limit = limit;
    params.offset = offset;

    const stmt = database.prepare(mainQuery);
    const rows = stmt.all(params) as Record<string, unknown>[];

    const mods = rows.map(mapRowToMod);

    return {
        mods,
        totalCount,
        offset,
        limit,
    };
}

/**
 * Get all unique categories/heroes in the database
 */
export function getCategories(section?: string): Array<{ id: number; name: string; count: number }> {
    const database = initDatabase();
    let query = `
        SELECT category_id as id, category_name as name, COUNT(*) as count
        FROM mods
        WHERE category_id IS NOT NULL AND category_name IS NOT NULL
    `;
    const params: Record<string, unknown> = {};

    if (section) {
        query += ' AND section = @section';
        params.section = section;
    }

    query += ' GROUP BY category_id, category_name ORDER BY name COLLATE NOCASE';

    const stmt = database.prepare(query);
    return stmt.all(params) as Array<{ id: number; name: string; count: number }>;
}

/**
 * Get section statistics
 */
export function getSectionStats(): Array<{ section: string; count: number }> {
    const database = initDatabase();
    const stmt = database.prepare(`
        SELECT section, COUNT(*) as count
        FROM mods
        GROUP BY section
        ORDER BY count DESC
    `);
    return stmt.all() as Array<{ section: string; count: number }>;
}
