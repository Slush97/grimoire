import { initDatabase, mapRowToMod } from './modDatabase';
// SearchOptions/SearchResult are the canonical SearchLocalModsOptions and
// LocalSearchResult from src/types/electron.ts under this module's
// historical names.
import type {
    SearchLocalModsOptions as SearchOptions,
    LocalSearchResult as SearchResult,
} from '../../../src/types/electron';
export type { SearchOptions, SearchResult };

/**
 * Escape special FTS5 characters in search terms
 * FTS5 treats these as operators: AND, OR, NOT, -, ", *, ^, :
 * and ' opens a string literal, so an unbalanced one is a syntax error
 * (a name like "Tu'er Shen" crashed the whole query). The unicode61
 * tokenizer already splits on these, so replacing them with a space and
 * prefix-matching each token matches the same content.
 */
function escapeFts5Term(term: string): string {
    // Remove characters that could break FTS5 queries
    // Keep alphanumeric and basic punctuation that's safe
    return term.replace(/["\-*^:()']/g, ' ').trim();
}


/**
 * Order-by clause for a sort option. `hasQuery` differentiates relevance:
 * with a query, sort by FTS5 rank; without one, fall back to recency.
 */
function buildOrderBy(sortBy: SearchOptions['sortBy'], hasQuery: boolean): string {
    switch (sortBy) {
        case 'relevance':
            return hasQuery ? 'rank ASC' : 'date_modified DESC';
        case 'likes':
            return 'like_count DESC';
        case 'date':
            return 'date_modified DESC';
        case 'date_added':
            return 'date_added DESC';
        case 'views':
            return 'view_count DESC';
        case 'name':
            return 'name COLLATE NOCASE ASC';
        default:
            return 'date_modified DESC';
    }
}

/**
 * Append the content-rating and recency filters shared by the FTS and fallback
 * paths. Mutates the passed conditions/params so both code paths stay in sync.
 */
function applyContentFilters(
    conditions: string[],
    params: Record<string, unknown>,
    nsfw: SearchOptions['nsfw'],
    addedWithin: SearchOptions['addedWithin'],
    addedFrom?: number,
    addedTo?: number
): void {
    if (nsfw === 'sfw') {
        conditions.push('mods.is_nsfw = 0');
    } else if (nsfw === 'nsfw') {
        conditions.push('mods.is_nsfw = 1');
    }

    // date_added is a Unix timestamp in seconds (GameBanana's _tsDateAdded).
    if (addedWithin === 'custom') {
        if (typeof addedFrom === 'number') {
            params.addedAfter = addedFrom;
            conditions.push('mods.date_added >= @addedAfter');
        }
        if (typeof addedTo === 'number') {
            params.addedBefore = addedTo;
            conditions.push('mods.date_added <= @addedBefore');
        }
    } else if (addedWithin && addedWithin !== 'all') {
        const windowSeconds =
            addedWithin === 'today' ? 86_400 : addedWithin === 'week' ? 7 * 86_400 : 30 * 86_400;
        params.addedAfter = Math.floor(Date.now() / 1000) - windowSeconds;
        conditions.push('mods.date_added >= @addedAfter');
    }
}

/**
 * Fallback search used when the FTS5 path returns zero results. FTS5 is
 * tokenized and prefix-only, so creative names ("MìnaMod-v2", typos, partial
 * substrings inside a word) miss even when they should match. This runs a
 * substring LIKE against the mod name as a safety net — slower (no FTS
 * index), but only fires when FTS5 would have shown an empty page.
 */
function runFallbackSubstringSearch(
    database: ReturnType<typeof initDatabase>,
    rawQuery: string,
    section: string | undefined,
    categoryId: number | undefined,
    heroName: string | undefined,
    skinsCategoryId: number | undefined,
    sortBy: SearchOptions['sortBy'],
    nsfw: SearchOptions['nsfw'],
    addedWithin: SearchOptions['addedWithin'],
    addedFrom: number | undefined,
    addedTo: number | undefined,
    limit: number,
    offset: number
): SearchResult {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    // Split on whitespace so multi-term searches still all have to match.
    // Cap at 10 terms; longer queries get truncated rather than bloating the SQL.
    const terms = rawQuery
        .trim()
        .split(/\s+/)
        .filter((t) => t.length > 0)
        .slice(0, 10);

    terms.forEach((term, i) => {
        const key = `fallback_term_${i}`;
        params[key] = `%${term.toLowerCase()}%`;
        conditions.push(`LOWER(mods.name) LIKE @${key}`);
    });

    if (section) {
        conditions.push('mods.section = @section');
        params.section = section;
    }

    if (categoryId !== undefined) {
        if (heroName && skinsCategoryId !== undefined) {
            params.heroNamePattern = `%${heroName.toLowerCase()}%`;
            conditions.push('LOWER(mods.name) LIKE @heroNamePattern');
        } else {
            conditions.push('mods.category_id = @categoryId');
            params.categoryId = categoryId;
        }
    }

    applyContentFilters(conditions, params, nsfw, addedWithin, addedFrom, addedTo);

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const orderBy = buildOrderBy(sortBy, false); // no FTS rank in fallback

    const countRow = database
        .prepare(`SELECT COUNT(*) as count FROM mods ${whereClause}`)
        .get(params) as { count: number };
    const totalCount = countRow.count;

    params.limit = limit;
    params.offset = offset;
    const rows = database
        .prepare(
            `SELECT mods.*, 0 as rank FROM mods ${whereClause} ORDER BY ${orderBy} LIMIT @limit OFFSET @offset`
        )
        .all(params) as Record<string, unknown>[];

    return {
        mods: rows.map(mapRowToMod),
        totalCount,
        offset,
        limit,
    };
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
        heroName,
        skinsCategoryId,
        sortBy = 'relevance',
        nsfw = 'all',
        addedWithin = 'all',
        addedFrom,
        addedTo,
    } = options;

    // Validate and cap pagination values
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 500);
    const offset = Math.max(options.offset ?? 0, 0);

    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    // FTS5 search if query provided
    let fromClause = 'FROM mods';
    let rankSelect = '0 as rank';
    let appliedFtsQuery = false;
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
                appliedFtsQuery = true;
            }
        }
    }

    // Filter by section
    if (section) {
        conditions.push('mods.section = @section');
        params.section = section;
    }

    // Filter by category/hero with name-based search for hero filtering
    if (categoryId !== undefined) {
        if (heroName && skinsCategoryId !== undefined) {
            // Hero search: Find ALL mods with hero name in title, regardless of category.
            // This catches mods in Skins, Skins/Mina, and even mods in other categories.
            params.heroNamePattern = `%${heroName.toLowerCase()}%`;
            conditions.push('LOWER(mods.name) LIKE @heroNamePattern');
            console.log(`[searchMods] Hero search: heroName="${heroName}" (searching all categories)`);
        } else {
            // Standard category filter
            conditions.push('mods.category_id = @categoryId');
            params.categoryId = categoryId;
        }
    }

    applyContentFilters(conditions, params, nsfw, addedWithin, addedFrom, addedTo);

    // Build WHERE clause
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Debug logging for hero search issues
    if (heroName && skinsCategoryId !== undefined) {
        console.log(`[searchMods] WHERE clause: ${whereClause}`);
        console.log(`[searchMods] Params:`, JSON.stringify(params));
    }

    const orderBy = buildOrderBy(sortBy, !!query?.trim());

    // Count query
    const countQuery = `SELECT COUNT(*) as count ${fromClause} ${whereClause}`;
    const countStmt = database.prepare(countQuery);
    const countRow = countStmt.get(params) as { count: number };
    const totalCount = countRow.count;

    if (heroName && skinsCategoryId !== undefined) {
        console.log(`[searchMods] Result count: ${totalCount}`);
    }

    // FTS5 missed — fall back to substring matching so creative names / typos
    // still surface something instead of an empty page. Only triggers when a
    // real query was applied (avoids running an unnecessary second query when
    // the user hasn't typed anything yet).
    if (totalCount === 0 && appliedFtsQuery && query) {
        return runFallbackSubstringSearch(
            database,
            query.slice(0, 500),
            section,
            categoryId,
            heroName,
            skinsCategoryId,
            sortBy,
            nsfw,
            addedWithin,
            addedFrom,
            addedTo,
            limit,
            offset
        );
    }

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
