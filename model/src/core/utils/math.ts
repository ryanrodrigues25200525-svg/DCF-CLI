/**
 * Shared utility functions for DCF calculations
 */

/**
 * Safely divide two numbers, returning a fallback if denominator is 0
 */
export function safeDiv(num: number, den: number, fallback: number = 0): number {
    if (!den || den === 0) return fallback;
    return num / den;
}

/**
 * Safely get an item from an array with bounds checking
 */
export function safeGet(arr: ReadonlyArray<number | null> | undefined, idx: number, fallback: number = 0): number {
    if (!arr || idx < 0 || idx >= arr.length) return fallback;
    const value = arr[idx];
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
