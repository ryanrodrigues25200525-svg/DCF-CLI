import { NextResponse } from 'next/server';
import { fetchMarketData, getHistoricalPrices, fetchBatchMarketData } from '@/services/integration/market-data/yahoo-finance';

export const dynamic = 'force-dynamic';

/**
 * GET /api/market-data
 * Returns real-time market data for specified tickers
 * Query params:
 *   - ticker: Single ticker symbol (e.g., AAPL)
 *   - tickers: Comma-separated list of tickers (e.g., AAPL,MSFT,GOOGL)
 *   - period: Historical data period (1d, 5d, 1mo, 3mo, 6mo, 1y, 2y, 5y, 10y, ytd, max) - only for single ticker
 *   - type: 'quote' | 'historical' | 'both' (default: 'quote')
 */
/**
 * POST /api/market-data
 * Returns batch market data for tickers in request body
 */
export async function POST(request: Request) {
  try {
    const { tickers } = await request.json();

    if (!tickers || !Array.isArray(tickers)) {
      return NextResponse.json(
        { error: 'Tickers must be an array' },
        { status: 400 }
      );
    }

    if (tickers.length > 50) {
      return NextResponse.json(
        { error: 'Maximum 50 tickers allowed per batch' },
        { status: 400 }
      );
    }

    const results = await fetchBatchMarketData(tickers);

    // Map to ComparableCompany format expected by frontend
    const data = results.map((result) => {
      if (!result) return null;
      return {
        ...result,
        isSelected: false // default, will be managed by component
      };
    }).filter(Boolean);

    return NextResponse.json({ data });
  } catch (error) {
    console.error('[API /market-data] POST Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch batch market data' },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const singleTicker = searchParams.get('ticker');
    const multiTickers = searchParams.get('tickers');
    const rawPeriod = searchParams.get('period') || '2y';
    const validPeriods = new Set(['1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y', '10y', 'ytd', 'max']);
    const period = validPeriods.has(rawPeriod) ? rawPeriod : '2y';
    const type = searchParams.get('type') || 'quote';

    // Handle single ticker with historical data
    if (singleTicker) {
      const ticker = singleTicker.toUpperCase();

      if (type === 'historical' || type === 'both') {
        const [quote, historical] = await Promise.all([
          type === 'both' ? fetchMarketData(ticker) : Promise.resolve(null),
          getHistoricalPrices(ticker, period),
        ]);

        return NextResponse.json({
          ticker,
          quote,
          historical: {
            period,
            data: historical,
            count: historical.length,
          },
          asOf: new Date().toISOString(),
        });
      }

      // Just quote data
      const quote = await fetchMarketData(ticker);

      if (!quote) {
        return NextResponse.json(
          { error: `No market data available for ${ticker}` },
          { status: 404 }
        );
      }

      return NextResponse.json({
        ticker,
        quote,
        asOf: new Date().toISOString(),
      });
    }

    // Handle multiple tickers (batch request)
    if (multiTickers) {
      const tickers = multiTickers.split(',').map(t => t.trim().toUpperCase());

      if (tickers.length > 50) {
        return NextResponse.json(
          { error: 'Maximum 50 tickers allowed per request' },
          { status: 400 }
        );
      }

      const results = await fetchBatchMarketData(tickers);

      const response = tickers.reduce((acc, ticker, index) => {
        acc[ticker] = results[index];
        return acc;
      }, {} as Record<string, typeof results[0]>);

      return NextResponse.json({
        tickers: response,
        count: tickers.length,
        asOf: new Date().toISOString(),
      });
    }

    return NextResponse.json(
      { error: 'Missing required parameter: ticker or tickers' },
      { status: 400 }
    );
  } catch (error) {
    console.error('[API /market-data] GET Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch market data' },
      { status: 500 }
    );
  }
}
