/**
 * OneSignal API Proxy - Next.js API Route
 * Proxies requests to api.onesignal.com to bypass ad blockers
 * Route: /api/onesignal/*
 */

import { NextRequest, NextResponse } from 'next/server';

async function handleRequest(request: NextRequest, params: { path: string[] }) {
  // Build the path from the catch-all segments
  const pathSegments = params.path || [];
  const path = pathSegments.join('/');

  // Get query string
  const searchParams = request.nextUrl.searchParams.toString();
  const queryString = searchParams ? `?${searchParams}` : '';

  // Build target URL to OneSignal API
  const targetUrl = `https://api.onesignal.com/${path}${queryString}`;

  // Clone headers, removing Cloudflare/Vercel specific ones
  const headers = new Headers();
  request.headers.forEach((value, key) => {
    const lowerKey = key.toLowerCase();
    if (!lowerKey.startsWith('cf-') &&
        !lowerKey.startsWith('x-vercel') &&
        !lowerKey.startsWith('x-forwarded') &&
        lowerKey !== 'host') {
      headers.set(key, value);
    }
  });

  try {
    // Forward the request to OneSignal
    const response = await fetch(targetUrl, {
      method: request.method,
      headers: headers,
      body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
      // @ts-ignore - duplex is needed for streaming body
      duplex: 'half',
    });

    // Create response with CORS headers
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set('Access-Control-Allow-Origin', '*');
    responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    responseHeaders.set('Access-Control-Allow-Headers', 'Content-Type, SDK-Version, Authorization, OneSignal-Subscription-Id');

    return new NextResponse(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error('OneSignal proxy error:', error);
    return NextResponse.json(
      { error: 'Proxy error', message: String(error) },
      {
        status: 502,
        headers: {
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
}

// Handle CORS preflight
export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, SDK-Version, Authorization, OneSignal-Subscription-Id',
      'Access-Control-Max-Age': '86400',
    },
  });
}

export async function GET(request: NextRequest, { params }: { params: { path: string[] } }) {
  return handleRequest(request, params);
}

export async function POST(request: NextRequest, { params }: { params: { path: string[] } }) {
  return handleRequest(request, params);
}

export async function PUT(request: NextRequest, { params }: { params: { path: string[] } }) {
  return handleRequest(request, params);
}

export async function DELETE(request: NextRequest, { params }: { params: { path: string[] } }) {
  return handleRequest(request, params);
}

export async function PATCH(request: NextRequest, { params }: { params: { path: string[] } }) {
  return handleRequest(request, params);
}
