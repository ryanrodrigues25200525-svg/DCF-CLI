/**
 * DCF Export API Route
 * Proxies Excel export requests to backend openpyxl exporter.
 */

import { NextRequest, NextResponse } from 'next/server';
import type { DcfExportPayload } from '@/services/exporters/excel/types';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function sanitizeFilenamePart(value: string): string {
    const trimmed = value.trim();
    const cleaned = trimmed.replace(/[\\/:*?"<>|]/g, '');
    return cleaned || 'ticker';
}

function buildTemplateExportFilename(ticker: string): string {
    return `${sanitizeFilenamePart(ticker).toLowerCase()}_dcf.xlsx`;
}

export async function POST(request: NextRequest) {
    try {
        const payload: DcfExportPayload = await request.json();

        // Validate payload size (approximate)
        const payloadStr = JSON.stringify(payload);
        if (payloadStr.length > 5 * 1024 * 1024) { // 5MB limit
            return NextResponse.json(
                { error: 'Payload too large (max 5MB)' },
                { status: 413 }
            );
        }

        // Validate required fields
        if (!payload.company?.ticker) {
            return NextResponse.json(
                { error: 'Missing company ticker' },
                { status: 400 }
            );
        }

        if (!payload.historicals?.years?.length) {
            return NextResponse.json(
                { error: 'Missing historical data' },
                { status: 400 }
            );
        }

        // Validate Array Consistency
        // We rely on buildExportPayload to provide the correct keys. 
        // Just ensure historicals.income exists.
        if (!payload.historicals.income || !payload.historicals.balance) {
            return NextResponse.json(
                { error: 'Missing historical financial data' },
                { status: 400 }
            );
        }

        if (!payload.assumptions) {
            return NextResponse.json(
                { error: 'Missing model assumptions' },
                { status: 400 }
            );
        }

        const backendBaseUrl = process.env.SEC_SERVICE_URL || process.env.NEXT_PUBLIC_SEC_SERVICE_URL || 'http://localhost:8000';
        const backendResponse = await fetch(`${backendBaseUrl}/api/export/dcf/excel`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: payloadStr,
            cache: 'no-store',
        });

        if (!backendResponse.ok) {
            let errorMessage = 'Failed to generate Excel file';
            // Read as text first to avoid consuming body twice
            const rawBody = await backendResponse.text();
            if (rawBody.trim()) {
                try {
                    const maybeJson = JSON.parse(rawBody) as { error?: { message?: string } | string; message?: string };
                    if (typeof maybeJson.error === 'string') {
                        errorMessage = maybeJson.error;
                    } else if (maybeJson.error && typeof maybeJson.error === 'object' && typeof maybeJson.error.message === 'string') {
                        errorMessage = maybeJson.error.message;
                    } else if (typeof maybeJson.message === 'string') {
                        errorMessage = maybeJson.message;
                    } else {
                        errorMessage = rawBody.slice(0, 500);
                    }
                } catch {
                    errorMessage = rawBody.slice(0, 500);
                }
            }

            return NextResponse.json(
                { error: errorMessage },
                { status: backendResponse.status }
            );
        }

        // Generate filename
        const filename = buildTemplateExportFilename(payload.company.ticker || 'ticker');
        const upstreamContentDisposition = backendResponse.headers.get('content-disposition') || `attachment; filename="${filename}"`;
        const arrayBuffer = await backendResponse.arrayBuffer();

        // Return the file as a downloadable response
        return new NextResponse(arrayBuffer, {
            status: 200,
            headers: {
                'Content-Type': XLSX_MIME,
                'Content-Disposition': upstreamContentDisposition,
                'Cache-Control': 'no-cache, no-store, must-revalidate',
            },
        });
    } catch (error) {
        console.error('Excel export error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to generate Excel file' },
            { status: 500 }
        );
    }
}
