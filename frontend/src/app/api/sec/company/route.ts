import { NextRequest, NextResponse } from "next/server";

import { NativeUnifiedPayload } from "@/core/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const SEC_SERVICE_URL =
    process.env.SEC_SERVICE_URL ||
    process.env.NEXT_PUBLIC_SEC_SERVICE_URL ||
    "http://localhost:8000";
const BACKEND_TIMEOUT_MS = 10_000;
const BACKEND_RETRY_TIMEOUT_MS = 22_000;
const inFlightRequests = new Map<string, Promise<NativeUnifiedPayload>>();
const MAX_INFLIGHT = 100;

function setInflight(ticker: string, promise: Promise<NativeUnifiedPayload>) {
  if (inFlightRequests.size >= MAX_INFLIGHT) {
    const firstKey = inFlightRequests.keys().next().value;
    if (firstKey) inFlightRequests.delete(firstKey);
  }
  inFlightRequests.set(ticker, promise);
}

class UpstreamError extends Error {
    status: number;

    constructor(message: string, status: number) {
        super(message);
        this.name = "UpstreamError";
        this.status = status;
    }
}

const isAbortLikeError = (error: unknown): boolean => {
    if (!(error instanceof Error)) return false;
    if (error.name === "AbortError") return true;
    return /abort|aborted|timed out|timeout/i.test(error.message);
};

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, {
            method: "GET",
            headers: { "Content-Type": "application/json" },
            cache: "no-store",
            signal: controller.signal,
        });
    } finally {
        clearTimeout(timeoutId);
    }
}

async function fetchUnifiedFromBackend(ticker: string): Promise<NativeUnifiedPayload> {
    const url = `${SEC_SERVICE_URL}/api/company/${ticker}/unified/native?years=5`;

    let response: Response;
    try {
        response = await fetchWithTimeout(url, BACKEND_TIMEOUT_MS);
    } catch {
        // First request after backend startup can fail quickly (e.g. connection refused)
        // or timeout while warming up. Retry once with a longer timeout for both cases.
        try {
            response = await fetchWithTimeout(url, BACKEND_RETRY_TIMEOUT_MS);
        } catch (retryError) {
            if (isAbortLikeError(retryError)) {
                throw new UpstreamError("Backend request timed out. Please try again.", 504);
            }
            const retryMessage = retryError instanceof Error ? retryError.message : "Upstream request failed";
            throw new UpstreamError(retryMessage, 503);
        }
    }

    if (!response.ok) {
        const body = await response.text().catch(() => "");
        const details = body ? ` - ${body.slice(0, 240)}` : "";
        throw new UpstreamError(
            `Backend error: ${response.status} ${response.statusText}${details}`,
            response.status
        );
    }

    const payload = (await response.json()) as NativeUnifiedPayload;
    return payload;
}

export async function GET(req: NextRequest) {
    const t0 = Date.now();
    const { searchParams } = new URL(req.url);
    const tickerRaw = searchParams.get("ticker");
    const ticker = tickerRaw?.trim().toUpperCase() || "";

    if (!ticker) {
        return NextResponse.json({ error: "Ticker required" }, { status: 400 });
    }
    if (!/^[A-Z0-9.-]{1,10}$/.test(ticker)) {
        return NextResponse.json({ error: "Invalid ticker format" }, { status: 400 });
    }

    let dataPromise = inFlightRequests.get(ticker);
    const isDeduped = Boolean(dataPromise);
    if (!dataPromise) {
        dataPromise = fetchUnifiedFromBackend(ticker);
        setInflight(ticker, dataPromise);
    }

    try {
        const responseData = await dataPromise;

        return NextResponse.json(responseData, {
            headers: {
                "X-Data-Source": isDeduped ? "deduped" : "fresh",
                "X-Upstream-Time-Ms": String(Math.max(0, Date.now() - t0)),
                "X-Cache-Hit": "false",
                "Cache-Control": "no-store",
            },
        });
    } catch (error) {
        if (!(error instanceof UpstreamError)) {
            console.error("[API /sec/company] Unified data fetch error:", error);
        }

        const errorMessage = error instanceof Error ? error.message : "Failed to fetch company data";
        const status =
            error instanceof UpstreamError
                ? error.status
                : /profile not found|not found/i.test(errorMessage)
                    ? 404
                    : 500;

        return NextResponse.json(
            {
                error: errorMessage,
                details: "Please ensure the backend service is running and the ticker is valid.",
            },
            {
                status,
                headers: {
                    "X-Data-Source": "error",
                    "X-Upstream-Time-Ms": String(Math.max(0, Date.now() - t0)),
                    "X-Cache-Hit": "false",
                },
            }
        );
    } finally {
        if (inFlightRequests.get(ticker) === dataPromise) {
            inFlightRequests.delete(ticker);
        }
    }
}
