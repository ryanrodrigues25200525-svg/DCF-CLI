"use client";

import { useState, useEffect, useRef } from 'react';
import { Loader2, Building2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import styles from './SearchBar.module.css';
import { searchTickers } from '@/core/utils/ticker-search-client';

interface Suggestion {
    ticker: string;
    name: string;
    cik: string;
}

interface SearchBarProps {
    onSelect: (company: Suggestion) => void;
    isLoading: boolean;
    value: string;
    onChange: (val: string) => void;
    onSearch?: (val: string) => void;
    // Keeping variant prop for compatibility but using new styles primarily
    variant?: 'default' | 'hero';
}

export function SearchBar({ onSelect, isLoading, value, onChange, onSearch }: SearchBarProps) {
    const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [selectedIndex, setSelectedIndex] = useState(-1);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setShowSuggestions(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
        const normalized = value.trim().toUpperCase();
        if (!normalized || normalized.length < 2) {
            setSuggestions([]);
            setShowSuggestions(false);
            return;
        }

        const controller = new AbortController();

        const timeoutId = setTimeout(async () => {
            setIsSearching(true);
            try {
                const data = await searchTickers(normalized, { signal: controller.signal, limit: 8 });
                setSuggestions(data);
                setShowSuggestions(data.length > 0);
                setSelectedIndex(-1);
            } catch (error) {
                if (error instanceof Error && error.name === 'AbortError') return;
                console.error("Search error:", error);
            } finally {
                setIsSearching(false);
            }
        }, 180);

        return () => {
            clearTimeout(timeoutId);
            controller.abort();
        };
    }, [value]);

    const handleKeyDown = async (e: React.KeyboardEvent) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (showSuggestions) {
                setSelectedIndex(prev => (prev < suggestions.length - 1 ? prev + 1 : prev));
            }
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (showSuggestions) {
                setSelectedIndex(prev => (prev > -1 ? prev - 1 : -1));
            }
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (showSuggestions && suggestions.length > 0) {
                const picked = selectedIndex >= 0 ? suggestions[selectedIndex] : suggestions[0];
                handleSelect(picked);
            } else if (onSearch) {
                const normalized = value.trim().toUpperCase();
                if (!normalized) return;

                 // Fast path: for direct ticker input, execute immediately.
                if (/^[A-Z.\-]{1,8}$/.test(normalized)) {
                    onSearch(normalized);
                    setShowSuggestions(false);
                    return;
                }

                const exact = suggestions.find((s) => s.ticker.toUpperCase() === normalized);
                if (exact) {
                    handleSelect(exact);
                    return;
                }

                setIsSearching(true);
                try {
                    const resolved = await searchTickers(normalized, { limit: 1 });
                    if (resolved.length > 0) {
                        handleSelect(resolved[0]);
                        return;
                    }
                    onSearch(normalized);
                } finally {
                    setIsSearching(false);
                }
                setShowSuggestions(false);
            }
        } else if (e.key === 'Escape') {
            setShowSuggestions(false);
        }
    };

    const handleSelect = (s: Suggestion) => {
        const normalizedTicker = s.ticker.trim().toUpperCase();
        onChange(normalizedTicker);
        setSuggestions([]);
        setShowSuggestions(false);
        onSelect({ ...s, ticker: normalizedTicker });
    };

    const handleClear = () => {
        onChange('');
        setSuggestions([]);
        setShowSuggestions(false);
    }

    return (
        <div ref={containerRef} className={`${styles.variableRoot} ${styles.searchContainer}`}>
            {/* Input comes first for sibling selectors to work */}
            <input
                type="text"
                id="dcf-search-input"
                data-search-input
                className={styles.searchField}
                placeholder="Search ticker, company name, or CIK..."
                value={value}
                onChange={(e) => onChange(e.target.value)}
                onKeyDown={handleKeyDown}
                onFocus={() => value.length >= 2 && suggestions.length > 0 && setShowSuggestions(true)}
                disabled={isLoading}
                autoComplete="off"
            />

            {/* Icon */}
            <div className={styles.searchIcon}>
                {isSearching ? (
                    <Loader2 className="animate-spin w-[18px] h-[18px] text-blue-500" />
                ) : (
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18">
                        <circle cx="6.5" cy="6.5" r="5.5" />
                        <path d="M11 11L15 15" />
                    </svg>
                )}
            </div>

            {/* Clear Button */}
            <button className={styles.searchClear} onClick={handleClear} aria-label="Clear search">
                <svg width="8" height="8" viewBox="0 0 16 16" fill="white">
                    <path d="M8 7.293l4.146-4.147a.5.5 0 0 1 .708.708L8.707 8l4.147 4.146a.5.5 0 0 1-.708.708L8 8.707l-4.146 4.147a.5.5 0 0 1-.708-.708L7.293 8 3.146 3.854a.5.5 0 1 1 .708-.708L8 7.293z" />
                </svg>
            </button>

            {/* Keyboard Shortcut */}
            <div className={styles.searchShortcut}>
                <span>⌘</span>
                <span>K</span>
            </div>

            {/* Suggestions */}
            <AnimatePresence>
                {showSuggestions && (
                    <motion.div
                        className={styles.searchSuggestions}
                        initial={{ opacity: 0, transform: 'translateY(-8px) scale(0.96)' }}
                        animate={{ opacity: 1, transform: 'translateY(0) scale(1)' }}
                        exit={{ opacity: 0, transform: 'translateY(-8px) scale(0.96)' }}
                        transition={{ duration: 0.15, ease: [0.4, 0.0, 0.2, 1] }}
                    >
                        {suggestions.map((s, idx) => (
                            <div
                                key={`${s.ticker}-${s.cik}`}
                                className={`${styles.suggestionItem} ${selectedIndex === idx ? styles.suggestionItemActive : ''}`}
                                onClick={() => handleSelect(s)}
                                onMouseEnter={() => setSelectedIndex(idx)}
                            >
                                <div className={styles.suggestionIcon}>
                                    <Building2 className="w-5 h-5 text-slate-400" strokeWidth={1.5} />
                                </div>
                                <span className={styles.suggestionText}>{s.name}</span>
                                <span className={styles.suggestionSubtext}>{s.ticker}</span>
                            </div>
                        ))}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
