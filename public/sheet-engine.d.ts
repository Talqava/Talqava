// Types for the sheet engine (public/sheet-engine.js), which runs in the window and in the app.
export interface Range { c1: number; r1: number; c2: number; r2: number }
export interface Sheet { name: string; cells: Record<string, string>; locks: Range[]; formats: { range: Range; format: string }[]; charts: { type: string; range: Range; title: string }[] }
export interface SheetFile { sheets: Sheet[] }
export class SheetError { code: string; constructor(code: string) }
export type CellValue = number | string | boolean | SheetError;
export const MAX_COLS: number;
export const MAX_ROWS: number;
export const FORMATS: string[];
export const CHART_TYPES: string[];
export const FUNCTION_NAMES: string[];
export function colIndex(letters: string): number;
export function colName(i: number): string;
export function parseRef(ref: string): { col: number; row: number } | null;
export function refName(col: number, row: number): string;
export function parseRange(range: string): Range | null;
export function rangeName(r: Range): string;
export function emptyFile(name?: string): SheetFile;
export function parseFile(text: string): SheetFile;
export function writeFile(file: SheetFile): string;
export function isLocked(sheet: Sheet, col: number, row: number): boolean;
export function formatOf(sheet: Sheet, col: number, row: number): string;
export function extent(sheet: Sheet): { rows: number; cols: number };
export function isError(v: unknown): v is SheetError;
export function literal(raw: string): number | string | boolean;
export function compute(file: SheetFile): (sheet: number, col: number, row: number) => CellValue;
export function show(v: CellValue, format?: string): string;
export function diffFiles(before: SheetFile, after: SheetFile): { sheet: string; ref: string; from: string; to: string }[];
