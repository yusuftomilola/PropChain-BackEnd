import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Database Index Strategy Service
 *
 * Manages database index creation, monitoring, and optimization
 */
@Injectable()
export class IndexStrategyService {
  private readonly logger = new Logger(IndexStrategyService.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Analyze table and suggest optimal indexes
   */
  analyzeTableIndexes(tableName: string, tableStats: TableStats): IndexAnalysis {
    const suggestions: IndexSuggestion[] = [];

    // Analyze WHERE clause patterns
    suggestions.push(...this.analyzeWherePatterns(tableName, tableStats));

    // Analyze JOIN patterns
    suggestions.push(...this.analyzeJoinPatterns(tableName, tableStats));

    // Analyze ORDER BY patterns
    suggestions.push(...this.analyzeOrderByPatterns(tableName, tableStats));

    // Analyze GROUP BY patterns
    suggestions.push(...this.analyzeGroupByPatterns(tableName, tableStats));

    return {
      tableName,
      tableStats,
      currentIndexes: tableStats.indexes,
      suggestions,
      unusedIndexes: this.findUnusedIndexes(tableStats),
      missingIndexes: this.findMissingIndexes(tableStats),
      duplicateIndexes: this.findDuplicateIndexes(tableStats),
    };
  }

  /**
   * Generate CREATE INDEX statements
   */
  generateCreateIndexSQL(suggestion: IndexSuggestion): string {
    const indexName = this.generateIndexName(suggestion.tableName, suggestion.columns, suggestion.type);
    const columns = suggestion.columns.join(', ');

    let sql = `CREATE INDEX ${indexName} ON ${suggestion.tableName}`;

    if (suggestion.type !== 'btree') {
      sql += ` USING ${suggestion.type}`;
    }

    sql += ` (${columns})`;

    if (suggestion.where) {
      sql += ` WHERE ${suggestion.where}`;
    }

    if (suggestion.concurrently) {
      sql = `CREATE CONCURRENTLY${sql.substring('CREATE'.length)}`;
    }

    return `${sql};`;
  }

  /**
   * Generate DROP INDEX statements
   */
  generateDropIndexSQL(indexName: string, tableName: string): string {
    return `DROP INDEX IF EXISTS ${indexName} ON ${tableName};`;
  }

  /**
   * Estimate index size
   */
  estimateIndexSize(suggestion: IndexSuggestion, tableStats: TableStats): IndexSizeEstimate {
    const avgRowSize = tableStats.avgRowSize || 1000; // bytes
    const rowCount = tableStats.rowCount;
    const indexOverhead = 1.1; // 10% overhead

    // Base size calculation
    let indexSize = rowCount * avgRowSize * indexOverhead;

    // Adjust based on index type
    switch (suggestion.type) {
      case 'hash':
        indexSize *= 0.8; // Hash indexes are more compact
        break;
      case 'gist':
        indexSize *= 1.5; // GIST indexes are larger
        break;
      case 'gin':
        indexSize *= 2.0; // GIN indexes are much larger
        break;
      default:
        // B-tree is baseline
        break;
    }

    // Adjust for partial indexes
    if (suggestion.where) {
      const selectivity = this.estimateSelectivity(suggestion.where);
      indexSize *= selectivity;
    }

    return {
      estimatedSizeBytes: Math.round(indexSize),
      estimatedSizeMB: Math.round((indexSize / 1024 / 1024) * 100) / 100,
      growthRate: this.estimateGrowthRate(tableStats),
    };
  }

  /**
   * Analyze WHERE clause patterns for index suggestions
   */
  private analyzeWherePatterns(tableName: string, stats: TableStats): IndexSuggestion[] {
    const suggestions: IndexSuggestion[] = [];

    // Analyze query patterns from stats
    for (const pattern of stats.queryPatterns || []) {
      if (pattern.type === 'where') {
        const columns = this.extractColumnsFromCondition(pattern.condition);

        if (columns.length > 0) {
          suggestions.push({
            tableName,
            columns,
            type: 'btree',
            reason: `Frequently used in WHERE clause (${pattern.frequency} times)`,
            priority: this.calculatePriority(pattern.frequency, pattern.avgImpact),
            estimatedBenefit: pattern.avgImpact,
          });
        }
      }
    }

    return suggestions;
  }

  /**
   * Analyze JOIN patterns for index suggestions
   */
  private analyzeJoinPatterns(tableName: string, stats: TableStats): IndexSuggestion[] {
    const suggestions: IndexSuggestion[] = [];

    for (const pattern of stats.queryPatterns || []) {
      if (pattern.type === 'join') {
        const columns = this.extractColumnsFromCondition(pattern.condition);

        if (columns.length > 0) {
          suggestions.push({
            tableName,
            columns,
            type: 'btree',
            reason: `Frequently used in JOIN conditions (${pattern.frequency} times)`,
            priority: this.calculatePriority(pattern.frequency, pattern.avgImpact * 1.2), // JOINs are more impactful
            estimatedBenefit: pattern.avgImpact * 1.2,
          });
        }
      }
    }

    return suggestions;
  }

  /**
   * Analyze ORDER BY patterns for index suggestions
   */
  private analyzeOrderByPatterns(tableName: string, stats: TableStats): IndexSuggestion[] {
    const suggestions: IndexSuggestion[] = [];

    for (const pattern of stats.queryPatterns || []) {
      if (pattern.type === 'orderBy') {
        const columns = pattern.columns || [];

        if (columns.length > 0) {
          suggestions.push({
            tableName,
            columns,
            type: 'btree',
            reason: `Frequently used in ORDER BY (${pattern.frequency} times)`,
            priority: this.calculatePriority(pattern.frequency, pattern.avgImpact * 0.8),
            estimatedBenefit: pattern.avgImpact * 0.8,
          });
        }
      }
    }

    return suggestions;
  }

  /**
   * Analyze GROUP BY patterns for index suggestions
   */
  private analyzeGroupByPatterns(tableName: string, stats: TableStats): IndexSuggestion[] {
    const suggestions: IndexSuggestion[] = [];

    for (const pattern of stats.queryPatterns || []) {
      if (pattern.type === 'groupBy') {
        const columns = pattern.columns || [];

        if (columns.length > 0) {
          suggestions.push({
            tableName,
            columns,
            type: 'hash',
            reason: `Frequently used in GROUP BY (${pattern.frequency} times)`,
            priority: this.calculatePriority(pattern.frequency, pattern.avgImpact * 0.9),
            estimatedBenefit: pattern.avgImpact * 0.9,
          });
        }
      }
    }

    return suggestions;
  }

  /**
   * Find unused indexes
   */
  private findUnusedIndexes(stats: TableStats): UnusedIndex[] {
    const unused: UnusedIndex[] = [];

    for (const index of stats.indexes || []) {
      if (index.usageCount === 0 || (index.lastUsed && this.isIndexOld(index.lastUsed))) {
        unused.push({
          name: index.name,
          columns: index.columns,
          size: index.size,
          lastUsed: index.lastUsed,
          reason: index.usageCount === 0 ? 'Never used' : 'Not used recently',
        });
      }
    }

    return unused;
  }

  /**
   * Find missing indexes based on query patterns
   */
  private findMissingIndexes(stats: TableStats): MissingIndex[] {
    const missing: MissingIndex[] = [];

    // This would analyze actual query logs to find missing indexes
    // For now, return placeholder
    return missing;
  }

  /**
   * Find duplicate or redundant indexes
   */
  private findDuplicateIndexes(stats: TableStats): DuplicateIndex[] {
    const duplicates: DuplicateIndex[] = [];
    const indexGroups = new Map<string, typeof stats.indexes>();

    // Group indexes by their column sets
    for (const index of stats.indexes || []) {
      const key = index.columns.sort().join(',');
      if (!indexGroups.has(key)) {
        indexGroups.set(key, []);
      }
      indexGroups.get(key)?.push(index);
    }

    // Find duplicates
    for (const [columns, indexes] of indexGroups.entries()) {
      if (indexes.length > 1) {
        duplicates.push({
          columns: columns.split(','),
          indexes: indexes.map(idx => idx.name),
          recommendation: 'Consider consolidating these indexes',
        });
      }
    }

    return duplicates;
  }

  /**
   * Generate index name
   */
  private generateIndexName(tableName: string, columns: string[], type: string): string {
    const columnPart = columns.join('_').toLowerCase();
    const typeSuffix = type !== 'btree' ? `_${type}` : '';
    return `idx_${tableName}_${columnPart}${typeSuffix}`;
  }

  /**
   * Calculate priority based on frequency and impact
   */
  private calculatePriority(frequency: number, impact: number): 'low' | 'medium' | 'high' {
    const score = frequency * impact;

    if (score > 100) {
      return 'high';
    }
    if (score > 10) {
      return 'medium';
    }
    return 'low';
  }

  /**
   * Extract columns from SQL condition
   */
  private extractColumnsFromCondition(condition: string): string[] {
    const columns: string[] = [];

    // Simple regex to extract column references
    const matches = condition.match(/(\w+\.\w+|\w+)/g);

    if (matches) {
      for (const match of matches) {
        if (!this.isSqlKeyword(match) && !this.isLiteral(match)) {
          columns.push(match);
        }
      }
    }

    return columns;
  }

  /**
   * Check if string is a SQL keyword
   */
  private isSqlKeyword(word: string): boolean {
    const keywords = [
      'AND',
      'OR',
      'NOT',
      'IN',
      'LIKE',
      'BETWEEN',
      'IS',
      'NULL',
      'TRUE',
      'FALSE',
      'COUNT',
      'SUM',
      'AVG',
      'MIN',
      'MAX',
      'DISTINCT',
      'AS',
      'ON',
      'USING',
    ];
    return keywords.includes(word.toUpperCase());
  }

  /**
   * Check if string is a literal value
   */
  private isLiteral(word: string): boolean {
    return /^['"]|^\d+$/.test(word);
  }

  /**
   * Check if index is old (not used for a long time)
   */
  private isIndexOld(lastUsed: Date): boolean {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    return lastUsed < thirtyDaysAgo;
  }

  /**
   * Estimate selectivity of WHERE clause
   */
  private estimateSelectivity(whereClause: string): number {
    // Simple selectivity estimation
    // In production, this would use statistics from the database
    return 0.1; // Placeholder
  }

  /**
   * Estimate growth rate
   */
  private estimateGrowthRate(stats: TableStats): number {
    // Calculate growth rate based on historical data
    if (stats.growthHistory && stats.growthHistory.length > 1) {
      const recent = stats.growthHistory.slice(-30); // Last 30 days
      const older = stats.growthHistory.slice(-60, -30); // Previous 30 days

      const recentGrowth = recent[recent.length - 1].rowCount - recent[0].rowCount;
      const olderGrowth = older[older.length - 1].rowCount - older[0].rowCount;

      return olderGrowth > 0 ? recentGrowth / olderGrowth : 0;
    }

    return 0.1; // Default 10% growth
  }

  /**
   * Generate index optimization plan
   */
  generateOptimizationPlan(analyses: IndexAnalysis[]): IndexOptimizationPlan {
    const plan: IndexOptimizationPlan = {
      createIndexes: [],
      dropIndexes: [],
      rebuildIndexes: [],
      estimatedImpact: 0,
      estimatedTime: 0,
      risks: [],
    };

    for (const analysis of analyses) {
      // Add index creation suggestions
      for (const suggestion of analysis.suggestions) {
        if (suggestion.priority === 'high') {
          plan.createIndexes.push({
            tableName: suggestion.tableName,
            columns: suggestion.columns,
            type: suggestion.type,
            sql: this.generateCreateIndexSQL(suggestion),
            estimatedBenefit: suggestion.estimatedBenefit,
            estimatedTime: this.estimateIndexCreationTime(suggestion, analysis.tableStats),
          });
        }
      }

      // Add index drop suggestions
      for (const unused of analysis.unusedIndexes) {
        plan.dropIndexes.push({
          tableName: analysis.tableName,
          indexName: unused.name,
          sql: this.generateDropIndexSQL(unused.name, analysis.tableName),
          spaceSaved: unused.size,
          estimatedTime: this.estimateIndexDropTime(unused),
        });
      }
    }

    // Calculate overall impact and time
    plan.estimatedImpact = plan.createIndexes.reduce((sum, idx) => sum + idx.estimatedBenefit, 0);
    plan.estimatedTime =
      plan.createIndexes.reduce((sum, idx) => sum + idx.estimatedTime, 0) +
      plan.dropIndexes.reduce((sum, idx) => sum + idx.estimatedTime, 0);

    // Add risks
    if (plan.createIndexes.length > 5) {
      plan.risks.push('Creating many indexes at once may impact performance');
    }

    if (plan.dropIndexes.length > 0) {
      plan.risks.push('Dropping indexes may affect query performance');
    }

    return plan;
  }

  /**
   * Estimate index creation time
   */
  private estimateIndexCreationTime(suggestion: IndexSuggestion, stats: TableStats): number {
    const baseTime = 1000; // 1 second base time
    const rowCount = stats.rowCount;
    const columnCount = suggestion.columns.length;

    // More rows and columns take longer
    return baseTime + (rowCount / 100000) * 500 * columnCount;
  }

  /**
   * Estimate index drop time
   */
  private estimateIndexDropTime(unused: UnusedIndex): number {
    // Dropping is usually faster than creating
    return 500 + (unused.size / 1000000) * 100; // 500ms base + size factor
  }
}

// Type definitions
interface TableStats {
  tableName: string;
  rowCount: number;
  avgRowSize?: number;
  indexes?: IndexInfo[];
  queryPatterns?: QueryPattern[];
  growthHistory?: Array<{ date: Date; rowCount: number }>;
}

interface IndexInfo {
  name: string;
  columns: string[];
  type: string;
  size: number;
  usageCount: number;
  lastUsed?: Date;
  isUnique: boolean;
  isPrimary: boolean;
}

interface QueryPattern {
  type: 'where' | 'join' | 'orderBy' | 'groupBy';
  condition?: string;
  columns?: string[];
  frequency: number;
  avgImpact: number;
}

export interface IndexSuggestion {
  tableName: string;
  columns: string[];
  type: 'btree' | 'hash' | 'gist' | 'gin';
  reason: string;
  priority: 'low' | 'medium' | 'high';
  estimatedBenefit: number;
  where?: string;
  concurrently?: boolean;
}

export interface IndexAnalysis {
  tableName: string;
  tableStats: TableStats;
  currentIndexes: IndexInfo[];
  suggestions: IndexSuggestion[];
  unusedIndexes: UnusedIndex[];
  missingIndexes: MissingIndex[];
  duplicateIndexes: DuplicateIndex[];
}

export interface UnusedIndex {
  name: string;
  columns: string[];
  size: number;
  lastUsed?: Date;
  reason: string;
}

export interface MissingIndex {
  columns: string[];
  reason: string;
  estimatedBenefit: number;
}

export interface DuplicateIndex {
  columns: string[];
  indexes: string[];
  recommendation: string;
}

export interface IndexSizeEstimate {
  estimatedSizeBytes: number;
  estimatedSizeMB: number;
  growthRate: number;
}

export interface IndexOptimizationPlan {
  createIndexes: Array<{
    tableName: string;
    columns: string[];
    type: string;
    sql: string;
    estimatedBenefit: number;
    estimatedTime: number;
  }>;
  dropIndexes: Array<{
    tableName: string;
    indexName: string;
    sql: string;
    spaceSaved: number;
    estimatedTime: number;
  }>;
  rebuildIndexes: any[];
  estimatedImpact: number;
  estimatedTime: number;
  risks: string[];
}
