export function createTestDatabase(): string;
export function testDatabaseDirectory(databasePath: string | undefined): string;
export function resetClubTestData(databasePath: string | undefined, options?: { timeoutMs?: number }): Promise<void>;
export function removeTestDatabase(databasePath: string | undefined): void;
