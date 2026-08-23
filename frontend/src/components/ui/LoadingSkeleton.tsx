"use client";

import React from "react";
import { cn } from "@/core/utils/cn";

interface SkeletonProps {
    className?: string;
}

function Skeleton({ className }: SkeletonProps) {
    return (
        <div
            className={cn(
                "animate-pulse rounded-md bg-white/5 border border-white/5",
                className
            )}
        />
    );
}

export function LoadingSkeleton() {
    return (
        <div className="flex-1 w-full max-w-[1400px] mx-auto space-y-8 p-6 animate-in fade-in duration-500">
            {/* Header Section Skeleton */}
            <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <Skeleton className="w-12 h-12 rounded-xl" />
                    <div className="space-y-2">
                        <Skeleton className="h-6 w-48" />
                        <Skeleton className="h-3 w-32" />
                    </div>
                </div>
                <div className="flex gap-2">
                    <Skeleton className="h-10 w-24 rounded-lg" />
                    <Skeleton className="h-10 w-24 rounded-lg" />
                </div>
            </div>

            {/* Metrics Grid Skeleton */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-4">
                {[...Array(6)].map((_, i) => (
                    <Skeleton key={i} className="h-28 rounded-2xl" />
                ))}
            </div>

            {/* Main Content Area Skeleton */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-6">
                    <Skeleton className="h-[400px] rounded-3xl" />
                    <div className="grid grid-cols-2 gap-6">
                        <Skeleton className="h-[200px] rounded-3xl" />
                        <Skeleton className="h-[200px] rounded-3xl" />
                    </div>
                </div>
                <div className="space-y-6">
                    <Skeleton className="h-[300px] rounded-3xl" />
                    <Skeleton className="h-[300px] rounded-3xl" />
                </div>
            </div>

            {/* Table Area Skeleton */}
            <div className="space-y-4 pt-4">
                <div className="flex items-center justify-between">
                    <Skeleton className="h-6 w-32" />
                    <Skeleton className="h-6 w-48" />
                </div>
                <div className="space-y-2">
                    {[...Array(8)].map((_, i) => (
                        <Skeleton key={i} className="h-12 rounded-lg" />
                    ))}
                </div>
            </div>
        </div>
    );
}
